import React, { useState, useEffect } from 'react';
import { WorkLog, UserSession, ScheduleBlock, AppSettings } from '../types';
import { WorkLogForm } from './WorkLogForm';
import { HistoryLog } from './HistoryLog';
import { AiSummary } from './AiSummary';
import { Timer } from './Timer';
import { LayoutDashboard, Clock, User as UserIcon, LogOut, Lock, CheckCircle2, Circle, AlertCircle, RefreshCcw, Play, Calendar, Users, MessageSquare } from 'lucide-react';


import { DiscordSetupModal } from './DiscordSetupModal';
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
  onUpdateTaskStatus?: (taskId: string, status: string, taskTitle: string, user: any) => void;
  appSettings?: AppSettings;
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
  onUpdateUser,
  onUpdateTaskStatus,
  appSettings
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);
  const [isDiscordSetupOpen, setIsDiscordSetupOpen] = useState(false);
  const [isRequestingTimeOff, setIsRequestingTimeOff] = useState(false);
  const [prefillNotes, setPrefillNotes] = useState<string>('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskNotes, setTaskNotes] = useState<string>('');

  const handleTaskClick = (taskId: string) => {
    if (expandedTaskId === taskId) {
      setExpandedTaskId(null);
      setTaskNotes('');
    } else {
      setExpandedTaskId(taskId);
      setTaskNotes('');
    }
  };

  const handleQuickLog = (task: any, pct: number) => {
    const session = activeSessions[selectedUserId];
    if (!session) return;
    
    onLogSubmit(selectedUserId, {
      department: session.user.primaryDepartment || 'Uncategorized' as any,
      task: task.title,
      notes: `[${pct}% Complete] ${taskNotes}`.trim()
    });

    if (onUpdateTaskStatus) {
       const status = pct === 100 ? 'completed' : 'in_progress';
       onUpdateTaskStatus(task.id, status, task.title, session.user);
    }
    setExpandedTaskId(null);
    setTaskNotes('');
    setIsLocked(false);
  };

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
      // Exclude main shift blocks from being displayed as individual tasks
      if (task.title && task.title.startsWith('[SHIFT]')) return false;

      // Only show tasks scheduled for today
      const taskDate = new Date(task.startTime);
      const today = new Date();
      const isToday = taskDate.getDate() === today.getDate() &&
                      taskDate.getMonth() === today.getMonth() &&
                      taskDate.getFullYear() === today.getFullYear();
      
      if (!isToday) return false;


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

  // Check interval for selected user
  useEffect(() => {
    if (!selectedSession) return;
    const intervalMs = (appSettings?.checkInIntervalHours || 1) * 60 * 60 * 1000;

    const checkInterval = setInterval(() => {
      if (!appSettings?.autoPauseEnabled) {
        setIsLocked(false);
        return;
      }
      const now = Date.now();
      const elapsed = now - selectedSession.lastLogTime;
      setIsLocked(elapsed >= intervalMs);
    }, 1000);

    // Initial check
    if (!appSettings?.autoPauseEnabled) {
      setIsLocked(false);
    } else {
      const now = Date.now();
      setIsLocked(now - selectedSession.lastLogTime >= intervalMs);
    }

    return () => clearInterval(checkInterval);
  }, [selectedSession, appSettings]);


  // Standard Staff Not Clocked In View
  if (!isAdminOrManager && !isDedicatedTerminal && currentUser && !activeSessions[currentUser.id]) {
    const hasMobileClockIn = Array.isArray(currentUser.permissions)
      ? currentUser.permissions.includes('mobile_clock_in')
      : (typeof currentUser.permissions === 'string' && currentUser.permissions.includes('mobile_clock_in'));

    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] bg-white rounded-2xl shadow-sm border border-zinc-100 p-8 text-center animate-fade-in relative overflow-hidden">
        {/* Decorative Background */}
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-zinc-50 rounded-full blur-3xl opacity-50 pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-zinc-50 rounded-full blur-3xl opacity-50 pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-zinc-900 text-white text-white flex items-center justify-center text-3xl font-bold shadow-xl mb-6 border-4 border-white">
            {currentUser.avatarInitials || (currentUser.firstName ? currentUser.firstName[0].toUpperCase() : (currentUser.name ? currentUser.name[0].toUpperCase() : '?'))}
          </div>
          <h2 className="text-2xl font-bold text-zinc-800 mb-2">
            Welcome, {currentUser.firstName || (currentUser.name ? currentUser.name.split(' ')[0] : (currentUser.username || 'Team Member'))}!
          </h2>
          <p className="text-zinc-500 mb-8 max-w-sm">
            Access your personal dashboard, update your availability, or manage your active shift.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
            {hasMobileClockIn ? (
              <button
                onClick={() => onClockIn && onClockIn(currentUser)}
                className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold py-4 px-8 rounded-xl shadow-lg shadow-zinc-900/20 transition-all hover:scale-105 active:scale-95"
              >
                <Play className="w-5 h-5" />
                Start My Shift
              </button>
            ) : (
              <div className="w-full sm:w-auto bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-center gap-3 text-left">
                <Lock className="w-6 h-6 text-zinc-400 shrink-0" />
                <div className="text-sm text-zinc-600">
                  <strong>Clock-in Disabled.</strong><br />
                  Please use the main iPad terminal to start your shift.
                </div>
              </div>
            )}

            <button
              onClick={() => setIsRequestingTimeOff(true)}
              className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-bold py-3.5 px-6 rounded-xl transition-all shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Request Time Off
            </button>
            <button
              onClick={() => setIsDiscordSetupOpen(true)}
              className="flex-1 sm:flex-none w-full sm:w-auto flex items-center justify-center gap-2 bg-white border-2 border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-bold py-3.5 px-6 rounded-xl transition-all shadow-sm"
            >
              <MessageSquare className="w-4 h-4" />
              Discord Alerts
            </button>
          </div>

          {/* List Previous Requests */}
          {currentUser.timeOffRequests && currentUser.timeOffRequests.length > 0 && (
            <div className="mt-8 w-full max-w-2xl text-left bg-white p-4 rounded-xl border border-zinc-100 shadow-sm relative z-10">
              <h3 className="text-sm font-bold text-zinc-800 mb-3 border-b border-zinc-100 pb-2 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-500" />
                Your Time-Off history
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                {[...currentUser.timeOffRequests].reverse().map((req: any) => (
                  <div key={req.id} className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 border border-zinc-100 text-xs">
                    <div className="flex flex-col">
                      <span className="text-zinc-900 font-bold">{new Date(req.startDate).toLocaleDateString()} - {new Date(req.endDate).toLocaleDateString()}</span>
                    </div>
                    <div>
                      <span className={`px-2 py-1 rounded-full font-bold ${req.status === 'Approved' ? 'bg-zinc-100 text-zinc-800' :
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

        {isDiscordSetupOpen && (
          <DiscordSetupModal
            isOpen={isDiscordSetupOpen}
            user={currentUser}
            onClose={() => setIsDiscordSetupOpen(false)}
            onSave={onUpdateUser || (() => { })}
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
      <div className="flex flex-col items-center justify-center h-96 bg-white rounded-2xl shadow-sm border border-zinc-100 p-8 text-center animate-fade-in">
        <div className="bg-zinc-50 p-6 rounded-full mb-6">
          <Clock className="w-16 h-16 text-zinc-300" />
        </div>
        <h3 className="text-xl font-bold text-zinc-800 mb-2">No Active Shifts</h3>
        <p className="text-zinc-500 max-w-md">
          {(!isAdminOrManager && !isDedicatedTerminal) ? "You are not scheduled or clocked in." : "No team members are currently clocked in."}
        </p>
      </div>
    );
  }

  if (!selectedUserId) {
    return (
      <div className="max-w-3xl mx-auto py-10 animate-fade-in">
        <h2 className="text-2xl font-bold text-zinc-800 mb-6 text-center">Who is using this device?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {visibleUsers.map(session => (
            <button
              key={session.userId}
              onClick={() => setSelectedUserId(session.userId)}
              className="bg-white hover:bg-zinc-50 border-2 border-zinc-100 hover:border-zinc-200 p-6 rounded-xl transition-all shadow-sm hover:shadow-md flex flex-col items-center gap-3"
            >
              <div className="w-16 h-16 rounded-full bg-zinc-100 text-zinc-800 flex items-center justify-center text-xl font-bold">
                {session.user.avatarInitials}
              </div>
              <div className="text-center">
                <div className="font-bold text-zinc-900">{session.user.name}</div>
                <div className="text-xs text-zinc-500">{session.user.role}</div>
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
      case 'completed': return 'text-green-900 bg-green-50 border-green-500';
      case 'in_progress': return 'text-blue-900 bg-blue-50 border-blue-500';
      case 'delayed': return 'text-red-900 bg-red-50 border-red-500';
      default: return 'text-orange-600 bg-orange-50 border-orange-300';
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
        <div className="fixed inset-0 bg-zinc-900/90 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl animate-in zoom-in-95 duration-200">
            <div className={`${selectedSession.isPaused ? 'bg-amber-600' : 'bg-red-600'} text-white px-6 py-4 rounded-t-xl flex items-center justify-between shadow-lg`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  {selectedSession.isPaused ? <Clock className="w-6 h-6 animate-pulse" /> : <Lock className="w-6 h-6" />}
                </div>
                <div>
                  <h2 className="text-lg font-bold">
                    {selectedSession.isPaused
                      ? (selectedSession.pauseReason === 'lunch' ? 'On Lunch' : 'Shift Paused')
                      : 'Session Locked'} for {selectedSession.user.name}
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
              <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-500 uppercase">Elapsed Shift (Paused)</span>
                <Timer
                  startTime={selectedSession.startTime}
                  isActive={false}
                  totalIdleTimeMs={selectedSession.totalIdleTimeMs}
                  currentIdleStartTime={selectedSession.currentIdleStartTime}
                />
              </div>

              {/* Scheduled Tasks View in Modal */}
              {userTasks.length > 0 && (
                <div className="px-6 py-4 border-b border-zinc-100 bg-white">
                  <h3 className="text-sm font-bold text-zinc-700 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-zinc-500" />
                    Today's Scheduled Tasks
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                    {userTasks.map(task => (
                      <div
                        key={task.id}
                        onClick={() => handleTaskClick(task.id)}
                        className={`p-2.5 rounded-lg border-l-4 ${getTaskStatusColor(task.status)} bg-zinc-50/50 text-sm cursor-pointer hover:bg-zinc-100 transition-colors`}
                      >
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            {getTaskIcon(task.status)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-zinc-900 leading-tight">{task.title}</h4>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-500 mt-1 uppercase tracking-wider font-semibold">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(task.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} -
                                {new Date(task.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                              </span>
                              {task.priority && task.priority !== 'medium' && task.priority !== 'low' && (
                                <span className={`px-1.5 py-0.5 rounded ${task.priority === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                                  {task.priority}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Expanded Quick Log Form */}
                        {expandedTaskId === task.id && (
                          <div className="mt-4 pt-4 border-t border-zinc-200/50 space-y-3" onClick={(e) => e.stopPropagation()}>
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Optional Notes</label>
                              <textarea
                                value={taskNotes}
                                onChange={(e) => setTaskNotes(e.target.value)}
                                className="w-full text-sm border border-zinc-200 rounded p-2 focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 bg-white"
                                placeholder="What are you currently working on?"
                                rows={1}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Log Progress to Submit</label>
                              <div className="flex gap-2">
                                {[0, 25, 50, 75, 100].map(pct => (
                                  <button
                                    key={pct}
                                    onClick={() => handleQuickLog(task, pct)}
                                    className={`flex-1 py-1.5 rounded border text-sm font-bold transition-all ${
                                      pct === 100 
                                        ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-600 hover:text-white hover:border-green-600' 
                                        : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
                                    }`}
                                  >
                                    {pct}%
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <WorkLogForm
                onSubmit={(data) => {
                  onLogSubmit(selectedUserId, data);
                  setIsLocked(false);
                }}
                isRequired={true}
                title="Hourly Activity Summary"
              />

              {onManualSync && (
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight">Replit Sync Status</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onManualSync();
                      }}
                      disabled={isSyncingReplit}
                      className="flex items-center gap-2 text-xs font-bold text-zinc-900 hover:text-zinc-700 disabled:opacity-50 transition-all hover:scale-105 active:scale-95 px-2 py-1 rounded bg-zinc-50/50"
                    >
                      <RefreshCcw className={`w-3.5 h-3.5 ${isSyncingReplit ? 'animate-spin' : ''}`} />
                      {isSyncingReplit ? 'Syncing...' : 'Check for Replit Check-in'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] mt-1">
                    <div className="text-zinc-500 truncate max-w-[200px]">
                      {replitUrl ? `URL: ${replitUrl.replace('https://', '')}` : 'Missing Replit URL'}
                    </div>
                    <div className="text-zinc-500">
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

      <div className="flex flex-col sm:flex-row items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-zinc-100 gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-10 h-10 shrink-0 rounded-full bg-zinc-900 text-white flex items-center justify-center text-sm font-bold">
            {selectedSession.user.avatarInitials}
          </div>
          <div>
            <div className="text-xs text-zinc-500">Logged in as</div>
            <div className="font-bold text-zinc-900 leading-none">{selectedSession.user.name}</div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6 w-full sm:w-auto">
          <div className="flex flex-col items-center sm:items-end w-full sm:w-auto bg-zinc-50 sm:bg-transparent p-2 sm:p-0 rounded-lg">
            <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight">Shift Time</div>
            <Timer
              startTime={selectedSession.startTime}
              isActive={!selectedSession.isPaused}
              totalIdleTimeMs={selectedSession.totalIdleTimeMs}
              currentIdleStartTime={selectedSession.currentIdleStartTime}
            />
          </div>

          <div className="hidden sm:block h-10 w-px bg-zinc-100"></div>

          <div className="w-full sm:w-auto flex justify-center">
            <AiSummary logs={selectedSession.logs} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto mt-2 sm:mt-0">
            {(!isDedicatedTerminal && currentUser?.id === selectedUserId) && (
              <button
                onClick={() => setIsRequestingTimeOff(true)}
                className="flex flex-1 sm:flex-none justify-center items-center gap-2 bg-zinc-50 text-zinc-700 hover:text-zinc-900 px-3 py-1.5 hover:bg-zinc-50 rounded-lg transition-colors border border-zinc-200 hover:border-zinc-200 text-sm font-bold"
                title="Request Time Off"
              >
                <Calendar className="w-4 h-4" /> <span className="sm:hidden">Time Off</span>
              </button>
            )}
            {((!isDedicatedTerminal && currentUser?.id === selectedUserId) || isAdminOrManager) && (
              <button
                onClick={() => setIsDiscordSetupOpen(true)}
                className="flex flex-1 sm:flex-none justify-center items-center gap-2 bg-zinc-50 text-zinc-700 hover:text-zinc-900 px-3 py-1.5 hover:bg-zinc-50 rounded-lg transition-colors border border-zinc-200 hover:border-zinc-200 text-sm font-bold"
                title="Discord Alerts"
              >
                <MessageSquare className="w-4 h-4" /> <span className="sm:hidden">Alerts</span>
              </button>
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
                  className="flex flex-1 sm:flex-none items-center justify-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 border border-zinc-200 shadow-sm px-4 py-1.5 font-bold rounded-lg transition-colors text-sm border border-red-200"
                >
                  Clock Out <span className="sm:hidden lg:inline"><LogOut className="w-4 h-4" /></span>
                </button>
              )}
            {(isAdminOrManager || isDedicatedTerminal) && (
              <button
                onClick={() => setSelectedUserId('')}
                className="flex flex-1 sm:flex-none items-center justify-center gap-2 bg-zinc-50 text-zinc-600 hover:text-zinc-900 px-3 py-1.5 hover:bg-zinc-100 rounded-lg transition-colors border border-zinc-200 text-sm font-bold"
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
            <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-4">
              <h3 className="text-sm font-bold text-zinc-700 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-zinc-500" />
                Today's Scheduled Tasks ({userTasks.length})
              </h3>
              <div className="space-y-2">
                {userTasks.map(task => (
                  <div
                    key={task.id}
                    onClick={() => handleTaskClick(task.id)}
                    className={`p-3 rounded-lg border-l-4 ${getTaskStatusColor(task.status)} transition-all hover:shadow-md cursor-pointer`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="mt-0.5">
                          {getTaskIcon(task.status)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm text-zinc-900 mb-1">{task.title}</h4>
                          {task.description && (
                            <p className="text-xs text-zinc-600 mb-2">{task.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(task.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} -
                              {new Date(task.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </span>
                            {task.location && (
                              <span className="px-2 py-0.5 bg-zinc-100 rounded text-zinc-600">
                                📍 {task.location}
                              </span>
                            )}
                            <span className={`px-2 py-0.5 rounded font-medium ${task.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                              task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                task.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-zinc-100 text-zinc-600'
                              }`}>
                              {task.priority}
                            </span>
                          </div>

                          {/* Nested Check-ins from Replit */}
                          {task.checkIns && task.checkIns.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-zinc-100 space-y-1.5">
                              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1">Check-ins:</div>
                              {task.checkIns.map((ci: any, idx: number) => {
                                const ts = ci.timestamp ? (typeof ci.timestamp === 'number' ? ci.timestamp : new Date(ci.timestamp).getTime()) : null;
                                const timeStr = ts && !isNaN(ts) ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '??:??';
                                const progress = ci.progressPercent !== undefined ? ci.progressPercent : ci.progress;
                                const status = ci.status || (progress !== undefined ? `Progress: ${progress}%` : 'Update');
                                return (
                                  <div key={idx} className="flex items-center gap-2 text-xs bg-zinc-50/50 p-1.5 rounded border border-zinc-100/50">
                                    <span className="text-zinc-400 font-medium w-14">{timeStr}</span>
                                    <span className="text-zinc-900 font-semibold">{status}</span>
                                    {ci.notes && <span className="text-zinc-500 italic truncate">— {ci.notes}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}


                          {/* Expanded Quick Log Form */}
                          {expandedTaskId === task.id && (!isDedicatedTerminal && currentUser?.id === selectedUserId || isAdminOrManager) && (
                            <div className="mt-4 pt-4 border-t border-zinc-200/50 space-y-3" onClick={(e) => e.stopPropagation()}>
                              <div>
                                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Optional Notes</label>
                                <textarea
                                  value={taskNotes}
                                  onChange={(e) => setTaskNotes(e.target.value)}
                                  className="w-full text-sm border border-zinc-200 rounded p-2 focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 bg-white"
                                  placeholder="What are you currently working on?"
                                  rows={1}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Log Progress to Submit</label>
                                <div className="flex gap-2">
                                  {[0, 25, 50, 75, 100].map(pct => (
                                    <button
                                      key={pct}
                                      onClick={() => handleQuickLog(task, pct)}
                                      className={`flex-1 py-1.5 rounded border text-sm font-bold transition-all ${
                                        pct === 100 
                                          ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-600 hover:text-white hover:border-green-600' 
                                          : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-900 hover:text-white hover:border-zinc-900'
                                      }`}
                                    >
                                      {pct}%
                                    </button>
                                  ))}
                                </div>
                              </div>
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

          <div className="bg-zinc-50 border-l-4 border-zinc-300 p-4 rounded-r-md">
            <h3 className="text-zinc-900 font-bold flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5" />
              Activity Logger
            </h3>
            <p className="text-zinc-800 text-sm mt-1">
              Log activity for {selectedSession.user.name}.
            </p>
          </div>

          <div id="work-log-form">
            <WorkLogForm
              onSubmit={(data) => {
                onLogSubmit(selectedUserId, data);
                setPrefillNotes(''); // clear after submission
              }}
              title="Log Voluntary Activity"
              prefillNotes={prefillNotes}
              initialDepartment={selectedSession?.user?.primaryDepartment}
            />
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Active Team Widget for Staff */}
          {!isAdminOrManager && !isDedicatedTerminal && (
            <div className="bg-white rounded-xl shadow-sm border border-zinc-100 p-4">
              <h3 className="text-sm font-bold text-zinc-700 mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-zinc-500" />
                Active Team Members
              </h3>
              <div className="flex flex-wrap gap-2">
                {activeUsers.filter(u => u.userId !== currentUser?.id).map(session => (
                  <div key={session.userId} className="flex flex-col items-center gap-1 w-[60px]" title={session.user.name}>
                    <div className="w-10 h-10 rounded-full bg-zinc-100 text-zinc-800 font-bold flex items-center justify-center text-xs relative border border-zinc-200">
                      {session.user.avatarInitials}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-zinc-500 border-2 border-white rounded-full"></div>
                    </div>
                    <span className="text-[10px] text-zinc-500 font-medium truncate w-full text-center leading-tight">{session.user.name.split(' ')[0]}</span>
                  </div>
                ))}
                {activeUsers.filter(u => u.userId !== currentUser?.id).length === 0 && (
                  <div className="text-sm text-zinc-500 italic">No one else is online right now.</div>
                )}
              </div>
            </div>
          )}

          <HistoryLog logs={selectedSession.logs} onDelete={(id) => onDeleteLog(selectedUserId, id)} />
        </div>
      </div>

      {isDiscordSetupOpen && (
        <DiscordSetupModal
          isOpen={isDiscordSetupOpen}
          user={selectedSession?.user || currentUser}
          onClose={() => setIsDiscordSetupOpen(false)}
          onSave={onUpdateUser || (() => { })}
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
};