import React, { useState, useEffect, useRef } from 'react';
import { WorkLog, UserSession, User, AppSettings, DailyTimeCard, Department } from './types';
import { DEFAULT_USERS } from './constants';
import { WorkLogForm } from './components/WorkLogForm';
import { TimeStation } from './components/TimeStation';
import { ActivityTracker } from './components/ActivityTracker';
import { ActivityManager } from './components/ActivityManager';
import { SettingsDialog } from './components/SettingsDialog';
import { LoginScreen } from './components/LoginScreen';
import { DailyPlanner } from './components/DailyPlanner';
import { Radio, ClipboardList, BarChart4, Settings, LogOut, Calendar } from 'lucide-react';
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
  isFirebaseConfigured
} from './services/firebaseService';

type Tab = 'station' | 'activity' | 'manager' | 'planner';

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
    return saved ? JSON.parse(saved) : DEFAULT_USERS;
  });

  // Global State: Settings
  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('chronoSettings');
    return saved ? JSON.parse(saved) : { payFrequency: 'Bi-Weekly', payPeriodStartDay: 'Monday' };
  });

  // Global State: Map of userId -> UserSession
  // Initialize as empty to ensure we fetch fresh state from server on every device
  const [activeSessions, setActiveSessions] = useState<Record<string, UserSession>>({});

  const [activeTab, setActiveTab] = useState<Tab>('station');
  const [showSettings, setShowSettings] = useState(false);

  // Track when we last made a local user update (to avoid sync overwriting unsaved data)
  const lastUserUpdateRef = useRef<number>(0);

  // Ref to always-current users list — used inside Firebase callbacks to avoid stale closures
  const usersRef = useRef<User[]>(users);
  useEffect(() => { usersRef.current = users; }, [users]);

  // Daily Schedule State
  const [todaySchedule, setTodaySchedule] = useState<any>(null);

  // Sync Users from Replit helper
  const syncUsersFromReplit = async (token: string) => {
    // Don't overwrite if a local update happened in the last 15 seconds
    const timeSinceLastUpdate = Date.now() - lastUserUpdateRef.current;
    if (timeSinceLastUpdate < 15000) {
      console.log('Skipping user sync — local update was just made.');
      return;
    }

    try {
      const replitUrl = localStorage.getItem('replitAppUrl');
      if (replitUrl) {
        const { supplyWatchService } = await import('./services/supplyWatchService');
        try {
          const remoteUsers = await supplyWatchService.getUsers(replitUrl, token);
          if (Array.isArray(remoteUsers)) {
            setUsers(prevUsers => {
              const defaultAvail: any = {
                'Monday': { active: true, start: '09:00', end: '17:00' },
                'Tuesday': { active: true, start: '09:00', end: '17:00' },
                'Wednesday': { active: true, start: '09:00', end: '17:00' },
                'Thursday': { active: true, start: '09:00', end: '17:00' },
                'Friday': { active: true, start: '09:00', end: '17:00' },
                'Saturday': { active: false, start: '09:00', end: '17:00' },
                'Sunday': { active: false, start: '09:00', end: '17:00' }
              };

              const mappedRemoteUsers: User[] = remoteUsers.map((rUser: any) => {
                const firstName = rUser.firstName || '';
                const lastName = rUser.lastName || '';
                const fullName = (firstName || lastName)
                  ? `${firstName} ${lastName}`.trim()
                  : (rUser.displayName || rUser.username || 'Unknown');

                const initials = (firstName && lastName)
                  ? (firstName[0] + lastName[0]).toUpperCase()
                  : (rUser.username || fullName || '??').substring(0, 2).toUpperCase();

                // Find existing local user to merge with — local data wins for
                // fields the backend may return as empty/default
                const existingLocal = prevUsers.find(u => u.id === String(rUser.id) || u.username === rUser.username);

                // For PIN: only trust backend value if it's real (not '0000' or missing)
                // If backend returns '0000' or empty, prefer local PIN
                const remotePin = rUser.pin && rUser.pin !== '0000' ? rUser.pin : null;
                const resolvedPin = remotePin || existingLocal?.pin || '0000';

                return {
                  // Start with existing local data as base (preserves all edited fields)
                  ...existingLocal,
                  // Then overlay with real remote values (non-empty, non-default)
                  id: String(rUser.id),
                  name: fullName || existingLocal?.name || 'Unknown',
                  username: rUser.username || existingLocal?.username,
                  role: rUser.role || existingLocal?.role || 'Staff',
                  primaryDepartment: rUser.primaryDepartment || existingLocal?.primaryDepartment || Department.Production,
                  avatarInitials: rUser.avatarInitials || existingLocal?.avatarInitials || initials,
                  pin: resolvedPin,
                  // For availability: prefer remote if it looks real, else keep local
                  availability: (rUser.availability && Object.keys(rUser.availability).length > 0)
                    ? rUser.availability
                    : (existingLocal?.availability || defaultAvail),
                  lateDays: rUser.lateDays !== undefined ? rUser.lateDays : (existingLocal?.lateDays || 0),
                  correctionNotes: rUser.correctionNotes || existingLocal?.correctionNotes || '',
                  // Personal info: keep local if backend doesn't have it
                  email: rUser.email || existingLocal?.email,
                  phoneNumber: rUser.phoneNumber || existingLocal?.phoneNumber,
                  address: rUser.address || existingLocal?.address,
                  supportingRole: rUser.supportingRole || existingLocal?.supportingRole,
                  secondaryDepartment: rUser.secondaryDepartment || existingLocal?.secondaryDepartment,
                  permissions: rUser.permissions || existingLocal?.permissions || []
                };
              });

              // Only update state if something actually changed
              if (JSON.stringify(mappedRemoteUsers) !== JSON.stringify(prevUsers)) {
                return mappedRemoteUsers;
              }
              return prevUsers;
            });
          }
        } catch (innerErr) {
          console.warn("Could not fetch remote users", innerErr);
        }
      }
    } catch (err) {
      console.error("User sync setup failed", err);
    }
  };

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

  // Fetch today's schedule and sync users when authenticated
  useEffect(() => {
    const initAuthenticatedData = async () => {
      if (!authToken) return;

      // Sync users immediately
      await syncUsersFromReplit(authToken);

      const replitUrl = localStorage.getItem('replitAppUrl');
      if (!replitUrl) return;

      try {
        const { supplyWatchService } = await import('./services/supplyWatchService');

        // Fetch schedule only — sessions are handled by Firebase listener
        const schedule = await supplyWatchService.getDailySchedule(replitUrl, authToken, new Date());
        setTodaySchedule(schedule);
      } catch (err) {
        console.warn("Could not fetch remote schedule:", err);
      }
    };

    initAuthenticatedData();
    // Still poll schedule every 5 minutes
    const interval = setInterval(initAuthenticatedData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authToken]);

  // ─── FIREBASE REAL-TIME LISTENERS ────────────────────────────────────────────
  useEffect(() => {
    if (!authToken || !isFirebaseConfigured()) return;

    // 1. Real-time active sessions listener
    const unsubSessions = subscribeToActiveSessions((rawSessions) => {
      setActiveSessions(() => {
        const newSessions: Record<string, UserSession> = {};
        Object.entries(rawSessions).forEach(([userId, data]: [string, any]) => {
          // Try full user from our local list first
          const sessionUser = usersRef.current.find(u => u.id === userId);

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
            logs: data.logs || []
          };
        });
        return newSessions;
      });
    });

    // 2. Real-time users listener — Firebase is source of truth for user profiles
    const unsubUsers = subscribeToUsers((firebaseUsers) => {
      if (firebaseUsers.length > 0) {
        // Merge: Firebase data wins for every field it has
        setUsers(prev => {
          const merged = firebaseUsers.map(fu => {
            const local = prev.find(u => u.id === fu.id);
            return { ...local, ...fu };
          });
          return merged;
        });
      } else {
        // Firebase users collection empty — seed it from current users list
        console.log('Firebase users empty — seeding from local list...');
        usersRef.current.forEach(u => firebaseSaveUser(u).catch(() => { }));
      }
    });

    return () => {
      unsubSessions();
      unsubUsers();
    };
  }, [authToken]); // Add users to dependency to ensure mapping works when users list changes
  // ─── REPLIT -> FIREBASE LOG BRIDGE ──────────────────────────────────────────
  // Sync hourly check-ins from Replit Supply Watch into ChronoTrack Firebase
  useEffect(() => {
    if (!authToken || !isFirebaseConfigured()) return;

    const syncReplitLogs = async () => {
      let replitUrl = localStorage.getItem('replitAppUrl');
      if (!replitUrl) return;
      if (!replitUrl.startsWith('http')) replitUrl = `https://${replitUrl}`;

      try {
        const { supplyWatchService } = await import('./services/supplyWatchService');
        const remoteLogsRaw = await supplyWatchService.getLogs(replitUrl, authToken);

        // Handle both direct array and { logs: [] } formats
        const logs = Array.isArray(remoteLogsRaw) ? remoteLogsRaw : (remoteLogsRaw?.logs || []);

        if (logs.length > 0) {
          console.debug(`[Sync] Found ${logs.length} Replit logs. Checking for matches...`);

          // Use a timestamp filter instead of string date to avoid UTC/Local drift
          const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);

          for (const rLog of logs) {
            const logTime = new Date(rLog.timestamp || rLog.startTime).getTime();
            if (isNaN(logTime) || logTime < twelveHoursAgo) continue;

            // Robust User Matching
            const sessionUser = usersRef.current.find(u => {
              const matchId = rLog.userId && String(u.id) === String(rLog.userId);
              const matchUser = rLog.username && u.username?.toLowerCase() === rLog.username.toLowerCase();
              const matchName = rLog.userName && u.name.toLowerCase() === rLog.userName.toLowerCase();
              return matchId || matchUser || matchName;
            });

            if (sessionUser) {
              const logId = rLog.id ? `replit-${rLog.id}` : `replit-${sessionUser.id}-${logTime}`;

              // Ensure periodEnd is at least the log time to reset the timer
              const pStart = new Date(rLog.startTime || rLog.timestamp).getTime();
              const pEnd = new Date(rLog.endTime || rLog.timestamp || rLog.startTime).getTime();

              const chronoLog: WorkLog = {
                id: logId,
                userId: sessionUser.id,
                userName: sessionUser.name,
                department: (rLog.department as Department) || Department.Production,
                task: rLog.task || 'Staff Check-in',
                notes: rLog.notes || 'Imported from Replit',
                timestamp: logTime,
                periodStart: isNaN(pStart) ? logTime : pStart,
                periodEnd: isNaN(pEnd) ? logTime : pEnd,
                productionData: rLog.productionQuantity ? {
                  quantity: rLog.productionQuantity,
                  projectName: rLog.projectReference || ''
                } : undefined
              };

              // Push to Firebase — if the user is active, this also resets their timer
              await firebaseAddLog(sessionUser.id, chronoLog);
              console.log(`[Sync] Successfully bridged Replit check-in for ${sessionUser.name}`);
            }
          }
        }
      } catch (err) {
        console.warn("[Sync] Replit bridge connectivity issue:", err);
      }
    };

    // Poll frequently (every 30s) so check-ins feel instant
    syncReplitLogs();
    const interval = setInterval(syncReplitLogs, 30 * 1000);
    return () => clearInterval(interval);
  }, [authToken]);

  // Handle Role-based Tab Restrictions
  useEffect(() => {
    const isTerminal = currentUser?.role === 'terminal' || currentUser?.username?.toLowerCase() === 'warehouse';
    if (isTerminal && (activeTab === 'activity' || activeTab === 'manager')) {
      setActiveTab('station');
    }
  }, [currentUser, activeTab]);

  const handleLoginSuccess = async (token: string, userData: any) => {
    setAuthToken(token);
    setCurrentUser(userData);
    localStorage.setItem('chronoAuthToken', token);
    localStorage.setItem('chronoCurrentUser', JSON.stringify(userData));

    // Sync Users from Replit
    syncUsersFromReplit(token);
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

    // Sync to Replit
    const replitUrl = localStorage.getItem('replitAppUrl');
    if (replitUrl && authToken) {
      try {
        const { supplyWatchService } = await import('./services/supplyWatchService');
        // Map frontend User fields to backend schema
        const firstName = user.name.split(' ')[0];
        const lastName = user.name.split(' ').slice(1).join(' ');
        await supplyWatchService.createUser(replitUrl, authToken, {
          username: user.username || user.name.toLowerCase().replace(/\s+/g, '_'),
          email: user.email || `${user.id}@chronotrack.local`,
          firstName: firstName,
          lastName: lastName,
          role: user.role,
          pin: user.pin || '0000',
          primaryDepartment: user.primaryDepartment,
          availability: user.availability,
          avatarInitials: user.avatarInitials,
          password: "chrono123" // Default password
        });
      } catch (err) {
        console.error("Failed to sync new user to Replit:", err);
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

    // Primary: Save to Firebase
    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveUser(updatedUser);
        alert(`✅ ${updatedUser.name}'s profile saved successfully!`);
        return; // Firebase succeeded — done
      } catch (err) {
        console.error('Firebase save user failed:', err);
      }
    }

    // Fallback: Save to Replit
    const replitUrl = localStorage.getItem('replitAppUrl');
    if (replitUrl && authToken) {
      try {
        const { supplyWatchService } = await import('./services/supplyWatchService');
        const firstName = updatedUser.name.split(' ')[0];
        const lastName = updatedUser.name.split(' ').slice(1).join(' ');
        await supplyWatchService.updateUser(replitUrl, authToken, updatedUser.id, {
          firstName, lastName,
          role: updatedUser.role,
          pin: updatedUser.pin,
          primaryDepartment: updatedUser.primaryDepartment,
          availability: updatedUser.availability,
          avatarInitials: updatedUser.avatarInitials,
          email: updatedUser.email,
          username: updatedUser.username,
          phoneNumber: updatedUser.phoneNumber,
          address: updatedUser.address,
          supportingRole: updatedUser.supportingRole,
          secondaryDepartment: updatedUser.secondaryDepartment,
          lateDays: updatedUser.lateDays,
          correctionNotes: updatedUser.correctionNotes,
          permissions: updatedUser.permissions
        });
        alert(`✅ ${updatedUser.name}'s profile saved successfully!`);
      } catch (err) {
        console.error('Replit save user failed:', err);
        alert(`⚠️ Profile saved locally but failed to sync. Changes may not appear on other devices.`);
      }
    }
  };

  const handleUpdateSettings = (settings: AppSettings) => {
    setAppSettings(settings);
  };

  const handleClockIn = async (user: User) => {
    const now = Date.now();

    // Optimistic local update (UI feels instant)
    setActiveSessions(prev => ({
      ...prev,
      [user.id]: { userId: user.id, user, startTime: now, lastLogTime: now, logs: [] }
    }));

    // Primary: Write to Firebase (broadcasts to ALL devices instantly)
    if (isFirebaseConfigured()) {
      try {
        await firebaseClockIn(user);
      } catch (err) {
        console.error('Firebase clock-in failed:', err);
      }
    }

    // Secondary: Sync to Replit
    const replitUrl = localStorage.getItem('replitAppUrl');
    if (replitUrl && authToken) {
      import('./services/supplyWatchService').then(({ supplyWatchService }) => {
        supplyWatchService.clockIn(replitUrl, authToken!, user.id, user.primaryDepartment).catch(() => { });
      });
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

    // Secondary: Sync to Replit
    const replitUrl = localStorage.getItem('replitAppUrl');
    if (replitUrl && authToken) {
      import('./services/supplyWatchService').then(({ supplyWatchService }) => {
        supplyWatchService.clockOut(replitUrl, authToken!, user.id).catch(() => { });
      });
    }
  };

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
        periodEnd: now
      };

      // Primary: Write to Firebase
      if (isFirebaseConfigured()) {
        firebaseAddLog(userId, newLog).catch(err => console.error('Firebase log failed:', err));
      }

      // Save locally as backup
      import('./services/storageService').then(({ storageService }) => {
        storageService.saveLog(newLog);
      });

      // Secondary: Sync to Replit
      import('./services/supplyWatchService').then(({ supplyWatchService }) => {
        const replitUrl = localStorage.getItem('replitAppUrl');
        if (replitUrl && authToken) {
          supplyWatchService.syncLog(newLog, replitUrl, authToken);
        }
      });

      return {
        ...prev,
        [userId]: {
          ...session,
          logs: [...session.logs, newLog],
          lastLogTime: now // Reset timer for this specific user
        }
      };
    });
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
    return <LoginScreen onLogin={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-2 rounded-lg shadow-md">
              <div className="w-4 h-4 border-2 border-white rounded-full"></div>
            </div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">ChronoTrack AI</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end text-right mr-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Staff</span>
              <span className="text-sm font-semibold text-gray-800">
                {Object.keys(activeSessions).length} Checked In
              </span>
            </div>
            <div className="h-8 w-px bg-gray-200 mx-2"></div>
            {currentUser?.role === 'admin' && currentUser?.username?.toLowerCase() !== 'warehouse' && (
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={handleLogout}
              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('station')}
              className={`${activeTab === 'station'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <Radio className={`w-4 h-4 ${activeTab === 'station' ? 'animate-pulse' : ''}`} />
              Master Station (iPad)
            </button>

            {(currentUser?.role !== 'terminal' && currentUser?.username?.toLowerCase() !== 'warehouse') && (
              <button
                onClick={() => setActiveTab('activity')}
                className={`${activeTab === 'activity'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
              >
                <ClipboardList className="w-4 h-4" />
                Activity Tracker (Mobile)
              </button>
            )}

            <button
              onClick={() => setActiveTab('planner')}
              className={`${activeTab === 'planner'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <Calendar className="w-4 h-4" />
              Daily Planner
            </button>

            {((currentUser?.role === 'admin' || currentUser?.role === 'manager') && currentUser?.username?.toLowerCase() !== 'warehouse') && (
              <button
                onClick={() => setActiveTab('manager')}
                className={`${activeTab === 'manager'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
              >
                <BarChart4 className="w-4 h-4" />
                Activity Manager
              </button>
            )}
          </nav>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full relative">
        <div className="mt-4 h-[calc(100vh-12rem)] flex flex-col">
          {activeTab === 'station' ? (
            <TimeStation
              activeSessions={activeSessions}
              users={users}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
            />
          ) : activeTab === 'activity' ? (
            <ActivityTracker
              activeSessions={activeSessions}
              onLogSubmit={handleLogSubmit}
              onDeleteLog={deleteLog}
              scheduledTasks={todaySchedule?.blocks || []}
            />
          ) : activeTab === 'planner' ? (
            // Lazy load nicely or just static
            <DailyPlanner users={users} currentUser={currentUser} />
          ) : (
            <ActivityManager users={users} settings={appSettings} />
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

          // Sync to Replit
          const replitUrl = localStorage.getItem('replitAppUrl');
          if (replitUrl && authToken) {
            try {
              const { supplyWatchService } = await import('./services/supplyWatchService');
              await supplyWatchService.deleteUser(replitUrl, authToken, userId);
            } catch (err) {
              console.error("Failed to sync user deletion to Replit:", err);
            }
          }
        }}
        settings={appSettings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
};

export default App;