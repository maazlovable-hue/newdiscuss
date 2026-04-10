// Chats Database Service - Uses Third Firebase (Realtime Database)
// Stores: Messages, Chat metadata, Chat status
// Uses same Auth UID as primary Firebase for sync

import {
  thirdDatabase,
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
} from './firebaseThird';

// Chat statuses
export const CHAT_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  DELETED: 'deleted'
};

/**
 * Generate a consistent chat ID for two users
 * @param {string} userId1 - First user's ID
 * @param {string} userId2 - Second user's ID
 */
export const generateChatId = (userId1, userId2) => {
  // Sort IDs to ensure consistent chat ID regardless of who initiates
  return [userId1, userId2].sort().join('_');
};

/**
 * Create or get existing chat between two users
 * @param {string} currentUserId - Current user's ID
 * @param {string} otherUserId - Other user's ID
 */
export const getOrCreateChat = async (currentUserId, otherUserId) => {
  try {
    if (!thirdDatabase) {
      console.error('Third database not initialized');
      throw new Error('Database not available');
    }
    
    const chatId = generateChatId(currentUserId, otherUserId);
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const snapshot = await get(chatRef);
    
    if (snapshot.exists()) {
      return { id: chatId, ...snapshot.val() };
    }
    
    // Create new chat
    const newChat = {
      participants: [currentUserId, otherUserId],
      createdAt: new Date().toISOString(),
      lastMessage: null,
      status: CHAT_STATUS.ACTIVE,
      autoDelete: false, // Auto-delete disabled by default
      autoDeleteHours: 24
    };
    
    await set(chatRef, newChat);
    
    // Add to both users' chat lists
    await updateUserChatList(currentUserId, chatId, otherUserId, null);
    await updateUserChatList(otherUserId, chatId, currentUserId, null);
    
    return { id: chatId, ...newChat };
  } catch (error) {
    console.error('Error getting/creating chat:', error);
    throw error;
  }
};

/**
 * Update user's chat list entry
 */
const updateUserChatList = async (userId, chatId, otherUserId, lastMessage) => {
  try {
    if (!thirdDatabase) return;
    
    const userChatRef = ref(thirdDatabase, `userChats/${userId}/${chatId}`);
    await set(userChatRef, {
      otherUser: otherUserId,
      lastMessage: lastMessage?.text || '',
      lastMessageTime: lastMessage?.timestamp || new Date().toISOString(),
      unreadCount: 0,
      status: CHAT_STATUS.ACTIVE
    });
  } catch (error) {
    console.error('Error updating user chat list:', error);
  }
};

/**
 * Send a message in a chat
 * @param {string} chatId - Chat ID
 * @param {string} senderId - Sender's user ID
 * @param {string} text - Message text
 */
export const sendMessage = async (chatId, senderId, text) => {
  try {
    if (!thirdDatabase) {
      console.error('Third database not initialized');
      throw new Error('Database not available');
    }
    
    const timestamp = new Date().toISOString();
    
    // Add message
    const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
    const newMessageRef = push(messagesRef);
    const message = {
      text: text.trim(),
      sender: senderId,
      timestamp,
      read: false,
      status: 'sent' // Add message status
    };
    await set(newMessageRef, message);
    
    // Update chat's last message
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, {
      lastMessage: {
        text: text.trim(),
        sender: senderId,
        timestamp
      }
    });
    
    // Get chat to find other participant
    const chatSnap = await get(chatRef);
    if (chatSnap.exists()) {
      const chat = chatSnap.val();
      const otherUserId = chat.participants.find(p => p !== senderId);
      
      // Update both users' chat lists
      await updateUserChatListAfterMessage(senderId, chatId, otherUserId, message);
      await updateUserChatListAfterMessage(otherUserId, chatId, senderId, message, true);
    }
    
    return { id: newMessageRef.key, ...message };
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
};

/**
 * Update user chat list after message
 */
const updateUserChatListAfterMessage = async (userId, chatId, otherUserId, message, incrementUnread = false) => {
  try {
    const userChatRef = ref(thirdDatabase, `userChats/${userId}/${chatId}`);
    const snapshot = await get(userChatRef);
    
    const currentData = snapshot.exists() ? snapshot.val() : { unreadCount: 0 };
    
    await update(userChatRef, {
      otherUser: otherUserId,
      lastMessage: message.text,
      lastMessageTime: message.timestamp,
      unreadCount: incrementUnread ? (currentData.unreadCount || 0) + 1 : 0,
      status: CHAT_STATUS.ACTIVE
    });
  } catch (error) {
    console.error('Error updating chat list after message:', error);
  }
};

/**
 * Get all messages for a chat
 * @param {string} chatId - Chat ID
 * @param {number} limit - Max messages to fetch
 */
export const getMessages = async (chatId, limit = 100) => {
  try {
    const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
    const messagesQuery = query(messagesRef, orderByChild('timestamp'), limitToLast(limit));
    const snapshot = await get(messagesQuery);
    
    if (!snapshot.exists()) return [];
    
    const messages = snapshot.val();
    return Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (error) {
    console.error('Error getting messages:', error);
    return [];
  }
};

/**
 * Subscribe to messages in a chat (real-time)
 * @param {string} chatId - Chat ID
 * @param {Function} callback - Callback with messages array
 */
export const subscribeToMessages = (chatId, callback) => {
  const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
  
  const handleMessages = (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }
    
    const messages = snapshot.val();
    const messagesList = Object.entries(messages)
      .map(([id, msg]) => ({ id, ...msg }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    callback(messagesList);
  };
  
  onValue(messagesRef, handleMessages);
  
  return () => off(messagesRef);
};

/**
 * Get user's chat list
 * @param {string} userId - User's ID
 */
export const getUserChats = async (userId) => {
  try {
    const userChatsRef = ref(thirdDatabase, `userChats/${userId}`);
    const snapshot = await get(userChatsRef);
    
    if (!snapshot.exists()) return [];
    
    const chats = snapshot.val();
    return Object.entries(chats)
      .filter(([, chat]) => chat.status !== CHAT_STATUS.DELETED)
      .map(([chatId, chat]) => ({
        chatId,
        ...chat
      }))
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  } catch (error) {
    console.error('Error getting user chats:', error);
    return [];
  }
};

/**
 * Subscribe to user's chat list (real-time)
 * @param {string} userId - User's ID
 * @param {Function} callback - Callback with chats array
 */
export const subscribeToUserChats = (userId, callback) => {
  const userChatsRef = ref(thirdDatabase, `userChats/${userId}`);
  
  const handleChats = (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }
    
    const chats = snapshot.val();
    const chatsList = Object.entries(chats)
      .filter(([, chat]) => chat.status !== CHAT_STATUS.DELETED)
      .map(([chatId, chat]) => ({
        chatId,
        ...chat
      }))
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    
    callback(chatsList);
  };
  
  onValue(userChatsRef, handleChats);
  
  return () => off(userChatsRef);
};

/**
 * Mark messages as read
 * @param {string} chatId - Chat ID
 * @param {string} userId - User marking as read
 */
export const markMessagesAsRead = async (chatId, userId) => {
  try {
    // Reset unread count in user's chat list
    const userChatRef = ref(thirdDatabase, `userChats/${userId}/${chatId}`);
    await update(userChatRef, { unreadCount: 0 });
    
    // Mark all messages as read (optional - could be expensive for large chats)
    // For now, just update the unread count
  } catch (error) {
    console.error('Error marking messages as read:', error);
  }
};

/**
 * Block chat (when unfollowed)
 * @param {string} chatId - Chat ID
 */
export const blockChat = async (chatId) => {
  try {
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, { status: CHAT_STATUS.BLOCKED });
    
    // Update both users' chat lists
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const chat = snapshot.val();
      for (const participantId of chat.participants) {
        const userChatRef = ref(thirdDatabase, `userChats/${participantId}/${chatId}`);
        await update(userChatRef, { status: CHAT_STATUS.BLOCKED });
      }
    }
  } catch (error) {
    console.error('Error blocking chat:', error);
    throw error;
  }
};

/**
 * Unblock chat (when re-friended)
 * @param {string} chatId - Chat ID
 */
export const unblockChat = async (chatId) => {
  try {
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, { status: CHAT_STATUS.ACTIVE });
    
    // Update both users' chat lists
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const chat = snapshot.val();
      for (const participantId of chat.participants) {
        const userChatRef = ref(thirdDatabase, `userChats/${participantId}/${chatId}`);
        await update(userChatRef, { status: CHAT_STATUS.ACTIVE });
      }
    }
  } catch (error) {
    console.error('Error unblocking chat:', error);
    throw error;
  }
};

/**
 * Delete entire chat for both users
 * @param {string} chatId - Chat ID
 */
export const deleteChat = async (chatId) => {
  try {
    // Get chat participants first
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const chatSnap = await get(chatRef);
    
    if (!chatSnap.exists()) {
      throw new Error('Chat not found');
    }
    
    const chat = chatSnap.val();
    
    // Delete messages
    const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
    await remove(messagesRef);
    
    // Delete chat metadata
    await remove(chatRef);
    
    // Remove from both users' chat lists
    for (const participantId of chat.participants) {
      const userChatRef = ref(thirdDatabase, `userChats/${participantId}/${chatId}`);
      await remove(userChatRef);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting chat:', error);
    throw error;
  }
};

/**
 * Get chat status
 * @param {string} chatId - Chat ID
 */
export const getChatStatus = async (chatId) => {
  try {
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const snapshot = await get(chatRef);
    
    if (!snapshot.exists()) return null;
    
    return snapshot.val().status;
  } catch (error) {
    console.error('Error getting chat status:', error);
    return null;
  }
};

/**
 * Get total unread message count for a user
 * @param {string} userId - User's ID
 */
export const getTotalUnreadCount = async (userId) => {
  try {
    const chats = await getUserChats(userId);
    return chats.reduce((total, chat) => total + (chat.unreadCount || 0), 0);
  } catch (error) {
    console.error('Error getting unread count:', error);
    return 0;
  }
};

/**
 * Subscribe to total unread count (real-time)
 * @param {string} userId - User's ID
 * @param {Function} callback - Callback with count
 */
export const subscribeToUnreadCount = (userId, callback) => {
  const userChatsRef = ref(thirdDatabase, `userChats/${userId}`);
  
  const handleChats = (snapshot) => {
    if (!snapshot.exists()) {
      callback(0);
      return;
    }
    
    const chats = snapshot.val();
    const total = Object.values(chats)
      .filter(chat => chat.status !== CHAT_STATUS.DELETED)
      .reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
    
    callback(total);
  };
  
  onValue(userChatsRef, handleChats);
  
  return () => off(userChatsRef);
};

/**
 * Get chats with user details
 * @param {string} userId - User's ID
 */
export const getChatsWithUserDetails = async (userId) => {
  try {
    const chats = await getUserChats(userId);
    if (chats.length === 0) return [];
    
    // Get user details from primary database
    const { database, ref: primaryRef, get: primaryGet } = await import('./firebase');
    
    const chatsWithDetails = await Promise.all(
      chats.map(async (chat) => {
        try {
          if (!chat.otherUser) {
            console.warn('Chat missing otherUser:', chat);
            return { ...chat, otherUserDetails: null };
          }
          
          const userRef = primaryRef(database, `users/${chat.otherUser}`);
          const userSnap = await primaryGet(userRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.val();
            return {
              ...chat,
              otherUserDetails: {
                id: chat.otherUser,
                username: userData.username || 'Unknown',
                email: userData.email || '',
                photo_url: userData.photo_url || '',
                verified: userData.verified || false
              }
            };
          }
          
          // User not found, return with null details
          console.warn('User not found for chat:', chat.otherUser);
          return { ...chat, otherUserDetails: null };
        } catch (err) {
          console.error('Error fetching user for chat:', err);
          return { ...chat, otherUserDetails: null };
        }
      })
    );
    
    return chatsWithDetails;
  } catch (error) {
    console.error('Error getting chats with details:', error);
    return [];
  }
};

/**
 * Search chats by username
 * @param {string} userId - User's ID
 * @param {string} searchQuery - Search term
 */
export const searchChats = async (userId, searchQuery) => {
  try {
    const chats = await getChatsWithUserDetails(userId);
    const query = searchQuery.toLowerCase().trim();
    
    return chats.filter(chat =>
      chat.otherUserDetails?.username?.toLowerCase().includes(query) ||
      chat.lastMessage?.toLowerCase().includes(query)
    );
  } catch (error) {
    console.error('Error searching chats:', error);
    return [];
  }
};

/**
 * Toggle auto-delete setting for a chat
 * @param {string} chatId - Chat ID
 * @param {boolean} enabled - Enable or disable auto-delete
 */
export const toggleAutoDelete = async (chatId, enabled) => {
  try {
    if (!thirdDatabase) {
      throw new Error('Database not available');
    }
    
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, {
      autoDelete: enabled,
      autoDeleteHours: 24,
      autoDeleteEnabledAt: enabled ? new Date().toISOString() : null
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error toggling auto-delete:', error);
    throw error;
  }
};

/**
 * Get chat settings including auto-delete status
 * @param {string} chatId - Chat ID
 */
export const getChatSettings = async (chatId) => {
  try {
    if (!thirdDatabase) return null;
    
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const snapshot = await get(chatRef);
    
    if (!snapshot.exists()) return null;
    
    const chat = snapshot.val();
    return {
      autoDelete: chat.autoDelete || false,
      autoDeleteHours: chat.autoDeleteHours || 24,
      autoDeleteEnabledAt: chat.autoDeleteEnabledAt || null,
      status: chat.status,
      blockedBy: chat.blockedBy || null
    };
  } catch (error) {
    console.error('Error getting chat settings:', error);
    return null;
  }
};

/**
 * Delete old messages (for auto-delete feature)
 * @param {string} chatId - Chat ID
 * @param {number} hoursOld - Delete messages older than this many hours
 */
export const deleteOldMessages = async (chatId, hoursOld = 24) => {
  try {
    if (!thirdDatabase) return { deleted: 0 };
    
    const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
    const snapshot = await get(messagesRef);
    
    if (!snapshot.exists()) return { deleted: 0 };
    
    const messages = snapshot.val();
    const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000).toISOString();
    let deletedCount = 0;
    
    const deletePromises = Object.entries(messages)
      .filter(([, msg]) => msg.timestamp < cutoffTime)
      .map(async ([id]) => {
        const msgRef = ref(thirdDatabase, `messages/${chatId}/${id}`);
        await remove(msgRef);
        deletedCount++;
      });
    
    await Promise.all(deletePromises);
    
    return { deleted: deletedCount };
  } catch (error) {
    console.error('Error deleting old messages:', error);
    return { deleted: 0 };
  }
};

/**
 * Block chat with information about who blocked
 * @param {string} chatId - Chat ID
 * @param {string} blockedByUserId - User who initiated the block
 */
export const blockChatWithInfo = async (chatId, blockedByUserId) => {
  try {
    if (!thirdDatabase) return;
    
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, { 
      status: CHAT_STATUS.BLOCKED,
      blockedBy: blockedByUserId,
      blockedAt: new Date().toISOString()
    });
    
    // Update both users' chat lists
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const chat = snapshot.val();
      for (const participantId of chat.participants) {
        const userChatRef = ref(thirdDatabase, `userChats/${participantId}/${chatId}`);
        await update(userChatRef, { 
          status: CHAT_STATUS.BLOCKED,
          blockedBy: blockedByUserId
        });
      }
    }
  } catch (error) {
    console.error('Error blocking chat:', error);
    throw error;
  }
};

/**
 * Get who blocked the chat
 * @param {string} chatId - Chat ID
 */
export const getBlockedByInfo = async (chatId) => {
  try {
    if (!thirdDatabase) return null;
    
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const snapshot = await get(chatRef);
    
    if (!snapshot.exists()) return null;
    
    const chat = snapshot.val();
    return {
      blockedBy: chat.blockedBy || null,
      blockedAt: chat.blockedAt || null
    };
  } catch (error) {
    console.error('Error getting blocked info:', error);
    return null;
  }
};


/**
 * Delete a message for the current user only (local delete)
 * @param {string} chatId - Chat ID
 * @param {string} messageId - Message ID
 * @param {string} userId - Current user's ID
 */
export const deleteMessageForMe = async (chatId, messageId, userId) => {
  try {
    if (!thirdDatabase) throw new Error('Database not available');
    
    // Store in user's deleted messages list
    const deletedRef = ref(thirdDatabase, `deletedMessages/${userId}/${chatId}/${messageId}`);
    await set(deletedRef, {
      deletedAt: new Date().toISOString()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting message for me:', error);
    throw error;
  }
};

/**
 * Delete a message for everyone (mark as deleted)
 * @param {string} chatId - Chat ID
 * @param {string} messageId - Message ID
 * @param {string} userId - Current user's ID (must be sender)
 */
export const deleteMessageForEveryone = async (chatId, messageId, userId) => {
  try {
    if (!thirdDatabase) throw new Error('Database not available');
    
    // Get the message first to verify sender
    const messageRef = ref(thirdDatabase, `messages/${chatId}/${messageId}`);
    const snapshot = await get(messageRef);
    
    if (!snapshot.exists()) throw new Error('Message not found');
    
    const message = snapshot.val();
    if (message.sender !== userId) throw new Error('Only sender can delete for everyone');
    
    const deletedText = 'This message was deleted';
    
    // Update message to show as deleted
    await update(messageRef, {
      deleted: true,
      deletedAt: new Date().toISOString(),
      text: deletedText
    });
    
    // Update chat's lastMessage if this was the last message
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    const chatSnap = await get(chatRef);
    if (chatSnap.exists()) {
      const chat = chatSnap.val();
      // Check if deleted message was the last message
      if (chat.lastMessage?.text === message.text && chat.lastMessage?.timestamp === message.timestamp) {
        await update(chatRef, {
          lastMessage: { text: deletedText, sender: message.sender, timestamp: message.timestamp }
        });
        
        // Update both users' chat lists
        for (const participantId of chat.participants) {
          const userChatRef = ref(thirdDatabase, `userChats/${participantId}/${chatId}`);
          await update(userChatRef, { lastMessage: deletedText });
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting message for everyone:', error);
    throw error;
  }
};

/**
 * Get user's deleted messages for a chat
 * @param {string} userId - User's ID
 * @param {string} chatId - Chat ID
 */
export const getDeletedMessages = async (userId, chatId) => {
  try {
    if (!thirdDatabase) return [];
    
    const deletedRef = ref(thirdDatabase, `deletedMessages/${userId}/${chatId}`);
    const snapshot = await get(deletedRef);
    
    if (!snapshot.exists()) return [];
    
    return Object.keys(snapshot.val());
  } catch (error) {
    console.error('Error getting deleted messages:', error);
    return [];
  }
};

/**
 * Send a reply to a specific message
 * @param {string} chatId - Chat ID
 * @param {string} senderId - Sender's user ID
 * @param {string} text - Message text
 * @param {Object} replyTo - The message being replied to
 */
export const sendReplyMessage = async (chatId, senderId, text, replyTo) => {
  try {
    if (!thirdDatabase) throw new Error('Database not available');
    
    const timestamp = new Date().toISOString();
    
    // Add message with reply info
    const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
    const newMessageRef = push(messagesRef);
    const message = {
      text: text.trim(),
      sender: senderId,
      timestamp,
      read: false,
      status: 'sent',
      replyTo: {
        id: replyTo.id,
        text: replyTo.text?.substring(0, 100) || '', // Limit preview text
        sender: replyTo.sender
      }
    };
    await set(newMessageRef, message);
    
    // Update chat's last message
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, {
      lastMessage: {
        text: text.trim(),
        sender: senderId,
        timestamp
      }
    });
    
    // Get chat to find other participant
    const chatSnap = await get(chatRef);
    if (chatSnap.exists()) {
      const chat = chatSnap.val();
      const otherUserId = chat.participants.find(p => p !== senderId);
      
      // Update both users' chat lists
      await updateUserChatListAfterMessageInternal(senderId, chatId, otherUserId, message);
      await updateUserChatListAfterMessageInternal(otherUserId, chatId, senderId, message, true);
    }
    
    return { id: newMessageRef.key, ...message };
  } catch (error) {
    console.error('Error sending reply message:', error);
    throw error;
  }
};

// Internal helper for updating chat list after message
const updateUserChatListAfterMessageInternal = async (userId, chatId, otherUserId, message, incrementUnread = false) => {
  try {
    const userChatRef = ref(thirdDatabase, `userChats/${userId}/${chatId}`);
    const snapshot = await get(userChatRef);
    
    const currentData = snapshot.exists() ? snapshot.val() : { unreadCount: 0 };
    
    await update(userChatRef, {
      otherUser: otherUserId,
      lastMessage: message.text,
      lastMessageTime: message.timestamp,
      unreadCount: incrementUnread ? (currentData.unreadCount || 0) + 1 : 0,
      status: CHAT_STATUS.ACTIVE
    });
  } catch (error) {
    console.error('Error updating chat list after message:', error);
  }
};

/**
 * Report a user and restrict chat
 * @param {string} currentUserId - Current user's ID (reporter)
 * @param {string} reportedUserId - Reported user's ID
 * @param {string} chatId - Chat ID
 */
export const reportAndRestrictUser = async (currentUserId, reportedUserId, chatId) => {
  try {
    if (!thirdDatabase) throw new Error('Database not available');
    
    const timestamp = new Date().toISOString();
    
    // Store report
    const reportRef = ref(thirdDatabase, `reports/${currentUserId}_${reportedUserId}`);
    await set(reportRef, {
      reporter: currentUserId,
      reported: reportedUserId,
      chatId,
      timestamp,
      status: 'pending'
    });
    
    // Update chat status to restricted
    const chatRef = ref(thirdDatabase, `chats/${chatId}`);
    await update(chatRef, {
      status: 'restricted',
      restrictedBy: currentUserId,
      restrictedAt: timestamp
    });
    
    // Update both users' chat lists
    const userChatRef1 = ref(thirdDatabase, `userChats/${currentUserId}/${chatId}`);
    const userChatRef2 = ref(thirdDatabase, `userChats/${reportedUserId}/${chatId}`);
    
    await update(userChatRef1, { status: 'restricted' });
    await update(userChatRef2, { status: 'restricted' });
    
    return { success: true };
  } catch (error) {
    console.error('Error reporting user:', error);
    throw error;
  }
};

/**
 * Check if a user has been reported
 * @param {string} userId1 - First user's ID
 * @param {string} userId2 - Second user's ID
 */
export const isUserReported = async (userId1, userId2) => {
  try {
    if (!thirdDatabase) return false;
    
    const reportRef1 = ref(thirdDatabase, `reports/${userId1}_${userId2}`);
    const reportRef2 = ref(thirdDatabase, `reports/${userId2}_${userId1}`);
    
    const [snap1, snap2] = await Promise.all([get(reportRef1), get(reportRef2)]);
    
    return snap1.exists() || snap2.exists();
  } catch (error) {
    console.error('Error checking report status:', error);
    return false;
  }
};

/**
 * Run auto-delete for all chats that have it enabled
 * This should be called periodically or on app load
 */
export const runAutoDeleteCleanup = async () => {
  try {
    if (!thirdDatabase) return;
    
    const chatsRef = ref(thirdDatabase, 'chats');
    const snapshot = await get(chatsRef);
    
    if (!snapshot.exists()) return;
    
    const chats = snapshot.val();
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    for (const [chatId, chat] of Object.entries(chats)) {
      if (chat.autoDelete) {
        // Delete messages older than 24 hours
        const messagesRef = ref(thirdDatabase, `messages/${chatId}`);
        const messagesSnap = await get(messagesRef);
        
        if (messagesSnap.exists()) {
          const messages = messagesSnap.val();
          for (const [messageId, message] of Object.entries(messages)) {
            const messageDate = new Date(message.timestamp);
            if (messageDate < oneDayAgo && !message.deleted) {
              // Delete old message
              const messageRef = ref(thirdDatabase, `messages/${chatId}/${messageId}`);
              await remove(messageRef);
            }
          }
        }
        
        // Check if chat itself should be deleted (24h after last message)
        const lastMessageTime = new Date(chat.lastMessage?.timestamp || chat.createdAt);
        if (lastMessageTime < oneDayAgo) {
          // Delete the entire chat
          await deleteChat(chatId);
        }
      }
    }
  } catch (error) {
    console.error('Error running auto-delete cleanup:', error);
  }
};

