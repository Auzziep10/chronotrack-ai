
import React, { useState, useMemo } from 'react';
import { Department, WorkLog, DailyTimeCard, User, AppSettings } from '../types';
import {
  BarChart3, Users, Clock, Calendar, ChevronDown, Download,
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
}

export const ActivityManager: React.FC<Props> = ({ users, settings }) => {
  const [activeView, setActiveView] = useState<'departments' | 'users' | 'timecards' | 'planning'>('departments');
  const [selectedDept, setSelectedDept] = useState<Department | 'All'>('All');
  const [selectedUser, setSelectedUser] = useState<string | 'All'>('All');
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(0);

  // External Plan State
  const [externalPlanRaw, setExternalPlanRaw] = useState('');
  const [parsedPlan, setParsedPlan] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // State for real data
  const [timeCards, setTimeCards] = useState<DailyTimeCard[]>([]);
  const [logs, setLogs] = useState<WorkLog[]>([]);

  // Load data on mount
  React.useEffect(() => {
    import('../services/storageService').then(({ storageService }) => {
      const data = storageService.getAllData();
      setTimeCards(data.timeCards);
      setLogs(data.logs);
    });
  }, []);

  const periods = useMemo(() => getPayPeriods(settings), [settings]);
  const currentPeriod = periods[selectedPeriodIdx];

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

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (new Date(log.timestamp) < thirtyDaysAgo) return false;
      if (selectedDept !== 'All' && log.department !== selectedDept) return false;
      if (selectedUser !== 'All' && log.userId !== selectedUser) return false;
      return true;
    });
  }, [selectedDept, selectedUser, logs]);

  const filteredTimeCards = useMemo(() => {
    if (!currentPeriod) return [];
    return timeCards.filter(card => {
      const cardDate = new Date(card.date);
      cardDate.setHours(12, 0, 0, 0);
      return cardDate >= currentPeriod.start && cardDate <= currentPeriod.end;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [timeCards, currentPeriod]);

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
    if (filteredTimeCards.length === 0) return;
    const headers = ['Employee ID', 'Name', 'Focus Area', 'Date', 'Clock In', 'Clock Out', 'Total Hours', 'Status'];
    const rows = filteredTimeCards.map(card => {
      const user = users.find(u => u.id === card.userId);
      const clockIn = new Date(card.clockIn).toLocaleTimeString();
      const clockOut = card.clockOut ? new Date(card.clockOut).toLocaleTimeString() : 'Active';
      return [
        card.userId, user?.name || 'Unknown', user?.role || 'Unknown', card.date, clockIn, clockOut, card.totalHours.toFixed(2), card.status
      ].map(field => `"${field}"`).join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `time_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[700px] flex flex-col animate-fade-in">
      {/* Enhanced Manager Header */}
      <div className="bg-slate-900 text-white p-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg">
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
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${activeView === tab.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 bg-gray-50 flex-1 overflow-y-auto">

        {/* VIEW: DEPARTMENT REPORTS */}
        {activeView === 'departments' && (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-xl font-bold text-gray-800">Department Overview</h3>
                <p className="text-gray-500 text-sm">Labor distribution across the company (Last 7 Days)</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                  <TrendingUp className="w-3.5 h-3.5" />
                  +12% Efficiency
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Added explicit type casting to fix 'unknown' property access errors */}
              {(Object.entries(departmentStats) as [string, { hours: number; count: number }][]).map(([dept, data]) => (
                <div key={dept} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase
                      ${dept === Department.Production ? 'bg-purple-100 text-purple-700' :
                        dept === Department.Design ? 'bg-indigo-100 text-indigo-700' :
                          'bg-blue-100 text-blue-700'}`}>
                      {dept}
                    </span>
                    <Zap className="w-5 h-5 text-gray-300 group-hover:text-yellow-400 transition-colors" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black text-gray-900">{data.hours}</span>
                    <span className="text-gray-500 text-sm font-medium">hours logged</span>
                  </div>
                  <div className="mt-4 h-2.5 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${dept === Department.Production ? 'bg-purple-500' : 'bg-blue-500'}`}
                      style={{ width: `${Math.min(100, (data.hours / 20) * 100)}%` }}
                    ></div>
                  </div>
                  <div className="mt-3 flex justify-between text-xs text-gray-400 font-medium">
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
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  Daily Planning & AI Sync
                </h3>
                <p className="text-gray-500 text-sm">Bridge the gap between your external plans and real-time logs.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    Sync Daily Planner Data
                  </div>
                  <p className="text-xs text-gray-500">
                    Paste content from your Replit Daily Planner or external spreadsheet.
                    AI will extract departments and tasks.
                  </p>
                  <textarea
                    value={externalPlanRaw}
                    onChange={(e) => setExternalPlanRaw(e.target.value)}
                    placeholder="Paste planner data here... e.g. 'Monday: Alex production focus 500 units, Sarah design 2 tech packs...'"
                    className="w-full h-40 text-sm border-gray-200 rounded-xl focus:ring-purple-500 focus:border-purple-500 p-4 bg-slate-50 font-mono"
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

                <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl flex items-start gap-4">
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
                <div className="bg-white min-h-[500px] rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <ListTodo className="w-4 h-4 text-blue-600" />
                      Extracted Shift Goals
                    </span>
                    {parsedPlan && (
                      <span className="text-xs font-medium text-green-600 bg-green-100 px-2 py-1 rounded-full border border-green-200">
                        AI Processed
                      </span>
                    )}
                  </div>

                  <div className="flex-1 p-8 overflow-y-auto">
                    {parsedPlan ? (
                      <div className="prose prose-sm prose-slate max-w-none">
                        <div className="whitespace-pre-wrap text-gray-700 leading-relaxed font-sans">
                          {parsedPlan}
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                        <div className="p-4 bg-gray-50 rounded-full">
                          <ListTodo className="w-12 h-12 text-gray-300" />
                        </div>
                        <div>
                          <p className="text-gray-500 font-medium">No plan imported yet.</p>
                          <p className="text-gray-400 text-xs">Pasted plan data will appear here once synced.</p>
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
                <div className="flex flex-col md:flex-row gap-4 justify-between bg-white p-4 rounded-xl border border-gray-200">
                  <div className="relative">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Filter by User</label>
                    <select
                      value={selectedUser}
                      onChange={(e) => setSelectedUser(e.target.value)}
                      className="w-full md:w-64 bg-gray-50 border border-gray-300 text-sm rounded-lg p-2.5"
                    >
                      <option value="All">All Users</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-200">
                  <ul className="divide-y divide-gray-100">
                    {filteredLogs.map(log => (
                      <li key={log.id} className="p-5 hover:bg-gray-50 transition-colors">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xs">
                              {log.userName.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                              <div className="font-bold text-gray-900 text-sm">{log.userName}</div>
                              <div className="text-xs text-gray-500">{log.department} • {log.task}</div>
                            </div>
                          </div>
                          <div className="text-xs text-gray-400">
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
                <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
                  <h3 className="font-bold text-gray-800">Payment & Cycles</h3>
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-bold transition-all"
                  >
                    <Download className="w-4 h-4" /> Export All Data
                  </button>
                </div>
                {/* Table rendering logic would go here similar to previous version */}
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                  Select a pay period above to view timecard data.
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
