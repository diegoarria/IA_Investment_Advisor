"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { brokerageApi } from "@/lib/api";

// Plaid OAuth return page (Schwab, Robinhood… in production): the broker
// sends the user back here; we resume Plaid Link with the same link token
// (saved by BrokerConnectModal) and finish the connection. Arthur then
// offers to register the positions (brokerage.py exchange → reconcile).
type PlaidWindow = Window & {
  Plaid?: { create: (cfg: Record<string, unknown>) => { open: () => void } };
};

export default function PlaidOAuthPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Terminando la conexión con tu broker…");

  useEffect(() => {
    let token: string | null = null;
    try { token = localStorage.getItem("nuvos_plaid_link_token"); } catch {}
    if (!token) { router.replace("/portfolio"); return; }
    const start = () => {
      const w = window as PlaidWindow;
      if (!w.Plaid) return;
      const handler = w.Plaid.create({
        token,
        receivedRedirectUri: window.location.href,
        onSuccess: async (public_token: string, metadata: { institution: { institution_id: string; name: string } }) => {
          setMsg("Conectado ✓ Trayendo tus posiciones…");
          try {
            await brokerageApi.exchangePlaidToken(public_token, metadata.institution.institution_id, metadata.institution.name);
          } catch {}
          try { localStorage.removeItem("nuvos_plaid_link_token"); } catch {}
          router.replace("/chat");
        },
        onExit: () => router.replace("/portfolio"),
      });
      handler.open();
    };
    if ((window as PlaidWindow).Plaid) { start(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.onload = start;
    document.head.appendChild(script);
  }, [router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg)" }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
      <p className="text-sm font-semibold" style={{ color: "var(--sub)" }}>{msg}</p>
    </main>
  );
}
