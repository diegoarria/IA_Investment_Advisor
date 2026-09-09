"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store";

/**
 * Diego, 2026-09-09 — real bug reported live: a guest who registers/logs
 * in kept seeing the guest-nag flashcard ("Se nota que te está gustando
 * esto... Crea tu cuenta gratis") indefinitely, because `nuvos_guest`
 * (localStorage) was only ever cleared on logout (store.ts's clearAuth),
 * never on the way in (setAuth) — now fixed there too, but that alone
 * only stops the flag from being SET going forward. Anyone already
 * authenticated with the stale flag stuck from before that fix needs it
 * cleared retroactively — this is that cleanup, mounted once at the root
 * layout so it runs on every page for every signed-in session.
 */
export default function GuestFlagGuard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authRestoring = useAuthStore((s) => s.authRestoring);

  useEffect(() => {
    if (authRestoring || !isAuthenticated) return;
    try {
      if (localStorage.getItem("nuvos_guest") === "1") {
        localStorage.removeItem("nuvos_guest");
      }
    } catch {}
  }, [isAuthenticated, authRestoring]);

  return null;
}
