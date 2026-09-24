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
  const eventId = event.notification.data?.event_id;
  const msg = event.notification.data?.msg || event.notification.data?.prefill;
  // job_macro_event_watch's CPI/NFP/FOMC/etc. push carries an event_id so
  // the watchlist page can auto-open that day's impact panel — see
  // WatchlistEarningsCalendar's initialEventId prop. Several worker.py jobs
  // instead carry a msg/prefill so chat/page.tsx opens Arthur with that
  // question pre-filled (never auto-sent — see chat page's own ?msg= effect).
  let url = self.location.origin + "/" + screen;
  // Friday 1:1-call upsell -> straight into the session checkout on the web app.
  if (screen === "products_session") url = self.location.origin + "/products?open=session";
  if (screen === "watchlist" && eventId) url += `?macroEventId=${encodeURIComponent(eventId)}`;
  else if (screen === "chat" && msg) url += `?msg=${encodeURIComponent(msg)}`;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const existing = cs.find((c) => c.url.startsWith(self.location.origin) && "focus" in c);
      if (existing) { existing.focus(); existing.navigate(url); return; }
      clients.openWindow(url);
    })
  );
});
