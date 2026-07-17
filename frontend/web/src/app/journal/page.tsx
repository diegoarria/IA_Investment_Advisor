"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, ArrowRight, Loader2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { journalApi } from "@/lib/api";

interface ThesisSummary {
  id: string;
  ticker: string;
  company_name: string | null;
  price_at_creation: number | null;
  intrinsic_value_base: number | null;
  intrinsic_value_expected: number | null;
  margin_of_safety_pct: number | null;
  created_at: string;
}

export default function JournalPage() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theses, setTheses] = useState<ThesisSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    journalApi.list()
      .then((res) => setTheses(res.data?.theses || []))
      .catch(() => setTheses([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-1">
              <BookMarked className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                Investment Journal
              </h1>
            </div>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              Cada análisis completo que le pides a Mentor IA se guarda aquí — vuelve más adelante a revisar si la tesis se cumplió.
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : theses.length === 0 ? (
              <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Todavía no tienes tesis guardadas. Pídele a Mentor IA &quot;Analízame [empresa]&quot; para crear la primera.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                {theses.map((th) => (
                  <button key={th.id} onClick={() => router.push(`/journal/${th.id}`)}
                          className="w-full text-left px-4 py-3 border-b last:border-b-0 flex items-center justify-between gap-3 transition-colors hover:bg-white/[0.03]"
                          style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>
                        {th.ticker} {th.company_name ? `· ${th.company_name}` : ""}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                        {new Date(th.created_at).toLocaleDateString()} · Precio ${th.price_at_creation ?? "N/D"} · Valor intrínseco ${th.intrinsic_value_base ?? "N/D"}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
