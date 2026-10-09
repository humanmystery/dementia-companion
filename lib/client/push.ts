"use client";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

export function pushConfigured(): boolean {
  return !!(config.apiKey && config.projectId && config.messagingSenderId && config.appId && vapidKey);
}

/** Ask for notification permission and register this phone for photo reminders via FCM. */
export async function enablePush(): Promise<"enabled" | "denied" | "unsupported" | "not-configured"> {
  if (!pushConfigured()) return "not-configured";
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return "unsupported";
  const { isSupported, getMessaging, getToken, onMessage } = await import("firebase/messaging");
  if (!(await isSupported())) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const { initializeApp, getApps } = await import("firebase/app");
  const app = getApps()[0] ?? initializeApp(config);
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  await fetch("/api/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  // In the foreground the page's own polling shows the prompt, so the push message needs no extra handling.
  onMessage(messaging, () => {});
  return "enabled";
}
