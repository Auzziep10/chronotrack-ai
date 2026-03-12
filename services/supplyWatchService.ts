
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
        const baseUrl = replitUrl.replace(/\/$/, '');
        const endpoints = [
            '/api/users',
            '/api/team',
            '/api/staff',
            '/api/employees'
        ];

        let lastError: any = null;
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-API-Key': 'ct_c9a9828186758e3ab7e5e903ab3b214f42a1d884543f55b67d1ac48431e9e753'
                    }
                });

                if (response.ok) {
                    return await response.json();
                } else if (response.status === 404) {
                    lastError = new Error(`Endpoint ${endpoint} not found (404)`);
                } else {
                    throw new Error(`Failed to fetch users at ${endpoint}: ${response.statusText}`);
                }
            } catch (error) {
                lastError = error;
            }
        }
        
        console.error("Failed to fetch users from Replit:", lastError);
        throw lastError || new Error("Failed to fetch users");
    },

    /**
     * Fetches daily schedule and blocks for a specific date
     */
    getDailySchedule: async function (replitUrl: string, token: string, date: Date) {
        const baseUrl = replitUrl.replace(/\/$/, '');
        const dateISO = date.toISOString().split('T')[0];
        const dateLocale = date.toLocaleDateString('en-CA'); // YYYY-MM-DD

        const tryEndpoints = [
            `/api/daily-schedules/date/${dateISO}/external`,
            `/api/daily-schedules/date/${dateLocale}/external`,
            `/api/daily-planner?date=${dateLocale}`,
            `/api/daily-planner?date=${dateISO}`,
            `/api/daily-schedules/date/${dateLocale}`,
            `/api/daily-schedules/date/${dateISO}`
        ];

        for (const endpoint of tryEndpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    headers: { 
                        'Authorization': `Bearer ${token}`,
                        'X-API-Key': 'ct_c9a9828186758e3ab7e5e903ab3b214f42a1d884543f55b67d1ac48431e9e753'
                    }
                });
                if (response.ok) {
                    let data = await response.json();
                    
                    // If the API returned a flat array, wrap it in our expected object format
                    if (Array.isArray(data)) {
                        data = { id: dateISO, date: dateISO, blocks: data };
                    }
                    
                    // Handle various potential backend wrappers
                    if (data && !data.blocks) {
                        if (data.tasks && Array.isArray(data.tasks)) data.blocks = data.tasks;
                        else if (data.schedule && data.schedule.blocks) data.blocks = data.schedule.blocks;
                        else if (data.schedule && Array.isArray(data.schedule)) data.blocks = data.schedule;
                        else if (data.data && Array.isArray(data.data)) data.blocks = data.data;
                    }
                    
                    if (data && data.blocks && Array.isArray(data.blocks)) {
                        data.blocks = data.blocks.map((b: any) => {
                            // Extract check-ins from any possible field name
                            let rawCheckIns = b.checkIns || b.checkins || b.check_ins || b.updates || b.history || b.logs || b.activity || b.statusHistory || b.status_history || b.activity_log || b.reports || b.comments || b.feed || [];

                            if (Array.isArray(rawCheckIns) && rawCheckIns.length === 0) {
                                // Last ditch: search for ANY array field that looks like it might have check-ins
                                for (const key in b) {
                                    if (Array.isArray(b[key]) && b[key].length > 0 && typeof b[key][0] === 'object') {
                                        const first = b[key][0];
                                        if (first.timestamp || first.time || first.createdAt || first.text || first.status) {
                                            rawCheckIns = b[key];
                                            break;
                                        }
                                    }
                                }
                            }

                            const normalizedCheckIns = Array.isArray(rawCheckIns) ? rawCheckIns.map((ci: any) => {
                                if (typeof ci === 'string') {
                                    return {
                                        timestamp: this.parseReplitTime(ci),
                                        status: ci,
                                        notes: ''
                                    };
                                }

                                const ts = this.parseReplitTime(ci.createdAt || ci.timestamp || ci.time || ci.created_at || ci.updatedAt);
                                let status = ci.status || ci.text || ci.comment || 'Check-in';

                                // Normalize status labels from Catalyst-Dashboard
                                if (status === 'on_track') status = 'On Track';
                                if (status === 'in_progress' || status === 'active') status = 'Active';

                                const progress = ci.progressPercent !== undefined ? ci.progressPercent : ci.progress;
                                if (progress !== undefined && progress > 0 && progress < 100) {
                                    status = `${status} (${progress}%)`;
                                }

                                return {
                                    ...ci,
                                    timestamp: ts,
                                    status: status,
                                    notes: ci.notes || ci.note || ci.comment || ci.text || ''
                                };
                            }) : [];

                            const assignedToName = b.assignedToName || b.assigned_to_name || b.userName || b.user_name || b.username || b.ownerName || b.employeeName || '';
                            let assignedToStr = b.assignedTo != null ? String(b.assignedTo) : 
                                                (b.assigned_to != null ? String(b.assigned_to) : 
                                                (b.userId != null ? String(b.userId) : 
                                                (b.user_id != null ? String(b.user_id) : 
                                                (b.ownerId != null ? String(b.ownerId) : 
                                                (b.employeeId != null ? String(b.employeeId) : '')))));

                            // Clean up "null" or "undefined" strings that might have snuck in, or empty strings
                            if (assignedToStr === 'null' || assignedToStr === 'undefined' || assignedToStr.trim() === '') {
                                assignedToStr = '';
                            }

                            // If we still don't have an ID but we have a name, we'll try to let DailyPlanner do a fuzz name match
                            if (!assignedToStr && assignedToName) {
                                assignedToStr = `NAME_MATCH:${assignedToName}`;
                            }

                            const rawStartTime = b.startTime || b.start_time || b.start || b.startDate || b.start_date || new Date().toISOString();
                            const rawEndTime = b.endTime || b.end_time || b.end || b.endDate || b.end_date || new Date(Date.now() + 3600000).toISOString();
                            const startTimeISO = new Date(supplyWatchService.parseReplitTime(rawStartTime)).toISOString();
                            const endTimeISO = new Date(supplyWatchService.parseReplitTime(rawEndTime)).toISOString();

                            return {
                                ...b,
                                title: b.title || b.name || b.task || b.taskName || b.description || 'Untitled Task',
                                description: b.description || b.notes || b.details || '',
                                startTime: startTimeISO,
                                endTime: endTimeISO,
                                assignedTo: assignedToStr,
                                assignedToName: assignedToName,
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
                    'Authorization': `Bearer ${token}`,
                    'X-API-Key': 'ct_c9a9828186758e3ab7e5e903ab3b214f42a1d884543f55b67d1ac48431e9e753'
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
        const baseUrl = replitUrl.replace(/\/$/, '');
        const endpoints = [
            `/api/schedule-blocks/${blockId}`,
            `/api/daily-planner/tasks/${blockId}`,
            `/api/tasks/${blockId}`,
            `/api/schedules/blocks/${blockId}`
        ];

        let lastError: any = null;
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-API-Key': 'ct_c9a9828186758e3ab7e5e903ab3b214f42a1d884543f55b67d1ac48431e9e753'
                    },
                    body: JSON.stringify(blockData)
                });

                if (response.ok) {
                    return await response.json();
                } else if (response.status === 404) {
                    lastError = new Error(`Endpoint ${endpoint} not found (404)`);
                    continue; // Try next endpoint
                } else {
                    throw new Error(`Failed to update block at ${endpoint}: ${response.statusText}`);
                }
            } catch (error) {
                lastError = error;
                // If network error (fetch failed), continue trying other endpoints just in case
                // Though unlikely to help if the baseUrl is completely unreachable
            }
        }
        
        console.error("Failed to update schedule block across all endpoints:", lastError);
        throw lastError || new Error("Failed to update schedule block");
    },

    /**
     * Deletes a schedule block
     */
    deleteScheduleBlock: async (replitUrl: string, token: string, blockId: string) => {
        const baseUrl = replitUrl.replace(/\/$/, '');
        const endpoints = [
            `/api/schedule-blocks/${blockId}`,
            `/api/daily-planner/tasks/${blockId}`,
            `/api/tasks/${blockId}`,
            `/api/schedules/blocks/${blockId}`
        ];

        let lastError: any = null;
        for (const endpoint of endpoints) {
            try {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-API-Key': 'ct_c9a9828186758e3ab7e5e903ab3b214f42a1d884543f55b67d1ac48431e9e753'
                    }
                });

                if (response.ok) {
                    return true;
                } else if (response.status === 404) {
                    lastError = new Error(`Endpoint ${endpoint} not found (404)`);
                } else {
                    throw new Error(`Failed to delete block at ${endpoint}: ${response.statusText}`);
                }
            } catch (error) {
                lastError = error;
            }
        }
        
        console.error("Failed to delete schedule block:", lastError);
        throw lastError || new Error("Failed to delete schedule block");
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
                            const progress = l.progressPercent !== undefined ? l.progressPercent : (l.progress !== undefined ? l.progress : 0);
                            combinedLogs.push({
                                ...l,
                                id: l.id || `flat-${ts}-${l.userId || l.user_id || l.username}`,
                                userName: l.userName || l.user_name || l.name || l.ownerName || l.assignedToName,
                                userId: l.userId || l.user_id || l.assignedTo,
                                task: l.task || l.title || l.taskTitle || 'Check-in',
                                timestamp: ts,
                                notes: l.notes || l.note || l.comment || l.text || `Progress: ${progress}%`,
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
                            const bOwnerName = block.assignedToName || block.assigned_to_name || block.userName || block.username || block.ownerName || '';
                            const bOwnerId = block.assignedTo || block.assigned_to || block.userId || block.owner;
                            const bTask = block.title || block.task || block.name || 'Assigned Task';

                            // Part 1: Real Check-ins
                            const checkIns = block.checkIns || block.checkins || block.logs || block.activity || block.history || block.updates || block.statusHistory || [];
                            if (Array.isArray(checkIns) && checkIns.length > 0) {
                                checkIns.forEach((ci: any, idx: number) => {
                                    const logOwnerName = ci.userName || ci.name || ci.user_name || bOwnerName;
                                    const logOwnerId = ci.userId || ci.user_id || bOwnerId;

                                    // If we have neither name nor ID, we can't map this log
                                    if (!logOwnerName && !logOwnerId) return;

                                    // Skip generic staff names if name is present
                                    if (logOwnerName && ['staff', 'team', 'member', 'admin', 'unassigned'].includes(logOwnerName.toLowerCase())) {
                                        if (!logOwnerId) return;
                                    }

                                    const ts = this.parseReplitTime(ci.timestamp || ci.time || ci.createdAt || ci.created_at || ci.updatedAt);

                                    // Robust progress extraction
                                    const progress = ci.progressPercent !== undefined ? ci.progressPercent : (ci.progress !== undefined ? ci.progress : 0);
                                    let displayNote = ci.notes || ci.note || ci.comment || ci.text;

                                    // If no note, format the status and progress
                                    if (!displayNote) {
                                        let status = ci.status || 'Active';
                                        if (status === 'on_track') status = 'On Track';
                                        if (status === 'in_progress' || status === 'active') status = 'Active';
                                        displayNote = `${status} (${progress}%)`;
                                    }

                                    combinedLogs.push({
                                        id: ci.id || `ci-${block.id}-${idx}-${ts}`,
                                        userName: logOwnerName,
                                        userId: logOwnerId,
                                        task: bTask,
                                        timestamp: ts,
                                        notes: displayNote,
                                        department: block.department || block.dept
                                    });
                                });
                            }

                            // Part 2: State-based Logs (Stable ID)
                            const currentStatus = String(block.status || '').toLowerCase();
                            if (['active', 'in_progress', 'completed', 'in progress'].includes(currentStatus)) {
                                if (bOwnerId || (bOwnerName && !['staff', 'team', 'member', 'admin', 'unassigned'].includes(bOwnerName.toLowerCase()))) {
                                    const ts = this.parseReplitTime(block.updatedAt || block.updated_at || block.endTime || block.startTime);
                                    combinedLogs.push({
                                        id: `vlog-${block.id}-${currentStatus}-${ts}`, // timestamped ID to avoid duplicate filtering if status stays same but updated
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
