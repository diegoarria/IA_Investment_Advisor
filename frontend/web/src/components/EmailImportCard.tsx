"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, Copy, Check, ShieldCheck } from "lucide-react";
import { importsApi } from "@/lib/api";

// Importación automática por correo (2026-09-29): the user's private
// forwarding address + the 3 steps to forward their broker's emails.
export default function EmailImportCard() {
  const { t } = useTranslation();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    importsApi.getEmailAlias().then((r) => setAddress(r.data.address)).catch(() => setError(true));
  }, []);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-[20px] border p-5 mb-4" style={{ background: "linear-gradient(135deg, rgba(0,185,109,0.10), var(--card) 60%), var(--card)", borderColor: "rgba(0,185,109,0.3)" }}>
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: "var(--accent)" }}>
          <Mail className="w-5 h-5 text-white" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("emailImport.title")}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{t("emailImport.subtitle")}</p>
        </div>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[1px] mt-4 mb-1.5" style={{ color: "var(--muted)" }}>{t("emailImport.yourAddress")}</p>
      <div className="flex items-center gap-2 rounded-[12px] border px-3 py-2.5" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <span className="flex-1 text-sm font-mono truncate" style={{ color: "var(--text)" }}>
          {address ?? (error ? t("emailImport.error") : t("emailImport.loading"))}
        </span>
        {address && (
          <button onClick={copy} className="shrink-0 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full"
                  style={{ background: "#00D47E", color: "#06120D" }}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? t("emailImport.copied") : t("emailImport.copy")}
          </button>
        )}
      </div>

      <ol className="mt-4 space-y-2.5">
        {[t("emailImport.step1"), t("emailImport.step2"), t("emailImport.step3")].map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[11px] font-extrabold mt-px"
                  style={{ background: "rgba(0,185,109,0.14)", color: "var(--accent-l)" }}>{i + 1}</span>
            <span className="text-[13px] leading-5" style={{ color: "var(--sub)" }}>{step}</span>
          </li>
        ))}
      </ol>
      <a href="https://support.google.com/mail/answer/6579" target="_blank" rel="noopener noreferrer"
         className="inline-block mt-3 text-xs font-bold" style={{ color: "var(--accent-l)" }}>
        {t("emailImport.gmailHelp")} →
      </a>
      <p className="flex items-start gap-1.5 text-[11.5px] mt-3" style={{ color: "var(--muted)" }}>
        <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />{t("emailImport.privacy")}
      </p>
    </div>
  );
}
