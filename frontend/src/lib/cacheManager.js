// Cache Manager - IndexedDB for Performance Optimization
// Caches: Posts, Users, Friends, Chats, Groups for faster loading

import { openDB } from 'idb';

const DB_NAME = 'discuss_cache';
const DB_VERSION = 4;

// Cache duration constants (in milliseconds)
export const CACHE_DURATION = {
  POSTS: 5 * 60 * 1000,       // 5 minutes
  USERS: 10 * 60 * 1000,      // 10 minutes
  FRIENDS: 2 * 60 * 1000,     // 2 minutes
  CHATS: 1 * 60 * 1000,       // 1 minute
  PROFILE: 15 * 60 * 1000,    // 15 minutes
  COMMENTS: 3 * 60 * 1000,    // 3 minutes
  GROUPS: 1 * 60 * 1000,      // 1 minute
  GROUP_MESSAGES: 1 * 60 * 1000  // 1 minute
};

/**
 * Initialize IndexedDB
 */
const getDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Posts store
      if (!db.objectStoreNames.contains('posts')) {
        const postsStore = db.createObjectStore('posts', { keyPath: 'id' });
        postsStore.createIndex('timestamp', 'timestamp');
        postsStore.createIndex('author_id', 'author_id');
      }
      
      // Users store
      if (!db.objectStoreNames.contains('users')) {
        const usersStore = db.createObjectStore('users', { keyPath: 'id' });
        usersStore.createIndex('username', 'username');
      }
      
      // Friends store
      if (!db.objectStoreNames.contains('friends')) {
        db.createObjectStore('friends', { keyPath: 'id' });
      }
      
      // Chats store
      if (!db.objectStoreNames.contains('chats')) {
        const chatsStore = db.createObjectStore('chats', { keyPath: 'chatId' });
        chatsStore.createIndex('lastMessageTime', 'lastMessageTime');
      }
      
      // Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const messagesStore = db.createObjectStore('messages', { keyPath: 'id' });
        messagesStore.createIndex('chatId', 'chatId');
        messagesStore.createIndex('timestamp', 'timestamp');
      }
      
      // General cache store for metadata
      if (!db.objectStoreNames.contains('cache_meta')) {
        db.createObjectStore('cache_meta', { keyPath: 'key' });
      }
      
      // Comments store - added in version 3
      if (!db.objectStoreNames.contains('comments')) {
        const commentsStore = db.createObjectStore('comments', { keyPath: 'cacheKey' });
        commentsStore.createIndex('postId', 'postId');
        commentsStore.createIndex('timestamp', 'timestamp');
      }
      
      // Groups store - added in version 4
      if (!db.objectStoreNames.contains('groups')) {
        const groupsStore = db.createObjectStore('groups', { keyPath: 'groupId' });
        groupsStore.createIndex('lastMessageTime', 'lastMessageTime');
      }
      
      // Group messages store - added in version 4
      if (!db.objectStoreNames.contains('group_messages')) {
        const groupMessagesStore = db.createObjectStore('group_messages', { keyPath: 'id' });
        groupMessagesStore.createIndex('groupId', 'groupId');
        groupMessagesStore.createIndex('timestamp', 'timestamp');
      }
    },
  });
};

// ==================== CACHE METADATA ====================

/**
 * Set cache timestamp
 */
export const setCacheTimestamp = async (key) => {
  try {
    const db = await getDB();
    await db.put('cache_meta', { key, timestamp: Date.now() });
  } catch (e) {
    console.warn('Cache timestamp write failed:', e);
  }
};

/**
 * Check if cache is valid (not expired)
 */
export const isCacheValid = async (key, maxAge) => {
  try {
    const db = await getDB();
    const meta = await db.get('cache_meta', key);
    if (!meta) return false;
    return Date.now() - meta.timestamp < maxAge;
  } catch (e) {
    console.warn('Cache validity check failed:', e);
    return false;
  }
};

/**
 * Get last cache timestamp
 */
export const getLastCacheTime = async (key) => {
  try {
    const db = await getDB();
    const meta = await db.get('cache_meta', key);
    return meta?.timestamp || 0;
  } catch (e) {
    return 0;
  }
};

// ==================== POSTS CACHE ====================

/**
 * Cache all posts
 */
export const cachePosts = async (posts) => {
  try {
    const db = await getDB();
    const tx = db.transaction('posts', 'readwrite');
    
    // Clear existing posts
    await tx.store.clear();
    
    // Add all posts
    for (const post of posts) {
      await tx.store.put(post);
    }
    
    await tx.done;
    await setCacheTimestamp('posts');
  } catch (e) {
    console.warn('Posts cache write failed:', e);
  }
};

/**
 * Get cached posts
 */
export const getCachedPosts = async () => {
  try {
    const db = await getDB();
    const posts = await db.getAll('posts');
    return posts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (e) {
    console.warn('Posts cache read failed:', e);
    return null;
  }
};

/**
 * Update single post in cache
 */
export const updateCachedPost = async (post) => {
  try {
    const db = await getDB();
    await db.put('posts', post);
  } catch (e) {
    console.warn('Post cache update failed:', e);
  }
};

/**
 * Remove post from cache
 */
export const removeCachedPost = async (postId) => {
  try {
    const db = await getDB();
    await db.delete('posts', postId);
  } catch (e) {
    console.warn('Post cache delete failed:', e);
  }
};

// ==================== USERS CACHE ====================

/**
 * Cache users
 */
export const cacheUsers = async (users) => {
  try {
    const db = await getDB();
    const tx = db.transaction('users', 'readwrite');
    
    for (const user of users) {
      await tx.store.put(user);
    }
    
    await tx.done;
    await setCacheTimestamp('users');
  } catch (e) {
    console.warn('Users cache write failed:', e);
  }
};

/**
 * Get all cached users
 */
export const getCachedUsers = async () => {
  try {
    const db = await getDB();
    return await db.getAll('users');
  } catch (e) {
    console.warn('Users cache read failed:', e);
    return null;
  }
};

/**
 * Get single cached user
 */
export const getCachedUser = async (userId) => {
  try {
    const db = await getDB();
    return await db.get('users', userId);
  } catch (e) {
    return null;
  }
};

/**
 * Update single user in cache
 */
export const updateCachedUser = async (user) => {
  try {
    const db = await getDB();
    await db.put('users', user);
  } catch (e) {
    console.warn('User cache update failed:', e);
  }
};

// ==================== FRIENDS CACHE ====================

/**
 * Cache friends list
 */
export const cacheFriends = async (userId, friends) => {
  try {
    const db = await getDB();
    await db.put('friends', { id: userId, friends, timestamp: Date.now() });
  } catch (e) {
    console.warn('Friends cache write failed:', e);
  }
};

/**
 * Get cached friends
 */
export const getCachedFriends = async (userId) => {
  try {
    const db = await getDB();
    const data = await db.get('friends', userId);
    if (!data) return null;
    
    // Check if cache is still valid
    if (Date.now() - data.timestamp > CACHE_DURATION.FRIENDS) {
      return null; // Expired
    }
    
    return data.friends;
  } catch (e) {
    console.warn('Friends cache read failed:', e);
    return null;
  }
};

// ==================== CHATS CACHE ====================

/**
 * Cache user's chats
 */
export const cacheChats = async (userId, chats) => {
  try {
    const db = await getDB();
    const tx = db.transaction('chats', 'readwrite');
    
    // Clear existing chats for this user (we store with composite key)
    const allChats = await tx.store.getAll();
    for (const chat of allChats) {
      if (chat.userId === userId) {
        await tx.store.delete(chat.chatId);
      }
    }
    
    // Add new chats
    for (const chat of chats) {
      await tx.store.put({ ...chat, userId });
    }
    
    await tx.done;
    await setCacheTimestamp(`chats_${userId}`);
  } catch (e) {
    console.warn('Chats cache write failed:', e);
  }
};

/**
 * Get cached chats
 */
export const getCachedChats = async (userId) => {
  try {
    const isValid = await isCacheValid(`chats_${userId}`, CACHE_DURATION.CHATS);
    if (!isValid) return null;
    
    const db = await getDB();
    const allChats = await db.getAll('chats');
    return allChats
      .filter(chat => chat.userId === userId)
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  } catch (e) {
    console.warn('Chats cache read failed:', e);
    return null;
  }
};

// ==================== MESSAGES CACHE ====================

/**
 * Cache messages for a chat
 */
export const cacheMessages = async (chatId, messages) => {
  try {
    const db = await getDB();
    const tx = db.transaction('messages', 'readwrite');
    
    // Add/update messages
    for (const message of messages) {
      await tx.store.put({ ...message, chatId });
    }
    
    await tx.done;
    await setCacheTimestamp(`messages_${chatId}`);
  } catch (e) {
    console.warn('Messages cache write failed:', e);
  }
};

/**
 * Get cached messages
 */
export const getCachedMessages = async (chatId) => {
  try {
    const db = await getDB();
    const index = db.transaction('messages').store.index('chatId');
    const messages = await index.getAll(chatId);
    return messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (e) {
    console.warn('Messages cache read failed:', e);
    return null;
  }
};

/**
 * Add single message to cache
 */
export const addCachedMessage = async (chatId, message) => {
  try {
    const db = await getDB();
    await db.put('messages', { ...message, chatId });
  } catch (e) {
    console.warn('Message cache add failed:', e);
  }
};

// ==================== COMMENTS CACHE ====================

/**
 * Cache comments for a post
 */
export const cacheComments = async (postId, comments) => {
  try {
    const db = await getDB();
    await db.put('comments', { 
      cacheKey: postId, 
      postId,
      comments, 
      timestamp: Date.now() 
    });
  } catch (e) {
    console.warn('Comments cache write failed:', e);
  }
};

/**
 * Get cached comments
 */
export const getCachedComments = async (postId) => {
  try {
    const db = await getDB();
    const data = await db.get('comments', postId);
    if (!data) return null;
    
    // Check if cache is still valid
    if (Date.now() - data.timestamp > CACHE_DURATION.COMMENTS) {
      return null; // Expired
    }
    
    return data.comments;
  } catch (e) {
    console.warn('Comments cache read failed:', e);
    return null;
  }
};

/**
 * Add single comment to cache
 */
export const addCachedComment = async (postId, comment) => {
  try {
    const cachedComments = await getCachedComments(postId);
    if (cachedComments) {
      const updatedComments = [...cachedComments, comment];
      await cacheComments(postId, updatedComments);
    }
  } catch (e) {
    console.warn('Add comment to cache failed:', e);
  }
};

/**
 * Remove comment from cache
 */
export const removeCachedComment = async (postId, commentId) => {
  try {
    const cachedComments = await getCachedComments(postId);
    if (cachedComments) {
      const updatedComments = cachedComments.filter(c => c.id !== commentId);
      await cacheComments(postId, updatedComments);
    }
  } catch (e) {
    console.warn('Remove comment from cache failed:', e);
  }
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Clear all cache
 */
export const clearAllCache = async () => {
  try {
    const db = await getDB();
    await db.clear('posts');
    await db.clear('users');
    await db.clear('friends');
    await db.clear('chats');
    await db.clear('messages');
    await db.clear('comments');
    await db.clear('cache_meta');
    console.log('All cache cleared');
  } catch (e) {
    console.warn('Cache clear failed:', e);
  }
};

/**
 * Clear specific cache
 */
export const clearCache = async (storeName) => {
  try {
    const db = await getDB();
    await db.clear(storeName);
  } catch (e) {
    console.warn(`Cache clear failed for ${storeName}:`, e);
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
  try {
    const db = await getDB();
    const stats = {
      posts: (await db.count('posts')),
      users: (await db.count('users')),
      friends: (await db.count('friends')),
      chats: (await db.count('chats')),
      messages: (await db.count('messages'))
    };
    return stats;
  } catch (e) {
    return null;
  }
};

/**
 * Smart fetch with cache - returns cached data immediately, then fetches fresh data
 * @param {string} cacheKey - Cache key
 * @param {Function} getCached - Function to get cached data
 * @param {Function} fetchFresh - Function to fetch fresh data
 * @param {Function} cacheData - Function to cache data
 * @param {number} maxAge - Cache max age
 * @param {Function} onData - Callback when data is available
 */
export const smartFetch = async (cacheKey, getCached, fetchFresh, cacheData, maxAge, onData) => {
  // First, try to get cached data
  const cachedData = await getCached();
  if (cachedData) {
    onData(cachedData, true); // true = from cache
  }
  
  // Check if cache is still valid
  const isValid = await isCacheValid(cacheKey, maxAge);
  
  // If cache is expired or doesn't exist, fetch fresh data
  if (!isValid || !cachedData) {
    try {
      const freshData = await fetchFresh();
      await cacheData(freshData);
      onData(freshData, false); // false = from network
    } catch (error) {
      console.error('Fresh fetch failed:', error);
      // If we have cached data, we already showed it
      if (!cachedData) {
        throw error;
      }
    }
  }
};


// ==================== GROUPS CACHE ====================

/**
 * Cache groups for a user
 * @param {string} userId - User ID
 * @param {Array} groups - Groups array
 */
export const cacheGroups = async (userId, groups) => {
  try {
    const db = await getDB();
    const tx = db.transaction('groups', 'readwrite');
    
    // Clear old groups for this user
    const store = tx.objectStore('groups');
    const allGroups = await store.getAll();
    for (const group of allGroups) {
      if (group.userId === userId) {
        await store.delete(group.groupId);
      }
    }
    
    // Add new groups
    for (const group of groups) {
      await store.put({ ...group, userId, cachedAt: Date.now() });
    }
    
    await tx.done;
    await setCacheTimestamp(`groups_${userId}`);
  } catch (e) {
    console.warn('Groups cache write failed:', e);
  }
};

/**
 * Get cached groups for a user
 * @param {string} userId - User ID
 */
export const getCachedGroups = async (userId) => {
  try {
    const isValid = await isCacheValid(`groups_${userId}`, CACHE_DURATION.GROUPS);
    if (!isValid) return null;
    
    const db = await getDB();
    const allGroups = await db.getAll('groups');
    const userGroups = allGroups.filter(g => g.userId === userId);
    
    return userGroups.length > 0 ? userGroups : null;
  } catch (e) {
    console.warn('Groups cache read failed:', e);
    return null;
  }
};

/**
 * Cache group messages
 * @param {string} groupId - Group ID
 * @param {Array} messages - Messages array
 */
export const cacheGroupMessages = async (groupId, messages) => {
  try {
    const db = await getDB();
    const tx = db.transaction('group_messages', 'readwrite');
    const store = tx.objectStore('group_messages');
    
    // Clear old messages for this group
    const index = store.index('groupId');
    const oldMessages = await index.getAll(groupId);
    for (const msg of oldMessages) {
      await store.delete(msg.id);
    }
    
    // Add new messages
    for (const message of messages) {
      await store.put({ ...message, groupId, cachedAt: Date.now() });
    }
    
    await tx.done;
    await setCacheTimestamp(`group_messages_${groupId}`);
  } catch (e) {
    console.warn('Group messages cache write failed:', e);
  }
};

/**
 * Get cached group messages
 * @param {string} groupId - Group ID
 */
export const getCachedGroupMessages = async (groupId) => {
  try {
    const isValid = await isCacheValid(`group_messages_${groupId}`, CACHE_DURATION.GROUP_MESSAGES);
    if (!isValid) return null;
    
    const db = await getDB();
    const index = db.transaction('group_messages').store.index('groupId');
    const messages = await index.getAll(groupId);
    
    return messages.length > 0 ? messages : null;
  } catch (e) {
    console.warn('Group messages cache read failed:', e);
    return null;
  }
};

/**
 * Clear groups cache for a user
 * @param {string} userId - User ID
 */
export const clearGroupsCache = async (userId) => {
  try {
    const db = await getDB();
    const store = db.transaction('groups', 'readwrite').store;
    const allGroups = await store.getAll();
    
    for (const group of allGroups) {
      if (group.userId === userId) {
        await store.delete(group.groupId);
      }
    }
  } catch (e) {
    console.warn('Clear groups cache failed:', e);
  }
};
