
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
    }
};
