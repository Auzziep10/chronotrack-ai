import { initializeApp, getApps } from 'firebase/app';
import {
    getFirestore,
    doc,
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
import { User, UserSession, WorkLog, DailyTimeCard, AppSettings, QuickTask, ChatMessage, ChatChannel } from '../types';

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

/** Clock in — writes/overwrites session document in Firestore */
export const firebaseClockIn = async (user: User, clockInDepartment?: string, isUnscheduled?: boolean): Promise<void> => {
    const now = Date.now();
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
        updatedAt: serverTimestamp()
    });
};

/** Clock out — marks session clockedOut and saves a time card */
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
        date: new Date(session.startTime).toISOString().split('T')[0],
        clockIn: session.startTime,
        clockOut: now,
        totalHours: netHours,
        totalIdleHours: totalIdleHours,
        status: 'Complete'
    };

    await setDoc(doc(db, SESSIONS_COL, userId), {
        clockedOut: true,
        clockOutTime: now,
        isPaused: false,
        totalIdleTimeMs: totalIdle,
        updatedAt: serverTimestamp()
    }, { merge: true });

    await setDoc(doc(db, TIMECARDS_COL, timeCard.id), {
        ...timeCard,
        createdAt: serverTimestamp()
    });

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

// ─── TEAM DASHBOARD DATABASE INTEGRATION ──────────────────────────────
const teamDashboardConfig = {
    apiKey: "AIzaSyAGiJrWnwbdY4PrI-YHMf7DWOS9wFlsY3c",
    authDomain: "print-shop-os-f8092.firebaseapp.com",
    projectId: "print-shop-os-f8092",
    storageBucket: "print-shop-os-f8092.firebasestorage.app",
    messagingSenderId: "637868552650",
    appId: "1:637868552650:web:473f9f71ad41703ec7df33"
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

/** Subscribe to chat messages for a specific channel, ordered by timestamp */
export const subscribeToChatMessages = (
    channel: string,
    onUpdate: (messages: ChatMessage[]) => void
) => {
    const q = query(
        collection(db, CHAT_COL),
        where('channel', '==', channel),
        orderBy('timestamp', 'asc')
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
                timestamp: data.timestamp instanceof Timestamp ? data.timestamp.toMillis() : data.timestamp
            } as ChatMessage;
        });
        onUpdate(messages);
    }, (error) => {
        console.error("Firebase ChatMessages Sync Error:", error);
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

