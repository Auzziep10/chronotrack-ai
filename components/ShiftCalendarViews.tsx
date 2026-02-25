import React, { useState, useEffect } from 'react';
import { User, ScheduleBlock } from '../types';
import { supplyWatchService } from '../services/supplyWatchService';

interface Props {
    viewType: 'week' | 'month';
    currentDate: Date;
    users: User[];
    currentUser: User | null;
    onBlockClick: (block: ScheduleBlock) => void;
    firebaseShiftBlocks: ScheduleBlock[];
}

export const ShiftCalendarViews: React.FC<Props> = ({ viewType, currentDate, users, currentUser, onBlockClick, firebaseShiftBlocks }) => {
    const loading = false;

    const START_HOUR = 6;
    const END_HOUR = 20;
    const TOTAL_HOURS = END_HOUR - START_HOUR;

    const teamMembers = users.filter((u) => u.role?.trim().toLowerCase() !== 'client' && u.username);
    const isAdminOrManager = (currentUser?.role === 'admin' || currentUser?.role === 'manager') && currentUser?.username?.toLowerCase() !== 'warehouse';

    // Get array of dates to render based on viewType
    const getDatesToRender = () => {
        const dates: Date[] = [];
        if (viewType === 'week') {
            const day = currentDate.getDay();
            const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1); // Monday start
            for (let i = 0; i < 5; i++) { // Render Mon-Fri for typical business week, or 7 for full
                const d = new Date(currentDate);
                d.setDate(diff + i);
                dates.push(d);
            }
        } else {
            // Month view: standard 5x7 grid or actual days in month
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);

            // Pad to Monday
            let dayOfWeek = firstDay.getDay();
            let padDays = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

            for (let i = 0; i < padDays; i++) {
                const d = new Date(year, month, 1 - padDays + i);
                dates.push(d);
            }

            for (let i = 1; i <= lastDay.getDate(); i++) {
                dates.push(new Date(year, month, i));
            }

            // Pad end
            while (dates.length % 7 !== 0) {
                const d = new Date(year, month + 1, dates.length - padDays - lastDay.getDate() + 1);
                dates.push(d);
            }

            // Optionally cap at 5 weeks (35 days) or 6 weeks (42 days) if needed, just let it be dynamic
        }
        return dates;
    };

    const dates = getDatesToRender();

    // No need to fetch schedules via getDailySchedule anymore, we use firebaseShiftBlocks directly

    const isToday = (d: Date) => {
        const today = new Date();
        return d.getDate() === today.getDate() &&
            d.getMonth() === today.getMonth() &&
            d.getFullYear() === today.getFullYear();
    };

    if (viewType === 'week') {
        return (
            <div className="flex-1 flex flex-col bg-white min-h-0 overflow-hidden relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                )}
                {/* Header Row */}
                <div className="flex border-b border-gray-200">
                    <div className="w-16 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col items-center justify-center">
                        <span className="text-[10px] font-bold text-gray-400 uppercase">GMT</span>
                    </div>
                    {dates.map((d, i) => (
                        <div key={i} className={`flex-1 p-2 text-center border-r border-gray-100 last:border-r-0 ${isToday(d) ? 'bg-indigo-50/30' : ''}`}>
                            <div className={`text-xs font-bold uppercase ${isToday(d) ? 'text-indigo-600' : 'text-gray-500'}`}>
                                {d.toLocaleDateString('en-US', { weekday: 'short' })}
                            </div>
                            <div className={`text-xl font-light ${isToday(d) ? 'text-indigo-600' : 'text-gray-800'}`}>
                                {d.getDate()}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Grid Area */}
                <div className="flex-1 flex overflow-y-auto overflow-x-hidden relative">
                    {/* Time Column */}
                    <div className="w-16 shrink-0 flex flex-col border-r border-gray-200 bg-white relative pb-8">
                        {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => {
                            const hour = START_HOUR + i;
                            const displayHour = hour > 12 ? hour - 12 : hour;
                            const ampm = hour >= 12 ? 'pm' : 'am';
                            return (
                                <div key={i} className="h-16 relative w-full text-right pr-2">
                                    <span className="text-[10px] text-gray-500 relative -top-2">
                                        {displayHour}{ampm}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Columns */}
                    <div className="flex-1 flex pb-8 relative">
                        {/* Background lines */}
                        <div className="absolute inset-0 pointer-events-none">
                            {Array.from({ length: TOTAL_HOURS + 1 }).map((_, i) => (
                                <div key={i} className="h-16 border-t border-gray-100 w-full" />
                            ))}
                        </div>

                        {dates.map((d, colIndex) => {
                            // Find blocks for this day
                            const dayBlocks = firebaseShiftBlocks.filter((b) => {
                                const bDate = new Date(b.startTime);
                                return bDate.getDate() === d.getDate() && bDate.getMonth() === d.getMonth() && bDate.getFullYear() === d.getFullYear();
                            });

                            return (
                                <div key={colIndex} className={`flex-1 border-r border-gray-100 last:border-r-0 relative ${isToday(d) ? 'bg-indigo-50/10' : ''}`}>
                                    {dayBlocks.map((b) => {
                                        const bStart = new Date(b.startTime);
                                        const bEnd = new Date(b.endTime);
                                        const startH = bStart.getHours() + bStart.getMinutes() / 60;
                                        const endH = bEnd.getHours() + bEnd.getMinutes() / 60;

                                        let top = ((startH - START_HOUR) / TOTAL_HOURS) * 100;
                                        let height = ((endH - startH) / TOTAL_HOURS) * 100;

                                        // Ensure blocks stay within boundaries
                                        if (top < 0) {
                                            height += top;
                                            top = 0;
                                        }
                                        if (top + height > 100) height = 100 - top;

                                        const user = teamMembers.find(u => u.id === b.assignedTo);
                                        const userName = user ? user.name.split(' ')[0] : 'Unknown';

                                        return (
                                            <div
                                                key={b.id}
                                                onClick={() => onBlockClick(b)}
                                                className={`absolute left-1 right-1 rounded-md bg-orange-500 hover:bg-orange-600 text-white p-1 text-[10px] shadow border border-orange-600 cursor-pointer overflow-hidden transition-colors flex flex-col`}
                                                style={{
                                                    top: `calc(${top}% + ${Math.floor(top / 100 * (TOTAL_HOURS * 64))}px)`,
                                                    height: `max(20px, calc(${height}% + ${Math.floor(height / 100 * (TOTAL_HOURS * 64))}px))`
                                                    // Note: the container holds the lines. we use absolute percentages, but need to consider the 64px row heights. 
                                                    // Since we didn't use absolute percentages for the row container (we used h-16 fixed), top/height must be in pixels!
                                                }}
                                            >
                                                <span className="font-bold truncate">{userName}</span>
                                                <span className="truncate opacity-90">{bStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {bEnd.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    if (viewType === 'month') {
        const weeks = [];
        for (let i = 0; i < dates.length; i += 7) {
            weeks.push(dates.slice(i, i + 7));
        }

        return (
            <div className="flex-1 flex flex-col bg-white min-h-0 relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                )}
                <div className="flex grid-cols-7 border-b border-gray-200 bg-gray-50 shrink-0">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                        <div key={day} className="flex-1 py-2 text-center text-xs font-bold text-gray-500 uppercase border-r border-gray-200 last:border-r-0">
                            {day}
                        </div>
                    ))}
                </div>
                <div className="flex-1 flex flex-col overflow-y-auto">
                    {weeks.map((week, wIndex) => (
                        <div key={wIndex} className="flex-1 flex border-b border-gray-200 min-h-[120px]">
                            {week.map((d, dIndex) => {
                                const isCurrentMonth = d.getMonth() === currentDate.getMonth();
                                const dayBlocks = firebaseShiftBlocks.filter((b) => {
                                    const bDate = new Date(b.startTime);
                                    return bDate.getDate() === d.getDate() && bDate.getMonth() === d.getMonth() && bDate.getFullYear() === d.getFullYear();
                                });
                                // Sort blocks by start time
                                dayBlocks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                                return (
                                    <div key={dIndex} className={`flex-1 border-r border-gray-200 last:border-r-0 p-1 flex flex-col ${!isCurrentMonth ? 'bg-gray-50' : 'bg-white'} ${isToday(d) ? 'ring-2 ring-indigo-500 ring-inset relative z-10' : ''}`}>
                                        <div className={`text-xs p-1 ${isToday(d) ? 'text-indigo-700 font-bold' : (!isCurrentMonth ? 'text-gray-400' : 'text-gray-700 font-medium')}`}>
                                            {d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate()}
                                        </div>
                                        <div className="flex-1 overflow-y-auto space-y-1 mt-1 pr-1 custom-scrollbar">
                                            {dayBlocks.map(b => {
                                                const bStart = new Date(b.startTime);
                                                const user = teamMembers.find(u => u.id === b.assignedTo);
                                                const userName = user ? user.name.split(' ')[0] : 'Unknown';

                                                return (
                                                    <div
                                                        key={b.id}
                                                        onClick={() => onBlockClick(b)}
                                                        className="text-[10px] bg-orange-100 hover:bg-orange-200 text-orange-800 rounded px-1.5 py-1 cursor-pointer truncate flex gap-1 shadow-sm transition-colors border border-orange-200"
                                                    >
                                                        <span className="font-bold opacity-70">{bStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                                        <span className="font-semibold">{userName}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return null;
};
