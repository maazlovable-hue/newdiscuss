// Fourth Firebase Project - Realtime Database for Group Chats
// This project stores: Groups, Group Messages, Join Requests, Group Members
// Shares the same Auth UID with primary Firebase for sync

import { initializeApp, getApps } from 'firebase/app';
import { 
  getDatabase, 
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
  equalTo,
  limitToLast,
  serverTimestamp
} from 'firebase/database';

// Fourth Firebase configuration (discuss-3c060) - GROUP CHATS
const fourthFirebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_FOURTH_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_FOURTH_AUTH_DOMAIN,
  databaseURL: process.env.REACT_APP_FIREBASE_FOURTH_DATABASE_URL,
  projectId: process.env.REACT_APP_FIREBASE_FOURTH_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_FOURTH_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_FOURTH_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_FOURTH_APP_ID,
  measurementId: process.env.REACT_APP_FIREBASE_FOURTH_MEASUREMENT_ID
};

// Initialize fourth app with unique name
let fourthApp = null;
let fourthDatabase = null;
let initError = null;

try {
  fourthApp = getApps().find(app => app.name === 'groupChatDb') 
    || initializeApp(fourthFirebaseConfig, 'groupChatDb');
  
  // Get Realtime Database instance from fourth app
  fourthDatabase = getDatabase(fourthApp);
  console.log('Fourth Firebase (Group Chats) initialized successfully');
} catch (error) {
  console.warn('Failed to initialize fourth Firebase:', error.message);
  initError = error;
}

// Helper to check if fourth database is available
export const isFourthDbAvailable = () => {
  return fourthDatabase !== null && initError === null;
};

export { 
  fourthApp,
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
  equalTo,
  limitToLast,
  serverTimestamp
};

export default fourthApp;
