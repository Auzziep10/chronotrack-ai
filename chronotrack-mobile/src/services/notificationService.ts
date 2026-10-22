import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Configure how notifications appear when the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let autoPauseNotificationId: string | null = null;

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token;
  } catch (e) {
    console.log("Failed to get push token:", e);
    return null;
  }
}

let scheduledTardyNotificationId: string | null = null;

/**
 * Schedules a local OS notification for 5 minutes after a user's scheduled [SHIFT] start time
 * in case they haven't clocked in yet. Cancelled automatically when they clock in.
 */
export async function scheduleShiftTardyReminder(
  userId: string,
  shiftStartMs: number,
  shiftTitle?: string
): Promise<void> {
  try {
    await cancelShiftTardyReminder();

    const triggerTimeMs = shiftStartMs + 5 * 60 * 1000;
    const secondsUntilTrigger = Math.floor((triggerTimeMs - Date.now()) / 1000);

    // Only schedule if the 5-minute tardy mark is in the future (within the next 24 hours)
    if (secondsUntilTrigger <= 0 || secondsUntilTrigger > 86400) {
      return;
    }

    scheduledTardyNotificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Shift Tardy Alert',
        body: 'You are five minutes late to your shift. You are now tardy. Are you planning on coming to work today?',
        sound: true,
        data: {
          type: 'five_min_tardy_prompt',
          channelId: `dm-${userId}`,
          shiftTitle: shiftTitle || 'Scheduled Shift'
        }
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilTrigger,
        repeats: false,
      },
    });
  } catch (e) {
    console.warn("Failed to schedule local shift tardy reminder:", e);
  }
}

export async function cancelShiftTardyReminder(): Promise<void> {
  try {
    if (scheduledTardyNotificationId) {
      await Notifications.cancelScheduledNotificationAsync(scheduledTardyNotificationId);
      scheduledTardyNotificationId = null;
    }
  } catch (e) {
    console.warn("Failed to cancel shift tardy reminder:", e);
  }
}

