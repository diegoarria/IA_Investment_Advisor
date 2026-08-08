"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { weeklyRitualsApi } from "@/lib/api";

interface Reflection {
  week_start_date: string;
  went_well: string | null;
  learned: string | null;
  would_do_differently: string | null;
}

export default function WeeklyRitualSaturdayHistoryPage() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    weeklyRitualsApi.getReflectionHistory()
      .then((res) => setReflections(res.data?.reflections || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>🪞 {t("weeklyRitual.saturday.historyTitle")}</h1>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} /></div>
          ) : reflections.length === 0 ? (
            <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{t("weeklyRitual.saturday.historyEmpty")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reflections.map((r) => (
                <div key={r.week_start_date} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <p className="text-[11px] font-bold mb-2" style={{ color: "var(--accent-l)" }}>{r.week_start_date}</p>
                  {r.went_well && <p className="text-xs mb-1.5" style={{ color: "var(--sub)" }}>✅ {r.went_well}</p>}
                  {r.learned && <p className="text-xs mb-1.5" style={{ color: "var(--sub)" }}>🧠 {r.learned}</p>}
                  {r.would_do_differently && <p className="text-xs" style={{ color: "var(--sub)" }}>🔁 {r.would_do_differently}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
