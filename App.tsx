import React, { useState, useEffect, useRef } from 'react';
import { WorkLog, UserSession, User, AppSettings, DailyTimeCard, Department } from './types';
import { DEFAULT_USERS } from './constants';
import { WorkLogForm } from './components/WorkLogForm';
import { TimeStation } from './components/TimeStation';
import { ActivityTracker } from './components/ActivityTracker';
import { ActivityManager } from './components/ActivityManager';
import { PrintableForms } from './components/PrintableForms';
import { SettingsDialog } from './components/SettingsDialog';
import { LoginScreen } from './components/LoginScreen';
import { DailyPlanner } from './components/DailyPlanner';
import { TeamChat } from './components/TeamChat';
import { Radio, ClipboardList, BarChart4, Settings, LogOut, Calendar, Users, FileText, MessageSquare } from 'lucide-react';
import {
  subscribeToActiveSessions,
  subscribeToUsers,
  firebaseClockIn,
  firebaseClockOut,
  firebaseAddLog,
  firebaseDeleteLog,
  firebaseSaveUser,
  firebaseDeleteUser,
  firebaseGetUsers,
  isFirebaseConfigured,
  subscribeToShiftBlocks,
  firebasePauseSession,
  firebaseResumeSession,
  firebaseSilentAuth,
  subscribeToSettings,
  firebaseSaveSettings,
  firebaseSaveTimeCard,
  subscribeToRecentMessages
} from './services/firebaseService';

type Tab = 'station' | 'activity' | 'manager' | 'planner' | 'documents';

const App: React.FC = () => {
  // Global State: Auth Token (Session Persistence)
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem('chronoAuthToken');
  });

  // Global State: Current User (Session Persistence)
  const [currentUser, setCurrentUser] = useState<any | null>(() => {
    const saved = localStorage.getItem('chronoCurrentUser');
    return saved ? JSON.parse(saved) : null;
  });

  // Global State: Users (Initialize from localStorage or defaults)
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('chronoUsers');
    const initial = saved ? JSON.parse(saved) : DEFAULT_USERS;
    return initial.filter((u: any) => u.role?.trim().toLowerCase() !== 'client');
  });

  // Global State: Settings
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('chronoSettings');
    return saved ? JSON.parse(saved) : { payFrequency: 'Bi-Weekly', payPeriodStartDay: 'Monday' };
  });

  // Global State: Map of userId -> UserSession
  // Initialize from localStorage first, then Firebase will overwrite with fresh state if connected.
  // This prevents the optimistic local state from being wiped out upon reload if Firebase config is missing.
  const [activeSessions, setActiveSessions] = useState<Record<string, UserSession>>(() => {
    try {
      const saved = localStorage.getItem('chronoSessions');
      if (saved && saved !== '{}') {
        const parsed = JSON.parse(saved);
        if (Object.keys(parsed).length > 0) return parsed;
      }
    } catch (e) {
      console.warn('Failed to parse local chronoSessions:', e);
    }
    return {};
  });

  const [activeTab, setActiveTab] = useState<Tab>('station');
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Shift Blocks State (From Firebase)
  const [shiftBlocks, setShiftBlocks] = useState<any[]>([]);

  // Track when we last made a local user update (to avoid sync overwriting unsaved data)
  const lastUserUpdateRef = useRef<number>(0);

  // Authenticate silently before allowing any Firebase subscriptions
  const [isFirebaseAuthed, setIsFirebaseAuthed] = useState(false);

  useEffect(() => {
    if (isFirebaseConfigured()) {
      import('./services/firebaseService').then(mod => {
        mod.firebaseSilentAuth().then(() => setIsFirebaseAuthed(true)).catch(() => setIsFirebaseAuthed(true));
      });
    } else {
      setIsFirebaseAuthed(true);
    }
  }, []);

  const usersRef = useRef<User[]>(users);
  useEffect(() => { usersRef.current = users; }, [users]);

  // Ref to always-current active sessions list
  const activeSessionsRef = useRef<Record<string, UserSession>>(activeSessions);
  useEffect(() => { activeSessionsRef.current = activeSessions; }, [activeSessions]);

  // Daily Schedule State
  const [todaySchedule, setTodaySchedule] = useState<any>(null);

  // Persist state
  useEffect(() => {
    localStorage.setItem('chronoSessions', JSON.stringify(activeSessions));
  }, [activeSessions]);

  useEffect(() => {
    localStorage.setItem('chronoUsers', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('chronoSettings', JSON.stringify(appSettings));
  }, [appSettings]);

  // Fetch today's schedule when authenticated
  useEffect(() => {
    const initAuthenticatedData = async () => {
      if (!authToken) return;
      // Any standalone initialization can go here
    };

    initAuthenticatedData();
  }, [authToken]);

  // ─── FIREBASE REAL-TIME LISTENERS ────────────────────────────────────────────
  useEffect(() => {
    if (!authToken || !isFirebaseConfigured() || !isFirebaseAuthed) return;

    // 1. Real-time active sessions listener
    const unsubSessions = subscribeToActiveSessions((rawSessions) => {
      setActiveSessions(() => {
        const newSessions: Record<string, UserSession> = {};
        Object.entries(rawSessions).forEach(([userId, data]: [string, any]) => {
          // Try full user from our local list first
          const sessionUser = usersRef.current.find(u => String(u.id) === String(userId));

          // Fall back to data Firestore stored at clock-in time — fixes race condition
          // where user list isn't loaded yet but session data is already available
          const user: User = sessionUser || {
            id: userId,
            name: data.userName || 'Team Member',
            avatarInitials: data.avatarInitials || '??',
            role: data.role || 'Staff',
            primaryDepartment: data.primaryDepartment || 'Production',
            pin: '',
            availability: {} as any,
            lateDays: 0,
            correctionNotes: ''
          };

          newSessions[userId] = {
            userId,
            user,
            startTime: data.startTime,
            lastLogTime: data.lastLogTime,
            logs: data.logs || [],
            isPaused: data.isPaused || false,
            pauseReason: data.pauseReason || undefined,
            currentIdleStartTime: data.currentIdleStartTime || null,
            totalIdleTimeMs: data.totalIdleTimeMs || 0
          };
        });
        return newSessions;
      });
    });

    return () => {
      unsubSessions();
    };
  }, [authToken, isFirebaseAuthed]); // Add dependency to ensure mapping works when users list changes

  // 2. Real-time users listener — MUST run before login so new devices have the users list to authenticate against!
  useEffect(() => {
    if (!isFirebaseConfigured() || !isFirebaseAuthed) return;
    
    const unsubUsers = subscribeToUsers((firebaseUsers) => {
      if (firebaseUsers.length > 0) {
        // Merge: Firebase data wins for every field it has
        setUsers(prev => {
          const merged = firebaseUsers
            .filter(fu => fu.role?.trim().toLowerCase() !== 'client')
            .map(fu => {
              const local = prev.find(u => u.id === fu.id);
              return { ...local, ...fu };
            });
          return merged;
        });
      } else {
        // Firebase users collection empty — seed it from current users list (internal only)
        console.log('Firebase users empty — seeding from local list...');
        usersRef.current
          .filter(u => u.role?.trim().toLowerCase() !== 'client')
          .forEach(u => firebaseSaveUser(u).catch(() => { }));
      }
    });

    return () => {
      unsubUsers();
    };
  }, [isFirebaseAuthed]); 

  // 3. Real-time recent messages listener to track unreads (both Firebase & offline LocalStorage)
  useEffect(() => {
    if (!authToken) return;

    let latestMessages: any[] = [];

    const updateUnreadCount = (msgs: any[]) => {
      const unreadChannelsSet = new Set<string>();
      msgs.forEach(msg => {
        const lastViewed = Number(localStorage.getItem(`chrono_last_viewed_${msg.channel}`) || '0');
        if (msg.senderId !== currentUser?.id && msg.timestamp > lastViewed) {
          if (msg.channel.startsWith('dm-')) {
            const dmUserId = msg.channel.substring(3);
            const isAdminOrManager = currentUser?.role?.toLowerCase() === 'admin' || currentUser?.role?.toLowerCase() === 'manager';
            if (isAdminOrManager || dmUserId === currentUser?.id) {
              unreadChannelsSet.add(msg.channel);
            }
          } else {
            unreadChannelsSet.add(msg.channel);
          }
        }
      });
      setUnreadChatCount(unreadChannelsSet.size);
    };

    let unsub: (() => void) | undefined;

    if (isFirebaseConfigured() && isFirebaseAuthed) {
      unsub = subscribeToRecentMessages((recentMsgs) => {
        latestMessages = recentMsgs;
        updateUnreadCount(recentMsgs);
      });
    } else {
      // LocalStorage Fallback for unreads
      const checkLocalUnreads = () => {
        const channelsList = ['general', 'announcements', 'shift-swap', 'random'];
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(k => {
          if (k.startsWith('chrono_local_chat_')) {
            const chId = k.replace('chrono_local_chat_', '');
            if (!channelsList.includes(chId)) {
              channelsList.push(chId);
            }
          }
        });

        let allLocalMsgs: any[] = [];
        channelsList.forEach(ch => {
          try {
            const stored = localStorage.getItem(`chrono_local_chat_${ch}`);
            if (stored) {
              const parsed = JSON.parse(stored);
              if (Array.isArray(parsed)) {
                allLocalMsgs = allLocalMsgs.concat(parsed);
              }
            }
          } catch (e) {}
        });

        allLocalMsgs.sort((a, b) => b.timestamp - a.timestamp);
        latestMessages = allLocalMsgs.slice(0, 50);
        updateUnreadCount(latestMessages);
      };

      checkLocalUnreads();

      const handleLocalChatChange = (e: StorageEvent) => {
        if (e.key?.startsWith('chrono_local_chat_') || e.key?.startsWith('chrono_last_viewed_')) {
          checkLocalUnreads();
        }
      };
      window.addEventListener('storage', handleLocalChatChange);
      unsub = () => {
        window.removeEventListener('storage', handleLocalChatChange);
      };
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key?.startsWith('chrono_last_viewed_')) {
        updateUnreadCount(latestMessages);
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (unsub) unsub();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [authToken, isFirebaseAuthed, showChat, currentUser]);

  // 4. Real-time settings listener
  useEffect(() => {
    if (!isFirebaseConfigured() || !isFirebaseAuthed) return;

    const unsubSettings = subscribeToSettings((firebaseSettings) => {
      if (firebaseSettings) {
        setAppSettings(prev => ({ ...prev, ...firebaseSettings }));
      } else {
        // Seed settings from local state if Firebase is empty
        import('./services/firebaseService').then(({ firebaseSaveSettings }) => {
           setAppSettings(prev => {
             firebaseSaveSettings(prev).catch(() => {});
             return prev;
           });
        });
      }
    });

    return () => {
      unsubSettings();
    };
  }, [isFirebaseAuthed]); 

  // ─── IDLE ENFORCEMENT MONITOR ──────────────────────────────────────────────
  const warnedIntervalsRef = useRef<Record<string, number[]>>({});
  useEffect(() => {
    if (!isFirebaseConfigured() || !authToken) return;

    // Only run this on an admin terminal to avoid multiple devices triggering alerts
    const isAdminTerminal = currentUser?.role === 'admin' && currentUser?.username?.toLowerCase() !== 'warehouse';
    if (!isAdminTerminal) return;

    const intervalHours = appSettings?.checkInIntervalHours || 1;
    const IDLE_THRESHOLD_MS = (intervalHours * 60 * 60 * 1000) + (10 * 60 * 1000); // Check-in interval + 10m grace

    const checkIdleSessions = async () => {
      const now = Date.now();
      const autoPauseEnabled = appSettings?.autoPauseEnabled !== false; // default true

      for (const [userId, session] of Object.entries(activeSessions) as [string, UserSession][]) {
        if (session.isPaused) {
          delete warnedIntervalsRef.current[userId];
          continue;
        }

        const timeSinceLastLog = now - session.lastLogTime;
        const minutesSinceLastLog = Math.floor(timeSinceLastLog / 60000);

        if (autoPauseEnabled && timeSinceLastLog >= IDLE_THRESHOLD_MS) {
          console.log(`[IdleEnforcement] Pausing session for ${session.user.name} (${intervalHours}h + 10m threshold reached)`);
          const { firebasePauseSession } = await import('./services/firebaseService');
          await firebasePauseSession(userId, 'idle');
          delete warnedIntervalsRef.current[userId];
        } else {
          // Determine which intervals this user wants to be notified for
          const alertPrefs = session.user.discordAlertPrefs && session.user.discordAlertPrefs.length > 0
            ? [...session.user.discordAlertPrefs]
            : [60];
            
          // Add the appSettings push interval to alertPrefs so we definitely process it
          const pushThresholdMinutes = intervalHours * 60;
          if (!alertPrefs.includes(pushThresholdMinutes)) {
              alertPrefs.push(pushThresholdMinutes);
          }

          // Sort descending so we process the biggest times first, or just check all of them
          for (const thresholdMinutes of alertPrefs) {
            if (minutesSinceLastLog >= thresholdMinutes) {
              if (!warnedIntervalsRef.current[userId]) warnedIntervalsRef.current[userId] = [];

              if (!warnedIntervalsRef.current[userId].includes(thresholdMinutes)) {
                warnedIntervalsRef.current[userId].push(thresholdMinutes);

                // Resolve latest token from usersRef so we aren't relying on stale session data from an iPad clock-in
                const latestUserDoc = usersRef.current.find(u => u.id === userId);
                const activePushToken = latestUserDoc?.expoPushToken || session.user.expoPushToken;

                // If this threshold matches the push notification threshold, send the Expo Push Notification!
                if (thresholdMinutes === pushThresholdMinutes && activePushToken) {
                   fetch('https://exp.host/--/api/v2/push/send', {
                       method: 'POST',
                       headers: {
                           'Accept': 'application/json',
                           'Accept-Encoding': 'gzip, deflate',
                           'Content-Type': 'application/json',
                       },
                       body: JSON.stringify({
                           to: activePushToken,
                           sound: 'default',
                           title: 'Auto-Pause Warning ⏱️',
                           body: `It's been ${intervalHours} hour${intervalHours > 1 ? 's' : ''}. Don't forget to log your activity!`,
                       }),
                   }).catch(err => console.error("Failed to send Expo push:", err));
                }

                // Send Discord Warning! (Only if they actually wanted this threshold via Discord)
                if (session.user.discordAlertPrefs?.includes(thresholdMinutes) || (!session.user.discordAlertPrefs && thresholdMinutes === 60)) {
                    const webhookUrl = import.meta.env.VITE_DISCORD_WEBHOOK_URL;
                    if (webhookUrl && appSettings?.discordNotificationsEnabled !== false) {
                      const { sendDiscordWarning } = await import('./services/discordService');
                      await sendDiscordWarning(webhookUrl, session.user.name, session.user.discordId, thresholdMinutes, false);
                    }
                }
              }
            }
          }

          // Clean up old tracked intervals if they've checked in
          // e.g., if they checked in and time dropped below lowest threshold
          const lowestThreshold = Math.min(...alertPrefs);
          if (minutesSinceLastLog < lowestThreshold) {
            delete warnedIntervalsRef.current[userId];
          }
        }
      }
    };

    const interval = setInterval(checkIdleSessions, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessions, authToken, currentUser, appSettings]);



  // Keep currentUser state in sync with real-time users list updates (e.g. role demotions)
  useEffect(() => {
    if (currentUser && users.length > 0) {
      const updatedProfile = users.find(u => String(u.id) === String(currentUser.id));
      if (updatedProfile) {
        if (JSON.stringify(updatedProfile) !== JSON.stringify(currentUser)) {
          setCurrentUser(updatedProfile);
          localStorage.setItem('chronoCurrentUser', JSON.stringify(updatedProfile));
        }
      }
    }
  }, [users, currentUser]);

  // Permissions computation for current user
  const isTerminal = currentUser?.role === 'terminal' || currentUser?.username?.toLowerCase() === 'warehouse';
  let currentPerms: string[] = [];
  if (currentUser) {
    if (Array.isArray(currentUser.permissions)) currentPerms = currentUser.permissions;
    else if (typeof currentUser.permissions === 'string') currentPerms = currentUser.permissions.split(',').map((s: string) => s.trim());
  }
  const isAdmin = currentPerms.includes('admin') || (currentUser?.role?.toLowerCase() === 'admin');
  const isManager = currentPerms.includes('manage_team') || currentPerms.includes('manage_users') || currentPerms.includes('edit_timecards') || currentPerms.includes('manage_schedule') || currentPerms.includes('view_reports') || (currentUser?.role?.toLowerCase() === 'manager');
  const isAdminOrManager = isAdmin || isManager;

  // Handle Role-based Tab Restrictions
  useEffect(() => {

    // Terminals can't visit the activity or manager tabs
    if (isTerminal && (activeTab === 'activity' || activeTab === 'manager')) {
      setActiveTab('station');
    }

    // Standard staff cannot visit the station, manager, or planner tabs
    if (!isAdminOrManager && !isTerminal && (activeTab === 'station' || activeTab === 'manager' || activeTab === 'planner')) {
      setActiveTab('activity');
    }
  }, [isAdminOrManager, isTerminal, activeTab]);

  const handleLoginSuccess = async (token: string, userData: any) => {
    // Ensure ID is always a string to prevent type mismatch with Firebase DB
    if (userData && userData.id) {
      userData.id = String(userData.id);
    }

    // Immediately force local role/permissions over the Replit payload if an active local profile exists (stops UI flashing and false permissions on fresh logins)
    const localUserMatch = users.find(u => String(u.id) === userData.id);

    // Normalize missing fields from Replit's /api/auth/me response
    userData.name = localUserMatch?.name || userData.name || (userData.firstName ? `${userData.firstName} ${userData.lastName || ''}`.trim() : userData.username || 'Team Member');
    userData.avatarInitials = localUserMatch?.avatarInitials || userData.avatarInitials || (userData.name ? userData.name.substring(0, 2).toUpperCase() : '??');

    if (localUserMatch) {
      userData.role = localUserMatch.role || userData.role;
      userData.permissions = localUserMatch.permissions || userData.permissions;
    }

    setAuthToken(token);
    setCurrentUser(userData);
    localStorage.setItem('chronoAuthToken', token);
    localStorage.setItem('chronoCurrentUser', JSON.stringify(userData));
  };

  const handleLogout = () => {
    if (confirm("Log out of the master terminal?")) {
      setAuthToken(null);
      setCurrentUser(null);
      localStorage.removeItem('chronoAuthToken');
      localStorage.removeItem('chronoCurrentUser');
    }
  };

  const handleAddUser = async (user: User) => {
    setUsers(prev => [...prev, user]);

    // Save to Firebase
    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveUser(user);
      } catch (err) {
        console.error("Failed to save new user to Firebase:", err);
      }
    }
  };

  const handleUpdateUser = async (updatedUser: User) => {
    lastUserUpdateRef.current = Date.now();
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    setActiveSessions(prev => {
      if (prev[updatedUser.id]) {
        return { ...prev, [updatedUser.id]: { ...prev[updatedUser.id], user: updatedUser } };
      }
      return prev;
    });

    // Save to Firebase
    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveUser(updatedUser);
        alert(`✅ ${updatedUser.name}'s profile saved successfully!`);
      } catch (err) {
        console.error('Firebase save user failed:', err);
      }
    }
  };

  const handleUpdateSettings = async (settings: AppSettings) => {
    setAppSettings(settings);
    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveSettings(settings);
      } catch (err) {
        console.error('Firebase save settings failed:', err);
      }
    }
  };

  const handleClockIn = async (user: User, clockInDepartment?: string, isUnscheduled?: boolean) => {
    const now = Date.now();

    // Optimistic local update (UI feels instant)
    setActiveSessions(prev => ({
      ...prev,
      [user.id]: { userId: user.id, user, startTime: now, lastLogTime: now, logs: [], clockInDepartment, isUnscheduled }
    }));

    // Primary: Write to Firebase (broadcasts to ALL devices instantly)
    if (isFirebaseConfigured()) {
      try {
        await firebaseClockIn(user, clockInDepartment, isUnscheduled);
      } catch (err: any) {
        console.error('Firebase clock-in failed:', err);
        alert(`Firebase Save Error: ${err.message || 'Unknown database error. Check your Firebase Security Rules!'}`);
      }
    }
  };

  const handleClockOut = async (user: User) => {
    const session = activeSessions[user.id];
    if (!session) return;

    // Optimistic local removal
    setActiveSessions(prev => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });

    // Primary: Write to Firebase (broadcasts to ALL devices instantly)
    if (isFirebaseConfigured()) {
      try {
        const timeCard = await firebaseClockOut(user.id, session);
        import('./services/storageService').then(({ storageService }) => {
          storageService.saveTimeCard(timeCard);
        });
      } catch (err) {
        console.error('Firebase clock-out failed:', err);
      }
    } else {
      // Fallback: save locally
      const now = Date.now();
      const timeCard: DailyTimeCard = {
        id: crypto.randomUUID(),
        userId: user.id,
        date: new Date(session.startTime).toISOString().split('T')[0],
        clockIn: session.startTime,
        clockOut: now,
        totalHours: (now - session.startTime) / (1000 * 60 * 60),
        status: 'Complete'
      };
      import('./services/storageService').then(({ storageService }) => {
        storageService.saveTimeCard(timeCard);
      });
    }
  };

  const handleLogAbsence = async (user: User, type: 'No-Call No-Show' | 'Sick' | 'Emergency', notes?: string) => {
    const now = Date.now();
    const tzOffset = now - new Date(now).getTimezoneOffset() * 60000;
    const todayStr = new Date(tzOffset).toISOString().split('T')[0];

    const timeCard: DailyTimeCard = {
      id: `tc-abs-${user.id}-${now}`,
      userId: user.id,
      date: todayStr,
      clockIn: now,
      clockOut: now,
      totalHours: 0,
      totalIdleHours: 0,
      status: type,
      managerNotes: notes || `Logged by manager`
    };

    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveTimeCard(timeCard);
      } catch (err) {
        console.error('Failed to save absence to Firebase:', err);
      }
    }

    const { storageService } = await import('./services/storageService');
    storageService.saveTimeCard(timeCard);

    return timeCard;
  };

  const handlePauseSession = async (user: User) => {
    // Optimistic Update
    setActiveSessions(prev => ({
      ...prev,
      [user.id]: {
        ...prev[user.id],
        isPaused: true,
        pauseReason: 'lunch',
        currentIdleStartTime: Date.now()
      }
    }));
    if (isFirebaseConfigured()) {
      try {
        await firebasePauseSession(user.id, 'lunch');
      } catch (e) {
        console.error('Failed to pause session for lunch:', e);
      }
    }
  };

  const handleResumeSession = async (user: User) => {
    const session = activeSessions[user.id];
    if (!session || !session.isPaused) return;

    // Optimistic Update
    const idleTimeToAdd = session.currentIdleStartTime ? Date.now() - session.currentIdleStartTime : 0;
    setActiveSessions(prev => ({
      ...prev,
      [user.id]: {
        ...prev[user.id],
        isPaused: false,
        pauseReason: undefined,
        totalIdleTimeMs: prev[user.id].totalIdleTimeMs + idleTimeToAdd,
        currentIdleStartTime: null,
        lastLogTime: Date.now()
      }
    }));

    if (isFirebaseConfigured()) {
      try {
        await firebaseResumeSession(user.id, session);
      } catch (e) {
        console.error('Failed to resume session:', e);
      }
    }
  };

  // ─── SHIFT BLOCKS LISTENER ───────────────────────────────────────────────
  useEffect(() => {
    if (!isFirebaseConfigured() || !isFirebaseAuthed) return;

    // Subscribe to shifts purely inside Firebase to bypass Replit
    const unsubscribe = subscribeToShiftBlocks((blocks: any[]) => {
      setShiftBlocks(blocks);
    });

    return () => unsubscribe();
  }, [isFirebaseAuthed]);

  // ─── AUTO CLOCK-OUT MONITOR ──────────────────────────────────────────────
  useEffect(() => {
    if (!authToken || !isFirebaseConfigured()) return;

    // Only run this on an admin terminal to avoid multiple devices triggering it
    const isAdminTerminal = currentUser?.role === 'admin' && currentUser?.username?.toLowerCase() !== 'warehouse';
    if (!isAdminTerminal) return;

    const checkShifts = () => {
      const now = Date.now();
      const today = new Date();

      const currentShifts = shiftBlocks.filter((b: any) => {
        const d = new Date(b.endTime);
        return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      });

      for (const [userId, session] of Object.entries(activeSessions) as [string, UserSession][]) {
        // Find if this user has a shift block that ended
        // We MUST filter by title starting with '[SHIFT]' to ignore regular tasks
        const userShift = currentShifts.find((b: any) => b.assignedTo === userId && b.title && b.title.startsWith('[SHIFT]'));
        if (userShift) {
          const endTimeRaw = new Date(userShift.endTime).getTime();
          // Add 10 minutes grace period
          const forcedClockOutTime = endTimeRaw + (10 * 60 * 1000);

          if (now > forcedClockOutTime) {
            console.log(`[AutoClockOut] Shift ended for ${session.user.name}. Auto clocking out.`);
            handleClockOut(session.user);
          }
        }
      }
    };

    const interval = setInterval(checkShifts, 30 * 1000); // Check every 30 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, shiftBlocks, activeSessions, currentUser]);

  const handleLogSubmit = (userId: string, logData: Omit<WorkLog, 'id' | 'timestamp' | 'periodStart' | 'periodEnd' | 'userId' | 'userName'>) => {
    const now = Date.now();

    // We need to resolve the new log before state update to save it
    // But we need session info.
    setActiveSessions(prev => {
      const session = prev[userId];
      if (!session) return prev;

      const newLog: WorkLog = {
        ...logData,
        id: crypto.randomUUID(),
        userId: session.userId,
        userName: session.user.name,
        timestamp: now,
        periodStart: session.lastLogTime,
        periodEnd: now,
        notes: session.isPaused
          ? `${logData.notes || ''} (Resumed from Idle: spent ${Math.round((now - (session.currentIdleStartTime || now)) / 60000)}m unpaid)`.trim()
          : logData.notes
      };

      // Primary: Write to Firebase
      if (isFirebaseConfigured()) {
        import('./services/firebaseService').then(async (mod) => {
          const IDLE_THRESHOLD_MS = ((appSettings?.checkInIntervalHours || 1) * 60 * 60 * 1000) + (10 * 60 * 1000);
          const autoPauseEnabled = appSettings?.autoPauseEnabled !== false; // Default to true
          const isOverdueForPause = autoPauseEnabled && ((now - session.lastLogTime) >= IDLE_THRESHOLD_MS);

          if (session.isPaused || isOverdueForPause) {
            // If they weren't officially "paused" yet but were overdue, 
            // we treat them as paused since the idle threshold mark.
            let effectiveSession = session;
            if (!session.isPaused && isOverdueForPause) {
              // Mock a session state that currentIdleStartTime was at 70m mark
              effectiveSession = {
                ...session,
                isPaused: true,
                pauseReason: 'idle',
                currentIdleStartTime: session.lastLogTime + IDLE_THRESHOLD_MS
              };
            }
            await mod.firebaseResumeSession(userId, effectiveSession);
          }
          await mod.firebaseAddLog(userId, newLog);
        });
      }

      // Save locally as backup
      import('./services/storageService').then(({ storageService }) => {
        storageService.saveLog(newLog);
      });

      return {
        ...prev,
        [userId]: {
          ...session,
          logs: [...session.logs, newLog],
          lastLogTime: now, // Reset timer for this specific user
          isPaused: false,
          pauseReason: undefined,
          currentIdleStartTime: null
        }
      };
    });
  };

  const handleUpdateTaskStatus = async (taskId: string, status: string, taskTitle: string, user: User) => {
    if (isFirebaseConfigured()) {
      const task = shiftBlocks.find(b => b.id === taskId);
      if (task) {
        import('./services/firebaseService').then(({ firebaseSaveShiftBlock }) => {
          firebaseSaveShiftBlock({
            ...task,
            status: status
          }).catch(err => console.error('Failed to update task status in Firebase', err));
        });
      }
    } else {
      console.log("Standalone task update not implemented for Firebase tasks yet:", taskId, status);
    }
  };

  const deleteLog = (userId: string, logId: string) => {
    if (confirm('Are you sure you want to delete this entry?')) {
      // Primary: Delete from Firebase
      if (isFirebaseConfigured()) {
        firebaseDeleteLog(logId).catch(err => console.error('Firebase delete log failed:', err));
      }

      // Also delete locally
      import('./services/storageService').then(({ storageService }) => {
        storageService.deleteLog(logId);
      });

      setActiveSessions(prev => {
        const session = prev[userId];
        if (!session) return prev;
        return {
          ...prev,
          [userId]: { ...session, logs: session.logs.filter(l => l.id !== logId) }
        };
      });
    }
  };

  if (!authToken) {
    return <LoginScreen onLogin={handleLoginSuccess} users={users} />;
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10 shadow-sm print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-black p-2 rounded-lg shadow-md">
              <div className="w-4 h-4 border-2 border-white rounded-full"></div>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-900 tracking-tight">Clockwork</h1>
              {!isFirebaseConfigured() && isAdmin && (
                <span className="hidden sm:inline-block px-2 py-0.5 bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold rounded shadow-sm">
                  Firebase Keys Missing!
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <div className="hidden sm:flex flex-col items-end text-right mr-2">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Active Staff</span>
              <span className="text-sm font-semibold text-zinc-800">
                {Object.keys(activeSessions).length} Checked In
              </span>
            </div>
            {/* Mobile-only compact view */}
            <div className="flex sm:hidden flex-col items-end text-right mr-1">
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Staff In</span>
              <span className="text-xs font-bold text-zinc-800">{Object.keys(activeSessions).length}</span>
            </div>
            <div className="hidden sm:block h-8 w-px bg-zinc-200 mx-2"></div>
            {!isTerminal && (
              <button
                onClick={() => setShowChat(true)}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors relative"
                title="Team Chat"
              >
                <MessageSquare className="w-5 h-5" />
                {unreadChatCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center ring-2 ring-white shadow-sm animate-pulse">
                    {unreadChatCount}
                  </span>
                )}
              </button>
            )}
            {isAdmin && !isTerminal && (
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 rounded-lg transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-zinc-200 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto hide-scrollbar" aria-label="Tabs">
            {(isAdminOrManager || isTerminal) && (
              <button
                onClick={() => setActiveTab('station')}
                className={`${activeTab === 'station'
                  ? 'border-zinc-300 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
              >
                <Radio className={`w-4 h-4 ${activeTab === 'station' ? 'animate-pulse' : ''}`} />
                Master Station (iPad)
              </button>
            )}

            {!isTerminal && (
              <button
                onClick={() => setActiveTab('activity')}
                className={`${activeTab === 'activity'
                  ? 'border-zinc-300 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
              >
                <ClipboardList className="w-4 h-4" />
                Activity Tracker (Mobile)
              </button>
            )}

            <button
              onClick={() => setActiveTab('planner')}
              className={`${activeTab === 'planner'
                ? 'border-zinc-300 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <Calendar className="w-4 h-4" />
              Daily Planner
            </button>

            {(isAdminOrManager && !isTerminal) && (
              <button
                onClick={() => setActiveTab('manager')}
                className={`${activeTab === 'manager'
                  ? 'border-zinc-300 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
              >
                <Users className="w-4 h-4" />
                Team Activity
              </button>
            )}

            {!isTerminal && (
              <button
                onClick={() => setActiveTab('documents')}
                className={`${activeTab === 'documents'
                  ? 'border-zinc-300 text-zinc-900'
                  : 'border-transparent text-zinc-500 hover:text-zinc-700 hover:border-zinc-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors print:hidden`}
              >
                <FileText className="w-4 h-4" />
                Forms & Docs
              </button>
            )}
          </nav>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full relative print:p-0 print:m-0 print:max-w-none">
        <div className="mt-4 h-[calc(100vh-12rem)] flex flex-col print:h-auto print:mt-0 print:block">
          {activeTab === 'station' ? (
            <TimeStation
              activeSessions={activeSessions}
              users={users}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
              onPauseSession={handlePauseSession}
              onResumeSession={handleResumeSession}
              isAdmin={isAdminOrManager}
              appSettings={appSettings}
              onUpdateSettings={handleUpdateSettings}
              shiftBlocks={shiftBlocks}
              onLogAbsence={handleLogAbsence}
            />
          ) : activeTab === 'activity' ? (
            <ActivityTracker
              activeSessions={activeSessions}
              onLogSubmit={handleLogSubmit}
              onDeleteLog={deleteLog}
              scheduledTasks={shiftBlocks}
              onManualSync={() => {}}
              isSyncingReplit={false}
              lastSyncTime={0}
              syncError={null}
              replitUrl={undefined}
              currentUser={currentUser}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
              onUpdateUser={handleUpdateUser}
              onUpdateTaskStatus={handleUpdateTaskStatus}
              appSettings={appSettings}
            />
          ) : activeTab === 'planner' ? (
            <DailyPlanner users={users} currentUser={currentUser} />
          ) : activeTab === 'documents' ? (
            <PrintableForms currentUser={currentUser} />
          ) : (
            <ActivityManager users={users} settings={appSettings} activeSessions={activeSessions} onClockIn={handleClockIn} onClockOut={handleClockOut} onUpdateUser={handleUpdateUser} onLogAbsence={handleLogAbsence} currentUser={currentUser} />
          )}
        </div>
      </main>

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        users={users}
        onAddUser={handleAddUser}
        onUpdateUser={handleUpdateUser}
        onDeleteUser={async (userId) => {
          if (!confirm('Are you sure you want to delete this user?')) return;

          setUsers(prev => prev.filter(u => u.id !== userId));
          // Clean up active sessions if any
          setActiveSessions(prev => {
            const newSessions = { ...prev };
            delete newSessions[userId];
            return newSessions;
          });

          // Delete from Firebase to prevent reappearing
          if (isFirebaseConfigured()) {
            try {
              const { firebaseDeleteUser } = await import('./services/firebaseService');
              await firebaseDeleteUser(userId);
            } catch (err) {
              console.error("Failed to delete user from Firebase:", err);
            }
          }

        }}
        settings={appSettings}
        onUpdateSettings={handleUpdateSettings}
        currentUser={currentUser}
      />

      <TeamChat
        isOpen={showChat}
        onClose={() => setShowChat(false)}
        currentUser={currentUser}
        activeSessions={activeSessions}
        users={users}
      />
    </div>
  );
};

export default App;