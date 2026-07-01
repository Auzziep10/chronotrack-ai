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
}
