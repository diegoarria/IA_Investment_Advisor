"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, Calendar, ExternalLink, ArrowRight, Download, Loader2 } from "lucide-react";
import api from "@/lib/api";

// ← Reemplaza con tu link real de Calendly
const CALENDLY_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai";

const OFFER_META = {
  session: {
    emoji: "🎯",
    color: "#00d47e",
    title: "¡Sesión confirmada!",
    subtitle: "Tu pago fue procesado exitosamente.",
    cta: true,
  },
  annual_report: {
    emoji: "📊",
    color: "#8b5cf6",
    title: "¡Reporte solicitado!",
    subtitle: "Tu pago fue procesado exitosamente.",
    cta: false,
  },
  family_plan: {
    emoji: "👫",
    color: "#3b82f6",
    title: "¡Plan Dúo activado!",
    subtitle: "Tu pago fue procesado exitosamente.",
    cta: false,
  },
};

type Offer = keyof typeof OFFER_META;

function UpsellSuccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const offer = (params.get("offer") ?? "session") as Offer;
  const meta = OFFER_META[offer] ?? OFFER_META.session;

  const [visible, setVisible] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    // Fade in
    const t = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await api.get("/api/annual-report/generate", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte-anual-nuvos-${new Date().getFullYear()}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      // silent — user can retry
    }
    setDownloading(false);
  };

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg, #0f1117)",
      padding: "40px 20px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      transition: "opacity 0.4s ease",
      opacity: visible ? 1 : 0,
    }}>
      <div style={{
        width: "100%",
        maxWidth: "420px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
      }}>

        {/* Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: 24,
          background: `${meta.color}18`,
          border: `1.5px solid ${meta.color}35`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 36,
        }}>
          {meta.emoji}
        </div>

        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 900, margin: "0 0 8px" }}>
            {meta.title}
          </h1>
          <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>
            {meta.subtitle}
          </p>
        </div>

        {/* Content card */}
        <div style={{
          width: "100%",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 20,
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          {offer === "session" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Pago de ${params.get("amount") ?? ""} procesado</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Videollamada de 45 minutos con Diego</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Grabación entregada después de la sesión</span>
              </div>

              <div style={{
                marginTop: 4,
                padding: "14px 16px",
                background: `${meta.color}0d`,
                border: `1px solid ${meta.color}25`,
                borderRadius: 14,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Calendar size={15} color={meta.color} />
                  <span style={{ color: meta.color, fontSize: 12, fontWeight: 700 }}>Siguiente paso</span>
                </div>
                <p style={{ color: "#e5e7eb", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  Elige el día y hora que mejor te quede. Recibirás una confirmación por email con el link de la videollamada.
                </p>
              </div>
            </>
          )}

          {offer === "annual_report" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Pago procesado correctamente</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Reporte personalizado con tu historial de madurez</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Certificado digital de Inversor Informado</span>
              </div>

              {/* Download button */}
              <button
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: "none",
                  background: downloading
                    ? "rgba(0,212,126,0.15)"
                    : "linear-gradient(135deg, #00d47ecc, #00d47e)",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 15,
                  cursor: downloading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: downloading ? "none" : "0 4px 20px #00d47e44",
                  transition: "all 0.2s ease",
                }}
              >
                {downloading ? (
                  <>
                    <Loader2 size={17} style={{ animation: "spin 1s linear infinite" }} />
                    Generando tu reporte...
                  </>
                ) : (
                  <>
                    <Download size={17} />
                    Descargar mi Reporte PDF
                  </>
                )}
              </button>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </>
          )}

          {offer === "family_plan" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Plan Dúo activado en tu cuenta</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle size={18} color="#22c55e" />
                <span style={{ color: "#d1fae5", fontSize: 14 }}>Dos cuentas Premium independientes</span>
              </div>
              <div style={{
                marginTop: 4,
                padding: "14px 16px",
                background: `${meta.color}0d`,
                border: `1px solid ${meta.color}25`,
                borderRadius: 14,
              }}>
                <p style={{ color: "#e5e7eb", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  📧 Te contactaremos en las próximas <strong style={{ color: "#fff" }}>24 horas</strong> para configurar la segunda cuenta.
                </p>
              </div>
            </>
          )}
        </div>

        {/* CTA buttons */}
        {offer === "session" && (
          <a
            href={CALENDLY_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 18,
              background: `linear-gradient(135deg, ${meta.color}cc, ${meta.color})`,
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              textAlign: "center",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              boxShadow: `0 4px 24px ${meta.color}44`,
            }}
          >
            <Calendar size={18} />
            Agendar mi sesión en Calendly
            <ExternalLink size={14} style={{ opacity: 0.7 }} />
          </a>
        )}

        <button
          onClick={() => router.replace("/profile")}
          style={{
            background: "transparent",
            border: "none",
            color: "#6b7280",
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 0",
          }}
        >
          Volver a mi perfil <ArrowRight size={13} />
        </button>

      </div>
    </main>
  );
}

export default function UpsellSuccessPage() {
  return (
    <Suspense>
      <UpsellSuccessContent />
    </Suspense>
  );
}
