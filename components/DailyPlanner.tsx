import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Smartphone, LayoutGrid, Clock, AlertCircle, Wand2, Mic, CheckCircle, Trash2, Plus, Send, X, Users, Save, Copy } from 'lucide-react';
import { User, DailySchedule, ScheduleBlock } from '../types';
import { supplyWatchService } from '../services/supplyWatchService';
import { subscribeToShiftBlocks, firebaseSaveShiftBlock, firebaseDeleteShiftBlock } from '../services/firebaseService';
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
    active: 'bg-blue-500 text-white border-blue-600',
    pending: 'bg-orange-400 text-white border-orange-500', // "Not Started" / "Print 1..."
    completed: 'bg-green-500 text-white border-green-600',
    delayed: 'bg-red-500 text-white border-red-600',
    default: 'bg-gray-400 text-white border-gray-500'
};

const STATUS_LABELS = {
    active: 'Active',
    pending: 'Not Started',
    completed: 'Complete',
    delayed: 'Delayed'
};

export const DailyPlanner: React.FC<Props> = ({ users, currentUser }) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [schedule, setSchedule] = useState<DailySchedule | null>(null);
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
    const [editStart, setEditStart] = useState('');
    const [editEnd, setEditEnd] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    // Shift Blocks State (From Firebase)
    const [shiftBlocks, setShiftBlocks] = useState<ScheduleBlock[]>([]);

    const isAdminOrManager = (() => {
        let currentPerms: string[] = [];
        if (currentUser) {
            if (Array.isArray(currentUser.permissions)) currentPerms = currentUser.permissions;
            else if (typeof currentUser.permissions === 'string') currentPerms = currentUser.permissions.split(',').map((s: string) => s.trim());
        }
        const hasAdmin = currentPerms.includes('admin') || (currentUser?.role?.toLowerCase() === 'admin' && currentPerms.length === 0);
        const hasManager = currentPerms.includes('manage_team') || (currentUser?.role?.toLowerCase() === 'manager' && currentPerms.length === 0);
        return (hasAdmin || hasManager) && currentUser?.username?.toLowerCase() !== 'warehouse';
    })();

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

    useEffect(() => {
        // Subscribe to shifts purely from Firebase and actively trim duplicates
        const unsubscribe = subscribeToShiftBlocks((blocks: any[]) => {
            const seen = new Set<string>();
            const uniqueBlocks: ScheduleBlock[] = [];
            const toDelete: string[] = [];

            blocks.forEach(b => {
                const key = `${b.assignedTo}-${b.startTime}-${b.endTime}`;
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

    useEffect(() => {
        const fetchSchedule = async () => {
            setLoading(true);
            setError(null);
            try {
                const replitUrl = localStorage.getItem('replitAppUrl');
                const token = localStorage.getItem('chronoAuthToken');

                if (replitUrl && token) {
                    const data = await supplyWatchService.getDailySchedule(replitUrl, token, currentDate);
                    setSchedule(data);
                }
            } catch (err: any) {
                console.error("Error loading schedule:", err);
                setError("Failed to load schedule. Ensure you are connected to Supply Watch.");
            } finally {
                setLoading(false);
            }
        };

        fetchSchedule();
    }, [currentDate]);

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
        setError(null);

        try {
            const replitUrl = localStorage.getItem('replitAppUrl');
            const token = localStorage.getItem('chronoAuthToken');

            if (replitUrl && token) {
                const result = await supplyWatchService.generateSchedule(replitUrl, token, transcript, currentDate);
                setSchedule(prev => ({
                    ...prev,
                    id: result.schedule.id,
                    date: result.schedule.date,
                    blocks: [...(prev?.blocks || []), ...result.blocks]
                } as any));
                setUnassignedBlocks(result.unassignedBlocks || []);
                setTranscript('');
                alert("AI Schedule Generated! Review tasks below.");
            }
        } catch (err: any) {
            console.error("Generation failed:", err);
            setError("AI generation failed. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDuplicateSchedule = async () => {
        const todayShifts = shiftBlocks.filter((b) => {
            const bDate = new Date(b.startTime);
            return bDate.getDate() === currentDate.getDate() && bDate.getMonth() === currentDate.getMonth() && bDate.getFullYear() === currentDate.getFullYear();
        });

        const hasTasks = (schedule?.blocks?.filter(b => !b.title.startsWith('[SHIFT]'))?.length || 0) > 0;
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
            const replitUrl = localStorage.getItem('replitAppUrl');
            const token = localStorage.getItem('chronoAuthToken');
            if (!replitUrl || !token) return;

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
                if (activeView === 'tasks') {
                    // Generate an initial schedule container for the chosen date
                    const targetGenResult = await supplyWatchService.generateSchedule(replitUrl, token, "Initialize schedule structure", tDate);
                    const targetScheduleId = targetGenResult.schedule?.id;
                    if (!targetScheduleId) throw new Error(`Could not initialize target schedule for ${tDate.toLocaleDateString()}`);

                    // Iterate all scheduled blocks from current day and copy them
                    for (const block of schedule.blocks) {
                        if (block.title.startsWith('[SHIFT]')) continue; // Skip legacy shifts

                        const bStart = new Date(block.startTime);
                        const bEnd = new Date(block.endTime);

                        const newStart = new Date(tDate);
                        newStart.setHours(bStart.getHours(), bStart.getMinutes(), 0, 0);

                        const newEnd = new Date(tDate);
                        newEnd.setHours(bEnd.getHours(), bEnd.getMinutes(), 0, 0);

                        const blockData = {
                            title: block.title,
                            description: block.description || '',
                            startTime: newStart.toISOString(),
                            endTime: newEnd.toISOString(),
                            assignedTo: block.assignedTo,
                            status: 'pending',
                            priority: block.priority || 'medium'
                        };

                        await supplyWatchService.createScheduleBlock(replitUrl, token, targetScheduleId, blockData);
                        totalCopies++;
                    }
                } else if (activeView === 'shifts') {
                    for (const shift of todayShifts) {
                        const bStart = new Date(shift.startTime);
                        const bEnd = new Date(shift.endTime);
                        const newStart = new Date(tDate);
                        newStart.setHours(bStart.getHours(), bStart.getMinutes(), 0, 0);
                        const newEnd = new Date(tDate);
                        newEnd.setHours(bEnd.getHours(), bEnd.getMinutes(), 0, 0);

                        // Skip duplicating if they already have this exact shift
                        const exists = shiftBlocks.some(b =>
                            b.assignedTo === shift.assignedTo &&
                            new Date(b.startTime).getTime() === newStart.getTime() &&
                            new Date(b.endTime).getTime() === newEnd.getTime()
                        );

                        if (!exists) {
                            await firebaseSaveShiftBlock({
                                title: shift.title,
                                description: shift.description || '',
                                startTime: newStart.toISOString(),
                                endTime: newEnd.toISOString(),
                                assignedTo: shift.assignedTo,
                                status: 'pending',
                                priority: 'medium'
                            });
                            totalCopies++;
                        }
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

    const handleBlockClick = (block: ScheduleBlock) => {
        if (!isAdminOrManager) return;
        setEditingBlock(block);

        const start = new Date(block.startTime);
        setEditStart(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);

        const end = new Date(block.endTime);
        setEditEnd(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);

        setEditNotes(block.description || '');
    };

    const handleSaveEdit = async () => {
        if (!editingBlock) return;
        setIsUpdating(true);
        try {
            const replitUrl = localStorage.getItem('replitAppUrl');
            const token = localStorage.getItem('chronoAuthToken');
            if (replitUrl && token) {
                const bStart = new Date(editingBlock.startTime);
                const [sh, sm] = editStart.split(':').map(Number);
                bStart.setHours(sh, sm, 0, 0);

                const bEnd = new Date(editingBlock.endTime);
                const [eh, em] = editEnd.split(':').map(Number);
                bEnd.setHours(eh, em, 0, 0);

                const blockData = {
                    title: editingBlock.title,
                    description: editNotes,
                    startTime: bStart.toISOString(),
                    endTime: bEnd.toISOString(),
                    assignedTo: editingBlock.assignedTo,
                    status: editingBlock.status,
                    priority: editingBlock.priority || 'medium'
                };

                if (editingBlock.title.startsWith('[SHIFT]')) {
                    await firebaseSaveShiftBlock({ ...blockData, id: editingBlock.id });
                    // No need to update state manually, onSnapshot catches it
                    // But we can clear the editing block
                    setEditingBlock(null);
                } else {
                    const updatedBlock = await supplyWatchService.updateScheduleBlock(replitUrl, token, editingBlock.id, blockData);

                    setSchedule(prev => prev ? {
                        ...prev,
                        blocks: prev.blocks.map(b => b.id === editingBlock.id ? updatedBlock : b)
                    } : null);

                    setEditingBlock(null);
                }
            }
        } catch (err) {
            alert("Failed to update schedule block.");
        } finally {
            setIsUpdating(false);
        }
    };

    const handlePublish = async () => {
        if (!schedule?.id) return;
        setLoading(true);

        try {
            const replitUrl = localStorage.getItem('replitAppUrl');
            const token = localStorage.getItem('chronoAuthToken');

            if (replitUrl && token) {
                await supplyWatchService.publishSchedule(replitUrl, token, schedule.id);
                setIsPlanningMode(false);
                alert("Schedule Published! Notifications sent to team.");
            }
        } catch (err) {
            setError("Failed to publish schedule.");
        } finally {
            setLoading(false);
        }
    };

    const handleAssignBlock = async (tempBlock: any, userId: string) => {
        // Time Off Warning
        const targetUser = users.find(u => u.id === userId);
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
                if (!confirm(`Warning: ${targetUser.name} has an active TIME OFF request for this date! Are you sure you want to assign them this task?`)) {
                    return;
                }
            }
        }

        try {
            const replitUrl = localStorage.getItem('replitAppUrl');
            const token = localStorage.getItem('chronoAuthToken');

            if (replitUrl && token && schedule?.id) {
                const result = await supplyWatchService.createScheduleBlock(replitUrl, token, schedule.id, {
                    ...tempBlock,
                    assignedTo: userId
                });

                // Add to visible blocks
                setSchedule(prev => prev ? {
                    ...prev,
                    blocks: [...prev.blocks, result]
                } : null);

                // Remove from unassigned
                setUnassignedBlocks(prev => prev.filter(b => b.tempId !== tempBlock.tempId));
            }
        } catch (err) {
            alert("Failed to assign task.");
        }
    };

    const handleDeleteBlock = async (blockId: string, isShift: boolean = false) => {
        if (!confirm("Delete this?")) return;
        try {
            if (isShift) {
                await firebaseDeleteShiftBlock(blockId);
            } else {
                const replitUrl = localStorage.getItem('replitAppUrl');
                const token = localStorage.getItem('chronoAuthToken');

                if (replitUrl && token) {
                    await supplyWatchService.deleteScheduleBlock(replitUrl, token, blockId);
                    setSchedule(prev => prev ? {
                        ...prev,
                        blocks: prev.blocks.filter(b => b.id !== blockId)
                    } : null);
                }
            }
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

    const getBlockStyles = (block: ScheduleBlock) => {
        // Calculate position
        const start = new Date(block.startTime);
        const end = new Date(block.endTime);

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

        if (block.status === 'in_progress') colorClass = STATUS_COLORS.active;
        else if (block.status === 'completed') colorClass = STATUS_COLORS.completed;
        else if (block.status === 'delayed') colorClass = STATUS_COLORS.delayed;
        else if (block.status === 'pending') colorClass = STATUS_COLORS.pending;

        return {
            left: `${left}%`,
            width: `${width}%`,
            className: `absolute top-1 bottom-1 rounded-md text-xs font-medium px-2 py-1 truncate shadow-sm border-l-4 ${colorClass} hover:opacity-90 transition-opacity cursor-pointer`
        };
    };

    // Group blocks by user and filter based on active view
    const userBlocks = users.reduce((acc, user) => {
        if (activeView === 'shifts') {
            acc[user.id] = shiftBlocks.filter(b => {
                const bDate = new Date(b.startTime);
                return b.assignedTo === user.id && bDate.getDate() === currentDate.getDate() && bDate.getMonth() === currentDate.getMonth() && bDate.getFullYear() === currentDate.getFullYear();
            });
        } else {
            const userBlocksRaw = schedule?.blocks.filter(b => b.assignedTo === user.id) || [];
            acc[user.id] = userBlocksRaw.filter(b => !b.title.startsWith('[SHIFT]'));
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-50 z-50 relative">
                <div className="flex gap-4 items-center">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-gray-500" />
                            Daily Planner
                        </h2>
                        <p className="text-xs text-gray-500">
                            {activeView === 'tasks' ? 'Task assignment based on workload' : 'Auto-clock out parameters'}
                        </p>
                    </div>

                    <div className="flex bg-gray-200 p-1 rounded-lg sm:ml-4 shadow-inner mt-2 sm:mt-0 w-full sm:w-auto">
                        <button
                            onClick={() => setActiveView('tasks')}
                            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeView === 'tasks' ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <LayoutGrid className="w-4 h-4 inline-block mr-1" />
                            Tasks
                        </button>
                        <button
                            onClick={() => setActiveView('shifts')}
                            className={`flex-1 sm:flex-none px-4 py-1.5 text-sm font-bold rounded-md transition-all ${activeView === 'shifts' ? 'bg-white shadow text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <Clock className="w-4 h-4 inline-block mr-1" />
                            Shift Schedules
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {isAdminOrManager && activeView === 'tasks' && (
                        <button
                            onClick={() => setIsPlanningMode(!isPlanningMode)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all shadow-sm border ${isPlanningMode
                                ? 'bg-orange-600 border-orange-700 text-white animate-pulse'
                                : 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700'
                                }`}
                        >
                            <Wand2 className="w-4 h-4" />
                            {isPlanningMode ? 'Exit Planning Mode' : 'Build Schedule'}
                        </button>
                    )}

                    <div className="flex bg-white rounded-lg border border-gray-300 shadow-sm p-1 items-center ml-2">
                        <button onClick={handlePrevDay} className="p-1 hover:bg-gray-100 rounded text-gray-600">
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="px-3 text-sm font-medium text-gray-800 min-w-[120px] text-center">
                            {currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </span>
                        <button onClick={handleNextDay} className="p-1 hover:bg-gray-100 rounded text-gray-600">
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        {activeView === 'shifts' && (
                            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                                {['day', 'week', 'month'].map(view => (
                                    <button
                                        key={view}
                                        onClick={() => setShiftTimeframe(view as any)}
                                        className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-shadow ${shiftTimeframe === view ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                                    >
                                        {view}
                                    </button>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={() => { setCurrentDate(new Date()) }}
                            className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${isToday(currentDate) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                        >
                            Today
                        </button>

                        {isAdminOrManager && (
                            <div className="relative">
                                <button
                                    onClick={() => setIsDuplicating(!isDuplicating)}
                                    className={`text-xs px-2 py-2 rounded-lg border font-medium transition-colors flex items-center gap-1 ${isDuplicating ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                                    title="Duplicate Schedule"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>

                                {isDuplicating && (
                                    <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 p-3 rounded-xl shadow-xl z-50 min-w-[250px] animate-fade-in flex flex-col gap-3">
                                        <div className="text-sm font-bold text-gray-800">Duplicate {activeView === 'shifts' ? 'Shifts' : 'Tasks'}</div>
                                        <div className="text-xs text-gray-500 mb-2">Select a date to copy all {activeView === 'shifts' ? 'shift schedules' : 'tasks'} from this day.</div>
                                        <input
                                            type="date"
                                            value={duplicateTargetDate}
                                            onChange={(e) => setDuplicateTargetDate(e.target.value)}
                                            className="w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                        />
                                        <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={duplicateWholeWeek}
                                                onChange={(e) => setDuplicateWholeWeek(e.target.checked)}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            Apply to entire work week (Mon-Fri)
                                        </label>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setIsDuplicating(false)}
                                                className="flex-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-300"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleDuplicateSchedule}
                                                disabled={!duplicateTargetDate || (activeView === 'tasks' ? (schedule?.blocks?.filter(b => !b.title.startsWith('[SHIFT]'))?.length || 0) === 0 : !shiftBlocks.some(b => {
                                                    const d = new Date(b.startTime);
                                                    return d.getDate() === currentDate.getDate() && d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
                                                }))}
                                                className="flex-1 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg font-bold transition-colors shadow-sm"
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
                                disabled={!schedule?.blocks.length || loading}
                                className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold shadow-lg shadow-green-100 transition-all disabled:opacity-50"
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
                                                <div className="font-bold text-gray-800 text-sm">{block.title}</div>
                                                <div className="text-[10px] text-gray-500">
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
                <div className="bg-indigo-50 border-b border-indigo-100 p-4 shrink-0 relative z-10">
                    <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-4">
                        <div className="flex items-center gap-2 text-indigo-900 font-bold shrink-0">
                            <Clock className="w-5 h-5 text-indigo-600" />
                            Add Expected Shift
                        </div>

                        <div className="flex-1 flex flex-wrap gap-2 items-center w-full">
                            <select
                                value={shiftUser}
                                onChange={(e) => setShiftUser(e.target.value)}
                                className="px-3 py-2 text-sm rounded bg-white border border-indigo-200 focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px] flex-1 md:flex-none"
                            >
                                <option value="" disabled>Select Staff Member...</option>
                                {teamMembers.map(u => (
                                    <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                            </select>

                            <div className="flex items-center gap-2 bg-white rounded border border-indigo-200 px-2 py-1 shadow-inner">
                                <input
                                    type="time"
                                    value={shiftStart}
                                    onChange={(e) => setShiftStart(e.target.value)}
                                    className="text-sm outline-none px-1"
                                />
                                <span className="text-indigo-300 font-bold">to</span>
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
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow disabled:opacity-50 flex items-center gap-2 transition-colors ml-auto md:ml-0"
                            >
                                <Plus className="w-4 h-4" /> Add
                            </button>
                        </div>
                    </div>
                    <p className="text-xs text-indigo-700 mt-2 text-center md:text-left max-w-4xl mx-auto">
                        Setting shift hours ensures users are automatically clocked out if they forget, enforcing a correct duration (includes a 10 min grace period after the shift ends).
                    </p>
                </div>
            )}

            {loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
                        <div className="flex border-b border-gray-200 bg-white sticky top-0 z-20">
                            <div className="w-48 p-3 border-r border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky left-0 z-30">
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
                                            className="absolute top-0 bottom-0 border-l border-gray-100 flex flex-col justify-end pb-2"
                                            style={{ left: `${left}%` }}
                                        >
                                            <span className="text-[10px] text-gray-400 pl-1 transform -translate-x-1/2">
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
                                <div className="relative w-full h-full">
                                    {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="absolute top-0 bottom-0 border-l border-gray-100"
                                            style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Current Time Indicator */}
                            {isToday(currentDate) && currentTimePercentage !== null && (
                                <div
                                    className="absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none"
                                    style={{ left: `calc(12rem + ${currentTimePercentage}% - (12rem * ${currentTimePercentage / 100}))` }}
                                // Math explanation: 
                                // The container is flex-row. The left 12rem is the sidebar. The right is grid.
                                // Wait, position absolute is relative to the "flex-1 relative" container above.
                                // But that container includes width of sidebar? No, sidebar is in the Row flex.
                                // Actually the sidebar and grid content are in the rows below.
                                // Let's restructure to have a single grid container background.
                                >
                                    <div className="bg-red-500 text-white text-[10px] font-bold px-1 rounded absolute -top-2 left-1/2 transform -translate-x-1/2">
                                        {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                    </div>
                                </div>
                            )}

                            {/* Rows */}
                            {sortedUsers.map(user => (
                                <div key={user.id} className="flex border-b border-gray-100 hover:bg-gray-50/50 transition-colors h-16 relative">
                                    {/* User Info (Sticky Left) */}
                                    <div className="w-48 border-r border-gray-200 p-3 bg-white sticky left-0 z-10 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center font-bold text-xs ring-2 ring-white shadow-sm">
                                            {user.avatarInitials}
                                        </div>
                                        <span className="text-sm font-medium text-gray-700 truncate">{user.name}</span>
                                    </div>

                                    {/* Timeline Area for this User */}
                                    <div className="flex-1 relative h-full">
                                        {/* Render Blocks */}
                                        {(userBlocks[user.id] || []).map(block => {
                                            const styles = getBlockStyles(block);
                                            return (
                                                <div
                                                    key={block.id}
                                                    onClick={() => handleBlockClick(block)}
                                                    style={{ left: styles.left, width: styles.width }}
                                                    className={styles.className + " group " + (isAdminOrManager ? "cursor-pointer" : "")}
                                                    title={`${block.title} (${new Date(block.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(block.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`}
                                                >
                                                    {block.title}
                                                    {/* Tooltip-ish Details */}
                                                    <div className="hidden group-hover:block absolute top-full left-0 bg-gray-800 text-white text-xs p-2 rounded shadow-lg z-50 w-48 mt-1 whitespace-normal">
                                                        <div className="flex justify-between items-start mb-1">
                                                            <div className="font-bold">{activeView === 'shifts' ? 'Shift Schedule' : block.title}</div>
                                                            {(isAdminOrManager) && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteBlock(block.id, activeView === 'shifts');
                                                                    }}
                                                                    className="p-1 hover:bg-red-500 rounded transition-colors"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="opacity-80 mb-1">{block.description}</div>
                                                        <div className="text-[10px] opacity-60">Status: {block.status}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {/* Empty State if no users */}
                            {sortedUsers.length === 0 && (
                                <div className="p-8 text-center text-gray-400">
                                    No team members found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            {/* Footer / Legend */}
            {shiftTimeframe === 'day' && (
                <div className="p-4 border-t border-gray-200 bg-white flex flex-wrap gap-4 text-xs">
                    {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[key as keyof typeof STATUS_COLORS].split(' ')[0]}`}></div>
                            <span className="text-gray-600 font-medium">{label}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Edit Block Dialog */}
            {editingBlock && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md overflow-hidden animate-fade-in">
                        <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-indigo-600" />
                                {editingBlock.title.startsWith('[SHIFT]') ? 'Edit Expected Shift' : 'Edit Task Block'}
                            </h3>
                            <button onClick={() => setEditingBlock(null)} className="p-1 hover:bg-gray-200 rounded text-gray-500 transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 flex flex-col gap-4">
                            <div className="text-sm font-medium text-gray-700 bg-gray-50 p-2 rounded border border-gray-100">
                                {editingBlock.title}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">Start Time</label>
                                    <input
                                        type="time"
                                        value={editStart}
                                        onChange={(e) => setEditStart(e.target.value)}
                                        className="w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-600 mb-1">End Time</label>
                                    <input
                                        type="time"
                                        value={editEnd}
                                        onChange={(e) => setEditEnd(e.target.value)}
                                        className="w-full text-sm p-2 border border-gray-300 rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-600 mb-1">Notes / Description</label>
                                <textarea
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    placeholder="Add any notes relevant to this schedule schedule..."
                                    className="w-full h-24 p-2 border border-gray-300 rounded resize-none text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                ></textarea>
                            </div>
                        </div>
                        <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
                            <button
                                onClick={() => setEditingBlock(null)}
                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                disabled={isUpdating}
                                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow transition-colors flex items-center gap-2 disabled:opacity-50"
                            >
                                {isUpdating ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
