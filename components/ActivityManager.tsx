
import React, { useState, useMemo } from 'react';
import { Department, WorkLog, DailyTimeCard, User, AppSettings, UserSession } from '../types';
import {
  BarChart3, Users, Clock, Calendar, ChevronDown, ChevronRight, Download,
  Briefcase, CalendarRange, Sparkles, Zap, ListTodo, RefreshCw,
  Target, TrendingUp, AlertCircle, X, Save, Plus, Trash2, Edit3, Filter,
  CheckSquare, Check, Link, CalendarDays
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, collection, onSnapshot } from 'firebase/firestore';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { processExternalPlan } from '../services/geminiService';
import { UserProfileDialog } from './UserProfileDialog';
import { LogAbsenceModal } from './LogAbsenceModal';
import { AddRetroactiveCardModal } from './AddRetroactiveCardModal';

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
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

    displayUsers.forEach(user => {
      // Deterministic generation based on user index and i to ensure consistency
      const seedVal = (user.id.charCodeAt(user.id.length - 1) + i) % 15;
      
      if (isWeekend) {
        // Occasionally record emergency / sick on weekend if scheduled (let's say seedVal === 14)
        if (seedVal === 14) {
          timeCards.push({
            id: `tc-${user.id}-${i}`,
            userId: user.id,
            date: dateStr,
            clockIn: new Date(date).setHours(9, 0),
            clockOut: null,
            totalHours: 0,
            status: 'Sick',
            sickDocumentationProvided: i % 2 === 0,
            managerNotes: 'Sick call-in over the weekend.'
          });
        }
        return; // Normal weekend, no shift
      }

      if (seedVal === 3) {
        // Tardy complete shift
        const startHour = 8.5; // 30 mins late
        const startTime = new Date(date).setHours(8, 30);
        const endTime = new Date(date).setHours(17, 0);
        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: startTime,
          clockOut: endTime,
          totalHours: 8.5,
          status: 'Complete',
          minutesLate: 30,
          tardyShiftTitle: 'Morning Production Shift'
        });
      } else if (seedVal === 7) {
        // Sick day
        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: new Date(date).setHours(9, 0),
          clockOut: null,
          totalHours: 0,
          status: 'Sick',
          sickDocumentationProvided: i % 2 === 0,
          managerNotes: 'Called in sick'
        });
      } else if (seedVal === 11 && user.id === 'u2') {
        // No call no show for Sarah Connor
        const coverer = displayUsers.find(u => u.id !== user.id) || { id: 'u1', name: 'Alex Johnson' };
        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: new Date(date).setHours(9, 0),
          clockOut: null,
          totalHours: 0,
          status: 'No-Call No-Show',
          missedShiftTitle: 'Morning Production Shift',
          coveredByUserId: coverer.id,
          coveredByUserName: coverer.name
        });
      } else if (seedVal === 12 && user.id === 'u3') {
        // Tardy for Mike Ross (10 mins late)
        const startTime = new Date(date).setHours(8, 10);
        const endTime = new Date(date).setHours(17, 0);
        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: startTime,
          clockOut: endTime,
          totalHours: 8.83,
          status: 'Complete',
          minutesLate: 10,
          tardyShiftTitle: 'Warehouse Shift'
        });
      } else {
        // Normal worked shift
        const startHour = 8;
        const endHour = 17;
        const startTime = new Date(date).setHours(startHour, 0);
        const endTime = new Date(date).setHours(endHour, 0);

        timeCards.push({
          id: `tc-${user.id}-${i}`,
          userId: user.id,
          date: dateStr,
          clockIn: startTime,
          clockOut: endTime,
          totalHours: 9.0,
          status: 'Complete'
        });

        // Add log
        logs.push({
          id: `log-${user.id}-${i}-1`,
          userId: user.id,
          userName: user.name,
          timestamp: startTime,
          periodStart: startTime,
          periodEnd: endTime,
          department: user.primaryDepartment || Department.Production,
          task: `Standard operations`,
        });
      }
    });
  }
  return { timeCards, logs };
};

const getPayPeriods = (settings: AppSettings) => {
  const periods = [];
  const today = new Date();

  if (settings.useCustomPayPeriods && settings.customCycleStart && settings.customCycleEnd) {
    const anchorStart = new Date(settings.customCycleStart + 'T00:00:00');
    const anchorEnd = new Date(settings.customCycleEnd + 'T23:59:59.999');
    
    // Duration in milliseconds
    const D_ms = anchorEnd.getTime() - anchorStart.getTime() + 1;
    const D_days = Math.round(D_ms / (24 * 60 * 60 * 1000));
    
    if (D_days > 0) {
      const todayMs = today.getTime();
      const elapsedMs = todayMs - anchorStart.getTime();
      const elapsedCycles = Math.floor(elapsedMs / D_ms);
      
      // Generate 8 periods: 1 future, the current one, and 6 past ones
      for (let i = 1; i >= -6; i--) {
        const cycleIndex = elapsedCycles + i;
        const start = new Date(anchorStart.getTime() + cycleIndex * D_ms);
        const end = new Date(start.getTime() + D_ms - 1);
        
        periods.push({
          start,
          end,
          label: `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        });
      }
      return periods;
    }
  }

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
  onUpdateUser?: (updatedUser: User) => void;
  onLogAbsence?: (user: User, type: 'No-Call No-Show' | 'Sick' | 'Emergency', notes?: string) => Promise<any>;
  currentUser?: User | null;
}

export const ActivityManager: React.FC<Props> = ({ users, settings, activeSessions = {}, onClockIn, onClockOut, onUpdateUser, onLogAbsence, currentUser = null }) => {
  const viewerPerms = React.useMemo(() => {
    if (!currentUser) return [];
    if (Array.isArray(currentUser.permissions)) return currentUser.permissions;
    if (typeof currentUser.permissions === 'string') return (currentUser.permissions as string).split(',').map(s => s.trim());
    return [];
  }, [currentUser]);

  const viewerHasPermission = React.useCallback((permId: string) => {
    if (!currentUser) return false;
    const isUserAdmin = currentUser.role?.toLowerCase() === 'admin' || viewerPerms.includes('admin');
    if (isUserAdmin) return true;
    return viewerPerms.includes(permId);
  }, [currentUser, viewerPerms]);

  // Allowed views based on permissions
  const allowedViews = React.useMemo(() => {
    const views: string[] = [];
    if (viewerHasPermission('manage_users')) views.push('users');
    if (viewerHasPermission('edit_timecards')) views.push('timecards');
    if (viewerHasPermission('manage_schedule')) views.push('planning');
    if (viewerHasPermission('view_reports')) views.push('departments');
    return views;
  }, [viewerHasPermission]);

  const [activeView, setActiveView] = useState<'departments' | 'users' | 'timecards' | 'planning'>('users');

  React.useEffect(() => {
    if (allowedViews.length > 0 && !allowedViews.includes(activeView)) {
      setActiveView(allowedViews[0] as any);
    }
  }, [allowedViews, activeView]);

  const [selectedDept, setSelectedDept] = useState<Department | 'All'>('All');
  const [selectedUser, setSelectedUser] = useState<string | 'All'>('All');
  const [selectedUserForProfile, setSelectedUserForProfile] = useState<User | null>(null);
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(0);
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [absenceUser, setAbsenceUser] = useState<User | null>(null);
  const [retroactiveUser, setRetroactiveUser] = useState<User | null>(null);

  // ─── TACKBOARD & WEB DEV INTEGRATION STATE ───
  const [planningSubView, setPlanningSubView] = useState<'sync' | 'tackboard'>('tackboard');
  const [shiftBlocks, setShiftBlocks] = useState<any[]>([]);
  const [webDevTasks, setWebDevTasks] = useState<any[]>([]);
  const [webDevUser, setWebDevUser] = useState<any>(null);
  const [isWebDevLoading, setIsWebDevLoading] = useState(false);

  // Tackboard Filter States
  const [tackboardProject, setTackboardProject] = useState<string>('All');
  const [tackboardAssignee, setTackboardAssignee] = useState<string>('All');
  const [tackboardShowArchived, setTackboardShowArchived] = useState<boolean>(false);
  const [tackboardLayout, setTackboardLayout] = useState<'tackboard' | 'board' | 'list' | 'timeline'>('tackboard');

  // Add/Edit Task Modal States
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any>(null);
  const [taskFormTitle, setTaskFormTitle] = useState('');
  const [taskFormDesc, setTaskFormDesc] = useState('');
  const [taskFormAssignedTo, setTaskFormAssignedTo] = useState('unassigned');
  const [taskFormDept, setTaskFormDept] = useState<Department>(Department.Production);
  const [taskFormPriority, setTaskFormPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [taskFormStatus, setTaskFormStatus] = useState<'pending' | 'in_progress' | 'completed' | 'delayed'>('pending');
  const [taskFormStartTime, setTaskFormStartTime] = useState('08:00');
  const [taskFormEndTime, setTaskFormEndTime] = useState('16:00');
  const [taskFormDate, setTaskFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSavingTask, setIsSavingTask] = useState(false);

  // Web Dev App Config
  const webDevConfig = {
    apiKey: "AIzaSyAlFGBUXesGjZ3wMpjRGl3PNFPznqVSQP8",
    authDomain: "web-dev-a59ba.firebaseapp.com",
    projectId: "web-dev-a59ba",
    storageBucket: "web-dev-a59ba.firebasestorage.app",
    messagingSenderId: "175210741234",
    appId: "1:175210741234:web:9f59d9d4be98a8fc9d3f6b"
  };

  const getWebDevApp = () => {
    const apps = getApps();
    const existing = apps.find(a => a.name === 'webDevApp');
    if (existing) return existing;
    return initializeApp(webDevConfig, 'webDevApp');
  };

  // Subscribe to Web Dev App Auth & Tasks
  React.useEffect(() => {
    try {
      const app = getWebDevApp();
      const auth = getAuth(app);
      
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        setWebDevUser(user);
        if (user) {
          const db = getFirestore(app);
          setIsWebDevLoading(true);
          const unsubTasks = onSnapshot(collection(db, 'tasks'), (snapshot) => {
            const tasksList = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            }));
            setWebDevTasks(tasksList);
            setIsWebDevLoading(false);
          }, (err) => {
            console.error("Web Dev tasks fetch error:", err);
            setIsWebDevLoading(false);
          });
          return () => unsubTasks();
        } else {
          setWebDevTasks([]);
        }
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Failed to initialize Web Dev App Auth:", e);
    }
  }, []);

  // Subscribe to Clockwork's own shiftSchedules
  React.useEffect(() => {
    let unsubscribe = () => {};
    import('../services/firebaseService').then(({ subscribeToShiftBlocks }) => {
      unsubscribe = subscribeToShiftBlocks((blocks: any[]) => {
        setShiftBlocks(blocks);
      });
    }).catch(err => {
      console.error("Failed to subscribe to shift blocks:", err);
    });
    return () => unsubscribe();
  }, []);

  const handleConnectWebDev = async () => {
    try {
      const app = getWebDevApp();
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error("Error signing in to Web Dev:", err);
      alert("Failed to connect: " + err.message);
    }
  };

  const handleDisconnectWebDev = async () => {
    try {
      const app = getWebDevApp();
      const auth = getAuth(app);
      await signOut(auth);
    } catch (err: any) {
      console.error("Error signing out:", err);
    }
  };

  const handlePullTask = async (user: User, wdTask: any) => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      
      let mappedPriority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
      if (wdTask.priority === 'critical') mappedPriority = 'urgent';
      else if (wdTask.priority === 'high') mappedPriority = 'high';
      else if (wdTask.priority === 'low') mappedPriority = 'low';

      let mappedDept = user.primaryDepartment || Department.Production;
      const appName = String(wdTask.app || '').toLowerCase();
      if (appName.includes('design')) mappedDept = Department.Design;
      else if (appName.includes('print')) mappedDept = Department.Print;
      else if (appName.includes('ware') || appName.includes('ship')) mappedDept = Department.Warehousing;
      else if (appName.includes('facility')) mappedDept = Department.Facility;
      else if (appName.includes('event')) mappedDept = Department.Event;

      const { firebaseSaveShiftBlock } = await import('../services/firebaseService');
      
      await firebaseSaveShiftBlock({
        assignedTo: user.id,
        assignedToName: user.name,
        title: wdTask.title || 'Task',
        description: wdTask.details || '',
        department: mappedDept,
        startTime: `${todayStr}T08:00:00`,
        endTime: `${todayStr}T16:00:00`,
        priority: mappedPriority,
        status: 'pending',
        isShiftBlock: false
      });
      
      alert(`Successfully pulled task: "${wdTask.title}" onto the planner for ${user.name}!`);
    } catch (err) {
      console.error("Error pulling task:", err);
      alert("Failed to pull task: " + (err as Error).message);
    }
  };

  const openTaskModal = (task: any = null, defaultUserId: string = 'unassigned') => {
    if (task) {
      setEditingTask(task);
      setTaskFormTitle(task.title || '');
      setTaskFormDesc(task.description || '');
      setTaskFormAssignedTo(task.assignedTo || 'unassigned');
      setTaskFormDept(task.department || Department.Production);
      setTaskFormPriority(task.priority || 'medium');
      setTaskFormStatus(task.status || 'pending');
      if (task.startTime && task.startTime.includes('T')) {
        const parts = task.startTime.split('T');
        setTaskFormDate(parts[0]);
        setTaskFormStartTime(parts[1].slice(0, 5));
      } else {
        setTaskFormStartTime('08:00');
        setTaskFormDate(new Date().toISOString().split('T')[0]);
      }
      if (task.endTime && task.endTime.includes('T')) {
        const parts = task.endTime.split('T');
        setTaskFormEndTime(parts[1].slice(0, 5));
      } else {
        setTaskFormEndTime('16:00');
      }
    } else {
      setEditingTask(null);
      setTaskFormTitle('');
      setTaskFormDesc('');
      setTaskFormAssignedTo(defaultUserId);
      setTaskFormDept(Department.Production);
      setTaskFormPriority('medium');
      setTaskFormStatus('pending');
      setTaskFormStartTime('08:00');
      setTaskFormEndTime('16:00');
      setTaskFormDate(new Date().toISOString().split('T')[0]);
    }
    setTaskModalOpen(true);
  };

  const handleSaveTask = async () => {
    if (!taskFormTitle.trim()) {
      alert("Please enter a task title.");
      return;
    }
    setIsSavingTask(true);
    try {
      const { firebaseSaveShiftBlock } = await import('../services/firebaseService');
      
      const assignedUser = users.find(u => u.id === taskFormAssignedTo);
      const assignedToName = assignedUser ? assignedUser.name : 'Unassigned';

      const taskData: any = {
        title: taskFormTitle.trim(),
        description: taskFormDesc.trim(),
        assignedTo: taskFormAssignedTo,
        assignedToName,
        department: taskFormDept,
        priority: taskFormPriority,
        status: taskFormStatus,
        startTime: `${taskFormDate}T${taskFormStartTime}:00`,
        endTime: `${taskFormDate}T${taskFormEndTime}:00`,
        isShiftBlock: false
      };

      if (editingTask && editingTask.id) {
        taskData.id = editingTask.id;
      }

      await firebaseSaveShiftBlock(taskData);
      setTaskModalOpen(false);
    } catch (err: any) {
      console.error("Error saving task:", err);
      alert("Failed to save task: " + err.message);
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      const { firebaseDeleteShiftBlock } = await import('../services/firebaseService');
      await firebaseDeleteShiftBlock(taskId);
      setTaskModalOpen(false);
    } catch (err: any) {
      console.error("Error deleting task:", err);
      alert("Failed to delete task: " + err.message);
    }
  };

  const getUserColorClass = (name: string) => {
    const colors = [
      { bg: 'bg-amber-100 text-amber-800 border-amber-250', dot: 'bg-amber-500' },
      { bg: 'bg-emerald-100 text-emerald-800 border-emerald-250', dot: 'bg-emerald-500' },
      { bg: 'bg-purple-100 text-purple-800 border-purple-250', dot: 'bg-purple-500' },
      { bg: 'bg-blue-100 text-blue-800 border-blue-250', dot: 'bg-blue-500' },
      { bg: 'bg-indigo-100 text-indigo-800 border-indigo-250', dot: 'bg-indigo-500' },
      { bg: 'bg-pink-100 text-pink-800 border-pink-250', dot: 'bg-pink-500' },
      { bg: 'bg-rose-100 text-rose-800 border-rose-250', dot: 'bg-rose-500' },
      { bg: 'bg-teal-100 text-teal-800 border-teal-250', dot: 'bg-teal-500' }
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % colors.length;
    return colors[idx];
  };

  const filteredLocalTasks = useMemo(() => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const localToday = new Date(now.getTime() - (offset * 60 * 1000));
    const todayStr = localToday.toISOString().split('T')[0];

    return shiftBlocks.filter(task => {
      if (task.isShiftBlock === true || (task.title && task.title.startsWith('[SHIFT]'))) return false;

      let taskDate = task.date;
      if (!taskDate && task.startTime) {
        taskDate = task.startTime.split('T')[0];
      }

      if (!tackboardShowArchived) {
        if (task.status === 'completed') return false;
        if (taskDate && taskDate < todayStr) return false;
      }

      if (tackboardProject !== 'All' && task.department !== tackboardProject) return false;
      if (tackboardAssignee !== 'All' && task.assignedTo !== tackboardAssignee) return false;
      return true;
    });
  }, [shiftBlocks, tackboardProject, tackboardAssignee, tackboardShowArchived]);

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
  const [parsedPlan, setParsedPlan] = useState<any[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  // Note State
  const handleContextMenuCard = async (e: React.MouseEvent, card: DailyTimeCard) => {
    e.preventDefault();
    e.stopPropagation();
    const newNote = window.prompt(`Manager note for ${new Date(card.date).toLocaleDateString()}:`, card.managerNotes || "");
    if (newNote !== null) {
      const updatedCard = { ...card, managerNotes: newNote };
      setTimeCards(prev => prev.map(c => c.id === card.id ? updatedCard : c));
      
      const { storageService } = await import('../services/storageService');
      storageService.saveTimeCard(updatedCard);

      const { firebaseSaveTimeCard, isFirebaseConfigured } = await import('../services/firebaseService');
      if (isFirebaseConfigured() && !updatedCard.id.startsWith('active-')) {
         firebaseSaveTimeCard(updatedCard).catch(console.error);
      }
    }
  };

  // Timecard Editing State
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState<string>('');
  const [editClockOut, setEditClockOut] = useState<string>('');
  const [editIdleTime, setEditIdleTime] = useState<string>('');

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
      let localData = storageService.getAllData();
      if (localData.timeCards.length === 0) {
        const seeded = generateMockData(users);
        seeded.timeCards.forEach(tc => storageService.saveTimeCard(tc));
        seeded.logs.forEach(l => storageService.saveLog(l));
        localData = storageService.getAllData();
      }
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
    })
    .filter(group => group.cards.length > 0)
    .sort((a: any, b: any) => {
      const nameA = users.find(u => u.id === a.userId)?.name || '';
      const nameB = users.find(u => u.id === b.userId)?.name || '';
      return nameA.localeCompare(nameB);
    });
  }, [filteredTimeCards, users, activeSessions]);

  const handleSyncPlan = async () => {
    if (!externalPlanRaw.trim()) return;
    setIsSyncing(true);
    setPlanError(null);
    setParsedPlan(null);
    try {
      const result = await processExternalPlan(externalPlanRaw);
      const parsed = JSON.parse(result);
      if (parsed.error) {
         setPlanError(parsed.error);
      } else {
         setParsedPlan(Array.isArray(parsed) ? parsed : [parsed]);
      }
    } catch (err) {
      console.error(err);
      setPlanError("Invalid response from AI. Please try again.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSaveToSchedule = async () => {
    if (!parsedPlan || parsedPlan.length === 0) return;
    setIsSavingSchedule(true);
    try {
      const { firebaseSaveShiftBlock, isFirebaseConfigured } = await import('../services/firebaseService');
      if (!isFirebaseConfigured()) {
        alert("Firebase is not configured. Cannot save schedule.");
        setIsSavingSchedule(false);
        return;
      }
      
      const today = new Date().toISOString().split('T')[0];
      let savedCount = 0;
      
      for (const block of parsedPlan) {
        const assignedName = (block.assignedToName || '').toLowerCase().trim();
        const aiFirstName = assignedName.split(' ')[0];

        let assignedUser = users.find(u => {
          const dbName = u.name.toLowerCase().trim();
          const dbUsername = (u.username || '').toLowerCase().trim();
          const dbFirstName = dbName.split(' ')[0];
          
          return dbName === assignedName || 
                 dbUsername === assignedName ||
                 dbName.includes(assignedName) || 
                 assignedName.includes(dbName) ||
                 dbFirstName === aiFirstName ||
                 dbFirstName.includes(aiFirstName) ||
                 aiFirstName.includes(dbFirstName);
        });
        
        const userId = assignedUser ? assignedUser.id : 'unassigned';
        
        await firebaseSaveShiftBlock({
          assignedTo: userId,
          assignedToName: block.assignedToName || 'Unknown',
          title: block.title || 'Task',
          description: block.description || '',
          department: block.department || Department.Production,
          startTime: `${today}T${block.startTime || '08:00'}:00`,
          endTime: `${today}T${block.endTime || '16:00'}:00`,
          priority: 'medium',
          status: 'pending',
          isShiftBlock: false
        });
        savedCount++;
      }
      
      alert(`Successfully saved ${savedCount} tasks to the schedule!`);
      setParsedPlan(null);
      setExternalPlanRaw('');
    } catch (err) {
      console.error("Error saving schedule:", err);
      alert("Failed to save schedule.");
    } finally {
      setIsSavingSchedule(false);
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
        const shiftHrlyPay = (viewerHasPermission('view_payroll') && user?.payRate) ? user.payRate.toFixed(2) : '';
        const shiftInctvPay = '';
        const shiftTotalPay = (viewerHasPermission('view_payroll') && user?.payRate) ? (card.totalHours * user.payRate).toFixed(2) : '';
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
    setEditIdleTime((card.totalIdleHours || 0).toFixed(2));
  };

  const saveEditedCard = async (card: DailyTimeCard) => {
    const inTime = new Date(editClockIn).getTime();
    const outTime = editClockOut ? new Date(editClockOut).getTime() : null;
    const idleTimeNum = parseFloat(editIdleTime) || 0;
    if (isNaN(inTime) || (editClockOut && isNaN(outTime!))) {
      alert("Invalid date/time format.");
      return;
    }
    const updatedCard: DailyTimeCard = {
      ...card,
      clockIn: inTime,
      clockOut: outTime,
      totalIdleHours: idleTimeNum,
      totalHours: outTime ? Math.max(0, ((outTime - inTime) / 3600000) - idleTimeNum) : card.totalHours,
      status: outTime ? 'Complete' : 'Active'
    };

    setTimeCards(prev => prev.map(c => c.id === card.id ? updatedCard : c));
    setEditingCardId(null);

    const { storageService } = await import('../services/storageService');
    storageService.saveTimeCard(updatedCard);

    const { firebaseSaveTimeCard, firebaseUpdateActiveSession, isFirebaseConfigured } = await import('../services/firebaseService');
    if (isFirebaseConfigured()) {
      try {
        if (card.id.startsWith('active-')) {
          await firebaseUpdateActiveSession(card.userId, inTime, outTime, idleTimeNum);
        } else {
          await firebaseSaveTimeCard(updatedCard);
        }
      } catch (err) {
        console.error("Failed to save updated timecard to remote:", err);
      }
    }
  };

  const handleSaveRetroactiveCard = async (user: User, clockInMs: number, clockOutMs: number, idleHours: number, date: string, notes: string) => {
    const newCard: DailyTimeCard = {
      id: `tc-retro-${user.id}-${Date.now()}`,
      userId: user.id,
      date,
      clockIn: clockInMs,
      clockOut: clockOutMs,
      totalHours: Math.max(0, ((clockOutMs - clockInMs) / 3600000) - idleHours),
      totalIdleHours: idleHours,
      status: 'Complete',
      managerNotes: notes || 'Retroactive entry'
    };

    setTimeCards(prev => [newCard, ...prev]);

    const { storageService } = await import('../services/storageService');
    storageService.saveTimeCard(newCard);

    const { firebaseSaveTimeCard, isFirebaseConfigured } = await import('../services/firebaseService');
    if (isFirebaseConfigured()) {
      try {
        await firebaseSaveTimeCard(newCard);
      } catch (err) {
        console.error('Failed to save retroactive timecard to remote:', err);
      }
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden min-h-[700px] flex flex-col animate-fade-in">
      {/* Enhanced Manager Header */}
      <div className="bg-zinc-900 text-white p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="bg-zinc-900 p-1.5 rounded-lg">
            <Briefcase className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Manager Console</h2>
        </div>

        {/* Divider line to differentiate the tab row */}
        <div className="border-t border-zinc-800/80 my-1" />

        <div className="flex bg-zinc-850 rounded-xl p-1 w-full overflow-x-auto hide-scrollbar">
          {[
            { id: 'users', icon: Users, label: 'Users' },
            { id: 'timecards', icon: Clock, label: 'Time' },
            { id: 'planning', icon: Target, label: 'Planning' },
            { id: 'departments', icon: BarChart3, label: 'Depts' }
          ].filter(tab => allowedViews.includes(tab.id)).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as any)}
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
                activeView === tab.id
                  ? 'bg-white text-zinc-900 shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
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
                      ${dept === Department.Production ? 'bg-zinc-100 text-zinc-700' :
                        dept === Department.Design ? 'bg-zinc-100 text-zinc-700' :
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
                      className={`h-full rounded-full transition-all duration-1000 ${dept === Department.Production ? 'bg-zinc-500' : 'bg-zinc-500'}`}
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
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-200 pb-4">
              <div>
                <h3 className="text-xl font-bold text-zinc-800 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-zinc-600" />
                  Manager Planning Console
                </h3>
                <p className="text-zinc-500 text-sm">Bridge plans, assign tasks, and sync with external systems.</p>
              </div>
              <div className="flex bg-zinc-200/60 p-1 rounded-xl shadow-inner border border-zinc-200/20 shrink-0">
                <button
                  onClick={() => setPlanningSubView('sync')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    planningSubView === 'sync'
                      ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200/45'
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  AI Importer & Sync
                </button>
                <button
                  onClick={() => setPlanningSubView('tackboard')}
                  className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    planningSubView === 'tackboard'
                      ? 'bg-white text-zinc-900 shadow-sm border border-zinc-200/45'
                      : 'text-zinc-500 hover:text-zinc-800'
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Tackboard
                </button>
              </div>
            </div>

            {planningSubView === 'sync' ? (
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
                      className="w-full h-40 text-sm border-zinc-200 rounded-xl focus:ring-zinc-500 focus:border-zinc-500 p-4 bg-zinc-50 font-mono"
                    />
                    <button
                      onClick={handleSyncPlan}
                      disabled={isSyncing || !externalPlanRaw.trim()}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-zinc-600 to-zinc-600 text-white font-bold rounded-xl shadow-lg shadow-zinc-100 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      {isSyncing ? 'Processing with AI...' : 'Parse Plan with Gemini'}
                    </button>
                  </div>

                  <div className="bg-zinc-50 border border-zinc-100 p-6 rounded-2xl flex items-start gap-4">
                    <div className="p-2 bg-zinc-200 rounded-lg">
                      <AlertCircle className="w-5 h-5 text-zinc-700" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-zinc-900">Pro Tip</h4>
                      <p className="text-xs text-zinc-700 mt-1 leading-relaxed">
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
                        <div className="flex gap-2">
                          <span className="text-xs font-medium text-zinc-900 bg-zinc-100 px-2 py-1 rounded-full border border-zinc-200">
                            AI Processed
                          </span>
                          <button
                            onClick={handleSaveToSchedule}
                            disabled={isSavingSchedule}
                            className="text-xs font-bold bg-zinc-900 text-white px-3 py-1 rounded-full hover:bg-zinc-800 transition-colors flex items-center gap-1"
                          >
                            {isSavingSchedule ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Calendar className="w-3 h-3" />}
                            {isSavingSchedule ? 'Saving...' : 'Save to Schedule'}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 p-8 overflow-y-auto">
                      {planError ? (
                        <div className="text-red-500 bg-red-50 p-4 rounded-xl border border-red-100 text-sm">
                          {planError}
                        </div>
                      ) : parsedPlan ? (
                        <div className="space-y-4">
                          {parsedPlan.map((task, idx) => (
                            <div key={idx} className="p-4 bg-zinc-50 rounded-xl border border-zinc-100 shadow-sm hover:shadow-md transition-all">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-bold text-zinc-900">{task.title}</h4>
                                <span className="text-[10px] font-bold px-2 py-1 bg-zinc-200 text-zinc-700 rounded-full">{task.department}</span>
                              </div>
                              <p className="text-sm text-zinc-600 mb-3">{task.description}</p>
                              <div className="flex justify-between items-center mt-3 pt-3 border-t border-zinc-200/60">
                                <div className="flex items-center gap-2 text-xs text-zinc-600 font-bold">
                                  <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-white">
                                    {task.assignedToName?.charAt(0) || '?'}
                                  </div>
                                  {task.assignedToName}
                                </div>
                                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-500 bg-white px-2 py-1 rounded-md border border-zinc-200">
                                  <Clock className="w-3 h-3" />
                                  {task.startTime || '08:00'} - {task.endTime || '16:00'}
                                </div>
                              </div>
                            </div>
                          ))}
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
            ) : (
              <div className="space-y-6">
                {/* Connection banner */}
                <div className="bg-white/80 backdrop-blur-sm border border-zinc-200 p-4 rounded-2xl flex flex-wrap gap-4 items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-zinc-100 rounded-xl border border-zinc-200">
                      <Link className="w-4 h-4 text-zinc-700" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-zinc-950">Web Dev Task Import Integration</h4>
                      <p className="text-[11px] text-zinc-500">
                        {webDevUser 
                          ? `Connected to web-dev-a59ba as ${webDevUser.email}. Matching assignees can be pulled.` 
                          : "Connect your Web Dev account via Google Sign-In to pull backlog tasks."}
                      </p>
                    </div>
                  </div>
                  <div>
                    {webDevUser ? (
                      <button
                        onClick={handleDisconnectWebDev}
                        className="text-[11px] font-bold bg-zinc-50 hover:bg-zinc-100 text-zinc-600 border border-zinc-200 py-1.5 px-3 rounded-xl transition-colors shadow-sm"
                      >
                        Disconnect Web Dev
                      </button>
                    ) : (
                      <button
                        onClick={handleConnectWebDev}
                        className="text-[11px] font-bold bg-zinc-900 hover:bg-zinc-800 text-white py-1.5 px-3 rounded-xl transition-colors flex items-center gap-1 shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Connect Web Dev Account
                      </button>
                    )}
                  </div>
                </div>

                {/* Filters Row */}
                <div className="bg-white p-4 rounded-2xl border border-zinc-200 shadow-sm flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-400 flex items-center gap-1">
                        <Filter className="w-3 h-3" />
                        Project:
                      </span>
                      <select
                        value={tackboardProject}
                        onChange={(e) => setTackboardProject(e.target.value)}
                        className="text-xs font-bold bg-zinc-50 border border-zinc-200 rounded-lg py-1 px-2.5 focus:ring-zinc-450 focus:border-zinc-450"
                      >
                        <option value="All">All projects</option>
                        {Object.values(Department).map(dept => (
                          <option key={dept} value={dept}>{dept}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-400">Assigned to:</span>
                      <select
                        value={tackboardAssignee}
                        onChange={(e) => setTackboardAssignee(e.target.value)}
                        className="text-xs font-bold bg-zinc-50 border border-zinc-200 rounded-lg py-1 px-2.5 focus:ring-zinc-450 focus:border-zinc-450"
                      >
                        <option value="All">Anyone</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={tackboardShowArchived}
                        onChange={(e) => setTackboardShowArchived(e.target.checked)}
                        className="rounded border-zinc-300 text-zinc-800 focus:ring-zinc-500 h-4 w-4"
                      />
                      <span className="text-xs font-bold text-zinc-550">Show Archived</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                      {(['board', 'list', 'timeline', 'tackboard'] as const).map(layout => (
                        <button
                          key={layout}
                          onClick={() => setTackboardLayout(layout)}
                          className={`text-[9px] uppercase font-black py-1 px-2 rounded transition-all ${
                            tackboardLayout === layout
                              ? 'bg-zinc-800 text-white shadow-sm'
                              : 'text-zinc-500 hover:text-zinc-800'
                          }`}
                        >
                          {layout}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => openTaskModal(null)}
                      className="flex items-center gap-1.5 py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New task
                    </button>
                  </div>
                </div>

                {/* Layout Container */}
                {isWebDevLoading && (
                  <div className="flex items-center justify-center p-8 bg-white border border-zinc-200 rounded-2xl shadow-sm text-sm font-bold text-zinc-500 gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-zinc-800" />
                    Fetching Web Dev tasks...
                  </div>
                )}

                {tackboardLayout === 'tackboard' && (
                  <div className="flex gap-6 overflow-x-auto pb-4 items-start select-none">
                    {/* Render Columns */}
                    {(tackboardAssignee !== 'All' ? users.filter(u => u.id === tackboardAssignee) : users).map(user => {
                      const userColor = getUserColorClass(user.name);
                      const userTasks = filteredLocalTasks.filter(t => t.assignedTo === user.id);
                      
                      // Filter matching backlog tasks
                      const matchingWebDevTasks = webDevTasks.filter(wdTask => {
                        if (!user.email) return false;
                        const userEmailLower = user.email.toLowerCase();
                        const isAssigned = Array.isArray(wdTask.assignees) && 
                          wdTask.assignees.some((email: any) => String(email).toLowerCase() === userEmailLower);
                        if (!isAssigned) return false;
                        if (wdTask.status === 'done' && !tackboardShowArchived) return false;
                        
                        // Check if already pulled
                        const alreadyPulled = shiftBlocks.some(localTask => 
                          localTask.assignedTo === user.id && 
                          localTask.title.toLowerCase().trim() === wdTask.title.toLowerCase().trim()
                        );
                        return !alreadyPulled;
                      });

                      return (
                        <div key={user.id} className="w-[320px] shrink-0 bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm flex flex-col min-h-[450px]">
                          <div className="flex items-center justify-between pb-3 border-b border-zinc-150 mb-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-black text-xs ${userColor.bg} ${userColor.border}`}>
                                {user.avatarInitials || user.name.split(' ').map(n=>n[0]).join('')}
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-zinc-900 leading-tight">{user.name}</h4>
                                <p className="text-[10px] text-zinc-400 leading-none">{user.role}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-bold bg-zinc-100 text-zinc-650 px-2 py-0.5 rounded-full border border-zinc-200">
                                {userTasks.length}
                              </span>
                              <button
                                onClick={() => openTaskModal(null, user.id)}
                                className="p-1 hover:bg-zinc-100 rounded text-zinc-400 hover:text-zinc-800 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Task List */}
                          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px] mb-4 pr-1">
                            {userTasks.length === 0 ? (
                              <div className="text-xs text-zinc-400 italic text-center py-6">No active tasks</div>
                            ) : (
                              userTasks.map(task => (
                                <div
                                  key={task.id}
                                  onClick={() => openTaskModal(task)}
                                  className="bg-zinc-50 border border-zinc-200 p-3.5 rounded-xl hover:shadow-md cursor-pointer transition-all hover:scale-[1.015] group"
                                >
                                  <div className="flex justify-between items-start gap-2 mb-1.5">
                                    <h5 className="text-xs font-bold text-zinc-900 leading-tight flex items-center gap-1.5">
                                      {task.priority === 'urgent' || task.priority === 'high' ? (
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                      ) : null}
                                      {task.title}
                                    </h5>
                                    {task.department && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-zinc-200 text-zinc-650 rounded shrink-0 uppercase">
                                        {task.department}
                                      </span>
                                    )}
                                  </div>
                                  {task.description && (
                                    <p className="text-[10px] text-zinc-500 leading-relaxed line-clamp-2 mb-2">{task.description}</p>
                                  )}
                                  <div className="flex justify-between items-center text-[9px] text-zinc-450 border-t border-zinc-200/40 pt-2">
                                    <span className={`px-1.5 py-0.2 rounded font-bold uppercase ${
                                      task.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                                      task.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                                      task.status === 'delayed' ? 'bg-amber-50 text-amber-700' :
                                      'bg-zinc-100 text-zinc-600'
                                    }`}>
                                      {task.status?.replace('_', ' ')}
                                    </span>
                                    <span className="font-mono">{task.startTime?.split('T')[1]?.slice(0, 5) || '08:00'} - {task.endTime?.split('T')[1]?.slice(0, 5) || '16:00'}</span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          {/* Web Dev Backlog Section */}
                          {matchingWebDevTasks.length > 0 && (
                            <div className="mt-auto pt-4 border-t border-dashed border-zinc-200 bg-zinc-50 p-3 rounded-2xl border">
                              <div className="flex items-center gap-1 mb-2">
                                <Link className="w-3.5 h-3.5 text-zinc-450" />
                                <span className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">Web Dev Backlog</span>
                                <span className="text-[9px] font-black bg-zinc-200 px-1.5 py-0.2 rounded-full text-zinc-650 ml-auto">
                                  {matchingWebDevTasks.length}
                                </span>
                              </div>
                              <div className="space-y-2.5 max-h-[180px] overflow-y-auto pr-1">
                                {matchingWebDevTasks.map(wdTask => (
                                  <div key={wdTask.id} className="bg-white border border-dashed border-zinc-250 p-2.5 rounded-xl text-xs shadow-sm">
                                    <div className="flex justify-between items-start gap-1.5">
                                      <span className="font-bold text-zinc-800 text-[11px] leading-tight">{wdTask.title}</span>
                                      {wdTask.app && (
                                        <span className="text-[8px] font-bold px-1 py-0.2 bg-zinc-100 text-zinc-500 border border-zinc-150 rounded shrink-0 uppercase">
                                          {wdTask.app}
                                        </span>
                                      )}
                                    </div>
                                    {wdTask.details && (
                                      <p className="text-[9px] text-zinc-500 line-clamp-2 mt-1 leading-snug">{wdTask.details}</p>
                                    )}
                                    <div className="mt-2 flex justify-between items-center">
                                      <span className={`text-[8px] px-1.5 py-0.2 rounded-full uppercase font-bold ${
                                        wdTask.priority === 'critical' ? 'bg-red-50 text-red-600 border border-red-100' :
                                        wdTask.priority === 'high' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                        'bg-blue-50 text-blue-600 border border-blue-100'
                                      }`}>{wdTask.priority}</span>
                                      <button
                                        onClick={() => handlePullTask(user, wdTask)}
                                        className="text-[9px] font-black bg-zinc-900 hover:bg-zinc-800 text-white py-1 px-2.5 rounded-lg flex items-center gap-0.5 shadow-sm transition-all"
                                      >
                                        <Download className="w-3 h-3" />
                                        Pull to Planner
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Unassigned column */}
                    {(() => {
                      const unassignedTasks = filteredLocalTasks.filter(t => !t.assignedTo || t.assignedTo === 'unassigned');
                      if (unassignedTasks.length === 0 && tackboardAssignee !== 'All') return null;
                      if (unassignedTasks.length === 0) return null;
                      return (
                        <div className="w-[320px] shrink-0 bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm flex flex-col min-h-[450px]">
                          <div className="flex items-center justify-between pb-3 border-b border-zinc-150 mb-4">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full border border-dashed border-zinc-300 bg-zinc-50 flex items-center justify-center font-bold text-sm text-zinc-400">
                                ?
                              </div>
                              <div>
                                <h4 className="text-xs font-bold text-zinc-800 leading-tight">Unassigned Pool</h4>
                                <p className="text-[10px] text-zinc-400 leading-none">Shared tasks</p>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold bg-zinc-100 text-zinc-650 px-2 py-0.5 rounded-full border border-zinc-200">
                              {unassignedTasks.length}
                            </span>
                          </div>

                          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px] pr-1">
                            {unassignedTasks.map(task => (
                              <div
                                key={task.id}
                                onClick={() => openTaskModal(task)}
                                className="bg-zinc-50 border border-zinc-200 p-3.5 rounded-xl hover:shadow-md cursor-pointer transition-all hover:scale-[1.015]"
                              >
                                <div className="flex justify-between items-start gap-2 mb-1.5">
                                  <h5 className="text-xs font-bold text-zinc-900 leading-tight">{task.title}</h5>
                                  {task.department && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-zinc-200 text-zinc-650 rounded shrink-0 uppercase">{task.department}</span>
                                  )}
                                </div>
                                {task.description && (
                                  <p className="text-[10px] text-zinc-500 line-clamp-2 mb-2">{task.description}</p>
                                )}
                                <div className="flex justify-between items-center text-[9px] text-zinc-450 border-t border-zinc-200/40 pt-2">
                                  <span className="capitalize">{task.status?.replace('_', ' ')}</span>
                                  <span>{task.startTime?.split('T')[1]?.slice(0, 5) || '08:00'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {tackboardLayout === 'board' && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {(['pending', 'in_progress', 'completed', 'delayed'] as const).map(status => {
                      const statusTasks = filteredLocalTasks.filter(t => t.status === status);
                      return (
                        <div key={status} className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm flex flex-col min-h-[450px]">
                          <div className="flex items-center justify-between pb-3 border-b border-zinc-150 mb-4">
                            <span className="text-xs font-bold capitalize text-zinc-800 flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${
                                status === 'completed' ? 'bg-emerald-500' :
                                status === 'in_progress' ? 'bg-blue-500' :
                                status === 'delayed' ? 'bg-amber-500' : 'bg-zinc-400'
                              }`} />
                              {status.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] font-bold bg-zinc-100 px-2 py-0.5 rounded-full text-zinc-650 border border-zinc-200">
                              {statusTasks.length}
                            </span>
                          </div>
                          <div className="flex-1 space-y-3 overflow-y-auto max-h-[400px] pr-1">
                            {statusTasks.length === 0 ? (
                              <div className="text-xs text-zinc-450 italic text-center py-6">No tasks</div>
                            ) : (
                              statusTasks.map(task => (
                                <div
                                  key={task.id}
                                  onClick={() => openTaskModal(task)}
                                  className="bg-zinc-50 border border-zinc-200 p-3.5 rounded-xl hover:shadow-md cursor-pointer transition-all hover:scale-[1.015]"
                                >
                                  <div className="flex justify-between items-start gap-2 mb-2">
                                    <h5 className="text-xs font-bold text-zinc-900 leading-tight">
                                      {task.priority === 'urgent' || task.priority === 'high' ? (
                                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 align-middle" />
                                      ) : null}
                                      {task.title}
                                    </h5>
                                    {task.department && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-zinc-200 text-zinc-650 rounded shrink-0 uppercase">
                                        {task.department}
                                      </span>
                                    )}
                                  </div>
                                  {task.description && (
                                    <p className="text-[10px] text-zinc-505 line-clamp-2 leading-relaxed mb-2">{task.description}</p>
                                  )}
                                  <div className="mt-2.5 pt-2.5 border-t border-zinc-200/50 flex justify-between items-center text-[9px] text-zinc-450">
                                    <span className="font-bold text-zinc-700">{task.assignedToName || 'Unassigned'}</span>
                                    <span>{task.startTime?.split('T')[1]?.slice(0, 5) || '08:00'}</span>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tackboardLayout === 'list' && (
                  <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-zinc-700">
                        <thead className="bg-zinc-50 border-b border-zinc-200 font-bold uppercase text-[9px] text-zinc-500 tracking-wider">
                          <tr>
                            <th className="px-6 py-3.5">Task Title</th>
                            <th className="px-6 py-3.5">Assignee</th>
                            <th className="px-6 py-3.5">Project/Dept</th>
                            <th className="px-6 py-3.5">Priority</th>
                            <th className="px-6 py-3.5">Status</th>
                            <th className="px-6 py-3.5">Scheduled Time</th>
                            <th className="px-6 py-3.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-250">
                          {filteredLocalTasks.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-6 py-8 text-center text-zinc-450 italic">No tasks match selected filters.</td>
                            </tr>
                          ) : (
                            filteredLocalTasks.map(task => (
                              <tr key={task.id} className="hover:bg-zinc-50/50 transition-colors">
                                <td className="px-6 py-4 font-bold text-zinc-900 text-xs">{task.title}</td>
                                <td className="px-6 py-4 font-medium text-zinc-650">{task.assignedToName || 'Unassigned'}</td>
                                <td className="px-6 py-4">
                                  <span className="bg-zinc-100 text-zinc-700 py-0.5 px-2 rounded font-bold uppercase text-[8px] border border-zinc-200">{task.department}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <span className={`capitalize py-0.5 px-2 rounded-full font-bold text-[8px] border ${
                                    task.priority === 'urgent' ? 'bg-red-50 text-red-700 border-red-100' :
                                    task.priority === 'high' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                                    task.priority === 'medium' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                    'bg-zinc-50 text-zinc-700 border-zinc-200'
                                  }`}>{task.priority}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <span className="capitalize py-0.5 px-2 bg-zinc-50 text-zinc-700 rounded border border-zinc-200 text-[9px]">{task.status?.replace('_', ' ')}</span>
                                </td>
                                <td className="px-6 py-4 font-mono font-bold text-zinc-500">{task.startTime?.split('T')[1]?.slice(0, 5) || '08:00'} - {task.endTime?.split('T')[1]?.slice(0, 5) || '16:00'}</td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => openTaskModal(task)}
                                    className="text-zinc-700 hover:text-zinc-950 font-black hover:underline py-1 px-2.5 rounded-lg border border-zinc-200 hover:bg-white bg-zinc-50 shadow-sm"
                                  >
                                    Edit
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {tackboardLayout === 'timeline' && (
                  <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm space-y-6">
                    <div className="flex items-center gap-1.5">
                      <CalendarDays className="w-4 h-4 text-zinc-700" />
                      <h4 className="text-xs font-black text-zinc-550 uppercase tracking-wider">Scheduled Tasks Timeline</h4>
                    </div>
                    {filteredLocalTasks.length === 0 ? (
                      <div className="text-zinc-450 italic text-sm text-center py-8">No tasks scheduled.</div>
                    ) : (
                      <div className="relative border-l-2 border-zinc-200 pl-6 ml-4 space-y-6">
                        {[...filteredLocalTasks].sort((a,b) => String(a.startTime).localeCompare(String(b.startTime))).map((task) => (
                          <div key={task.id} className="relative">
                            <span className="absolute -left-[32px] top-1.5 w-4 h-4 rounded-full border-4 border-white bg-zinc-800 shadow" />
                            <div
                              onClick={() => openTaskModal(task)}
                              className="p-4 bg-zinc-50 border border-zinc-200 rounded-2xl hover:shadow-md cursor-pointer transition-all hover:scale-[1.005]"
                            >
                              <div className="flex justify-between items-start gap-4 mb-2 flex-wrap">
                                <div>
                                  <h5 className="font-bold text-zinc-950 text-sm leading-snug">{task.title}</h5>
                                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                                    {task.startTime?.split('T')[1]?.slice(0, 5)} - {task.endTime?.split('T')[1]?.slice(0, 5)} | {task.startTime?.split('T')[0]}
                                  </p>
                                </div>
                                <div className="flex gap-2">
                                  <span className="text-[8px] font-bold px-2 py-0.5 rounded bg-zinc-200 text-zinc-650 uppercase border border-zinc-300">{task.department}</span>
                                  <span className={`capitalize text-[9px] px-2 py-0.5 rounded border ${
                                    task.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                    task.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                                    'bg-zinc-100 text-zinc-600 border-zinc-200'
                                  }`}>{task.status?.replace('_', ' ')}</span>
                                </div>
                              </div>
                              {task.description && (
                                <p className="text-xs text-zinc-550 leading-relaxed mb-3">{task.description}</p>
                              )}
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-bold text-zinc-800 flex items-center gap-1.5 bg-white py-1 px-2.5 rounded-lg border border-zinc-250/60 shadow-sm">
                                  <span className="w-5 h-5 rounded-full bg-zinc-950 text-white flex items-center justify-center text-[9px] font-bold uppercase border border-zinc-800">
                                    {task.assignedToName?.charAt(0) || '?'}
                                  </span>
                                  {task.assignedToName}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Existing User Reports and Time Reports logic remains below... */}
        {(activeView === 'users' || activeView === 'timecards') && (
          <div className="space-y-6">
            {/* Keeping current filter logic from previous implementation for backward compatibility */}
            {activeView === 'users' ? (
              <div className="space-y-6 animate-in slide-in-from-bottom-4">
                <div className="flex flex-col md:flex-row gap-4 justify-between bg-white p-6 rounded-xl border border-zinc-200 shadow-sm">
                  <div>
                    <h3 className="text-xl font-bold text-zinc-800">Active Team Members - {users.length}</h3>
                    <p className="text-zinc-500 text-sm">Select a staff member to view their performance metrics and full profile.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {users.map(user => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUserForProfile(user)}
                      className="flex items-center gap-4 bg-white p-5 rounded-2xl border border-zinc-200 hover:border-zinc-400 hover:shadow-lg transition-all text-left group"
                    >
                      <div className="w-14 h-14 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center text-xl font-bold group-hover:bg-zinc-800 group-hover:text-white transition-colors">
                        {user.avatarInitials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-zinc-900 truncate">{user.name}</div>
                        <div className="text-xs text-zinc-500 truncate">{user.role}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-zinc-500 transition-colors" />
                    </button>
                  ))}
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
                      className="flex-1 lg:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-zinc-100 hover:bg-zinc-800 transition-all"
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
                                  {group.status !== 'Active' && user && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setAbsenceUser(user); }}
                                      className="text-[10px] font-bold bg-white text-red-600 border border-red-200 hover:bg-red-50 px-2 py-1 rounded shadow-sm transition-colors"
                                    >Log Absence</button>
                                  )}
                                  {group.status === 'Active' && onClockOut && user && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); onClockOut(user); }}
                                      className="text-[10px] font-bold bg-white text-amber-600 border border-amber-200 hover:bg-amber-50 px-2 py-1 rounded shadow-sm transition-colors"
                                    >Clock Out</button>
                                  )}
                                  {user && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setRetroactiveUser(user); }}
                                      className="text-[10px] font-bold bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 px-2 py-1 rounded shadow-sm transition-colors"
                                    >+ Add Record</button>
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
                                    {isEditing ? (
                                      <tr>
                                        <td colSpan={6} className="p-0 border-b border-zinc-100 bg-zinc-50/30">
                                          <div className="bg-white m-3 p-5 rounded-xl border border-zinc-200 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 animate-in slide-in-from-top-2 duration-200">
                                            <div className="flex items-center justify-between mb-4">
                                              <div className="flex items-center gap-2">
                                                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                                                  <Clock className="w-4 h-4" />
                                                </div>
                                                <div>
                                                  <h4 className="text-sm font-bold text-zinc-900">Edit Time Record</h4>
                                                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{new Date(card.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
                                                </div>
                                              </div>
                                              <button onClick={() => setEditingCardId(null)} className="p-2 hover:bg-zinc-100 rounded-lg transition-colors text-zinc-400 hover:text-zinc-600">
                                                <X className="w-4 h-4" />
                                              </button>
                                            </div>
                                            
                                            <div className="flex flex-wrap gap-4 items-end bg-zinc-50/50 p-4 rounded-lg border border-zinc-100">
                                              <div className="flex-1 min-w-[200px]">
                                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 ml-1">Clock In Time</label>
                                                <input
                                                  type="datetime-local"
                                                  value={editClockIn}
                                                  onChange={e => setEditClockIn(e.target.value)}
                                                  className="w-full text-sm font-medium border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                                                />
                                              </div>
                                              <div className="flex-1 min-w-[200px]">
                                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 ml-1">Clock Out Time</label>
                                                <input
                                                  type="datetime-local"
                                                  value={editClockOut}
                                                  onChange={e => setEditClockOut(e.target.value)}
                                                  className="w-full text-sm font-medium border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                                                />
                                              </div>
                                              <div className="w-32">
                                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5 ml-1">Idle (Unpaid)</label>
                                                <div className="relative">
                                                  <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    value={editIdleTime}
                                                    onChange={e => setEditIdleTime(e.target.value)}
                                                    className="w-full text-sm font-medium border border-zinc-200 rounded-lg pl-3 pr-8 py-2 bg-white focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm"
                                                  />
                                                  <span className="absolute right-3 top-2 text-xs text-zinc-400 font-bold">hr</span>
                                                </div>
                                              </div>
                                              <div className="flex gap-2 w-full md:w-auto mt-2 md:mt-0 ml-auto">
                                                <button onClick={() => setEditingCardId(null)} className="flex-1 md:flex-none px-5 py-2 text-xs font-bold text-zinc-600 bg-white border border-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 rounded-lg transition-all shadow-sm">Cancel</button>
                                                <button onClick={() => saveEditedCard(card)} className="flex-1 md:flex-none px-5 py-2 text-xs font-bold text-white bg-zinc-900 hover:bg-zinc-800 rounded-lg transition-all shadow-md shadow-zinc-200 flex items-center justify-center gap-2">
                                                  <Save className="w-3.5 h-3.5" /> Save Changes
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    ) : (
                                      <tr
                                        className="bg-zinc-50/50 hover:bg-zinc-100/50 transition-colors cursor-pointer"
                                        onClick={() => toggleCardExpanded(card.id)}
                                        onContextMenu={(e) => handleContextMenuCard(e, card)}
                                      >
                                        <td className="px-6 py-3 pl-16">
                                          <div className="flex items-center gap-2">
                                            {isCardExpanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
                                            <div className="flex flex-col">
                                              <div className="text-xs text-zinc-600 font-bold">Total Time</div>
                                              {card.managerNotes && (
                                                <div className="text-[10px] text-amber-600 font-normal mt-0.5 truncate max-w-[150px]" title={card.managerNotes}>
                                                  📝 {card.managerNotes}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-6 py-3 text-zinc-600 font-medium">
                                          {new Date(card.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="px-6 py-3" onClick={e => e.stopPropagation()}>
                                          <div className="text-xs font-medium text-zinc-900">
                                            {new Date(card.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                          </div>
                                          <div className="text-[10px] text-zinc-500">
                                            {card.clockOut ? new Date(card.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active...'}
                                          </div>
                                        </td>
                                        <td className="px-6 py-3" onClick={e => e.stopPropagation()}>
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
                                              ${card.status === 'No-Call No-Show' ? 'bg-red-50 text-red-700 border-red-200 shadow-sm' :
                                                card.status === 'Sick' ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm' :
                                                card.status === 'Emergency' ? 'bg-purple-50 text-purple-700 border-purple-200 shadow-sm' :
                                                'bg-zinc-50 text-zinc-800 border-zinc-200'}`}>
                                              {card.status}
                                            </span>
                                            <button
                                              onClick={() => startEditingCard(card)}
                                              className="text-[10px] font-bold text-zinc-400 hover:text-zinc-600 transition-colors underline"
                                            >
                                              Edit
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    )}

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
                                              <div className="text-xs text-zinc-600 flex flex-col gap-1 py-0.5">
                                                <div className="flex items-center gap-2">
                                                  <span className="font-bold">{log.department}:</span>
                                                  <span>{log.task || 'Routine check-in'}</span>
                                                </div>
                                                {log.notes && log.notes !== log.task && (
                                                  <div className="text-[10px] text-zinc-500 italic flex items-start gap-1.5 ml-1">
                                                    <span className="w-1 h-1 rounded-full bg-zinc-300 mt-1.5 shrink-0"></span>
                                                    <span className="break-words whitespace-pre-wrap">{log.notes}</span>
                                                  </div>
                                                )}
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

      {selectedUserForProfile && (
        <UserProfileDialog
          isOpen={true}
          user={selectedUserForProfile}
          onClose={() => setSelectedUserForProfile(null)}
          onSave={(u) => { 
            if (onUpdateUser) onUpdateUser(u); 
            setSelectedUserForProfile(null); 
          }}
          isViewerAdmin={true}
          viewerUser={currentUser}
          timeCards={timeCards}
          users={users}
        />
      )}

      {absenceUser && (
        <LogAbsenceModal
          user={absenceUser}
          isOpen={!!absenceUser}
          onClose={() => setAbsenceUser(null)}
          onSave={async (type, notes) => {
            if (onLogAbsence) {
              const newCard = await onLogAbsence(absenceUser, type, notes);
              if (newCard) {
                setTimeCards(prev => [newCard, ...prev]);
              }
            }
          }}
        />
      )}

      {retroactiveUser && (
        <AddRetroactiveCardModal
          user={retroactiveUser}
          isOpen={!!retroactiveUser}
          onClose={() => setRetroactiveUser(null)}
          onSave={async (clockInMs, clockOutMs, idleHours, date, notes) => {
            await handleSaveRetroactiveCard(retroactiveUser, clockInMs, clockOutMs, idleHours, date, notes);
          }}
        />
      )}

      {taskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in scale-in">
            <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-150 flex items-center justify-between">
              <h3 className="font-bold text-zinc-900 text-sm">
                {editingTask ? "Edit Schedule Task" : "Create New Task"}
              </h3>
              <button
                onClick={() => setTaskModalOpen(false)}
                className="p-1 hover:bg-zinc-200 rounded-lg text-zinc-500 hover:text-zinc-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Task Title</label>
                <input
                  type="text"
                  value={taskFormTitle}
                  onChange={(e) => setTaskFormTitle(e.target.value)}
                  placeholder="Enter task deliverable/title..."
                  className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Description</label>
                <textarea
                  value={taskFormDesc}
                  onChange={(e) => setTaskFormDesc(e.target.value)}
                  placeholder="Task details/notes..."
                  rows={3}
                  className="w-full text-xs bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Assignee</label>
                  <select
                    value={taskFormAssignedTo}
                    onChange={(e) => setTaskFormAssignedTo(e.target.value)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                  >
                    <option value="unassigned">Unassigned</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Project/Dept</label>
                  <select
                    value={taskFormDept}
                    onChange={(e) => setTaskFormDept(e.target.value as Department)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                  >
                    {Object.values(Department).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Priority</label>
                  <select
                    value={taskFormPriority}
                    onChange={(e) => setTaskFormPriority(e.target.value as any)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Status</label>
                  <select
                    value={taskFormStatus}
                    onChange={(e) => setTaskFormStatus(e.target.value as any)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-3 focus:ring-zinc-450 focus:border-zinc-450"
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="delayed">Delayed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Date</label>
                  <input
                    type="date"
                    value={taskFormDate}
                    onChange={(e) => setTaskFormDate(e.target.value)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-2.5 focus:ring-zinc-450 focus:border-zinc-450"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Start Time</label>
                  <input
                    type="time"
                    value={taskFormStartTime}
                    onChange={(e) => setTaskFormStartTime(e.target.value)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-2.5 focus:ring-zinc-450 focus:border-zinc-450"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">End Time</label>
                  <input
                    type="time"
                    value={taskFormEndTime}
                    onChange={(e) => setTaskFormEndTime(e.target.value)}
                    className="w-full text-xs font-bold bg-zinc-50 border-zinc-200 rounded-lg py-2 px-2.5 focus:ring-zinc-450 focus:border-zinc-450"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-150 flex items-center justify-between flex-wrap gap-2">
              <div>
                {editingTask && (
                  <button
                    onClick={() => handleDeleteTask(editingTask.id)}
                    className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 py-2 px-4 rounded-xl border border-red-200 transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Task
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setTaskModalOpen(false)}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-800 bg-white border border-zinc-250 py-2 px-4 rounded-xl shadow-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTask}
                  disabled={isSavingTask}
                  className="text-xs font-bold bg-zinc-900 hover:bg-zinc-800 text-white py-2 px-5 rounded-xl shadow transition-all disabled:opacity-50 flex items-center gap-1"
                >
                  {isSavingTask ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {isSavingTask ? 'Saving...' : 'Save Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
