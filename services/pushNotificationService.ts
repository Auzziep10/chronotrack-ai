/**
 * Sends a push notification or an array of push notifications via our Vercel API proxy.
 * If running locally in a browser, proxies requests through the production Vercel app to avoid CORS errors.
 */
export async function sendPushNotification(payload: any): Promise<any> {
  const isBrowser = typeof window !== 'undefined';
  let url = 'https://exp.host/--/api/v2/push/send';

  if (isBrowser) {
    const hostname = window.location.hostname;
    // When running locally (localhost / 127.0.0.1 / local IPs), the local server doesn't have Serverless Functions running.
    // We send requests to the deployed production Vercel proxy. Otherwise, we use the relative path.
    url = (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.'))
      ? 'https://chronotrack-ai.vercel.app/api/push'
      : '/api/push';
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  } catch (err) {
    console.warn("Failed to send push notification:", err);
    return null;
  }
}

/** Broadcast immediate tardy alert to managers */
export async function notifyManagersOfTardiness(
  userName: string,
  minutesLate: number,
  shiftTitle?: string,
  managerPushTokens: string[] = []
): Promise<void> {
  if (!managerPushTokens || managerPushTokens.length === 0) return;
  const uniqueTokens = Array.from(new Set(managerPushTokens.filter(Boolean)));
  const payload = uniqueTokens.map(to => ({
    to,
    sound: 'default',
    title: `⏱️ Tardy Alert: ${userName}`,
    body: `${userName} clocked in ${minutesLate} min${minutesLate > 1 ? 's' : ''} late for ${shiftTitle || 'scheduled shift'}.`,
    data: { type: 'tardy_alert', userName, minutesLate }
  }));
  try {
    await sendPushNotification(payload);
  } catch (e) {
    console.error("Error broadcasting tardy notification:", e);
  }
}

/** Broadcast disciplinary strike alert to executive leadership */
export async function notifyManagersOfStrike(
  userName: string,
  strikeLevel: number,
  tardyCount: number,
  managerPushTokens: string[] = []
): Promise<void> {
  if (!managerPushTokens || managerPushTokens.length === 0) return;
  const uniqueTokens = Array.from(new Set(managerPushTokens.filter(Boolean)));
  const strikeLabels = ['', 'Strike 1: Written Warning', 'Strike 2: Final Warning & PIP', 'Strike 3: Termination Review'];
  const title = `🚨 Disciplinary ${strikeLabels[strikeLevel] || `Strike ${strikeLevel}`}`;
  const body = `${userName} has reached ${tardyCount} tardies in the last 30 days. Action required in Manager Console.`;
  
  const payload = uniqueTokens.map(to => ({
    to,
    sound: 'default',
    title,
    body,
    data: { type: 'disciplinary_strike', userName, strikeLevel, tardyCount }
  }));
  try {
    await sendPushNotification(payload);
  } catch (e) {
    console.error("Error broadcasting strike notification:", e);
  }
}

/** Broadcast Monday 7:00 AM weekly digest summary */
export async function notifyManagersOfWeeklyDigest(
  summaryTitle: string,
  summaryBody: string,
  managerPushTokens: string[] = []
): Promise<void> {
  if (!managerPushTokens || managerPushTokens.length === 0) return;
  const uniqueTokens = Array.from(new Set(managerPushTokens.filter(Boolean)));
  const payload = uniqueTokens.map(to => ({
    to,
    sound: 'default',
    title: summaryTitle,
    body: summaryBody,
    data: { type: 'weekly_digest' }
  }));
  try {
    await sendPushNotification(payload);
  } catch (e) {
    console.error("Error broadcasting weekly digest push:", e);
  }
}
