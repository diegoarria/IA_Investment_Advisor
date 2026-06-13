"use client";

import { useEffect, useState } from "react";
import { Trophy, TrendingUp, TrendingDown, Users, Star, Loader2, Medal } from "lucide-react";
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

function RankMedal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base">🥇</span>;
  if (rank === 2) return <span className="text-base">🥈</span>;
  if (rank === 3) return <span className="text-base">🥉</span>;
  return <span className="text-xs font-bold" style={{ color: "var(--muted)", minWidth: 20, display: "inline-block", textAlign: "center" }}>#{rank}</span>;
}

export default function PortfolioLeaderboard({ isPremium, onUpgrade }: Props) {
  const [period, setPeriod] = useState<Period>("ytd");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    setError(null);
    portfolioLeaderboardApi
      .get(period)
      .then((res) => setData(res.data))
      .catch(() => setError("No se pudo cargar el ranking. Intenta de nuevo."))
      .finally(() => setLoading(false));
  }, [period, isPremium]);

  if (!isPremium) {
    return (
      <PremiumToolLocked
        title="Ranking de Portafolios"
        tagline="Compara tu rendimiento con otros inversores"
        description="Ve cómo se compara tu portafolio con el de otros usuarios de Nuvos AI. Ranking semanal, mensual y anual."
        icon={Trophy}
        color="#f59e0b"
        benefits={[
          { icon: Trophy, text: "Ranking YTD, mensual y semanal" },
          { icon: TrendingUp, text: "Win rate y mejor ticker" },
          { icon: Users, text: "Compara con toda la comunidad" },
        ]}
        onUnlock={onUpgrade}
      />
    );
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={18} style={{ color: "#f59e0b" }} />
        <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>
          Ranking de Portafolios
        </h3>
        <span
          className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
        >
          PREMIUM
        </span>
      </div>

      {/* Period tabs */}
      <div
        className="flex gap-1 p-1 rounded-xl mb-4"
        style={{ background: "var(--background)" }}
      >
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="flex-1 text-xs py-1.5 rounded-lg font-semibold transition-all"
            style={{
              background: period === p ? "var(--card)" : "transparent",
              color: period === p ? "var(--text)" : "var(--muted)",
              border: period === p ? "1px solid var(--border)" : "1px solid transparent",
            }}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Stats row */}
      {data && !loading && (
        <div className="flex gap-3 mb-4">
          <div
            className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "var(--background)", border: "1px solid var(--border)" }}
          >
            <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>Tu posición</p>
            <p className="text-lg font-extrabold" style={{ color: "var(--text)" }}>
              {data.my_rank ? `#${data.my_rank}` : "—"}
            </p>
          </div>
          <div
            className="flex-1 rounded-xl p-3 text-center"
            style={{ background: "var(--background)", border: "1px solid var(--border)" }}
          >
            <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>Total inversores</p>
            <p className="text-lg font-extrabold" style={{ color: "var(--text)" }}>
              {data.total_users}
            </p>
          </div>
        </div>
      )}

      {/* Content */}
      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--muted)" }} />
        </div>
      )}

      {error && !loading && (
        <p className="text-center text-xs py-6" style={{ color: "var(--muted)" }}>{error}</p>
      )}

      {data && !loading && data.leaderboard.length === 0 && (
        <p className="text-center text-xs py-6" style={{ color: "var(--muted)" }}>
          No hay datos suficientes para este período.
        </p>
      )}

      {data && !loading && data.leaderboard.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.leaderboard.map((entry) => (
            <div
              key={entry.rank}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
              style={{
                background: entry.is_me ? "rgba(139,92,246,0.08)" : "var(--background)",
                border: entry.is_me ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--border)",
              }}
            >
              {/* Rank */}
              <div className="w-6 flex items-center justify-center">
                <RankMedal rank={entry.rank} />
              </div>

              {/* Name + badge */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-sm font-semibold truncate"
                    style={{ color: entry.is_me ? "#a78bfa" : "var(--text)" }}
                  >
                    {entry.display_name}
                  </span>
                  {entry.is_me && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}
                    >
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

              {/* Return */}
              <div className="flex items-center gap-1 shrink-0">
                {entry.return_pct >= 0 ? (
                  <TrendingUp size={13} style={{ color: "#22c55e" }} />
                ) : (
                  <TrendingDown size={13} style={{ color: "#ef4444" }} />
                )}
                <span
                  className="text-sm font-bold"
                  style={{ color: entry.return_pct >= 0 ? "#22c55e" : "#ef4444" }}
                >
                  {entry.return_pct >= 0 ? "+" : ""}
                  {entry.return_pct.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] mt-3 text-center" style={{ color: "var(--muted)" }}>
        Rendimiento del período · No incluye valores monetarios · Solo primeros nombres
      </p>
    </div>
  );
}
