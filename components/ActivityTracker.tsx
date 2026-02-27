import React, { useState, useEffect } from 'react';
import { WorkLog, UserSession, ScheduleBlock } from '../types';
import { WorkLogForm } from './WorkLogForm';
import { HistoryLog } from './HistoryLog';
import { AiSummary } from './AiSummary';
import { Timer } from './Timer';
import { LayoutDashboard, Clock, User as UserIcon, LogOut, Lock, CheckCircle2, Circle, AlertCircle, RefreshCcw, Play, Calendar, Users } from 'lucide-react';
import { LOG_INTERVAL_MS } from '../constants';

import { UserProfileDialog } from './UserProfileDialog';
import { TimeOffRequestModal } from './TimeOffRequestModal';

interface Props {
  activeSessions: Record<string, UserSession>;
  onLogSubmit: (userId: string, logData: Omit<WorkLog, 'id' | 'timestamp' | 'periodStart' | 'periodEnd' | 'userId' | 'userName'>) => void;
  onDeleteLog: (userId: string, id: string) => void;
  scheduledTasks?: ScheduleBlock[]; // Tasks from Daily Planner
  onManualSync?: () => void;
  isSyncingReplit?: boolean;
  lastSyncTime?: number;
  syncError?: string | null;
  replitUrl?: string;
  currentUser?: any;
  onClockIn?: (user: any) => void;
  onClockOut?: (user: any) => void;
  onUpdateUser?: (updatedUser: any) => void;
}

export const ActivityTracker: React.FC<Props> = ({
  activeSessions,
  onLogSubmit,
  onDeleteLog,
  scheduledTasks = [],
  onManualSync,
  isSyncingReplit = false,
  lastSyncTime = 0,
  syncError = null,
  replitUrl = '',
  currentUser,
  onClockIn,
  onClockOut,
  onUpdateUser
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isRequestingTimeOff, setIsRequestingTimeOff] = useState(false);

  const activeUsers = Object.values(activeSessions) as UserSession[];

  // Enforce isolation: if this is a standard staff member (not tablet/admin) 
  // only show THEIR session.
  const isDedicatedTerminal = currentUser?.role === 'terminal' || currentUser?.username?.toLowerCase() === 'warehouse';
  const isAdminOrManager = (() => {
    let currentPerms: string[] = [];
    if (currentUser) {
      if (Array.isArray(currentUser.permissions)) currentPerms = currentUser.permissions;
      else if (typeof currentUser.permissions === 'string') currentPerms = currentUser.permissions.split(',').map((s: string) => s.trim());
    }
    const hasAdmin = currentPerms.includes('admin') || (currentUser?.role?.toLowerCase() === 'admin' && currentPerms.length === 0);
    const hasManager = currentPerms.includes('manage_team') || (currentUser?.role?.toLowerCase() === 'manager' && currentPerms.length === 0);
    return hasAdmin || hasManager;
  })();

  const visibleUsers = (isAdminOrManager || isDedicatedTerminal)
    ? activeUsers
    : activeUsers.filter(s => s.userId === currentUser?.id);

  const selectedSession = selectedUserId ? activeSessions[selectedUserId] : null;

  // Filter tasks for the selected user with robust matching
  const userTasks = selectedSession
    ? scheduledTasks.filter(task => {
      const userId = String(selectedSession.userId);
      const userName = selectedSession.user.name.toLowerCase();
      const userUser = selectedSession.user.username?.toLowerCase();

      // Match by ID
      if (task.assignedTo && String(task.assignedTo) === userId) return true;

      // Match by Name fallback (if Replit API uses names in assignedTo)
      const assignedToName = String(task.assignedTo || '').toLowerCase();
      if (assignedToName === userName || (userUser && assignedToName === userUser)) return true;

      return false;
    })
    : [];

  // Auto-select if only one user (convenience)
  useEffect(() => {
    // If we're a standard user on our own profile, aggressively select ourselves if possible
    if (!isAdminOrManager && !isDedicatedTerminal && currentUser) {
      if (activeSessions[currentUser.id] && selectedUserId !== currentUser.id) {
        setSelectedUserId(currentUser.id);
      }
    } else if (visibleUsers.length === 1 && !selectedUserId) {
      setSelectedUserId(visibleUsers[0].userId);
    }

    // If selected user clocks out, reset
    if (selectedUserId && !activeSessions[selectedUserId]) {
      setSelectedUserId('');
      setIsLocked(false);
    }
  }, [activeSessions, selectedUserId]);

  // Check 60-minute interval for selected user
  useEffect(() => {
    if (!selectedSession) return;

    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - selectedSession.lastLogTime;
      setIsLocked(elapsed >= LOG_INTERVAL_MS);
    }, 1000);

    // Initial check
    const now = Date.now();
    setIsLocked(now - selectedSession.lastLogTime >= LOG_INTERVAL_MS);

    return () => clearInterval(checkInterval);
  }, [selectedSession]);


  // Standard Staff Not Clocked In View
  if (!isAdminOrManager && !isDedicatedTerminal && currentUser && !activeSessions[currentUser.id]) {
    const hasMobileClockIn = Array.isArray(currentUser.permissions)
      ? currentUser.permissions.includes('mobile_clock_in')
      : (typeof currentUser.permissions === 'string' && currentUser.permissions.includes('mobile_clock_in'));

    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center animate-fade-in relative overflow-hidden">
        {/* Decorative Background */}
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-50 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-indigo-50 rounded-full blur-3xl opacity-50 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-3xl font-bold shadow-xl mb-6 border-4 border-white">
            {currentUser.avatarInitials}
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome, {currentUser.name.split(' ')[0]}!</h2>
          <p className="text-gray-500 mb-8 max-w-sm">
            Access your personal dashboard, update your availability, or manage your active shift.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
            {hasMobileClockIn ? (
              <button
                onClick={() => onClockIn && onClockIn(currentUser)}
                className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-green-600/20 transition-all hover:scale-105 active:scale-95"
              >
                <Play className="w-5 h-5" />
                Start My Shift
              </button>
            ) : (
              <div className="w-full sm:w-auto bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3 text-left">
                <Lock className="w-6 h-6 text-gray-400 shrink-0" />
                <div className="text-sm text-gray-600">
                  <strong>Clock-in Disabled.</strong><br />
                  Please use the main iPad terminal to start your shift.
                </div>
              </div>
            )}

            <button
              onClick={() => setIsRequestingTimeOff(true)}
              className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-gray-200 hover:border-teal-300 hover:bg-teal-50 text-gray-700 font-bold py-3.5 px-6 rounded-xl transition-all shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Request Time Off
            </button>
            <button
              onClick={() => setIsEditingProfile(true)}
              className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-gray-700 font-bold py-3.5 px-6 rounded-xl transition-all shadow-sm"
            >
              <UserIcon className="w-4 h-4" />
              My Profile & Setup
            </button>
          </div>

          {/* List Previous Requests */}
          {currentUser.timeOffRequests && currentUser.timeOffRequests.length > 0 && (
            <div className="mt-8 w-full max-w-2xl text-left bg-white p-4 rounded-xl border border-gray-100 shadow-sm relative z-10">
              <h3 className="text-sm font-bold text-gray-800 mb-3 border-b border-gray-100 pb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-teal-500" />
                Your Time-Off history
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {[...currentUser.timeOffRequests].reverse().map((req: any) => (
                  <div key={req.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                    <div className="flex flex-col">
                      <span className="text-gray-900 font-bold">{new Date(req.startDate).toLocaleDateString()} - {new Date(req.endDate).toLocaleDateString()}</span>
                    </div>
                    <div>
                      <span className={`px-2 py-1 rounded-full font-bold ${req.status === 'Approved' ? 'bg-green-100 text-green-700' :
                        req.status === 'Denied' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>{req.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {isEditingProfile && (
          <UserProfileDialog
            isOpen={isEditingProfile}
            user={currentUser}
            onClose={() => setIsEditingProfile(false)}
            onSave={onUpdateUser || (() => { })}
            isViewerAdmin={false}
          />
        )}

        {isRequestingTimeOff && (
          <TimeOffRequestModal
            isOpen={isRequestingTimeOff}
            onClose={() => setIsRequestingTimeOff(false)}
            user={currentUser}
            onSave={onUpdateUser || (() => { })}
          />
        )}
      </div>
    );
  }

  // Dashboard Empty View (for Admins / Terminals)
  if (visibleUsers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center animate-fade-in">
        <div className="bg-gray-50 p-6 rounded-full mb-6">
          <Clock className="w-16 h-16 text-gray-300" />
        </div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">No Active Shifts</h3>
        <p className="text-gray-500 max-w-md">
          {(!isAdminOrManager && !isDedicatedTerminal) ? "You are not scheduled or clocked in." : "No team members are currently clocked in."}
        </p>
      </div>
    );
  }

  if (!selectedUserId) {
    return (
      <div className="max-w-3xl mx-auto py-10 animate-fade-in">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Who is using this device?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {visibleUsers.map(session => (
            <button
              key={session.userId}
              onClick={() => setSelectedUserId(session.userId)}
              className="bg-white hover:bg-blue-50 border-2 border-gray-100 hover:border-blue-200 p-6 rounded-xl transition-all shadow-sm hover:shadow-md flex flex-col items-center gap-3"
            >
              <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xl font-bold">
                {session.user.avatarInitials}
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-900">{session.user.name}</div>
                <div className="text-xs text-gray-500">{session.user.role}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedSession) return null; // Should not happen

  const getTaskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-50 border-green-200';
      case 'in_progress': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'delayed': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-orange-600 bg-orange-50 border-orange-200';
    }
  };

  const getTaskIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5" />;
      case 'delayed': return <AlertCircle className="w-5 h-5" />;
      default: return <Circle className="w-5 h-5" />;
    }
  };

  return (
    <div className="animate-fade-in relative">

      {/* Blocking Modal for Selected User */}
      {isLocked && (
        <div className="fixed inset-0 bg-gray-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl animate-in zoom-in-95 duration-200">
            <div className={`${selectedSession.isPaused ? 'bg-amber-600' : 'bg-red-600'} text-white px-6 py-4 rounded-t-xl flex items-center justify-between shadow-lg`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  {selectedSession.isPaused ? <Clock className="w-6 h-6 animate-pulse" /> : <Lock className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold">
                    {selectedSession.isPaused ? 'Shift Paused' : 'Session Locked'} for {selectedSession.user.name}
                  </h2>
                  <p className="text-red-100 text-sm">
                    {selectedSession.isPaused
                      ? 'Timer stopped. Submit a check-in to resume paid work.'
                      : 'Hourly check-in required to continue'}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="text-white font-mono text-sm px-3 py-1 bg-white/10 rounded-full border border-white/20">
                  {selectedSession.isPaused ? 'IDLE' : 'OVERDUE'}
                </div>
                <div className="text-[10px] font-bold text-white/70 uppercase">
                  {Math.floor((Date.now() - selectedSession.lastLogTime) / 60000)} mins since last log
                </div>
              </div>
            </div>
            <div className="bg-white shadow-2xl overflow-hidden p-1">
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase">Elapsed Shift (Paused)</span>
                <Timer
                  startTime={selectedSession.startTime}
                  isActive={false}
                  totalIdleTimeMs={selectedSession.totalIdleTimeMs}
                  currentIdleStartTime={selectedSession.currentIdleStartTime}
                />
              </div>
              <WorkLogForm
                onSubmit={(data) => {
                  onLogSubmit(selectedUserId, data);
                  setIsLocked(false);
                }}
                isRequired={true}
                title="Hourly Activity Summary"
              />

              {onManualSync && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Replit Sync Status</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onManualSync();
                      }}
                      disabled={isSyncingReplit}
                      className="flex items-center gap-2 text-xs font-bold text-blue-600 hover:text-blue-700 disabled:opacity-50 transition-all hover:scale-105 active:scale-95 px-2 py-1 rounded bg-blue-50/50"
                    >
                      <RefreshCcw className={`w-3.5 h-3.5 ${isSyncingReplit ? 'animate-spin' : ''}`} />
                      {isSyncingReplit ? 'Syncing...' : 'Check for Replit Check-in'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] mt-1">
                    <div className="text-gray-500 truncate max-w-[200px]">
                      {replitUrl ? `URL: ${replitUrl.replace('https://', '')}` : 'Missing Replit URL'}
                    </div>
                    <div className="text-gray-500">
                      {lastSyncTime > 0 ? (
                        <span>Last match: {new Date(lastSyncTime).toLocaleTimeString()}</span>
                      ) : (
                        <span>No matches yet</span>
                      )}
                    </div>
                  </div>

                  {syncError && (
                    <div className="mt-2 p-2 bg-red-50 rounded border border-red-100 flex items-center gap-2 text-[10px] text-red-600 font-medium animate-shake">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <div className="flex-1 break-words">
                        {syncError}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedSession.isPaused && (
                <div className="px-6 py-3 bg-amber-50 border-t border-amber-100 flex items-center gap-2 text-[10px] text-amber-700 font-bold justify-center rounded-b-xl">
                  <Play className="w-3 h-3 animate-pulse" />
                  SUBMIT LOG BELOW TO RESUME PAID TIME
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-10 h-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
            {selectedSession.user.avatarInitials}
          </div>
          <div>
            <div className="text-xs text-gray-500">Logged in as</div>
            <div className="font-bold text-gray-900 leading-none">{selectedSession.user.name}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full sm:w-auto">
          <div className="flex flex-col items-center sm:items-end w-full sm:w-auto bg-gray-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">Shift Time</div>
            <Timer
              startTime={selectedSession.startTime}
              isActive={!selectedSession.isPaused}
              totalIdleTimeMs={selectedSession.totalIdleTimeMs}
              currentIdleStartTime={selectedSession.currentIdleStartTime}
            />
          </div>

          <div className="hidden sm:block h-10 w-px bg-gray-100"></div>

          <div className="w-full sm:w-auto flex justify-center">
            <AiSummary logs={selectedSession.logs} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            {(!isAdminOrManager && !isDedicatedTerminal && currentUser?.id === selectedUserId) && (
              <>
                <button
                  onClick={() => setIsRequestingTimeOff(true)}
                  className="flex flex-1 sm:flex-none justify-center items-center gap-2 bg-gray-50 text-gray-700 hover:text-teal-600 px-3 py-1.5 hover:bg-teal-50 rounded-lg transition-colors border border-gray-200 hover:border-teal-200 text-sm font-bold"
                  title="Request Time Off"
                >
                  <Calendar className="w-4 h-4" /> <span className="sm:hidden">Time Off</span>
                </button>
                <button
                  onClick={() => setIsEditingProfile(true)}
                  className="flex flex-1 sm:flex-none justify-center items-center gap-2 bg-gray-50 text-gray-700 hover:text-blue-600 px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors border border-gray-200 hover:border-blue-200 text-sm font-bold"
                  title="My Profile & Setup"
                >
                  <UserIcon className="w-4 h-4" /> <span className="sm:hidden">Profile</span>
                </button>
              </>
            )}
            {onClockOut && (currentUser?.id === selectedUserId && (
              Array.isArray(currentUser.permissions) ? currentUser.permissions.includes('mobile_clock_in') : (typeof currentUser.permissions === 'string' && currentUser.permissions.includes('mobile_clock_in'))
            ) || isAdminOrManager || isDedicatedTerminal) && (
                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to end ${selectedSession.user.name}'s shift?`)) {
                      onClockOut(selectedSession.user);
                      setSelectedUserId('');
                    }
                  }}
                  className="flex flex-1 sm:flex-none items-center justify-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 px-4 py-1.5 font-bold rounded-lg transition-colors text-sm border border-red-200"
                >
                  Clock Out <span className="sm:hidden lg:inline"><LogOut className="w-4 h-4" /></span>
                </button>
              )}
            {(isAdminOrManager || isDedicatedTerminal) && (
              <button
                onClick={() => setSelectedUserId('')}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 bg-gray-50 text-gray-600 hover:text-gray-900 px-3 py-1.5 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200 text-sm font-bold"
              >
                <LogOut className="w-4 h-4" /> <span className="sm:hidden lg:inline">Back</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-7 space-y-6">
          {/* Scheduled Tasks Section */}
          {userTasks.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                Today's Scheduled Tasks ({userTasks.length})
              </h3>
              <div className="space-y-2">
                {userTasks.map(task => (
                  <div
                    key={task.id}
                    className={`p-3 rounded-lg border-l-4 ${getTaskStatusColor(task.status)} transition-all hover:shadow-sm`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-0.5">
                          {getTaskIcon(task.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm text-gray-900 mb-1">{task.title}</h4>
                          {task.description && (
                            <p className="text-xs text-gray-600 mb-2">{task.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(task.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} -
                              {new Date(task.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            {task.location && (
                              <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600">
                                📍 {task.location}
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded font-medium ${task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                              task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-600'
                              }`}>
                              {task.priority}
                            </span>
                          </div>

                          {/* Nested Check-ins from Replit */}
                          {task.checkIns && task.checkIns.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Check-ins:</div>
                              {task.checkIns.map((ci, idx) => {
                                const ts = ci.timestamp ? (typeof ci.timestamp === 'number' ? ci.timestamp : new Date(ci.timestamp).getTime()) : null;
                                const timeStr = ts && !isNaN(ts) ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '??:??';
                                const progress = ci.progressPercent !== undefined ? ci.progressPercent : ci.progress;
                                const status = ci.status || (progress !== undefined ? `Progress: ${progress}%` : 'Update');
                                return (
                                  <div key={idx} className="flex items-center gap-2 text-xs bg-gray-50/50 p-1.5 rounded border border-gray-100/50">
                                    <span className="text-gray-400 font-medium w-14">{timeStr}</span>
                                    <span className="text-blue-600 font-semibold">{status}</span>
                                    {ci.notes && <span className="text-gray-500 italic truncate">— {ci.notes}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-md">
            <h3 className="text-blue-900 font-bold flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5" />
              Activity Logger
            </h3>
            <p className="text-blue-700 text-sm mt-1">
              Log activity for {selectedSession.user.name}.
            </p>
          </div>

          <WorkLogForm
            onSubmit={(data) => onLogSubmit(selectedUserId, data)}
            title="Log Voluntary Activity"
          />
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Active Team Widget for Staff */}
          {!isAdminOrManager && !isDedicatedTerminal && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-500" />
                Active Team Members
              </h3>
              <div className="flex flex-wrap gap-2">
                {activeUsers.filter(u => u.userId !== currentUser?.id).map(session => (
                  <div key={session.userId} className="flex flex-col items-center gap-1 w-[60px]" title={session.user.name}>
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs relative border border-blue-200">
                      {session.user.avatarInitials}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                    </div>
                    <span className="text-[10px] text-gray-500 font-medium truncate w-full text-center leading-tight">{session.user.name.split(' ')[0]}</span>
                  </div>
                ))}
                {activeUsers.filter(u => u.userId !== currentUser?.id).length === 0 && (
                  <div className="text-sm text-gray-500 italic">No one else is online right now.</div>
                )}
              </div>
            </div>
          )}

          <HistoryLog logs={selectedSession.logs} onDelete={(id) => onDeleteLog(selectedUserId, id)} />
        </div>
      </div>
    </div>
  );
};