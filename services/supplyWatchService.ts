
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
        try {
            const baseUrl = replitUrl.replace(/\/$/, '');
            const dateStr = date.toISOString();

            const response = await fetch(`${baseUrl}/api/daily-schedules/date/${dateStr}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 404) return null; // No schedule for this date
                throw new Error(`Failed to fetch schedule: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error("Failed to fetch daily schedule:", error);
            throw error;
        }
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

                if (!response.ok) {
                    const text = await response.text();
                    return { ok: false, status: response.status, text: text.substring(0, 50), contentType: response.headers.get('content-type') };
                }

                const contentType = response.headers.get('content-type');
                if (contentType && !contentType.includes('application/json')) {
                    return { ok: false, error: "is_html", contentType, status: response.status };
                }

                const data = await response.json();
                return { ok: true, data };
            } catch (e: any) {
                return { ok: false, error: e.message };
            }
        };

        try {
            // Try endpoints in order of likelihood for a "Daily Planner" Replit
            const endpoints = [
                '/api/daily-planner/logs',
                '/api/daily-planner/work-logs',
                '/api/daily-planner/activities',
                '/api/daily-planner/check-ins',
                '/api/planner/logs',
                '/api/planner/work-logs',
                '/api/daily_planner/logs',
                '/api/activity-logs',
                '/api/logs',
                '/api/work-logs'
            ];

            let errors: string[] = [];
            for (const endpoint of endpoints) {
                const result = await tryFetch(endpoint);
                if (result.ok) {
                    console.log(`[ReplitSync] Success using endpoint: ${endpoint}`);
                    return result.data;
                }

                if (result.error === "is_html") {
                    errors.push(`${endpoint} (HTML/404)`);
                } else if (result.status) {
                    errors.push(`${endpoint} (HTTP ${result.status})`);
                } else {
                    errors.push(`${endpoint} (${result.error})`);
                }
            }

            // If all failed, throw a detailed error
            throw new Error(`Connection failed after trying ${endpoints.length} endpoints. Ensure your Replit Daily Planner is awake and the URL is correct. Tried: ${errors.join(', ')}`);
        } catch (error) {
            console.error("No endpoint responded with JSON logs:", error);
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
