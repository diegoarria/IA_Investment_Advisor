self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "Nuvos AI", body: event.data.text() }; }

  const title = payload.title || "Nuvos AI";
  const body  = payload.body  || "";
  const icon  = payload.icon  || "/logo.png";
  const data  = payload.data  || {};

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/favicon-192.png",
      data,
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const screen = event.notification.data?.screen || "portfolio";
  const url = self.location.origin + "/" + screen;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const existing = cs.find((c) => c.url.startsWith(self.location.origin) && "focus" in c);
      if (existing) { existing.focus(); existing.navigate(url); return; }
      clients.openWindow(url);
    })
  );
});
