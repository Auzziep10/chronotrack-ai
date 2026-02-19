
import { WorkLog, Department } from '../types';

/**
 * Service to communicate with the Supply Watch Replit App
 */
export const supplyWatchService = {

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
                if (response.ok) return await response.json();
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
    getLogs: async (replitUrl: string, token: string) => {
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

            // 1. Try flat log endpoints first
            const logEndpoints = [
                `/api/daily-planner/logs`,
                `/api/daily-planner/check-ins`,
                `/api/logs`,
                `/api/check-ins`
            ];

            for (const endpoint of logEndpoints) {
                const result = await tryFetch(endpoint);
                if (result.ok) {
                    console.log(`[ReplitSync] Success using flat endpoint: ${endpoint}`);
                    let data = result.data;
                    if (!Array.isArray(data)) data = data.logs || data.checkIns || data.checkins || data.data || [];
                    if (Array.isArray(data) && data.length > 0) return data;
                }
            }

            // 2. FALLBACK: Fetch schedule and extract check-ins from blocks
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
                    const extractedLogs: any[] = [];
                    const d = res.data;

                    // RAW DATA DUMP: This is the most important log for me to see!
                    console.log(`[ReplitSync] RAW DATA DUMP for ${endpoint}:`, d);

                    const blocks = d?.blocks || (Array.isArray(d) ? d : []);

                    if (Array.isArray(blocks)) {
                        for (const block of blocks) {
                            // Method A: Check for explicit check-in arrays
                            const checkIns = block.checkIns || block.checkins || block.logs ||
                                block.activity || block.history || block.updates ||
                                block.statusHistory || [];

                            if (Array.isArray(checkIns) && checkIns.length > 0) {
                                checkIns.forEach((ci: any) => {
                                    extractedLogs.push({
                                        ...ci,
                                        id: ci.id || `block-${block.id}-${ci.time || ci.timestamp}`,
                                        userName: ci.userName || ci.name || block.assignedToName || block.userName,
                                        userId: ci.userId || block.assignedTo || block.userId,
                                        task: block.title || block.task || 'Staff Check-in',
                                        timestamp: ci.timestamp || ci.time || ci.createdAt || ci.created_at || ci.updatedAt,
                                        notes: ci.notes || ci.note || block.description || 'Schedule Check-in'
                                    });
                                });
                            }
                            // Method B: If no check-ins BUT task is completed/active, create a virtual log
                            else if (block.status === 'completed' || block.status === 'active' || block.status === 'in_progress') {
                                const virtualTime = block.updatedAt || block.endTime || block.startTime || Date.now();
                                extractedLogs.push({
                                    id: `vlog-${block.id}-${virtualTime}`,
                                    userName: block.assignedToName || block.userName,
                                    userId: block.assignedTo || block.userId,
                                    task: block.title || block.task || 'Completed Task',
                                    timestamp: virtualTime,
                                    notes: `Status updated to ${block.status}`
                                });
                            }
                        }
                    }
                    if (extractedLogs.length > 0) {
                        console.log(`[ReplitSync] Successfully extracted ${extractedLogs.length} logs from schedule.`);
                        return extractedLogs;
                    }
                }
            }

            throw new Error(`Connection failed. No check-ins found for today. Make sure you've submitted a check-in or marked a task as complete in Replit.`);
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
