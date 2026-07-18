"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Lock, BookMarked, Search, X, Star, MessageCircle, AlertTriangle, Check, Sparkles } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import StockAvatar from "@/components/StockAvatar";
import { screenerApi, watchlist } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

interface ChecklistItem {
  name: string;
  passed: boolean | null;
  reason: string;
}

interface Checklist {
  items: ChecklistItem[];
  score: string;
}

interface UndervaluedResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  margin_of_safety_pct: number | null;
  thesis_scores: Record<string, number> | null;
  weak_dimension_warning: string | null;
  blurb: string | null;
  checklist: Checklist | null;
}

interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  intrinsic_value_base: number | null;
  expected_value_per_share: number | null;
  margin_of_safety_pct: number | null;
  implied_growth_pct: number | null;
  thesis_scores: Record<string, number> | null;
  summary: string;
  checklist: Checklist | null;
}

function relativeDate(unixSeconds: number): { text: string; stale: boolean } {
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  if (days <= 0) return { text: "hoy", stale: false };
  if (days === 1) return { text: "hace 1 día", stale: false };
  return { text: `hace ${days} días`, stale: days > 10 };
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl px-2.5 py-1.5" style={{ background: "var(--raised)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{value}</p>
    </div>
  );
}

function InsightBox({ children }: { children: string }) {
  return (
    <div className="rounded-xl p-3 flex gap-2 items-start"
         style={{ background: "rgba(0,168,94,0.06)", border: "1px solid rgba(0,168,94,0.18)" }}>
      <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--accent-l)" }} />
      <div className="text-xs leading-relaxed prose-sm [&_p]:m-0 [&_p+p]:mt-2" style={{ color: "var(--sub)" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
      </div>
    </div>
  );
}

function WarningBadge({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
         style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "#f59e0b" }} />
      <p className="text-[11px] font-medium" style={{ color: "#f59e0b" }}>Posible trampa de valor: {text}</p>
    </div>
  );
}

function ChecklistDisplay({ checklist }: { checklist: Checklist }) {
  const [expanded, setExpanded] = useState(false);
  const passedCount = checklist.items.filter((it) => it.passed === true).length;
  const total = checklist.items.length;
  const scoreColor = passedCount >= 6 ? "#22c55e" : passedCount >= 4 ? "#f59e0b" : "#ef4444";

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <button onClick={() => setExpanded((e) => !e)} className="w-full flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black" style={{ color: scoreColor }}>{passedCount}/{total}</span>
          <span className="text-xs font-semibold" style={{ color: "var(--sub)" }}>Checklist de inversión</span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>{expanded ? "Ocultar" : "Ver detalle"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {checklist.items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              {item.passed === true ? (
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#22c55e" }} />
              ) : item.passed === false ? (
                <X className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "#ef4444" }} />
              ) : (
                <span className="w-3.5 h-3.5 mt-0.5 shrink-0 flex items-center justify-center text-[10px] font-bold" style={{ color: "var(--muted)" }}>?</span>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{item.name}</p>
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>{item.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MosBadge({ pct }: { pct: number | null }) {
  const positive = (pct ?? 0) >= 0;
  return (
    <span className="shrink-0 text-sm font-black px-2.5 py-1 rounded-xl"
          style={{
            background: positive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)",
            color: positive ? "#22c55e" : "#ef4444",
          }}>
      {positive ? "+" : ""}{pct}%
    </span>
  );
}

function FollowButton({ ticker, watchlisted, onFollow }: { ticker: string; watchlisted: boolean; onFollow: () => void }) {
  return (
    <button onClick={onFollow} disabled={watchlisted}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--sub)", background: "var(--raised)" }}>
      {watchlisted ? <Check className="w-3.5 h-3.5" style={{ color: "#22c55e" }} /> : <Star className="w-3.5 h-3.5" />}
      {watchlisted ? "En tu watchlist" : "Seguir"}
    </button>
  );
}

function AnalyzeButton({ onAnalyze }: { onAnalyze: () => void }) {
  return (
    <button onClick={onAnalyze}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-black"
            style={{ background: "var(--accent)" }}>
      <MessageCircle className="w-3.5 h-3.5" />
      Analizar con Mentor IA
    </button>
  );
}

export default function SubvaluadasPage() {
  const router = useRouter();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [results, setResults] = useState<UndervaluedResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [sectorFilter, setSectorFilter] = useState<string>("Todos");
  const [watchlisted, setWatchlisted] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickAnalysisResult | null>(null);

  const handleFollow = async (ticker: string, companyName: string | null) => {
    if (watchlisted.has(ticker)) return;
    try {
      await watchlist.add(ticker, companyName || undefined);
      setWatchlisted((prev) => new Set(prev).add(ticker));
    } catch {
      // Silently ignore duplicates/errors — watchlist add is idempotent enough that
      // the user retrying by clicking again is a fine fallback.
    }
  };

  const handleAnalyze = (ticker: string) => {
    router.push(`/chat?msg=${encodeURIComponent(`Analiza ${ticker}`)}&autosend=1`);
  };

  const handleSearch = async () => {
    if (!query.trim() || !isPremium) return;
    setSearching(true);
    setSearchError(null);
    setQuickResult(null);
    try {
      const res = await screenerApi.quickAnalysis(query.trim());
      setQuickResult(res.data);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSearchError(detail || "No se pudo calcular el valor intrínseco para esa búsqueda.");
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    screenerApi.getUndervalued(undefined, 60)
      .then((res) => {
        setResults(res.data?.results || []);
        setGeneratedAt(res.data?.generated_at || 0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [isPremium]);

  const sectors = useMemo(() => {
    const unique = Array.from(new Set(results.map((r) => r.sector).filter(Boolean))) as string[];
    return ["Todos", ...unique.sort()];
  }, [results]);

  const filtered = sectorFilter === "Todos" ? results : results.filter((r) => r.sector === sectorFilter);

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
                Acciones Subvaluadas (DCF)
              </h1>
            </div>

            <div className="rounded-2xl border-2 p-4 mb-5 text-center"
                 style={{ borderColor: "#ef4444", background: "rgba(239,68,68,0.08)" }}>
              <p className="text-lg font-black tracking-tight" style={{ color: "#ef4444" }}>
                ESTO NO ES RECOMENDACIÓN DE INVERSIÓN
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--sub)" }}>
                Para un análisis más detallado, ve a Mentor IA.
              </p>
            </div>

            {isPremium && (
              <div className="mb-6">
                <h2 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>Buscar cualquier acción</h2>
                <div className="flex gap-2">
                  <div className="flex-1 flex items-center gap-2 rounded-xl border px-3"
                       style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <Search className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder="Ticker o nombre de empresa (ej. AAPL, Nike)"
                      className="flex-1 py-2.5 text-sm bg-transparent outline-none"
                      style={{ color: "var(--text)" }}
                    />
                    {query && (
                      <button onClick={() => { setQuery(""); setQuickResult(null); setSearchError(null); }}>
                        <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
                      </button>
                    )}
                  </div>
                  <button onClick={handleSearch} disabled={searching || !query.trim()}
                          className="px-4 py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-40"
                          style={{ background: "var(--accent)" }}>
                    {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
                  </button>
                </div>

                {searchError && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{searchError}</p>}

                {quickResult && (
                  <div className="mt-3 rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                    <div className="flex items-center gap-3">
                      <StockAvatar ticker={quickResult.ticker} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{quickResult.ticker}</p>
                        <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                          {quickResult.company_name}{quickResult.sector ? ` · ${quickResult.sector}` : ""}
                        </p>
                      </div>
                      <MosBadge pct={quickResult.margin_of_safety_pct} />
                    </div>

                    <div className="flex gap-2">
                      <StatChip label="Precio" value={`$${quickResult.price}`} />
                      <StatChip label="Valor intrínseco" value={`$${quickResult.intrinsic_value_base}`} />
                      <StatChip label="Valor esperado" value={`$${quickResult.expected_value_per_share}`} />
                      {quickResult.implied_growth_pct !== null && (
                        <StatChip label="Crecim. implícito" value={`${quickResult.implied_growth_pct}%`} />
                      )}
                    </div>

                    {quickResult.checklist && <ChecklistDisplay checklist={quickResult.checklist} />}

                    <InsightBox>{quickResult.summary}</InsightBox>

                    <div className="flex gap-2">
                      <FollowButton ticker={quickResult.ticker} watchlisted={watchlisted.has(quickResult.ticker)}
                                    onFollow={() => handleFollow(quickResult.ticker, quickResult.company_name)} />
                      <AnalyzeButton onAnalyze={() => handleAnalyze(quickResult.ticker)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
              Todas las candidatas con margen de seguridad positivo real, calculadas con el mismo motor de valor
              intrínseco de Mentor IA sobre el universo curado — actualizado semanalmente.
              {generatedAt > 0 && (() => {
                const { text, stale } = relativeDate(generatedAt);
                return (
                  <span style={stale ? { color: "#f59e0b", fontWeight: 700 } : undefined}>
                    {" "}Actualizado {text} ({new Date(generatedAt * 1000).toLocaleDateString("es-MX", { day: "numeric", month: "long" })}){stale ? " — puede estar desactualizado" : "."}
                  </span>
                );
              })()}
            </p>

            {!isPremium ? (
              <div className="rounded-2xl border p-8 text-center" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(0,168,94,0.1)" }}>
                  <Lock className="w-7 h-7" style={{ color: "var(--accent-l)" }} />
                </div>
                <h2 className="font-bold text-base mb-2" style={{ color: "var(--text)" }}>Exclusivo Premium</h2>
                <p className="text-sm mb-5 max-w-sm mx-auto" style={{ color: "var(--muted)" }}>
                  El screener de acciones subvaluadas usa el motor real de DCF — disponible solo para usuarios Premium.
                </p>
                <button onClick={() => setPaywallOpen(true)}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  Desbloquear Premium
                </button>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-2xl border p-8 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Todavía no hay datos del screener semanal — vuelve más tarde.
                </p>
              </div>
            ) : (
              <>
                {sectors.length > 2 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    {sectors.map((s) => (
                      <button key={s} onClick={() => setSectorFilter(s)}
                              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                              style={{
                                borderColor: sectorFilter === s ? "var(--accent)" : "var(--border)",
                                background: sectorFilter === s ? "rgba(0,168,94,0.1)" : "var(--raised)",
                                color: sectorFilter === s ? "var(--accent-l)" : "var(--sub)",
                              }}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-3">
                  {filtered.map((u) => (
                    <div key={u.ticker} className="rounded-2xl border p-4 space-y-3"
                         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      <div className="flex items-center gap-3">
                        <StockAvatar ticker={u.ticker} size="md" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{u.ticker}</p>
                          <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                            {u.company_name}{u.sector ? ` · ${u.sector}` : ""}
                          </p>
                        </div>
                        <MosBadge pct={u.margin_of_safety_pct} />
                      </div>

                      <div className="flex gap-2">
                        <StatChip label="Precio" value={`$${u.price}`} />
                        <StatChip label="Valor intrínseco" value={`$${u.intrinsic_value_base}`} />
                        <StatChip label="Business Quality" value={`${u.thesis_scores?.business_quality ?? "N/D"}/100`} />
                      </div>

                      {u.weak_dimension_warning && <WarningBadge text={u.weak_dimension_warning} />}
                      {u.checklist && <ChecklistDisplay checklist={u.checklist} />}
                      {u.blurb && <InsightBox>{u.blurb}</InsightBox>}

                      <div className="flex gap-2">
                        <FollowButton ticker={u.ticker} watchlisted={watchlisted.has(u.ticker)}
                                      onFollow={() => handleFollow(u.ticker, u.company_name)} />
                        <AnalyzeButton onAnalyze={() => handleAnalyze(u.ticker)} />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason="Screener de acciones subvaluadas" />
    </div>
  );
}
