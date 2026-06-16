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
import { Menu, X, Sun, Moon, Loader2, ChevronLeft, TrendingUp, Info, Copy, Check } from "lucide-react";
import { watchlist as watchlistApi } from "@/lib/api";

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
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    investorsApi.list()
      .then((r) => setInvestors(r.data.investors ?? []))
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, [isAuthenticated]);

  const copyPortfolio = async () => {
    if (!selected || copying) return;
    const tickers = selected.holdings.filter((h) => h.ticker && h.ticker !== "N/A").map((h) => ({ ticker: h.ticker, name: h.name }));
    if (tickers.length === 0) return;
    setCopying(true);
    try {
      await Promise.allSettled(tickers.slice(0, 20).map((t) => watchlistApi.add(t.ticker, t.name)));
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } finally {
      setCopying(false);
    }
  };

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

                    {/* Copy Portfolio */}
                    {selected.holdings.some((h) => h.ticker) && (
                      <button
                        onClick={copyPortfolio}
                        disabled={copying}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all disabled:opacity-60"
                        style={{
                          background: copied ? "rgba(0,212,126,0.12)" : "var(--grad-green)",
                          color: copied ? "var(--accent)" : "#000",
                          border: copied ? "1px solid var(--accent)" : "none",
                          boxShadow: copied ? "none" : "var(--shadow-accent-sm)",
                        }}>
                        {copying ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : copied ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        {copying ? "Agregando a Watchlist..." : copied ? "¡Portafolio copiado a tu Watchlist!" : "Copiar Portafolio → Watchlist"}
                      </button>
                    )}

                    {/* AI Analysis */}
                    {selected.analysis && (() => {
                      const sentences = (selected.analysis.match(/[^.!?]+[.!?]+/g) ?? [selected.analysis])
                        .map(s => s.trim()).filter(s => s.length > 15);
                      const insightConfig = [
                        { icon: "🏛️", bg: "rgba(59,130,246,0.07)", border: "rgba(59,130,246,0.18)", dot: "#3b82f6", label: "Sectores" },
                        { icon: "🌐", bg: "rgba(168,85,247,0.07)", border: "rgba(168,85,247,0.18)", dot: "#a855f7", label: "Visión macro" },
                        { icon: "💡", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.18)", dot: "#f59e0b", label: "Para el inversor" },
                        { icon: "🎯", bg: "rgba(0,168,94,0.07)", border: "rgba(0,168,94,0.18)", dot: "var(--accent-l)", label: "Conclusión" },
                      ];
                      return (
                        <div className="rounded-2xl overflow-hidden" style={{
                          background: "linear-gradient(145deg, rgba(0,168,94,0.05) 0%, var(--card) 40%, rgba(0,168,94,0.03) 100%)",
                          border: "1px solid rgba(0,168,94,0.22)",
                          boxShadow: "0 0 48px rgba(0,168,94,0.05), inset 0 1px 0 rgba(0,168,94,0.12)",
                        }}>
                          {/* shimmer top line */}
                          <div style={{ height: 2, background: "linear-gradient(90deg, transparent 0%, rgba(0,212,126,0.6) 40%, rgba(0,168,94,0.8) 60%, transparent 100%)" }} />

                          <div className="p-5">
                            {/* Header */}
                            <div className="flex items-center justify-between mb-5">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                                     style={{ background: "linear-gradient(135deg, rgba(0,168,94,0.25), rgba(0,212,126,0.1))", border: "1px solid rgba(0,168,94,0.35)", boxShadow: "0 0 16px rgba(0,168,94,0.15)" }}>
                                  <span style={{ fontSize: 18 }}>✦</span>
                                </div>
                                <div>
                                  <p className="text-sm font-black tracking-widest uppercase" style={{ color: "var(--accent-l)", letterSpacing: "0.14em" }}>Análisis IA</p>
                                  <p className="text-[10px] mt-0.5" style={{ color: "var(--dim)" }}>Generado por Claude · Basado en datos públicos SEC</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0"
                                    style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)", border: "1px solid rgba(0,168,94,0.25)" }}>
                                Premium
                              </span>
                            </div>

                            {/* Insight cards */}
                            <div className="space-y-2.5">
                              {sentences.map((s, i) => {
                                const cfg = insightConfig[i % insightConfig.length];
                                return (
                                  <div key={i} className="flex gap-3 p-3.5 rounded-xl" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                                    <span className="text-lg shrink-0 leading-none mt-0.5">{cfg.icon}</span>
                                    <div className="flex-1 min-w-0">
                                      <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: cfg.dot, letterSpacing: "0.1em" }}>{cfg.label}</span>
                                      <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>{s}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Footer */}
                            <div className="flex items-center gap-2 mt-5 pt-4" style={{ borderTop: "1px solid rgba(0,168,94,0.08)" }}>
                              <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                                   style={{ background: "rgba(0,168,94,0.12)", border: "1px solid rgba(0,168,94,0.2)" }}>
                                <span style={{ fontSize: 9, color: "var(--accent-l)" }}>✦</span>
                              </div>
                              <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                                Análisis generado por IA · No constituye asesoramiento de inversión
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

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
