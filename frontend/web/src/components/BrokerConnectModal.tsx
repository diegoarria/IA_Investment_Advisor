"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Trash2, RefreshCw, CheckCircle, AlertCircle, Loader2, Link2 } from "lucide-react";
import { brokerageApi } from "@/lib/api";

interface Connection {
  id: string;
  provider: string;
  institution_name: string;
  last_sync_at: string | null;
}

interface BrokerPosition {
  ticker: string;
  name: string;
  shares: number;
  avgPrice: number;
  currentPrice?: number;
  currency: string;
  brokerSource: string;
  institutionName: string;
}

interface Props {
  onClose: () => void;
  onPositionsImported: (positions: BrokerPosition[]) => void;
}

type Screen = "home" | "iol-form" | "syncing";

const BROKERS = [
  {
    id: "ibkr",
    name: "Interactive Brokers",
    logo: "🏛️",
    provider: "plaid",
    desc: "Acciones, opciones, futuros globales",
  },
  {
    id: "schwab",
    name: "Charles Schwab",
    logo: "🟦",
    provider: "plaid",
    desc: "Broker líder en EE.UU.",
  },
  {
    id: "robinhood",
    name: "Robinhood",
    logo: "🪶",
    provider: "plaid",
    desc: "Trading sin comisiones",
  },
  {
    id: "iol",
    name: "Invertir Online",
    logo: "🇦🇷",
    provider: "iol",
    desc: "Bolsa de Buenos Aires + NYSE",
  },
];

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (public_token: string, metadata: { institution: { institution_id: string; name: string } }) => void;
        onExit: () => void;
      }) => { open: () => void };
    };
  }
}

export default function BrokerConnectModal({ onClose, onPositionsImported }: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [iolUser, setIolUser] = useState("");
  const [iolPass, setIolPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [error, setError] = useState("");
  const [plaidReady, setPlaidReady] = useState(false);

  // Load Plaid Link script
  useEffect(() => {
    if (document.querySelector('script[src*="plaid"]')) {
      setPlaidReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.onload = () => setPlaidReady(true);
    document.head.appendChild(script);
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      const res = await brokerageApi.listConnections();
      setConnections(res.data?.connections ?? []);
    } catch {}
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // ── Plaid flow ──────────────────────────────────────────────────────────────

  const handlePlaidBroker = async () => {
    setError("");
    if (!plaidReady || !window.Plaid) {
      setError("Plaid Link no está listo. Intenta de nuevo.");
      return;
    }
    setLoading(true);
    try {
      const res = await brokerageApi.createLinkToken();
      const linkToken = res.data?.link_token;
      if (!linkToken) throw new Error("No se recibió link token");
      setLoading(false);

      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (public_token, metadata) => {
          setScreen("syncing");
          setSyncMsg("Conectando con el broker...");
          try {
            await brokerageApi.exchangePlaidToken(
              public_token,
              metadata.institution.institution_id,
              metadata.institution.name,
            );
            setSyncMsg("Obteniendo posiciones...");
            const holdingsRes = await brokerageApi.getPlaidHoldings();
            const positions: BrokerPosition[] = holdingsRes.data?.positions ?? [];
            await loadConnections();
            onPositionsImported(positions);
            setSyncMsg(`✓ ${positions.length} posiciones importadas de ${metadata.institution.name}`);
          } catch {
            setSyncMsg("");
            setError("Error al obtener posiciones. Intenta de nuevo.");
            setScreen("home");
          }
        },
        onExit: () => setLoading(false),
      });
      handler.open();
    } catch {
      setLoading(false);
      setError("No se pudo iniciar la conexión con Plaid.");
    }
  };

  // ── IOL flow ────────────────────────────────────────────────────────────────

  const handleIOLConnect = async () => {
    if (!iolUser || !iolPass) return;
    setError("");
    setLoading(true);
    try {
      await brokerageApi.connectIOL(iolUser, iolPass);
      setScreen("syncing");
      setSyncMsg("Obteniendo posiciones de IOL...");
      const holdingsRes = await brokerageApi.getIOLHoldings();
      const positions: BrokerPosition[] = holdingsRes.data?.positions ?? [];
      await loadConnections();
      onPositionsImported(positions);
      setSyncMsg(`✓ ${positions.length} posiciones importadas de Invertir Online`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Error al conectar con IOL. Verifica tus credenciales.");
      setScreen("home");
    } finally {
      setLoading(false);
      setIolPass("");
    }
  };

  // ── Sync all ────────────────────────────────────────────────────────────────

  const handleSyncAll = async () => {
    setError("");
    setScreen("syncing");
    setSyncMsg("Sincronizando todos los brokers...");
    try {
      const res = await brokerageApi.syncAll();
      const positions: BrokerPosition[] = res.data?.positions ?? [];
      onPositionsImported(positions);
      setSyncMsg(`✓ ${positions.length} posiciones sincronizadas`);
      await loadConnections();
    } catch {
      setSyncMsg("");
      setError("Error al sincronizar. Intenta de nuevo.");
      setScreen("home");
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await brokerageApi.deleteConnection(id);
      await loadConnections();
    } catch {}
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5" style={{ color: "var(--accent)" }} />
            <span className="font-bold text-base" style={{ color: "var(--text)" }}>
              Conectar Broker
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70 transition-opacity">
            <X className="w-5 h-5" style={{ color: "var(--muted)" }} />
          </button>
        </div>

        <div className="p-5">
          {/* Syncing screen */}
          {screen === "syncing" && (
            <div className="flex flex-col items-center gap-4 py-8">
              {syncMsg.startsWith("✓") ? (
                <CheckCircle className="w-12 h-12" style={{ color: "#22c55e" }} />
              ) : (
                <Loader2 className="w-12 h-12 animate-spin" style={{ color: "var(--accent)" }} />
              )}
              <p className="text-sm text-center font-medium" style={{ color: "var(--text)" }}>
                {syncMsg}
              </p>
              {syncMsg.startsWith("✓") && (
                <button
                  onClick={onClose}
                  className="px-6 py-2 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  Listo
                </button>
              )}
            </div>
          )}

          {/* IOL form */}
          {screen === "iol-form" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">🇦🇷</span>
                <div>
                  <p className="font-bold text-sm" style={{ color: "var(--text)" }}>Invertir Online</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Tus credenciales se usan para obtener el token — nunca se almacenan
                  </p>
                </div>
              </div>
              <input
                type="text"
                placeholder="Usuario IOL"
                value={iolUser}
                onChange={(e) => setIolUser(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <input
                type="password"
                placeholder="Contraseña IOL"
                value={iolPass}
                onChange={(e) => setIolPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIOLConnect()}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              {error && (
                <div className="flex items-center gap-2 text-xs p-3 rounded-xl" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => { setScreen("home"); setError(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
                  style={{ background: "var(--raised)", color: "var(--muted)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleIOLConnect}
                  disabled={loading || !iolUser || !iolPass}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Conectar"}
                </button>
              </div>
            </div>
          )}

          {/* Home screen */}
          {screen === "home" && (
            <>
              {error && (
                <div className="flex items-center gap-2 text-xs p-3 rounded-xl mb-4" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* Connected brokers */}
              {connections.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Conectados
                  </p>
                  <div className="flex flex-col gap-2">
                    {connections.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" style={{ color: "#22c55e" }} />
                          <div>
                            <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{c.institution_name}</p>
                            {c.last_sync_at && (
                              <p className="text-[10px]" style={{ color: "var(--dim)" }}>
                                Última sync: {new Date(c.last_sync_at).toLocaleDateString("es")}
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDisconnect(c.id)}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleSyncAll}
                    className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
                    style={{ background: "var(--raised)", color: "var(--accent)", border: "1px solid var(--accent)" }}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Sincronizar todo
                  </button>
                </div>
              )}

              {/* Broker list */}
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {connections.length > 0 ? "Agregar broker" : "Selecciona tu broker"}
              </p>
              <div className="flex flex-col gap-2">
                {BROKERS.map((broker) => {
                  const isConnected = connections.some(
                    (c) => c.institution_name === broker.name || (broker.id === "iol" && c.provider === "iol")
                  );
                  return (
                    <button
                      key={broker.id}
                      onClick={() => {
                        setError("");
                        if (broker.provider === "iol") {
                          setScreen("iol-form");
                        } else {
                          handlePlaidBroker();
                        }
                      }}
                      disabled={loading || isConnected}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-50"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
                    >
                      <span className="text-2xl">{broker.logo}</span>
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{broker.name}</p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>{broker.desc}</p>
                      </div>
                      {isConnected ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
                      ) : loading && broker.provider === "plaid" ? (
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" style={{ color: "var(--accent)" }} />
                      ) : (
                        <span className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Conectar →</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-center mt-4" style={{ color: "var(--dim)" }}>
                Solo lectura — Nuvos AI nunca puede ejecutar operaciones en tu cuenta
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
