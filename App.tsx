import React, { useState, useEffect } from 'react';
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
  const [activeSessions, setActiveSessions] = useState<Record<string, UserSession>>(() => {
    const saved = localStorage.getItem('chronoSessions');
    return saved ? JSON.parse(saved) : {};
  });

  const [activeTab, setActiveTab] = useState<Tab>('station');
  const [showSettings, setShowSettings] = useState(false);

  // Daily Schedule State
  const [todaySchedule, setTodaySchedule] = useState<any>(null);

  // Sync Users from Replit helper
  const syncUsersFromReplit = async (token: string) => {
    try {
      const replitUrl = localStorage.getItem('replitAppUrl');
      if (replitUrl) {
        const { supplyWatchService } = await import('./services/supplyWatchService');
        try {
          const remoteUsers = await supplyWatchService.getUsers(replitUrl, token);
          if (Array.isArray(remoteUsers)) {
            setUsers(prevUsers => {
              const newUsers = [...prevUsers];
              let hasChanges = false;
              const defaultAvail: any = {
                'Monday': { active: true, start: '09:00', end: '17:00' },
                'Tuesday': { active: true, start: '09:00', end: '17:00' },
                'Wednesday': { active: true, start: '09:00', end: '17:00' },
                'Thursday': { active: true, start: '09:00', end: '17:00' },
                'Friday': { active: true, start: '09:00', end: '17:00' },
                'Saturday': { active: false, start: '09:00', end: '17:00' },
                'Sunday': { active: false, start: '09:00', end: '17:00' }
              };

              remoteUsers.forEach((rUser: any) => {
                const existingIndex = newUsers.findIndex(u =>
                  u.id === String(rUser.id) ||
                  u.name.toLowerCase() === (rUser.username || '').toLowerCase()
                );

                const firstName = rUser.firstName || '';
                const lastName = rUser.lastName || '';
                const fullName = (firstName || lastName)
                  ? `${firstName} ${lastName}`.trim()
                  : (rUser.displayName || rUser.username || 'Unknown');

                const initials = (firstName && lastName)
                  ? (firstName[0] + lastName[0]).toUpperCase()
                  : (rUser.username || fullName || '??').substring(0, 2).toUpperCase();

                const mappedUser: User = {
                  id: String(rUser.id),
                  name: fullName,
                  username: rUser.username,
                  role: rUser.role || 'Staff',
                  primaryDepartment: Department.Production,
                  avatarInitials: initials,
                  pin: rUser.pin || '0000',
                  availability: defaultAvail,
                  lateDays: 0,
                  correctionNotes: ''
                };

                if (existingIndex >= 0) {
                  const existing = newUsers[existingIndex];
                  if (existing.name !== mappedUser.name || existing.role !== mappedUser.role) {
                    newUsers[existingIndex] = { ...existing, ...mappedUser };
                    hasChanges = true;
                  }
                } else {
                  newUsers.push(mappedUser);
                  hasChanges = true;
                }
              });

              if (hasChanges) return newUsers;
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
      syncUsersFromReplit(authToken);

      // Fetch schedule
      try {
        const replitUrl = localStorage.getItem('replitAppUrl');
        if (replitUrl) {
          const { supplyWatchService } = await import('./services/supplyWatchService');
          const schedule = await supplyWatchService.getDailySchedule(replitUrl, authToken, new Date());
          setTodaySchedule(schedule);
        }
      } catch (err) {
        console.warn("Could not fetch daily schedule:", err);
      }
    };

    initAuthenticatedData();
    // Refresh schedule every 5 minutes
    const interval = setInterval(initAuthenticatedData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authToken]);

  // Handle Role-based Tab Restrictions
  useEffect(() => {
    if (currentUser?.role === 'terminal' && (activeTab === 'activity' || activeTab === 'manager')) {
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

  const handleAddUser = (user: User) => {
    setUsers(prev => [...prev, user]);
  };

  const handleUpdateUser = (updatedUser: User) => {
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));

    // Also update active session if this user is logged in
    setActiveSessions(prev => {
      if (prev[updatedUser.id]) {
        return {
          ...prev,
          [updatedUser.id]: {
            ...prev[updatedUser.id],
            user: updatedUser
          }
        };
      }
      return prev;
    });
  };

  const handleUpdateSettings = (settings: AppSettings) => {
    setAppSettings(settings);
  };

  const handleClockIn = (user: User) => {
    const now = Date.now();
    setActiveSessions(prev => ({
      ...prev,
      [user.id]: {
        userId: user.id,
        user: user,
        startTime: now,
        lastLogTime: now,
        logs: []
      }
    }));
  };

  /* 
   * PERSISTENCE HANDLERS 
   */
  const handleClockOut = (user: User) => {
    const session = activeSessions[user.id];
    if (session) {
      const now = Date.now();
      const totalHours = (now - session.startTime) / (1000 * 60 * 60);

      const timeCard: DailyTimeCard = {
        id: crypto.randomUUID(),
        userId: user.id,
        date: new Date(session.startTime).toISOString().split('T')[0],
        clockIn: session.startTime,
        clockOut: now,
        totalHours: totalHours,
        status: 'Complete'
      };

      // Save to permanent storage
      // We also save all the logs from this session if they weren't saved individually?
      // Actually handleLogSubmit saves them individually.
      import('./services/storageService').then(({ storageService }) => {
        storageService.saveTimeCard(timeCard);
      });
    }

    setActiveSessions(prev => {
      const newSessions = { ...prev };
      delete newSessions[user.id];
      return newSessions;
    });
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

      // Save to permanent storage asynchronously (fire and forget for UI)
      import('./services/storageService').then(({ storageService }) => {
        storageService.saveLog(newLog);
      });

      // OPTIONAL: Sync to Replit here if we wanted real-time sync
      // import('./services/supplyWatchService').then(({ supplyWatchService }) => {
      //   const replitUrl = localStorage.getItem('replitAppUrl');
      //   if(replitUrl && authToken) {
      //      supplyWatchService.syncLog(newLog, replitUrl, authToken);
      //   }
      // });

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
      // Delete from storage
      import('./services/storageService').then(({ storageService }) => {
        storageService.deleteLog(logId);
      });

      setActiveSessions(prev => {
        const session = prev[userId];
        if (!session) return prev;
        return {
          ...prev,
          [userId]: {
            ...session,
            logs: session.logs.filter(l => l.id !== logId)
          }
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
            {currentUser?.role === 'admin' && (
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

            {currentUser?.role !== 'terminal' && (
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

            {(currentUser?.role === 'admin' || currentUser?.role === 'manager') && (
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
        onDeleteUser={(userId) => {
          setUsers(prev => prev.filter(u => u.id !== userId));
          // Clean up active sessions if any
          setActiveSessions(prev => {
            const newSessions = { ...prev };
            delete newSessions[userId];
            return newSessions;
          });
        }}
        settings={appSettings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
};

export default App;