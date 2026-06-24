import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, UserSession } from '../types';
import { 
  firebaseSilentAuth, 
  isFirebaseConfigured, 
  firebaseGetUsers, 
  subscribeToActiveSessions,
  subscribeToSettings,
  subscribeToRecentMessages
} from '../services/firebaseService';

interface AuthContextType {
  currentUser: User | null;
  activeSession: UserSession | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  users: User[];
  appSettings: any;
  unreadCounts: Record<string, number>;
  unreadCount: number;
  markChannelAsRead: (channelId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  activeSession: null,
  login: async () => false,
  logout: () => {},
  isLoading: true,
  users: [],
  appSettings: null,
  unreadCounts: {},
  unreadCount: 0,
  markChannelAsRead: async () => {}
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSession, setActiveSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [appSettings, setAppSettings] = useState<any>(null);
  const [lastViewedTimes, setLastViewedTimes] = useState<Record<string, number>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [unreadCount, setUnreadCount] = useState(0);

  const markChannelAsRead = useCallback(async (channelId: string) => {
    const now = Date.now();
    setLastViewedTimes(prev => {
      if (prev[channelId] === now) return prev;
      return {
        ...prev,
        [channelId]: now
      };
    });
    setUnreadCounts(prev => {
      if (!prev[channelId]) return prev;
      const updated = { ...prev };
      delete updated[channelId];
      const total = Object.values(updated).reduce((sum, val) => sum + val, 0);
      setUnreadCount(total);
      return updated;
    });
    try {
      await AsyncStorage.setItem(`chrono_last_viewed_${channelId}`, String(now));
    } catch (e) {
      console.error("Failed to save last viewed time:", e);
    }
  }, []);

  useEffect(() => {
    const loadLastViewed = async () => {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const lastViewedKeys = keys.filter(k => k.startsWith('chrono_last_viewed_'));
        if (lastViewedKeys.length > 0) {
          const pairs = await AsyncStorage.multiGet(lastViewedKeys);
          const times: Record<string, number> = {};
          pairs.forEach(([key, val]) => {
            const channelId = key.replace('chrono_last_viewed_', '');
            times[channelId] = Number(val || '0');
          });
          setLastViewedTimes(times);
        }
      } catch (e) {
        console.error("Failed to load last viewed times:", e);
      }
    };
    if (currentUser) {
      loadLastViewed();
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !isFirebaseConfigured()) {
      setUnreadCounts({});
      setUnreadCount(0);
      return;
    }

    const unsubRecent = subscribeToRecentMessages((recentMsgs) => {
      const counts: Record<string, number> = {};
      const isAdminOrManager = currentUser.role?.toLowerCase() === 'admin' || currentUser.role?.toLowerCase() === 'manager';

      recentMsgs.forEach(msg => {
        if (msg.senderId === currentUser.id) return;

        if (msg.channel.startsWith('dm-')) {
          const dmUserId = msg.channel.substring(3);
          if (!isAdminOrManager && dmUserId !== currentUser.id) {
            return;
          }
          
          // Exclude direct messages involving clients from unread count
          const dmUser = users.find(u => u.id === dmUserId);
          if (dmUser?.role?.toLowerCase()?.trim()?.includes('client')) {
            return;
          }
          const senderUser = users.find(u => u.id === msg.senderId);
          if (senderUser?.role?.toLowerCase()?.trim()?.includes('client')) {
            return;
          }
        }

        const lastViewed = lastViewedTimes[msg.channel] || 0;
        if (msg.timestamp > lastViewed) {
          counts[msg.channel] = (counts[msg.channel] || 0) + 1;
        }
      });

      setUnreadCounts(counts);
      const total = Object.values(counts).reduce((sum, val) => sum + val, 0);
      setUnreadCount(total);
    });

    return () => unsubRecent();
  }, [currentUser, lastViewedTimes, users]);

  useEffect(() => {
    const init = async () => {
      console.log("[AuthContext] init starting...");
      if (isFirebaseConfigured()) {
        console.log("[AuthContext] Configuring firebase silent auth...");
        await firebaseSilentAuth();
        console.log("[AuthContext] Silent auth complete. Fetching users...");
        try {
          const fetchedUsers = await firebaseGetUsers();
          console.log("[AuthContext] Fetched users count:", fetchedUsers.length);
          setUsers(fetchedUsers);
        } catch (e) {
          console.error("Failed to fetch users:", e);
        }
      }
      setIsLoading(false);
      console.log("[AuthContext] init complete. isLoading set to false.");
    };
    init();

    if (isFirebaseConfigured()) {
      const unsubSettings = subscribeToSettings((settings) => {
        setAppSettings(settings);
      });
      return () => unsubSettings();
    }
  }, []);

  // Listen to active sessions to keep current user's session synced
  useEffect(() => {
    if (!currentUser || !isFirebaseConfigured()) return;
    
    // Register for push notifications
    import('../services/notificationService').then(({ registerForPushNotificationsAsync }) => {
      registerForPushNotificationsAsync().then((token) => {
        if (token && currentUser.expoPushToken !== token) {
           import('firebase/firestore').then(({ doc, updateDoc }) => {
             import('../services/firebaseService').then(({ db }) => {
                const userRef = doc(db, 'users', currentUser.id);
                updateDoc(userRef, { expoPushToken: token }).catch(console.error);
                setCurrentUser(prev => prev ? { ...prev, expoPushToken: token } : null);
             });
           });
        }
      });
    });

    const unsubscribe = subscribeToActiveSessions((sessions) => {
      const mySession = sessions[currentUser.id];
      setActiveSession(mySession || null);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const login = async (pin: string): Promise<boolean> => {
    // Basic pin auth matching
    const match = users.find(u => u.pin === pin || (pin === '0000' && u.role === 'admin')); // 0000 backdoor for admin if pin forgotten
    if (match) {
      setCurrentUser(match);
      return true;
    }
    return false;
  };

  const logout = () => {
    setCurrentUser(null);
    setActiveSession(null);
    setLastViewedTimes({});
    setUnreadCounts({});
    setUnreadCount(0);
  };

  return (
    <AuthContext.Provider value={{ 
      currentUser, 
      activeSession, 
      login, 
      logout, 
      isLoading, 
      users, 
      appSettings,
      unreadCounts,
      unreadCount,
      markChannelAsRead
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
