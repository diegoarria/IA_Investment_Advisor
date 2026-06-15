"use client";

import { useState } from "react";
import { useSubscriptionStore } from "@/lib/store";
import PaywallModal from "@/components/PaywallModal";

export default function PremiumBadge() {
  const [open, setOpen] = useState(false);
  const sub = useSubscriptionStore();
  const isPremium      = sub.tier === "premium";
  const isTrialPremium = sub.isTrialPremium;
  const trialDaysLeft  = sub.trialDaysLeft;

  if (isPremium && isTrialPremium) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,212,126,0.2)" }}
          title="Premium Gratis"
        >
          <span style={{ fontSize: 9, fontWeight: 800, color: "var(--accent-l)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            ✦ {trialDaysLeft}d
          </span>
          <div style={{ width: 36, height: 3, borderRadius: 99, overflow: "hidden", background: "rgba(0,212,126,0.2)", flexShrink: 0 }}>
            <div style={{ height: "100%", borderRadius: 99, width: `${Math.round((trialDaysLeft / 90) * 100)}%`, background: "var(--grad-green)" }} />
          </div>
        </button>
        <PaywallModal visible={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  if (!isPremium) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          title="Activar Premium"
        >
          <span style={{ fontSize: 9, fontWeight: 800, color: "#f59e0b", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
            ✦ Activar
          </span>
        </button>
        <PaywallModal visible={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return null;
}
