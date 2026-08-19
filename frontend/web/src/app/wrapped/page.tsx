"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import WrappedFlow from "@/components/wrapped/WrappedFlow";
import { WrappedData, WT } from "@/components/wrapped/types";

export default function WrappedPage() {
  const router = useRouter();
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lockedMessage, setLockedMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get("/api/wrapped/annual")
      .then((res) => setData(res.data))
      .catch((err) => {
        const detail = err?.response?.data?.detail;
        if (err?.response?.status === 404 && detail?.code === "wrapped_window_closed") {
          setLockedMessage(detail.message);
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const close = () => router.back();

  return (
    <div style={{ position: "fixed", inset: 0, background: WT.bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      {loading && <Loader2 className="animate-spin" size={28} color={WT.accentL} />}

      {!loading && lockedMessage && (
        <div style={{ maxWidth: 360, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📅</div>
          <h1 style={{ fontWeight: 800, fontSize: 20, color: WT.text, marginBottom: 10 }}>Todavía no está disponible</h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, marginBottom: 24 }}>{lockedMessage}</p>
          <button
            onClick={close}
            style={{ padding: "12px 28px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
          >
            Volver
          </button>
        </div>
      )}

      {!loading && error && (
        <div style={{ maxWidth: 320, textAlign: "center", padding: 32 }}>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub }}>No pudimos cargar tu Wrapped. Intenta de nuevo en unos minutos.</p>
        </div>
      )}

      {!loading && data && <WrappedFlow data={data} onClose={close} />}
    </div>
  );
}
