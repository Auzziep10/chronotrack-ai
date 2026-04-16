
import React, { useState, useMemo } from 'react';
import { Department, WorkLog, DailyTimeCard, User, AppSettings, UserSession } from '../types';
import {
  BarChart3, Users, Clock, Calendar, ChevronDown, ChevronRight, Download,
  Briefcase, CalendarRange, Sparkles, Zap, ListTodo, RefreshCw,
  Target, TrendingUp, AlertCircle
} from 'lucide-react';
import { processExternalPlan } from '../services/geminiService';

// Generate more data (60 days) to allow testing different pay periods
const generateMockData = (users: User[]) => {
  const timeCards: DailyTimeCard[] = [];
  const logs: (WorkLog & { userId: string, userName: string })[] = [];
  const today = new Date();
  const displayUsers = users.length > 0 ? users : [];

  for (let i = 0; i < 60; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    displayUsers.forEach(user => {
      if (Math.random() > 0.1) {
        const startHour = 8 + (Math.random() * 2);
        const endHour = 16 + (Math.random() * 2);
        const startTime = new Date(date).setHours(Math.floor(startHour), Math.floor((startHour % 1) * 60));
        const endTime = new Date(date).setHours(Math.floor(endHour), Math.floor((endHour % 1) * 60));

        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: startTime,
          clockOut: endTime,
          totalHours: endHour - startHour,
          status: 'Complete'
        });

        const numLogs = 1 + Math.floor(Math.random() * 3);
        for (let j = 0; j < numLogs; j++) {
          const deptKeys = Object.values(Department);
          const randomDept = deptKeys[Math.floor(Math.random() * deptKeys.length)];

          logs.push({
            id: `log-${user.id}-${i}-${j}`,
            userId: user.id,
            userName: user.name,
            timestamp: startTime + (j * 3600000),
            periodStart: startTime + (j * 3600000),
            periodEnd: startTime + ((j + 1) * 3600000),
            department: randomDept,
            task: `Task ${j + 1} for ${randomDept}`,
            notes: j % 3 === 0 ? "Detailed notes..." : undefined,
            productionData: randomDept === Department.Production ? {
              projectName: `Project-${Math.floor(Math.random() * 100)}`,
              quantity: Math.floor(Math.random() * 500)
            } : undefined
          });
        }
      }
    });
  }
  return { timeCards, logs };
};

const getPayPeriods = (settings: AppSettings) => {
  const periods = [];
  const today = new Date();

  if (settings.payFrequency === 'Monthly') {
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      periods.push({ start, end, label: start.toLocaleDateString('default', { month: 'long', year: 'numeric' }) });
    }
  } else {
    const dayMap: Record<string, number> = { 'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6 };
    const targetDay = dayMap[settings.payPeriodStartDay];
    const daysLength = settings.payFrequency === 'Bi-Weekly' ? 14 : 7;
    let currentStart = new Date(today);
    while (currentStart.getDay() !== targetDay) currentStart.setDate(currentStart.getDate() - 1);
    currentStart.setHours(0, 0, 0, 0);

    for (let i = 0; i < 8; i++) {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - (i * daysLength));
      const end = new Date(start);
      end.setDate(end.getDate() + daysLength - 1);
      end.setHours(23, 59, 59, 999);
      periods.push({
        start, end,
        label: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      });
    }
  }
  return periods;
};

interface Props {
  users: User[];
  settings: AppSettings;
  activeSessions?: Record<string, UserSession>;
  onClockIn?: (user: User) => void;
  onClockOut?: (user: User) => void;
}

export const ActivityManager: React.FC<Props> = ({ users, settings, activeSessions = {}, onClockIn, onClockOut }) => {
  const [activeView, setActiveView] = useState<'departments' | 'users' | 'timecards' | 'planning'>('departments');
  const [selectedDept, setSelectedDept] = useState<Department | 'All'>('All');
  const [selectedUser, setSelectedUser] = useState<string | 'All'>('All');
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(0);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleCardExpanded = (cardId: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const [externalPlanRaw, setExternalPlanRaw] = useState('');
  const [parsedPlan, setParsedPlan] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Timecard Editing State
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState<string>('');
  const [editClockOut, setEditClockOut] = useState<string>('');

  // State for real data
  const [timeCards, setTimeCards] = useState<DailyTimeCard[]>([]);
  const [logs, setLogs] = useState<WorkLog[]>([]);

  const periods = useMemo(() => getPayPeriods(settings), [settings]);
  const currentPeriod = periods[selectedPeriodIdx];

  const [exportStartDate, setExportStartDate] = useState<string>('');
  const [exportEndDate, setExportEndDate] = useState<string>('');

  React.useEffect(() => {
    if (currentPeriod) {
      setExportStartDate(currentPeriod.start.toISOString().split('T')[0]);
      setExportEndDate(currentPeriod.end.toISOString().split('T')[0]);
    }
  }, [currentPeriod]);

  // Load data on mount from both LocalStorage (legacy/fallback) and Backend (sync)
  React.useEffect(() => {
    const fetchData = async () => {
      // 1. Load Local Fallback
      const { storageService } = await import('../services/storageService');
      const localData = storageService.getAllData();
      setTimeCards(localData.timeCards);
      setLogs(localData.logs);

      // 2. Sync from Backend (Firebase)
      const {
        firebaseGetLogs,
        firebaseGetTimeCards,
        isFirebaseConfigured
      } = await import('../services/firebaseService');

      if (isFirebaseConfigured()) {
        try {
          const [remoteLogs, remoteTimeCards] = await Promise.all([
            firebaseGetLogs().catch(() => []),
            firebaseGetTimeCards().catch(() => [])
          ]);

          if (remoteLogs && Array.isArray(remoteLogs)) setLogs(remoteLogs);
          if (remoteTimeCards && Array.isArray(remoteTimeCards)) setTimeCards(remoteTimeCards);
        } catch (err) {
          console.warn("Failed to sync historical data from Firebase", err);
        }
      }
    };

    fetchData();
  }, []);

  const departmentStats = useMemo(() => {
    const stats: Record<string, { hours: number, count: number }> = {};
    Object.values(Department).forEach(d => stats[d] = { hours: 0, count: 0 });

    const recentLogs = logs.filter(l => {
      const d = new Date(l.timestamp);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return d > sevenDaysAgo;
    });

    recentLogs.forEach(log => {
      if (stats[log.department]) {
        stats[log.department].count += 1;
        stats[log.department].hours += 1;
      }
    });
    return stats;
  }, [logs]);

  const allLogs = useMemo(() => {
    const sessionLogs = (Object.values(activeSessions) as UserSession[]).flatMap(s => s.logs || []);
    const merged = [...logs];
    const existingIds = new Set(logs.map(l => l.id));
    sessionLogs.forEach(l => {
      if (!existingIds.has(l.id)) merged.push(l);
    });
    return merged;
  }, [logs, activeSessions]);

  const filteredLogs = useMemo(() => {
    return allLogs.filter(log => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (new Date(log.timestamp) < thirtyDaysAgo) return false;
      if (selectedDept !== 'All' && log.department !== selectedDept) return false;
      if (selectedUser !== 'All' && log.userId !== selectedUser) return false;
      return true;
    });
  }, [selectedDept, selectedUser, allLogs]);

  const allCurrentCards = useMemo(() => {
    // Merge database cards with current active sessions
    const activeCards: DailyTimeCard[] = (Object.values(activeSessions) as UserSession[]).map(session => ({
      id: `active-${session.userId}`,
      userId: session.userId,
      date: new Date(session.startTime).toISOString().split('T')[0],
      clockIn: session.startTime,
      clockOut: null,
      totalHours: (Date.now() - session.startTime) / (1000 * 60 * 60),
      totalIdleHours: (session.totalIdleTimeMs || 0) / (1000 * 60 * 60),
      status: 'Active'
    }));

    const allCards = [...activeCards, ...timeCards];

    // Deduplicate cards that somehow got created twice for the exact same shift (same clockIn time)
    // We keep the one with the latest clockOut time, or the most recent ID if active.
    const dedupedCardsMap = new Map<string, DailyTimeCard>();
    allCards.forEach(card => {
      const key = `${card.userId}-${card.clockIn}`;
      const existing = dedupedCardsMap.get(key);
      if (!existing) {
        dedupedCardsMap.set(key, card);
      } else {
        // If there's a conflict, prefer the one with a clockOut time, and if both have it, prefer the later one
        // or prefer the 'Complete' status one over a potentially stuck 'Active' one
        if (existing.status === 'Active' && card.status === 'Complete') {
          dedupedCardsMap.set(key, card);
        } else if (existing.clockOut && card.clockOut) {
          if (card.clockOut > existing.clockOut) {
            dedupedCardsMap.set(key, card);
          }
        }
      }
    });

    return Array.from(dedupedCardsMap.values());
  }, [timeCards, activeSessions]);

  const filteredTimeCards = useMemo(() => {
    if (!currentPeriod) return [];

    return allCurrentCards.filter(card => {
      const [y, m, d] = card.date.split('-').map(Number);
      const cardDate = new Date(y, m - 1, d, 12, 0, 0);
      return cardDate >= currentPeriod.start && cardDate <= currentPeriod.end;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allCurrentCards, currentPeriod]);

  const groupedTimeCards = useMemo(() => {
    const groups: Record<string, DailyTimeCard[]> = {};
    users.forEach(user => {
      groups[user.id] = [];
    });
    filteredTimeCards.forEach(card => {
      if (!groups[card.userId]) groups[card.userId] = [];
      groups[card.userId].push(card);
    });
    return Object.entries(groups).map(([userId, cards]) => {
      const totalIdle = cards.reduce((sum, c) => sum + (c.totalIdleHours || 0), 0);
      const totalHours = cards.reduce((sum, c) => sum + c.totalHours, 0);
      const isActive = (Object.values(activeSessions) as UserSession[]).some(s => s.userId === userId);
      const isComplete = cards.length > 0 && cards.every(c => c.status === 'Complete') && !isActive;

      let statusStr = 'No Data';
      if (isActive) statusStr = 'Active';
      else if (isComplete) statusStr = 'Complete';
      else if (cards.length > 0) statusStr = 'Incomplete';

      return {
        userId,
        cards,
        totalIdle,
        totalHours,
        status: statusStr
      };
    }).sort((a: any, b: any) => {
      const nameA = users.find(u => u.id === a.userId)?.name || '';
      const nameB = users.find(u => u.id === b.userId)?.name || '';
      return nameA.localeCompare(nameB);
    });
  }, [filteredTimeCards, users, activeSessions]);

  const handleSyncPlan = async () => {
    if (!externalPlanRaw.trim()) return;
    setIsSyncing(true);
    try {
      const result = await processExternalPlan(externalPlanRaw);
      setParsedPlan(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportCSV = () => {
    if (!exportStartDate || !exportEndDate) return;

    // Filter cards for the chosen range
    const [sy, sm, sd] = exportStartDate.split('-').map(Number);
    const startRange = new Date(sy, sm - 1, sd, 0, 0, 0);

    const [ey, em, ed] = exportEndDate.split('-').map(Number);
    const endRange = new Date(ey, em - 1, ed, 23, 59, 59);

    const cardsToExport = allCurrentCards.filter(card => {
      const [y, m, d] = card.date.split('-').map(Number);
      const cardDate = new Date(y, m - 1, d, 12, 0, 0);
      return cardDate >= startRange && cardDate <= endRange;
    });

    if (cardsToExport.length === 0) {
      alert("No data found for the selected date range.");
      return;
    }

    // Group by Date
    const groupedByDate: Record<string, DailyTimeCard[]> = {};
    cardsToExport.forEach(card => {
      if (!groupedByDate[card.date]) groupedByDate[card.date] = [];
      groupedByDate[card.date].push(card);
    });

    // Format matches Google Sheet requested
    const headers = [
      'Shift #',
      'Full Legal Name',
      'Hours Worked',
      'Role',
      'Cut QTY',
      'Gross Presses',
      'Shirts downed',
      'Net Presses',
      'Shift Total Hrly Pay',
      'Shift Total Inctv Pay',
      'Total shift pay:',
      'Time Paused'
    ];

    Object.entries(groupedByDate).forEach(([dateStr, cards]) => {
      const rows = cards.map(card => {
        const user = users.find(u => u.id === card.userId) || (Object.values(activeSessions) as UserSession[]).find(s => s.userId === card.userId)?.user;

        const shiftNo = '';
        const name = user?.name || 'Deleted User';
        const hoursWorked = card.totalHours.toFixed(2);
        const role = user?.role || 'Unknown';
        const cutQty = '';
        const grossPresses = '';
        const shirtsDowned = '';
        const netPresses = '';
        const shiftHrlyPay = '';
        const shiftInctvPay = '';
        const shiftTotalPay = '';
        const timePaused = (card.totalIdleHours || 0).toFixed(2);

        return [
          shiftNo,
          name,
          hoursWorked,
          role,
          cutQty,
          grossPresses,
          shirtsDowned,
          netPresses,
          shiftHrlyPay,
          shiftInctvPay,
          shiftTotalPay,
          timePaused
        ].map(field => `"${field}"`).join(',');
      });

      const [y, m, d] = dateStr.split('-').map(Number);
      const dateObj = new Date(y, m - 1, d, 12, 0, 0);
      const dateHeaderStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

      const csvContent = [`"${dateHeaderStr}"` + headers.slice(1).map(() => '').join(','), headers.join(','), ...rows].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `time_report_${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const startEditingCard = (card: DailyTimeCard) => {
    setEditingCardId(card.id);
    const offset = new Date().getTimezoneOffset() * 60000;
    const toLocalFormat = (ts: number) => new Date(ts - offset).toISOString().slice(0, 16);
    setEditClockIn(toLocalFormat(card.clockIn));
    setEditClockOut(card.clockOut ? toLocalFormat(card.clockOut) : '');
  };

  const saveEditedCard = async (card: DailyTimeCard) => {
    const inTime = new Date(editClockIn).getTime();
    const outTime = editClockOut ? new Date(editClockOut).getTime() : null;
    if (isNaN(inTime) || (editClockOut && isNaN(outTime!))) {
      alert("Invalid date/time format.");
      return;
    }
    const updatedCard: DailyTimeCard = {
      ...card,
      clockIn: inTime,
      clockOut: outTime,
      totalHours: outTime ? Math.max(0, ((outTime - inTime) / 3600000) - (card.totalIdleHours || 0)) : card.totalHours,
      status: outTime ? 'Complete' : 'Active'
    };

    setTimeCards(prev => prev.map(c => c.id === card.id ? updatedCard : c));
    setEditingCardId(null);

    const { storageService } = await import('../services/storageService');
    storageService.saveTimeCard(updatedCard);

    const { firebaseSaveTimeCard, firebaseUpdateSessionStartTime, isFirebaseConfigured } = await import('../services/firebaseService');
    if (isFirebaseConfigured()) {
      try {
        if (card.id.startsWith('active-')) {
          await firebaseUpdateSessionStartTime(card.userId, inTime);
        } else {
          await firebaseSaveTimeCard(updatedCard);
        }
      } catch (err) {
        console.error("Failed to save updated timecard to remote:", err);
      }
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden min-h-[700px] flex flex-col animate-fade-in">
      {/* Enhanced Manager Header */}
      <div className="bg-slate-900 text-white p-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900 p-1.5 rounded-lg">
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Manager Console</h2>
        </div>

        <div className="flex bg-slate-800 rounded-xl p-1 overflow-x-auto max-w-full">
          {[
            { id: 'departments', icon: BarChart3, label: 'Depts' },
            { id: 'users', icon: Users, label: 'Users' },
            { id: 'timecards', icon: Clock, label: 'Time' },
            { id: 'planning', icon: Target, label: 'Planning' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${activeView === tab.id ? 'bg-zinc-900 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 bg-zinc-50 flex-1 overflow-y-auto">

        {/* VIEW: DEPARTMENT REPORTS */}
        {activeView === 'departments' && (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-xl font-bold text-zinc-800">Department Overview</h3>
                <p className="text-zinc-500 text-sm">Labor distribution across the company (Last 7 Days)</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 bg-zinc-50 px-3 py-1.5 rounded-full border border-zinc-100">
                  <TrendingUp className="w-3.5 h-3.5" />
                  +12% Efficiency
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Added explicit type casting to fix 'unknown' property access errors */}
              {(Object.entries(departmentStats) as [string, { hours: number; count: number }][]).map(([dept, data]) => (
                <div key={dept} className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm hover:shadow-md transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase
                      ${dept === Department.Production ? 'bg-purple-100 text-purple-700' :
                        dept === Department.Design ? 'bg-indigo-100 text-indigo-700' :
                          'bg-zinc-100 text-zinc-800'}`}>
                      {dept}
                    </span>
                    <Zap className="w-5 h-5 text-zinc-300 group-hover:text-yellow-400 transition-colors" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-zinc-900">{data.hours}</span>
                    <span className="text-zinc-500 text-sm font-medium">hours logged</span>
                  </div>
                  <div className="mt-4 h-2.5 w-full bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${dept === Department.Production ? 'bg-purple-500' : 'bg-zinc-500'}`}
                      style={{ width: `${Math.min(100, (data.hours / 20) * 100)}%` }}
                    ></div>
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-zinc-400 font-medium">
                    <span>{data.count} tasks</span>
                    <span>Goal: 40h</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW: PLANNING & SYNC (NEW) */}
        {activeView === 'planning' && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-zinc-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Daily Planning & AI Sync
                </h3>
                <p className="text-zinc-500 text-sm">Bridge the gap between your external plans and real-time logs.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-zinc-700">
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    Sync Daily Planner Data
                  </div>
                  <p className="text-xs text-zinc-500">
                    Paste content from your Replit Daily Planner or external spreadsheet.
                    AI will extract departments and tasks.
                  </p>
                  <textarea
                    value={externalPlanRaw}
                    onChange={(e) => setExternalPlanRaw(e.target.value)}
                    placeholder="Paste planner data here... e.g. 'Monday: Alex production focus 500 units, Sarah design 2 tech packs...'"
                    className="w-full h-40 text-sm border-zinc-200 rounded-xl focus:ring-purple-500 focus:border-purple-500 p-4 bg-slate-50 font-mono"
                  />
                  <button
                    onClick={handleSyncPlan}
                    disabled={isSyncing || !externalPlanRaw.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    {isSyncing ? 'Processing with AI...' : 'Parse Plan with Gemini'}
                  </button>
                </div>

                <div className="bg-zinc-50 border border-zinc-100 p-6 rounded-2xl flex items-start gap-4">
                  <div className="p-2 bg-indigo-200 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-indigo-700" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-indigo-900">Pro Tip</h4>
                    <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
                      You can also paste JSON output from your Replit app!
                      Gemini handles messy text, spreadsheets, or structured objects equally well.
                    </p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="bg-white min-h-[500px] rounded-2xl border border-zinc-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-zinc-900" />
                      Extracted Shift Goals
                    </span>
                    {parsedPlan && (
                      <span className="text-xs font-medium text-zinc-900 bg-zinc-100 px-2 py-1 rounded-full border border-zinc-200">
                        AI Processed
                      </span>
                    )}
                  </div>

                  <div className="flex-1 p-8 overflow-y-auto">
                    {parsedPlan ? (
                      <div className="prose prose-sm prose-slate max-w-none">
                        <div className="whitespace-pre-wrap text-zinc-700 leading-relaxed font-sans">
                          {parsedPlan}
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                        <div className="p-4 bg-zinc-50 rounded-full">
                          <ListTodo className="w-12 h-12 text-zinc-300" />
                        </div>
                        <div>
                          <p className="text-zinc-500 font-medium">No plan imported yet.</p>
                          <p className="text-zinc-400 text-xs">Pasted plan data will appear here once synced.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Existing User Reports and Time Reports logic remains below... */}
        {(activeView === 'users' || activeView === 'timecards') && (
          <div className="space-y-6">
            {/* Keeping current filter logic from previous implementation for backward compatibility */}
            {activeView === 'users' ? (
              <div className="space-y-6">
                <div className="flex flex-col md:flex-row gap-4 justify-between bg-white p-4 rounded-xl border border-zinc-200">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Filter by User</label>
                    <select
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      className="w-full md:w-64 bg-zinc-50 border border-zinc-300 text-sm rounded-lg p-2.5"
                    >
                      <option value="All">All Users</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-zinc-200">
                  <ul className="divide-y divide-zinc-100">
                    {filteredLogs.map(log => (
                      <li key={log.id} className="p-5 hover:bg-zinc-50 transition-colors">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xs">
                              {log.userName.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-bold text-zinc-900 text-sm">{log.userName}</div>
                              <div className="text-xs text-zinc-500">{log.department} • {log.task}</div>
                            </div>
                          </div>
                          <div className="text-xs text-zinc-400">
                            {new Date(log.timestamp).toLocaleDateString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col lg:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-zinc-200">
                  <div className="flex items-center gap-4 w-full lg:w-auto">
                    <div className="p-2 bg-zinc-50 rounded-lg">
                      <CalendarRange className="w-5 h-5 text-zinc-900" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-0.5">Current Cycle</label>
                      <select
                        value={selectedPeriodIdx}
                        onChange={(e) => setSelectedPeriodIdx(parseInt(e.target.value))}
                        className="font-bold text-zinc-800 bg-transparent border-none p-0 focus:ring-0 cursor-pointer text-sm"
                      >
                        {periods.map((p, i) => (
                          <option key={i} value={i}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col lg:flex-row items-center gap-3 w-full lg:w-auto border-t lg:border-t-0 pt-4 lg:pt-0">
                    <div className="flex flex-col gap-1 w-full lg:w-auto">
                      <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1 lg:hidden">Export Range</label>
                      <div className="flex items-center gap-2 text-sm bg-zinc-50 border border-zinc-200 rounded-lg p-1">
                        <input
                          type="date"
                          value={exportStartDate}
                          onChange={e => setExportStartDate(e.target.value)}
                          className="bg-transparent border-none text-zinc-700 text-xs font-bold focus:ring-0 cursor-pointer p-1"
                        />
                        <span className="text-zinc-400 text-xs font-bold">to</span>
                        <input
                          type="date"
                          value={exportEndDate}
                          onChange={e => setExportEndDate(e.target.value)}
                          className="bg-transparent border-none text-zinc-700 text-xs font-bold focus:ring-0 cursor-pointer p-1"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleExportCSV}
                      className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-100 hover:bg-slate-800 transition-all"
                    >
                      <Download className="w-4 h-4" /> Export Cycle
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="px-6 py-3">Member</th>
                        <th className="px-6 py-3">Date</th>
                        <th className="px-6 py-3">In / Out</th>
                        <th className="px-6 py-3">Idle (Unpaid)</th>
                        <th className="px-6 py-3">Net Work</th>
                        <th className="px-6 py-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {groupedTimeCards.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-zinc-400">
                            No data found for this period.
                          </td>
                        </tr>
                      ) : (
                        groupedTimeCards.map(group => {
                          const user = users.find(u => u.id === group.userId) ||
                            (Object.values(activeSessions) as UserSession[]).find(s => s.userId === group.userId)?.user ||
                            { id: group.userId, name: 'Deleted User', role: 'Unknown', avatarInitials: '?' } as any;
                          const isExpanded = expandedUsers.has(group.userId);

                          return (
                            <React.Fragment key={group.userId}>
                              <tr
                                className="hover:bg-zinc-50 transition-colors cursor-pointer"
                                onClick={() => toggleUserExpanded(group.userId)}
                              >
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    {isExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-zinc-400" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-zinc-400" />
                                    )}
                                    <div>
                                      <div className="font-bold text-zinc-900">{user?.name || 'Unknown'}</div>
                                      <div className="text-[10px] text-zinc-500">{user?.role}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-zinc-400 text-xs font-medium">
                                  {group.cards.length} {group.cards.length === 1 ? 'Record' : 'Records'}
                                </td>
                                <td className="px-6 py-4">
                                  {group.cards.length > 0 ? (
                                    <>
                                      <div className="text-xs font-medium text-zinc-900">
                                        {new Date(group.cards[0].clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                      </div>
                                      <div className="text-[10px] text-zinc-500">
                                        {group.cards[0].clockOut ? new Date(group.cards[0].clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active...'}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-xs text-zinc-400">-</div>
                                  )}
                                </td>
                                <td className="px-6 py-4">
                                  <div className={`text-xs font-bold ${group.totalIdle && group.totalIdle > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                                    -{group.totalIdle.toFixed(2)} hr
                                  </div>
                                  <div className="text-[10px] text-zinc-400">Cycle Idle</div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="text-xs font-bold text-zinc-900">
                                    {group.totalHours.toFixed(2)} hr
                                  </div>
                                  <div className="text-[10px] text-zinc-400 font-medium">Cycle Total</div>
                                </td>
                                <td className="px-6 py-4 flex flex-col items-end gap-1.5 justify-center mt-1">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border
                                    ${group.status === 'Complete' ? 'bg-zinc-50 text-zinc-800 border-zinc-200' :
                                      group.status === 'Active' ? 'bg-zinc-50 text-zinc-800 border-zinc-200' :
                                        group.status === 'Incomplete' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                          'bg-zinc-50 text-zinc-500 border-zinc-200'}`}>
                                    {group.status}
                                  </span>
                                  {group.status !== 'Active' && onClockIn && user && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); onClockIn(user); }}
                                      className="text-[10px] font-bold bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50 px-2 py-1 rounded shadow-sm transition-colors"
                                    >Clock In</button>
                                  )}
                                  {group.status === 'Active' && onClockOut && user && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); onClockOut(user); }}
                                      className="text-[10px] font-bold bg-white text-amber-600 border border-amber-200 hover:bg-amber-50 px-2 py-1 rounded shadow-sm transition-colors"
                                    >Clock Out</button>
                                  )}
                                </td>
                              </tr>

                              {isExpanded && group.cards.map(card => {
                                const isEditing = editingCardId === card.id;
                                const isCardExpanded = expandedCards.has(card.id);
                                const cardLogs = allLogs.filter(l => {
                                  if (l.userId !== card.userId) return false;
                                  // Fix local timezone offset for accurate day matching since card.date is YYYY-MM-DD
                                  const tzOffset = new Date(l.timestamp).getTimezoneOffset() * 60000;
                                  const localIsoDate = new Date(l.timestamp - tzOffset).toISOString().split('T')[0];
                                  return localIsoDate === card.date;
                                }).sort((a, b) => b.timestamp - a.timestamp);

                                return (
                                  <React.Fragment key={card.id}>
                                    <tr
                                      className="bg-zinc-50/50 hover:bg-zinc-100/50 transition-colors cursor-pointer"
                                      onClick={() => toggleCardExpanded(card.id)}
                                    >
                                      <td className="px-6 py-3 pl-16">
                                        <div className="flex items-center gap-2">
                                          {isCardExpanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                                          <div className="text-xs text-zinc-600 font-bold">Total Time</div>
                                        </div>
                                      </td>
                                      <td className="px-6 py-3 text-zinc-600 font-medium">
                                        {new Date(card.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                      </td>
                                      <td className="px-6 py-3" onClick={e => e.stopPropagation()}>
                                        {isEditing ? (
                                          <div className="flex flex-col gap-1">
                                            <input
                                              type="datetime-local"
                                              value={editClockIn}
                                              onChange={e => setEditClockIn(e.target.value)}
                                              className="text-xs border border-zinc-300 rounded p-1"
                                            />
                                            <input
                                              type="datetime-local"
                                              value={editClockOut}
                                              onChange={e => setEditClockOut(e.target.value)}
                                              className="text-xs border border-zinc-300 rounded p-1"
                                              disabled={!card.clockOut && !editClockOut}
                                            />
                                          </div>
                                        ) : (
                                          <>
                                            <div className="text-xs font-medium text-zinc-900">
                                              {new Date(card.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                            <div className="text-[10px] text-zinc-500">
                                              {card.clockOut ? new Date(card.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active...'}
                                            </div>
                                          </>
                                        )}
                                      </td>
                                      <td className="px-6 py-3">
                                        <div className={`text-xs font-medium ${card.totalIdleHours && card.totalIdleHours > 0 ? 'text-amber-600' : 'text-zinc-400'}`}>
                                          -{card.totalIdleHours?.toFixed(2) || '0.00'} hr
                                        </div>
                                      </td>
                                      <td className="px-6 py-3">
                                        <div className="text-xs font-medium text-zinc-900">
                                          {card.totalHours.toFixed(2)} hr
                                        </div>
                                      </td>
                                      <td className="px-6 py-3 text-right" onClick={e => e.stopPropagation()}>
                                        <div className="flex flex-col items-end gap-1.5">
                                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase border
                                            ${card.status === 'Complete' ? 'bg-zinc-50 text-zinc-800 border-zinc-200' : 'bg-zinc-50 text-zinc-800 border-zinc-200'}`}>
                                            {card.status}
                                          </span>
                                          {isEditing ? (
                                            <div className="flex gap-1 mt-1">
                                              <button onClick={() => setEditingCardId(null)} className="text-[10px] font-bold text-zinc-500 hover:text-zinc-700">Cancel</button>
                                              <button onClick={() => saveEditedCard(card)} className="text-[10px] font-bold text-zinc-900 hover:text-zinc-800">Save</button>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => startEditingCard(card)}
                                              className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 transition-colors underline"
                                            >
                                              Edit
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>

                                    {isCardExpanded && (
                                      cardLogs.length > 0 ? (
                                        cardLogs.map(log => (
                                          <tr key={log.id} className="bg-zinc-100/30">
                                            <td className="px-6 py-2 pl-[4.5rem]">
                                              <div className="text-[10px] font-mono text-zinc-400 whitespace-nowrap">
                                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                              </div>
                                            </td>
                                            <td colSpan={5} className="px-6 py-2">
                                              <div className="text-xs text-zinc-600 flex items-center gap-2">
                                                <span className="font-bold">{log.department}:</span>
                                                <span>{log.task || log.notes || 'Routine check-in'}</span>
                                              </div>
                                            </td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr className="bg-zinc-100/30">
                                          <td className="px-6 py-2 pl-[4.5rem]" colSpan={6}>
                                            <div className="text-xs text-zinc-400 italic">No check-ins logged for this period.</div>
                                          </td>
                                        </tr>
                                      )
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
