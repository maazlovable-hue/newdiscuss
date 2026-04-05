// Groups Database Service - Uses Fourth Firebase (Realtime Database)
// Stores: Groups, Group Messages, Join Requests, Members
// Uses same Auth UID as primary Firebase for sync

import {
  fourthDatabase,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  off,
  query,
  orderByChild,
  limitToLast
} from './firebaseFourth';
import { getUser } from './db';

// Group types
export const GROUP_TYPE = {
  PUBLIC: 'public',
  PRIVATE: 'private'
};

// Group status
export const GROUP_STATUS = {
  ACTIVE: 'active',
  DELETED: 'deleted'
};

// Member roles
export const MEMBER_ROLE = {
  ADMIN: 'admin',
  MEMBER: 'member'
};

// Join request status
export const REQUEST_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

const normalizeGroupName = (name) => {
  return name.toLowerCase().trim().replace(/\s+/g, '_');
};

export const isGroupNameAvailable = async (groupName) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const normalized = normalizeGroupName(groupName);
    const nameRef = ref(fourthDatabase, `groupNames/${normalized}`);
    const snapshot = await get(nameRef);
    return !snapshot.exists();
  } catch (error) {
    console.error('Error checking group name:', error);
    return false;
  }
};

export const createGroup = async (creatorId, groupName, type = GROUP_TYPE.PUBLIC) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const trimmedName = groupName.trim();
    if (!trimmedName) throw new Error('Group name cannot be empty');
    const isAvailable = await isGroupNameAvailable(trimmedName);
    if (!isAvailable) throw new Error('Group name already exists');
    
    const groupsRef = ref(fourthDatabase, 'groups');
    const newGroupRef = push(groupsRef);
    const groupId = newGroupRef.key;
    const timestamp = new Date().toISOString();
    
    const groupData = {
      id: groupId,
      name: trimmedName,
      type,
      createdBy: creatorId,
      createdAt: timestamp,
      status: GROUP_STATUS.ACTIVE,
      settings: { adminOnlyMessaging: false, autoDelete24h: false },
      memberCount: 1
    };
    
    await set(newGroupRef, groupData);
    const normalized = normalizeGroupName(trimmedName);
    await set(ref(fourthDatabase, `groupNames/${normalized}`), groupId);
    
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${creatorId}`);
    await set(memberRef, { userId: creatorId, role: MEMBER_ROLE.ADMIN, joinedAt: timestamp, addedBy: creatorId });
    await addGroupToUserList(creatorId, groupId, trimmedName, type, timestamp);
    
    return { id: groupId, ...groupData };
  } catch (error) {
    console.error('Error creating group:', error);
    throw error;
  }
};

export const addMemberToGroup = async (groupId, userId, role = MEMBER_ROLE.MEMBER, addedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const timestamp = new Date().toISOString();
    
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    const memberData = { userId, role, joinedAt: timestamp, addedBy };
    await set(memberRef, memberData);
    
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.val();
      await update(groupRef, { memberCount: (group.memberCount || 0) + 1 });
      await addGroupToUserList(userId, groupId, group.name, group.type, timestamp);
      
      // Get username for system message
      const userData = await getUser(userId);
      const username = userData?.username || userId;
      await addSystemMessage(groupId, `@${username} was added to the group`, addedBy);
    }
    return memberData;
  } catch (error) {
    console.error('Error adding member:', error);
    throw error;
  }
};

export const removeMemberFromGroup = async (groupId, userId, removedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const timestamp = new Date().toISOString();
    
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    await remove(memberRef);
    
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.val();
      await update(groupRef, { memberCount: Math.max(0, (group.memberCount || 1) - 1) });
    }
    
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    await update(userGroupRef, { isMember: false, leftAt: timestamp });
    
    // Get username for system message
    const userData = await getUser(userId);
    const username = userData?.username || userId;
    await addSystemMessage(groupId, `@${username} was removed from the group`, removedBy);
    
    return { success: true };
  } catch (error) {
    console.error('Error removing member:', error);
    throw error;
  }
};

export const leaveGroup = async (groupId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const timestamp = new Date().toISOString();
    
    const membersRef = ref(fourthDatabase, `groups/${groupId}/members`);
    const membersSnap = await get(membersRef);
    
    if (membersSnap.exists()) {
      const members = membersSnap.val();
      const admins = Object.values(members).filter(m => m.role === MEMBER_ROLE.ADMIN);
      const isOnlyAdmin = admins.length === 1 && admins[0].userId === userId;
      
      if (isOnlyAdmin && Object.keys(members).length > 1) {
        throw new Error('Transfer admin role before leaving. You are the only admin.');
      }
    }
    
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    await remove(memberRef);
    
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.val();
      await update(groupRef, { memberCount: Math.max(0, (group.memberCount || 1) - 1) });
    }
    
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    await update(userGroupRef, { isMember: false, leftAt: timestamp });
    
    // Get username for system message
    const userData = await getUser(userId);
    const username = userData?.username || userId;
    await addSystemMessage(groupId, `@${username} left the group`, userId);
    
    return { success: true };
  } catch (error) {
    console.error('Error leaving group:', error);
    throw error;
  }
};

export const promoteMemberToAdmin = async (groupId, userId, promotedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    await update(memberRef, { role: MEMBER_ROLE.ADMIN, promotedAt: new Date().toISOString(), promotedBy });
    return { success: true };
  } catch (error) {
    console.error('Error promoting member:', error);
    throw error;
  }
};

export const demoteAdminToMember = async (groupId, userId, demotedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const membersRef = ref(fourthDatabase, `groups/${groupId}/members`);
    const membersSnap = await get(membersRef);
    
    if (membersSnap.exists()) {
      const members = membersSnap.val();
      const admins = Object.values(members).filter(m => m.role === MEMBER_ROLE.ADMIN);
      if (admins.length === 1 && admins[0].userId === userId) {
        throw new Error('Cannot demote the only admin');
      }
    }
    
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    await update(memberRef, { role: MEMBER_ROLE.MEMBER, demotedAt: new Date().toISOString(), demotedBy });
    return { success: true };
  } catch (error) {
    console.error('Error demoting admin:', error);
    throw error;
  }
};

export const deleteGroup = async (groupId, deletedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (!groupSnap.exists()) throw new Error('Group not found');
    
    const group = groupSnap.val();
    
    // Completely remove group from database
    await remove(groupRef);
    
    // Remove from all users' lists
    const membersRef = ref(fourthDatabase, `groups/${groupId}/members`);
    const membersSnap = await get(membersRef);
    if (membersSnap.exists()) {
      const members = membersSnap.val();
      for (const userId of Object.keys(members)) {
        const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
        await remove(userGroupRef);
      }
    }
    
    // Release group name
    const normalized = normalizeGroupName(group.name);
    await remove(ref(fourthDatabase, `groupNames/${normalized}`));
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting group:', error);
    throw error;
  }
};

export const deleteChatLocally = async (groupId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    await remove(userGroupRef);
    return { success: true };
  } catch (error) {
    console.error('Error deleting chat locally:', error);
    throw error;
  }
};

const addGroupToUserList = async (userId, groupId, groupName, groupType, joinedAt) => {
  try {
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    await set(userGroupRef, {
      groupId,
      groupName,
      groupType,
      joinedAt,
      unreadCount: 0,
      isMember: true,
      status: GROUP_STATUS.ACTIVE
    });
  } catch (error) {
    console.error('Error adding group to user list:', error);
  }
};

export const sendGroupMessage = async (groupId, senderId, text, replyTo = null) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${senderId}`);
    const memberSnap = await get(memberRef);
    if (!memberSnap.exists()) throw new Error('You are not a member of this group');
    
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.val();
      const member = memberSnap.val();
      if (group.settings?.adminOnlyMessaging && member.role !== MEMBER_ROLE.ADMIN) {
        throw new Error('Only admins can send messages in this group');
      }
    }
    
    const timestamp = new Date().toISOString();
    const messagesRef = ref(fourthDatabase, `groups/${groupId}/messages`);
    const newMessageRef = push(messagesRef);
    const message = { text: text.trim(), sender: senderId, timestamp, type: 'message' };
    
    if (replyTo) {
      message.replyTo = { id: replyTo.id, text: replyTo.text?.substring(0, 100) || '', sender: replyTo.sender };
    }
    
    await set(newMessageRef, message);
    await update(groupRef, { lastMessage: { text: text.trim(), sender: senderId, timestamp } });
    
    const membersSnap = await get(ref(fourthDatabase, `groups/${groupId}/members`));
    if (membersSnap.exists()) {
      const members = membersSnap.val();
      for (const userId of Object.keys(members)) {
        const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
        if (userId !== senderId) {
          const userGroupSnap = await get(userGroupRef);
          const currentUnread = userGroupSnap.exists() ? (userGroupSnap.val().unreadCount || 0) : 0;
          await update(userGroupRef, { lastMessage: text.trim(), lastMessageTime: timestamp, unreadCount: currentUnread + 1 });
        } else {
          await update(userGroupRef, { lastMessage: text.trim(), lastMessageTime: timestamp, unreadCount: 0 });
        }
      }
    }
    
    return { id: newMessageRef.key, ...message };
  } catch (error) {
    console.error('Error sending group message:', error);
    throw error;
  }
};

const addSystemMessage = async (groupId, text, triggeredBy) => {
  try {
    if (!fourthDatabase) return;
    const messagesRef = ref(fourthDatabase, `groups/${groupId}/messages`);
    const newMessageRef = push(messagesRef);
    await set(newMessageRef, { text, type: 'system', timestamp: new Date().toISOString(), triggeredBy });
  } catch (error) {
    console.error('Error adding system message:', error);
  }
};

export const getGroupMessages = async (groupId, userId) => {
  try {
    const messagesRef = ref(fourthDatabase, `groups/${groupId}/messages`);
    const messagesQuery = query(messagesRef, orderByChild('timestamp'), limitToLast(100));
    const snapshot = await get(messagesQuery);
    if (!snapshot.exists()) return [];
    
    // Get user's join time
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    const userGroupSnap = await get(userGroupRef);
    const joinTime = userGroupSnap.exists() ? userGroupSnap.val().joinedAt : null;
    
    const messages = snapshot.val();
    return Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .filter(msg => !joinTime || new Date(msg.timestamp) >= new Date(joinTime))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (error) {
    console.error('Error getting group messages:', error);
    return [];
  }
};

export const subscribeToGroupMessages = (groupId, callback) => {
  const messagesRef = ref(fourthDatabase, `groups/${groupId}/messages`);
  const handleMessages = (snapshot) => {
    if (!snapshot.exists()) { callback([]); return; }
    const messages = snapshot.val();
    const messagesList = Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    callback(messagesList);
  };
  onValue(messagesRef, handleMessages);
  return () => off(messagesRef);
};

export const deleteGroupMessageForMe = async (groupId, messageId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const deletedRef = ref(fourthDatabase, `deletedGroupMessages/${userId}/${groupId}/${messageId}`);
    await set(deletedRef, { deletedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) {
    console.error('Error deleting message for me:', error);
    throw error;
  }
};

export const deleteGroupMessageForEveryone = async (groupId, messageId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const messageRef = ref(fourthDatabase, `groups/${groupId}/messages/${messageId}`);
    const snapshot = await get(messageRef);
    if (!snapshot.exists()) throw new Error('Message not found');
    
    const message = snapshot.val();
    if (message.sender !== userId) throw new Error('Only sender can delete for everyone');
    
    await update(messageRef, { deleted: true, deletedAt: new Date().toISOString(), deletedBy: userId, text: 'This message was deleted' });
    
    // Update last message if it was the deleted message
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (groupSnap.exists()) {
      const group = groupSnap.val();
      if (group.lastMessage?.text === message.text) {
        const membersSnap = await get(ref(fourthDatabase, `groups/${groupId}/members`));
        if (membersSnap.exists()) {
          const members = membersSnap.val();
          for (const uid of Object.keys(members)) {
            const userGroupRef = ref(fourthDatabase, `userGroups/${uid}/${groupId}`);
            await update(userGroupRef, { lastMessage: 'This message was deleted' });
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting message for everyone:', error);
    throw error;
  }
};

export const getDeletedGroupMessages = async (userId, groupId) => {
  try {
    if (!fourthDatabase) return [];
    const deletedRef = ref(fourthDatabase, `deletedGroupMessages/${userId}/${groupId}`);
    const snapshot = await get(deletedRef);
    if (!snapshot.exists()) return [];
    return Object.keys(snapshot.val());
  } catch (error) {
    console.error('Error getting deleted messages:', error);
    return [];
  }
};

export const markGroupMessagesAsRead = async (groupId, userId) => {
  try {
    const userGroupRef = ref(fourthDatabase, `userGroups/${userId}/${groupId}`);
    await update(userGroupRef, { unreadCount: 0 });
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
};

export const getUserGroups = async (userId) => {
  try {
    const userGroupsRef = ref(fourthDatabase, `userGroups/${userId}`);
    const snapshot = await get(userGroupsRef);
    if (!snapshot.exists()) return [];
    
    const groups = snapshot.val();
    return Object.entries(groups)
      .map(([groupId, group]) => ({ groupId, ...group }))
      .sort((a, b) => new Date(b.lastMessageTime || b.joinedAt) - new Date(a.lastMessageTime || a.joinedAt));
  } catch (error) {
    console.error('Error getting user groups:', error);
    return [];
  }
};

export const subscribeToUserGroups = (userId, callback) => {
  const userGroupsRef = ref(fourthDatabase, `userGroups/${userId}`);
  const handleGroups = (snapshot) => {
    if (!snapshot.exists()) { callback([]); return; }
    const groups = snapshot.val();
    const groupsList = Object.entries(groups)
      .map(([groupId, group]) => ({ groupId, ...group }))
      .sort((a, b) => new Date(b.lastMessageTime || b.joinedAt) - new Date(a.lastMessageTime || a.joinedAt));
    callback(groupsList);
  };
  onValue(userGroupsRef, handleGroups);
  return () => off(userGroupsRef);
};

export const getGroupInfo = async (groupId) => {
  try {
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const snapshot = await get(groupRef);
    if (!snapshot.exists()) return null;
    return snapshot.val();
  } catch (error) {
    console.error('Error getting group info:', error);
    return null;
  }
};

export const getGroupMembers = async (groupId) => {
  try {
    const membersRef = ref(fourthDatabase, `groups/${groupId}/members`);
    const snapshot = await get(membersRef);
    if (!snapshot.exists()) return [];
    const members = snapshot.val();
    return Object.entries(members).map(([userId, data]) => ({ userId, ...data }));
  } catch (error) {
    console.error('Error getting group members:', error);
    return [];
  }
};

export const subscribeToGroupMembers = (groupId, callback) => {
  const membersRef = ref(fourthDatabase, `groups/${groupId}/members`);
  const handleMembers = (snapshot) => {
    if (!snapshot.exists()) { callback([]); return; }
    const members = snapshot.val();
    const membersList = Object.entries(members).map(([userId, data]) => ({ userId, ...data }));
    callback(membersList);
  };
  onValue(membersRef, handleMembers);
  return () => off(membersRef);
};

export const searchPublicGroups = async (searchQuery) => {
  try {
    const groupsRef = ref(fourthDatabase, 'groups');
    const snapshot = await get(groupsRef);
    if (!snapshot.exists()) return [];
    
    const groups = snapshot.val();
    const query = searchQuery.toLowerCase().trim();
    return Object.entries(groups)
      .filter(([, group]) => group.type === GROUP_TYPE.PUBLIC && group.name.toLowerCase().includes(query))
      .map(([id, group]) => ({ id, ...group }));
  } catch (error) {
    console.error('Error searching groups:', error);
    return [];
  }
};

export const sendJoinRequest = async (groupId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const requestRef = ref(fourthDatabase, `groups/${groupId}/joinRequests/${userId}`);
    await set(requestRef, { userId, status: REQUEST_STATUS.PENDING, requestedAt: new Date().toISOString() });
    return { success: true };
  } catch (error) {
    console.error('Error sending join request:', error);
    throw error;
  }
};

export const cancelJoinRequest = async (groupId, userId) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const requestRef = ref(fourthDatabase, `groups/${groupId}/joinRequests/${userId}`);
    await update(requestRef, { status: REQUEST_STATUS.CANCELLED, cancelledAt: new Date().toISOString() });
    return { success: true };
  } catch (error) {
    console.error('Error cancelling join request:', error);
    throw error;
  }
};

export const acceptJoinRequest = async (groupId, userId, acceptedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const requestRef = ref(fourthDatabase, `groups/${groupId}/joinRequests/${userId}`);
    await update(requestRef, { status: REQUEST_STATUS.ACCEPTED, acceptedAt: new Date().toISOString(), acceptedBy });
    await addMemberToGroup(groupId, userId, MEMBER_ROLE.MEMBER, acceptedBy);
    return { success: true };
  } catch (error) {
    console.error('Error accepting join request:', error);
    throw error;
  }
};

export const rejectJoinRequest = async (groupId, userId, rejectedBy) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const requestRef = ref(fourthDatabase, `groups/${groupId}/joinRequests/${userId}`);
    await update(requestRef, { status: REQUEST_STATUS.REJECTED, rejectedAt: new Date().toISOString(), rejectedBy });
    return { success: true };
  } catch (error) {
    console.error('Error rejecting join request:', error);
    throw error;
  }
};

export const getGroupJoinRequests = async (groupId) => {
  try {
    const requestsRef = ref(fourthDatabase, `groups/${groupId}/joinRequests`);
    const snapshot = await get(requestsRef);
    if (!snapshot.exists()) return [];
    const requests = snapshot.val();
    return Object.entries(requests)
      .filter(([, req]) => req.status === REQUEST_STATUS.PENDING)
      .map(([userId, data]) => ({ userId, ...data }));
  } catch (error) {
    console.error('Error getting join requests:', error);
    return [];
  }
};

export const getUserJoinRequestStatus = async (groupId, userId) => {
  try {
    const requestRef = ref(fourthDatabase, `groups/${groupId}/joinRequests/${userId}`);
    const snapshot = await get(requestRef);
    if (!snapshot.exists()) return null;
    return snapshot.val().status;
  } catch (error) {
    console.error('Error getting join request status:', error);
    return null;
  }
};

export const updateGroupSettings = async (groupId, settings) => {
  try {
    if (!fourthDatabase) throw new Error('Database not available');
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    await update(groupRef, { settings });
    return { success: true };
  } catch (error) {
    console.error('Error updating group settings:', error);
    throw error;
  }
};

export const getTotalUnreadGroupCount = async (userId) => {
  try {
    const groups = await getUserGroups(userId);
    return groups.reduce((total, group) => total + (group.unreadCount || 0), 0);
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
};

export const isGroupMember = async (groupId, userId) => {
  try {
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    const snapshot = await get(memberRef);
    return snapshot.exists();
  } catch (error) {
    console.error('Error checking membership:', error);
    return false;
  }
};

export const isGroupAdmin = async (groupId, userId) => {
  try {
    const memberRef = ref(fourthDatabase, `groups/${groupId}/members/${userId}`);
    const snapshot = await get(memberRef);
    if (!snapshot.exists()) return false;
    return snapshot.val().role === MEMBER_ROLE.ADMIN;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

export const autoDeleteOldGroupMessages = async (groupId) => {
  try {
    if (!fourthDatabase) return { deleted: 0 };
    const groupRef = ref(fourthDatabase, `groups/${groupId}`);
    const groupSnap = await get(groupRef);
    if (!groupSnap.exists()) return { deleted: 0 };
    
    const group = groupSnap.val();
    if (!group.settings?.autoDelete24h) return { deleted: 0 };
    
    const messagesRef = ref(fourthDatabase, `groups/${groupId}/messages`);
    const snapshot = await get(messagesRef);
    if (!snapshot.exists()) return { deleted: 0 };
    
    const messages = snapshot.val();
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let deletedCount = 0;
    
    const deletePromises = Object.entries(messages)
      .filter(([, msg]) => msg.timestamp < cutoffTime && msg.type !== 'system')
      .map(async ([id]) => {
        const msgRef = ref(fourthDatabase, `groups/${groupId}/messages/${id}`);
        await remove(msgRef);
        deletedCount++;
      });
    
    await Promise.all(deletePromises);
    return { deleted: deletedCount };
  } catch (error) {
    console.error('Error auto-deleting messages:', error);
    return { deleted: 0 };
  }
};
