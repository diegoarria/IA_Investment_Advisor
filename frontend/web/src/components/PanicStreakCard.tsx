"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { decisionsApi } from "@/lib/api";

type StreakData = {
  days: number;
  last_panic_sell_date: string | null;
  milestones: number[];
  claimed_milestones: number[];
  claimable_milestones: number[];
  next_milestone: number | null;
};

export default function PanicStreakCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    decisionsApi.getPanicStreak().then((res) => setStreak(res.data)).catch(() => {});
  }, []);

  if (!streak) return null;

  const claimableNow = streak.claimable_milestones[0] ?? null;
  const progressTarget = streak.next_milestone ?? streak.milestones[streak.milestones.length - 1];
  const progressPct = Math.min((streak.days / progressTarget) * 100, 100);

  const handleClaim = async () => {
    if (!claimableNow || claiming) return;
    setClaiming(true);
    try {
      await decisionsApi.claimPanicStreakMilestone(claimableNow);
      const res = await decisionsApi.getPanicStreak();
      setStreak(res.data);
    } catch {
      // no-op — the claim button just stays visible to retry
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 ${className}`}
      style={{ background: "var(--raised)", borderColor: "var(--border)" }}
    >
      <div
        className="absolute -top-16 -right-16 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,168,94,0.16), transparent 70%)" }}
      />

      <div className="relative flex items-center justify-between mb-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          {t("panicStreak.eyebrow")}
        </span>
        <span
          className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}
        >
          <Flame className="w-3.5 h-3.5" /> {t("panicStreak.badge")}
        </span>
      </div>

      <div className="relative flex items-baseline gap-2 mt-2 mb-1">
        <span className="text-5xl font-black tracking-tight" style={{ color: "var(--text)" }}>{streak.days}</span>
        <span className="text-sm font-bold" style={{ color: "var(--sub)" }}>{t("panicStreak.days")}</span>
      </div>
      <p className="relative text-sm mb-4" style={{ color: "var(--sub)" }}>
        {t("panicStreak.caption")}
      </p>

      <div className="relative h-1.5 rounded-full overflow-hidden mb-2" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #00a862, var(--accent))" }}
        />
      </div>
      <div className="relative flex justify-between text-[11.5px]" style={{ color: "var(--dim)" }}>
        <span style={{ color: "var(--accent-l)", fontWeight: 700 }}>{t("panicStreak.dayLabel", { count: streak.days })}</span>
        {streak.next_milestone ? (
          <span>{t("panicStreak.nextMilestone", { days: streak.next_milestone })}</span>
        ) : (
          <span>{t("panicStreak.allMilestonesReached")}</span>
        )}
      </div>

      {claimableNow && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="relative w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-opacity disabled:opacity-60"
          style={{ background: "var(--accent)", color: "#04140c" }}
        >
          {claiming ? t("panicStreak.claiming") : t("panicStreak.claimCta", { days: claimableNow })}
        </button>
      )}
    </div>
  );
}
