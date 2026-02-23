
import { WorkLog, Department } from '../types';

/**
 * Service to communicate with the Supply Watch Replit App
 */
export const supplyWatchService = {

    /**
     * Helper to parse messy Replit time strings into numeric timestamps
     */
    parseReplitTime: (str: any) => {
        if (!str) return Date.now();
        const s = String(str);

        // 1. ISO/Timestamp
        if (s.includes('T') || (s.length > 10 && !isNaN(Number(s)))) {
            const d = new Date(isNaN(Number(s)) ? s : Number(s));
            if (!isNaN(d.getTime())) return d.getTime();
        }

        // 2. Relative time regex (9:13 AM)
        const match = s.match(/(\d{1,2}):(\d{2})(\s*[AaPp][Mm])?/);
        if (match) {
            const now = new Date();
            let h = parseInt(match[1]);
            const m = parseInt(match[2]);
            const ampm = match[3]?.trim().toLowerCase();
            if (ampm === 'pm' && h < 12) h += 12;
            if (ampm === 'am' && h === 12) h = 0;
            now.setHours(h, m, 0, 0);
            return now.getTime();
        }

        // 3. Fallback to start of today for stability
        const d = new Date(s);
        if (!isNaN(d.getTime())) return d.getTime();
        const today = new Date();
        today.setHours(8, 0, 0, 0); // Default to 8am today
        return today.getTime();
    },

    /**
     * Syncs an activity log to the Replit backend
     */
    syncLog: async (log: WorkLog, replitUrl: string, token?: string) => {
        try {
            // Map ChronoTrack Department to Replit Department enum if needed
            // Replit schema uses: Design, Print, Warehousing, Production, Facility, Event
            // ChronoTrack uses the same, so direct mapping is likely fine.

            const payload = {
                userId: log.userId,  // Only works if IDs match, might need email lookup
                userName: log.userName,
                department: log.department,
                task: log.task,
                startTime: new Date(log.periodStart).toISOString(),
                endTime: new Date(log.periodEnd).toISOString(),
                durationMinutes: (log.periodEnd - log.periodStart) / 60000,
                notes: log.notes,
                // Add production data if available
                productionQuantity: log.productionData?.quantity,
                projectReference: log.productionData?.projectName
            };

            const response = await fetch(`${replitUrl}/api/daily-planner/logs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Sync failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to sync to Replit:", error);
            throw error;
        }
    },

    /**
     * Fetches daily goals/plans from Replit
     */
    getDailyPlan: async (replitUrl: string, date: string) => {
        try {
            const response = await fetch(`${replitUrl}/api/daily-planner?date=${date}`);
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch daily plan:", error);
            return null;
        }
    },

    /**
     * Fetches all users from Replit backend
     */
    getUsers: async (replitUrl: string, token: string) => {
        try {
            // Clean URL (remove trailing slash)
            const baseUrl = replitUrl.replace(/\/$/, '');

            const response = await fetch(`${baseUrl}/api/users`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                // Determine if it is a 404 (route doesn't exist) or 401/403
                if (response.status === 404) {
                    console.warn("API /api/users not found. Checking if /api/team or similar exists or defaulting.");
                }
                throw new Error(`Failed to fetch users: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to fetch users from Replit:", error);
            throw error;
        }
    },

    /**
     * Fetches daily schedule and blocks for a specific date
     */
    getDailySchedule: async (replitUrl: string, token: string, date: Date) => {
        const baseUrl = replitUrl.replace(/\/$/, '');
        const dateISO = date.toISOString().split('T')[0];
        const dateLocale = date.toLocaleDateString('en-CA'); // YYYY-MM-DD

        const tryEndpoints = [
            `/api/daily-planner?date=${dateLocale}`,
            `/api/daily-planner?date=${dateISO}`,
            `/api/daily-schedules/date/${dateLocale}`,
            `/api/daily-schedules/date/${dateISO}`
        ];

        for (const endpoint of tryEndpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data && data.blocks && Array.isArray(data.blocks)) {
                        data.blocks = data.blocks.map((b: any) => {
                            const rawCheckIns = b.checkIns || b.checkins || b.logs || b.activity || b.history || b.updates || b.statusHistory || [];
                            const normalizedCheckIns = Array.isArray(rawCheckIns) ? rawCheckIns.map((ci: any) => ({
                                ...ci,
                                timestamp: this.parseReplitTime(ci.timestamp || ci.time || ci.createdAt || ci.created_at || ci.updatedAt),
                                status: ci.status || ci.text || ci.comment || (ci.progress !== undefined ? `Active (${ci.progress}%)` : 'Check-in'),
                                notes: ci.notes || ci.note || ci.comment || ci.text || ''
                            })) : [];

                            return {
                                ...b,
                                assignedToName: b.assignedToName || b.assigned_to_name || b.userName || b.username || b.ownerName,
                                checkIns: normalizedCheckIns
                            };
                        });
                    }
                    return data;
                }
            } catch (e) {
                console.warn(`[ReplitSync] Failed to fetch schedule from ${endpoint}`);
            }
        }
        return null;
    },

    /**
     * Generates a schedule using AI from a transcript
     */
    generateSchedule: async (replitUrl: string, token: string, transcript: string, date: Date) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/daily-schedules/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ transcript, date: date.toISOString() })
            });

            if (!response.ok) {
                throw new Error(`Failed to generate schedule: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to generate schedule:", error);
            throw error;
        }
    },

    /**
     * Creates a new schedule block
     */
    createScheduleBlock: async (replitUrl: string, token: string, scheduleId: string, blockData: any) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/daily-schedules/${scheduleId}/assign-block`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(blockData)
            });

            if (!response.ok) {
                throw new Error(`Failed to create block: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to create schedule block:", error);
            throw error;
        }
    },

    /**
     * Updates an existing schedule block
     */
    updateScheduleBlock: async (replitUrl: string, token: string, blockId: string, blockData: any) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/schedule-blocks/${blockId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(blockData)
            });

            if (!response.ok) {
                throw new Error(`Failed to update block: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to update schedule block:", error);
            throw error;
        }
    },

    /**
     * Deletes a schedule block
     */
    deleteScheduleBlock: async (replitUrl: string, token: string, blockId: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/schedule-blocks/${blockId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to delete block: ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error("Failed to delete schedule block:", error);
            throw error;
        }
    },

    /**
     * Publishes a schedule (notifies team)
     */
    publishSchedule: async (replitUrl: string, token: string, scheduleId: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/daily-schedules/${scheduleId}/publish`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to publish schedule: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to publish schedule:", error);
            throw error;
        }
    },

    /**
     * Gets active user sessions for the day
     */
    getActiveSessions: async (replitUrl: string, token: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/active-sessions`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch active sessions: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to fetch active sessions:", error);
            throw error;
        }
    },

    /**
     * Clocks in a user
     */
    clockIn: async (replitUrl: string, token: string, userId: string, workspaceType?: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/clock-in`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId, workspaceType })
            });

            if (!response.ok) {
                throw new Error(`Failed to clock in: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to clock in:", error);
            throw error;
        }
    },

    /**
     * Clocks out a user
     */
    clockOut: async (replitUrl: string, token: string, userId: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/clock-out`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId })
            });

            if (!response.ok) {
                throw new Error(`Failed to clock out: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to clock out:", error);
            throw error;
        }
    },

    /**
     * Updates user information in Replit backend
     */
    updateUser: async (replitUrl: string, token: string, userId: string, userData: any) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/users/${userId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(userData)
            });

            if (!response.ok) {
                throw new Error(`Failed to update user: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to update user in Replit:", error);
            throw error;
        }
    },

    /**
     * Deletes a user from Replit backend
     */
    deleteUser: async (replitUrl: string, token: string, userId: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to delete user: ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error("Failed to delete user in Replit:", error);
            throw error;
        }
    },

    /**
     * Creates a new user in Replit backend
     */
    createUser: async (replitUrl: string, token: string, userData: any) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/users`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(userData)
            });

            if (!response.ok) {
                throw new Error(`Failed to create user: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to create user in Replit:", error);
            throw error;
        }
    },

    /**
     * Fetches work logs from Replit
     */
    /**
     * Fetches work logs from Replit
     */
    getLogs: async function (replitUrl: string, token: string) {
        const tryFetch = async (endpoint: string) => {
            let baseUrl = replitUrl.replace(/\/$/, '');
            if (!baseUrl.startsWith('http')) baseUrl = `https://${baseUrl}`;

            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) return { ok: false, status: response.status };

                const contentType = response.headers.get('content-type');
                if (contentType && !contentType.includes('application/json')) {
                    return { ok: false, error: "is_html", status: response.status };
                }

                const data = await response.json();
                return { ok: true, data };
            } catch (e: any) {
                return { ok: false, error: e.message };
            }
        };

        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const todayLocale = today.toLocaleDateString('en-CA'); // YYYY-MM-DD

            const logEndpoints = [
                `/api/daily-planner/logs`,
                `/api/daily-planner/check-ins`,
                `/api/logs`,
                `/api/check-ins`
            ];
            let combinedLogs: any[] = [];

            // 1. Method A: Try "flat" log endpoints first
            for (const endpoint of logEndpoints) {
                const result = await tryFetch(endpoint);
                if (result.ok) {
                    let data = result.data;
                    if (!Array.isArray(data)) data = data.logs || data.checkIns || data.checkins || data.data || [];
                    if (Array.isArray(data) && data.length > 0) {
                        data.forEach((l: any) => {
                            const ts = this.parseReplitTime(l.timestamp || l.time || l.createdAt || l.created_at || l.updatedAt);
                            combinedLogs.push({
                                ...l,
                                id: l.id || `flat-${ts}-${l.userId || l.user_id || l.username}`,
                                userName: l.userName || l.user_name || l.name || l.ownerName || l.assignedToName,
                                userId: l.userId || l.user_id || l.assignedTo,
                                task: l.task || l.title || l.taskTitle || 'Check-in',
                                timestamp: ts,
                                notes: l.notes || l.note || l.comment || l.text || `Progress: ${l.progress || 0}%`,
                                department: l.department || l.dept
                            });
                        });
                        break; // Stop at first successful source
                    }
                }
            }

            // 2. Method B: Fetch schedule and extract/generate logs from blocks
            const scheduleEndpoints = [
                `/api/daily-planner?date=${todayLocale}`,
                `/api/daily-planner?date=${todayStr}`,
                `/api/daily-schedules/date/${todayLocale}`,
                `/api/daily-schedules/date/${todayStr}`,
                `/api/daily-planner`,
                `/api/schedules`
            ];

            for (const endpoint of scheduleEndpoints) {
                const res = await tryFetch(endpoint);
                if (res.ok) {
                    const d = res.data;
                    const blocks = d?.blocks || (Array.isArray(d) ? d : []);

                    if (Array.isArray(blocks)) {
                        for (const block of blocks) {
                            const bOwnerName = block.assignedToName || block.assigned_to_name || block.userName || block.username || block.ownerName;
                            const bOwnerId = block.assignedTo || block.assigned_to || block.userId || block.owner;
                            const bTask = block.title || block.task || block.name || 'Assigned Task';

                            // Part 1: Real Check-ins
                            const checkIns = block.checkIns || block.checkins || block.logs || block.activity || block.history || block.updates || block.statusHistory || [];
                            if (Array.isArray(checkIns) && checkIns.length > 0) {
                                checkIns.forEach((ci: any, idx: number) => {
                                    const logOwnerName = ci.userName || ci.name || ci.user_name || bOwnerName;
                                    const logOwnerId = ci.userId || ci.user_id || bOwnerId;
                                    if (!logOwnerName || ['staff', 'team', 'member', 'admin', 'unassigned'].includes(logOwnerName.toLowerCase())) return;

                                    const ts = this.parseReplitTime(ci.timestamp || ci.time || ci.createdAt || ci.created_at || ci.updatedAt);
                                    combinedLogs.push({
                                        id: ci.id || `ci-${block.id}-${idx}-${ts}`,
                                        userName: logOwnerName,
                                        userId: logOwnerId,
                                        task: bTask,
                                        timestamp: ts,
                                        notes: ci.notes || ci.note || ci.comment || ci.text || `Progress: ${ci.progress || 0}%`,
                                        department: block.department || block.dept
                                    });
                                });
                            }

                            // Part 2: State-based Logs (Stable ID)
                            const currentStatus = String(block.status || '').toLowerCase();
                            if (['active', 'in_progress', 'completed', 'in progress'].includes(currentStatus)) {
                                if (bOwnerName && !['staff', 'team', 'member', 'admin', 'unassigned'].includes(bOwnerName.toLowerCase())) {
                                    const ts = this.parseReplitTime(block.updatedAt || block.updated_at || block.endTime || block.startTime);
                                    combinedLogs.push({
                                        id: `vlog-${block.id}-${currentStatus}`, // Deterministic ID
                                        userName: bOwnerName,
                                        userId: bOwnerId,
                                        task: bTask,
                                        timestamp: ts,
                                        notes: `Replit Status: ${currentStatus === 'completed' ? 'Completed' : 'Started/Active'}`,
                                        department: block.department || block.dept
                                    });
                                }
                            }
                        }
                    }
                    break;
                }
            }

            if (combinedLogs.length > 0) {
                const seen = new Set();
                return combinedLogs.filter(l => {
                    const id = l.id;
                    if (seen.has(id)) return false;
                    seen.add(id);
                    return true;
                });
            }

            return [];
        } catch (error) {
            console.error("Deep search sync failed:", error);
            throw error;
        }
    },

    /**
     * Fetches time cards from Replit
     */
    getTimeCards: async (replitUrl: string, token: string) => {
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/daily-planner/time-cards`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error(`Failed to fetch time cards: ${response.statusText}`);
            return await response.json();
        } catch (error) {
            console.error("Failed to fetch time cards:", error);
            throw error;
        }
    }
};
