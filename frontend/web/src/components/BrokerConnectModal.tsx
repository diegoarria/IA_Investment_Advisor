"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Trash2, RefreshCw, CheckCircle, AlertCircle, Loader2, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { brokerageApi, belvoApi } from "@/lib/api";

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

// Belvo institution names below are Nuvos's best-effort mapping to
// Belvo's real institution codes — CONFIRM against a live GET
// /api/belvo/institutions?category=banking response before shipping to
// production; if a name doesn't match, the widget's own institution
// picker (which lists Belvo's real supported institutions) is the
// source of truth and this mapping should be updated to match it. See
// /Users/diegoarria/.claude/plans/cosmic-munching-crown.md, section 6.
function getBrokers(t: TFunction) {
  return [
    { id: "ibkr",      name: "Interactive Brokers", domain: "interactivebrokers.com", color: "#e8000d", fallback: "IB",  provider: "plaid", desc: t("brokerConnectModal.brokers.ibkr") },
    { id: "schwab",    name: "Charles Schwab",       domain: "schwab.com",             color: "#00a2e0", fallback: "CS",  provider: "plaid", desc: t("brokerConnectModal.brokers.schwab") },
    { id: "robinhood", name: "Robinhood",            domain: "robinhood.com",          color: "#00c805", fallback: "RH",  provider: "plaid", desc: t("brokerConnectModal.brokers.robinhood") },
    { id: "iol",       name: "Invertir Online",      domain: "invertironline.com",     color: "#003087", fallback: "IOL", provider: "iol",   desc: t("brokerConnectModal.brokers.iol") },
    // Banking (Belvo Phase 1 — real balance sync, live today).
    { id: "bbva-mx",   name: "BBVA México",          domain: "bbva.mx",                color: "#004481", fallback: "BBVA", provider: "belvo", belvoInstitution: "bbva_mx_retail",     desc: t("brokerConnectModal.brokers.bbvaMx") },
    { id: "banorte",   name: "Banorte",              domain: "banorte.com",            color: "#e2001a", fallback: "BNT",  provider: "belvo", belvoInstitution: "banorte_mx_retail",  desc: t("brokerConnectModal.brokers.banorte") },
    // Brokerage (Belvo Phase 2 — link connects today, position sync lands later).
    { id: "gbm",       name: "GBM",                  domain: "gbm.com.mx",             color: "#0033a0", fallback: "GBM", provider: "belvo", belvoInstitution: "gbm_mx_retail",      desc: t("brokerConnectModal.brokers.gbm") },
    { id: "actinver",  name: "Actinver",             domain: "actinver.com",           color: "#c8102e", fallback: "ACT", provider: "belvo", belvoInstitution: "actinver_mx_retail", desc: t("brokerConnectModal.brokers.actinver") },
  ];
}

function BrokerLogoWeb({ domain, fallback, color }: { domain: string; fallback: string; color: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: color }}>
        <span className="text-white font-black text-[10px]">{fallback}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={fallback}
      onError={() => setErr(true)}
      className="w-9 h-9 rounded-xl object-contain flex-shrink-0"
      style={{ background: "white", padding: 2 }}
    />
  );
}

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (public_token: string, metadata: { institution: { institution_id: string; name: string } }) => void;
        onExit: () => void;
      }) => { open: () => void };
    };
    // Belvo's hosted Connect Widget global — confirm the exact global
    // name/shape against Belvo's current widget docs before production
    // use (implemented here per Belvo's documented `belvoSDK.createWidget`
    // convention); credentials the user types go straight into Belvo's
    // iframe, never through this code.
    belvoSDK?: {
      createWidget: (
        accessToken: string,
        config: {
          callback: (link: string, institution: { name: string }) => void;
          onExit?: () => void;
          onEvent?: (eventName: string) => void;
          locale?: string;
          country_codes?: string[];
        },
      ) => { build: () => void };
    };
  }
}

export default function BrokerConnectModal({ onClose, onPositionsImported }: Props) {
  const { t } = useTranslation();
  const BROKERS = getBrokers(t);
  const [screen, setScreen] = useState<Screen>("home");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [iolUser, setIolUser] = useState("");
  const [iolPass, setIolPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [error, setError] = useState("");
  const [plaidReady, setPlaidReady] = useState(false);
  const [belvoReady, setBelvoReady] = useState(false);

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

  // Load Belvo Connect Widget script
  useEffect(() => {
    if (document.querySelector('script[src*="belvo"]')) {
      setBelvoReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.belvo.io/belvo-widget-1-stable.js";
    script.onload = () => setBelvoReady(true);
    document.head.appendChild(script);
  }, []);

  const loadConnections = useCallback(async () => {
    try {
      const [brokerageRes, belvoRes] = await Promise.allSettled([
        brokerageApi.listConnections(),
        belvoApi.listConnections(),
      ]);
      const brokerageConns: Connection[] = brokerageRes.status === "fulfilled" ? (brokerageRes.value.data?.connections ?? []) : [];
      const belvoConns: Connection[] = belvoRes.status === "fulfilled"
        ? (belvoRes.value.data?.connections ?? []).map((c: { id: string; institution_name: string; last_sync_at: string | null }) => ({
            id: c.id,
            provider: "belvo",
            institution_name: c.institution_name,
            last_sync_at: c.last_sync_at,
          }))
        : [];
      setConnections([...brokerageConns, ...belvoConns]);
    } catch {}
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // ── Plaid flow ──────────────────────────────────────────────────────────────

  const handlePlaidBroker = async () => {
    setError("");
    if (!plaidReady || !window.Plaid) {
      setError(t("brokerConnectModal.errors.plaidNotReady"));
      return;
    }
    setLoading(true);
    try {
      const res = await brokerageApi.createLinkToken();
      const linkToken = res.data?.link_token;
      if (!linkToken) throw new Error(t("brokerConnectModal.errors.noLinkToken"));
      setLoading(false);

      const handler = window.Plaid.create({
        token: linkToken,
        onSuccess: async (public_token, metadata) => {
          setScreen("syncing");
          setSyncMsg(t("brokerConnectModal.status.connectingBroker"));
          try {
            await brokerageApi.exchangePlaidToken(
              public_token,
              metadata.institution.institution_id,
              metadata.institution.name,
            );
            setSyncMsg(t("brokerConnectModal.status.fetchingPositions"));
            const holdingsRes = await brokerageApi.getPlaidHoldings();
            const positions: BrokerPosition[] = holdingsRes.data?.positions ?? [];
            await loadConnections();
            onPositionsImported(positions);
            setSyncMsg(`✓ ${t("brokerConnectModal.status.positionsImportedFrom", { count: positions.length, institution: metadata.institution.name })}`);
          } catch {
            setSyncMsg("");
            setError(t("brokerConnectModal.errors.fetchPositionsFailed"));
            setScreen("home");
          }
        },
        onExit: () => setLoading(false),
      });
      handler.open();
    } catch {
      setLoading(false);
      setError(t("brokerConnectModal.errors.plaidStartFailed"));
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
      setSyncMsg(t("brokerConnectModal.status.fetchingIolPositions"));
      const holdingsRes = await brokerageApi.getIOLHoldings();
      const positions: BrokerPosition[] = holdingsRes.data?.positions ?? [];
      await loadConnections();
      onPositionsImported(positions);
      setSyncMsg(`✓ ${t("brokerConnectModal.status.positionsImportedIol", { count: positions.length })}`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? t("brokerConnectModal.errors.iolConnectFailed"));
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
    setSyncMsg(t("brokerConnectModal.status.syncingAll"));
    try {
      const res = await brokerageApi.syncAll();
      const positions: BrokerPosition[] = res.data?.positions ?? [];
      onPositionsImported(positions);
      setSyncMsg(`✓ ${t("brokerConnectModal.status.positionsSynced", { count: positions.length })}`);
      await loadConnections();
    } catch {
      setSyncMsg("");
      setError(t("brokerConnectModal.errors.syncFailed"));
      setScreen("home");
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      const conn = connections.find((c) => c.id === id);
      if (conn?.provider === "belvo") {
        await belvoApi.deleteConnection(id);
      } else {
        await brokerageApi.deleteConnection(id);
      }
      await loadConnections();
    } catch {
      // Used to give zero feedback on failure — the connection stays live
      // server-side while the modal shows no error at all.
      setError(t("brokerConnectModal.errors.disconnectFailed"));
    }
  };

  // ── Belvo flow (banking, live; brokerage links today but position sync
  // is Phase 2 — see cosmic-munching-crown.md) ────────────────────────────────

  const handleBelvoConnect = async (institutionName: string) => {
    setError("");
    if (!belvoReady || !window.belvoSDK) {
      setError(t("brokerConnectModal.errors.belvoNotReady"));
      return;
    }
    setLoading(true);
    try {
      const res = await belvoApi.createWidgetToken();
      const accessToken = res.data?.access;
      if (!accessToken) throw new Error(t("brokerConnectModal.errors.noLinkToken"));
      setLoading(false);

      // Sandbox's fixture institutions are all non-MX, so restricting the
      // widget's own picker to country_codes=["MX"] would always show it
      // empty there — only apply that filter in production.
      const widgetConfig: Parameters<NonNullable<Window["belvoSDK"]>["createWidget"]>[1] = {
        locale: "es",
        ...(res.data?.env === "production" ? { country_codes: ["MX"] } : {}),
        callback: async (link, institution) => {
          setScreen("syncing");
          setSyncMsg(t("brokerConnectModal.status.connectingBroker"));
          try {
            const regRes = await belvoApi.registerLink(link, institution?.name ?? institutionName);
            await loadConnections();
            if (regRes.data?.category === "investment") {
              setSyncMsg(`✓ ${t("brokerConnectModal.status.belvoInvestmentLinked", { institution: institution?.name ?? institutionName })}`);
            } else {
              setSyncMsg(`✓ ${t("brokerConnectModal.status.belvoBankingLinked", { institution: institution?.name ?? institutionName })}`);
            }
          } catch (e: unknown) {
            setSyncMsg("");
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            setError(msg ?? t("brokerConnectModal.errors.belvoConnectFailed"));
            setScreen("home");
          }
        },
        onExit: () => setLoading(false),
      };
      const widget = window.belvoSDK.createWidget(accessToken, widgetConfig);
      widget.build();
    } catch (e: unknown) {
      setLoading(false);
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? t("brokerConnectModal.errors.belvoConnectFailed"));
    }
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
              {t("brokerConnectModal.title")}
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
                  {t("brokerConnectModal.done")}
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
                    {t("brokerConnectModal.iolCredentialsNote")}
                  </p>
                </div>
              </div>
              <input
                type="text"
                placeholder={t("brokerConnectModal.iolUsernamePlaceholder")}
                value={iolUser}
                onChange={(e) => setIolUser(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <input
                type="password"
                placeholder={t("brokerConnectModal.iolPasswordPlaceholder")}
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
                  {t("brokerConnectModal.cancel")}
                </button>
                <button
                  onClick={handleIOLConnect}
                  disabled={loading || !iolUser || !iolPass}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "#fff" }}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t("brokerConnectModal.connect")}
                </button>
              </div>
            </div>
          )}

          {/* Home screen */}
          {screen === "home" && (
            <>
              {error && (
                <div
                  className="flex items-center gap-2 text-xs p-3 rounded-xl mb-4"
                  style={error.startsWith("🚀")
                    ? { background: "rgba(99,102,241,0.1)", color: "#818cf8" }
                    : { background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
                >
                  {error.startsWith("🚀") ? <span>🚀</span> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
                  {error.startsWith("🚀") ? error.slice(2).trim() : error}
                </div>
              )}

              {/* Connected brokers */}
              {connections.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    {t("brokerConnectModal.connected")}
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
                                {t("brokerConnectModal.lastSync")}: {new Date(c.last_sync_at).toLocaleDateString("es")}
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
                    {t("brokerConnectModal.syncAll")}
                  </button>
                </div>
              )}

              {/* Broker list */}
              <p className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {connections.length > 0 ? t("brokerConnectModal.addBroker") : t("brokerConnectModal.selectBroker")}
              </p>
              <div className="flex flex-col gap-2">
                {BROKERS.map((broker) => {
                  const isConnected = connections.some(
                    (c) => c.institution_name === broker.name || (broker.id === "iol" && c.provider === "iol")
                  );
                  const isBelvo = broker.provider === "belvo";
                  return (
                    <button
                      key={broker.id}
                      onClick={() =>
                        isBelvo
                          ? handleBelvoConnect(broker.name)
                          : setError(`🚀 ${t("brokerConnectModal.comingSoonMessage", { broker: broker.name })}`)
                      }
                      disabled={isConnected || (isBelvo && loading)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all hover:scale-[1.01] disabled:opacity-50"
                      style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
                    >
                      <BrokerLogoWeb domain={broker.domain} fallback={broker.fallback} color={broker.color} />
                      <div className="flex-1">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{broker.name}</p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>{broker.desc}</p>
                      </div>
                      {isConnected ? (
                        <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
                      ) : isBelvo ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                              style={{ color: "var(--accent-l)", borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.08)", fontSize: 10 }}>
                          {t("brokerConnectModal.connect")}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                              style={{ color: "var(--accent-l)", borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.08)", fontSize: 10 }}>
                          {t("brokerConnectModal.comingSoonBadge")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-center mt-4" style={{ color: "var(--dim)" }}>
                {t("brokerConnectModal.readOnlyNote")}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
