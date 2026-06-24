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
// @ts-ignore
import { getAuth, signInAnonymously, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, UserSession, WorkLog, DailyTimeCard, AppSettings, ChatMessage, ChatChannel } from '../types';

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || ''
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

// Initialize Auth with React Native persistence
let auth: any;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
  });
} catch (e) {
  // Fallback if already initialized
  auth = getAuth(app);
}

export const isFirebaseConfigured = () => !!firebaseConfig.projectId;

/** Silently authenticate the device to bypass open API rule alerts */
export const firebaseSilentAuth = async (): Promise<void> => {
    if (!isFirebaseConfigured()) return;
    try {
        await signInAnonymously(auth);
        console.log("Firebase Anonymous Auth successful.");
    } catch (e) {
        console.error("Firebase Anonymous Auth failed:", e);
    }
};

const SESSIONS_COL = 'activeSessions';
const USERS_COL = 'users';
const WORKLOGS_COL = 'workLogs';
const TIMECARDS_COL = 'timeCards';
const SHIFTS_COL = 'shiftSchedules';

// ─── ACTIVE SESSIONS ─────────────────────────────────────────────────────────

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
    });
};

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

export const firebaseClockOut = async (userId: string, session: UserSession): Promise<DailyTimeCard> => {
    const now = Date.now();
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

export const firebaseAddLog = async (userId: string, log: WorkLog): Promise<void> => {
    const cleanLog: any = {};
    Object.entries(log).forEach(([k, v]) => {
        if (v !== undefined) cleanLog[k] = v;
    });

    const now = Date.now();
    await setDoc(doc(db, WORKLOGS_COL, log.id), {
        ...cleanLog,
        createdAt: serverTimestamp()
    });

    try {
        const sessionRef = doc(db, SESSIONS_COL, userId);
        const updateData: any = {
            lastLogTime: log.periodEnd || log.timestamp || now,
            logs: arrayUnion(cleanLog),
            isPaused: false,
            currentIdleStartTime: null,
            updatedAt: serverTimestamp()
        };
        await updateDoc(sessionRef, updateData);
    } catch (e) {
        console.warn("[Firebase] Failed to update session after log add:", e);
    }
};

export const firebaseUpdateSessionStartTime = async (userId: string, newStartTime: number): Promise<void> => {
    await updateDoc(doc(db, SESSIONS_COL, userId), {
        startTime: newStartTime,
        updatedAt: serverTimestamp()
    });
};

export const firebaseResumeSession = async (userId: string, currentSession: any): Promise<void> => {
    const now = Date.now();
    const isActuallyPaused = currentSession.isPaused;
    if (!isActuallyPaused && !currentSession.currentIdleStartTime) return;
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

export const firebasePauseSession = async (userId: string, reason?: 'lunch' | 'idle'): Promise<void> => {
    await updateDoc(doc(db, SESSIONS_COL, userId), {
        isPaused: true,
        pauseReason: reason || null,
        currentIdleStartTime: Date.now(),
        updatedAt: serverTimestamp()
    });
};

export const firebaseDeleteLog = async (logId: string): Promise<void> => {
    await deleteDoc(doc(db, WORKLOGS_COL, logId));
};

// ─── USERS ───────────────────────────────────────────────────────────────────

export const subscribeToUsers = (onUpdate: (users: User[]) => void) => {
    return onSnapshot(collection(db, USERS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const users = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...user } = data;
            return user as User;
        });
        onUpdate(users);
    });
};

export const firebaseGetUsers = async (): Promise<User[]> => {
    const snapshot = await getDocs(collection(db, USERS_COL));
    return snapshot.docs.map(d => {
        const { updatedAt, ...user } = d.data();
        return user as User;
    });
};

export const firebaseUpdateUser = async (userId: string, updates: Partial<User>): Promise<void> => {
    await updateDoc(doc(db, USERS_COL, userId), {
        ...updates,
        updatedAt: serverTimestamp()
    });
};

// ─── SHIFT SCHEDULES ────────────────────────────────────────────────────────

export const subscribeToShiftBlocks = (onUpdate: (blocks: any[]) => void) => {
    return onSnapshot(collection(db, SHIFTS_COL), (snapshot) => {
        if (snapshot.empty) {
            onUpdate([]);
            return;
        }
        const blocks = snapshot.docs.map(d => {
            const data = d.data();
            const { updatedAt, ...block } = data; 
            return block;
        });
        onUpdate(blocks);
    });
};

export const firebaseUpdateTaskProgress = async (taskId: string, progress: number, notes: string, userName: string): Promise<void> => {
    const taskRef = doc(db, SHIFTS_COL, taskId);
    
    // Create a robust check-in object matching the web app schema
    const checkIn = {
        id: `ci-${Date.now()}`,
        timestamp: Date.now(),
        notes: notes || `Progress: ${progress}%`,
        status: progress === 100 ? 'completed' : 'in_progress',
        progressPercent: progress, // Support both formats
        progress: progress,
        userName: userName
    };

    try {
        await updateDoc(taskRef, {
            checkIns: arrayUnion(checkIn),
            status: progress === 100 ? 'completed' : 'in_progress',
            updatedAt: serverTimestamp()
        });
    } catch (e) {
        console.warn("[Firebase] Failed to update task checkIns:", e);
    }
};

// ─── SETTINGS ────────────────────────────────────────────────────────
const CONFIG_COL = 'config';

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

// ─── TEAM CHAT ROOM ──────────────────────────────────────────────────
const CHAT_COL = 'chatMessages';
const CHANNELS_COL = 'chatChannels';

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
};

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

export { db, auth };
