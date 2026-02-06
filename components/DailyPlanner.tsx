import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Smartphone, LayoutGrid, Clock, AlertCircle } from 'lucide-react';
import { User, DailySchedule, ScheduleBlock } from '../types';
import { supplyWatchService } from '../services/supplyWatchService';

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

    // Group blocks by user
    const userBlocks = users.reduce((acc, user) => {
        const blocks = schedule?.blocks.filter(b => b.assignedTo === user.id) || [];
        acc[user.id] = blocks;
        return acc;
    }, {} as Record<string, ScheduleBlock[]>);

    // Filter out clients - only show team members (non-client users)
    const teamMembers = users.filter(u => u.role !== 'client' && u.username);

    // If user is not admin, manager, or a public terminal, only show their own row
    const canSeeAll = currentUser?.role === 'admin' || currentUser?.role === 'manager' || currentUser?.role === 'terminal';
    const visibleUsers = canSeeAll
        ? teamMembers
        : teamMembers.filter(u => u.id === currentUser?.id);

    const sortedUsers = [...visibleUsers].sort((a, b) => a.name.localeCompare(b.name));

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-50">
                <div>
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-gray-500" />
                        Daily Planner
                    </h2>
                    <p className="text-xs text-gray-500">AI-powered schedule generation from voice notes</p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="flex bg-white rounded-lg border border-gray-300 shadow-sm p-1 items-center">
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

                    <button
                        onClick={() => { setCurrentDate(new Date()) }}
                        className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${isToday(currentDate) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                    >
                        Today
                    </button>
                </div>
            </div>

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

            {!loading && !error && (
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
                            <div className="absolute inset-0 flex pl-48 pointer-events-none">
                                {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => (
                                    <div key={i} className="flex-1 border-l border-gray-100 h-full last:border-r" />
                                ))}
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
                                                    style={{ left: styles.left, width: styles.width }}
                                                    className={styles.className + " group"}
                                                    title={`${block.title} (${new Date(block.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${new Date(block.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`}
                                                >
                                                    {block.title}
                                                    {/* Tooltip-ish Details on hover could go here */}
                                                    <div className="hidden group-hover:block absolute top-full left-0 bg-gray-800 text-white text-xs p-2 rounded shadow-lg z-50 w-48 mt-1 whitespace-normal">
                                                        <div className="font-bold mb-1">{block.title}</div>
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
            )}

            {/* Footer / Legend */}
            <div className="p-4 border-t border-gray-200 bg-white flex flex-wrap gap-4 text-xs">
                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${STATUS_COLORS[key as keyof typeof STATUS_COLORS].split(' ')[0]}`}></div>
                        <span className="text-gray-600 font-medium">{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
