"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import PremiumBadge from "@/components/PremiumBadge";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import StockAvatar from "@/components/StockAvatar";
import { useAuthStore, useThemeStore } from "@/lib/store";
import { investorsApi } from "@/lib/api";
import { Menu, X, Sun, Moon, Loader2, ChevronLeft, TrendingUp, Info } from "lucide-react";

interface Investor {
  id: string;
  name: string;
  fund: string;
  avatar: string;
  bio: string;
  style: string;
}

interface Holding {
  ticker: string;
  name: string;
  value_thousands: number;
  shares: number;
  weight_pct?: number;
  transaction?: string;
  amount?: string;
  date?: string;
}

interface InvestorDetail extends Investor {
  holdings: Holding[];
  filing_date: string;
  analysis: string;
  data_note: string;
}

function formatValue(thousands: number): string {
  if (!thousands) return "—";
  if (thousands >= 1_000_000) return `$${(thousands / 1_000_000).toFixed(1)}B`;
  if (thousands >= 1_000) return `$${(thousands / 1_000).toFixed(1)}M`;
  return `$${thousands}K`;
}

export default function InvestorsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { theme, toggleTheme } = useThemeStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selected, setSelected] = useState<InvestorDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }
    investorsApi.list()
      .then((r) => setInvestors(r.data.investors ?? []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, [isAuthenticated]);

  const openInvestor = useCallback(async (inv: Investor) => {
    setSelected(null);
    setLoadingDetail(true);
    try {
      const r = await investorsApi.getHoldings(inv.id);
      setSelected(r.data);
    } catch {
      setSelected({ ...inv, holdings: [], filing_date: "", analysis: "", data_note: "" });
    }
    setLoadingDetail(false);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Top bar */}
      <div className="font-ui border-b flex items-center justify-between px-4 py-2 shrink-0"
           style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={() => router.push("/chat")} className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} className="rounded-xl object-cover" />
            <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
          </button>
        </div>
        <span className="font-semibold text-sm" style={{ color: "var(--sub)", fontFamily: "var(--font-body)" }}>
          Inversores
        </span>
        <div className="flex items-center gap-1">
          <PremiumBadge />
          <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-white/5" style={{ color: "var(--muted)" }}>
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <MarketTickerBar />

      <div className="flex flex-1 overflow-hidden relative">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <div className="max-w-2xl mx-auto pb-8 space-y-4">

            {/* Header */}
            <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                     style={{ background: "rgba(0,168,94,0.12)" }}>📡</div>
                <div>
                  <h1 className="font-extrabold text-base" style={{ color: "var(--text)" }}>Rastreador de Inversores</h1>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Posiciones públicas de los mejores inversores del mundo
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 mt-3 p-3 rounded-xl" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
                <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                  Datos con hasta <strong>45 días de retraso</strong> — provenientes de declaraciones públicas obligatorias
                  (SEC Form 13F, STOCK Act, ARK Invest). No son posiciones en tiempo real.
                </p>
              </div>
            </div>

            {/* Investor list or detail */}
            {selected || loadingDetail ? (
              /* ── DETAIL VIEW ── */
              <div>
                <button
                  onClick={() => setSelected(null)}
                  className="flex items-center gap-1.5 mb-3 text-xs font-semibold hover:opacity-70 transition-opacity"
                  style={{ color: "var(--accent-l)" }}
                >
                  <ChevronLeft className="w-4 h-4" /> Todos los inversores
                </button>

                {loadingDetail ? (
                  <div className="rounded-2xl border p-10 flex flex-col items-center gap-3"
                       style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                    <p className="text-sm" style={{ color: "var(--muted)" }}>Consultando SEC EDGAR…</p>
                  </div>
                ) : selected && (
                  <div className="space-y-4">
                    {/* Investor header card */}
                    <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                             style={{ background: "rgba(0,168,94,0.1)", border: "1px solid rgba(0,168,94,0.2)" }}>
                          {selected.avatar}
                        </div>
                        <div className="flex-1">
                          <h2 className="font-extrabold text-base" style={{ color: "var(--text)" }}>{selected.name}</h2>
                          <p className="text-xs font-semibold mt-0.5" style={{ color: "var(--accent-l)" }}>{selected.fund}</p>
                          <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--muted)" }}>{selected.bio}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {selected.style.split(" · ").map((tag) => (
                              <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                    style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {selected.filing_date && (
                        <p className="text-[10px] mt-3 pt-3 border-t" style={{ color: "var(--dim)", borderColor: "var(--border)" }}>
                          Última declaración: {new Date(selected.filing_date).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}
                          {" · "}{selected.data_note}
                        </p>
                      )}
                    </div>

                    {/* AI Analysis */}
                    {selected.analysis && (
                      <div className="rounded-2xl border p-4" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-xs font-black" style={{ color: "var(--accent-l)" }}>✦</span>
                          <span className="text-xs font-black tracking-wide uppercase" style={{ color: "var(--accent-l)" }}>
                            Análisis IA
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>{selected.analysis}</p>
                      </div>
                    )}

                    {/* Holdings table */}
                    <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                        <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>Posiciones declaradas</span>
                        <span className="text-xs ml-auto" style={{ color: "var(--dim)" }}>Top {selected.holdings.length}</span>
                      </div>

                      {selected.holdings.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            No se pudo obtener datos en este momento. Intenta de nuevo más tarde.
                          </p>
                        </div>
                      ) : (
                        selected.holdings.map((h, i) => (
                          <div key={i} className="flex items-center gap-3 px-4 py-3 border-t"
                               style={{ borderColor: "var(--border)" }}>
                            {/* Rank */}
                            <span className="text-[11px] font-black w-5 text-center tabular-nums"
                                  style={{ color: "var(--dim)" }}>
                              {i + 1}
                            </span>

                            {/* Avatar + name */}
                            {h.ticker ? (
                              <StockAvatar ticker={h.ticker} size="sm" />
                            ) : (
                              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0"
                                   style={{ background: "var(--raised)", color: "var(--muted)" }}>
                                —
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              {h.ticker && (
                                <span className="font-bold text-xs" style={{ color: "var(--text)" }}>{h.ticker}</span>
                              )}
                              <p className="text-[11px] truncate" style={{ color: "var(--muted)" }}>{h.name}</p>
                              {/* Congress-style: show transaction type */}
                              {h.transaction && (
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 inline-block`}
                                      style={{
                                        background: h.transaction.toLowerCase().includes("purchase") || h.transaction.toLowerCase().includes("buy")
                                          ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                                        color: h.transaction.toLowerCase().includes("purchase") || h.transaction.toLowerCase().includes("buy")
                                          ? "#22c55e" : "#ef4444",
                                      }}>
                                  {h.transaction}
                                </span>
                              )}
                            </div>

                            {/* Value / weight */}
                            <div className="text-right shrink-0">
                              {h.weight_pct ? (
                                <>
                                  <p className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>
                                    {h.weight_pct.toFixed(1)}%
                                  </p>
                                  <p className="text-[10px]" style={{ color: "var(--dim)" }}>del fondo</p>
                                </>
                              ) : h.value_thousands ? (
                                <>
                                  <p className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>
                                    {formatValue(h.value_thousands)}
                                  </p>
                                  {h.shares > 0 && (
                                    <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                                      {h.shares.toLocaleString()} acc.
                                    </p>
                                  )}
                                </>
                              ) : h.amount ? (
                                <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>{h.amount}</p>
                              ) : null}
                              {h.date && (
                                <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                                  {new Date(h.date).toLocaleDateString("es", { day: "numeric", month: "short" })}
                                </p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ── LIST VIEW ── */
              <div className="space-y-2">
                {loadingList ? (
                  <div className="flex flex-col items-center gap-3 py-12">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                    <p className="text-sm" style={{ color: "var(--muted)" }}>Cargando inversores…</p>
                  </div>
                ) : investors.map((inv) => (
                  <button
                    key={inv.id}
                    onClick={() => openInvestor(inv)}
                    className="w-full rounded-2xl border p-4 flex items-center gap-3 hover:bg-white/3 transition-colors text-left"
                    style={{ background: "var(--card)", borderColor: "var(--border)" }}
                  >
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                         style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.15)" }}>
                      {inv.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{inv.name}</p>
                      <p className="text-xs font-medium" style={{ color: "var(--accent-l)" }}>{inv.fund}</p>
                      <p className="text-[11px] mt-1 line-clamp-1" style={{ color: "var(--muted)" }}>{inv.style}</p>
                    </div>
                    <span className="text-lg" style={{ color: "var(--dim)" }}>›</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
