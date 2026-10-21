import React, { useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  serverTimestamp,
  writeBatch,
  deleteField,
  where
} from 'firebase/firestore';
import { db, firebaseSaveShiftBlock, isFirebaseConfigured } from '../services/firebaseService';
import { User, Department } from '../types';
import './projectTaskBoard.css';

interface ProjectTaskBoardProps {
  users: User[];
  currentUser: User | null;
  shiftBlocks: any[];
  onOpenShiftTaskModal?: (task: any, defaultUserId?: string) => void;
}

const STATUSES = ['backlog', 'ready', 'active', 'review', 'complete'];
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const AVATAR_PALETTE = ['#e05a5a', '#e89a3d', '#d4a017', '#5b8def', '#7c9cff', '#2faa6b', '#34a0a4', '#9b59b6', '#c77dff'];
const TIMELINE_DAYS = 28;
const LOCAL_TASKS_KEY = 'chrono_project_tasks_v1';

export const ProjectTaskBoard: React.FC<ProjectTaskBoardProps> = ({
  users,
  currentUser,
  shiftBlocks,
  onOpenShiftTaskModal
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ users, currentUser, shiftBlocks, onOpenShiftTaskModal });
  const syncBridgeRef = useRef<((blocks: any[]) => void) | null>(null);
  const reRenderRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    propsRef.current = { users, currentUser, shiftBlocks, onOpenShiftTaskModal };
    if (reRenderRef.current) {
      reRenderRef.current();
    }
    if (syncBridgeRef.current) {
      syncBridgeRef.current(shiftBlocks);
    }
  }, [users, currentUser, shiftBlocks, onOpenShiftTaskModal]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const byId = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
      root.querySelector(`#${id}`) as T | null;

    // Canonical user key helper for Clockwork users
    const getUserKey = (u: User): string => {
      if (u.email && u.email.trim()) return u.email.trim().toLowerCase();
      const slug = (u.name || u.id || 'staff').toLowerCase().trim().replace(/\s+/g, '.');
      return `${slug}@clockwork.team`;
    };

    const getCurrentUserEmail = (): string => {
      const cu = propsRef.current.currentUser;
      if (!cu) return 'manager@clockwork.team';
      return getUserKey(cu);
    };

    let role: 'admin' | 'editor' | 'viewer' = 'admin';
    let access: { admins: string[]; editors: string[]; viewers: string[] } = {
      admins: [],
      editors: [],
      viewers: []
    };
    let tasks: any[] = [];
    let editingId: string | null = null;
    let modalSubtasks: any[] = [];
    let dragId: string | null = null;
    let unsubTasks: (() => void) | null = null;
    let unsubAccess: (() => void) | null = null;
    let unsubProfiles: (() => void) | null = null;
    let unsubNotifs: (() => void) | null = null;
    let notifications: any[] = [];
    let profiles: Record<string, { firstName?: string; lastName?: string; userId?: string; role?: string }> = {};
    let expandedIds = new Set<string>();
    let modalStartDate = '';
    let modalEndDate = '';
    let calendarMonth = new Date();
    let drMode: 'first' | 'second' = 'first';
    let currentView = localStorage.getItem('ptb_view') || 'tackboard';
    let timelineStart = getMondayOf(new Date());
    let listSortField: string | null = 'cadence';
    let listSortAsc = true;
    let timelineDragState: any = null;
    let hideCompletedProjects = new Set<string>(
      JSON.parse(localStorage.getItem('ptb_hideCompletedProjects') || '[]')
    );
    let timelineExpandedTaskIds = new Set<string>();
    let modalSupportEmails: string[] = [];
    let tempTeam: any[] = [];
    let progressPopoverTaskId: string | null = null;
    let progressSaveTimer: any = null;
    let drPopoverTaskId: string | null = null;
    let drPopoverSubtaskIndex: number | null = null;
    let drPopoverStartDate = '';
    let drPopoverEndDate = '';
    let drPopoverMonth = new Date();
    let drPopoverMode: 'first' | 'second' = 'first';
    const syncingShiftIds = new Set<string>();

    // Load cached tasks from localStorage first for instant rendering
    try {
      const cached = localStorage.getItem(LOCAL_TASKS_KEY);
      if (cached) {
        tasks = JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Failed to parse cached project tasks:', e);
    }

    const persistLocalTasks = () => {
      try {
        localStorage.setItem(LOCAL_TASKS_KEY, JSON.stringify(tasks));
      } catch (e) {
        // Ignore storage quota warnings
      }
    };

    const syncClockworkUsersIntoProfiles = () => {
      const cwUsers = propsRef.current.users || [];
      cwUsers.forEach(u => {
        const key = getUserKey(u);
        const parts = (u.name || '').trim().split(/\s+/);
        const firstName = parts[0] || u.name || 'Staff';
        const lastName = parts.slice(1).join(' ');
        profiles[key] = {
          firstName: profiles[key]?.firstName || firstName,
          lastName: profiles[key]?.lastName ?? lastName,
          userId: u.id,
          role: u.role
        };
      });
    };

    function getMondayOf(date: Date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);
      return d;
    }

    function dateToStr(d: Date) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }

    function isSameDay(a: Date, b: Date) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function getTeam(): string[] {
      syncClockworkUsersIntoProfiles();
      const cwKeys = (propsRef.current.users || []).map(getUserKey);
      const admins = (access.admins || []).map(e => String(e).toLowerCase());
      const editors = (access.editors || []).map(e => String(e).toLowerCase());
      const viewers = (access.viewers || []).map(e => String(e).toLowerCase());
      return [...new Set([...cwKeys, ...admins, ...editors, ...viewers])];
    }

    function findClockworkUserByKey(emailOrKey: string): User | undefined {
      const lower = String(emailOrKey || '').toLowerCase();
      const lowerPrefix = lower.split('@')[0];
      return (propsRef.current.users || []).find(u => {
        const k = getUserKey(u);
        if (k === lower) return true;
        if (k.split('@')[0] === lowerPrefix) return true;
        const firstPart = (u.name || '').toLowerCase().split(/\s+/)[0];
        return firstPart === lowerPrefix;
      });
    }

    function emailShort(email: string) {
      return String(email || '').split('@')[0];
    }

    function getDisplayName(email: string) {
      if (!email) return '';
      syncClockworkUsersIntoProfiles();
      const p = profiles[email.toLowerCase()];
      if (p && (p.firstName || p.lastName)) {
        return `${p.firstName || ''} ${p.lastName || ''}`.trim();
      }
      const cwUser = findClockworkUserByKey(email);
      if (cwUser) return cwUser.name;
      return email;
    }

    function getDisplayShort(email: string) {
      if (!email) return '';
      syncClockworkUsersIntoProfiles();
      const p = profiles[email.toLowerCase()];
      if (p && p.firstName) {
        if (p.lastName) {
          return `${p.firstName} ${p.lastName[0]}.`;
        }
        return p.firstName;
      }
      const cwUser = findClockworkUserByKey(email);
      if (cwUser) {
        const parts = cwUser.name.trim().split(/\s+/);
        return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
      }
      return emailShort(email);
    }

    function getDisplayInitials(email: string) {
      if (!email) return '?';
      syncClockworkUsersIntoProfiles();
      const cwUser = findClockworkUserByKey(email);
      if (cwUser && cwUser.avatarInitials) return cwUser.avatarInitials.toUpperCase();
      const p = profiles[email.toLowerCase()];
      if (p && (p.firstName || p.lastName)) {
        const f = (p.firstName || '').trim().charAt(0);
        const l = (p.lastName || '').trim().charAt(0);
        if (f && l) return (f + l).toUpperCase();
        if (f) return f.toUpperCase();
        if (l) return l.toUpperCase();
      }
      return initialsFor(email);
    }

    function initialsFor(email: string) {
      const local = String(email || '').split('@')[0];
      if (!local) return '?';
      const parts = local.split(/[._\-+]+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return local.slice(0, 2).toUpperCase();
    }

    function colorFor(email: string) {
      const e = String(email || '').toLowerCase();
      let hash = 0;
      for (let i = 0; i < e.length; i++) hash = ((hash << 5) - hash + e.charCodeAt(i)) | 0;
      return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
    }

    function avatarHtml(email: string) {
      return `<span class="avatar" style="background:${colorFor(email)}" title="${escapeHtml(getDisplayName(email))}">${escapeHtml(getDisplayInitials(email))}</span>`;
    }

    function tsToMillis(ts: any) {
      if (!ts) return 0;
      if (typeof ts === 'number') return ts;
      if (ts.toMillis) return ts.toMillis();
      if (ts.seconds) return ts.seconds * 1000;
      const parsed = Date.parse(ts);
      return isNaN(parsed) ? 0 : parsed;
    }

    function timeAgo(ts: any) {
      const t = tsToMillis(ts);
      if (!t) return '';
      const diff = Date.now() - t;
      const m = Math.floor(diff / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      const d = Math.floor(h / 24);
      if (d < 7) return `${d}d ago`;
      return new Date(t).toLocaleDateString();
    }

    function fullTime(ts: any) {
      const t = tsToMillis(ts);
      return t ? new Date(t).toLocaleString() : '';
    }

    function dateStrToDate(s: string) {
      if (!s) return null;
      const [y, m, d] = String(s).split('-').map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    }

    function todayLocal() {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function shortDate(s: string) {
      const d = dateStrToDate(s);
      return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    }

    function formatDateChip(start?: string, end?: string) {
      if (!start && !end) return null;
      if (start && end) {
        if (start === end) return shortDate(start);
        const ds = dateStrToDate(start), de = dateStrToDate(end);
        if (ds && de && ds.getFullYear() === de.getFullYear() && ds.getMonth() === de.getMonth()) {
          return `${shortDate(start)} – ${de.getDate()}`;
        }
        return `${shortDate(start)} – ${shortDate(end)}`;
      }
      if (end) return `Due ${shortDate(end)}`;
      if (start) return `From ${shortDate(start)}`;
      return null;
    }

    function dateChipClass(end?: string, taskStatus?: string) {
      if (!end || taskStatus === 'complete') return '';
      const e = dateStrToDate(end);
      if (!e) return '';
      const diffDays = Math.floor((e.getTime() - todayLocal().getTime()) / 86400000);
      if (diffDays < 0) return 'overdue';
      if (diffDays <= 2) return 'due-soon';
      return '';
    }

    function displayDate(s: string) {
      const d = dateStrToDate(s);
      return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    }

    function progressOf(t: any) {
      if (t.status === 'complete') return 100;
      if (t.subtasks && t.subtasks.length > 0) {
        const completed = t.subtasks.filter((s: any) => s.completed).length;
        return Math.round((completed / t.subtasks.length) * 100);
      }
      return Math.max(0, Math.min(100, Number(t.progress) || 0));
    }

    function escapeHtml(s: any) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c] || c));
    }

    let toastTimer: any = null;
    function toast(msg: string) {
      const t = byId('toast');
      if (!t) return;
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
    }

    function canEditTask(_task?: any) {
      return role === 'admin' || role === 'editor';
    }

    // Save/Update helper with both Firestore and local state fallback
    async function createTaskDoc(taskData: any): Promise<string> {
      const localId = 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
      const localRecord = {
        ...taskData,
        id: localId,
        createdAt: Date.now()
      };

      if (isFirebaseConfigured()) {
        try {
          const docRef = await addDoc(collection(db, 'tasks'), taskData);
          handleCreationNotifications(docRef.id, taskData);
          return docRef.id;
        } catch (err) {
          console.warn('Firestore task create fallback to local:', err);
        }
      }
      tasks.push(localRecord);
      persistLocalTasks();
      maybeRender();
      return localId;
    }

    async function updateTaskDoc(taskId: string, fieldsToUpdate: any, logActionText?: string) {
      const taskIdx = tasks.findIndex(t => t.id === taskId);
      const task = taskIdx >= 0 ? tasks[taskIdx] : null;
      if (!task) return;

      const activityLog = Array.isArray(task.activityLog) ? [...task.activityLog] : [];
      if (logActionText) {
        activityLog.push({
          user: getCurrentUserEmail(),
          timestamp: new Date().toISOString(),
          action: logActionText
        });
      }
      if (activityLog.length > 100) {
        activityLog.shift();
      }

      const payload = {
        ...fieldsToUpdate,
        activityLog
      };

      // Optimistic local update
      tasks[taskIdx] = { ...task, ...payload };
      persistLocalTasks();
      maybeRender();

      if (isFirebaseConfigured()) {
        try {
          await setDoc(doc(db, 'tasks', taskId), payload, { merge: true });
          handleUpdateNotifications(task, fieldsToUpdate);
        } catch (err) {
          console.warn('Firestore task update fallback to local:', err);
        }
      }
    }

    // Schedule a project task or subtask onto Clockwork's Daily Shift Planner
    async function scheduleTaskToShift(emailOrKey: string, item: any) {
      const cwUser = findClockworkUserByKey(emailOrKey);
      if (!cwUser) {
        toast('Could not match team member to Clockwork user');
        return;
      }
      const todayStr = new Date().toISOString().split('T')[0];
      let mappedPriority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';
      if (item.priority === 'critical') mappedPriority = 'urgent';
      else if (item.priority === 'high') mappedPriority = 'high';
      else if (item.priority === 'low') mappedPriority = 'low';

      let mappedDept = cwUser.primaryDepartment || Department.Production;
      const appName = String(item.app || '').toLowerCase();
      if (appName.includes('design')) mappedDept = Department.Design;
      else if (appName.includes('print')) mappedDept = Department.Print;
      else if (appName.includes('ware') || appName.includes('ship')) mappedDept = Department.Warehousing;
      else if (appName.includes('facility')) mappedDept = Department.Facility;
      else if (appName.includes('event')) mappedDept = Department.Event;

      try {
        await firebaseSaveShiftBlock({
          assignedTo: cwUser.id,
          assignedToName: cwUser.name,
          title: item.title || 'Task',
          description: item.details || (item.parentTitle ? `Subtask of: ${item.parentTitle}` : ''),
          department: mappedDept,
          startTime: `${todayStr}T08:00:00`,
          endTime: `${todayStr}T16:00:00`,
          priority: mappedPriority,
          status: 'pending',
          isShiftBlock: false,
          webDevTaskId: item.taskId,
          isWebDevSubtask: item.type === 'subtask',
          webDevSubtaskIndex: item.subtaskIndex !== undefined ? item.subtaskIndex : null
        } as any);
        toast(`Scheduled "${item.title}" to ${cwUser.name}'s shift planner`);
      } catch (err: any) {
        toast('Failed to schedule to shift: ' + err.message);
      }
    }

    // Sync updates from Clockwork's mobile shift blocks back into project tasks natively
    syncBridgeRef.current = async (blocks: any[]) => {
      for (const block of blocks) {
        if (block.isShiftBlock || !block.webDevTaskId) continue;
        if (syncingShiftIds.has(block.id)) continue;

        const wdTask = tasks.find(t => t.id === block.webDevTaskId);
        if (!wdTask) continue;

        const latestCheckIn = block.checkIns && block.checkIns.length > 0
          ? [...block.checkIns].sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0]
          : null;
        const localProgress = latestCheckIn?.progress ?? latestCheckIn?.progressPercent ?? 0;

        if (block.isWebDevSubtask && block.webDevSubtaskIndex !== undefined && block.webDevSubtaskIndex !== null) {
          const idx = block.webDevSubtaskIndex;
          if (Array.isArray(wdTask.subtasks) && idx >= 0 && idx < wdTask.subtasks.length) {
            const sub = wdTask.subtasks[idx];
            const localCompleted = block.status === 'completed';
            if (Boolean(sub.completed) !== localCompleted) {
              syncingShiftIds.add(block.id);
              const subtasksCopy = JSON.parse(JSON.stringify(wdTask.subtasks));
              subtasksCopy[idx].completed = localCompleted;
              const completedCount = subtasksCopy.filter((s: any) => s.completed).length;
              const parentProgress = subtasksCopy.length > 0 ? Math.round((completedCount / subtasksCopy.length) * 100) : 0;
              await updateTaskDoc(
                wdTask.id,
                { subtasks: subtasksCopy, progress: parentProgress },
                `[Shift Tracker] Subtask "${sub.title}" marked ${localCompleted ? 'Complete' : 'Incomplete'}`
              );
              syncingShiftIds.delete(block.id);
            }
          }
        } else {
          let mappedStatus: string | null = null;
          if (block.status === 'completed') mappedStatus = 'complete';
          else if (block.status === 'in_progress' || block.status === 'delayed') mappedStatus = 'active';

          const statusDiff = mappedStatus && wdTask.status !== mappedStatus;
          const progressDiff = Number(wdTask.progress ?? 0) !== Number(localProgress) && localProgress > 0;

          if (statusDiff || progressDiff) {
            syncingShiftIds.add(block.id);
            const updates: any = {};
            if (statusDiff) updates.status = mappedStatus;
            if (progressDiff) updates.progress = localProgress;
            await updateTaskDoc(
              wdTask.id,
              updates,
              `[Shift Tracker] Updated task progress/status`
            );
            syncingShiftIds.delete(block.id);
          }
        }
      }
    };

    // --- Inline date-range picker in Modal ---
    function renderCalendar() {
      const cal = byId('drCalendar');
      if (!cal) return;
      const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
      const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

      const startOfGrid = new Date(monthStart);
      startOfGrid.setDate(1 - monthStart.getDay());

      const today = todayLocal();
      const dows = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(startOfGrid);
        d.setDate(d.getDate() + i);
        const dStr = dateToStr(d);
        const otherMonth = d.getMonth() !== monthStart.getMonth();
        const isToday = isSameDay(d, today);
        const inRange = modalStartDate && modalEndDate && dStr >= modalStartDate && dStr <= modalEndDate;
        const isStart = !!modalStartDate && dStr === modalStartDate;
        const isEnd = !!modalEndDate && dStr === modalEndDate;
        const classes = ['dr-cell'];
        if (otherMonth) classes.push('other-month');
        if (isToday) classes.push('today');
        if (inRange) classes.push('in-range');
        if (isStart) classes.push('range-start');
        if (isEnd) classes.push('range-end');
        cells.push(`<div class="${classes.join(' ')}" data-date="${dStr}">${d.getDate()}</div>`);
      }

      cal.innerHTML = `
        <div class="dr-nav">
          <button type="button" id="drPrev" title="Previous month">‹</button>
          <div class="dr-month-label">${escapeHtml(monthLabel)}</div>
          <button type="button" id="drNext" title="Next month">›</button>
        </div>
        <div class="dr-grid">
          ${dows.map(d => `<div class="dr-dow">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
        <div class="dr-hint">${drMode === 'first'
          ? 'Click a date to start the range'
          : 'Click another date to set the end (or the same day for a single-day task)'}</div>
      `;

      const startEl = byId('drStartDisplay');
      const endEl = byId('drEndDisplay');
      if (startEl) {
        startEl.textContent = modalStartDate ? displayDate(modalStartDate) : '— pick a date —';
        startEl.classList.toggle('empty', !modalStartDate);
      }
      if (endEl) {
        endEl.textContent = modalEndDate ? displayDate(modalEndDate) : '— pick a date —';
        endEl.classList.toggle('empty', !modalEndDate);
      }

      byId('drPrev')?.addEventListener('click', () => {
        calendarMonth.setMonth(calendarMonth.getMonth() - 1);
        renderCalendar();
      });
      byId('drNext')?.addEventListener('click', () => {
        calendarMonth.setMonth(calendarMonth.getMonth() + 1);
        renderCalendar();
      });
      cal.querySelectorAll('.dr-cell').forEach(cell => {
        cell.addEventListener('click', () => onPickDate((cell as HTMLElement).dataset.date || ''));
      });
    }

    function onPickDate(dateStr: string) {
      if (!dateStr) return;
      if (drMode === 'first') {
        modalStartDate = dateStr;
        modalEndDate = dateStr;
        drMode = 'second';
      } else {
        if (dateStr < modalStartDate) {
          modalStartDate = dateStr;
        } else {
          modalEndDate = dateStr;
        }
        drMode = 'first';
      }
      renderCalendar();
    }

    // --- Notifications ---
    function renderNotifications() {
      const notifBadge = byId('notifBadge');
      const notifList = byId('notifList');
      if (!notifBadge || !notifList) return;

      const unreadCount = notifications.filter(n => !n.read).length;
      notifBadge.style.display = unreadCount > 0 ? 'block' : 'none';

      if (notifications.length === 0) {
        notifList.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
      }

      notifList.innerHTML = notifications.map(n => {
        const userDisplay = getDisplayName(n.fromEmail);
        const timeText = timeAgo(n.createdAt);
        const unreadClass = n.read ? '' : 'unread';
        const text = n.subtaskTitle
          ? `<strong>${escapeHtml(userDisplay)}</strong> assigned you to subtask <strong>${escapeHtml(n.subtaskTitle)}</strong> of <strong>${escapeHtml(n.taskTitle)}</strong>`
          : `<strong>${escapeHtml(userDisplay)}</strong> assigned you to task <strong>${escapeHtml(n.taskTitle)}</strong>`;

        return `
          <div class="notif-item ${unreadClass}" data-id="${n.id}" data-task-id="${n.taskId}">
            <span class="notif-text">${text}</span>
            <span class="notif-time">${timeText}</span>
          </div>
        `;
      }).join('');
    }

    async function createAssignmentNotification(toEmail: string, task: any, subtaskTitle: string | null = null) {
      if (!isFirebaseConfigured()) return;
      const me = getCurrentUserEmail();
      if (toEmail.toLowerCase() === me.toLowerCase()) return;
      try {
        await addDoc(collection(db, 'notifications'), {
          toEmail: toEmail.toLowerCase(),
          fromEmail: me.toLowerCase(),
          taskId: task.id,
          taskTitle: task.title || 'Untitled Task',
          subtaskTitle: subtaskTitle,
          read: false,
          createdAt: serverTimestamp()
        });
      } catch (e) {
        // ignore notification error
      }
    }

    async function handleCreationNotifications(taskId: string, taskData: any) {
      const task = { id: taskId, ...taskData };
      const assignees = Array.isArray(task.assignees) ? task.assignees : [];
      for (const email of assignees) {
        await createAssignmentNotification(email, task);
      }
      const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
      for (const sub of subtasks) {
        if (sub.assignee) {
          await createAssignmentNotification(sub.assignee, task, sub.title);
        }
      }
    }

    async function handleUpdateNotifications(oldTask: any, fieldsToUpdate: any) {
      const taskTitle = fieldsToUpdate.title !== undefined ? fieldsToUpdate.title : oldTask.title;
      const currentTaskState = { id: oldTask.id, title: taskTitle };

      if (fieldsToUpdate.assignees !== undefined) {
        const oldAssignees = (oldTask.assignees || []).map((e: string) => e.toLowerCase());
        const newAssignees = (fieldsToUpdate.assignees || []).map((e: string) => e.toLowerCase());
        for (const email of newAssignees) {
          if (!oldAssignees.includes(email)) {
            await createAssignmentNotification(email, currentTaskState);
          }
        }
      }

      if (fieldsToUpdate.subtasks !== undefined) {
        const oldSubtasks = oldTask.subtasks || [];
        const newSubtasks = fieldsToUpdate.subtasks || [];
        for (const newSub of newSubtasks) {
          if (newSub.assignee) {
            const email = newSub.assignee.toLowerCase();
            const matchingOldSub = oldSubtasks.find((oldSub: any) =>
              (newSub.id && oldSub.id && newSub.id === oldSub.id) ||
              (newSub.title && oldSub.title && newSub.title.trim().toLowerCase() === oldSub.title.trim().toLowerCase())
            );
            const wasAlreadyAssigned = matchingOldSub &&
              matchingOldSub.assignee &&
              matchingOldSub.assignee.toLowerCase() === email;
            if (!wasAlreadyAssigned) {
              await createAssignmentNotification(email, currentTaskState, newSub.title);
            }
          }
        }
      }
    }

    function isUIBusy() {
      if (dragId) return true;
      if (timelineDragState) return true;
      if (byId('modal')?.classList.contains('open')) return true;
      if (byId('teamModal')?.classList.contains('open')) return true;
      if (byId('profileModal')?.classList.contains('open')) return true;
      const a = document.activeElement;
      if (a && root.contains(a) && a.classList) {
        if (
          a.classList.contains('lr-title-input') ||
          a.classList.contains('lr-details-input') ||
          a.classList.contains('lp-name-input') ||
          a.classList.contains('inline-cadence-input') ||
          a.classList.contains('expanded-textarea') ||
          a.classList.contains('expanded-input') ||
          a.classList.contains('update-input') ||
          a.classList.contains('subtask-text-input-inline') ||
          a.classList.contains('new-subtask-input-inline') ||
          a.classList.contains('expanded-lead-select') ||
          a.classList.contains('expanded-support-select') ||
          a.classList.contains('subtask-assignee-select-inline') ||
          a.classList.contains('subtask-notes-input-inline') ||
          a.classList.contains('expanded-project-input')
        ) {
          return true;
        }
      }
      return false;
    }

    function getApps(): string[] {
      const showArchived = (byId<HTMLInputElement>('showArchivedFilter')?.checked) || false;
      const filteredTasks = showArchived ? tasks : tasks.filter(t => !t.archived);
      const taskApps = filteredTasks.map(t => t.app).filter(Boolean);
      const deptNames = Object.values(Department);
      return [...new Set([...deptNames, ...taskApps])].sort();
    }

    function populateGlobalFilters() {
      const filter = byId<HTMLSelectElement>('appFilter');
      if (filter) {
        const currentVal = filter.value || '__all__';
        const apps = getApps();
        filter.innerHTML = '<option value="__all__">All projects</option>' +
          apps.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
        filter.value = apps.includes(currentVal) || currentVal === '__all__' ? currentVal : '__all__';
      }

      const assFilter = byId<HTMLSelectElement>('assigneeFilter');
      if (assFilter) {
        const assCurrent = assFilter.value || '__all__';
        const team = getTeam();
        const me = getCurrentUserEmail();
        assFilter.innerHTML =
          '<option value="__all__">Anyone</option>' +
          (team.includes(me) ? '<option value="__me__">Me</option>' : '') +
          '<option value="__none__">Unassigned</option>' +
          team.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(getDisplayName(e))}</option>`).join('');
        const validValues = new Set(['__all__', '__me__', '__none__', ...team]);
        assFilter.value = validValues.has(assCurrent) ? assCurrent : '__all__';
      }
    }

    function visibleTasks() {
      const appF = byId<HTMLSelectElement>('appFilter')?.value || '__all__';
      const assF = byId<HTMLSelectElement>('assigneeFilter')?.value || '__all__';
      const searchVal = (byId<HTMLInputElement>('taskSearch')?.value || '').trim().toLowerCase();
      const showArchived = byId<HTMLInputElement>('showArchivedFilter')?.checked || false;
      const me = getCurrentUserEmail();

      return tasks.filter(t => {
        if (!showArchived && t.archived) return false;
        if (appF !== '__all__' && t.app !== appF) return false;

        const parentAssignees = (t.assignees || []).map((e: string) => String(e).toLowerCase());
        const subtaskAssignees = (t.subtasks || [])
          .map((s: any) => String(s.assignee || '').toLowerCase())
          .filter(Boolean);
        const allAssignees = [...new Set([...parentAssignees, ...subtaskAssignees])];

        if (assF !== '__all__') {
          let matchAss = false;
          if (assF === '__me__') matchAss = allAssignees.includes(me);
          else if (assF === '__none__') matchAss = allAssignees.length === 0;
          else {
            const targetPrefix = assF.toLowerCase().split('@')[0];
            matchAss = allAssignees.some(a => a === assF.toLowerCase() || a.split('@')[0] === targetPrefix);
          }
          if (!matchAss) return false;
        }

        if (searchVal) {
          const matchTitle = (t.title || '').toLowerCase().includes(searchVal);
          const matchDetails = (t.details || '').toLowerCase().includes(searchVal);
          const matchProject = (t.app || '').toLowerCase().includes(searchVal);
          const matchAssignees = allAssignees.some(email =>
            getDisplayName(email).toLowerCase().includes(searchVal) || email.includes(searchVal)
          );
          const matchSubtasks = (t.subtasks || []).some((s: any) =>
            (s.title || '').toLowerCase().includes(searchVal) || (s.notes || '').toLowerCase().includes(searchVal)
          );
          if (!matchTitle && !matchDetails && !matchProject && !matchAssignees && !matchSubtasks) return false;
        }

        return true;
      });
    }

    function maybeRender() {
      if (!isUIBusy()) {
        populateGlobalFilters();
        if (currentView === 'timeline') renderTimeline();
        else if (currentView === 'list') renderList();
        else if (currentView === 'tackboard') renderTackboard();
        else render();
        return;
      }
      setTimeout(maybeRender, 250);
    }

    reRenderRef.current = maybeRender;

    function setView(view: string) {
      currentView = view;
      localStorage.setItem('ptb_view', view);
      const mainEl = root.querySelector('main.ptb-board') as HTMLElement | null;
      if (mainEl) mainEl.style.display = view === 'board' ? 'grid' : 'none';
      const tlView = byId('timelineView');
      if (tlView) tlView.style.display = view === 'timeline' ? 'flex' : 'none';
      const lView = byId('listView');
      if (lView) lView.style.display = view === 'list' ? 'block' : 'none';
      const tbView = byId('tackboardView');
      if (tbView) tbView.style.display = view === 'tackboard' ? 'flex' : 'none';
      const tlNav = byId('timelineNav');
      if (tlNav) tlNav.style.display = view === 'timeline' ? 'inline-flex' : 'none';

      const colsToggle = root.querySelector('.board-columns-toggle-container') as HTMLElement | null;
      if (colsToggle) {
        colsToggle.style.display = view === 'board' ? 'block' : 'none';
      }
      if (view === 'board') {
        updateBoardColumnsVisibility();
      }

      root.querySelectorAll('.view-toggle').forEach(b => {
        b.classList.toggle('active', (b as HTMLElement).dataset.view === view);
      });
      if (view === 'timeline') renderTimeline();
      else if (view === 'list') renderList();
      else if (view === 'tackboard') renderTackboard();
      else render();
    }

    // --- Board View ---
    function render() {
      populateGlobalFilters();
      const items = visibleTasks();
      for (const status of STATUSES) {
        const list = root.querySelector(`.task-list[data-status="${status}"]`) as HTMLElement | null;
        if (!list) continue;
        const inCol = items
          .filter(t => t.status === status)
          .sort((a, b) => {
            const oa = a.order ?? 0;
            const ob = b.order ?? 0;
            if (oa !== ob) return oa - ob;
            return tsToMillis(a.createdAt) - tsToMillis(b.createdAt);
          });
        const countEl = root.querySelector(`[data-count="${status}"]`);
        if (countEl) countEl.textContent = String(inCol.length);
        list.innerHTML = inCol.length === 0 ? `<li class="empty">No tasks</li>` : inCol.map(renderTask).join('');
      }
      bindTaskEvents();
      updateBoardColumnsVisibility();
    }

    function renderTask(t: any) {
      const p = t.priority || 'medium';
      const parentAssignees = Array.isArray(t.assignees) ? t.assignees : [];
      const leadEmail = parentAssignees[0] || '';
      const supportEmails = parentAssignees.slice(1);

      const leadLabel = leadEmail
        ? `<span class="task-lead-badge" title="Lead: ${escapeHtml(getDisplayName(leadEmail))}"><svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Lead: ${escapeHtml(getDisplayShort(leadEmail))}</span>`
        : '';
      const supportLabel = supportEmails.length > 0
        ? `<span class="task-support-badge" title="Support: ${escapeHtml(supportEmails.map(getDisplayName).join(', '))}">Support: ${escapeHtml(supportEmails.map(getDisplayShort).join(', '))}</span>`
        : '';

      const updates = Array.isArray(t.updates) ? t.updates : [];
      const updateBadge = updates.length
        ? `<span class="update-count" title="${updates.length} update${updates.length === 1 ? '' : 's'}">💬 ${updates.length}</span>`
        : '';
      const dateText = formatDateChip(t.startDate, t.endDate);
      const dateBadge = dateText
        ? `<span class="date-chip ${dateChipClass(t.endDate, t.status)}">📅 ${escapeHtml(dateText)}</span>`
        : '';
      const hasDetails = !!(t.details && t.details.trim());
      const detailsBadge = hasDetails ? `<span class="details-indicator" title="Has details">📄</span>` : '';
      const prog = progressOf(t);
      const progressBar = `<div class="task-progress" data-action="progress" title="${prog}% complete — click to update"><div class="task-progress-fill" style="width: ${prog}%"></div></div>`;

      return `
        <li class="task priority-${p} ${t.status === 'complete' ? 'done' : ''} ${t.archived ? 'archived' : ''}" draggable="true" data-id="${t.id}">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-meta">
            <span class="task-tags">
              <span class="priority-chip ${p}">${PRIORITY_LABEL[p] || p}</span>
              ${t.app ? `<span class="task-app">${escapeHtml(t.app)}</span>` : ''}
              ${leadLabel}
              ${supportLabel}
              ${dateBadge}
              ${detailsBadge}
              ${updateBadge}
            </span>
            <span class="task-actions">
              <span class="hover-only editor-only">
                <button class="icon-btn" data-action="edit" title="Edit">✎</button>
                <button class="icon-btn danger" data-action="delete" title="Delete">×</button>
              </span>
            </span>
          </div>
          ${progressBar}
        </li>`;
    }

    // --- Timeline View ---
    function renderTimeline() {
      const grid = byId('timelineGrid');
      if (!grid) return;
      const start = new Date(timelineStart);
      const end = new Date(start);
      end.setDate(end.getDate() + TIMELINE_DAYS - 1);

      const rangeEl = byId('timelineRange');
      if (rangeEl) {
        rangeEl.textContent = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }

      const datePicker = byId<HTMLInputElement>('timelineDatePicker');
      if (datePicker) {
        datePicker.value = dateToStr(start);
      }

      const weeks = [];
      for (let w = 0; w < TIMELINE_DAYS / 7; w++) {
        const ws = new Date(start);
        ws.setDate(ws.getDate() + w * 7);
        weeks.push(`<div class="t-week-cell">Week of ${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>`);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      const days = [];
      for (let i = 0; i < TIMELINE_DAYS; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const weekend = d.getDay() === 0 || d.getDay() === 6;
        const isToday = isSameDay(d, today);
        days.push(`<div class="t-day-cell ${weekend ? 'weekend' : ''} ${isToday ? 'today' : ''}">
          <div class="t-day-name">${dayNames[d.getDay()]}</div>
          <div class="t-day-num">${d.getDate()}</div>
        </div>`);
      }

      const filtered = visibleTasks().filter(t => {
        const hasTaskDates = t.startDate || t.endDate;
        if (hasTaskDates) {
          const ts = t.startDate || t.endDate;
          const te = t.endDate || t.startDate;
          const startStr = dateToStr(start), endStr = dateToStr(end);
          if (ts <= endStr && te >= startStr) return true;
        }
        if (t.subtasks && t.subtasks.length > 0) {
          return t.subtasks.some((s: any) => {
            if (!s.startDate && !s.endDate) return false;
            const sts = s.startDate || s.endDate;
            const ste = s.endDate || s.startDate;
            const startStr = dateToStr(start), endStr = dateToStr(end);
            return sts <= endStr && ste >= startStr;
          });
        }
        return false;
      });

      const groups: Record<string, any[]> = {};
      filtered.forEach(t => {
        const key = t.app || '(No project)';
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });

      const groupHtml = Object.keys(groups).sort().map(proj => {
        const projTasks = groups[proj].sort((a, b) =>
          (a.startDate || a.endDate || '').localeCompare(b.startDate || b.endDate || '')
        );
        const rowsHtml = projTasks.map(t => {
          const hasSubtasks = t.subtasks && t.subtasks.length > 0;
          const isExpanded = timelineExpandedTaskIds.has(t.id);
          let rows = renderTimelineRowHtml({
            id: t.id,
            title: t.title,
            startDate: t.startDate,
            endDate: t.endDate,
            priority: t.priority,
            status: t.status,
            archived: t.archived,
            progress: progressOf(t),
            isSubtask: false,
            rangeStart: start,
            hasSubtasks,
            isExpanded
          });
          if (hasSubtasks && isExpanded) {
            t.subtasks.forEach((s: any, idx: number) => {
              rows += renderTimelineRowHtml({
                id: s.id,
                title: s.title,
                startDate: s.startDate,
                endDate: s.endDate,
                priority: t.priority,
                status: s.completed ? 'complete' : '',
                archived: t.archived,
                progress: s.completed ? 100 : 0,
                isSubtask: true,
                parentTaskId: t.id,
                subtaskIndex: idx,
                rangeStart: start
              });
            });
          }
          return rows;
        }).join('');

        return `
          <div class="t-row t-project-row">
            <div class="t-name">${escapeHtml(proj)}</div>
            <div class="t-track"></div>
          </div>
          ${rowsHtml}
        `;
      }).join('');

      const todayDayIdx = Math.floor((today.getTime() - start.getTime()) / 86400000);
      const todayLine = todayDayIdx >= 0 && todayDayIdx < TIMELINE_DAYS
        ? `<div class="t-today-line" style="left: calc(240px + (100% - 240px) * ${(todayDayIdx + 0.5) / TIMELINE_DAYS});"></div>`
        : '';

      grid.innerHTML = `
        <div class="t-row t-header-row">
          <div class="t-name">Task</div>
          <div class="t-track">
            <div class="t-week-row">${weeks.join('')}</div>
            <div class="t-day-row">${days.join('')}</div>
          </div>
        </div>
        <div style="position: relative;">
          ${filtered.length === 0
            ? '<div class="t-empty">No tasks scheduled in this date range.<br>Set a Start or End date on a task to see it here.</div>'
            : groupHtml}
          ${todayLine}
        </div>
      `;

      grid.querySelectorAll('.t-bar').forEach(bar => {
        bar.addEventListener('pointerdown', e => onBarPointerDown(e as PointerEvent, bar as HTMLElement));
      });

      grid.querySelectorAll('.t-name.parent-name').forEach(el => {
        el.addEventListener('click', e => {
          const target = e.target as HTMLElement;
          const htmlEl = el as HTMLElement;
          if (target.classList.contains('t-edit-icon') || target.closest('.t-edit-icon')) {
            openModal(htmlEl.dataset.id || null);
            return;
          }
          const id = htmlEl.dataset.id || '';
          const task = tasks.find(t => t.id === id);
          if (task && task.subtasks && task.subtasks.length > 0) {
            if (timelineExpandedTaskIds.has(id)) timelineExpandedTaskIds.delete(id);
            else timelineExpandedTaskIds.add(id);
            renderTimeline();
          } else {
            openModal(id);
          }
        });
      });

      grid.querySelectorAll('.t-name.subtask-name').forEach(el => {
        el.addEventListener('click', () => {
          openModal((el as HTMLElement).dataset.parentId || null);
        });
      });
    }

    function renderTimelineRowHtml({
      id,
      title,
      startDate,
      endDate,
      priority = 'medium',
      status = '',
      archived = false,
      progress = 0,
      isSubtask = false,
      parentTaskId = null,
      subtaskIndex = null,
      rangeStart,
      hasSubtasks = false,
      isExpanded = false
    }: any) {
      const startDateStr = startDate || endDate;
      const endDateStr = endDate || startDate;
      const ts = dateStrToDate(startDateStr);
      const te = dateStrToDate(endDateStr);

      let barHtml = '';
      if (ts && te) {
        const dayMs = 86400000;
        const rangeEnd = new Date(rangeStart);
        rangeEnd.setDate(rangeEnd.getDate() + TIMELINE_DAYS - 1);
        const visStart = ts < rangeStart ? rangeStart : ts;
        const visEnd = te > rangeEnd ? rangeEnd : te;
        if (visStart <= visEnd) {
          const startDay = Math.floor((visStart.getTime() - rangeStart.getTime()) / dayMs);
          const endDay = Math.floor((visEnd.getTime() - rangeStart.getTime()) / dayMs);
          const leftPct = (startDay / TIMELINE_DAYS) * 100;
          const widthPct = ((endDay - startDay + 1) / TIMELINE_DAYS) * 100;
          const dateText = formatDateChip(startDate, endDate) || '';
          const progressOverlay = progress > 0 ? `<span class="t-bar-progress" style="width: ${progress}%"></span>` : '';
          const dragDataAttrs = isSubtask
            ? `data-parent-id="${parentTaskId}" data-subtask-index="${subtaskIndex}"`
            : `data-id="${id}"`;
          const handlesHtml = !isSubtask
            ? `<span class="t-bar-handle left" data-handle="left"></span>
               <span class="t-bar-label">${escapeHtml(title)}</span>
               <span class="t-bar-handle right" data-handle="right"></span>`
            : `<span class="t-bar-label">${escapeHtml(title)}</span>`;

          barHtml = `
            <div class="t-bar priority-${priority} ${status === 'complete' ? 'done' : ''} ${archived ? 'archived' : ''} ${isSubtask ? 'subtask-bar' : ''}"
                 style="left: ${leftPct}%; width: ${widthPct}%;"
                 ${dragDataAttrs}
                 title="${escapeHtml(title)} — ${escapeHtml(dateText)} (${progress}% complete)">
              ${progressOverlay}
              ${handlesHtml}
            </div>
          `;
        }
      }

      let labelHtml = '';
      if (isSubtask) {
        labelHtml = `
          <div class="t-name subtask-name" data-parent-id="${parentTaskId}" style="padding-left: 28px; font-size: 12px; color: var(--muted); cursor: pointer;">
            <span style="margin-right: 4px; color: var(--border);">└─</span> ${escapeHtml(title)}
          </div>
        `;
      } else {
        const toggleIcon = hasSubtasks
          ? `<span class="t-expand-toggle" style="margin-right: 6px; font-size: 9px; cursor: pointer; display: inline-block; width: 10px;">${isExpanded ? '▼' : '▶'}</span>`
          : '<span style="margin-right: 6px; display: inline-block; width: 10px;"></span>';
        const editBtn = hasSubtasks
          ? `<span class="t-edit-icon" data-id="${id}" style="margin-left: 6px; cursor: pointer; opacity: 0.6;" title="Edit task">✎</span>`
          : '';
        labelHtml = `
          <div class="t-name parent-name" data-id="${id}" style="display: flex; align-items: center; cursor: pointer;">
            ${toggleIcon}
            <span class="t-title-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(title)}</span>
            ${editBtn}
          </div>
        `;
      }

      return `
        <div class="t-row t-task-row ${isSubtask ? 't-subtask-row' : ''}">
          ${labelHtml}
          <div class="t-track">${barHtml}</div>
        </div>
      `;
    }

    function addDays(dateStr: string, days: number) {
      const d = dateStrToDate(dateStr);
      if (!d) return dateStr;
      d.setDate(d.getDate() + days);
      return dateToStr(d);
    }

    function onBarPointerDown(e: PointerEvent, bar: HTMLElement) {
      if (e.button !== 0) return;
      const parentId = bar.dataset.parentId;
      const taskId = bar.dataset.id || parentId || '';
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const isSubtask = !!parentId;
      const target = e.target as HTMLElement;
      const handle = target.dataset?.handle;
      const mode = isSubtask ? 'click' : handle === 'left' ? 'resize-left' : handle === 'right' ? 'resize-right' : 'move';

      timelineDragState = {
        taskId,
        bar,
        trackEl: bar.parentElement,
        mode,
        pointerStartX: e.clientX,
        origLeftPct: parseFloat(bar.style.left) || 0,
        origWidthPct: parseFloat(bar.style.width) || 0,
        origStartDate: task.startDate || task.endDate || '',
        origEndDate: task.endDate || task.startDate || '',
        moved: false
      };
      if (!isSubtask) bar.classList.add('dragging');
      e.preventDefault();
    }

    function onTimelinePointerMove(e: PointerEvent) {
      const s = timelineDragState;
      if (!s) return;
      const deltaPx = e.clientX - s.pointerStartX;
      if (Math.abs(deltaPx) > 3) s.moved = true;
      if (s.mode === 'click') return;

      const trackWidth = s.trackEl?.offsetWidth;
      if (!trackWidth) return;
      const dayWidth = trackWidth / TIMELINE_DAYS;
      const deltaDays = Math.round(deltaPx / dayWidth);
      const onePct = 100 / TIMELINE_DAYS;

      if (s.mode === 'move') {
        s.bar.style.left = s.origLeftPct + deltaDays * onePct + '%';
      } else if (s.mode === 'resize-left') {
        let newLeft = s.origLeftPct + deltaDays * onePct;
        let newWidth = s.origWidthPct - deltaDays * onePct;
        if (newWidth < onePct) {
          newWidth = onePct;
          newLeft = s.origLeftPct + s.origWidthPct - onePct;
        }
        s.bar.style.left = newLeft + '%';
        s.bar.style.width = newWidth + '%';
      } else if (s.mode === 'resize-right') {
        let newWidth = s.origWidthPct + deltaDays * onePct;
        if (newWidth < onePct) newWidth = onePct;
        s.bar.style.width = newWidth + '%';
      }
    }

    async function onTimelinePointerUp(e: PointerEvent) {
      const s = timelineDragState;
      if (!s) return;
      s.bar.classList.remove('dragging');

      if (!s.moved || s.mode === 'click') {
        timelineDragState = null;
        openModal(s.taskId);
        return;
      }

      const trackWidth = s.trackEl?.offsetWidth || 1;
      const dayWidth = trackWidth / TIMELINE_DAYS;
      const deltaDays = Math.round((e.clientX - s.pointerStartX) / dayWidth);
      timelineDragState = null;

      if (deltaDays === 0) {
        renderTimeline();
        return;
      }

      let newStart = s.origStartDate;
      let newEnd = s.origEndDate;
      if (s.mode === 'move') {
        newStart = addDays(s.origStartDate, deltaDays);
        newEnd = addDays(s.origEndDate, deltaDays);
      } else if (s.mode === 'resize-left') {
        newStart = addDays(s.origStartDate, deltaDays);
        if (newStart > s.origEndDate) newStart = s.origEndDate;
      } else if (s.mode === 'resize-right') {
        newEnd = addDays(s.origEndDate, deltaDays);
        if (newEnd < s.origStartDate) newEnd = s.origStartDate;
      }

      await updateTaskDoc(
        s.taskId,
        { startDate: newStart, endDate: newEnd },
        `Rescheduled timeline to ${newStart ? displayDate(newStart) : 'None'} – ${newEnd ? displayDate(newEnd) : 'None'}`
      );
    }

    // --- Tac-Bored™ / Tackboard View (Unified Project Deliverables + Shift Tasks) ---
    function renderTackboard() {
      const container = byId('tackboardView');
      if (!container) return;

      const team = getTeam();
      const assF = byId<HTMLSelectElement>('assigneeFilter')?.value || '__all__';
      const appF = byId<HTMLSelectElement>('appFilter')?.value || '__all__';
      const showArchived = byId<HTMLInputElement>('showArchivedFilter')?.checked || false;
      const searchVal = (byId<HTMLInputElement>('taskSearch')?.value || '').trim().toLowerCase();

      const vTasks = visibleTasks();
      const activeTasks = showArchived
        ? vTasks
        : vTasks.filter(t => t.status !== 'complete' && !t.archived);

      const now = new Date();
      const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
      const todayStr = localToday.toISOString().split('T')[0];

      const allShiftTasks = (propsRef.current.shiftBlocks || []).filter(b => {
        if (b.isShiftBlock === true || (b.title && String(b.title).startsWith('[SHIFT]'))) return false;
        let taskDate = b.date || (b.startTime ? String(b.startTime).split('T')[0] : '');
        if (!showArchived) {
          if (b.status === 'completed') return false;
          if (taskDate && taskDate < todayStr && !b.webDevTaskId) return false;
        }
        if (appF !== '__all__' && b.department !== appF) return false;
        if (searchVal) {
          const mTitle = String(b.title || '').toLowerCase().includes(searchVal);
          const mDesc = String(b.description || '').toLowerCase().includes(searchVal);
          if (!mTitle && !mDesc) return false;
        }
        return true;
      });

      const matchesAssigneeKey = (targetEmail: string, candidateEmail: string) => {
        const a = String(targetEmail || '').toLowerCase();
        const b = String(candidateEmail || '').toLowerCase();
        if (!a || !b) return false;
        if (a === b) return true;
        return a.split('@')[0] === b.split('@')[0];
      };

      const filteredTeam = team.filter(email => {
        if (assF === '__all__') return true;
        if (assF === '__me__') return matchesAssigneeKey(email, getCurrentUserEmail());
        if (assF === '__none__') return false;
        return matchesAssigneeKey(email, assF);
      });

      let html = '';

      filteredTeam.forEach(email => {
        const cwUser = findClockworkUserByKey(email);
        const displayName = getDisplayName(email);
        const roleSub = cwUser?.role || profiles[email]?.role || 'Team Member';
        const items: any[] = [];

        activeTasks.forEach(t => {
          const parentAssignees = Array.isArray(t.assignees) ? t.assignees : [];
          const lead = parentAssignees[0] || '';
          const support = parentAssignees.slice(1);
          const isLeadOrSupport = parentAssignees.some((x: string) => matchesAssigneeKey(email, x));

          if (isLeadOrSupport) {
            items.push({
              type: 'parent',
              taskId: t.id,
              title: t.title || 'Untitled',
              details: t.details || '',
              app: t.app || '',
              status: t.status || 'active',
              priority: t.priority || 'medium',
              startDate: t.startDate || '',
              endDate: t.endDate || '',
              parentLead: lead,
              parentSupport: support,
              parentTitle: ''
            });
          }

          if (Array.isArray(t.subtasks)) {
            t.subtasks.forEach((sub: any, sIdx: number) => {
              if ((!sub.completed || showArchived) && sub.assignee && matchesAssigneeKey(email, sub.assignee)) {
                items.push({
                  type: 'subtask',
                  taskId: t.id,
                  subtaskId: sub.id,
                  subtaskIndex: sIdx,
                  title: sub.title || 'Untitled Subtask',
                  details: sub.notes || '',
                  app: t.app || '',
                  status: sub.completed ? 'complete' : 'active',
                  priority: t.priority || 'medium',
                  startDate: sub.startDate || t.startDate || '',
                  endDate: sub.endDate || t.endDate || '',
                  parentLead: lead,
                  parentSupport: support,
                  parentTitle: t.title || 'Untitled Parent'
                });
              }
            });
          }
        });

        const userShiftTasks = cwUser
          ? allShiftTasks.filter(b => b.assignedTo === cwUser.id)
          : [];

        const totalCount = items.length + userShiftTasks.length;

        const projectItemsHtml = items.map(item => {
          const dateText = formatDateChip(item.startDate, item.endDate) || '';
          const metaParts: string[] = [];
          metaParts.push(`<strong style="text-transform: uppercase; color: ${item.type === 'parent' ? 'var(--accent)' : 'var(--muted)'};">${item.type === 'parent' ? item.status : 'Subtask'}</strong>`);
          if (item.type === 'subtask' && item.parentTitle) {
            metaParts.push(`Part of: <strong style="color: var(--text); font-weight: 500;">${escapeHtml(item.parentTitle)}</strong>`);
          }
          if (dateText) metaParts.push(`📅 ${escapeHtml(dateText)}`);
          metaParts.push(`Lead: ${item.parentLead ? escapeHtml(getDisplayShort(item.parentLead)) : 'Unassigned'}`);
          if (item.parentSupport && item.parentSupport.length > 0) {
            metaParts.push(`Support: ${item.parentSupport.map((s: string) => escapeHtml(getDisplayShort(s))).join(', ')}`);
          }

          const alreadyOnShift = cwUser && (propsRef.current.shiftBlocks || []).some(sb =>
            sb.assignedTo === cwUser.id &&
            sb.webDevTaskId === item.taskId &&
            (item.type === 'subtask' ? (sb.isWebDevSubtask && sb.webDevSubtaskIndex === item.subtaskIndex) : !sb.isWebDevSubtask)
          );

          return `
            <li class="tb-task-item" data-id="${item.taskId}" data-subtask-id="${item.type === 'subtask' ? escapeHtml(item.subtaskId) : ''}">
              <span class="tb-bullet ${item.priority || 'medium'}" style="margin-top: 5px;"></span>
              <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <span class="tb-task-title" style="margin: 0;">${escapeHtml(item.title)}</span>
                  ${item.app ? `<span class="tb-task-project" style="margin: 0; flex-shrink: 0;">${escapeHtml(item.app)}</span>` : ''}
                </div>
                ${item.details ? `<div style="font-size: 11px; color: var(--muted); line-height: 1.35;">${escapeHtml(item.details)}</div>` : ''}
                <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--muted); line-height: 1.3; margin-top: 2px;">
                  <span>${metaParts.join(' • ')}</span>
                  ${cwUser ? (alreadyOnShift
                    ? `<span style="font-size: 10px; font-weight: 700; color: var(--done); padding: 2px 6px; background: rgba(47,170,107,0.12); border-radius: 6px;">✓ On Shift</span>`
                    : `<button type="button" class="tb-push-shift-btn" data-email="${escapeHtml(email)}" data-task-id="${escapeHtml(item.taskId)}" data-subtask-idx="${item.subtaskIndex ?? ''}" style="font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: var(--accent-2); color: var(--bg); border: none; cursor: pointer;">+ To Shift</button>`
                  ) : ''}
                </div>
              </div>
            </li>
          `;
        }).join('');

        const shiftItemsHtml = userShiftTasks.map(st => {
          const startStr = st.startTime?.split('T')[1]?.slice(0, 5) || '08:00';
          const endStr = st.endTime?.split('T')[1]?.slice(0, 5) || '16:00';
          const statusLabel = String(st.status || 'pending').replace('_', ' ').toUpperCase();
          return `
            <li class="tb-task-item tb-shift-item" data-shift-id="${escapeHtml(st.id)}">
              <span class="tb-bullet ${st.priority || 'medium'}" style="margin-top: 5px;"></span>
              <div style="display: flex; flex-direction: column; gap: 4px; flex-grow: 1; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <span class="tb-task-title" style="margin: 0;">${escapeHtml(st.title)}</span>
                  ${st.department ? `<span class="tb-task-project" style="margin: 0; flex-shrink: 0;">${escapeHtml(st.department)}</span>` : ''}
                </div>
                ${st.description ? `<div style="font-size: 11px; color: var(--muted); line-height: 1.35;">${escapeHtml(st.description)}</div>` : ''}
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 4px; margin-top: 2px;">
                  <span style="font-weight: 700;">${escapeHtml(statusLabel)}</span>
                  <span style="font-family: monospace;">${escapeHtml(startStr)} - ${escapeHtml(endStr)}</span>
                </div>
              </div>
            </li>
          `;
        }).join('');

        const bodyHtml = totalCount === 0
          ? `<div style="font-size: 12px; color: var(--muted); font-style: italic; text-align: center; padding: 28px 0;">No active tasks</div>`
          : `<ul class="tb-task-list">${projectItemsHtml}${shiftItemsHtml}</ul>`;

        html += `
          <div class="tb-column">
            <div class="tb-col-header">
              ${avatarHtml(email)}
              <div style="display: flex; flex-direction: column; min-width: 0;">
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 190px; line-height: 1.2;">${escapeHtml(displayName)}</span>
                <span style="font-size: 10px; color: var(--muted); font-weight: 500;">${escapeHtml(roleSub)}</span>
              </div>
              <span class="count">${totalCount}</span>
              <button type="button" class="icon-btn tb-add-for-member" data-email="${escapeHtml(email)}" data-user-id="${escapeHtml(cwUser?.id || '')}" title="Add task for ${escapeHtml(displayName)}" style="font-size: 16px; font-weight: 700; padding: 2px 8px;">+</button>
            </div>
            <div class="tb-col-body">
              ${bodyHtml}
            </div>
          </div>
        `;
      });

      // Unassigned column
      const unassignedItems: any[] = [];
      activeTasks.forEach(t => {
        const parentAssignees = Array.isArray(t.assignees) ? t.assignees : [];
        const subtaskAssignees = (t.subtasks || [])
          .filter((s: any) => !s.completed)
          .map((s: any) => String(s.assignee || '').toLowerCase())
          .filter(Boolean);
        if (parentAssignees.length === 0 && subtaskAssignees.length === 0) {
          unassignedItems.push({
            type: 'parent',
            taskId: t.id,
            title: t.title || 'Untitled',
            details: t.details || '',
            app: t.app || '',
            status: t.status || 'backlog',
            priority: t.priority || 'medium',
            startDate: t.startDate || '',
            endDate: t.endDate || ''
          });
        }
      });

      if ((assF === '__all__' || assF === '__none__') && unassignedItems.length > 0) {
        const taskItemsHtml = `<ul class="tb-task-list">` + unassignedItems.map(item => {
          const dateText = formatDateChip(item.startDate, item.endDate) || '';
          const metaParts = [`<strong style="text-transform: uppercase; color: var(--accent);">${escapeHtml(item.status)}</strong>`];
          if (dateText) metaParts.push(`📅 ${escapeHtml(dateText)}`);
          metaParts.push('Lead: Unassigned');
          return `
            <li class="tb-task-item" data-id="${item.taskId}">
              <span class="tb-bullet ${item.priority || 'medium'}" style="margin-top: 5px;"></span>
              <div style="display: flex; flex-direction: column; gap: 3px; flex-grow: 1; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                  <span class="tb-task-title" style="margin: 0;">${escapeHtml(item.title)}</span>
                  ${item.app ? `<span class="tb-task-project" style="margin: 0; flex-shrink: 0;">${escapeHtml(item.app)}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--muted);">${metaParts.join(' • ')}</div>
              </div>
            </li>
          `;
        }).join('') + `</ul>`;

        html += `
          <div class="tb-column">
            <div class="tb-col-header">
              <span class="avatar" style="background: var(--muted);" title="Unassigned">?</span>
              <span>Unassigned</span>
              <span class="count">${unassignedItems.length}</span>
            </div>
            <div class="tb-col-body">${taskItemsHtml}</div>
          </div>
        `;
      }

      container.innerHTML = html;

      container.querySelectorAll('.tb-add-for-member').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const email = (btn as HTMLElement).dataset.email || '';
          openModal(null, email);
        });
      });

      container.querySelectorAll('.tb-push-shift-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const el = btn as HTMLElement;
          const email = el.dataset.email || '';
          const taskId = el.dataset.taskId || '';
          const subIdxStr = el.dataset.subtaskIdx || '';
          const t = tasks.find(x => x.id === taskId);
          if (!t) return;
          if (subIdxStr !== '') {
            const sIdx = parseInt(subIdxStr, 10);
            const sub = (t.subtasks || [])[sIdx];
            if (sub) {
              scheduleTaskToShift(email, {
                type: 'subtask',
                taskId: t.id,
                subtaskIndex: sIdx,
                title: sub.title,
                details: sub.notes,
                parentTitle: t.title,
                app: t.app,
                priority: t.priority
              });
            }
          } else {
            scheduleTaskToShift(email, {
              type: 'parent',
              taskId: t.id,
              title: t.title,
              details: t.details,
              app: t.app,
              priority: t.priority
            });
          }
        });
      });

      container.querySelectorAll('.tb-task-item').forEach(item => {
        const htmlItem = item as HTMLElement;
        if (htmlItem.classList.contains('tb-shift-item')) {
          htmlItem.addEventListener('click', () => {
            const shiftId = htmlItem.dataset.shiftId;
            const shiftTask = (propsRef.current.shiftBlocks || []).find(b => b.id === shiftId);
            if (shiftTask && propsRef.current.onOpenShiftTaskModal) {
              propsRef.current.onOpenShiftTaskModal(shiftTask);
            }
          });
          return;
        }

        htmlItem.addEventListener('click', () => {
          openModal(htmlItem.dataset.id || null);
        });

        htmlItem.addEventListener('contextmenu', e => {
          const mouseEv = e as MouseEvent;
          mouseEv.preventDefault();
          mouseEv.stopPropagation();
          const id = htmlItem.dataset.id || '';
          const subtaskId = htmlItem.dataset.subtaskId || null;
          const task = tasks.find(x => x.id === id);
          if (!task || !canEditTask(task)) return;
          showTackboardContextMenu(id, subtaskId, mouseEv.clientX, mouseEv.clientY);
        });
      });
    }

    function showTackboardContextMenu(taskId: string, subtaskId: string | null, x: number, y: number) {
      const menu = byId('tbContextMenu');
      if (!menu) return;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.style.display = 'flex';

      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      if (subtaskId) {
        const sub = (task.subtasks || []).find((s: any) => s.id === subtaskId);
        if (!sub) return;
        const label = sub.completed ? 'Mark Incomplete' : 'Mark Complete';
        menu.innerHTML = `
          <div class="tb-context-menu-item" data-action="toggle-complete">
            <span class="status-dot" style="background-color: ${sub.completed ? '#e05a5a' : '#2faa6b'};"></span>
            <span>${label}</span>
          </div>
        `;
        menu.querySelector('.tb-context-menu-item')?.addEventListener('click', async () => {
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          const targetSub = subtasksCopy.find((s: any) => s.id === subtaskId);
          if (targetSub) {
            targetSub.completed = !sub.completed;
            const completedCount = subtasksCopy.filter((s: any) => s.completed).length;
            const progress = subtasksCopy.length > 0 ? Math.round((completedCount / subtasksCopy.length) * 100) : 0;
            await updateTaskDoc(
              taskId,
              { subtasks: subtasksCopy, progress },
              targetSub.completed ? `Completed subtask '${targetSub.title}'` : `Uncompleted subtask '${targetSub.title}'`
            );
            toast('Subtask updated');
          }
          hideTackboardContextMenu();
        });
      } else {
        const statuses = [
          { value: 'backlog', label: 'Backlog', color: '#e05a5a' },
          { value: 'ready', label: 'Ready to Start', color: '#e89a3d' },
          { value: 'active', label: 'Active', color: '#5b8def' },
          { value: 'review', label: 'Review', color: '#9b59b6' },
          { value: 'complete', label: 'Complete', color: '#2faa6b' }
        ];
        menu.innerHTML = statuses.map(s => {
          const isCurrent = task.status === s.value;
          return `
            <div class="tb-context-menu-item" data-status="${s.value}" style="${isCurrent ? 'font-weight: 700; color: var(--accent);' : ''}">
              <span class="status-dot" style="background-color: ${s.color};"></span>
              <span>${s.label}</span>
              ${isCurrent ? '<span style="margin-left:auto; font-size:10px;">✓</span>' : ''}
            </div>
          `;
        }).join('');

        menu.querySelectorAll('.tb-context-menu-item').forEach(item => {
          item.addEventListener('click', async () => {
            const newStatus = (item as HTMLElement).dataset.status || 'active';
            if (task.status === newStatus) return;
            const progress = newStatus === 'complete' ? 100 : (task.progress === 100 ? 0 : (task.progress || 0));
            await updateTaskDoc(taskId, { status: newStatus, progress }, `Changed status to ${newStatus}`);
            toast(`Task status updated to ${newStatus}`);
            hideTackboardContextMenu();
          });
        });
      }
    }

    function hideTackboardContextMenu() {
      const menu = byId('tbContextMenu');
      if (menu) menu.style.display = 'none';
    }

    // --- List View ---
    function renderList() {
      const container = byId('listView');
      if (!container) return;
      const items = visibleTasks();

      if (items.length === 0) {
        container.innerHTML = '<div class="list-empty">No tasks match the current filters. Click "+ New task" to create one.</div>';
        return;
      }

      const STATUS_RANK: Record<string, number> = { backlog: 0, ready: 1, active: 2, review: 3, complete: 4 };

      const groups: Record<string, any[]> = {};
      items.forEach(t => {
        const key = t.app || '';
        if (!groups[key]) groups[key] = [];
        groups[key].push(t);
      });

      Object.keys(groups).forEach(proj => {
        groups[proj].sort((a, b) => {
          let valA: any, valB: any;
          if (listSortField === 'title') {
            valA = (a.title || '').toLowerCase();
            valB = (b.title || '').toLowerCase();
          } else if (listSortField === 'lead') {
            const emailA = Array.isArray(a.assignees) && a.assignees[0] ? a.assignees[0] : '';
            const emailB = Array.isArray(b.assignees) && b.assignees[0] ? b.assignees[0] : '';
            valA = getDisplayShort(emailA).toLowerCase();
            valB = getDisplayShort(emailB).toLowerCase();
          } else if (listSortField === 'support') {
            const emailA = Array.isArray(a.assignees) && a.assignees[1] ? a.assignees[1] : '';
            const emailB = Array.isArray(b.assignees) && b.assignees[1] ? b.assignees[1] : '';
            valA = getDisplayShort(emailA).toLowerCase();
            valB = getDisplayShort(emailB).toLowerCase();
          } else if (listSortField === 'cadence') {
            valA = a.startDate || a.endDate || '';
            valB = b.startDate || b.endDate || '';
          } else if (listSortField === 'status') {
            valA = STATUS_RANK[a.status] ?? 99;
            valB = STATUS_RANK[b.status] ?? 99;
          } else if (listSortField === 'priority') {
            valA = PRIORITY_RANK[a.priority] ?? 99;
            valB = PRIORITY_RANK[b.priority] ?? 99;
          } else if (listSortField === 'progress') {
            valA = progressOf(a);
            valB = progressOf(b);
          } else {
            valA = a.order ?? 0;
            valB = b.order ?? 0;
          }

          if (valA < valB) return listSortAsc ? -1 : 1;
          if (valA > valB) return listSortAsc ? 1 : -1;
          return (a.order ?? 0) - (b.order ?? 0);
        });
      });

      const sortedProjKeys = Object.keys(groups).sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b);
      });

      const team = getTeam();
      const renderSortIndicator = (field: string) => {
        if (listSortField !== field) return '';
        return listSortAsc ? ' ▴' : ' ▾';
      };

      container.innerHTML = sortedProjKeys.map(proj => {
        const projTasks = groups[proj];
        const isProjectArchived = Boolean(proj && projTasks.every(t => t.archived));
        const isHidingCompleted = Boolean(proj && hideCompletedProjects.has(proj));
        const visibleProjTasks = isHidingCompleted
          ? projTasks.filter(t => t.status !== 'complete')
          : projTasks;
        const rows = visibleProjTasks.map(t => renderListItem(t, team)).join('');
        const projNameDisplay = proj || '(No project)';
        const completedCount = projTasks.filter(t => t.status === 'complete').length;
        const toggleBtn = completedCount > 0 && proj
          ? `<button class="ghost lp-toggle-completed" data-project="${escapeHtml(proj)}" style="font-size: 11px; padding: 2px 8px; margin-left: 8px;">
              ${isHidingCompleted ? 'Show completed' : 'Hide completed'} (${completedCount})
             </button>`
          : '';

        return `
          <div class="list-project ${isProjectArchived ? 'archived' : ''}" data-project-name="${escapeHtml(proj)}">
            <div class="list-project-header">
              <div class="lp-name-container">
                ${proj
                  ? `<input type="text" class="lp-name-input" value="${escapeHtml(projNameDisplay)}" data-old-name="${escapeHtml(proj)}" ${isProjectArchived ? 'disabled' : ''}>`
                  : `<span class="lp-name-static">${escapeHtml(projNameDisplay)}</span>`
                }
                <span class="lp-count">${projTasks.length} ${projTasks.length === 1 ? 'task' : 'tasks'}</span>
                ${toggleBtn}
                ${isProjectArchived ? '<span class="archive-badge" style="font-size: 11px; padding: 2px 6px; background: var(--border); border-radius: 4px; color: var(--muted); margin-left: 8px;">Archived</span>' : ''}
              </div>
              ${proj ? `
                <div class="lp-actions">
                  <button class="icon-btn" data-project-action="${isProjectArchived ? 'unarchive' : 'archive'}" title="${isProjectArchived ? 'Unarchive project' : 'Archive project'}">📦</button>
                  <button class="icon-btn danger" data-project-action="delete" title="Delete project">🗑</button>
                </div>` : ''}
            </div>
            <div class="list-table-container">
              <div class="list-table-header">
                <div class="lth-drag-col"></div>
                <div class="lth-expand-col"></div>
                <div class="lth-title-col clickable" data-sort="title">Deliverable${renderSortIndicator('title')}</div>
                <div class="lth-lead-col clickable" data-sort="lead">Lead${renderSortIndicator('lead')}</div>
                <div class="lth-support-col clickable" data-sort="support">Support${renderSortIndicator('support')}</div>
                <div class="lth-cadence-col clickable" data-sort="cadence">Start / End${renderSortIndicator('cadence')}</div>
                <div class="lth-status-col clickable" data-sort="status">Status${renderSortIndicator('status')}</div>
                <div class="lth-priority-col clickable" data-sort="priority">Priority${renderSortIndicator('priority')}</div>
                <div class="lth-progress-col clickable" data-sort="progress">%${renderSortIndicator('progress')}</div>
                <div class="lth-delete-col"></div>
              </div>
              <div class="list-rows">${rows}</div>
              ${!isProjectArchived ? `
                <div class="list-add-task-row" style="padding: 8px 16px; border-top: 1px solid var(--border); display: flex; align-items: center;">
                  <button class="ghost lp-add-task-btn" data-project="${escapeHtml(proj)}" style="font-size: 13px; font-weight: 500; color: var(--muted); border: none;">
                    + Add task to this project
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      bindListEvents();
    }

    function renderListItem(t: any, team: string[]) {
      const p = t.priority || 'medium';
      const parentAssignees = Array.isArray(t.assignees) ? t.assignees : [];
      const lead = parentAssignees[0] || '';
      const supportEmails = parentAssignees.slice(1);
      const supportLabelText = supportEmails.length > 0 ? supportEmails.map(getDisplayShort).join(', ') : 'Unassigned';
      const cadenceValue = t.cadence || (t.startDate || t.endDate ? formatDateChip(t.startDate, t.endDate) : '');
      const updates = Array.isArray(t.updates) ? t.updates : [];
      const updateBadge = updates.length ? `<span class="update-count">💬 ${updates.length}</span>` : '';
      const hasDetails = !!(t.details && t.details.trim());
      const detailsBadge = hasDetails ? `<span class="details-indicator">📄</span>` : '';
      const isExpanded = expandedIds.has(t.id);
      const expanded = isExpanded ? renderExpanded(t, updates) : '';
      const prog = progressOf(t);

      return `
        <div class="list-item ${isExpanded ? 'expanded' : ''} ${t.status === 'complete' ? 'done' : ''} ${t.archived ? 'archived' : ''}" data-id="${t.id}">
          <div class="list-row">
            <div class="lr-drag-cell" title="Drag to reorder">☰</div>
            <div class="lr-expand-cell">
              <button class="icon-btn expand-btn" data-action="expand">${isExpanded ? '▾' : '▸'}</button>
            </div>
            <div class="lr-title-cell">
              <input type="text" class="lr-title-input ${t.status === 'complete' ? 'slashed' : ''}" data-field="title" value="${escapeHtml(t.title || '')}" placeholder="Deliverable...">
              <div class="lr-badges" style="display: flex; gap: 4px; align-items: center;">${detailsBadge}${updateBadge}</div>
            </div>
            <div class="lr-lead-cell">
              <select class="lr-assignee-select lr-lead-select">
                <option value="">Unassigned</option>
                ${team.map(email => `<option value="${escapeHtml(email)}" ${lead.toLowerCase() === email.toLowerCase() ? 'selected' : ''}>${escapeHtml(getDisplayShort(email))}</option>`).join('')}
              </select>
            </div>
            <div class="lr-support-cell">
              <div class="inline-support-wrapper" data-action="edit-support" title="Click to edit support assignees">
                <span class="inline-support-label">${escapeHtml(supportLabelText)}</span>
              </div>
            </div>
            <div class="lr-cadence-cell">
              <div class="inline-cadence-wrapper">
                <span class="inline-cadence-label" data-action="edit-cadence">${escapeHtml(cadenceValue || 'Set dates')}</span>
              </div>
            </div>
            <div class="lr-status-cell">
              <select class="status-select-inline ${t.status}" data-field="status">
                <option value="backlog" ${t.status === 'backlog' ? 'selected' : ''}>Backlog</option>
                <option value="ready" ${t.status === 'ready' ? 'selected' : ''}>Ready to Start</option>
                <option value="active" ${t.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="review" ${t.status === 'review' ? 'selected' : ''}>Review</option>
                <option value="complete" ${t.status === 'complete' ? 'selected' : ''}>Complete</option>
              </select>
            </div>
            <div class="lr-priority-cell">
              <select class="priority-select-inline ${p}" data-field="priority">
                <option value="critical" ${t.priority === 'critical' ? 'selected' : ''}>Critical</option>
                <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="medium" ${t.priority === 'medium' || !t.priority ? 'selected' : ''}>Medium</option>
                <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
              </select>
            </div>
            <div class="lr-progress-cell" data-action="progress" title="Progress: ${prog}% — click to update">${prog}%</div>
            <div class="lr-delete-cell">
              <button class="icon-btn danger" data-action="delete" title="Delete task">×</button>
            </div>
          </div>
          ${expanded}
        </div>
      `;
    }

    function renderExpanded(t: any, updates: any[]) {
      const sorted = [...updates].sort((a, b) => tsToMillis(a.timestamp) - tsToMillis(b.timestamp));
      const parentAssignees = Array.isArray(t.assignees) ? t.assignees : [];
      const lead = parentAssignees[0] || '';
      const supportEmails = parentAssignees.slice(1);
      const team = getTeam();
      const remainingCandidates = team.filter(
        email =>
          email.toLowerCase() !== lead.toLowerCase() &&
          !supportEmails.some((se: string) => se.toLowerCase() === email.toLowerCase())
      );

      const listHtml = sorted.length === 0
        ? `<div class="update-empty">No updates yet — start the thread below.</div>`
        : sorted.map(u => `
            <div class="update-item">
              ${avatarHtml(u.author)}
              <div class="update-body">
                <div class="update-meta">
                  <span class="update-author">${escapeHtml(getDisplayShort(u.author))}</span>
                  <span title="${escapeHtml(fullTime(u.timestamp))}">${escapeHtml(timeAgo(u.timestamp))}</span>
                  <button class="update-delete" data-action="delete-update" data-task-id="${t.id}" data-ts="${u.timestamp}" title="Delete this post">×</button>
                </div>
                <div class="update-text">${escapeHtml(u.text)}</div>
              </div>
            </div>
          `).join('');

      const apps = getApps();
      const currentProj = t.app || '';
      const allProjOptions = [...apps];
      if (currentProj && !allProjOptions.includes(currentProj)) allProjOptions.push(currentProj);
      allProjOptions.sort();

      const projectSelectOptionsHtml =
        '<option value="">(No project)</option>' +
        allProjOptions.map(a => `<option value="${escapeHtml(a)}" ${currentProj === a ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('') +
        '<option value="__new__">+ New Project...</option>';

      return `
        <div class="task-expanded" data-task-id="${t.id}">
          <div class="expanded-split">
            <div class="expanded-col" style="display: flex; flex-direction: column; gap: 16px;">
              <div class="expanded-card">
                <div class="expanded-card-header">
                  <span class="expanded-card-title">Project & Assignees</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div class="expanded-field">
                    <span style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Project</span>
                    <select class="expanded-project-input" data-task-id="${t.id}">
                      ${projectSelectOptionsHtml}
                    </select>
                  </div>
                  <div style="display:flex; gap:16px;">
                    <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                      <span style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Lead</span>
                      <select class="expanded-lead-select">
                        <option value="">Unassigned</option>
                        ${team.map(email => `<option value="${escapeHtml(email)}" ${lead.toLowerCase() === email.toLowerCase() ? 'selected' : ''}>${escapeHtml(getDisplayShort(email))}</option>`).join('')}
                      </select>
                    </div>
                    <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                      <span style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Support</span>
                      <div class="expanded-support-container" style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                        ${supportEmails.map((email: string) => `
                          <span class="support-pill">
                            ${escapeHtml(getDisplayShort(email))}
                            <button type="button" class="remove-support-btn" data-email="${escapeHtml(email)}" data-task-id="${t.id}">×</button>
                          </span>
                        `).join('')}
                        ${remainingCandidates.length > 0 ? `
                          <select class="add-support-select" data-task-id="${t.id}">
                            <option value="">+ Add Support</option>
                            ${remainingCandidates.map(email => `<option value="${escapeHtml(email)}">${escapeHtml(getDisplayShort(email))}</option>`).join('')}
                          </select>
                        ` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="expanded-card">
                <div class="expanded-card-header">
                  <span class="expanded-card-title">Subtasks</span>
                  <span style="font-size:11px; font-weight:700; color:var(--accent);">${progressOf(t)}%</span>
                </div>
                <div class="expanded-subtasks-list" style="display:flex; flex-direction:column; gap:10px; margin-bottom:12px;">
                  ${(t.subtasks || []).map((s: any, idx: number) => `
                    <div class="subtask-container" style="display:flex; flex-direction:column; gap:4px; border-bottom:1px solid var(--border); padding-bottom:6px;">
                      <div class="subtask-row" style="display:flex; align-items:center; gap:8px;">
                        <input type="checkbox" class="subtask-checkbox-inline" data-task-id="${t.id}" data-index="${idx}" ${s.completed ? 'checked' : ''}>
                        <input type="text" class="subtask-text-input-inline ${s.completed ? 'completed' : ''}" data-task-id="${t.id}" data-index="${idx}" value="${escapeHtml(s.title)}" placeholder="Subtask name..." style="flex:1; border:none; background:transparent; padding:2px; font-size:12px; color: ${s.completed ? 'var(--muted)' : 'var(--text)'};">
                        <select class="subtask-assignee-select-inline" data-task-id="${t.id}" data-index="${idx}" style="font-size:11px; padding:2px 4px; max-width:120px;">
                          <option value="">Assign...</option>
                          ${team.map(email => `<option value="${escapeHtml(email)}" ${(s.assignee || '').toLowerCase() === email.toLowerCase() ? 'selected' : ''}>${escapeHtml(getDisplayShort(email))}</option>`).join('')}
                        </select>
                        <button type="button" class="delete-subtask-inline" data-task-id="${t.id}" data-index="${idx}" style="background:none; border:none; font-size:14px; color:var(--muted); cursor:pointer;">×</button>
                      </div>
                      <div style="padding-left: 24px; display:flex; align-items:center; gap:8px;">
                        <input type="text" class="subtask-notes-input-inline" data-task-id="${t.id}" data-index="${idx}" placeholder="Add notes to this subtask..." value="${escapeHtml(s.notes || '')}" style="flex:1; font-size:11px; padding:2px 4px; border:none; background:transparent; border-bottom:1px dashed var(--border); color:var(--text-muted);">
                        <button type="button" class="subtask-date-btn" data-task-id="${t.id}" data-index="${idx}" style="font-size: 10px; padding: 2px 6px;">
                          📅 ${s.startDate || s.endDate ? `${s.startDate ? displayDate(s.startDate) : '—'} – ${s.endDate ? displayDate(s.endDate) : '—'}` : 'Set dates'}
                        </button>
                      </div>
                    </div>
                  `).join('')}
                  ${(t.subtasks || []).length === 0 ? `<div style="font-size:12px; color:var(--muted); font-style:italic;">No subtasks</div>` : ''}
                </div>
                <div style="display:flex; gap:8px;">
                  <input type="text" class="new-subtask-input-inline" data-task-id="${t.id}" placeholder="+ Add subtask" style="flex:1; font-size:12px; padding:6px 8px;" autocomplete="off">
                  <button type="button" class="update-send add-subtask-btn-inline" data-task-id="${t.id}" style="padding:6px 12px; font-size:12px;">Add</button>
                </div>
              </div>
            </div>

            <div class="expanded-col" style="display: flex; flex-direction: column; gap: 16px;">
              <div class="expanded-card">
                <div class="expanded-card-header">
                  <span class="expanded-card-title">Notes & Resources</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <div class="expanded-field">
                    <span style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Notes / Dependencies</span>
                    <textarea class="expanded-textarea" data-field="details" placeholder="Add notes, context, or requirements...">${escapeHtml(t.details || '')}</textarea>
                  </div>
                  <div class="expanded-field">
                    <span style="font-size:11px; color:var(--muted); font-weight:600; text-transform:uppercase;">Resource Link</span>
                    <div class="expanded-input-row" style="display:flex; gap:8px;">
                      <input type="text" class="expanded-input url-input" data-field="link" value="${escapeHtml(t.link || '')}" placeholder="Paste URL (e.g. Figma, Doc)..." style="flex:1;">
                      ${t.link ? `<a class="cell-link-btn" href="${escapeHtml(t.link)}" target="_blank" rel="noreferrer" style="align-self:center; font-size:11px; font-weight:600; color:var(--accent); text-decoration:none; padding:4px 8px; border:1px solid var(--border); border-radius:4px;">Open</a>` : ''}
                    </div>
                  </div>
                </div>
              </div>

              <div class="expanded-card">
                <div class="expanded-card-header">
                  <span class="expanded-card-title">Discussion Thread</span>
                </div>
                <div class="update-list">${listHtml}</div>
                <div class="update-input-row">
                  <input class="update-input" data-task-id="${t.id}" placeholder="Type message to post..." autocomplete="off">
                  <button class="update-send" data-action="send" data-task-id="${t.id}">Post</button>
                </div>
              </div>

              <div class="expanded-card">
                <div class="expanded-card-header">
                  <span class="expanded-card-title">Activity Log</span>
                </div>
                <div class="expanded-activity-log" style="display:flex; flex-direction:column; gap:8px; max-height:150px; overflow-y:auto; font-size:11px;">
                  ${(t.activityLog || []).slice().reverse().map((log: any) => `
                    <div class="activity-log-item" style="border-bottom: 1px solid var(--border); padding-bottom: 4px;">
                      <div style="display:flex; justify-content:space-between; color:var(--muted); margin-bottom: 2px;">
                        <span style="font-weight:600;">${escapeHtml(getDisplayShort(log.user))}</span>
                        <span>${escapeHtml(fullTime(log.timestamp))}</span>
                      </div>
                      <div style="color:var(--text);">${escapeHtml(log.action)}</div>
                    </div>
                  `).join('')}
                  ${(t.activityLog || []).length === 0 ? `<div style="font-style:italic; color:var(--muted);">No activity recorded yet.</div>` : ''}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function bindSharedExpandedEvents(item: HTMLElement, task: any, id: string) {
      const expLeadSelect = item.querySelector('.expanded-lead-select') as HTMLSelectElement | null;
      expLeadSelect?.addEventListener('change', async () => {
        const val = expLeadSelect.value;
        const parentAssignees = Array.isArray(task.assignees) ? [...task.assignees] : [];
        const supportEmails = parentAssignees.slice(1).filter((e: string) => e.toLowerCase() !== val.toLowerCase());
        const newAssignees = val ? [val, ...supportEmails] : [...supportEmails];
        await updateTaskDoc(id, { assignees: newAssignees }, val ? `Assigned task lead to ${getDisplayShort(val)}` : 'Removed task lead');
      });

      const addSupportSelect = item.querySelector('.add-support-select') as HTMLSelectElement | null;
      addSupportSelect?.addEventListener('change', async () => {
        const val = addSupportSelect.value;
        if (!val) return;
        const parentAssignees = Array.isArray(task.assignees) ? [...task.assignees] : [];
        const lead = parentAssignees[0] || '';
        const supportEmails = parentAssignees.slice(1);
        if (!supportEmails.some((e: string) => e.toLowerCase() === val.toLowerCase())) {
          supportEmails.push(val);
        }
        const newAssignees = lead ? [lead, ...supportEmails] : [...supportEmails];
        await updateTaskDoc(id, { assignees: newAssignees }, `Added support assignee ${getDisplayShort(val)}`);
      });

      item.querySelectorAll('.remove-support-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const email = (btn as HTMLElement).dataset.email || '';
          if (!email) return;
          const parentAssignees = Array.isArray(task.assignees) ? [...task.assignees] : [];
          const lead = parentAssignees[0] || '';
          const supportEmails = parentAssignees.slice(1).filter((e: string) => e.toLowerCase() !== email.toLowerCase());
          const newAssignees = lead ? [lead, ...supportEmails] : [...supportEmails];
          await updateTaskDoc(id, { assignees: newAssignees }, `Removed support assignee ${getDisplayShort(email)}`);
        });
      });

      const expProjectInput = item.querySelector('.expanded-project-input') as HTMLSelectElement | null;
      expProjectInput?.addEventListener('change', async () => {
        let val = expProjectInput.value;
        if (val === '__new__') {
          const name = prompt('Enter new project name:');
          if (name && name.trim()) {
            val = name.trim();
          } else {
            expProjectInput.value = task.app || '';
            return;
          }
        }
        await updateTaskDoc(id, { app: val }, val ? `Moved task to project '${val}'` : 'Removed project from task');
      });

      const expandedNotes = item.querySelector('.expanded-textarea[data-field="details"]') as HTMLTextAreaElement | null;
      expandedNotes?.addEventListener('change', async () => {
        await updateTaskDoc(id, { details: expandedNotes.value }, 'Updated task notes');
      });

      const expandedLink = item.querySelector('.expanded-input[data-field="link"]') as HTMLInputElement | null;
      expandedLink?.addEventListener('change', async () => {
        await updateTaskDoc(id, { link: expandedLink.value.trim() }, 'Updated links/attachments');
      });

      item.querySelectorAll('.subtask-checkbox-inline').forEach(cb => {
        cb.addEventListener('change', async () => {
          const inputEl = cb as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          if (subtasksCopy[index]) {
            subtasksCopy[index].completed = inputEl.checked;
            const completed = subtasksCopy.filter((s: any) => s.completed).length;
            const progress = Math.round((completed / subtasksCopy.length) * 100);
            const subtask = subtasksCopy[index];
            await updateTaskDoc(
              id,
              { subtasks: subtasksCopy, progress },
              subtask.completed ? `Completed subtask '${subtask.title}'` : `Uncompleted subtask '${subtask.title}'`
            );
          }
        });
      });

      item.querySelectorAll('.subtask-text-input-inline').forEach(input => {
        input.addEventListener('change', async () => {
          const inputEl = input as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          if (subtasksCopy[index]) {
            const oldTitle = (task.subtasks[index] || {}).title || '';
            subtasksCopy[index].title = inputEl.value.trim();
            await updateTaskDoc(id, { subtasks: subtasksCopy }, `Renamed subtask '${oldTitle}' to '${subtasksCopy[index].title}'`);
          }
        });
      });

      item.querySelectorAll('.subtask-assignee-select-inline').forEach(sel => {
        sel.addEventListener('change', async () => {
          const selEl = sel as HTMLSelectElement;
          const index = parseInt(selEl.dataset.index || '0', 10);
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          if (subtasksCopy[index]) {
            subtasksCopy[index].assignee = selEl.value;
            const subtask = subtasksCopy[index];
            await updateTaskDoc(
              id,
              { subtasks: subtasksCopy },
              subtask.assignee ? `Assigned subtask '${subtask.title}' to ${getDisplayShort(subtask.assignee)}` : `Unassigned subtask '${subtask.title}'`
            );
          }
        });
      });

      item.querySelectorAll('.subtask-notes-input-inline').forEach(input => {
        input.addEventListener('change', async () => {
          const inputEl = input as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          if (subtasksCopy[index]) {
            subtasksCopy[index].notes = inputEl.value.trim();
            await updateTaskDoc(id, { subtasks: subtasksCopy }, `Updated notes for subtask '${subtasksCopy[index].title}'`);
          }
        });
      });

      item.querySelectorAll('.delete-subtask-inline').forEach(btn => {
        btn.addEventListener('click', async () => {
          const btnEl = btn as HTMLElement;
          const index = parseInt(btnEl.dataset.index || '0', 10);
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          const subtask = (task.subtasks || [])[index];
          subtasksCopy.splice(index, 1);
          const progress = subtasksCopy.length > 0
            ? Math.round((subtasksCopy.filter((s: any) => s.completed).length / subtasksCopy.length) * 100)
            : task.progress || 0;
          await updateTaskDoc(id, { subtasks: subtasksCopy, progress }, `Deleted subtask '${subtask ? subtask.title : ''}'`);
        });
      });

      item.querySelectorAll('.subtask-date-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const btnEl = btn as HTMLElement;
          const index = parseInt(btnEl.dataset.index || '0', 10);
          const subtask = (task.subtasks || [])[index];
          if (subtask) {
            openDateRangePopover(task.id, index, btnEl, subtask.startDate, subtask.endDate);
          }
        });
      });

      const addInlineInput = item.querySelector('.new-subtask-input-inline') as HTMLInputElement | null;
      const addInlineBtn = item.querySelector('.add-subtask-btn-inline') as HTMLButtonElement | null;
      if (addInlineInput && addInlineBtn) {
        const addInlineAction = async () => {
          const val = addInlineInput.value.trim();
          if (!val) return;
          const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
          subtasksCopy.push({
            id: Math.random().toString(36).substring(2, 9),
            title: val,
            completed: false,
            notes: '',
            startDate: '',
            endDate: ''
          });
          const progress = Math.round((subtasksCopy.filter((s: any) => s.completed).length / subtasksCopy.length) * 100);
          await updateTaskDoc(id, { subtasks: subtasksCopy, progress }, `Added subtask '${val}'`);
        };
        addInlineBtn.addEventListener('click', addInlineAction);
        addInlineInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addInlineAction();
          }
        });
      }
    }

    function bindListEvents() {
      const container = byId('listView');
      if (!container) return;

      container.querySelectorAll('.lp-add-task-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const projName = (btn as HTMLElement).dataset.project || '';
          const colCount = tasks.filter(x => x.status === 'backlog').length;
          const taskData = {
            title: 'New Deliverable',
            app: projName,
            status: 'backlog',
            priority: 'medium',
            assignees: [],
            startDate: '',
            endDate: '',
            progress: 0,
            order: colCount,
            createdAt: serverTimestamp(),
            createdBy: getCurrentUserEmail(),
            activityLog: [{
              user: getCurrentUserEmail(),
              timestamp: new Date().toISOString(),
              action: 'Created task'
            }]
          };
          const newId = await createTaskDoc(taskData);
          setTimeout(() => {
            const item = root.querySelector(`.list-item[data-id="${newId}"]`);
            const titleInput = item?.querySelector('.lr-title-input') as HTMLInputElement | null;
            if (titleInput) {
              titleInput.focus();
              titleInput.select();
            }
          }, 200);
        });
      });

      container.querySelectorAll('.list-table-header [data-sort]').forEach(header => {
        header.addEventListener('click', () => {
          const field = (header as HTMLElement).dataset.sort || 'cadence';
          if (listSortField === field) listSortAsc = !listSortAsc;
          else {
            listSortField = field;
            listSortAsc = true;
          }
          renderList();
        });
      });

      container.querySelectorAll('.list-project').forEach(projEl => {
        const projName = (projEl as HTMLElement).dataset.projectName || '';
        const nameInput = projEl.querySelector('.lp-name-input') as HTMLInputElement | null;
        nameInput?.addEventListener('change', () => {
          renameProject(projName, nameInput.value.trim());
        });

        projEl.querySelector('[data-project-action="delete"]')?.addEventListener('click', () => {
          deleteProject(projName);
        });
        projEl.querySelector('[data-project-action="archive"]')?.addEventListener('click', () => {
          archiveProject(projName, true);
        });
        projEl.querySelector('[data-project-action="unarchive"]')?.addEventListener('click', () => {
          archiveProject(projName, false);
        });
        projEl.querySelector('.lp-toggle-completed')?.addEventListener('click', () => {
          if (hideCompletedProjects.has(projName)) hideCompletedProjects.delete(projName);
          else hideCompletedProjects.add(projName);
          localStorage.setItem('ptb_hideCompletedProjects', JSON.stringify([...hideCompletedProjects]));
          renderList();
        });
      });

      container.querySelectorAll('.list-item').forEach(item => {
        const htmlItem = item as HTMLElement;
        const id = htmlItem.dataset.id || '';
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        htmlItem.querySelector('[data-action="expand"]')?.addEventListener('click', () => toggleExpand(id));

        const listRow = htmlItem.querySelector('.list-row');
        listRow?.addEventListener('click', e => {
          const target = e.target as HTMLElement;
          if (
            target.tagName === 'INPUT' ||
            target.tagName === 'SELECT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'BUTTON' ||
            target.closest('button, select, [data-action]')
          ) {
            return;
          }
          toggleExpand(id);
        });

        const titleInput = htmlItem.querySelector('.lr-title-input') as HTMLInputElement | null;
        titleInput?.addEventListener('change', async () => {
          const val = titleInput.value.trim();
          if (!val) {
            titleInput.value = task.title;
            return toast('Deliverable is required');
          }
          await updateTaskDoc(id, { title: val }, `Renamed task to '${val}'`);
        });

        const prioritySelect = htmlItem.querySelector('.priority-select-inline') as HTMLSelectElement | null;
        prioritySelect?.addEventListener('change', async () => {
          await updateTaskDoc(id, { priority: prioritySelect.value }, `Changed importance to '${prioritySelect.value}'`);
        });

        const statusSelect = htmlItem.querySelector('.status-select-inline') as HTMLSelectElement | null;
        statusSelect?.addEventListener('change', async () => {
          const val = statusSelect.value;
          const progress = val === 'complete' ? 100 : (task.progress === 100 ? 0 : (task.progress || 0));
          await updateTaskDoc(id, { status: val, progress }, `Changed status to '${val}'`);
        });

        const rowLeadSelect = htmlItem.querySelector('.lr-lead-select') as HTMLSelectElement | null;
        rowLeadSelect?.addEventListener('change', async () => {
          const val = rowLeadSelect.value;
          const parentAssignees = Array.isArray(task.assignees) ? [...task.assignees] : [];
          const supportEmails = parentAssignees.slice(1).filter((e: string) => e.toLowerCase() !== val.toLowerCase());
          const newAssignees = val ? [val, ...supportEmails] : [...supportEmails];
          await updateTaskDoc(id, { assignees: newAssignees }, val ? `Assigned task lead to ${getDisplayShort(val)}` : 'Removed task lead');
        });

        const supportLabel = htmlItem.querySelector('[data-action="edit-support"]') as HTMLElement | null;
        supportLabel?.addEventListener('click', e => {
          e.stopPropagation();
          openSupportPopover(id, supportLabel);
        });

        const cadenceLabel = htmlItem.querySelector('[data-action="edit-cadence"]') as HTMLElement | null;
        cadenceLabel?.addEventListener('click', e => {
          e.stopPropagation();
          openDateRangePopover(id, null, cadenceLabel, task.startDate, task.endDate);
        });

        const progressCell = htmlItem.querySelector('[data-action="progress"]') as HTMLElement | null;
        progressCell?.addEventListener('click', e => {
          e.stopPropagation();
          openProgressPopover(id, progressCell);
        });

        bindSharedExpandedEvents(htmlItem, task, id);

        htmlItem.querySelectorAll('[data-action]').forEach(btn => {
          const action = (btn as HTMLElement).dataset.action;
          if (action === 'send') {
            btn.addEventListener('click', e => {
              e.stopPropagation();
              submitUpdate(id);
            });
          }
          if (action === 'delete-update') {
            btn.addEventListener('click', e => {
              e.stopPropagation();
              deleteUpdate(id, Number((btn as HTMLElement).dataset.ts));
            });
          }
          if (action === 'delete') {
            btn.addEventListener('click', e => {
              e.stopPropagation();
              deleteTaskById(id);
            });
          }
        });

        const commentInput = htmlItem.querySelector('.update-input') as HTMLInputElement | null;
        commentInput?.addEventListener('keydown', e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitUpdate(id);
          }
        });
      });
    }

    async function renameProject(oldName: string, newName: string) {
      if (!newName || oldName === newName) return;
      for (const t of tasks) {
        if (t.app === oldName) {
          await updateTaskDoc(t.id, { app: newName }, `Renamed project to ${newName}`);
        }
      }
      toast(`Renamed project to "${newName}"`);
    }

    async function deleteProject(projectName: string) {
      if (!confirm(`Remove project "${projectName}" and unassign its tasks?`)) return;
      for (const t of tasks) {
        if (t.app === projectName) {
          await updateTaskDoc(t.id, { app: '' }, `Removed deleted project ${projectName}`);
        }
      }
      toast(`Deleted project "${projectName}"`);
    }

    async function archiveProject(projectName: string, archive = true) {
      for (const t of tasks) {
        if (t.app === projectName) {
          await updateTaskDoc(t.id, { archived: archive }, `${archive ? 'Archived' : 'Unarchived'} project ${projectName}`);
        }
      }
      toast(`${archive ? 'Archived' : 'Unarchived'} project "${projectName}"`);
    }

    function bindTaskEvents() {
      root.querySelectorAll('.task').forEach(el => {
        const htmlEl = el as HTMLElement;
        const id = htmlEl.dataset.id || '';
        const task = tasks.find(t => t.id === id);
        if (!task) return;

        htmlEl.addEventListener('dragstart', onDragStart as any);
        htmlEl.addEventListener('dragend', onDragEnd as any);
        htmlEl.addEventListener('dragover', onTaskDragOver as any);
        htmlEl.addEventListener('dragleave', onTaskDragLeave as any);
        htmlEl.addEventListener('drop', onTaskDrop as any);

        htmlEl.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = (btn as HTMLElement).dataset.action;
            if (action === 'edit') openModal(id);
            if (action === 'delete') deleteTaskById(id);
            if (action === 'progress') openProgressPopover(id, btn as HTMLElement);
          });
        });

        htmlEl.addEventListener('click', e => {
          const target = e.target as HTMLElement;
          if (target.closest('button, input, select, textarea, a, [data-action], .task-progress')) {
            return;
          }
          openModal(id);
        });
      });
    }

    function toggleExpand(taskId: string) {
      if (expandedIds.has(taskId)) expandedIds.delete(taskId);
      else expandedIds.add(taskId);
      maybeRender();
    }

    async function addUpdate(taskId: string, text: string) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const existing = Array.isArray(task.updates) ? task.updates : [];
      const next = [
        ...existing,
        {
          author: getCurrentUserEmail(),
          text,
          timestamp: Date.now()
        }
      ];
      await updateTaskDoc(taskId, { updates: next }, 'Posted a discussion comment');
    }

    function submitUpdate(taskId: string) {
      const input = root.querySelector(`.update-input[data-task-id="${taskId}"]`) as HTMLInputElement | null;
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addUpdate(taskId, text);
    }

    async function deleteUpdate(taskId: string, timestamp: number) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const next = (task.updates || []).filter((u: any) => u.timestamp !== timestamp);
      await updateTaskDoc(taskId, { updates: next });
    }

    // --- Drag & Drop on Board ---
    function onDragStart(e: DragEvent) {
      const currentTarget = e.currentTarget as HTMLElement;
      dragId = currentTarget.dataset.id || null;
      currentTarget.classList.add('dragging');
      if (e.dataTransfer && dragId) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
      }
    }

    function onDragEnd(e: DragEvent) {
      (e.currentTarget as HTMLElement).classList.remove('dragging');
      clearDropHints();
      dragId = null;
    }

    function clearDropHints() {
      root.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
      root.querySelectorAll('.task-list.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function onTaskDragOver(e: DragEvent) {
      if (!dragId) return;
      e.preventDefault();
      const target = e.currentTarget as HTMLElement;
      if (target.dataset.id === dragId) return;
      const rect = target.getBoundingClientRect();
      const before = e.clientY - rect.top < rect.height / 2;
      clearDropHints();
      target.classList.add(before ? 'drop-before' : 'drop-after');
    }

    function onTaskDragLeave(e: DragEvent) {
      (e.currentTarget as HTMLElement).classList.remove('drop-before', 'drop-after');
    }

    function onTaskDrop(e: DragEvent) {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      if (!dragId || target.dataset.id === dragId) return;
      const before = target.classList.contains('drop-before');
      const col = target.closest('.column') as HTMLElement | null;
      const targetStatus = col?.dataset.status || 'backlog';
      moveTask(dragId, target.dataset.id || null, before, targetStatus);
      clearDropHints();
    }

    root.querySelectorAll('.task-list').forEach(list => {
      const htmlList = list as HTMLElement;
      htmlList.addEventListener('dragover', e => {
        if (dragId) {
          e.preventDefault();
          htmlList.classList.add('drag-over');
        }
      });
      htmlList.addEventListener('dragleave', e => {
        if (e.target === htmlList) htmlList.classList.remove('drag-over');
      });
      htmlList.addEventListener('drop', e => {
        if (!dragId) return;
        if ((e.target as HTMLElement).closest('.task')) return;
        e.preventDefault();
        moveTask(dragId, null, false, htmlList.dataset.status || 'backlog');
        clearDropHints();
      });
    });

    async function moveTask(id: string, targetId: string | null, before: boolean, targetStatus: string) {
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const colSorted = tasks
        .filter(t => t.status === targetStatus && t.id !== id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      let insertAt = colSorted.length;
      if (targetId) {
        const idx = colSorted.findIndex(t => t.id === targetId);
        if (idx >= 0) insertAt = before ? idx : idx + 1;
      }
      const reordered = [...colSorted.slice(0, insertAt), { ...task, status: targetStatus }, ...colSorted.slice(insertAt)];

      for (let i = 0; i < reordered.length; i++) {
        const item = reordered[i];
        const updates: any = { order: i };
        if (item.id === id) {
          updates.status = targetStatus;
          if (targetStatus === 'complete') updates.progress = 100;
        }
        await updateTaskDoc(item.id, updates, item.id === id ? `Moved to ${targetStatus}` : undefined);
      }
    }

    // --- Modal Support & Subtasks ---
    function renderModalSupport(emails: string[], isEditable = true) {
      modalSupportEmails = [...emails];
      const container = byId('taskSupportContainer');
      if (!container) return;

      const team = getTeam();
      const leadSelect = byId<HTMLSelectElement>('taskLead');
      const currentLead = leadSelect ? leadSelect.value : '';

      const remainingCandidates = team.filter(
        email =>
          email.toLowerCase() !== currentLead.toLowerCase() &&
          !modalSupportEmails.some(se => se.toLowerCase() === email.toLowerCase())
      );

      const pillsHtml = modalSupportEmails
        .map(
          email => `
        <span class="support-pill">
          ${escapeHtml(getDisplayShort(email))}
          ${isEditable ? `<button type="button" class="remove-support-btn" data-email="${escapeHtml(email)}">×</button>` : ''}
        </span>
      `
        )
        .join('');

      const addDropdownHtml =
        isEditable && remainingCandidates.length > 0
          ? `<select class="add-support-select" style="font-size:12px; padding:2px 8px; max-width: 150px;">
              <option value="">+ Add Support</option>
              ${remainingCandidates.map(email => `<option value="${escapeHtml(email)}">${escapeHtml(getDisplayShort(email))}</option>`).join('')}
            </select>`
          : '';

      container.innerHTML = pillsHtml + addDropdownHtml;

      container.querySelectorAll('.remove-support-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const emailToRemove = (btn as HTMLElement).dataset.email || '';
          const updated = modalSupportEmails.filter(x => x.toLowerCase() !== emailToRemove.toLowerCase());
          renderModalSupport(updated, isEditable);
        });
      });

      const addSelect = container.querySelector('.add-support-select') as HTMLSelectElement | null;
      addSelect?.addEventListener('change', () => {
        if (addSelect.value) {
          modalSupportEmails.push(addSelect.value);
          renderModalSupport(modalSupportEmails, isEditable);
        }
      });
    }

    function renderModalSubtasks() {
      const container = byId('subtasksListContainer');
      if (!container) return;
      const team = getTeam();

      container.innerHTML = modalSubtasks
        .map(
          (s, index) => `
        <div class="subtask-container" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:8px;">
          <div class="subtask-row" style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" class="subtask-checkbox" ${s.completed ? 'checked' : ''} data-index="${index}">
            <input type="text" class="subtask-text-input ${s.completed ? 'completed' : ''}" value="${escapeHtml(s.title)}" data-index="${index}" placeholder="Subtask name..." style="flex:1;">
            <select class="subtask-assignee-select" data-index="${index}" style="font-size:11px; padding:2px 4px; max-width:120px;">
              <option value="">Assign...</option>
              ${team.map(email => `<option value="${escapeHtml(email)}" ${(s.assignee || '').toLowerCase() === email.toLowerCase() ? 'selected' : ''}>${escapeHtml(getDisplayShort(email))}</option>`).join('')}
            </select>
            <button type="button" class="delete-subtask-btn" data-index="${index}" title="Delete subtask">×</button>
          </div>
          <div style="padding-left: 24px; display:flex; align-items:center; gap:8px;">
            <input type="text" class="subtask-notes-input-modal" data-index="${index}" placeholder="Add notes to this subtask..." value="${escapeHtml(s.notes || '')}" style="flex:1; font-size:11px; padding:2px 4px; border:none; background:transparent; border-bottom:1px dashed var(--border); color:var(--text-muted);">
            <button type="button" class="subtask-date-btn" data-index="${index}" style="font-size: 10px; padding: 2px 6px;">
              📅 ${s.startDate || s.endDate ? `${s.startDate ? displayDate(s.startDate) : '—'} – ${s.endDate ? displayDate(s.endDate) : '—'}` : 'Set dates'}
            </button>
          </div>
        </div>
      `
        )
        .join('');

      const progressPct = byId('modalSubtaskProgress');
      if (progressPct) {
        if (modalSubtasks.length > 0) {
          const completed = modalSubtasks.filter(x => x.completed).length;
          progressPct.textContent = Math.round((completed / modalSubtasks.length) * 100) + '%';
        } else {
          progressPct.textContent = '0%';
        }
      }

      container.querySelectorAll('.subtask-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          const inputEl = cb as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          if (modalSubtasks[index]) {
            modalSubtasks[index].completed = inputEl.checked;
            renderModalSubtasks();
          }
        });
      });

      container.querySelectorAll('.subtask-text-input').forEach(input => {
        input.addEventListener('change', () => {
          const inputEl = input as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          if (modalSubtasks[index]) modalSubtasks[index].title = inputEl.value.trim();
        });
      });

      container.querySelectorAll('.subtask-assignee-select').forEach(sel => {
        sel.addEventListener('change', () => {
          const selEl = sel as HTMLSelectElement;
          const index = parseInt(selEl.dataset.index || '0', 10);
          if (modalSubtasks[index]) modalSubtasks[index].assignee = selEl.value;
        });
      });

      container.querySelectorAll('.subtask-notes-input-modal').forEach(input => {
        input.addEventListener('change', () => {
          const inputEl = input as HTMLInputElement;
          const index = parseInt(inputEl.dataset.index || '0', 10);
          if (modalSubtasks[index]) modalSubtasks[index].notes = inputEl.value.trim();
        });
      });

      container.querySelectorAll('.subtask-date-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const btnEl = btn as HTMLElement;
          const index = parseInt(btnEl.dataset.index || '0', 10);
          const subtask = modalSubtasks[index];
          if (subtask) {
            openDateRangePopover(null, index, btnEl, subtask.startDate, subtask.endDate);
          }
        });
      });

      container.querySelectorAll('.delete-subtask-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const index = parseInt((btn as HTMLElement).dataset.index || '0', 10);
          modalSubtasks.splice(index, 1);
          renderModalSubtasks();
        });
      });
    }

    function openModal(id: string | null = null, defaultLeadEmail = '') {
      editingId = id || null;
      const t = id ? tasks.find(x => x.id === id) : null;

      const modalTitle = byId('modalTitle');
      if (modalTitle) modalTitle.textContent = t ? 'Edit Deliverable' : 'New Deliverable';
      const titleInp = byId<HTMLInputElement>('taskTitle');
      if (titleInp) titleInp.value = t ? t.title : '';
      const detailsInp = byId<HTMLTextAreaElement>('taskDetails');
      if (detailsInp) detailsInp.value = t ? t.details || '' : '';

      const taskAppSelect = byId<HTMLSelectElement>('taskApp');
      if (taskAppSelect) {
        const apps = getApps();
        const currentProj = t ? t.app || '' : (byId<HTMLSelectElement>('appFilter')?.value !== '__all__' ? byId<HTMLSelectElement>('appFilter')?.value || '' : '');
        const allProjOptions = [...apps];
        if (currentProj && !allProjOptions.includes(currentProj)) allProjOptions.push(currentProj);
        allProjOptions.sort();

        taskAppSelect.innerHTML =
          '<option value="">(No project)</option>' +
          allProjOptions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('') +
          '<option value="__new__">+ New Project...</option>';
        taskAppSelect.value = currentProj;
        taskAppSelect.dataset.oldVal = currentProj;
      }

      const statusSel = byId<HTMLSelectElement>('taskStatus');
      if (statusSel) statusSel.value = t ? t.status : (currentView === 'tackboard' ? 'active' : 'backlog');
      const prioSel = byId<HTMLSelectElement>('taskPriority');
      if (prioSel) prioSel.value = t ? t.priority || 'medium' : 'medium';

      modalStartDate = t ? t.startDate || '' : '';
      modalEndDate = t ? t.endDate || '' : '';
      drMode = 'first';
      if (modalStartDate) {
        const [y, m] = modalStartDate.split('-').map(Number);
        calendarMonth = new Date(y, m - 1, 1);
      } else {
        const now = new Date();
        calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      renderCalendar();

      const parentAssignees = t ? (Array.isArray(t.assignees) ? t.assignees : []) : (defaultLeadEmail ? [defaultLeadEmail] : []);
      const leadEmail = parentAssignees[0] || '';
      const supportEmails = parentAssignees.slice(1);

      const leadSelect = byId<HTMLSelectElement>('taskLead');
      if (leadSelect) {
        const team = getTeam();
        leadSelect.innerHTML =
          '<option value="">Unassigned</option>' +
          team.map(email => `<option value="${escapeHtml(email)}">${escapeHtml(getDisplayName(email))}</option>`).join('');
        leadSelect.value = leadEmail;
      }

      renderModalSupport(supportEmails, true);

      modalSubtasks = t && Array.isArray(t.subtasks) ? JSON.parse(JSON.stringify(t.subtasks)) : [];
      renderModalSubtasks();

      const logField = byId('modalActivityLogField');
      const logContainer = byId('modalActivityLogContainer');
      if (logField && logContainer) {
        if (t && Array.isArray(t.activityLog) && t.activityLog.length > 0) {
          logField.style.display = 'block';
          logContainer.innerHTML = t.activityLog
            .slice()
            .reverse()
            .map(
              (log: any) => `
            <div class="activity-log-item" style="border-bottom: 1px solid var(--border); padding-bottom: 4px;">
              <div style="display:flex; justify-content:space-between; color:var(--muted); margin-bottom: 2px;">
                <span style="font-weight:600;">${escapeHtml(getDisplayShort(log.user))}</span>
                <span>${escapeHtml(fullTime(log.timestamp))}</span>
              </div>
              <div style="color:var(--text);">${escapeHtml(log.action)}</div>
            </div>
          `
            )
            .join('');
        } else {
          logField.style.display = 'none';
          logContainer.innerHTML = '';
        }
      }

      byId('modal')?.classList.add('open');
      setTimeout(() => byId('taskTitle')?.focus(), 50);
    }

    function closeModal() {
      byId('modal')?.classList.remove('open');
      editingId = null;
    }

    async function saveTask() {
      const title = byId<HTMLInputElement>('taskTitle')?.value.trim() || '';
      const details = byId<HTMLTextAreaElement>('taskDetails')?.value || '';
      const appName = byId<HTMLSelectElement>('taskApp')?.value.trim() || '';
      const status = byId<HTMLSelectElement>('taskStatus')?.value || 'backlog';
      const priority = byId<HTMLSelectElement>('taskPriority')?.value || 'medium';
      const startDate = modalStartDate || '';
      const endDate = modalEndDate || '';
      const leadVal = byId<HTMLSelectElement>('taskLead')?.value || '';
      const assignees = leadVal ? [leadVal, ...modalSupportEmails] : [...modalSupportEmails];

      if (!title) return toast('Deliverable title is required');
      if (startDate && endDate && startDate > endDate) {
        return toast('Start date must be on or before end date');
      }

      const existingTask = editingId ? tasks.find(x => x.id === editingId) : null;
      const existingProgress = existingTask ? Math.max(0, Math.min(100, Number(existingTask.progress) || 0)) : 0;
      let progress = status === 'complete' ? 100 : existingProgress;
      if (modalSubtasks.length > 0) {
        if (status === 'complete') {
          modalSubtasks.forEach(s => (s.completed = true));
          progress = 100;
        } else {
          const completed = modalSubtasks.filter(s => s.completed).length;
          progress = Math.round((completed / modalSubtasks.length) * 100);
        }
      }

      if (editingId) {
        const update: any = {
          title,
          details,
          app: appName,
          status,
          priority,
          assignees,
          startDate,
          endDate,
          progress,
          subtasks: modalSubtasks
        };
        await updateTaskDoc(editingId, update, 'Updated deliverable details');
      } else {
        const colCount = tasks.filter(x => x.status === status).length;
        const taskData = {
          title,
          details,
          app: appName,
          status,
          priority,
          assignees,
          startDate,
          endDate,
          progress,
          order: colCount,
          subtasks: modalSubtasks,
          createdAt: serverTimestamp(),
          createdBy: getCurrentUserEmail(),
          activityLog: [
            {
              user: getCurrentUserEmail(),
              timestamp: new Date().toISOString(),
              action: 'Created deliverable'
            }
          ]
        };
        await createTaskDoc(taskData);
      }
      closeModal();
      toast('Saved deliverable');
    }

    async function deleteTaskById(id: string) {
      if (!confirm('Delete this deliverable?')) return;
      tasks = tasks.filter(t => t.id !== id);
      persistLocalTasks();
      maybeRender();
      if (isFirebaseConfigured()) {
        try {
          await deleteDoc(doc(db, 'tasks', id));
        } catch (e) {
          console.warn('Delete task fallback:', e);
        }
      }
    }

    // --- Popovers ---
    function openProgressPopover(taskId: string, anchorEl: HTMLElement) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      progressPopoverTaskId = taskId;

      const popover = byId('progressPopover');
      const slider = byId<HTMLInputElement>('ppSlider');
      const valueEl = byId('ppValue');
      if (!popover || !slider || !valueEl) return;

      const current = progressOf(task);
      slider.value = String(current);
      valueEl.textContent = current + '%';

      const hasSubtasks = Boolean(task.subtasks && task.subtasks.length > 0);
      slider.disabled = hasSubtasks;
      popover.querySelectorAll('.pp-presets button').forEach(btn => ((btn as HTMLButtonElement).disabled = hasSubtasks));

      popover.classList.add('open');
      const aRect = anchorEl.getBoundingClientRect();
      popover.style.left = Math.max(12, Math.min(window.innerWidth - 230, aRect.left)) + 'px';
      popover.style.top = Math.min(window.innerHeight - 140, aRect.bottom + 6) + 'px';
    }

    function closeProgressPopover() {
      byId('progressPopover')?.classList.remove('open');
      progressPopoverTaskId = null;
      clearTimeout(progressSaveTimer);
    }

    async function saveProgress(taskId: string, raw: number) {
      const value = Math.max(0, Math.min(100, Math.round(Number(raw) / 5) * 5));
      await updateTaskDoc(taskId, { progress: value }, `Updated progress to ${value}%`);
    }

    function openSupportPopover(taskId: string, anchorEl: HTMLElement) {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const popover = byId('supportPopover');
      const listEl = byId('spList');
      if (!popover || !listEl) return;
      listEl.innerHTML = '';

      const parentAssignees = Array.isArray(task.assignees) ? task.assignees : [];
      const lead = parentAssignees[0] || '';
      const currentSupports = parentAssignees.slice(1).map((e: string) => e.toLowerCase());
      const supportOptions = getTeam().filter(email => email.toLowerCase() !== lead.toLowerCase());

      supportOptions.forEach(email => {
        const isChecked = currentSupports.includes(email.toLowerCase());
        const itemEl = document.createElement('label');
        itemEl.className = 'sp-item';
        itemEl.innerHTML = `
          <input type="checkbox" class="sp-checkbox" data-email="${escapeHtml(email)}" ${isChecked ? 'checked' : ''}>
          <span class="sp-label" title="${escapeHtml(getDisplayName(email))}">${escapeHtml(getDisplayShort(email))}</span>
        `;
        const checkbox = itemEl.querySelector('.sp-checkbox') as HTMLInputElement;
        checkbox.addEventListener('change', async () => {
          const curr = Array.isArray(task.assignees) ? [...task.assignees] : [];
          const l = curr[0] || '';
          let supports = curr.slice(1).map((e: string) => e.toLowerCase());
          if (checkbox.checked) {
            if (!supports.includes(email.toLowerCase())) supports.push(email.toLowerCase());
          } else {
            supports = supports.filter(e => e !== email.toLowerCase());
          }
          const nextAssignees = l ? [l, ...supports] : [...supports];
          await updateTaskDoc(taskId, { assignees: nextAssignees }, `Updated support assignees`);
        });
        listEl.appendChild(itemEl);
      });

      popover.classList.add('open');
      const aRect = anchorEl.getBoundingClientRect();
      popover.style.left = Math.max(12, Math.min(window.innerWidth - 230, aRect.left)) + 'px';
      popover.style.top = Math.min(window.innerHeight - 220, aRect.bottom + 6) + 'px';
    }

    function closeSupportPopover() {
      byId('supportPopover')?.classList.remove('open');
    }

    function openDateRangePopover(
      taskId: string | null,
      subtaskIndex: number | null,
      anchorEl: HTMLElement,
      initialStartDate?: string,
      initialEndDate?: string
    ) {
      drPopoverTaskId = taskId;
      drPopoverSubtaskIndex = subtaskIndex;
      drPopoverStartDate = initialStartDate || '';
      drPopoverEndDate = initialEndDate || '';
      drPopoverMode = 'first';

      const titleEl = byId('drPopoverTitle');
      if (titleEl) titleEl.textContent = subtaskIndex !== null ? 'Subtask Dates' : 'Task Dates';

      if (drPopoverStartDate) {
        const [y, m] = drPopoverStartDate.split('-').map(Number);
        drPopoverMonth = new Date(y, m - 1, 1);
      } else {
        drPopoverMonth = new Date();
      }

      renderDateRangePopoverCalendar();
      const popover = byId('dateRangePopover');
      if (!popover) return;
      popover.classList.add('open');
      const rect = anchorEl.getBoundingClientRect();
      popover.style.left = Math.max(12, Math.min(window.innerWidth - 290, rect.left)) + 'px';
      popover.style.top = Math.min(window.innerHeight - 330, rect.bottom + 4) + 'px';
    }

    function closeDateRangePopover() {
      byId('dateRangePopover')?.classList.remove('open');
      drPopoverTaskId = null;
      drPopoverSubtaskIndex = null;
    }

    function renderDateRangePopoverCalendar() {
      const cal = byId('drPopoverCalendar');
      if (!cal) return;

      const monthStart = new Date(drPopoverMonth.getFullYear(), drPopoverMonth.getMonth(), 1);
      const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      const startOfGrid = new Date(monthStart);
      startOfGrid.setDate(1 - monthStart.getDay());
      const today = todayLocal();
      const dows = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      const cells = [];

      for (let i = 0; i < 42; i++) {
        const d = new Date(startOfGrid);
        d.setDate(d.getDate() + i);
        const dStr = dateToStr(d);
        const otherMonth = d.getMonth() !== monthStart.getMonth();
        const isToday = isSameDay(d, today);
        const inRange = drPopoverStartDate && drPopoverEndDate && dStr >= drPopoverStartDate && dStr <= drPopoverEndDate;
        const isStart = !!drPopoverStartDate && dStr === drPopoverStartDate;
        const isEnd = !!drPopoverEndDate && dStr === drPopoverEndDate;
        const classes = ['dr-cell'];
        if (otherMonth) classes.push('other-month');
        if (isToday) classes.push('today');
        if (inRange) classes.push('in-range');
        if (isStart) classes.push('range-start');
        if (isEnd) classes.push('range-end');
        cells.push(`<div class="${classes.join(' ')}" data-date="${dStr}">${d.getDate()}</div>`);
      }

      cal.innerHTML = `
        <div class="dr-nav">
          <button type="button" id="drPopoverPrev">‹</button>
          <div class="dr-month-label">${escapeHtml(monthLabel)}</div>
          <button type="button" id="drPopoverNext">›</button>
        </div>
        <div class="dr-grid">
          ${dows.map(d => `<div class="dr-dow">${d}</div>`).join('')}
          ${cells.join('')}
        </div>
      `;

      const startEl = byId('drPopoverStartDisplay');
      const endEl = byId('drPopoverEndDisplay');
      if (startEl) startEl.textContent = drPopoverStartDate ? displayDate(drPopoverStartDate) : '— pick date —';
      if (endEl) endEl.textContent = drPopoverEndDate ? displayDate(drPopoverEndDate) : '— pick date —';

      byId('drPopoverPrev')?.addEventListener('click', () => {
        drPopoverMonth.setMonth(drPopoverMonth.getMonth() - 1);
        renderDateRangePopoverCalendar();
      });
      byId('drPopoverNext')?.addEventListener('click', () => {
        drPopoverMonth.setMonth(drPopoverMonth.getMonth() + 1);
        renderDateRangePopoverCalendar();
      });
      cal.querySelectorAll('.dr-cell').forEach(cell => {
        cell.addEventListener('click', async () => {
          const dateStr = (cell as HTMLElement).dataset.date || '';
          if (drPopoverMode === 'first') {
            drPopoverStartDate = dateStr;
            drPopoverEndDate = '';
            drPopoverMode = 'second';
            renderDateRangePopoverCalendar();
          } else {
            if (dateStr < drPopoverStartDate) {
              drPopoverEndDate = drPopoverStartDate;
              drPopoverStartDate = dateStr;
            } else {
              drPopoverEndDate = dateStr;
            }
            drPopoverMode = 'first';
            renderDateRangePopoverCalendar();
            await savePopoverDates(drPopoverTaskId, drPopoverSubtaskIndex, drPopoverStartDate, drPopoverEndDate);
          }
        });
      });
    }

    async function savePopoverDates(taskId: string | null, subtaskIndex: number | null, startD: string, endD: string) {
      if (!taskId && subtaskIndex !== null) {
        if (modalSubtasks[subtaskIndex]) {
          modalSubtasks[subtaskIndex].startDate = startD;
          modalSubtasks[subtaskIndex].endDate = endD;
          renderModalSubtasks();
        }
        return;
      }
      if (taskId && subtaskIndex !== null) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        const subtasksCopy = JSON.parse(JSON.stringify(task.subtasks || []));
        if (subtasksCopy[subtaskIndex]) {
          subtasksCopy[subtaskIndex].startDate = startD;
          subtasksCopy[subtaskIndex].endDate = endD;
          await updateTaskDoc(taskId, { subtasks: subtasksCopy }, 'Updated subtask dates');
        }
        return;
      }
      if (taskId && subtaskIndex === null) {
        await updateTaskDoc(taskId, { startDate: startD, endDate: endD }, 'Updated task dates');
      }
    }

    function updateBoardColumnsVisibility() {
      const chks = root.querySelectorAll('.col-visibility-chk');
      const states: Record<string, boolean> = {};
      let visibleCount = 0;

      chks.forEach(chk => {
        const inputEl = chk as HTMLInputElement;
        const status = inputEl.dataset.status || '';
        const isVisible = inputEl.checked;
        states[status] = isVisible;
        const col = root.querySelector(`main.ptb-board .column[data-status="${status}"]`) as HTMLElement | null;
        if (col) col.style.display = isVisible ? 'flex' : 'none';
        if (isVisible) visibleCount++;
      });

      localStorage.setItem('ptb_boardColsVisibility', JSON.stringify(states));
      const mainGrid = root.querySelector('main.ptb-board') as HTMLElement | null;
      if (mainGrid && visibleCount > 0) {
        mainGrid.style.gridTemplateColumns = `repeat(${visibleCount}, minmax(220px, 1fr))`;
      }
    }

    // --- Subscriptions to Clockwork's own Firestore ---
    function subscribe() {
      if (!isFirebaseConfigured()) {
        maybeRender();
        return;
      }
      unsubTasks = onSnapshot(
        collection(db, 'tasks'),
        snap => {
          if (!snap.empty) {
            tasks = snap.docs.map(d => {
              const t: any = { id: d.id, ...d.data() };
              if (t.status === 'todo') t.status = 'backlog';
              else if (t.status === 'progress') t.status = 'active';
              else if (t.status === 'done') t.status = t.progress === 100 ? 'complete' : 'review';
              if (Array.isArray(t.subtasks)) {
                t.subtasks.forEach((s: any, idx: number) => {
                  if (!s.id) s.id = 'sub-' + idx + '-' + (s.title || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
                });
              }
              return t;
            });
            persistLocalTasks();
          }
          maybeRender();
        },
        err => console.warn('Project tasks sync notice:', err.message)
      );

      unsubAccess = onSnapshot(
        doc(db, 'config', 'access'),
        snap => {
          if (snap.exists()) access = snap.data() as any;
          maybeRender();
        },
        () => {}
      );

      unsubProfiles = onSnapshot(
        collection(db, 'profiles'),
        snap => {
          snap.docs.forEach(d => {
            profiles[d.id.toLowerCase()] = { ...profiles[d.id.toLowerCase()], ...d.data() };
          });
          syncClockworkUsersIntoProfiles();
          maybeRender();
        },
        () => {}
      );

      const q = query(collection(db, 'notifications'), where('toEmail', '==', getCurrentUserEmail()));
      unsubNotifs = onSnapshot(
        q,
        snap => {
          notifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          notifications.sort((a, b) => (tsToMillis(b.createdAt) || Date.now()) - (tsToMillis(a.createdAt) || Date.now()));
          renderNotifications();
        },
        () => {}
      );
    }

    // --- Setup UI Listeners ---
    const savedTheme = localStorage.getItem('ptb_theme') || 'light';
    root.setAttribute('data-theme', savedTheme);
    const themeToggleBtn = byId('themeToggleBtn');
    const updateThemeIcon = (theme: string) => {
      if (!themeToggleBtn) return;
      themeToggleBtn.innerHTML =
        theme === 'light'
          ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`
          : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>`;
    };
    updateThemeIcon(savedTheme);
    themeToggleBtn?.addEventListener('click', () => {
      const curr = root.getAttribute('data-theme') || 'light';
      const next = curr === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      localStorage.setItem('ptb_theme', next);
      updateThemeIcon(next);
    });

    byId('addBtn')?.addEventListener('click', () => openModal());
    byId('saveBtn')?.addEventListener('click', saveTask);
    byId('cancelBtn')?.addEventListener('click', closeModal);
    byId('modal')?.addEventListener('click', e => {
      if ((e.target as HTMLElement).id === 'modal') closeModal();
    });

    // Subtask modal add handler
    const addSubBtn = byId('addSubtaskBtn');
    const newSubInp = byId<HTMLInputElement>('newSubtaskInput');
    const addModalSubtaskAction = () => {
      if (!newSubInp) return;
      const val = newSubInp.value.trim();
      if (!val) return;
      modalSubtasks.push({
        id: Math.random().toString(36).substring(2, 9),
        title: val,
        completed: false,
        notes: '',
        startDate: '',
        endDate: ''
      });
      newSubInp.value = '';
      renderModalSubtasks();
      newSubInp.focus();
    };
    addSubBtn?.addEventListener('click', addModalSubtaskAction);
    newSubInp?.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addModalSubtaskAction();
      }
    });

    byId<HTMLSelectElement>('taskApp')?.addEventListener('change', e => {
      const select = e.target as HTMLSelectElement;
      if (select.value === '__new__') {
        const name = prompt('Enter new project name:');
        if (name && name.trim()) {
          const trimmed = name.trim();
          const opt = document.createElement('option');
          opt.value = trimmed;
          opt.textContent = trimmed;
          select.insertBefore(opt, select.lastChild);
          select.value = trimmed;
          select.dataset.oldVal = trimmed;
        } else {
          select.value = select.dataset.oldVal || '';
        }
      } else {
        select.dataset.oldVal = select.value;
      }
    });

    byId<HTMLSelectElement>('taskLead')?.addEventListener('change', e => {
      const newLead = (e.target as HTMLSelectElement).value;
      const updatedSupport = modalSupportEmails.filter(x => x.toLowerCase() !== newLead.toLowerCase());
      renderModalSupport(updatedSupport, true);
    });

    byId('drClearBtn')?.addEventListener('click', () => {
      modalStartDate = '';
      modalEndDate = '';
      drMode = 'first';
      renderCalendar();
    });

    byId('drPopoverClearBtn')?.addEventListener('click', async () => {
      drPopoverStartDate = '';
      drPopoverEndDate = '';
      drPopoverMode = 'first';
      renderDateRangePopoverCalendar();
      await savePopoverDates(drPopoverTaskId, drPopoverSubtaskIndex, '', '');
    });

    byId('taskSearch')?.addEventListener('input', () => maybeRender());
    byId('appFilter')?.addEventListener('change', () => maybeRender());
    byId('assigneeFilter')?.addEventListener('change', () => maybeRender());
    byId('showArchivedFilter')?.addEventListener('change', () => maybeRender());

    // Board columns visibility
    const savedStatesStr = localStorage.getItem('ptb_boardColsVisibility');
    let savedStates: Record<string, boolean> = {};
    try {
      savedStates = savedStatesStr ? JSON.parse(savedStatesStr) : {};
    } catch (e) {}
    root.querySelectorAll('.col-visibility-chk').forEach(chk => {
      const inputEl = chk as HTMLInputElement;
      const status = inputEl.dataset.status || '';
      inputEl.checked = savedStates[status] !== false;
      inputEl.addEventListener('change', updateBoardColumnsVisibility);
    });

    const boardColsBtn = byId('boardColsBtn');
    const boardColsDropdown = byId('boardColsDropdown');
    boardColsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (!boardColsDropdown) return;
      boardColsDropdown.style.display = boardColsDropdown.style.display === 'flex' ? 'none' : 'flex';
    });

    // Progress slider handlers
    byId<HTMLInputElement>('ppSlider')?.addEventListener('input', e => {
      const val = (e.target as HTMLInputElement).value;
      const ppVal = byId('ppValue');
      if (ppVal) ppVal.textContent = val + '%';
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(() => {
        if (progressPopoverTaskId) saveProgress(progressPopoverTaskId, Number(val));
      }, 200);
    });
    root.querySelectorAll('#progressPopover .pp-presets button').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = Number((btn as HTMLElement).dataset.value);
        const slider = byId<HTMLInputElement>('ppSlider');
        const ppVal = byId('ppValue');
        if (slider) slider.value = String(v);
        if (ppVal) ppVal.textContent = v + '%';
        if (progressPopoverTaskId) saveProgress(progressPopoverTaskId, v);
      });
    });

    // View toggle buttons
    root.querySelectorAll('.view-toggle').forEach(btn => {
      btn.addEventListener('click', () => setView((btn as HTMLElement).dataset.view || 'board'));
    });

    byId('tlPrev')?.addEventListener('click', () => {
      timelineStart.setDate(timelineStart.getDate() - 7);
      renderTimeline();
    });
    byId('tlNext')?.addEventListener('click', () => {
      timelineStart.setDate(timelineStart.getDate() + 7);
      renderTimeline();
    });
    byId('tlToday')?.addEventListener('click', () => {
      timelineStart = getMondayOf(new Date());
      renderTimeline();
    });
    byId<HTMLInputElement>('timelineDatePicker')?.addEventListener('change', e => {
      const val = (e.target as HTMLInputElement).value;
      if (val) {
        const [year, month, day] = val.split('-').map(Number);
        timelineStart = getMondayOf(new Date(year, month - 1, day));
        renderTimeline();
      }
    });

    // Notifications UI
    const notifBtn = byId('notifBtn');
    const notifDropdown = byId('notifDropdown');
    notifBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (!notifDropdown) return;
      notifDropdown.style.display = notifDropdown.style.display === 'flex' ? 'none' : 'flex';
    });

    // Team Modal
    const renderTeamMembers = () => {
      const container = byId('teamMembersList');
      if (!container) return;
      container.innerHTML = tempTeam
        .map(
          (m, idx) => `
        <div class="team-member-row" style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 8px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
          <div style="font-size: 12px; word-break: break-all; color: var(--text-muted);">${escapeHtml(m.email)}</div>
          <input type="text" class="team-member-first" placeholder="First Name" data-index="${idx}" value="${escapeHtml(m.firstName || '')}">
          <input type="text" class="team-member-last" placeholder="Last Name" data-index="${idx}" value="${escapeHtml(m.lastName || '')}">
          <span style="font-size: 12px; color: var(--muted); text-transform: uppercase; font-weight: 600;">${escapeHtml(m.role || 'Staff')}</span>
        </div>
      `
        )
        .join('');
    };

    byId('teamBtn')?.addEventListener('click', () => {
      syncClockworkUsersIntoProfiles();
      tempTeam = getTeam().map(email => {
        const p = profiles[email] || {};
        return {
          email,
          role: p.role || 'editor',
          firstName: p.firstName || '',
          lastName: p.lastName || ''
        };
      });
      renderTeamMembers();
      byId('teamModal')?.classList.add('open');
    });
    byId('teamCancel')?.addEventListener('click', () => byId('teamModal')?.classList.remove('open'));
    byId('teamSave')?.addEventListener('click', () => {
      byId('teamModal')?.classList.remove('open');
      toast('Team synced with Clockwork staff');
    });

    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const pp = byId('progressPopover');
      if (pp && pp.classList.contains('open') && !pp.contains(target) && !target.closest('[data-action="progress"]')) {
        closeProgressPopover();
      }
      const sp = byId('supportPopover');
      if (sp && sp.classList.contains('open') && !sp.contains(target) && !target.closest('[data-action="edit-support"]')) {
        closeSupportPopover();
      }
      const sdp = byId('dateRangePopover');
      if (sdp && sdp.classList.contains('open') && !sdp.contains(target) && !target.closest('.subtask-date-btn') && !target.closest('[data-action="edit-cadence"]')) {
        closeDateRangePopover();
      }
      const tbMenu = byId('tbContextMenu');
      if (tbMenu && tbMenu.style.display !== 'none' && !tbMenu.contains(target) && !target.closest('.tb-task-item')) {
        hideTackboardContextMenu();
      }
      if (boardColsDropdown && boardColsDropdown.style.display === 'flex' && !boardColsDropdown.contains(target) && target !== boardColsBtn && !boardColsBtn?.contains(target)) {
        boardColsDropdown.style.display = 'none';
      }
      if (notifDropdown && notifDropdown.style.display === 'flex' && !notifDropdown.contains(target) && target !== notifBtn && !notifBtn?.contains(target)) {
        notifDropdown.style.display = 'none';
      }
    };

    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
        closeProgressPopover();
        closeSupportPopover();
        closeDateRangePopover();
        hideTackboardContextMenu();
        byId('teamModal')?.classList.remove('open');
      }
    };

    document.addEventListener('pointermove', onTimelinePointerMove);
    document.addEventListener('pointerup', onTimelinePointerUp);
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);

    syncClockworkUsersIntoProfiles();
    setView(currentView);
    subscribe();

    return () => {
      if (unsubTasks) unsubTasks();
      if (unsubAccess) unsubAccess();
      if (unsubProfiles) unsubProfiles();
      if (unsubNotifs) unsubNotifs();
      document.removeEventListener('pointermove', onTimelinePointerMove);
      document.removeEventListener('pointerup', onTimelinePointerUp);
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, []);

  return (
    <div className="ptb-root" ref={rootRef} data-theme="light">
      <header className="ptb-header">
        <h1>Project & Shift Planning</h1>
        <span id="modeBadge" className="mode-badge">Clockwork Native</span>

        <div className="search-wrapper">
          <input type="text" id="taskSearch" placeholder="Search tasks..." autoComplete="off" />
          <svg className="search-icon-svg" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>

        <div className="spacer"></div>

        <div className="filter-group">
          <label htmlFor="appFilter">Project</label>
          <select id="appFilter">
            <option value="__all__">All projects</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="assigneeFilter">Assigned to</label>
          <select id="assigneeFilter">
            <option value="__all__">Anyone</option>
            <option value="__me__">Me</option>
            <option value="__none__">Unassigned</option>
          </select>
        </div>

        <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" id="showArchivedFilter" style={{ margin: 0, cursor: 'pointer', width: '14px', height: '14px' }} />
          <label htmlFor="showArchivedFilter" style={{ cursor: 'pointer', userSelect: 'none' }}>Show Archived</label>
        </div>

        <div className="filter-group board-columns-toggle-container" style={{ position: 'relative' }}>
          <button type="button" id="boardColsBtn" className="ghost" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 500, padding: '6px 12px' }}>
            <span>Columns</span>
            <span style={{ fontSize: '8px', marginTop: '1px' }}>▼</span>
          </button>
          <div id="boardColsDropdown" style={{ display: 'none', position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', width: '180px', boxShadow: 'var(--shadow)', zIndex: 100, flexDirection: 'column', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" className="col-visibility-chk" data-status="backlog" defaultChecked /> Backlog
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" className="col-visibility-chk" data-status="ready" defaultChecked /> Ready to Start
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" className="col-visibility-chk" data-status="active" defaultChecked /> Active
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" className="col-visibility-chk" data-status="review" defaultChecked /> Review
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text)', cursor: 'pointer', margin: 0 }}>
              <input type="checkbox" className="col-visibility-chk" data-status="complete" defaultChecked /> Complete
            </label>
          </div>
        </div>

        <div className="view-toggle-group" id="viewToggleGroup">
          <button type="button" className="view-toggle" data-view="board">
            <span className="vt-label">Board</span>
          </button>
          <button type="button" className="view-toggle" data-view="list">
            <span className="vt-label">List</span>
          </button>
          <button type="button" className="view-toggle" data-view="timeline">
            <span className="vt-label">Timeline</span>
          </button>
          <button type="button" className="view-toggle active" data-view="tackboard">
            <span className="vt-label">Tac-Bored™</span>
          </button>
        </div>

        <div className="timeline-nav" id="timelineNav" style={{ display: 'none' }}>
          <button type="button" className="ghost" id="tlPrev" title="Previous week">‹</button>
          <button type="button" className="ghost" id="tlToday" title="Jump to today">Today</button>
          <button type="button" className="ghost" id="tlNext" title="Next week">›</button>
          <div className="timeline-picker-wrapper" title="Select a date to jump to">
            <span id="timelineRange"></span>
            <input type="date" id="timelineDatePicker" />
          </div>
        </div>

        <button type="button" id="addBtn" className="primary editor-only">+ New task</button>
        <button type="button" id="teamBtn" className="ghost admin-only" title="View Clockwork Team">Team</button>
        <div className="notif-wrapper">
          <button type="button" id="notifBtn" className="notif-btn" title="Notifications">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span id="notifBadge" className="notif-badge" style={{ display: 'none' }}></span>
          </button>
          <div id="notifDropdown" className="notif-dropdown">
            <div className="notif-header">
              <span>Notifications</span>
            </div>
            <div id="notifList" className="notif-list">
              <div className="notif-empty">No notifications</div>
            </div>
          </div>
        </div>
        <button type="button" id="themeToggleBtn" className="ghost" title="Toggle Light/Dark Mode"></button>
      </header>

      <main className="ptb-board" style={{ display: 'none' }}>
        <section className="column" data-status="backlog">
          <div className="col-header">
            <div className="col-title"><span className="status-dot backlog"></span>Backlog</div>
            <span className="col-count" data-count="backlog">0</span>
          </div>
          <ul className="task-list" data-status="backlog"></ul>
        </section>

        <section className="column" data-status="ready">
          <div className="col-header">
            <div className="col-title"><span className="status-dot ready"></span>Ready to Start</div>
            <span className="col-count" data-count="ready">0</span>
          </div>
          <ul className="task-list" data-status="ready"></ul>
        </section>

        <section className="column" data-status="active">
          <div className="col-header">
            <div className="col-title"><span className="status-dot active"></span>Active</div>
            <span className="col-count" data-count="active">0</span>
          </div>
          <ul className="task-list" data-status="active"></ul>
        </section>

        <section className="column" data-status="review">
          <div className="col-header">
            <div className="col-title"><span className="status-dot review"></span>Review</div>
            <span className="col-count" data-count="review">0</span>
          </div>
          <ul className="task-list" data-status="review"></ul>
        </section>

        <section className="column" data-status="complete">
          <div className="col-header">
            <div className="col-title"><span className="status-dot complete"></span>Complete</div>
            <span className="col-count" data-count="complete">0</span>
          </div>
          <ul className="task-list" data-status="complete"></ul>
        </section>
      </main>

      <section className="timeline-view" id="timelineView" style={{ display: 'none' }}>
        <div className="t-scroll">
          <div className="t-grid" id="timelineGrid"></div>
        </div>
      </section>

      <section className="list-view" id="listView" style={{ display: 'none' }}></section>
      <section className="tackboard-view" id="tackboardView"></section>

      {/* Task Modal */}
      <div className="modal-backdrop" id="modal">
        <div className="modal">
          <h2 id="modalTitle" style={{ marginTop: 0, marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>New Deliverable</h2>
          <div className="modal-body">
            <div className="modal-col-left">
              <div className="field">
                <label htmlFor="taskApp">Project / Department</label>
                <select id="taskApp" style={{ cursor: 'pointer' }}></select>
              </div>
              <div className="field">
                <label htmlFor="taskTitle">Deliverable</label>
                <input type="text" id="taskTitle" placeholder="What needs to happen?" autoComplete="off" />
              </div>
              <div className="field">
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Subtasks</span>
                  <span className="subtask-progress-pct" id="modalSubtaskProgress" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>0%</span>
                </label>
                <div id="subtasksListContainer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}></div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" id="newSubtaskInput" placeholder="+ Add a subtask" style={{ flex: 1 }} autoComplete="off" />
                  <button type="button" id="addSubtaskBtn" className="ghost" style={{ padding: '6px 12px', fontSize: '12px' }}>Add</button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="taskDetails">Details <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '11px' }}>(optional)</span></label>
                <textarea id="taskDetails" placeholder="Notes, requirements, links, context..." rows={4}></textarea>
              </div>
            </div>
            <div className="modal-col-right">
              <div className="field">
                <label htmlFor="taskStatus">Status</label>
                <select id="taskStatus" defaultValue="backlog">
                  <option value="backlog">Backlog</option>
                  <option value="ready">Ready to Start</option>
                  <option value="active">Active</option>
                  <option value="review">Review</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="taskPriority">Importance</label>
                <select id="taskPriority" defaultValue="medium">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div className="field">
                <label>Dates <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: '11px' }}>(optional)</span></label>
                <div className="daterange-display">
                  <div className="dr-pair">
                    <span className="dr-label">Start</span>
                    <span id="drStartDisplay" className="dr-value empty">— pick a date —</span>
                  </div>
                  <div className="dr-pair">
                    <span className="dr-label">End</span>
                    <span id="drEndDisplay" className="dr-value empty">— pick a date —</span>
                  </div>
                  <button type="button" className="dr-clear" id="drClearBtn">Clear</button>
                </div>
                <div className="daterange-cal" id="drCalendar"></div>
              </div>
              <div className="field">
                <label htmlFor="taskLead">Lead</label>
                <select id="taskLead" style={{ width: '100%', cursor: 'pointer' }}>
                  <option value="">Unassigned</option>
                </select>
              </div>
              <div className="field">
                <label style={{ marginBottom: '6px', display: 'block' }}>Support</label>
                <div id="taskSupportContainer" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', minHeight: '32px' }}></div>
              </div>
            </div>
          </div>
          <div className="field" id="modalActivityLogField" style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)', display: 'none' }}>
            <label style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>Activity Log</label>
            <div id="modalActivityLogContainer" style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '120px', overflowY: 'auto', fontSize: '11px', marginTop: '8px' }}></div>
          </div>
          <div className="modal-actions">
            <button type="button" id="cancelBtn" className="ghost">Cancel</button>
            <button type="button" id="saveBtn" className="primary">Save</button>
          </div>
        </div>
      </div>

      {/* Team Modal */}
      <div className="modal-backdrop" id="teamModal">
        <div className="modal" style={{ width: 'min(700px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ marginTop: 0, marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>Clockwork Team Roster</h2>
          <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px' }}>
            Automatically synced with your Clockwork staff members.
          </p>
          <div id="teamMembersList" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '8px', marginBottom: '16px' }}></div>
          <div className="modal-actions" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', marginTop: 'auto' }}>
            <button type="button" id="teamCancel" className="ghost">Close</button>
            <button type="button" id="teamSave" className="primary">Done</button>
          </div>
        </div>
      </div>

      {/* Progress quick-edit popover */}
      <div className="progress-popover" id="progressPopover">
        <div className="pp-header">
          <span className="pp-title">Progress</span>
          <span className="pp-value" id="ppValue">0%</span>
        </div>
        <input type="range" className="progress-slider" id="ppSlider" min="0" max="100" step="5" defaultValue="0" />
        <div className="pp-presets">
          <button type="button" data-value="0">0%</button>
          <button type="button" data-value="25">25%</button>
          <button type="button" data-value="50">50%</button>
          <button type="button" data-value="75">75%</button>
          <button type="button" data-value="100">100%</button>
        </div>
      </div>

      {/* Support quick-edit popover */}
      <div className="support-popover" id="supportPopover">
        <div className="sp-list" id="spList"></div>
      </div>

      {/* Date Range Picker Popover */}
      <div className="date-range-popover" id="dateRangePopover">
        <div className="daterange-display" style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', width: '100%' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text)' }} id="drPopoverTitle">Dates</span>
            <button type="button" className="dr-clear" id="drPopoverClearBtn" style={{ fontSize: '10px', padding: '2px 6px' }}>Clear</button>
          </div>
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <div className="dr-pair" style={{ flex: 1 }}>
              <span className="dr-label" style={{ fontSize: '9px' }}>Start</span>
              <span id="drPopoverStartDisplay" className="dr-value empty" style={{ fontSize: '11px', padding: '4px' }}>— pick date —</span>
            </div>
            <div className="dr-pair" style={{ flex: 1 }}>
              <span className="dr-label" style={{ fontSize: '9px' }}>End</span>
              <span id="drPopoverEndDisplay" className="dr-value empty" style={{ fontSize: '11px', padding: '4px' }}>— pick date —</span>
            </div>
          </div>
        </div>
        <div className="daterange-cal" id="drPopoverCalendar" style={{ padding: '10px' }}></div>
      </div>

      <div className="toast" id="toast"></div>
      <div id="tbContextMenu" className="tb-context-menu" style={{ display: 'none', position: 'fixed', zIndex: 10000 }}></div>
    </div>
  );
};
