"use client";

import { useEffect } from "react";
import { useSubscriptionStore } from "@/lib/store";

/**
 * Mounted once at the root layout so EVERY page — not just ones that
 * render AppSidebar — refreshes premium/trial status on load. Before this,
 * a user landing directly on a sidebar-less route (a deep link from a push
 * notification, a shared URL, an email link) could sit on the persisted
 * (possibly stale, possibly default "free") subscription state for the
 * entire visit, with no code path that would ever fetch the real one.
 *
 * Diego, 2026-10-26: this used to ONLY fetch once on mount, with no resync
 * afterward — confirmed live: he granted himself Premium from the admin
 * panel in a second tab, and the already-open app tab kept showing "Free"
 * indefinitely because nothing in the whole app ever calls fetchStatus()
 * again after that first mount (AppSidebar's own mount-only fetch has the
 * same gap, and since it lives in a layout that doesn't remount on
 * client-side navigation, that never re-fires either). Same race applies
 * to a real Stripe webhook landing while a tab is already open. A 60s
 * poll — same interval already used elsewhere in the app (e.g. admin's
 * activity-today) — means any tier change self-heals here within a
 * minute instead of requiring a hard reload or logout/login.
 */
export default function SubscriptionStatusProvider() {
  useEffect(() => {
    useSubscriptionStore.getState().fetchStatus();
    const id = setInterval(() => {
      useSubscriptionStore.getState().fetchStatus();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  return null;
}
