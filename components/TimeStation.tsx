import React, { useState } from 'react';
import { UserSession, User, AppSettings, Department, ScheduleBlock } from '../types';
import { PinPad } from './PinPad';
import { Play, Pause, ShieldCheck, LogOut, CheckCircle2, QrCode as QrCodeIcon, X } from 'lucide-react';
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
  onLogAbsence?: (user: User, type: 'No-Call No-Show' | 'Sick' | 'Emergency', notes?: string) => Promise<any>;
}

export const TimeStation: React.FC<Props> = ({ activeSessions, users, onClockIn, onClockOut, onPauseSession, onResumeSession, isAdmin, appSettings, onUpdateSettings, shiftBlocks, onLogAbsence }) => {
  const [showPinPad, setShowPinPad] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [pinMessage, setPinMessage] = useState<string>('');
  const [actionMenuUser, setActionMenuUser] = useState<User | null>(null);
  const [unscheduledUser, setUnscheduledUser] = useState<User | null>(null);
  const [pendingScheduledShift, setPendingScheduledShift] = useState<{ user: User; shift: ScheduleBlock } | null>(null);

  const handlePinAction = () => {
    setPinMessage('');
    setActionMenuUser(null);
    setPendingScheduledShift(null);
    setShowPinPad(true);
  };

  const findUserSession = (user: User): UserSession | undefined => {
    return (
      activeSessions[user.id] ||
      Object.values(activeSessions).find(s => String(s.userId) === String(user.id))
    );
  };

  const handleRecordEndOfShiftClockOut = async (user: User, shift: ScheduleBlock) => {
    const now = Date.now();
    const startMs = new Date(shift.startTime).getTime();
    const effectiveClockIn = startMs < now ? startMs : now - 8 * 60 * 60 * 1000;
    const tzOffset = effectiveClockIn - new Date(effectiveClockIn).getTimezoneOffset() * 60000;
    const dateStr = new Date(tzOffset).toISOString().split('T')[0];
    const totalHours = Math.max(0, (now - effectiveClockIn) / (1000 * 60 * 60));

    const timeCard = {
      id: `tc-${user.id}-${now}`,
      userId: user.id,
      date: dateStr,
      clockIn: effectiveClockIn,
      clockOut: now,
      totalHours,
      totalIdleHours: 0,
      status: 'Complete' as const,
      minutesLate: 0,
      tardyShiftTitle: shift.title || undefined
    };

    try {
      const { isFirebaseConfigured, firebaseSaveTimeCard } = await import('../services/firebaseService');
      if (isFirebaseConfigured()) {
        await firebaseSaveTimeCard(timeCard);
      }
      const { storageService } = await import('../services/storageService');
      storageService.saveTimeCard(timeCard);
    } catch (e) {
      console.error('Failed to record shift clock-out:', e);
    }

    setPinMessage(`Goodbye, ${user.name}! Clocked out for the day.`);
    setPendingScheduledShift(null);
    setShowPinPad(true);
    setTimeout(() => {
      setShowPinPad(false);
      setPinMessage('');
    }, 2000);
  };

  const handlePinSuccess = (user: User) => {
    const existingSession = findUserSession(user);

    if (existingSession) {
      // Open the action menu instead of instantly clocking out
      setActionMenuUser(user);
      setShowPinPad(false);
    } else {
      // Check if they are scheduled today
      const now = new Date();
      const nowMs = now.getTime();
      const todayShifts = (shiftBlocks || [])
        .filter(b => {
          if (String(b.assignedTo) !== String(user.id) || typeof b.title !== 'string' || !b.title.startsWith('[SHIFT]')) return false;
          const start = new Date(b.startTime);
          return (
            start.getDate() === now.getDate() &&
            start.getMonth() === now.getMonth() &&
            start.getFullYear() === now.getFullYear()
          );
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      const currentShift =
        todayShifts.find(s => nowMs <= new Date(s.endTime).getTime()) || todayShifts[todayShifts.length - 1];

      if (currentShift) {
        const startMs = new Date(currentShift.startTime).getTime();
        const endMs = new Date(currentShift.endTime).getTime();
        const isPastTwoHoursOrNearEnd = nowMs > startMs + 120 * 60 * 1000 || nowMs >= endMs - 30 * 60 * 1000;

        if (isPastTwoHoursOrNearEnd) {
          // If it's late into the shift or near/past shift end, NEVER auto-clock them in — show explicit Clock Out / Clock In choice!
          setPendingScheduledShift({ user, shift: currentShift });
          setShowPinPad(false);
        } else {
          // Within normal shift start window — clock in immediately
          onClockIn(user, currentShift.department, false);
          setPinMessage(`Welcome, ${user.name}! Clocked in successfully.`);
          setTimeout(() => {
            setShowPinPad(false);
            setPinMessage('');
          }, 1500);
        }
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

  if (pendingScheduledShift) {
    const { user, shift } = pendingScheduledShift;
    return (
      <div className="max-w-2xl mx-auto py-12 animate-fade-in">
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-zinc-100">
          <div className="bg-black p-8 text-center text-white">
            <div className="w-16 h-16 bg-white/10 rounded-full mx-auto flex items-center justify-center text-2xl font-bold mb-4 border border-white/20">
              {user.avatarInitials}
            </div>
            <h2 className="text-3xl font-bold mb-2">Hello, {user.name}</h2>
            <p className="text-zinc-300">Are you clocking out for the day or starting a new shift?</p>
          </div>
          <div className="p-8 space-y-4 bg-zinc-50">
            <button
              onClick={() => handleRecordEndOfShiftClockOut(user, shift)}
              className="w-full bg-red-600 hover:bg-red-700 text-white p-6 rounded-2xl shadow-sm text-xl font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
            >
              <LogOut className="w-6 h-6" /> Clock Out For the Day
            </button>

            <button
              onClick={() => {
                onClockIn(user, shift.department, true);
                setPinMessage(`Welcome, ${user.name}! Clocked in successfully.`);
                setPendingScheduledShift(null);
                setShowPinPad(true);
                setTimeout(() => { setShowPinPad(false); setPinMessage(''); }, 1800);
              }}
              className="w-full bg-zinc-900 hover:bg-zinc-800 text-white p-5 rounded-2xl shadow-sm text-lg font-bold transition-transform active:scale-95 flex items-center justify-center gap-3"
            >
              <Play className="w-5 h-5" /> Start Shift (Clock In)
            </button>

            <button
              onClick={() => setPendingScheduledShift(null)}
              className="w-full mt-4 bg-transparent border-2 border-zinc-300 text-zinc-500 hover:bg-zinc-200 p-4 rounded-2xl font-bold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (actionMenuUser) {
    const session = findUserSession(actionMenuUser);
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

  return (
    <div className="flex justify-center items-center animate-fade-in w-full py-4">
      {/* Clock In/Out Action */}
      <div className="w-full max-w-md space-y-6">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-zinc-100 flex flex-col">
          <div className="bg-black p-8 text-white text-center">
            <h2 className="text-3xl font-bold mb-2">Master Time Station</h2>
            <p className="text-zinc-300">Identify yourself to start or end your shift.</p>
          </div>

          <div className="p-10 flex flex-col items-center justify-center space-y-8">
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

      {/* QR Code Dialog */}
      {showQR && (
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
      )}
    </div>
  );
};