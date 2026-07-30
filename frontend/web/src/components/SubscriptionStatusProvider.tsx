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
 */
export default function SubscriptionStatusProvider() {
  useEffect(() => {
    useSubscriptionStore.getState().fetchStatus();
  }, []);

  return null;
}
