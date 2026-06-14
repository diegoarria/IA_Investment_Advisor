"use client";

import { useEffect, useState } from "react";
import { Trophy, TrendingUp, TrendingDown, Users, Star, Loader2, Sparkles, X } from "lucide-react";
import PremiumToolLocked from "@/components/PremiumToolLocked";
import { portfolioLeaderboardApi } from "@/lib/api";

type Period = "ytd" | "1m" | "1w";

interface LeaderboardEntry {
  rank: number;
  display_name: string;
  is_me: boolean;
  return_pct: number;
  positions_count: number;
  best_ticker: string | null;
  best_ticker_return: number | null;
  win_rate: number;
  is_premium: boolean;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  period: string;
  my_rank: number | null;
  total_users: number;
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

const PERIOD_LABELS: Record<Period, string> = {
  ytd: "Este año",
  "1m": "Último mes",
  "1w": "Última semana",
};

const TOOL_COLOR = "#f59e0b";

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base">🥇</span>;
  if (rank === 2) return <span className="text-base">🥈</span>;
  if (rank === 3) return <span className="text-base">🥉</span>;
  return <span className="text-xs font-bold" style={{ color: "var(--muted)", minWidth: 20, display: "inline-block", textAlign: "center" }}>#{rank}</span>;
}

export default function PortfolioLeaderboard({ isPremium, onUpgrade }: Props) {
  const [open, setOpen]       = useState(false);
  const [period, setPeriod]   = useState<Period>("ytd");
  const [data, setData]       = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!isPremium || !open) return;
    setLoading(true);
    setError(null);
    portfolioLeaderboardApi
      .get(period)
      .then((res) => setData(res.data))
      .catch(() => setError("No se pudo cargar el ranking."))
      .finally(() => setLoading(false));
  }, [period, isPremium, open]);

  const handleOpen = () => {
    if (!isPremium) { onUpgrade(); return; }
    setOpen(true);
  };

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Ranking de Portafolios"
        tagline="Compara tu rendimiento con otros inversores"
        description="Ve cómo se compara tu portafolio con el de otros usuarios de Nuvos AI. Ranking semanal, mensual y anual."
        icon={Trophy}
        color={TOOL_COLOR}
        benefits={[
          { icon: Trophy,     text: "Ranking YTD, mensual y semanal" },
          { icon: TrendingUp, text: "Win rate y mejor ticker" },
          { icon: Users,      text: "Compara con toda la comunidad" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <>
      {/* ── Tool Card ── */}
      <div
        onClick={handleOpen}
        className="rounded-3xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: "var(--card)", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}
      >
        {/* Hero */}
        <div className="relative flex flex-col items-center pt-9 pb-7 overflow-hidden"
             style={{ background: TOOL_COLOR + "18" }}>
          <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "15" }} />
          <div className="absolute -bottom-8 -left-5 w-28 h-28 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "0A" }} />
          <div className="relative z-10 w-[88px] h-[88px] rounded-[28px] border-2 flex items-center justify-center"
               style={{ background: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }}>
            <div className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
                 style={{ background: TOOL_COLOR }}>
              <Trophy className="w-8 h-8 text-white" />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-5">
          <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
              style={{ color: "var(--text)" }}>
            Ranking de Portafolios
          </h3>
          <p className="text-[13px] font-bold text-center mb-5 tracking-wide" style={{ color: TOOL_COLOR }}>
            Compara tu rendimiento con otros inversores
          </p>

          <div className="rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
            {[
              { emoji: "🏆", text: "Ranking YTD, mensual y semanal" },
              { emoji: "📈", text: "Win rate y mejor posición" },
              { emoji: "👥", text: "Compara con toda la comunidad" },
            ].map((f, i, arr) => (
              <div key={f.text}
                   className="flex items-center gap-3 px-3.5 py-3"
                   style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0 text-[17px]"
                     style={{ background: TOOL_COLOR + "12" }}>
                  {f.emoji}
                </div>
                <span className="text-[13px] leading-snug font-medium" style={{ color: "var(--sub)" }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); handleOpen(); }}
            className="relative w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-extrabold text-[15px] text-white overflow-hidden tracking-wide transition-opacity hover:opacity-90"
            style={{ background: TOOL_COLOR }}
          >
            <div className="absolute inset-0 top-0 h-1/2 pointer-events-none"
                 style={{ background: "rgba(255,255,255,0.12)" }} />
            <Sparkles className="w-4 h-4" />
            Ver Ranking
          </button>
        </div>
      </div>

      {/* ── Modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
             onClick={() => setOpen(false)}>
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[90vh] flex flex-col"
               style={{ background: "var(--card)" }}
               onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
                 style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4" style={{ color: TOOL_COLOR }} />
                <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Ranking de Portafolios</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 rounded-xl hover:bg-white/5 transition-colors"
                      style={{ color: "var(--muted)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {/* Period tabs */}
              <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ background: "var(--raised)" }}>
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <button key={p} onClick={() => setPeriod(p)}
                          className="flex-1 text-xs py-1.5 rounded-xl font-semibold transition-all"
                          style={{
                            background: period === p ? "var(--card)" : "transparent",
                            color: period === p ? "var(--text)" : "var(--muted)",
                            border: period === p ? "1px solid var(--border)" : "1px solid transparent",
                          }}>
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Stats row */}
              {data && !loading && (
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                    <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>Tu posición</p>
                    <p className="text-lg font-extrabold" style={{ color: "var(--text)" }}>
                      {data.my_rank ? `#${data.my_rank}` : "—"}
                    </p>
                  </div>
                  <div className="flex-1 rounded-2xl p-3 text-center" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                    <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>Total inversores</p>
                    <p className="text-lg font-extrabold" style={{ color: "var(--text)" }}>{data.total_users}</p>
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={22} className="animate-spin" style={{ color: "var(--muted)" }} />
                </div>
              )}
              {error && !loading && (
                <p className="text-center text-xs py-6" style={{ color: "var(--muted)" }}>{error}</p>
              )}
              {data && !loading && data.leaderboard.length === 0 && (
                <p className="text-center text-xs py-6" style={{ color: "var(--muted)" }}>No hay datos suficientes.</p>
              )}
              {data && !loading && data.leaderboard.length > 0 && (
                <div className="flex flex-col gap-2">
                  {data.leaderboard.map((entry) => (
                    <div key={entry.rank}
                         className="flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all"
                         style={{
                           background: entry.is_me ? "rgba(139,92,246,0.08)" : "var(--raised)",
                           border: entry.is_me ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--border)",
                         }}>
                      <div className="w-6 flex items-center justify-center">
                        <RankMedal rank={entry.rank} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate"
                                style={{ color: entry.is_me ? "#a78bfa" : "var(--text)" }}>
                            {entry.display_name}
                          </span>
                          {entry.is_me && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                                  style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                              Tú
                            </span>
                          )}
                          {entry.is_premium && (
                            <Star size={10} style={{ color: "#f59e0b", fill: "#f59e0b", flexShrink: 0 }} />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                            {entry.positions_count} acciones · {entry.win_rate}% ganadoras
                          </span>
                          {entry.best_ticker && (
                            <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                              · mejor: {entry.best_ticker}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {entry.return_pct >= 0
                          ? <TrendingUp size={13} style={{ color: "#22c55e" }} />
                          : <TrendingDown size={13} style={{ color: "#ef4444" }} />}
                        <span className="text-sm font-bold"
                              style={{ color: entry.return_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                          {entry.return_pct >= 0 ? "+" : ""}{entry.return_pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[10px] mt-4 text-center pb-2" style={{ color: "var(--muted)" }}>
                Rendimiento del período · No incluye valores monetarios · Solo primeros nombres
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
