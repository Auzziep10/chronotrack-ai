import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Smartphone, LayoutGrid, Clock, AlertCircle, Wand2, Mic, CheckCircle, Trash2, Plus, Send, X, Users, Save, Copy, Zap, MapPin, Search, ShoppingBag } from 'lucide-react';
import { User, DailySchedule, ScheduleBlock, Department, QuickTask } from '../types';
import { subscribeToShiftBlocks, firebaseSaveShiftBlock, firebaseDeleteShiftBlock, subscribeToQuickTasks, firebaseSaveQuickTask, firebaseDeleteQuickTask, subscribeToProductionOrders, subscribeToCustomers } from '../services/firebaseService';
import { processExternalPlan } from '../services/geminiService';
import { ShiftCalendarViews } from './ShiftCalendarViews';

interface Props {
    users: User[];
    currentUser: User | null;
}

const START_HOUR = 6; // 6 AM
const END_HOUR = 20; // 8 PM
const TOTAL_HOURS = END_HOUR - START_HOUR;

// Colors matching the screenshot (approximate)
const STATUS_COLORS = {
    active: 'bg-green-500 text-white border-green-600',
    pending: 'bg-yellow-500 text-yellow-950 border-yellow-600', // "Not Started" / "Print 1..."
    completed: 'bg-zinc-500 text-white border-zinc-600',
    delayed: 'bg-red-500 text-white border-red-600',
    order: 'bg-purple-600 text-white border-purple-700',
    default: 'bg-yellow-500 text-yellow-950 border-yellow-600'
};

const STATUS_LABELS = {
    active: 'Active',
    pending: 'Not Started',
    completed: 'Complete',
    delayed: "Can't Start",
    order: 'Orders'
};

export const DailyPlanner: React.FC<Props> = ({ users, currentUser }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Planning Mode State
    const [isPlanningMode, setIsPlanningMode] = useState(false);
    const [activeView, setActiveView] = useState<'tasks' | 'shifts'>('tasks');
    const [transcript, setTranscript] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [unassignedBlocks, setUnassignedBlocks] = useState<any[]>([]);

    // Shift Schedule Timeframe
    const [shiftTimeframe, setShiftTimeframe] = useState<'day' | 'week' | 'month'>('day');

    // Shift Form State
    const [shiftUser, setShiftUser] = useState('');
    const [shiftStart, setShiftStart] = useState('09:00');
    const [shiftEnd, setShiftEnd] = useState('17:00');

    // Duplicate State
    const [isDuplicating, setIsDuplicating] = useState(false);
    const [duplicateTargetDate, setDuplicateTargetDate] = useState('');
    const [duplicateWholeWeek, setDuplicateWholeWeek] = useState(false);

    // Edit Block State
    const [editingBlock, setEditingBlock] = useState<ScheduleBlock | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editStart, setEditStart] = useState('');
    const [editEnd, setEditEnd] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editDepartment, setEditDepartment] = useState<Department | ''>('');
    const [isUpdating, setIsUpdating] = useState(false);

    // Drag & Drop State
    const timelineRef = React.useRef<HTMLDivElement>(null);
    const [dragState, setDragState] = useState<{
        block: ScheduleBlock;
        type: 'move' | 'resize';
        startX: number;
        originalStart: Date;
        originalEnd: Date;
    } | null>(null);
    const [previewBlock, setPreviewBlock] = useState<ScheduleBlock | null>(null);

    // Shift Blocks State (From Firebase)
    const [shiftBlocks, setShiftBlocks] = useState<ScheduleBlock[]>([]);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, userId: string, hour: number } | null>(null);

    // Close context menu on any click
    useEffect(() => {
        const handleClick = () => {
            setContextMenu(null);
            setQtActiveDropdown(null);
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    // Quick Tasks State
    const [showQuickTasks, setShowQuickTasks] = useState(false);
    const [quickTasks, setQuickTasks] = useState<QuickTask[]>([]);

    useEffect(() => {
        const unsubscribe = subscribeToQuickTasks(async (tasks) => {
            if (tasks.length === 0) {
                // Migrate tasks from local storage if any
                try {
                    const saved = localStorage.getItem('quickTasks');
                    if (saved) {
                        const localTasks = JSON.parse(saved) as QuickTask[];
                        if (localTasks.length > 0) {
                            for (const t of localTasks) {
                                await firebaseSaveQuickTask(t);
                            }
                            localStorage.removeItem('quickTasks');
                        }
                    }
                } catch (e) {
                    console.error("Failed to migrate local quick tasks:", e);
                }
            }
            setQuickTasks(tasks);
        });
        return () => unsubscribe();
    }, []);

    // Orders Integration State
    const [showOrdersDialog, setShowOrdersDialog] = useState(false);
    const [productionOrders, setProductionOrders] = useState<any[]>([]);
    const [customers, setCustomers] = useState<Record<string, any>>({});
    const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
    const [orderStartTime, setOrderStartTime] = useState('09:00');
    const [orderDuration, setOrderDuration] = useState('120');
    const [orderSelectedUsers, setOrderSelectedUsers] = useState<string[]>([]);
    const [orderSearchQuery, setOrderSearchQuery] = useState('');
    const [orderListSearchQuery, setOrderListSearchQuery] = useState('');

    useEffect(() => {
        const unsubscribeOrders = subscribeToProductionOrders((orders) => {
            setProductionOrders(orders);
        });
        const unsubscribeCustomers = subscribeToCustomers((custs) => {
            setCustomers(custs);
        });
        return () => {
            unsubscribeOrders();
            unsubscribeCustomers();
        };
    }, []);

    const [qtNewTitle, setQtNewTitle] = useState('');
    const [qtNewDuration, setQtNewDuration] = useState('60');
    const [qtNewLocation, setQtNewLocation] = useState('');
    const [qtLocationFilter, setQtLocationFilter] = useState<string | null>(null);
    const [qtSelectedTask, setQtSelectedTask] = useState<string | null>(null);
    const [qtSelectedUsers, setQtSelectedUsers] = useState<string[]>([]);
    const [qtStartTime, setQtStartTime] = useState('09:00');
    const [qtSearchQuery, setQtSearchQuery] = useState('');
    const [qtActiveDropdown, setQtActiveDropdown] = useState<string | null>(null);
    const [qtDropdownInput, setQtDropdownInput] = useState('');

    const uniqueLocations = Array.from(new Set(quickTasks.flatMap(t => t.locations || (t.location ? [t.location] : [])).filter(Boolean))) as string[];
    const filteredQuickTasks = qtLocationFilter ? quickTasks.filter(t => {
        const locs = t.locations || (t.location ? [t.location] : []);
        return locs.includes(qtLocationFilter);
    }) : quickTasks;

    const handleAddQuickTaskDef = async () => {
        if (!qtNewTitle.trim()) return;
        const newLocs = qtNewLocation.trim() ? qtNewLocation.split(',').map(s => s.trim()).filter(Boolean) : [];
        await firebaseSaveQuickTask({
            id: Date.now().toString(),
            title: qtNewTitle,
            duration: parseInt(qtNewDuration) || 60,
            locations: newLocs
        });
        setQtNewTitle('');
    };

    const handleAddSpecificLocationToTask = async (taskId: string, newLoc: string) => {
        if (!newLoc || !newLoc.trim()) return;
        const task = quickTasks.find(t => t.id === taskId);
        if (!task) return;
        const locs = task.locations || (task.location ? [task.location] : []);
        if (!locs.includes(newLoc.trim())) {
            await firebaseSaveQuickTask({
                ...task,
                locations: [...locs, newLoc.trim()]
            });
        }
    };

    const handleRemoveLocationFromTask = async (taskId: string, locToRemove: string) => {
        const task = quickTasks.find(t => t.id === taskId);
        if (!task) return;
        const locs = task.locations || (task.location ? [task.location] : []);
        await firebaseSaveQuickTask({
            ...task,
            locations: locs.filter(l => l !== locToRemove)
        });
    };

    const handleDeleteQuickTaskDef = async (id: string) => {
        await firebaseDeleteQuickTask(id);
        if (qtSelectedTask === id) setQtSelectedTask(null);
    };

    const handleAssignQuickTask = async () => {
        const taskDef = quickTasks.find(t => t.id === qtSelectedTask);
        if (!taskDef || qtSelectedUsers.length === 0) return;

        try {
            setLoading(true);
            for (const userId of qtSelectedUsers) {
                const startDateTime = new Date(currentDate);
                const [sh, sm] = qtStartTime.split(':').map(Number);
                startDateTime.setHours(sh, sm, 0, 0);

                const endDateTime = new Date(startDateTime.getTime() + taskDef.duration * 60000);

                await firebaseSaveShiftBlock({
                    id: `task-${Date.now()}-${userId}-${Math.random()}`,
                    title: taskDef.title,
                    description: (() => {
                        const locs = taskDef.locations || (taskDef.location ? [taskDef.location] : []);
                        return locs.length > 0 ? `Locations: ${locs.join(', ')}\nQuick Task` : 'Quick Task';
                    })(),
                    startTime: startDateTime.toISOString(),
                    endTime: endDateTime.toISOString(),
                    assignedTo: userId,
                    status: 'pending',
                    priority: 'medium'
                });
            }
            setShowQuickTasks(false);
            setQtSelectedTask(null);
            setQtSelectedUsers([]);
            setQtSearchQuery('');
        } catch (err) {
            alert("Failed to assign quick tasks");
        } finally {
            setLoading(false);
        }
    };

    const handleAssignOrderTask = async () => {
        const order = productionOrders.find(o => o.id === selectedOrder);
        if (!order || orderSelectedUsers.length === 0) return;

        const customer = customers[order.customerId];
        const customerName = customer ? (customer.company || customer.name) : (order.customerId || 'Unknown Customer');
        
        // Sum items
        const totalItems = order.items?.reduce((acc: number, i: any) => acc + (i.qty || 0), 0) || 0;

        // Build item descriptions
        const itemDescriptions = order.items?.map((i: any) => {
            let desc = `- ${i.qty || 0}x ${i.name || i.title || 'Item'}`;
            if (i.sizes && Object.keys(i.sizes).length > 0) {
                const sizesStr = Object.entries(i.sizes).map(([sz, q]) => `${sz}: ${q}`).join(', ');
                desc += ` (${sizesStr})`;
            }
            return desc;
        }).join('\n') || '';

        try {
            setLoading(true);
            for (const userId of orderSelectedUsers) {
                const startDateTime = new Date(currentDate);
                const [sh, sm] = orderStartTime.split(':').map(Number);
                startDateTime.setHours(sh, sm, 0, 0);

                const endDateTime = new Date(startDateTime.getTime() + (parseInt(orderDuration) || 120) * 60000);

                await firebaseSaveShiftBlock({
                    id: `task-${Date.now()}-${userId}-${Math.random()}`,
                    title: `Order #${order.portalId || order.id.slice(0, 6)}: ${order.title || 'Untitled Order'}`,
                    description: `Customer: ${customerName}\nItems:\n${itemDescriptions}\nDue Date: ${order.date || 'N/A'}\nTotal Items: ${totalItems}\nQuick Order Task`,
                    startTime: startDateTime.toISOString(),
                    endTime: endDateTime.toISOString(),
                    assignedTo: userId,
                    status: 'pending',
                    priority: 'medium',
                    department: Department.Production
                });
            }
            setShowOrdersDialog(false);
            setSelectedOrder(null);
            setOrderSelectedUsers([]);
            setOrderSearchQuery('');
            setOrderListSearchQuery('');
        } catch (err) {
            alert("Failed to assign order tasks");
        } finally {
            setLoading(false);
        }
    };

    const currentPerms = (() => {
        let perms: string[] = [];
        if (currentUser) {
            const rawPerms = currentUser.permissions as any;
            if (Array.isArray(rawPerms)) perms = rawPerms;
            else if (typeof rawPerms === 'string') perms = rawPerms.split(',').map((s: string) => s.trim());
        }
        return perms;
    })();

    const hasAdmin = currentPerms.includes('admin') || currentUser?.role?.toLowerCase() === 'admin';
    const canManageSchedule = (hasAdmin || currentPerms.includes('manage_schedule') || currentPerms.includes('manage_team') || (currentUser?.role?.toLowerCase() === 'manager' && currentPerms.length === 0)) && currentUser?.username?.toLowerCase() !== 'warehouse';
    const canCreateTasks = (hasAdmin || currentPerms.includes('create_tasks') || currentPerms.includes('manage_schedule') || currentPerms.includes('manage_team') || (currentUser?.role?.toLowerCase() === 'manager' && currentPerms.length === 0)) && currentUser?.username?.toLowerCase() !== 'warehouse';

    const isAdminOrManager = canManageSchedule;

    // Time marker for current time
    const [currentTimePercentage, setCurrentTimePercentage] = useState<number | null>(null);

    useEffect(() => {
        // Update current time line every minute
        const updateTimeLine = () => {
            const now = new Date();
            const currentHour = now.getHours() + now.getMinutes() / 60;
            if (currentHour >= START_HOUR && currentHour <= END_HOUR) {
                const percentage = ((currentHour - START_HOUR) / TOTAL_HOURS) * 100;
                setCurrentTimePercentage(percentage);
            } else {
                setCurrentTimePercentage(null);
            }
        };

        updateTimeLine();
        const interval = setInterval(updateTimeLine, 60000);
        return () => clearInterval(interval);
    }, []);

    // Handle Dragging and Resizing
    useEffect(() => {
        if (!dragState) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!timelineRef.current) return;
            const timelineWidth = timelineRef.current.getBoundingClientRect().width;
            
            const deltaX = e.clientX - dragState.startX;
            const deltaHours = (deltaX / timelineWidth) * TOTAL_HOURS;
            const deltaMs = deltaHours * 60 * 60 * 1000;
            
            // Snap to 15-minute intervals (15 * 60 * 1000 = 900000 ms)
            const snapMs = 15 * 60 * 1000;

            if (dragState.type === 'move') {
                const newStartMs = Math.round((dragState.originalStart.getTime() + deltaMs) / snapMs) * snapMs;
                const duration = dragState.originalEnd.getTime() - dragState.originalStart.getTime();
                const newEndMs = newStartMs + duration;
                
                setPreviewBlock({
                    ...dragState.block,
                    startTime: new Date(newStartMs).toISOString(),
                    endTime: new Date(newEndMs).toISOString()
                });
            } else if (dragState.type === 'resize') {
                const newEndMs = Math.round((dragState.originalEnd.getTime() + deltaMs) / snapMs) * snapMs;
                // Ensure it's at least 15 minutes long
                if (newEndMs > dragState.originalStart.getTime()) {
                    setPreviewBlock({
                        ...dragState.block,
                        endTime: new Date(newEndMs).toISOString()
                    });
                }
            }
        };

        const handleMouseUp = async () => {
            if (previewBlock) {
                try {
                    await firebaseSaveShiftBlock(previewBlock);
                } catch (err) {
                    console.error("Failed to save dragged block", err);
                }
            }
            setDragState(null);
            setPreviewBlock(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, previewBlock]);

    useEffect(() => {
        // Subscribe to shifts purely from Firebase and actively trim duplicates
        const unsubscribe = subscribeToShiftBlocks((blocks: any[]) => {
            const seen = new Set<string>();
            const uniqueBlocks: ScheduleBlock[] = [];
            const toDelete: string[] = [];

            blocks.forEach(b => {
                const key = `${b.title}-${b.assignedTo}-${b.startTime}-${b.endTime}`;
                if (seen.has(key)) {
                    toDelete.push(b.id);
                } else {
                    seen.add(key);
                    uniqueBlocks.push(b as ScheduleBlock);
                }
            });

            // Automatically clean up any duplicate entries exactly overlapping
            toDelete.forEach(id => {
                firebaseDeleteShiftBlock(id).catch(() => { });
            });

            setShiftBlocks(uniqueBlocks);
        });
        return () => unsubscribe();
    }, []);

    // fetchSchedule removed - standalone uses shiftBlocks directly

    const handlePrevDay = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() - 1);
        setCurrentDate(newDate);
    };

    const handleNextDay = () => {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + 1);
        setCurrentDate(newDate);
    };

    const handleGenerateAI = async () => {
        if (!transcript.trim()) return;
        setIsGenerating(true);
        try {
            const resultStr = await processExternalPlan(transcript);
            let tasks;
            try {
                tasks = JSON.parse(resultStr);
            } catch (e) {
                // Sometimes Gemini returns JSON wrapped in markdown even after our regex in the service
                const cleaned = resultStr.replace(/```json/g, '').replace(/```/g, '').trim();
                tasks = JSON.parse(cleaned);
            }
            
            if (tasks && typeof tasks === 'object' && 'error' in tasks) {
                throw new Error(tasks.error);
            }

            if (!Array.isArray(tasks)) {
                throw new Error("Parsed result is not an array");
            }

            const newUnassigned: any[] = [];
            let autoAssigned = 0;

            const currentTeamMembers = users.filter(u => u.role?.trim().toLowerCase() !== 'client' && u.username);

            for (const task of tasks) {
                // Find matching user (fuzzy match name)
                const targetName = (task.assignedToName || '').toLowerCase();
                const user = currentTeamMembers.find(u => 
                    targetName && (
                        u.name.toLowerCase().includes(targetName) || 
                        (u.username && u.username.toLowerCase().includes(targetName)) ||
                        targetName.includes(u.name.toLowerCase()) ||
                        (u.username && targetName.includes(u.username.toLowerCase()))
                    )
                );

                const tStart = new Date(currentDate);
                const tEnd = new Date(currentDate);
                
                if (task.startTime || task.endTime) {
                    if (task.startTime) {
                        const [sh, sm] = task.startTime.split(':').map(Number);
                        tStart.setHours(sh, sm || 0, 0, 0);
                    } else if (task.endTime) {
                        const [eh, em] = task.endTime.split(':').map(Number);
                        tStart.setHours(eh - 1, em || 0, 0, 0);
                    }
                    
                    if (task.endTime) {
                        const [eh, em] = task.endTime.split(':').map(Number);
                        tEnd.setHours(eh, em || 0, 0, 0);
                    } else {
                        tEnd.setTime(tStart.getTime() + 60 * 60 * 1000);
                    }
                } else {
                    // Default to right now, rounded to the nearest half hour
                    const now = new Date();
                    const currentHour = now.getHours();
                    const currentMinute = now.getMinutes();
                    const roundedMinute = currentMinute < 30 ? 30 : 0;
                    const roundedHour = currentMinute < 30 ? currentHour : currentHour + 1;
                    
                    tStart.setHours(roundedHour, roundedMinute, 0, 0);
                    tEnd.setHours(roundedHour + 1, roundedMinute, 0, 0); // 1 hour duration default
                }

                const blockData = {
                    title: task.title || 'AI Task',
                    description: task.description || '',
                    department: task.department || undefined,
                    startTime: tStart.toISOString(),
                    endTime: tEnd.toISOString(),
                    status: 'pending',
                    priority: 'medium'
                };

                if (user) {
                    await firebaseSaveShiftBlock({
                        ...blockData,
                        assignedTo: user.id
                    });
                    autoAssigned++;
                } else {
                    newUnassigned.push({
                        ...blockData,
                        tempId: `temp-${Date.now()}-${Math.random()}`,
                        suggestedName: task.assignedToName || 'Unknown'
                    });
                }
            }

            setUnassignedBlocks(prev => [...prev, ...newUnassigned]);
            setTranscript('');
            alert(`AI Generation Complete! Auto-assigned ${autoAssigned} tasks. ${newUnassigned.length > 0 ? `${newUnassigned.length} tasks need manual assignment.` : ''}`);
        } catch (err: any) {
            console.error("AI Generation failed:", err);
            const msg = err?.message || String(err);
            if (msg.includes("leaked") || msg.includes("API key") || msg.includes("PLACEHOLDER") || msg.includes("API_KEY") || msg.includes("unauthorized")) {
                alert("⚠️ AI Schedule Generator: The Gemini API key is missing or has been disabled. Please configure VITE_GEMINI_API_KEY in your environment variables (.env.local or Vercel dashboard).");
            } else {
                alert("Failed to parse schedule from text. Please ensure it contains recognizable names and times.");
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDuplicateSchedule = async () => {
        const todayBlocks = shiftBlocks.filter((b) => {
            const bDate = new Date(b.startTime);
            return bDate.getDate() === currentDate.getDate() && bDate.getMonth() === currentDate.getMonth() && bDate.getFullYear() === currentDate.getFullYear();
        });

        const todayShifts = todayBlocks.filter(b => b.title.startsWith('[SHIFT]'));
        const todayTasks = todayBlocks.filter(b => !b.title.startsWith('[SHIFT]'));

        const hasTasks = todayTasks.length > 0;
        const hasShifts = todayShifts.length > 0;

        if (!duplicateTargetDate) return;
        if (activeView === 'shifts' && !hasShifts) {
            alert("No shifts to duplicate today.");
            return;
        }
        if (activeView === 'tasks' && !hasTasks) {
            alert("No tasks to duplicate today.");
            return;
        }

        if (!confirm(`Are you sure you want to copy today's entire ${activeView === 'shifts' ? 'shift schedule' : 'task schedule'} to ${duplicateWholeWeek ? 'the entire work week' : duplicateTargetDate}?`)) return;

        try {
            setLoading(true);

            const [y, m, d] = duplicateTargetDate.split('-');
            const targetDateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0);

            // Determine target dates
            const targetDates: Date[] = [];
            if (duplicateWholeWeek) {
                // Find Monday of the week for the selected date
                const day = targetDateObj.getDay();
                const diffToMonday = targetDateObj.getDate() - day + (day === 0 ? -6 : 1);

                for (let i = 0; i < 5; i++) {
                    const nextDate = new Date(targetDateObj);
                    nextDate.setDate(diffToMonday + i);
                    nextDate.setHours(12, 0, 0, 0);
                    targetDates.push(nextDate);
                }
            } else {
                targetDates.push(targetDateObj);
            }

            let totalCopies = 0;

            for (const tDate of targetDates) {
                const blocksToCopy = activeView === 'shifts' ? todayShifts : todayTasks;
                
                for (const block of blocksToCopy) {
                    const bStart = new Date(block.startTime);
                    const bEnd = new Date(block.endTime);
                    const newStart = new Date(tDate);
                    newStart.setHours(bStart.getHours(), bStart.getMinutes(), 0, 0);
                    const newEnd = new Date(tDate);
                    newEnd.setHours(bEnd.getHours(), bEnd.getMinutes(), 0, 0);

                    // Skip duplicating if they already have this exact block
                    const exists = shiftBlocks.some(b =>
                        b.title === block.title &&
                        b.assignedTo === block.assignedTo &&
                        new Date(b.startTime).getTime() === newStart.getTime() &&
                        new Date(b.endTime).getTime() === newEnd.getTime()
                    );

                    if (!exists) {
                        await firebaseSaveShiftBlock({
                            title: block.title,
                            description: block.description || '',
                            startTime: newStart.toISOString(),
                            endTime: newEnd.toISOString(),
                            assignedTo: block.assignedTo,
                            status: 'pending',
                            priority: block.priority || 'medium'
                        });
                        totalCopies++;
                    }
                }
            }

            alert(`Successfully duplicated ${totalCopies} blocks!`);
            setIsDuplicating(false);
            setDuplicateTargetDate('');
            setDuplicateWholeWeek(false);
        } catch (err) {
            console.error("Failed to duplicate schedule:", err);
            alert("Failed to duplicate schedule. Ensure you are connected.");
        } finally {
            setLoading(false);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, userId: string) => {
        if (!isAdminOrManager) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const rawHour = START_HOUR + (percentage * TOTAL_HOURS);
        const hour = Math.round(rawHour * 2) / 2; // nearest 30 mins
        setContextMenu({ x: e.clientX, y: e.clientY, userId, hour });
    };

    const handleContextMenuAdd = () => {
        if (!contextMenu) return;
        
        const sh = Math.floor(contextMenu.hour);
        const sm = contextMenu.hour % 1 === 0 ? '00' : '30';
        
        const eh = Math.floor(contextMenu.hour + 1);
        const em = sm;
        
        const tempStart = new Date(currentDate);
        tempStart.setHours(sh, sm === '30' ? 30 : 0, 0, 0);
        
        const tempEnd = new Date(currentDate);
        tempEnd.setHours(eh, em === '30' ? 30 : 0, 0, 0);

        setEditingBlock({
            id: `new-${activeView}-${Date.now()}`,
            title: activeView === 'shifts' ? '[SHIFT] Scheduled' : 'New Task',
            description: activeView === 'shifts' ? 'Total Hours Scheduled' : '',
            startTime: tempStart.toISOString(),
            endTime: tempEnd.toISOString(),
            assignedTo: contextMenu.userId,
            status: 'pending',
            priority: 'medium'
        });
        
        const startStr = `${String(sh).padStart(2, '0')}:${sm}`;
        const endStr = `${String(eh).padStart(2, '0')}:${em}`;
        
        setEditTitle(activeView === 'shifts' ? '[SHIFT] Scheduled' : 'New Task');
        setEditStart(startStr);
        setEditEnd(endStr);
        setEditNotes('');
        setEditDepartment('');
        setContextMenu(null);
    };

    const handleBlockClick = (block: ScheduleBlock) => {
        if (!isAdminOrManager) return;
        setEditingBlock(block);

        setEditTitle(block.title);
        const start = new Date(block.startTime);
        setEditStart(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);

        const end = new Date(block.endTime);
        setEditEnd(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);

        setEditNotes(block.description || '');
        setEditDepartment(block.department || '');
    };

    const handleSaveEdit = async () => {
        if (!editingBlock) return;
        setIsUpdating(true);
        try {
            const bStart = new Date(editingBlock.startTime);
            const [sh, sm] = editStart.split(':').map(Number);
            bStart.setHours(sh, sm, 0, 0);

            const bEnd = new Date(editingBlock.endTime);
            const [eh, em] = editEnd.split(':').map(Number);
            bEnd.setHours(eh, em, 0, 0);

            const blockData = {
                title: editTitle,
                description: editNotes,
                department: editDepartment || undefined,
                startTime: bStart.toISOString(),
                endTime: bEnd.toISOString(),
                assignedTo: editingBlock.assignedTo,
                status: editingBlock.status,
                priority: editingBlock.priority || 'medium'
            };

            await firebaseSaveShiftBlock({ ...blockData, id: editingBlock.id });
            setEditingBlock(null);
        } catch (err) {
            alert("Failed to update schedule block.");
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePublish = async () => {
        alert("Publishing is disabled in Standalone Mode.");
    };

    const handleAssignBlock = async (tempBlock: any, userId: string) => {
        try {
            await firebaseSaveShiftBlock({
                ...tempBlock,
                assignedTo: userId,
                id: `task-${Date.now()}`
            });

            // Remove from unassigned
            setUnassignedBlocks(prev => prev.filter(b => b.tempId !== tempBlock.tempId));
        } catch (err) {
            alert("Failed to assign task.");
        }
    };

    const handleDeleteBlock = async (blockId: string, isShift: boolean = false) => {
        if (!confirm("Delete this?")) return;
        try {
            await firebaseDeleteShiftBlock(blockId);
        } catch (err) {
            alert("Failed to delete.");
        }
    };

    const handleAddShift = async () => {
        if (!shiftUser || !shiftStart || !shiftEnd) return;

        // Time Off Warning
        const targetUser = users.find(u => u.id === shiftUser);
        if (targetUser?.timeOffRequests) {
            const isOff = targetUser.timeOffRequests.some(req => {
                const reqStart = new Date(req.startDate);
                reqStart.setHours(0, 0, 0, 0);
                const reqEnd = new Date(req.endDate);
                reqEnd.setHours(23, 59, 59, 999);
                const shiftDate = new Date(currentDate);
                shiftDate.setHours(12, 0, 0, 0);
                return (shiftDate >= reqStart && shiftDate <= reqEnd) && req.status !== 'Denied';
            });

            if (isOff) {
                if (!confirm(`Warning: ${targetUser.name} has an active TIME OFF request for this date! Are you sure you want to override their request and schedule them?`)) {
                    return;
                }
            }
        }

        try {
            const startDateTime = new Date(currentDate);
            const [sh, sm] = shiftStart.split(':').map(Number);
            startDateTime.setHours(sh, sm, 0, 0);

            const endDateTime = new Date(currentDate);
            const [eh, em] = shiftEnd.split(':').map(Number);
            endDateTime.setHours(eh, em, 0, 0);

            const blockData = {
                id: `shift-${Date.now()}-${shiftUser}`,
                title: `[SHIFT] Scheduled`,
                description: `Total Hours Scheduled`,
                startTime: startDateTime.toISOString(),
                endTime: endDateTime.toISOString(),
                assignedTo: shiftUser,
                status: 'pending',
                priority: 'medium'
            };

            await firebaseSaveShiftBlock(blockData);

            // Reset form partially
            setShiftUser('');
        } catch (err) {
            alert("Failed to create shift block.");
        }
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();
    };

    const getBlockStyles = (block: ScheduleBlock, overlapIndex: number = 0) => {
        if (!block || !block.startTime || !block.endTime) {
            return { display: 'none' };
        }
        // Calculate position
        const start = new Date(block.startTime);
        const end = new Date(block.endTime);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return { display: 'none' };
        }

        // Normalize to current day's hours if timezone issues, 
        // but assuming ISO strings are correct in local or UTC
        // We'll extract hours relative to the block's own time
        const startH = start.getHours() + start.getMinutes() / 60;
        const endH = end.getHours() + end.getMinutes() / 60;

        let left = ((startH - START_HOUR) / TOTAL_HOURS) * 100;
        let width = ((endH - startH) / TOTAL_HOURS) * 100;

        // Boundary checks
        if (left < 0) {
            width += left; // Reduce width by amount cut off
            left = 0;
        }
        if (left + width > 100) {
            width = 100 - left;
        }

        // Color mapping
        // Map API priority/status to colors based on screenshot heuristics
        // The screenshot has "active" = blue, "clean..." = green, "print..." = orange
        // Our API has 'status': pending, in_progress, completed, delayed
        let colorClass = STATUS_COLORS.default;

        if (block.title?.startsWith('Order #') || block.description?.includes('Quick Order Task')) {
            colorClass = STATUS_COLORS.order;
        } else if (block.status === 'in_progress') colorClass = STATUS_COLORS.active;
        else if (block.status === 'completed') colorClass = STATUS_COLORS.completed;
        else if (block.status === 'delayed') colorClass = STATUS_COLORS.delayed;
        else if (block.status === 'pending') colorClass = STATUS_COLORS.pending;

        return {
            left: `${left}%`,
            width: `${width}%`,
            top: `${4 + overlapIndex * 32}px`,
            height: '28px',
            className: `absolute rounded-md text-xs font-medium px-2 py-1 truncate shadow-sm border-l-4 ${colorClass} hover:opacity-90 transition-opacity cursor-pointer z-10`
        };
    };

    // Group blocks by user and filter based on active view
    const userBlocks = users.reduce((acc, user) => {
        const isMatch = (assignedTo?: string) => {
            if (!assignedTo) return false;
            // Exact ID Match
            if (String(assignedTo) === String(user.id)) return true;
            
            // Fuzzy Name Match Fallback
            if (String(assignedTo).startsWith('NAME_MATCH:')) {
                const searchName = String(assignedTo).replace('NAME_MATCH:', '').toLowerCase().trim();
                const localName = user.name.toLowerCase().trim();
                const localUsername = (user.username || '').toLowerCase().trim();
                
                if (localName === searchName || localUsername === searchName) return true;
                // Try first name matching as a last resort
                if (localName.split(' ')[0] === searchName.split(' ')[0]) return true;
            }
            return false;
        };

        const dayBlocks = shiftBlocks.filter(b => {
             if (!isMatch(b.assignedTo)) return false;
             if (b.date) {
                 const yyyy = currentDate.getFullYear();
                 const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
                 const dd = String(currentDate.getDate()).padStart(2, '0');
                 const currentStr = `${yyyy}-${mm}-${dd}`;
                 return b.date === currentStr;
             }
             if (!b.startTime) return false;
             const bDate = new Date(b.startTime);
             return bDate.getDate() === currentDate.getDate() && bDate.getMonth() === currentDate.getMonth() && bDate.getFullYear() === currentDate.getFullYear();
        });

        if (activeView === 'shifts') {
            acc[user.id] = dayBlocks.filter(b => b.title.startsWith('[SHIFT]'));
        } else {
            acc[user.id] = dayBlocks.filter(b => !b.title.startsWith('[SHIFT]'));
        }
        return acc;
    }, {} as Record<string, ScheduleBlock[]>);

    // Filter out clients - only show team members (non-client users)
    const teamMembers = users.filter(u => u.role?.trim().toLowerCase() !== 'client' && u.username);

    // If user is not admin, manager, or a public terminal, only show their own row
    const canSeeAll = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'terminal' || currentUser?.username?.toLowerCase() === 'warehouse';
    const visibleUsers = canSeeAll
        ? teamMembers
        : teamMembers.filter(u => u.id === currentUser?.id);

    const sortedUsers = [...visibleUsers].sort((a, b) => {
        const aHasBlocks = (userBlocks[a.id] || []).length > 0;
        const bHasBlocks = (userBlocks[b.id] || []).length > 0;

        if (aHasBlocks && !bHasBlocks) return -1;
        if (!aHasBlocks && bHasBlocks) return 1;

        return a.name.localeCompare(b.name);
    });

    return (
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-zinc-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-zinc-50 z-50 relative">
                <div className="flex gap-4 items-center">
                    <div>
                        <h2 className="text-lg font-bold text-zinc-800 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-zinc-500" />
                            Daily Planner
                        </h2>
                        <p className="text-xs text-zinc-500">
                            {activeView === 'tasks' ? 'Task assignment based on workload' : 'Auto-clock out parameters'}
                        </p>
                    </div>

                    <div className="flex bg-zinc-200 p-1 rounded-lg sm:ml-4 shadow-inner mt-2 sm:mt-0 w-full sm:w-auto">
                        <button
                            onClick={() => setActiveView('tasks')}
                            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeView === 'tasks' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500 hover:text-zinc-700'}`}
                        >
                            <LayoutGrid className="w-4 h-4 inline-block mr-1" />
                            Tasks
                        </button>
                        <button
                            onClick={() => setActiveView('shifts')}
                            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeView === 'shifts' ? 'bg-white shadow text-zinc-700' : 'text-zinc-500 hover:text-zinc-700'}`}
                        >
                            <Clock className="w-4 h-4 inline-block mr-1" />
                            Shift Schedules
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {activeView === 'tasks' && (
                        <>
                            {canCreateTasks && (
                                <>
                                    <button
                                        onClick={() => setShowQuickTasks(true)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border whitespace-nowrap bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-400 shrink-0"
                                    >
                                        <Zap className="w-4 h-4 text-orange-500" />
                                        Quick Tasks
                                    </button>
                                    <button
                                        onClick={() => setShowOrdersDialog(true)}
                                        className="relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border whitespace-nowrap bg-white border-zinc-300 text-zinc-700 hover:bg-zinc-50 hover:border-zinc-400 shrink-0"
                                    >
                                        <ShoppingBag className="w-4 h-4 text-purple-500" />
                                        Orders
                                        {productionOrders.length > 0 && (
                                            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-purple-600 px-1 text-[10px] font-bold text-white shadow-sm ring-1 ring-white">
                                                {productionOrders.length}
                                            </span>
                                        )}
                                    </button>
                                </>
                            )}
                            {canManageSchedule && (
                                <button
                                    onClick={() => setIsPlanningMode(!isPlanningMode)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm border whitespace-nowrap shrink-0 ${isPlanningMode
                                        ? 'bg-orange-600 border-orange-700 text-white animate-pulse'
                                        : 'bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800'
                                        }`}
                                >
                                    <Wand2 className="w-4 h-4" />
                                    {isPlanningMode ? 'Exit Planning Mode' : 'Build Schedule'}
                                </button>
                            )}
                        </>
                    )}

                    <div className="flex bg-white rounded-lg border border-zinc-300 shadow-sm p-1 items-center ml-2">
                        <button onClick={handlePrevDay} className="p-1 hover:bg-zinc-100 rounded text-zinc-600">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-3 text-sm font-medium text-zinc-800 min-w-[120px] text-center">
                            {currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <button onClick={handleNextDay} className="p-1 hover:bg-zinc-100 rounded text-zinc-600">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {activeView === 'shifts' && (
                            <div className="flex bg-zinc-100 p-0.5 rounded-lg border border-zinc-200">
                                {['day', 'week', 'month'].map(view => (
                                    <button
                                        key={view}
                                        onClick={() => setShiftTimeframe(view as any)}
                                        className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-shadow ${shiftTimeframe === view ? 'bg-white shadow-sm text-zinc-700' : 'text-zinc-500 hover:text-zinc-700'}`}
                                    >
                                        {view}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={() => { setCurrentDate(new Date()) }}
                            className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${isToday(currentDate) ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
                        >
                            Today
                        </button>

                        {isAdminOrManager && (
                            <div className="relative">
                                <button
                                    onClick={() => setIsDuplicating(!isDuplicating)}
                                    className={`text-xs px-2 py-2 rounded-lg border font-medium transition-colors flex items-center gap-1 ${isDuplicating ? 'bg-zinc-50 border-zinc-200 text-zinc-700' : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}
                                    title="Duplicate Schedule"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>

                                {isDuplicating && (
                                    <div className="absolute right-0 top-full mt-2 bg-white border border-zinc-200 p-3 rounded-xl shadow-xl z-50 min-w-[250px] animate-fade-in flex flex-col gap-3">
                                        <div className="text-sm font-bold text-zinc-800">Duplicate {activeView === 'shifts' ? 'Shifts' : 'Tasks'}</div>
                                        <div className="text-xs text-zinc-500 mb-2">Select a date to copy all {activeView === 'shifts' ? 'shift schedules' : 'tasks'} from this day.</div>
                                        <input
                                            type="date"
                                            value={duplicateTargetDate}
                                            onChange={(e) => setDuplicateTargetDate(e.target.value)}
                                            className="w-full text-sm p-2 border border-zinc-300 rounded focus:ring-2 focus:ring-zinc-500 outline-none"
                                        />
                                        <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={duplicateWholeWeek}
                                                onChange={(e) => setDuplicateWholeWeek(e.target.checked)}
                                                className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                                            />
                                            Apply to entire work week (Mon-Fri)
                                        </label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setIsDuplicating(false)}
                                                className="flex-1 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 rounded-lg transition-colors border border-zinc-300"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleDuplicateSchedule}
                                                disabled={!duplicateTargetDate || (activeView === 'tasks' 
                                                    ? shiftBlocks.filter(b => !b.title.startsWith('[SHIFT]') && new Date(b.startTime).toDateString() === currentDate.toDateString()).length === 0 
                                                    : !shiftBlocks.some(b => b.title.startsWith('[SHIFT]') && new Date(b.startTime).toDateString() === currentDate.toDateString()))}
                                                className="flex-1 px-3 py-1.5 text-xs text-white bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg font-bold transition-colors shadow-sm"
                                            >
                                                Confirm
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* AI Planning Panel for Tasks */}
            {isPlanningMode && activeView === 'tasks' && (
                <div className="bg-orange-50 border-b border-orange-100 p-6 animate-slide-down relative z-10">
                    <div className="max-w-4xl mx-auto flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-orange-900 font-bold flex items-center gap-2">
                                    <Mic className="w-5 h-5" />
                                    AI Schedule Generator
                                </h3>
                                <p className="text-orange-700 text-sm">Paste notes or a transcript of what everyone is doing today.</p>
                            </div>
                            <button
                                onClick={handlePublish}
                                disabled={loading}
                                className="flex items-center gap-2 px-6 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg font-bold shadow-lg shadow-zinc-100 transition-all disabled:opacity-50"
                            >
                                <CheckCircle className="w-4 h-4" />
                                Publish Schedule
                            </button>
                        </div>

                        <div className="flex gap-4">
                            <div className="flex-1 relative">
                                <textarea
                                    value={transcript}
                                    onChange={(e) => setTranscript(e.target.value)}
                                    placeholder="Example: Austin is mopping 1-2pm. kurtis is doing printer maintenance 10-12 and then inventory check at 2..."
                                    className="w-full h-24 p-4 border border-orange-200 rounded-xl bg-white shadow-inner focus:ring-2 focus:ring-orange-500 outline-none text-sm resize-none"
                                />
                                <button
                                    onClick={handleGenerateAI}
                                    disabled={!transcript.trim() || isGenerating}
                                    className="absolute bottom-3 right-3 flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50 shadow-md"
                                >
                                    {isGenerating ? (
                                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                                    ) : (
                                        <Send className="w-3 h-3" />
                                    )}
                                    Generate Draft
                                </button>
                            </div>
                        </div>

                        {/* Unassigned Workings */}
                        {unassignedBlocks.length > 0 && (
                            <div className="mt-4 animate-fade-in">
                                <h4 className="text-xs font-bold text-orange-800 uppercase mb-2 flex items-center gap-2">
                                    <AlertCircle className="w-3 h-3" />
                                    Review Unassigned Tasks ({unassignedBlocks.length})
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {unassignedBlocks.map((block) => (
                                        <div key={block.tempId} className="bg-white p-3 rounded-lg border border-orange-200 shadow-sm flex flex-col gap-2">
                                            <div>
                                                <div className="font-bold text-zinc-800 text-sm">{block.title}</div>
                                                <div className="text-[10px] text-zinc-500">
                                                    {block.suggestedName ? `(Suggested for: ${block.suggestedName})` : '(No assignee found)'}
                                                </div>
                                            </div>
                                            <select
                                                onChange={(e) => handleAssignBlock(block, e.target.value)}
                                                className="text-xs p-1.5 border rounded bg-orange-50 focus:ring-1 focus:ring-orange-500 outline-none"
                                                defaultValue=""
                                            >
                                                <option value="" disabled>Choose Team Member...</option>
                                                {teamMembers.map(u => (
                                                    <option key={u.id} value={u.id}>{u.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Shift Addition Form */}
            {activeView === 'shifts' && isAdminOrManager && (
                <div className="bg-zinc-50 border-b border-zinc-100 p-4 shrink-0 relative z-10">
                    <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-4">
                        <div className="flex items-center gap-2 text-zinc-900 font-bold shrink-0">
                            <Clock className="w-5 h-5 text-zinc-900" />
                            Add Expected Shift
                        </div>

                        <div className="flex-1 flex flex-wrap gap-2 items-center w-full">
                            <select
                                value={shiftUser}
                                onChange={(e) => setShiftUser(e.target.value)}
                                className="px-3 py-2 text-sm rounded bg-white border border-zinc-200 focus:ring-2 focus:ring-zinc-500 outline-none min-w-[200px] flex-1 md:flex-none"
                            >
                                <option value="" disabled>Select Staff Member...</option>
                                {teamMembers.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>

                            <div className="flex items-center gap-2 bg-white rounded border border-zinc-200 px-2 py-1 shadow-inner">
                                <input
                                    type="time"
                                    value={shiftStart}
                                    onChange={(e) => setShiftStart(e.target.value)}
                                    className="text-sm outline-none px-1"
                                />
                                <span className="text-zinc-300 font-bold">to</span>
                                <input
                                    type="time"
                                    value={shiftEnd}
                                    onChange={(e) => setShiftEnd(e.target.value)}
                                    className="text-sm outline-none px-1"
                                />
                            </div>

                            <button
                                onClick={handleAddShift}
                                disabled={!shiftUser || !shiftStart || !shiftEnd}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors ml-auto md:ml-0"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-zinc-700 mt-2 text-center md:text-left max-w-4xl mx-auto">
                        Setting shift hours ensures users are automatically clocked out if they forget, enforcing a correct duration (includes a 10 min grace period after the shift ends).
                    </p>
                </div>
            )}

            {loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900"></div>
                </div>
            )}

            {error && !loading && (
                <div className="flex-1 flex flex-col items-center justify-center text-red-500 gap-2 p-8 text-center">
                    <AlertCircle className="w-8 h-8" />
                    <p>{error}</p>
                </div>
            )}

            {!loading && !error && activeView === 'shifts' && shiftTimeframe !== 'day' ? (
                <ShiftCalendarViews
                    viewType={shiftTimeframe as 'week' | 'month'}
                    currentDate={currentDate}
                    users={users}
                    currentUser={currentUser}
                    onBlockClick={handleBlockClick}
                    firebaseShiftBlocks={shiftBlocks}
                />
            ) : (!loading && !error && (
                <div className="flex-1 overflow-auto bg-white relative flex flex-col">
                    {/* Main Timeline Container */}
                    <div className="min-w-[800px] flex-1 flex flex-col">

                        {/* Time Header */}
                        <div className="flex border-b border-zinc-200 bg-white sticky top-0 z-20">
                            <div className="w-48 p-3 border-r border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-500 uppercase tracking-wider sticky left-0 z-30">
                                Team Members
                            </div>
                            <div className="flex-1 relative h-10">
                                {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => {
                                    const hour = START_HOUR + i;
                                    const displayHour = hour > 12 ? hour - 12 : hour;
                                    const ampm = hour >= 12 ? 'pm' : 'am';
                                    const left = (i / TOTAL_HOURS) * 100;

                                    return (
                                        <div
                                            key={hour}
                                            className="absolute top-0 bottom-0 border-l border-zinc-100 flex flex-col justify-end pb-2"
                                            style={{ left: `${left}%` }}
                                        >
                                            <span className="text-[10px] text-zinc-400 pl-1 transform -tranzinc-x-1/2">
                                                {displayHour}{ampm}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Users Rows */}
                        <div className="flex-1 relative">
                            {/* Vertical Grid Lines (Background) */}
                            <div className="absolute inset-0 pl-48 pointer-events-none">
                                <div className="relative w-full h-full" ref={timelineRef}>
                                    {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="absolute top-0 bottom-0 border-l border-zinc-100"
                                            style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Current Time Indicator */}
                            {isToday(currentDate) && currentTimePercentage !== null && (
                                <div
                                    className="absolute top-0 bottom-0 w-px bg-red-500 z-40 pointer-events-none"
                                    style={{ left: `calc(12rem + ${currentTimePercentage}% - (12rem * ${currentTimePercentage / 100}))` }}
                                // Math explanation: 
                                // The container is flex-row. The left 12rem is the sidebar. The right is grid.
                                // Wait, position absolute is relative to the "flex-1 relative" container above.
                                // But that container includes width of sidebar? No, sidebar is in the Row flex.
                                // Actually the sidebar and grid content are in the rows below.
                                // Let's restructure to have a single grid container background.
                                >
                                    <div className="bg-red-500 text-white text-[10px] font-bold px-1 rounded absolute -top-2 left-1/2 transform -tranzinc-x-1/2">
                                        {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </div>
                                </div>
                            )}

                            {/* Rows */}
                            {sortedUsers.map(user => {
                                const blocks = userBlocks[user.id] || [];
                                
                                // Calculate overlaps to stack blocks
                                const sortedBlocks = [...blocks].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                                const overlaps = new Map<string, number>();
                                const lanes: number[] = [];
                                
                                sortedBlocks.forEach(block => {
                                    const start = new Date(block.startTime).getTime();
                                    const end = new Date(block.endTime).getTime();
                                    let laneIndex = lanes.findIndex(laneEnd => laneEnd <= start);
                                    if (laneIndex === -1) {
                                        laneIndex = lanes.length;
                                    }
                                    lanes[laneIndex] = end;
                                    overlaps.set(block.id, laneIndex);
                                });

                                const maxLane = Math.max(0, lanes.length - 1);
                                const rowHeight = Math.max(64, (maxLane + 1) * 32 + 8);

                                return (
                                <div key={user.id} className="flex border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors relative" style={{ height: `${rowHeight}px` }}>
                                    {/* User Info (Sticky Left) */}
                                    <div className="w-48 border-r border-zinc-200 p-3 bg-white sticky left-0 z-10 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center font-bold text-xs ring-2 ring-white shadow-sm">
                                            {user.avatarInitials}
                                        </div>
                                        <span className="text-sm font-medium text-zinc-700 truncate">{user.name}</span>
                                    </div>

                                    {/* Timeline Area for this User */}
                                    <div 
                                        className="flex-1 relative h-full"
                                        onContextMenu={(e) => handleContextMenu(e, user.id)}
                                    >
                                        {/* Render Blocks */}
                                        {(userBlocks[user.id] || []).map(originalBlock => {
                                            const isDragged = previewBlock?.id === originalBlock.id;
                                            const block = isDragged ? previewBlock : originalBlock;
                                            const overlapIndex = overlaps.get(originalBlock.id) || 0;
                                            const styles = getBlockStyles(block, overlapIndex);
                                            return (
                                                <div
                                                    key={block.id}
                                                    onClick={() => {
                                                        // Prevent click if we were dragging
                                                        if (isDragged || dragState) return;
                                                        handleBlockClick(block);
                                                    }}
                                                    onMouseDown={(e) => {
                                                        if (!isAdminOrManager) return;
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        // If clicked within 24px of the right edge, treat as resize
                                                        const isResize = e.clientX > rect.right - 24;
                                                        
                                                        setDragState({
                                                            block: originalBlock,
                                                            type: isResize ? 'resize' : 'move',
                                                            startX: e.clientX,
                                                            originalStart: new Date(originalBlock.startTime),
                                                            originalEnd: new Date(originalBlock.endTime)
                                                        });
                                                        setPreviewBlock(originalBlock);
                                                    }}
                                                    style={{ left: styles.left, width: styles.width, top: styles.top, height: styles.height }}
                                                    className={styles.className + " group " + (isAdminOrManager ? "cursor-pointer" : "") + (isDragged ? " opacity-70 scale-105 z-50 shadow-xl" : "")}
                                                    title={`${block.title} (${new Date(block.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(block.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`}
                                                >
                                                    {block.title}
                                                    {isAdminOrManager && (
                                                        <div className="absolute top-0 right-0 bottom-0 w-6 cursor-e-resize hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100" title="Drag to resize">
                                                            <div className="w-1 h-3 border-l border-r border-white/50"></div>
                                                        </div>
                                                    )}
                                                    {/* Tooltip-ish Details */}
                                                    <div className="hidden group-hover:block absolute top-full left-0 bg-zinc-800 text-white text-xs p-3 rounded shadow-xl z-[100] w-64 mt-1 whitespace-normal">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <div className="font-bold text-sm leading-tight pr-2">{activeView === 'shifts' ? 'Shift Schedule' : block.title}</div>
                                                            {(isAdminOrManager) && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteBlock(block.id, activeView === 'shifts');
                                                                    }}
                                                                    className="p-1 hover:bg-red-500 rounded transition-colors shrink-0"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        
                                                        <div className="flex flex-col gap-1.5">
                                                            <div className="flex items-center gap-1.5 text-zinc-300">
                                                                <Clock className="w-3 h-3 shrink-0" />
                                                                <span>{new Date(block.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(block.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                                            </div>

                                                            {block.department && (
                                                                <div className="flex items-center gap-1.5 text-zinc-300">
                                                                    <LayoutGrid className="w-3 h-3 shrink-0" />
                                                                    <span>{block.department}</span>
                                                                </div>
                                                            )}

                                                            {block.location && (
                                                                <div className="flex items-center gap-1.5 text-zinc-300">
                                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                                    <span>{block.location}</span>
                                                                </div>
                                                            )}
                                                            
                                                            {block.priority && (
                                                                <div className="flex items-center gap-1.5 text-zinc-300 capitalize">
                                                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                                                    <span>{block.priority} Priority</span>
                                                                </div>
                                                            )}

                                                            {block.description && (
                                                                <div className="mt-1 pt-1.5 border-t border-zinc-700 text-zinc-300">
                                                                    {block.description.split('\n').map((line, i) => (
                                                                        <div key={i}>{line}</div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            <div className="mt-1 pt-1.5 border-t border-zinc-700 flex items-center justify-between">
                                                                <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">Status</span>
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold capitalize ${
                                                                    block.status === 'completed' ? 'bg-zinc-500/20 text-zinc-300' :
                                                                    block.status === 'in_progress' ? 'bg-green-500/20 text-green-300' :
                                                                    block.status === 'delayed' ? 'bg-red-500/20 text-red-300' :
                                                                    'bg-yellow-500/20 text-yellow-600'
                                                                }`}>
                                                                    {block.status === 'delayed' ? "Can't Start" : block.status.replace('_', ' ')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )})}

                            {/* Empty State if no users */}
                            {sortedUsers.length === 0 && (
                                <div className="p-8 text-center text-zinc-400">
                                    No team members found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            {/* Footer / Legend */}
            {shiftTimeframe === 'day' && (
                <div className="p-4 border-t border-zinc-200 bg-white flex flex-wrap gap-4 text-xs">
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[key as keyof typeof STATUS_COLORS].split(' ')[0]}`}></div>
                            <span className="text-zinc-600 font-medium">{label}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Edit Block Dialog */}
            {editingBlock && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl border border-zinc-200 w-full max-w-md overflow-hidden animate-fade-in">
                        <div className="p-4 border-b border-zinc-100 bg-zinc-50 flex justify-between items-center">
                            <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-zinc-900" />
                                {editingBlock.title.startsWith('[SHIFT]') ? 'Edit Expected Shift' : 'Edit Task Block'}
                            </h3>
                            <button onClick={() => setEditingBlock(null)} className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 flex flex-col gap-4">
                            {editingBlock.title.startsWith('[SHIFT]') ? (
                                <div className="text-sm font-medium text-zinc-700 bg-zinc-50 p-2 rounded border border-zinc-100">
                                    {editingBlock.title}
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Task Name</label>
                                    <input
                                        type="text"
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="w-full text-sm p-2 border border-zinc-300 rounded focus:ring-2 focus:ring-zinc-500 outline-none"
                                        placeholder="e.g. New Task"
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Start Time</label>
                                    <input
                                        type="time"
                                        value={editStart}
                                        onChange={(e) => setEditStart(e.target.value)}
                                        className="w-full text-sm p-2 border border-zinc-300 rounded focus:ring-2 focus:ring-zinc-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-zinc-600 mb-1">End Time</label>
                                    <input
                                        type="time"
                                        value={editEnd}
                                        onChange={(e) => setEditEnd(e.target.value)}
                                        className="w-full text-sm p-2 border border-zinc-300 rounded focus:ring-2 focus:ring-zinc-500 outline-none"
                                    />
                                </div>
                            </div>

                            {editingBlock.title.startsWith('[SHIFT]') && (
                                <div>
                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Department</label>
                                    <select
                                        value={editDepartment}
                                        onChange={(e) => setEditDepartment(e.target.value as Department | '')}
                                        className="w-full text-sm p-2 border border-zinc-300 rounded focus:ring-2 focus:ring-zinc-500 outline-none bg-white"
                                    >
                                        <option value="">No Department Specified</option>
                                        {Object.values(Department).map(dept => (
                                            <option key={dept} value={dept}>{dept}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-zinc-600 mb-1">Notes / Description</label>
                                <textarea
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Add any notes relevant to this schedule schedule..."
                                    className="w-full h-24 p-2 border border-zinc-300 rounded resize-none text-sm focus:ring-2 focus:ring-zinc-500 outline-none"
                                ></textarea>
                            </div>
                        </div>
                        <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex justify-between items-center gap-2">
                            {!shiftBlocks.some(b => b.id === editingBlock.id) ? (
                                <div></div>
                            ) : (
                                <button
                                    onClick={() => {
                                        handleDeleteBlock(editingBlock.id, activeView === 'shifts');
                                        setEditingBlock(null);
                                    }}
                                    className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 hover:text-red-700 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" /> Delete
                                </button>
                            )}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setEditingBlock(null)}
                                    className="px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-200 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isUpdating}
                                    className="px-4 py-2 text-sm font-bold text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg shadow transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isUpdating ? 'Saving...' : 'Save Changes'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed bg-white border border-zinc-200 shadow-xl rounded-md py-1 z-[200] text-sm animate-fade-in"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button 
                        onClick={handleContextMenuAdd}
                        className="w-full text-left px-4 py-2 hover:bg-zinc-100 flex items-center gap-2 text-zinc-800"
                    >
                        <Plus className="w-4 h-4" />
                        Add {activeView === 'shifts' ? 'Shift' : 'Task'} at {
                            new Date(new Date().setHours(Math.floor(contextMenu.hour), contextMenu.hour % 1 === 0 ? 0 : 30)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        }
                    </button>
                </div>
            )}

            {/* Quick Tasks Dialog */}
            {showQuickTasks && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl border border-zinc-200 w-[95vw] max-w-[1600px] h-[90vh] overflow-hidden animate-fade-in flex flex-col">
                        <div className="p-4 border-b border-zinc-100 bg-zinc-50 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                                <Zap className="w-5 h-5 text-orange-500" />
                                Quick Tasks
                            </h3>
                            <button onClick={() => setShowQuickTasks(false)} className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 flex overflow-hidden">
                            {/* Left Panel: Manage Tasks */}
                            <div className="w-1/2 border-r border-zinc-200 flex flex-col bg-zinc-50/50">
                                <div className="p-3 border-b border-zinc-200 bg-white">
                                    <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider">Predetermined Tasks</div>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            placeholder="Task title..." 
                                            value={qtNewTitle}
                                            onChange={e => setQtNewTitle(e.target.value)}
                                            className="flex-1 text-sm p-1.5 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                        <input
                                            type="text"
                                            list="qt-locations"
                                            placeholder="Location (comma separated)..."
                                            value={qtNewLocation}
                                            onChange={e => setQtNewLocation(e.target.value)}
                                            className="w-48 text-sm p-1.5 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                        <datalist id="qt-locations">
                                            {uniqueLocations.map(loc => <option key={loc} value={loc} />)}
                                        </datalist>
                                        <input 
                                            type="number" 
                                            placeholder="Mins" 
                                            value={qtNewDuration}
                                            onChange={e => setQtNewDuration(e.target.value)}
                                            className="w-16 text-sm p-1.5 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-orange-500"
                                        />
                                        <button 
                                            onClick={handleAddQuickTaskDef}
                                            disabled={!qtNewTitle.trim()}
                                            className="p-1.5 bg-zinc-800 text-white rounded hover:bg-zinc-700 disabled:opacity-50 shrink-0"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                    {uniqueLocations.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <button 
                                                onClick={() => setQtLocationFilter(null)}
                                                className={`text-[10px] px-2 py-1 rounded-full font-bold transition-colors ${!qtLocationFilter ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                                            >
                                                All
                                            </button>
                                            {uniqueLocations.map(loc => (
                                                <button 
                                                    key={loc}
                                                    onClick={() => setQtLocationFilter(loc)}
                                                    className={`text-[10px] px-2 py-1 rounded-full font-bold transition-colors ${qtLocationFilter === loc ? 'bg-orange-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                                                >
                                                    {loc}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                    {filteredQuickTasks.length === 0 ? (
                                        <div className="text-xs text-zinc-400 text-center mt-4">No quick tasks found. Create one above.</div>
                                    ) : (
                                        filteredQuickTasks.map(t => (
                                            <div 
                                                key={t.id} 
                                                onClick={() => setQtSelectedTask(t.id)}
                                                className={`group flex items-center justify-between p-2 rounded cursor-pointer border ${qtSelectedTask === t.id ? 'bg-orange-50 border-orange-300 shadow-sm' : 'bg-white border-zinc-200 hover:border-orange-200'}`}
                                            >
                                                <div className="min-w-0 flex-1 flex flex-col justify-center">
                                                    <div className="text-sm font-bold text-zinc-800 truncate">{t.title}</div>
                                                    <div className="text-[10px] text-zinc-500 flex gap-2 flex-wrap items-center mt-0.5">
                                                        <span>{t.duration} mins</span>
                                                        {(t.locations || (t.location ? [t.location] : [])).map(loc => (
                                                            <span key={loc} className="bg-zinc-100 border border-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded flex items-center gap-1 group/loc transition-colors hover:bg-zinc-200">
                                                                {loc}
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleRemoveLocationFromTask(t.id, loc); }}
                                                                    className="opacity-0 group-hover/loc:opacity-100 hover:text-red-500 transition-opacity"
                                                                >
                                                                    &times;
                                                                </button>
                                                            </span>
                                                        ))}
                                                        <div className="relative">
                                                            <button 
                                                                onClick={(e) => { 
                                                                    e.stopPropagation(); 
                                                                    setQtActiveDropdown(qtActiveDropdown === t.id ? null : t.id);
                                                                    setQtDropdownInput('');
                                                                }}
                                                                className="text-zinc-400 hover:text-zinc-600 px-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold"
                                                                title="Add Location Tag"
                                                            >
                                                                + Add
                                                            </button>
                                                            {qtActiveDropdown === t.id && (
                                                                <div className="absolute top-full left-0 mt-1 bg-white border border-zinc-200 rounded shadow-xl z-[200] w-48 p-2 text-zinc-800" onClick={e => e.stopPropagation()}>
                                                                    <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Add Location</div>
                                                                    <div className="max-h-32 overflow-y-auto mb-2 space-y-1">
                                                                        {uniqueLocations.filter(loc => !(t.locations || (t.location ? [t.location] : [])).includes(loc)).map(loc => (
                                                                            <button 
                                                                                key={loc}
                                                                                onClick={() => {
                                                                                    handleAddSpecificLocationToTask(t.id, loc);
                                                                                    setQtActiveDropdown(null);
                                                                                }}
                                                                                className="block w-full text-left text-xs p-1.5 hover:bg-zinc-100 rounded"
                                                                            >
                                                                                {loc}
                                                                            </button>
                                                                        ))}
                                                                        {uniqueLocations.filter(loc => !(t.locations || (t.location ? [t.location] : [])).includes(loc)).length === 0 && (
                                                                            <div className="text-xs text-zinc-400 italic px-1">No other locations...</div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-1 border-t border-zinc-100 pt-2">
                                                                        <input 
                                                                            type="text" 
                                                                            value={qtDropdownInput}
                                                                            onChange={e => setQtDropdownInput(e.target.value)}
                                                                            placeholder="New..."
                                                                            className="flex-1 text-xs border border-zinc-300 rounded px-1.5 py-1 outline-none focus:border-orange-500 min-w-0"
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Enter' && qtDropdownInput.trim()) {
                                                                                    handleAddSpecificLocationToTask(t.id, qtDropdownInput);
                                                                                    setQtActiveDropdown(null);
                                                                                }
                                                                            }}
                                                                        />
                                                                        <button 
                                                                            onClick={() => {
                                                                                if (qtDropdownInput.trim()) {
                                                                                    handleAddSpecificLocationToTask(t.id, qtDropdownInput);
                                                                                    setQtActiveDropdown(null);
                                                                                }
                                                                            }}
                                                                            className="px-2 py-0.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-bold transition-colors"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteQuickTaskDef(t.id); }}
                                                    className="p-1 text-zinc-400 hover:text-red-500 rounded hover:bg-red-50 ml-2 shrink-0"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Right Panel: Assign */}
                            <div className="w-1/2 flex flex-col bg-white">
                                <div className="p-4 flex-1 flex flex-col overflow-hidden">
                                    {!qtSelectedTask ? (
                                        <div className="h-full flex items-center justify-center text-sm text-zinc-400 text-center px-4">
                                            Select a task from the left to assign it to team members.
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-4 flex-1 min-h-0">
                                            <div className="shrink-0">
                                                <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider">1. Select Time</div>
                                                <input 
                                                    type="time" 
                                                    value={qtStartTime}
                                                    onChange={e => setQtStartTime(e.target.value)}
                                                    className="w-full text-sm p-2 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-orange-500"
                                                />
                                            </div>

                                            <div className="flex flex-col flex-1 min-h-0">
                                                <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider shrink-0">2. Select Team Members</div>
                                                <input
                                                    type="text"
                                                    placeholder="Search team members..."
                                                    value={qtSearchQuery}
                                                    onChange={e => setQtSearchQuery(e.target.value)}
                                                    className="w-full text-sm p-2 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-orange-500 mb-2 shrink-0"
                                                />
                                                <div className="space-y-1 flex-1 overflow-y-auto border border-zinc-200 rounded p-1 min-h-0">
                                                    {teamMembers
                                                        .filter(u => u.name.toLowerCase().includes(qtSearchQuery.toLowerCase()))
                                                        .sort((a, b) => a.name.localeCompare(b.name))
                                                        .map(u => (
                                                        <label key={u.id} className="flex items-center gap-2 p-1.5 hover:bg-zinc-50 rounded cursor-pointer">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={qtSelectedUsers.includes(u.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) setQtSelectedUsers([...qtSelectedUsers, u.id]);
                                                                    else setQtSelectedUsers(qtSelectedUsers.filter(id => id !== u.id));
                                                                }}
                                                                className="rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                                                            />
                                                            <span className="text-sm font-medium text-zinc-700">{u.name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 border-t border-zinc-100 bg-zinc-50 shrink-0">
                                    <button
                                        onClick={handleAssignQuickTask}
                                        disabled={!qtSelectedTask || qtSelectedUsers.length === 0}
                                        className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg shadow disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <Plus className="w-4 h-4" /> Add to Planners
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Orders Dialog */}
            {showOrdersDialog && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl border border-zinc-200 w-[95vw] max-w-[1600px] h-[90vh] overflow-hidden animate-fade-in flex flex-col">
                        <div className="p-4 border-b border-zinc-100 bg-zinc-50 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                                <ShoppingBag className="w-5 h-5 text-purple-500" />
                                Production Orders
                            </h3>
                            <button onClick={() => setShowOrdersDialog(false)} className="p-1 hover:bg-zinc-200 rounded text-zinc-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 flex overflow-hidden">
                            {/* Left Panel: Orders List */}
                            <div className="w-1/2 border-r border-zinc-200 flex flex-col bg-zinc-50/50">
                                <div className="p-3 border-b border-zinc-200 bg-white">
                                    <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider">Select Live Production Order</div>
                                    <div className="input-icon-wrapper">
                                        <Search className="text-zinc-400" />
                                        <input 
                                            type="text" 
                                            placeholder="Search by order ID, customer or title..." 
                                            value={orderListSearchQuery}
                                            onChange={e => setOrderListSearchQuery(e.target.value)}
                                            className="w-full text-sm pl-9 pr-3 py-1.5 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-purple-500"
                                        />
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                    {(() => {
                                        const filteredOrders = productionOrders.filter(order => {
                                            const query = orderListSearchQuery.toLowerCase().trim();
                                            if (!query) return true;
                                            
                                            const customer = customers[order.customerId];
                                            const customerName = (customer?.company || customer?.name || order.customerId || '').toLowerCase();
                                            const title = (order.title || '').toLowerCase();
                                            const portalId = (order.portalId || '').toLowerCase();
                                            const id = (order.id || '').toLowerCase();

                                            return customerName.includes(query) || title.includes(query) || portalId.includes(query) || id.includes(query);
                                        });

                                        if (filteredOrders.length === 0) {
                                            return <div className="text-xs text-zinc-400 text-center mt-4">No active production orders found.</div>;
                                        }

                                        return filteredOrders.map(order => {
                                            const customer = customers[order.customerId];
                                            const customerName = customer ? (customer.company || customer.name) : (order.customerId || 'Unknown Customer');
                                            const totalItems = order.items?.reduce((acc: number, i: any) => acc + (i.qty || 0), 0) || 0;

                                            return (
                                                <div 
                                                    key={order.id} 
                                                    onClick={() => setSelectedOrder(order.id)}
                                                    className={`group flex flex-col p-3 rounded cursor-pointer border transition-all ${selectedOrder === order.id ? 'bg-purple-50 border-purple-300 shadow-sm' : 'bg-white border-zinc-200 hover:border-purple-200'}`}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-xs font-bold text-zinc-500">Order #{order.portalId || order.id.slice(0, 6)}</span>
                                                        {order.date && <span className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-medium">Due: {order.date}</span>}
                                                    </div>
                                                    <div className="text-sm font-bold text-zinc-800 mt-1">{customerName}</div>
                                                    <div className="text-xs text-zinc-600 truncate mt-0.5">{order.title || 'Untitled Order'}</div>
                                                    <div className="text-[10px] text-purple-600 font-semibold mt-1">
                                                        {totalItems} item{totalItems !== 1 ? 's' : ''} in production
                                                    </div>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            {/* Right Panel: Assign Order */}
                            <div className="w-1/2 flex flex-col bg-white">
                                <div className="p-4 flex-1 flex flex-col overflow-hidden">
                                    {!selectedOrder ? (
                                        <div className="h-full flex items-center justify-center text-sm text-zinc-400 text-center px-4">
                                            Select an order from the left to assign it to team members.
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-4 flex-1 min-h-0">
                                            <div className="shrink-0">
                                                <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider">1. Select Start Time</div>
                                                <input 
                                                    type="time" 
                                                    value={orderStartTime}
                                                    onChange={e => setOrderStartTime(e.target.value)}
                                                    className="w-full text-sm p-2 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-purple-500"
                                                />
                                            </div>

                                            <div className="shrink-0">
                                                <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider">2. Estimated Duration (Minutes)</div>
                                                <input 
                                                    type="number" 
                                                    value={orderDuration}
                                                    onChange={e => setOrderDuration(e.target.value)}
                                                    className="w-full text-sm p-2 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-purple-500"
                                                    placeholder="120"
                                                />
                                            </div>

                                            <div className="flex flex-col flex-1 min-h-0">
                                                <div className="text-xs font-bold text-zinc-600 mb-2 uppercase tracking-wider shrink-0">3. Select Team Members</div>
                                                <input
                                                    type="text"
                                                    placeholder="Search team members..."
                                                    value={orderSearchQuery}
                                                    onChange={e => setOrderSearchQuery(e.target.value)}
                                                    className="w-full text-sm p-2 border border-zinc-300 rounded outline-none focus:ring-2 focus:ring-purple-500 mb-2 shrink-0"
                                                />
                                                <div className="space-y-1 flex-1 overflow-y-auto border border-zinc-200 rounded p-1 min-h-0">
                                                    {teamMembers
                                                        .filter(u => u.name.toLowerCase().includes(orderSearchQuery.toLowerCase()))
                                                        .sort((a, b) => a.name.localeCompare(b.name))
                                                        .map(u => (
                                                        <label key={u.id} className="flex items-center gap-2 p-1.5 hover:bg-zinc-50 rounded cursor-pointer">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={orderSelectedUsers.includes(u.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) setOrderSelectedUsers([...orderSelectedUsers, u.id]);
                                                                    else setOrderSelectedUsers(orderSelectedUsers.filter(id => id !== u.id));
                                                                }}
                                                                className="rounded border-zinc-300 text-purple-600 focus:ring-purple-500"
                                                            />
                                                            <span className="text-sm font-medium text-zinc-700">{u.name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 border-t border-zinc-100 bg-zinc-50 shrink-0">
                                    <button
                                        onClick={handleAssignOrderTask}
                                        disabled={!selectedOrder || orderSelectedUsers.length === 0}
                                        className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg shadow disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <Plus className="w-4 h-4" /> Add Order to Planners
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
