import React, { useState } from 'react';
import { UserSession, User } from '../types';
import { Timer } from './Timer';
import { PinPad } from './PinPad';
import { Play, Pause, ShieldCheck, User as UserIcon, LogOut, CheckCircle2, QrCode as QrCodeIcon, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { LOG_INTERVAL_MS } from '../constants';

interface Props {
  activeSessions: Record<string, UserSession>;
  users: User[];
  onClockIn: (user: User) => void;
  onClockOut: (user: User) => void;
  onPauseSession?: (user: User) => void;
  onResumeSession?: (user: User) => void;
  isAdmin?: boolean;
}

export const TimeStation: React.FC<Props> = ({ activeSessions, users, onClockIn, onClockOut, onPauseSession, onResumeSession, isAdmin }) => {
  const [showPinPad, setShowPinPad] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [pinMessage, setPinMessage] = useState<string>('');
  const [actionMenuUser, setActionMenuUser] = useState<User | null>(null);

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
      // Clock In Logic
      onClockIn(user);
      setPinMessage(`Welcome, ${user.name}! Clocked in successfully.`);
      setTimeout(() => {
        setShowPinPad(false);
        setPinMessage('');
      }, 1500);
    }
  };

  if (showPinPad) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col items-center justify-center py-10 space-y-6">
        {pinMessage ? (
          <div className="bg-green-100 border border-green-200 text-green-800 px-6 py-4 rounded-xl flex items-center gap-3 text-lg font-bold animate-fade-in">
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

  if (actionMenuUser) {
    const session = activeSessions[actionMenuUser.id];
    if (!session) {
      setActionMenuUser(null);
      return null;
    }

    const isPaused = session.isPaused;

    return (
      <div className="max-w-2xl mx-auto py-12 animate-fade-in">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-8 text-center text-white">
            <div className="w-16 h-16 bg-white/10 rounded-full mx-auto flex items-center justify-center text-2xl font-bold mb-4 border border-white/20">
              {actionMenuUser.avatarInitials}
            </div>
            <h2 className="text-3xl font-bold mb-2">Hello, {actionMenuUser.name}</h2>
            <p className="text-slate-300">What would you like to do?</p>
          </div>
          <div className="p-8 space-y-4 bg-slate-50">
            {isPaused ? (
              <button
                onClick={() => {
                  onResumeSession && onResumeSession(actionMenuUser);
                  setPinMessage(`Welcome back from lunch, ${actionMenuUser.name}!`);
                  setActionMenuUser(null);
                  setShowPinPad(true);
                  setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 2000);
                }}
                className="w-full bg-green-600 hover:bg-green-700 text-white p-6 rounded-2xl shadow-sm text-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
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
              className="w-full mt-4 bg-transparent border-2 border-slate-300 text-slate-500 hover:bg-slate-200 p-4 rounded-2xl font-bold transition-colors"
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
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 h-full flex flex-col">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-8 text-white text-center">
            <h2 className="text-3xl font-bold mb-2">Master Time Station</h2>
            <p className="text-slate-300">Identify yourself to start or end your shift.</p>
          </div>

          <div className="p-10 flex-1 flex flex-col items-center justify-center space-y-8">
            <div className="p-6 bg-blue-50 rounded-full cursor-pointer hover:bg-blue-100 transition-colors" onClick={handlePinAction}>
              <ShieldCheck className="w-20 h-20 text-blue-600" />
            </div>

            <button
              onClick={handlePinAction}
              className="w-full max-w-xs flex flex-col items-center justify-center gap-3 px-8 py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-lg shadow-blue-200 font-bold text-xl transition-all hover:scale-105 active:scale-95"
            >
              <span>Enter PIN</span>
              <span className="text-sm font-normal opacity-80">Clock In / Clock Out</span>
            </button>

            <button
              onClick={() => setShowQR(true)}
              className="w-full max-w-xs flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-gray-200 hover:border-slate-800 hover:text-slate-800 hover:bg-slate-50 text-gray-600 rounded-2xl shadow-sm font-bold text-md transition-all active:scale-95"
            >
              <QrCodeIcon className="w-5 h-5" />
              Scan to Login
            </button>

            <p className="text-center text-gray-400 text-sm max-w-xs">
              Enter your 4-digit PIN. The system will automatically clock you in or out based on your current status.
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Active Users Dashboard */}
      <div className="lg:col-span-7">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-green-600" />
              Active Team Members ({sessionsList.length})
            </h3>
            <div className="flex items-center gap-4">
              {isAdmin && (
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1 bg-white cursor-pointer font-bold text-blue-600"
                  onChange={(e) => {
                    const u = users.find(u => u.id === e.target.value);
                    if (u) {
                      onClockIn(u);
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
              )}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live Tracking
              </div>
            </div>
          </div>

          {sessionsList.length === 0 ? (
            <div className="p-12 text-center text-gray-400 flex flex-col items-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <LogOut className="w-8 h-8 text-gray-300" />
              </div>
              <p>No one is currently clocked in.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 max-h-[600px] overflow-y-auto">
              {sessionsList.map(session => {
                const now = Date.now();
                const elapsedSinceLog = now - session.lastLogTime;
                const isOverdue = elapsedSinceLog > LOG_INTERVAL_MS;

                return (
                  <div key={session.userId} className={`p-4 rounded-xl border-2 transition-all hover:shadow-md
                    ${session.isPaused ? 'border-amber-200 bg-amber-50 shadow-inner' :
                      isOverdue ? 'border-red-100 bg-red-50' : 'border-green-100 bg-white'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm
                        ${session.isPaused ? 'bg-amber-500' : isOverdue ? 'bg-red-400' : 'bg-green-500'}`}>
                        {session.user.avatarInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-900 truncate">{session.user.name}</h4>
                        <p className="text-xs text-gray-500 truncate">{session.user.role}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500">Shift Time:</span>
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
                          <span>ON LUNCH (PAUSED)</span>
                        </div>
                      ) : isOverdue && (
                        <div className="flex items-center gap-2 text-xs text-red-600 font-semibold bg-red-100 px-2 py-1 rounded">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Check-in Required</span>
                        </div>
                      )}

                      <div className="text-xs text-gray-400 pt-2 border-t border-gray-100 mt-2 flex justify-between items-center">
                        <span>Last Log: {new Date(session.lastLogTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isAdmin && (
                          <button
                            onClick={() => onClockOut(session.user)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2 py-1 rounded text-xs font-bold transition-colors"
                          >
                            Clock Out
                          </button>
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
              <div className="p-6 flex justify-between items-center border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="bg-slate-800 p-2 rounded-lg text-white">
                    <QrCodeIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl text-gray-900 leading-tight">Staff Portal Login</h3>
                    <p className="text-xs text-gray-500 font-medium">Scan to open on your device</p>
                  </div>
                </div>
                <button onClick={() => setShowQR(false)} className="text-gray-400 hover:text-gray-800 transition-colors p-2 hover:bg-gray-200 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-10 flex flex-col items-center bg-white justify-center">
                <div className="p-4 bg-white border-4 border-gray-100 rounded-2xl shadow-inner inline-block mb-6">
                  <QRCodeSVG
                    value={window.location.href}
                    size={256}
                    level="H"
                    includeMargin={false}
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                  />
                </div>
                <div className="flex items-center gap-2 bg-slate-50 text-slate-700 px-4 py-3 rounded-xl border border-slate-200 max-w-sm">
                  <QrCodeIcon className="w-6 h-6 shrink-0 text-slate-500" />
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