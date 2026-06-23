/**
 * Web Push subscription helpers.
 * Registers the service worker, requests permission, subscribes via the Push API,
 * and syncs the subscription to the backend.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

async function getVapidKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API}/api/push/vapid-key`);
    if (!res.ok) return null;
    const { publicKey } = await res.json();
    return publicKey ?? null;
  } catch {
    return null;
  }
}

export async function registerAndSubscribe(token: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;

  // 1. Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  // 2. Fetch VAPID public key
  const vapidKey = await getVapidKey();
  if (!vapidKey) return false;

  // 3. Register service worker
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  } catch {
    return false;
  }

  // 4. Subscribe to push
  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
  } catch {
    return false;
  }

  // 5. Send subscription to backend
  try {
    const sub = subscription.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function unsubscribe(token: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (!registration) return;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;

    const endpoint = sub.endpoint;
    await sub.unsubscribe();

    await fetch(`${API}/api/push/subscribe`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // best-effort
  }
}

export async function currentPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function isSubscribed(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}
