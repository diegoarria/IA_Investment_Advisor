"use client";

// Anonymous visitor ("invitado") tracking for the admin panel — Diego,
// 2026-09-27. Only for people WITHOUT a session: an anonymous per-browser id
// (getGuestId), the page, and — on the first page of a visit — where they came
// from (referrer + UTM). Location/device are added server-side. Logged-in
// users are never sent here.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuthStore, getGuestId } from "@/lib/store";
import { apiBase } from "@/lib/apiBase";

const FIRST_HIT_KEY = "nuvos_guest_tracked_session";

export default function GuestTracker() {
  const pathname = usePathname();
  const { isAuthenticated, authRestoring } = useAuthStore();

  useEffect(() => {
    if (authRestoring || isAuthenticated || !pathname) return;
    // Only on our production origin (the /api/guest/track route adds geo there).
    if (apiBase() !== "") return;
    if (pathname.startsWith("/admin") || pathname.startsWith("/auth")) return;
    const guestId = getGuestId();
    if (!guestId) return;

    const payload: Record<string, string> = { guest_id: guestId, path: pathname };
    let firstHit = false;
    try { firstHit = sessionStorage.getItem(FIRST_HIT_KEY) !== "1"; } catch { /* ignore */ }
    if (firstHit) {
      if (document.referrer) payload.referrer = document.referrer;
      const qs = new URLSearchParams(window.location.search);
      for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
        const v = qs.get(k);
        if (v) payload[k] = v;
      }
      try { sessionStorage.setItem(FIRST_HIT_KEY, "1"); } catch { /* ignore */ }
    }
    fetch("/api/guest/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, [pathname, isAuthenticated, authRestoring]);

  return null;
}
