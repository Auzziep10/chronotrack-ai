import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    onSnapshot,
    collection,
    getDocs,
    updateDoc,
    serverTimestamp,
    Timestamp,
    arrayUnion,
    query,
    where,
    orderBy,
    limit
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';
import { User, UserSession, WorkLog, DailyTimeCard, AppSettings, QuickTask, PrintRoomTask, ChatMessage, ChatChannel } from '../types';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);
export const storage = getStorage(app);

export const isFirebaseConfigured = () => !!firebaseConfig.projectId;

/** Silently authenticate the device to bypass open API rule alerts */
export const firebaseSilentAuth = async (): Promise<void> => {
    if (!isFirebaseConfigured()) return;
    try {
        const auth = getAuth(app);
        await signInAnonymously(auth);
        console.log("Firebase Anonymous Auth successful.");
    } catch (e) {
        console.error("Firebase Anonymous Auth failed:", e);
    }

    try {
        const teamApps = getApps().filter(ap => ap.name === 'teamDashboard');
        if (teamApps.length > 0) {
            const teamAuth = getAuth(teamApps[0]);
            await signInAnonymously(teamAuth);
            console.log("Firebase Team Dashboard Anonymous Auth successful.");
        }
    } catch (e) {
        console.warn("Firebase Team Dashboard Anonymous Auth failed (ensure Anonymous provider is enabled in Firebase Console for print-shop-os-f8092):", e);
    }
};

const SESSIONS_COL = 'activeSessions';
const USERS_COL = 'users';
const WORKLOGS_COL = 'workLogs';
const TIMECARDS_COL = 'timeCards';

// ─── ACTIVE SESSIONS ─────────────────────────────────────────────────────────

/**
 * Subscribe to real-time active sessions.
 * Returns raw Firestore data keyed by userId.
 * App.tsx uses a usersRef to map userId -> User object without stale closure.
 */
export const subscribeToActiveSessions = (
    onUpdate: (rawSessions: Record<string, any>) => void
) => {
    return onSnapshot(collection(db, SESSIONS_COL), (snapshot) => {
        const raw: Record<string, any> = {};
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (!data.clockedOut) {
                raw[data.userId] = {
                    ...data,
                    startTime: data.startTime instanceof Timestamp ? data.startTime.toMillis() : (data.startTime || Date.now()),
                    lastLogTime: data.lastLogTime instanceof Timestamp ? data.lastLogTime.toMillis() : (data.lastLogTime || Date.now()),
                };
            }
        });
        onUpdate(raw);
    }, (error) => {
        console.error("Firebase ActiveSessions Sync Error:", error);
        alert(`Database Sync Error: ${error.message}. Please check your Firebase Security Rules or Project configuration.`);
    });
};

/** Baseline reset timestamp (Oct 29, 2026 09:06 AM local) — all write-ups and strikes reset to 0 starting from this point */
export const WRITEUP_RESET_TIMESTAMP = new Date(2026, 9, 29, 9, 6, 0).getTime();

const toLocalIsoDate = (ms: number): string => {
    const d = new Date(ms);
    return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

/** Clock in — writes/overwrites session document in Firestore */
export const firebaseClockIn = async (user: User, clockInDepartment?: string, isUnscheduled?: boolean): Promise<void> => {
    const now = Date.now();
    let minutesLate = 0;
    let tardyShiftTitle: string | undefined = undefined;
    const todayStr = toLocalIsoDate(now);

    // Check if user clocked in late against today's shift schedule
    // Safeguards:
    // 1. Never mark late if the user already has a timeCard logged today (e.g., returning from break or re-entering PIN after clocking out).
    // 2. Never mark late if the shift has already ended (or is within 15 mins of ending) or if >2 hours past shift start (prevents end-of-day clock-out attempts from firing late clock-in alerts).
    try {
        const [shiftsSnap, userCardsSnap] = await Promise.all([
            getDocs(query(collection(db, SHIFTS_COL), where('assignedTo', '==', user.id))),
            getDocs(query(collection(db, TIMECARDS_COL), where('userId', '==', user.id)))
        ]);

        const alreadyWorkedToday = userCardsSnap.docs.some(d => {
            const tc = d.data();
            const cIn = tc.clockIn instanceof Timestamp ? tc.clockIn.toMillis() : (tc.clockIn || 0);
            const tcDate = tc.date || (cIn ? toLocalIsoDate(cIn) : '');
            return tcDate === todayStr;
        });

        if (!alreadyWorkedToday && !isUnscheduled) {
            const nowObj = new Date(now);
            const todayShifts = shiftsSnap.docs.map(d => d.data()).filter(s => {
                if (typeof s.title !== 'string' || !s.title.startsWith('[SHIFT]')) return false;
                const startObj = new Date(s.startTime);
                return (
                    startObj.getFullYear() === nowObj.getFullYear() &&
                    startObj.getMonth() === nowObj.getMonth() &&
                    startObj.getDate() === nowObj.getDate()
                );
            });

            if (todayShifts.length > 0) {
                const sortedShifts = todayShifts.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                // Find the active shift that has started but has NOT ended (and isn't in the final 15 minutes of shift end)
                const matchingShift = sortedShifts.find(s => {
                    const startMs = new Date(s.startTime).getTime();
                    const endMs = new Date(s.endTime).getTime();
                    const maxLateClockInWindowMs = startMs + 120 * 60 * 1000; // Max 2 hours after shift start
                    return now > startMs && now < Math.min(endMs - 15 * 60 * 1000, maxLateClockInWindowMs);
                });

                if (matchingShift) {
                    const scheduledStart = new Date(matchingShift.startTime).getTime();
                    minutesLate = Math.ceil((now - scheduledStart) / (1000 * 60));
                    tardyShiftTitle = matchingShift.title || 'Scheduled Shift';
                }
            }
        }
    } catch (err) {
        console.warn("[Firebase] Error calculating tardiness on clock-in:", err);
    }

    await setDoc(doc(db, SESSIONS_COL, user.id), {
        userId: user.id,
        userName: user.name,
        avatarInitials: user.avatarInitials,
        role: user.role,
        primaryDepartment: user.primaryDepartment || '',
        startTime: now,
        lastLogTime: now,
        logs: [],
        isPaused: false,
        currentIdleStartTime: null,
        totalIdleTimeMs: 0,
        clockedOut: false,
        clockInDepartment: clockInDepartment || null,
        isUnscheduled: isUnscheduled || false,
        minutesLate: minutesLate || 0,
        tardyShiftTitle: tardyShiftTitle || null,
        updatedAt: serverTimestamp()
    });

    // If clocked in late, dispatch immediate tardy alert to managers & update user's attendance audit / auto-write-up
    if (minutesLate > 0) {
        try {
            const userDocRef = doc(db, USERS_COL, user.id);
            const userSnap = await getDoc(userDocRef);

            if (userSnap.exists()) {
                const userData = userSnap.data() as User;
                const existingAudit = Array.isArray(userData.attendanceAuditLog) ? userData.attendanceAuditLog : [];
                const existingWriteUps = Array.isArray(userData.disciplinaryWriteUps) ? userData.disciplinaryWriteUps : [];

                const lateAuditEntry = {
                    id: `audit-late-${now}`,
                    date: todayStr,
                    timestamp: now,
                    type: 'Late_Clock_In' as const,
                    shiftTitle: tardyShiftTitle || '[SHIFT]',
                    minutesLate,
                    details: `Clocked in ${minutesLate} min(s) late for ${tardyShiftTitle || 'scheduled shift'}.`
                };

                // Count rolling 30-day tardies since WRITEUP_RESET_TIMESTAMP (including today's late clock-in)
                const windowStartMs = Math.max(now - 30 * 24 * 60 * 60 * 1000, WRITEUP_RESET_TIMESTAMP);
                const userCardsSnap = await getDocs(query(collection(db, TIMECARDS_COL), where('userId', '==', user.id)));
                const prior30DayTardies = userCardsSnap.docs
                    .map(d => d.data())
                    .filter(tc => {
                        const cIn = tc.clockIn instanceof Timestamp ? tc.clockIn.toMillis() : (tc.clockIn || 0);
                        return cIn >= windowStartMs && (tc.minutesLate || 0) > 0 && !tc.tardyTakenCareOf && tc.date !== todayStr;
                    }).length;

                const rollingTardyCount = prior30DayTardies + 1;
                const updatedWriteUps = [...existingWriteUps];
                let newStrikeLevel = userData.strikeLevel || 0;

                // Auto-generate Pending Signature Write-Up at 3, 5, or 6+ tardies in 30 days
                let milestoneSeverity: 'Written Warning (Strike 1)' | 'Final Written Warning (Strike 2)' | 'Suspension / Termination Review (Strike 3)' | null = null;
                if (rollingTardyCount >= 6) {
                    milestoneSeverity = 'Suspension / Termination Review (Strike 3)';
                    newStrikeLevel = 3;
                } else if (rollingTardyCount === 5) {
                    milestoneSeverity = 'Final Written Warning (Strike 2)';
                    newStrikeLevel = Math.max(newStrikeLevel, 2) as 0 | 1 | 2 | 3;
                } else if (rollingTardyCount === 3) {
                    milestoneSeverity = 'Written Warning (Strike 1)';
                    newStrikeLevel = Math.max(newStrikeLevel, 1) as 0 | 1 | 2 | 3;
                }

                if (milestoneSeverity) {
                    const alreadyHasRecentMilestone = existingWriteUps.some(
                        w =>
                            w.category === 'Excessive Tardiness' &&
                            w.severity === milestoneSeverity &&
                            w.createdAt >= windowStartMs
                    );
                    if (!alreadyHasRecentMilestone) {
                        updatedWriteUps.unshift({
                            id: `wu-autotardy-${now}`,
                            userId: user.id,
                            userName: user.name,
                            date: todayStr,
                            createdAt: now,
                            issuedByManagerId: 'system-attendance',
                            issuedByManagerName: 'Clockwork Automated Attendance',
                            category: 'Excessive Tardiness',
                            severity: milestoneSeverity,
                            incidentDate: todayStr,
                            shiftTitle: tardyShiftTitle || '[SHIFT]',
                            description: `${user.name} clocked in ${minutesLate} minute(s) late for ${tardyShiftTitle || 'scheduled shift'}, reaching ${rollingTardyCount} late clock-ins within a rolling 30-day window.`,
                            correctiveActionPlan:
                                'Team member must arrive and clock in on the Master iPad at or before the scheduled [SHIFT] start time. Continued tardiness will result in further disciplinary escalation up to termination.',
                            status: 'Pending Signature',
                            autoGenerated: true
                        });
                    }
                }

                await updateDoc(userDocRef, {
                    tardyCount30Days: rollingTardyCount,
                    strikeLevel: newStrikeLevel,
                    attendanceAuditLog: [lateAuditEntry, ...existingAudit].slice(0, 100),
                    disciplinaryWriteUps: updatedWriteUps,
                    updatedAt: serverTimestamp()
                });
            }

            const allUsersSnap = await getDocs(collection(db, USERS_COL));
            const managerTokens = allUsersSnap.docs
                .map(d => d.data())
                .filter(u => (u.role?.toLowerCase() === 'admin' || u.role?.toLowerCase() === 'manager') && u.expoPushToken)
                .map(u => u.expoPushToken as string);

            import('./pushNotificationService').then(({ notifyManagersOfTardiness }) => {
                notifyManagersOfTardiness(user.name, minutesLate, tardyShiftTitle, managerTokens);
            }).catch(console.error);
        } catch (e) {
            console.warn("Failed to notify managers or log tardiness audit:", e);
        }
    }
};

/** Reset all users' disciplinary write-ups, strike levels, and pre-reset tardy counts to 0 in Firestore */
export const firebaseResetAllWriteUpsToZero = async (): Promise<void> => {
    try {
        const usersSnap = await getDocs(collection(db, USERS_COL));
        const updates: Promise<any>[] = [];

        usersSnap.docs.forEach(d => {
            const u = d.data() as User;
            const postResetWriteUps = (u.disciplinaryWriteUps || []).filter(
                w => (w.createdAt || 0) >= WRITEUP_RESET_TIMESTAMP
            );
            const postResetAudits = (u.attendanceAuditLog || []).filter(
                a => (a.timestamp || 0) >= WRITEUP_RESET_TIMESTAMP
            );

            const needsReset =
                (u.disciplinaryWriteUps && u.disciplinaryWriteUps.length !== postResetWriteUps.length) ||
                (postResetWriteUps.length === 0 && ((u.strikeLevel || 0) > 0 || (u.tardyCount30Days || 0) > 0)) ||
                (u.attendanceAuditLog && u.attendanceAuditLog.length !== postResetAudits.length);

            if (needsReset) {
                updates.push(
                    updateDoc(doc(db, USERS_COL, d.id), {
                        disciplinaryWriteUps: postResetWriteUps,
                        strikeLevel: postResetWriteUps.length === 0 ? 0 : (u.strikeLevel || 0),
                        tardyCount30Days: postResetAudits.filter(a => a.type === 'Late_Clock_In' || a.type === '5_Min_Tardy_Alert').length,
                        attendanceAuditLog: postResetAudits,
                        lateDays: 0,
                        updatedAt: serverTimestamp()
                    })
                );
            }
        });

        // Also clear false minutesLate flags on today's timeCards created before WRITEUP_RESET_TIMESTAMP
        const todayStr = toLocalIsoDate(Date.now());
        const cardsSnap = await getDocs(query(collection(db, TIMECARDS_COL), where('date', '==', todayStr)));
        cardsSnap.docs.forEach(d => {
            const tc = d.data();
            const cIn = tc.clockIn instanceof Timestamp ? tc.clockIn.toMillis() : (tc.clockIn || 0);
            if ((tc.minutesLate || 0) > 0 && cIn < WRITEUP_RESET_TIMESTAMP) {
                updates.push(
                    updateDoc(doc(db, TIMECARDS_COL, d.id), {
                        minutesLate: 0,
                        tardyTakenCareOf: true,
                        updatedAt: serverTimestamp()
                    })
                );
            }
        });

        if (updates.length > 0) {
            await Promise.all(updates);
            console.log(`[Firebase] Reset write-ups and strikes to 0 across ${updates.length} records.`);
        }
    } catch (err) {
        console.warn("[Firebase] Error resetting write-ups to 0:", err);
    }
};

/** Clock out — saves time card FIRST, then marks session clockedOut to prevent unclocked tardy race conditions */
export const firebaseClockOut = async (userId: string, session: UserSession): Promise<DailyTimeCard> => {
    const now = Date.now();

    // Accumulate last idle period if currently paused
    let totalIdle = session.totalIdleTimeMs || 0;
    if (session.isPaused && session.currentIdleStartTime) {
        totalIdle += (now - session.currentIdleStartTime);
    }

    const totalIdleHours = totalIdle / (1000 * 60 * 60);
    const grossHours = (now - session.startTime) / (1000 * 60 * 60);
    const netHours = Math.max(0, grossHours - totalIdleHours);

    const timeCard: DailyTimeCard = {
        id: `tc-${userId}-${now}`,
        userId,
        date: toLocalIsoDate(session.startTime || now),
        clockIn: session.startTime,
        clockOut: now,
        totalHours: netHours,
        totalIdleHours: totalIdleHours,
        status: 'Complete',
        minutesLate: (session as any).minutesLate || 0,
        tardyShiftTitle: (session as any).tardyShiftTitle || undefined
    };

    // 1. Write timeCard FIRST so the 5-min tardy monitor immediately sees the completed timeCard for today
    await setDoc(doc(db, TIMECARDS_COL, timeCard.id), {
        ...timeCard,
        createdAt: serverTimestamp()
    });

    // 2. Mark active session as clockedOut
    await setDoc(doc(db, SESSIONS_COL, userId), {
        clockedOut: true,
        clockOutTime: now,
        isPaused: false,
        totalIdleTimeMs: totalIdle,
        updatedAt: serverTimestamp()
    }, { merge: true });

    return timeCard;
};

/** Save a work log to Firestore and update session's lastLogTime */
export const firebaseAddLog = async (userId: string, log: WorkLog): Promise<void> => {
    // Sanitize log to remove any undefined fields (Firestore doesn't accept them)
    const cleanLog: any = {};
    Object.entries(log).forEach(([k, v]) => {
        if (v !== undefined) cleanLog[k] = v;
    });

    const now = Date.now();

    await setDoc(doc(db, WORKLOGS_COL, log.id), {
        ...cleanLog,
        createdAt: serverTimestamp()
    });

    // Update session's lastLogTime and logs array ONLY if they are already clocked in
    try {
        const sessionRef = doc(db, SESSIONS_COL, userId);

        // When adding a log, we ALWAYS clear paused status and update the last activity time.
        // This ensures that even if a background sync adds a log, the user is "resumed" automatically.
        const updateData: any = {
            lastLogTime: log.periodEnd || log.timestamp || now,
            logs: arrayUnion(cleanLog),
            isPaused: false,
            currentIdleStartTime: null,
            updatedAt: serverTimestamp()
        };

        await updateDoc(sessionRef, updateData);
    } catch (e) {
        // Ignore if document doesn't exist (user not clocked in)
        console.warn("[Firebase] Failed to update session after log add:", e);
    }
};

/** Update the start time of an active session */
export const firebaseUpdateSessionStartTime = async (userId: string, newStartTime: number): Promise<void> => {
    await updateDoc(doc(db, SESSIONS_COL, userId), {
        startTime: newStartTime,
        updatedAt: serverTimestamp()
    });
};

/** Force update an active session (e.g. from Manager Console) */
export const firebaseUpdateActiveSession = async (userId: string, inTime: number, outTime: number | null, idleHours: number): Promise<void> => {
    const idleMs = idleHours * 3600000;
    
    if (outTime) {
        // They are clocking out the active session
        await updateDoc(doc(db, SESSIONS_COL, userId), {
            startTime: inTime,
            clockedOut: true,
            clockOutTime: outTime,
            isPaused: false,
            totalIdleTimeMs: idleMs,
            updatedAt: serverTimestamp()
        });
        
        // Save the timecard
        const timeCard: DailyTimeCard = {
            id: `tc-${userId}-${outTime}`,
            userId,
            date: new Date(inTime).toISOString().split('T')[0],
            clockIn: inTime,
            clockOut: outTime,
            totalHours: Math.max(0, ((outTime - inTime) / 3600000) - idleHours),
            totalIdleHours: idleHours,
            status: 'Complete'
        };
        await setDoc(doc(db, TIMECARDS_COL, timeCard.id), {
            ...timeCard,
            createdAt: serverTimestamp()
        });
    } else {
        // Just updating the active session's times
        await updateDoc(doc(db, SESSIONS_COL, userId), {
            startTime: inTime,
            totalIdleTimeMs: idleMs,
            updatedAt: serverTimestamp()
        });
    }
};

/** Atomic Resume: Calculates accumulated idle time and resumes tracking */
export const firebaseResumeSession = async (userId: string, currentSession: any): Promise<void> => {
    const now = Date.now();
    const isActuallyPaused = currentSession.isPaused;

    // Safety check: if they aren't paused and don't have an idle start time, nothing to do
    if (!isActuallyPaused && !currentSession.currentIdleStartTime) return;

    // Use the stored idle start time, OR fallback to now (which shouldn't happen if paused)
    const idleStart = currentSession.currentIdleStartTime || now;
    const accruedIdle = Math.max(0, now - idleStart);
    const newTotalIdle = (currentSession.totalIdleTimeMs || 0) + accruedIdle;

    await updateDoc(doc(db, SESSIONS_COL, userId), {
        isPaused: false,
        pauseReason: null,
        currentIdleStartTime: null,
        totalIdleTimeMs: newTotalIdle,
        updatedAt: serverTimestamp()
    });
};

/** Mark a session as paused/idle */
export const firebasePauseSession = async (userId: string, reason?: 'lunch' | 'idle'): Promise<void> => {
    await updateDoc(doc(db, SESSIONS_COL, userId), {
        isPaused: true,
        pauseReason: reason || null,
        currentIdleStartTime: Date.now(),
        updatedAt: serverTimestamp()
    });
};

/** Delete a work log from Firestore */
export const firebaseDeleteLog = async (logId: string): Promise<void> => {
    await deleteDoc(doc(db, WORKLOGS_COL, logId));
};

// ─── USERS ───────────────────────────────────────────────────────────────────

/** Save/overwrite a user profile in Firestore */
export const firebaseSaveUser = async (user: User): Promise<void> => {
    // Remove undefined values (Firestore doesn't accept undefined)
    const clean: any = {};
    Object.entries(user).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });
    await setDoc(doc(db, USERS_COL, user.id), {
        ...clean,
        updatedAt: serverTimestamp()
    });
};

/** Subscribe to real-time user list — returns unsubscribe fn */
export const subscribeToUsers = (onUpdate: (users: User[]) => void) => {
    return onSnapshot(collection(db, USERS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const users = snapshot.docs.map(d => {
            const data = d.data();
            // Strip Firestore-specific fields
            const { updatedAt, ...user } = data;
            return user as User;
        });
        onUpdate(users);
    });
};

/** One-time fetch of all users from Firestore */
export const firebaseGetUsers = async (): Promise<User[]> => {
    const snapshot = await getDocs(collection(db, USERS_COL));
    return snapshot.docs.map(d => {
        const { updatedAt, ...user } = d.data();
        return user as User;
    });
};

/** Delete a user from Firestore */
export const firebaseDeleteUser = async (userId: string): Promise<void> => {
    await deleteDoc(doc(db, USERS_COL, userId));
};

// ─── TIME CARDS ───────────────────────────────────────────────────────────────

/** Get all time cards from Firestore */
export const firebaseGetTimeCards = async (): Promise<DailyTimeCard[]> => {
    const snapshot = await getDocs(collection(db, TIMECARDS_COL));
    return snapshot.docs.map(d => {
        const data = d.data();
        return {
            ...data,
            clockIn: data.clockIn instanceof Timestamp ? data.clockIn.toMillis() : data.clockIn,
            clockOut: data.clockOut instanceof Timestamp ? data.clockOut.toMillis() : data.clockOut
        } as DailyTimeCard;
    });
};

/** Save or update a time card in Firestore */
export const firebaseSaveTimeCard = async (timeCard: DailyTimeCard): Promise<void> => {
    const clean: any = {};
    Object.entries(timeCard).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });

    await setDoc(doc(db, TIMECARDS_COL, timeCard.id), {
        ...clean,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/** Get all work logs from Firestore */
export const firebaseGetLogs = async (): Promise<WorkLog[]> => {
    const snapshot = await getDocs(collection(db, WORKLOGS_COL));
    return snapshot.docs.map(d => {
        const data = d.data();
        return {
            ...data,
            timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toMillis() : (data.timestamp || Date.now()),
            periodStart: data.periodStart instanceof Timestamp ? data.periodStart.toMillis() : data.periodStart,
            periodEnd: data.periodEnd instanceof Timestamp ? data.periodEnd.toMillis() : data.periodEnd
        } as WorkLog;
    });
};



// ─── SHIFT SCHEDULES ────────────────────────────────────────────────────────
const SHIFTS_COL = 'shiftSchedules';

/** Save or update a shift block in Firestore */
export const firebaseSaveShiftBlock = async (block: any): Promise<any> => {
    // Generate an ID if it doesn't have one
    const id = block.id || `shift-${Date.now()}-${block.assignedTo}`;
    const cleanBlock = { ...block, id };

    // Remove undefined values
    const clean: any = {};
    Object.entries(cleanBlock).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });

    await setDoc(doc(db, SHIFTS_COL, id), {
        ...clean,
        updatedAt: serverTimestamp() // Add or overwrite updatedAt
    }, { merge: true });

    return clean;
};

/** Subscribe to all shift blocks */
export const subscribeToShiftBlocks = (onUpdate: (blocks: any[]) => void) => {
    return onSnapshot(collection(db, SHIFTS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const blocks = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...block } = data; // Strip Firestore-specific fields for clean state
            return { id: d.id, ...block };
        });
        onUpdate(blocks);
    });
};

/** Fetch blocks once (e.g. for calendar views) */
export const firebaseGetShiftBlocks = async (): Promise<any[]> => {
    const snapshot = await getDocs(collection(db, SHIFTS_COL));
    return snapshot.docs.map(d => {
        const { updatedAt, ...block } = d.data();
        return { id: d.id, ...block };
    });
};

/** Delete a shift block from Firestore */
export const firebaseDeleteShiftBlock = async (blockId: string): Promise<void> => {
    await deleteDoc(doc(db, SHIFTS_COL, blockId));
};

export { db };

export const firebaseUploadDocument = async (userId: string, formType: string, pdfDataUrl: string): Promise<string> => {
    try {
        const timestamp = Date.now();
        const fileRef = ref(storage, `onboarding-docs/${userId}/${formType}_${timestamp}.pdf`);
        
        // Upload base64 PDF
        await uploadString(fileRef, pdfDataUrl, 'data_url');
        
        // Get the download URL
        const downloadUrl = await getDownloadURL(fileRef);
        
        // Save reference to the user's document
        const userRef = doc(db, USERS_COL, userId);
        await updateDoc(userRef, {
            onboardingDocuments: arrayUnion({
                id: `doc_${timestamp}`,
                formType,
                url: downloadUrl,
                uploadedAt: new Date().toISOString(),
                fileName: `${formType}_${timestamp}.pdf`
            })
        });
        
        return downloadUrl;
    } catch (err) {
        console.error("Error uploading document:", err);
        throw err;
    }
};

// ─── SETTINGS ────────────────────────────────────────────────────────
const CONFIG_COL = 'config';

export const firebaseSaveSettings = async (settings: AppSettings): Promise<void> => {
    await setDoc(doc(db, CONFIG_COL, 'appSettings'), {
        ...settings,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const subscribeToSettings = (onUpdate: (settings: AppSettings | null) => void) => {
    return onSnapshot(doc(db, CONFIG_COL, 'appSettings'), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const { updatedAt, ...settings } = data;
            onUpdate(settings as AppSettings);
        } else {
            onUpdate(null);
        }
    });
};

// ─── QUICK TASKS ─────────────────────────────────────────────────────
const QUICK_TASKS_COL = 'quickTasks';

export const subscribeToQuickTasks = (onUpdate: (tasks: QuickTask[]) => void) => {
    return onSnapshot(collection(db, QUICK_TASKS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const tasks = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...task } = data;
            return task as QuickTask;
        });
        onUpdate(tasks);
    });
};

export const firebaseSaveQuickTask = async (task: QuickTask): Promise<void> => {
    const clean: any = {};
    Object.entries(task).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });
    await setDoc(doc(db, QUICK_TASKS_COL, task.id), {
        ...clean,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const firebaseDeleteQuickTask = async (taskId: string): Promise<void> => {
    await deleteDoc(doc(db, QUICK_TASKS_COL, taskId));
};

// ─── PRINT ROOM TASKS ────────────────────────────────────────────────
const PRINT_ROOM_TASKS_COL = 'printRoomTasks';

export const DEFAULT_PRINT_ROOM_TASKS: PrintRoomTask[] = [
    {
        id: 'pr-clean-coldesi',
        title: 'Clean Coldesi',
        duration: 30,
        locations: ['Coldesi'],
        requiresPhoto: true,
        instructions: 'Clean print heads, wiper blades, and cap tops. Photo required of clean station.'
    },
    {
        id: 'pr-flush-venom',
        title: 'Flush print heads on Venom',
        duration: 30,
        locations: ['Venom'],
        requiresPhoto: true,
        instructions: 'Perform head flush cycle and wipe carriage underside. Photo required of nozzle check.'
    },
    {
        id: 'pr-pick-shopify',
        title: 'Pick Shopify',
        duration: 60,
        locations: ['Shopify Station', 'Shipping'],
        requiresPhoto: true,
        instructions: 'Pick batch of Shopify orders and stage for printing. Photo required of picked orders cart.'
    },
    {
        id: 'pr-clean-dtg',
        title: 'Clean DTG Print Heads & Capping Station',
        duration: 30,
        locations: ['DTG Area'],
        requiresPhoto: true,
        instructions: 'Wipe around print heads and suction cap. Photo required of capping station.'
    },
    {
        id: 'pr-daily-shutdown',
        title: 'Daily Print Room Shutdown',
        duration: 30,
        locations: ['Print Room'],
        requiresPhoto: true,
        instructions: 'Turn off white ink agitators, park heads, power down dryers. Photo required of shutdown checklist.'
    },
    {
        id: 'pr-pretreat-flush',
        title: 'Pre-treatment Machine Flush & Wipe',
        duration: 20,
        locations: ['Pre-treatment'],
        requiresPhoto: true,
        instructions: 'Run DI water through lines and wipe down chamber walls. Photo required of clean chamber.'
    },
    {
        id: 'pr-waste-ink',
        title: 'Empty Waste Ink Bottles & Reset Counters',
        duration: 15,
        locations: ['Waste Station'],
        requiresPhoto: true,
        instructions: 'Empty waste tank into disposal container and reset counter. Photo required of empty bottle.'
    }
];

export const subscribeToPrintRoomTasks = (onUpdate: (tasks: PrintRoomTask[]) => void) => {
    return onSnapshot(collection(db, PRINT_ROOM_TASKS_COL), async (snapshot) => {
        if (snapshot.empty) {
            // Seed initial defaults so print room tasks are available immediately
            try {
                for (const t of DEFAULT_PRINT_ROOM_TASKS) {
                    await setDoc(doc(db, PRINT_ROOM_TASKS_COL, t.id), {
                        ...t,
                        updatedAt: serverTimestamp()
                    });
                }
            } catch (e) {
                console.warn("Auto-seed default print room tasks:", e);
            }
            onUpdate(DEFAULT_PRINT_ROOM_TASKS);
            return;
        }
        const tasks = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...task } = data;
            return task as PrintRoomTask;
        });
        onUpdate(tasks);
    });
};

export const firebaseSavePrintRoomTask = async (task: PrintRoomTask): Promise<void> => {
    const clean: any = {};
    Object.entries(task).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });
    await setDoc(doc(db, PRINT_ROOM_TASKS_COL, task.id), {
        ...clean,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const firebaseDeletePrintRoomTask = async (taskId: string): Promise<void> => {
    await deleteDoc(doc(db, PRINT_ROOM_TASKS_COL, taskId));
};


// ─── TEAM DASHBOARD DATABASE INTEGRATION ──────────────────────────────
const teamDashboardConfig = {
    apiKey: import.meta.env.VITE_TEAM_DASHBOARD_API_KEY || "",
    authDomain: import.meta.env.VITE_TEAM_DASHBOARD_AUTH_DOMAIN || "print-shop-os-f8092.firebaseapp.com",
    projectId: import.meta.env.VITE_TEAM_DASHBOARD_PROJECT_ID || "print-shop-os-f8092",
    storageBucket: import.meta.env.VITE_TEAM_DASHBOARD_STORAGE_BUCKET || "print-shop-os-f8092.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_TEAM_DASHBOARD_MESSAGING_SENDER_ID || "637868552650",
    appId: import.meta.env.VITE_TEAM_DASHBOARD_APP_ID || "1:637868552650:web:473f9f71ad41703ec7df33"
};

const teamApps = getApps().filter(app => app.name === 'teamDashboard');
const teamApp = teamApps.length === 0 ? initializeApp(teamDashboardConfig, 'teamDashboard') : teamApps[0];
export const teamDb = getFirestore(teamApp);

export const subscribeToProductionOrders = (onUpdate: (orders: any[]) => void) => {
    const q = query(collection(teamDb, 'orders'), where('statusIndex', 'in', [6, 7]));
    return onSnapshot(q, (snapshot) => {
        const ordersData = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id
        }));
        onUpdate(ordersData);
    }, (error) => {
        console.error("Firebase ProductionOrders Sync Error:", error);
    });
};

export const subscribeToCustomers = (onUpdate: (customers: Record<string, any>) => void) => {
    return onSnapshot(collection(teamDb, 'customers'), (snapshot) => {
        const dbCusts: Record<string, any> = {};
        snapshot.docs.forEach(doc => {
            dbCusts[doc.id] = doc.data();
        });
        onUpdate(dbCusts);
    }, (error) => {
        console.error("Firebase Customers Sync Error:", error);
    });
};

// ─── TEAM CHAT ROOM ──────────────────────────────────────────────────
const CHAT_COL = 'chatMessages';

/** Subscribe to chat messages for a specific channel, sorted client-side to avoid index requirements */
export const subscribeToChatMessages = (
    channel: string,
    onUpdate: (messages: ChatMessage[]) => void,
    onError?: (error: any) => void
) => {
    const q = query(
        collection(db, CHAT_COL),
        where('channel', '==', channel)
    );
    return onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const messages = snapshot.docs.map(d => {
            const data = d.data();
            return {
                ...data,
                id: d.id,
                timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toMillis() : (data.timestamp || Date.now())
            } as ChatMessage;
        });
        messages.sort((a, b) => a.timestamp - b.timestamp);
        onUpdate(messages);
    }, (error) => {
        console.error("Firebase ChatMessages Sync Error:", error);
        if (onError) onError(error);
    });
};

/** Send a chat message to Firestore */
export const firebaseSendMessage = async (message: ChatMessage): Promise<void> => {
    const clean: any = {};
    Object.entries(message).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });

    await setDoc(doc(db, CHAT_COL, message.id), {
        ...clean,
        timestamp: serverTimestamp()
    });

    // If a team member replies inside their own private DM channel (dm-{userId}), check if they are responding to a 5-min tardy alert
    if (
        message.senderId &&
        message.senderId !== 'system-attendance' &&
        message.channel === `dm-${message.senderId}`
    ) {
        try {
            const now = Date.now();
            const todayStr = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().split('T')[0];
            const userRef = doc(db, USERS_COL, message.senderId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data() as User;
                const auditList = Array.isArray(userData.attendanceAuditLog) ? userData.attendanceAuditLog : [];
                // Find most recent 5_Min_Tardy_Alert within the last 3 hours
                const recentAlert = auditList.find(
                    a => a.type === '5_Min_Tardy_Alert' && now - a.timestamp <= 3 * 60 * 60 * 1000
                );
                if (recentAlert) {
                    const alreadyReplied = auditList.some(
                        a => a.type === 'Tardy_Response' && a.timestamp >= recentAlert.timestamp
                    );
                    if (!alreadyReplied) {
                        const latencyMins = Math.max(0, Math.round((now - recentAlert.timestamp) / 60000));
                        const responseAudit = {
                            id: `audit-resp-${now}`,
                            date: todayStr,
                            timestamp: now,
                            type: 'Tardy_Response' as const,
                            shiftTitle: recentAlert.shiftTitle,
                            details: `Replied to 5-min tardy check-in after ${latencyMins} min(s): "${message.content}"`,
                            responseMessage: message.content,
                            responseLatencyMinutes: latencyMins
                        };
                        await updateDoc(userRef, {
                            attendanceAuditLog: [responseAudit, ...auditList].slice(0, 100),
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[Firebase] Failed to log Tardy_Response audit entry:', err);
        }
    }
};

/** Delete a chat message from Firestore */
export const firebaseDeleteChatMessage = async (messageId: string): Promise<void> => {
    await deleteDoc(doc(db, CHAT_COL, messageId));
};

/** Upload chat shared image to Firebase storage */
export const firebaseUploadChatImage = async (imageName: string, base64Data: string): Promise<string> => {
    try {
        const timestamp = Date.now();
        const fileRef = ref(storage, `chat-images/${timestamp}_${imageName}`);
        
        // Upload base64 image
        await uploadString(fileRef, base64Data, 'data_url');
        
        // Get download URL
        return await getDownloadURL(fileRef);
    } catch (err) {
        console.error("Error uploading chat image:", err);
        throw err;
    }
};

// ─── DYNAMIC CHAT CHANNELS ───────────────────────────────────────────
const CHANNELS_COL = 'chatChannels';

/** Subscribe to chat channels in real-time */
export const subscribeToChatChannels = (onUpdate: (channels: ChatChannel[]) => void) => {
    return onSnapshot(collection(db, CHANNELS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const channels = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...channel } = data;
            return channel as ChatChannel;
        });
        onUpdate(channels);
    }, (error) => {
        console.error("Firebase ChatChannels Sync Error:", error);
    });
};

/** Save or update a chat channel in Firestore */
export const firebaseSaveChatChannel = async (channel: ChatChannel): Promise<void> => {
    const clean: any = {};
    Object.entries(channel).forEach(([k, v]) => {
        if (v !== undefined) clean[k] = v;
    });

    await setDoc(doc(db, CHANNELS_COL, channel.id), {
        ...clean,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/** Delete a chat channel from Firestore */
export const firebaseDeleteChatChannel = async (channelId: string): Promise<void> => {
    await deleteDoc(doc(db, CHANNELS_COL, channelId));
};

/** Delete all messages in a specific channel from Firestore */
export const firebaseDeleteChannelMessages = async (channelId: string): Promise<void> => {
    try {
        const q = query(collection(db, CHAT_COL), where('channel', '==', channelId));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
        await Promise.all(deletePromises);
    } catch (e) {
        console.error(`Failed to delete messages for channel ${channelId}:`, e);
    }
};

/** Subscribe to recent chat messages across all channels */
export const subscribeToRecentMessages = (onUpdate: (messages: any[]) => void) => {
    const q = query(collection(db, CHAT_COL), orderBy('timestamp', 'desc'), limit(20));
    return onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(d => {
            const data = d.data();
            return {
                ...data,
                timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toMillis() : data.timestamp
            };
        });
        onUpdate(msgs);
    }, (error) => {
        console.error("Firebase RecentMessages Sync Error:", error);
    });
};

/** Toggle a message thumbs-up reaction in Firestore */
export const firebaseToggleReaction = async (messageId: string, userId: string, reactionType: string = 'thumbsUp'): Promise<void> => {
    const msgRef = doc(db, CHAT_COL, messageId);
    try {
        const docSnap = await getDoc(msgRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            const reactions = data.reactions || {};
            const userList = reactions[reactionType] || [];
            
            const updatedList = userList.includes(userId)
                ? userList.filter((id: string) => id !== userId)
                : [...userList, userId];
            
            await updateDoc(msgRef, {
                [`reactions.${reactionType}`]: updatedList
            });
        }
    } catch (e) {
        console.error("Failed to toggle reaction:", e);
    }
};

