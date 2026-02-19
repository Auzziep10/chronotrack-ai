import React, { useState, useEffect } from 'react';
import { WorkLog, UserSession, ScheduleBlock } from '../types';
import { WorkLogForm } from './WorkLogForm';
import { HistoryLog } from './HistoryLog';
import { AiSummary } from './AiSummary';
import { LayoutDashboard, Clock, User as UserIcon, LogOut, Lock, CheckCircle2, Circle, AlertCircle, RefreshCcw } from 'lucide-react';
import { LOG_INTERVAL_MS } from '../constants';

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
  replitUrl = ''
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [isLocked, setIsLocked] = useState(false);

  const activeUsers = Object.values(activeSessions) as UserSession[];
  const selectedSession = selectedUserId ? activeSessions[selectedUserId] : null;

  // Filter tasks for the selected user
  const userTasks = selectedSession
    ? scheduledTasks.filter(task => task.assignedTo === selectedSession.userId)
    : [];

  // Auto-select if only one user (convenience)
  useEffect(() => {
    if (activeUsers.length === 1 && !selectedUserId) {
      setSelectedUserId(activeUsers[0].userId);
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


  if (activeUsers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center animate-fade-in">
        <div className="bg-gray-50 p-6 rounded-full mb-6">
          <Clock className="w-16 h-16 text-gray-300" />
        </div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">No Active Shifts</h3>
        <p className="text-gray-500 max-w-md">
          No team members are currently clocked in.
          Please go to the <strong>Master Station</strong> tab to start a shift.
        </p>
      </div>
    );
  }

  if (!selectedUserId) {
    return (
      <div className="max-w-3xl mx-auto py-10 animate-fade-in">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">Who is using this device?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {activeUsers.map(session => (
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
            <div className="bg-red-600 text-white px-6 py-4 rounded-t-xl flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Session Locked for {selectedSession.user.name}</h2>
                  <p className="text-red-100 text-sm">Hourly check-in required to continue</p>
                </div>
              </div>
              <div className="text-red-200 font-mono text-sm px-3 py-1 bg-white/10 rounded-full border border-white/20">
                OVERDUE
              </div>
            </div>
            <div className="bg-white rounded-b-xl shadow-2xl overflow-hidden p-1">
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
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">
            {selectedSession.user.avatarInitials}
          </div>
          <div>
            <div className="text-xs text-gray-500">Logged in as</div>
            <div className="font-bold text-gray-900 leading-none">{selectedSession.user.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <AiSummary logs={selectedSession.logs} />
          <button
            onClick={() => setSelectedUserId('')}
            className="text-gray-400 hover:text-red-500 p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Switch User"
          >
            <LogOut className="w-5 h-5" />
          </button>
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

        <div className="lg:col-span-5">
          <HistoryLog logs={selectedSession.logs} onDelete={(id) => onDeleteLog(selectedUserId, id)} />
        </div>
      </div>
    </div>
  );
};