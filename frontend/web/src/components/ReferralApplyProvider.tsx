"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/store";
import { applyPendingReferralIfAny } from "@/lib/referral";

/**
 * Safety net for the referral-code-applies-on-signup flow — mounted once at
 * the root layout so a code left behind by a transient failure (network
 * hiccup, a 401 that fired before the new session cookie had propagated) on
 * register/Google-OAuth gets a real retry on the next page load, instead of
 * sitting in localStorage forever with no other code path that ever reads
 * it again. Only fires once there's an actual session — applyCode requires
 * one, and this is a no-op for a guest.
 */
export default function ReferralApplyProvider() {
  useEffect(() => {
    if (useAuthStore.getState().userId) {
      applyPendingReferralIfAny();
    }
  }, []);

  return null;
}
