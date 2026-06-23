// Service Worker — handles Web Push notifications
// Installed automatically when the user enables push in settings.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Nuvos AI", body: event.data.text() };
  }

  const title = payload.title || "Nuvos AI";
  const options = {
    body: payload.body || "",
    icon: "/logo.png",
    badge: "/logo.png",
    data: payload.data || {},
    tag: payload.data?.category || "default",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const screen = data.screen;

  const urlMap = {
    portfolio: "/portfolio",
    watchlist: "/watchlist",
    chat: "/chat",
    feed: "/feed",
    notifications: "/notifications",
  };

  const path = urlMap[screen] || "/notifications";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.postMessage({ type: "PUSH_CLICK", data });
            return client.focus();
          }
        }
        return clients.openWindow(path);
      })
  );
});
