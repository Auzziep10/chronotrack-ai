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
    arrayUnion
} from 'firebase/firestore';
import { User, UserSession, WorkLog, DailyTimeCard } from '../types';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

export const isFirebaseConfigured = () => !!firebaseConfig.projectId;

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
    });
};

/** Clock in — writes/overwrites session document in Firestore */
export const firebaseClockIn = async (user: User): Promise<void> => {
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
        clockedOut: false,
        updatedAt: serverTimestamp()
    });
};

/** Clock out — marks session clockedOut and saves a time card */
export const firebaseClockOut = async (userId: string, session: UserSession): Promise<DailyTimeCard> => {
    const now = Date.now();
    const totalHours = (now - session.startTime) / (1000 * 60 * 60);

    const timeCard: DailyTimeCard = {
        id: `tc-${userId}-${now}`,
        userId,
        date: new Date(session.startTime).toISOString().split('T')[0],
        clockIn: session.startTime,
        clockOut: now,
        totalHours,
        status: 'Complete'
    };

    await setDoc(doc(db, SESSIONS_COL, userId), {
        clockedOut: true,
        clockOutTime: now,
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

    await setDoc(doc(db, WORKLOGS_COL, log.id), {
        ...cleanLog,
        createdAt: serverTimestamp()
    });

    // Update session's lastLogTime and logs array ONLY if they are already clocked in
    try {
        await updateDoc(doc(db, SESSIONS_COL, userId), {
            lastLogTime: log.periodEnd,
            logs: arrayUnion(cleanLog),
            updatedAt: serverTimestamp()
        });
    } catch (e) {
        // Ignore if document doesn't exist (user not clocked in)
        console.debug("User not clocked in, skipping session timer update.");
    }
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

export { db };
