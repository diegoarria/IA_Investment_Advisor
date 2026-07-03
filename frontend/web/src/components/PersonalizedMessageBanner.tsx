"use client";

import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { progressApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

export default function PersonalizedMessageBanner({ className = "" }: { className?: string }) {
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    progressApi
      .getPersonalizedMessage()
      .then((res) => setMessage(res.data?.message ?? null))
      .catch(() => {});
  }, [isPremium]);

  if (!isPremium || dismissed || !message) return null;

  return (
    <div
      className={`flex items-start gap-3 p-3.5 rounded-xl border ${className}`}
      style={{ background: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }}
    >
      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--accent-l)" }} />
      <p className="flex-1 text-sm" style={{ color: "var(--text)" }}>{message}</p>
      <button onClick={() => setDismissed(true)} style={{ color: "var(--muted)" }}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
