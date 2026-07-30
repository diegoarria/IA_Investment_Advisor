"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { notifications as notificationsApi } from "@/lib/api";
import { isDismissedToday, dismissToday } from "@/lib/dailyDismiss";

const DISMISS_KEY = "nuvos_morning_brief_seen";

interface Brief {
  title: string;
  bullets: string[];
}

export default function MorningBriefCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dismissed, setDismissed] = useState(true); // avoid a flash before the dismiss check runs

  useEffect(() => {
    if (isDismissedToday(DISMISS_KEY)) return;
    setDismissed(false);
    notificationsApi
      .getMorningBrief()
      .then((res) => {
        if (res.data?.title && res.data?.bullets?.length) setBrief(res.data);
      })
      .catch(() => {});
  }, []);

  const close = () => {
    dismissToday(DISMISS_KEY);
    setDismissed(true);
  };

  if (dismissed || !brief) return null;

  return (
    <div
      className={`rounded-2xl border p-4 ${className}`}
      style={{ background: "linear-gradient(135deg, rgba(0,168,94,0.06), rgba(0,168,94,0.02))", borderColor: "rgba(0,168,94,0.2)" }}
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <p className="font-bold text-[15px]" style={{ color: "var(--text)" }}>{brief.title}</p>
        <button onClick={close} style={{ color: "var(--muted)" }} aria-label={t("morningBrief.close")}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="space-y-1.5 mb-3">
        {brief.bullets.map((b, i) => (
          <li key={i} className="text-sm flex items-start gap-2" style={{ color: "var(--sub)" }}>
            <span style={{ color: "var(--accent-l)" }}>•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={close}
        className="text-xs font-bold px-3 py-1.5 rounded-lg"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        {t("morningBrief.read")}
      </button>
    </div>
  );
}
