import React, { useState } from 'react';
import { UserSession, User, AppSettings, Department, ScheduleBlock } from '../types';
import { Timer } from './Timer';
import { PinPad } from './PinPad';
import { Play, Pause, ShieldCheck, User as UserIcon, LogOut, CheckCircle2, QrCode as QrCodeIcon, X, Bell } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';


interface Props {
  activeSessions: Record<string, UserSession>;
  users: User[];
  onClockIn: (user: User, clockInDepartment?: string, isUnscheduled?: boolean) => void;
  onClockOut: (user: User) => void;
  onPauseSession?: (user: User) => void;
  onResumeSession?: (user: User) => void;
  isAdmin?: boolean;
  appSettings?: AppSettings;
  onUpdateSettings?: (settings: AppSettings) => void;
  shiftBlocks?: ScheduleBlock[];
}

export const TimeStation: React.FC<Props> = ({ activeSessions, users, onClockIn, onClockOut, onPauseSession, onResumeSession, isAdmin, appSettings, onUpdateSettings, shiftBlocks }) => {
  const [showPinPad, setShowPinPad] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [pinMessage, setPinMessage] = useState<string>('');
  const [actionMenuUser, setActionMenuUser] = useState<User | null>(null);
  const [unscheduledUser, setUnscheduledUser] = useState<User | null>(null);

  const handlePinAction = () => {
    setPinMessage('');
    setActionMenuUser(null);
    setShowPinPad(true);
  };

  const handlePinSuccess = (user: User) => {
    const isClockedIn = !!activeSessions[user.id];

    if (isClockedIn) {
      // Open the action menu instead of instantly clocking out
      setActionMenuUser(user);
      setShowPinPad(false);
    } else {
      // Check if they are scheduled right now
      const now = new Date();
      const currentShift = shiftBlocks?.find(b => {
        if (b.assignedTo !== user.id || !b.title.startsWith('[SHIFT]')) return false;
        const start = new Date(b.startTime);
        
        // Match if the shift is scheduled for today
        return (
          start.getDate() === now.getDate() &&
          start.getMonth() === now.getMonth() &&
          start.getFullYear() === now.getFullYear()
        );
      });

      if (currentShift) {
        // Scheduled - clock in immediately
        onClockIn(user, currentShift.department, false);
        setPinMessage(`Welcome, ${user.name}! Clocked in successfully.`);
        setTimeout(() => {
          setShowPinPad(false);
          setPinMessage('');
        }, 1500);
      } else {
        // Unscheduled - ask for department
        setUnscheduledUser(user);
        setShowPinPad(false);
      }
    }
  };

  if (showPinPad) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-10 space-y-6">
        {pinMessage ? (
          <div className="bg-zinc-100 border border-zinc-200 text-zinc-800 px-6 py-4 rounded-xl flex items-center gap-3 text-lg font-bold animate-fade-in">
            <CheckCircle2 className="w-8 h-8" />
            {pinMessage}
          </div>
        ) : (
          <PinPad
            mode="IN" // Mode is generic here, action determined by user state
            users={users}
            onSuccess={handlePinSuccess}
            onCancel={() => setShowPinPad(false)}
          />
        )}
      </div>
    );
  }

  if (unscheduledUser) {
    return (
      <div className="max-w-2xl mx-auto py-12 animate-fade-in">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-zinc-100 text-center">
          <div className="bg-amber-500 p-8 text-white">
            <h2 className="text-3xl font-bold mb-2">Unscheduled Shift</h2>
            <p className="text-amber-50">You do not have a shift scheduled right now.</p>
          </div>
          <div className="p-8">
            <h3 className="text-xl font-bold text-zinc-800 mb-6">Select your department for this session:</h3>
            <div className="flex flex-wrap justify-center gap-3">
              {Object.values(Department).map(dept => (
                <button
                  key={dept}
                  onClick={() => {
                    onClockIn(unscheduledUser, dept, true);
                    setPinMessage(`Welcome, ${unscheduledUser.name}! Clocked in (Unscheduled).`);
                    setUnscheduledUser(null);
                    setShowPinPad(true);
                    setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 2000);
                  }}
                  className="px-6 py-3 rounded-full bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 font-bold text-zinc-800 transition-colors"
                >
                  {dept}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setUnscheduledUser(null); setShowPinPad(true); }}
              className="mt-8 text-zinc-500 hover:text-zinc-800 font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (actionMenuUser) {
    const session = activeSessions[actionMenuUser.id];
    if (!session) {
      setActionMenuUser(null);
      return null;
    }

    const isPaused = session.isPaused;

    return (
      <div className="max-w-2xl mx-auto py-12 animate-fade-in">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-zinc-100">
          <div className="bg-black p-8 text-center text-white">
            <div className="w-16 h-16 bg-white/10 rounded-full mx-auto flex items-center justify-center text-2xl font-bold mb-4 border border-white/20">
              {actionMenuUser.avatarInitials}
            </div>
            <h2 className="text-3xl font-bold mb-2">Hello, {actionMenuUser.name}</h2>
            <p className="text-zinc-300">What would you like to do?</p>
          </div>
          <div className="p-8 space-y-4 bg-zinc-50">
            {isPaused ? (
              <button
                onClick={() => {
                  onResumeSession && onResumeSession(actionMenuUser);
                  setPinMessage(`Welcome back from lunch, ${actionMenuUser.name}!`);
                  setActionMenuUser(null);
                  setShowPinPad(true);
                  setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 2000);
                }}
                className="w-full bg-zinc-900 hover:bg-zinc-800 text-white p-6 rounded-2xl shadow-sm text-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
              >
                <Play className="w-6 h-6" /> Resume Shift (Return from Lunch)
              </button>
            ) : (
              <button
                onClick={() => {
                  onPauseSession && onPauseSession(actionMenuUser);
                  setPinMessage(`Enjoy your lunch, ${actionMenuUser.name}!`);
                  setActionMenuUser(null);
                  setShowPinPad(true);
                  setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 2000);
                }}
                className="w-full bg-amber-500 hover:bg-amber-600 text-white p-6 rounded-2xl shadow-sm text-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
              >
                <Pause className="w-6 h-6" /> Take Lunch Break (Pause Shift)
              </button>
            )}

            <button
              onClick={() => {
                onClockOut(actionMenuUser);
                setPinMessage(`Goodbye, ${actionMenuUser.name}! Clocked out for the day.`);
                setActionMenuUser(null);
                setShowPinPad(true);
                setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 2000);
              }}
              className="w-full bg-red-600 hover:bg-red-700 text-white p-6 rounded-2xl shadow-sm text-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
            >
              <LogOut className="w-6 h-6" /> Clock Out For the Day
            </button>

            <button
              onClick={() => setActionMenuUser(null)}
              className="w-full mt-4 bg-transparent border-2 border-zinc-300 text-zinc-500 hover:bg-zinc-200 p-4 rounded-2xl font-bold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  const sessionsList = Object.values(activeSessions) as UserSession[];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
      {/* Left Column: Clock In/Out Action */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-zinc-100 h-full flex flex-col">
          <div className="bg-black p-8 text-white text-center">
            <h2 className="text-3xl font-bold mb-2">Master Time Station</h2>
            <p className="text-zinc-300">Identify yourself to start or end your shift.</p>
          </div>

          <div className="p-10 flex-1 flex flex-col items-center justify-center space-y-8">
            <div className="p-6 bg-zinc-50 rounded-full cursor-pointer hover:bg-zinc-100 transition-colors" onClick={handlePinAction}>
              <ShieldCheck className="w-20 h-20 text-zinc-900" />
            </div>

            <button
              onClick={handlePinAction}
              className="w-full max-w-xs flex flex-col items-center justify-center gap-3 px-8 py-6 bg-zinc-900 hover:bg-zinc-800 text-white rounded-2xl shadow-lg shadow-zinc-200 font-bold text-xl transition-all hover:scale-105 active:scale-95"
            >
              <span>Enter PIN</span>
              <span className="text-sm font-normal opacity-80">Clock In / Clock Out</span>
            </button>

            <button
              onClick={() => setShowQR(true)}
              className="w-full max-w-xs flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-zinc-200 hover:border-zinc-800 hover:text-zinc-800 hover:bg-zinc-50 text-zinc-600 rounded-2xl shadow-sm font-bold text-md transition-all active:scale-95"
            >
              <QrCodeIcon className="w-5 h-5" />
              Scan to Login
            </button>

            <p className="text-center text-zinc-400 text-sm max-w-xs">
              Enter your 4-digit PIN. The system will automatically clock you in or out based on your current status.
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Active Users Dashboard */}
      <div className="lg:col-span-7">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 flex flex-wrap justify-between items-center gap-4 bg-zinc-50">
            <h3 className="text-lg font-bold text-zinc-800 flex items-center gap-2 whitespace-nowrap">
              <UserIcon className="w-5 h-5 text-zinc-900 shrink-0" />
              Active Team Members ({sessionsList.length})
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              {isAdmin && (
                <>
                  <button
                    onClick={() => {
                      if (onUpdateSettings && appSettings) {
                        onUpdateSettings({
                          ...appSettings,
                          autoPauseEnabled: !(appSettings.autoPauseEnabled ?? true)
                        });
                      }
                    }}
                    className={`text-xs border rounded-full px-3 py-1.5 font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap shadow-sm ${
                      (appSettings?.autoPauseEnabled ?? true) 
                        ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200' 
                        : 'bg-zinc-100 text-zinc-500 border-zinc-300 hover:bg-zinc-200'
                    }`}
                    title="Toggle automatic shift pause when idle"
                  >
                    <Pause className="w-3 h-3 shrink-0" />
                    Auto-Pause {(appSettings?.autoPauseEnabled ?? true) ? 'ON' : 'OFF'}
                  </button>
                  <select
                    className="text-xs border border-zinc-300 rounded-lg px-3 py-1.5 bg-white cursor-pointer font-bold text-zinc-900 shadow-sm"
                    onChange={(e) => {
                      const u = users.find(u => u.id === e.target.value);
                      if (u) {
                        onClockIn(u, u.primaryDepartment, true);
                        e.target.value = '';
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>+ Admin Clock In</option>
                    {users.filter(u => !activeSessions[u.id]).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </>
              )}
              <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium bg-white border border-zinc-200 px-3 py-1.5 rounded-lg shadow-sm whitespace-nowrap">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)] shrink-0"></span>
                Live Tracking
              </div>
            </div>
          </div>

          {sessionsList.length === 0 ? (
            <div className="p-12 text-center text-zinc-400 flex flex-col items-center">
              <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
                <LogOut className="w-8 h-8 text-zinc-300" />
              </div>
              <p>No one is currently clocked in.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 max-h-[600px] overflow-y-auto">
              {sessionsList.map(session => {
                const now = Date.now();
                const elapsedSinceLog = now - session.lastLogTime;
                const intervalMs = (appSettings?.checkInIntervalHours || 1) * 60 * 60 * 1000;
                // Only mark as overdue/at-risk if Auto-Pause is actually enabled
                const isOverdue = appSettings?.autoPauseEnabled ? elapsedSinceLog > intervalMs : false;

                return (
                  <div key={session.userId} className={`p-4 rounded-xl border-2 transition-all hover:shadow-md
                    ${session.isPaused ? 'border-amber-200 bg-amber-50 shadow-inner' :
                      isOverdue ? 'border-red-100 bg-red-50' : 'border-zinc-100 bg-white'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm
                        ${session.isPaused ? 'bg-amber-500' : isOverdue ? 'bg-red-400' : 'bg-zinc-500'}`}>
                        {session.user.avatarInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-zinc-900 truncate">{session.user.name}</h4>
                        <p className="text-xs text-zinc-500 truncate">{session.user.role}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-zinc-500">Shift Time:</span>
                        <Timer
                          startTime={session.startTime}
                          isActive={!session.isPaused}
                          totalIdleTimeMs={session.totalIdleTimeMs}
                          currentIdleStartTime={session.currentIdleStartTime}
                        />
                      </div>

                      {session.isPaused ? (
                        <div className="flex items-center gap-2 text-xs text-amber-700 font-bold bg-amber-200 px-2 py-1 rounded animate-pulse">
                          <Pause className="w-3 h-3" />
                          <span>{session.pauseReason === 'lunch' ? 'ON LUNCH (PAUSED)' : 'SHIFT PAUSED (IDLE)'}</span>
                        </div>
                      ) : isOverdue && (
                        <div className="flex items-center gap-2 text-xs text-red-600 font-semibold bg-red-100 px-2 py-1 rounded">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Check-in Required</span>
                        </div>
                      )}

                      <div className="text-xs text-zinc-400 pt-2 border-t border-zinc-100 mt-2 flex justify-between items-center">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                          <span>Last Log: {new Date(session.lastLogTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {!session.isPaused && (appSettings?.autoPauseEnabled ?? true) && (
                            <span className="flex items-center gap-1 text-amber-600/80 font-medium bg-amber-50/50 px-1.5 py-0.5 rounded border border-amber-100/50 w-fit">
                              <Pause className="w-2.5 h-2.5" />
                              Auto-pauses at {new Date(session.lastLogTime + ((appSettings?.checkInIntervalHours || 1) * 60 * 60 * 1000) + (10 * 60 * 1000)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const currentUserDoc = users.find(u => u.id === session.userId) || session.user;
                                if (!currentUserDoc.expoPushToken) {
                                  alert(`${currentUserDoc.name} has not registered for push notifications on their mobile device yet.`);
                                  return;
                                }
                                fetch('https://exp.host/--/api/v2/push/send', {
                                  method: 'POST',
                                  headers: {
                                    Accept: 'application/json',
                                    'Accept-encoding': 'gzip, deflate',
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    to: currentUserDoc.expoPushToken,
                                    sound: 'default',
                                    title: 'Test Push 🔔',
                                    body: `Hello ${currentUserDoc.name}, this is a test notification!`,
                                  }),
                                }).then(res => {
                                  if (res.ok) {
                                    alert(`Test push sent to ${session.user.name}!`);
                                  } else {
                                    alert("Failed to send notification.");
                                  }
                                }).catch(err => {
                                  console.error("Push error:", err);
                                  alert("Error sending push notification.");
                                });
                              }}
                              className="bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2 py-1 rounded text-xs font-bold transition-colors flex items-center gap-1 shrink-0"
                              title="Test iOS Push Notification"
                            >
                              <Bell className="w-3 h-3" />
                              Ping
                            </button>
                            <button
                              onClick={() => onClockOut(session.user)}
                              className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded text-xs font-bold transition-colors shrink-0"
                            >
                              Clock Out
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* QR Code Dialog */}
      {
        showQR && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-6 flex justify-between items-center border-b border-zinc-100 bg-zinc-50">
                <div className="flex items-center gap-3">
                  <div className="bg-zinc-800 p-2 rounded-lg text-white">
                    <QrCodeIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-zinc-900 leading-tight">Staff Portal Login</h3>
                    <p className="text-xs text-zinc-500 font-medium">Scan to open on your device</p>
                  </div>
                </div>
                <button onClick={() => setShowQR(false)} className="text-zinc-400 hover:text-zinc-800 transition-colors p-2 hover:bg-zinc-200 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-10 flex flex-col items-center bg-white justify-center">
                <div className="p-4 bg-white border-4 border-zinc-100 rounded-2xl shadow-inner inline-block mb-6">
                  <QRCodeSVG
                    value={window.location.href}
                    size={256}
                    level="H"
                    includeMargin={false}
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                  />
                </div>
                <div className="flex items-center gap-2 bg-zinc-50 text-zinc-700 px-4 py-3 rounded-xl border border-zinc-200 max-w-sm">
                  <QrCodeIcon className="w-6 h-6 shrink-0 text-zinc-500" />
                  <p className="text-sm font-medium leading-snug">
                    Point your smartphone camera at this code to quickly log into your secure dashboard.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};