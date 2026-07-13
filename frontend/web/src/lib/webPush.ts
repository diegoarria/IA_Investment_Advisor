const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function registerWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    // 1. Fetch VAPID public key
    const keyRes = await fetch(`${API}/api/push/vapid-key`);
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json() as { publicKey?: string };
    if (!publicKey) return false;

    // 2. Register service worker
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    // 3. Check existing subscription
    let sub = await reg.pushManager.getSubscription();

    // 4. Request permission + subscribe if needed
    if (!sub) {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;

      // applicationServerKey accepts string (base64url) or BufferSource.
      // Passing the raw base64url string avoids Uint8Array generic-buffer type errors.
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
    }

    // 5. Send subscription to backend
    const subJson = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await fetch(`${API}/api/push/subscribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys }),
    });

    return true;
  } catch {
    return false;
  }
}
