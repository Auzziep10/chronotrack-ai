import React, { createContext, useState, useEffect, useContext } from 'react';
import { User, UserSession } from '../types';
import { 
  firebaseSilentAuth, 
  isFirebaseConfigured, 
  firebaseGetUsers, 
  subscribeToActiveSessions,
  subscribeToSettings
} from '../services/firebaseService';

interface AuthContextType {
  currentUser: User | null;
  activeSession: UserSession | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  users: User[];
  appSettings: any;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  activeSession: null,
  login: async () => false,
  logout: () => {},
  isLoading: true,
  users: [],
  appSettings: null
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeSession, setActiveSession] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [appSettings, setAppSettings] = useState<any>(null);

  useEffect(() => {
    const init = async () => {
      if (isFirebaseConfigured()) {
        await firebaseSilentAuth();
        try {
          const fetchedUsers = await firebaseGetUsers();
          setUsers(fetchedUsers);
        } catch (e) {
          console.error("Failed to fetch users:", e);
        }
      }
      setIsLoading(false);
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
  };

  return (
    <AuthContext.Provider value={{ currentUser, activeSession, login, logout, isLoading, users, appSettings }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
