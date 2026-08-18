"use client";

import { useState, useEffect } from "react";
import { Square, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { explain as explainApi } from "@/lib/api";
import { useProfileStore, useSubscriptionStore } from "@/lib/store";
import { getMentorInfo } from "@/lib/mentorData";
import { unlockAudioPlayback, getUnlockedAudioElement } from "@/lib/audioUnlock";
import PaywallModal from "@/components/PaywallModal";

// Re-tapping the button seconds later with an unchanged context (e.g. price
// hasn't moved) would otherwise re-charge Haiku + TTS for an identical
// answer — cache the last response per screen+context+lang for a couple of
// minutes so those repeat taps are instant and free.
const EXPLAIN_CACHE_TTL_MS = 2 * 60 * 1000;

function hashContext(context: Record<string, unknown>): string {
  const s = JSON.stringify(context);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface CachedExplanation { text: string; audio: string | null; ts: number }

function readExplainCache(key: string): CachedExplanation | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CachedExplanation = JSON.parse(raw);
    if (Date.now() - entry.ts > EXPLAIN_CACHE_TTL_MS) return null;
    return entry;
  } catch { return null; }
}

function writeExplainCache(key: string, text: string, audio: string | null) {
  try { localStorage.setItem(key, JSON.stringify({ text, audio, ts: Date.now() } as CachedExplanation)); } catch { /* ignore */ }
}

// "Explícame esto" — the same mentor that narrates Arthur voice calls,
// but on-demand per screen instead of an always-on ambient avatar. Each
// screen just passes its own already-computed context; no new data fetch.
export default function ExplainButton({
  screen,
  context,
  className = "",
}: {
  screen: string;
  context: Record<string, unknown>;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const { profile } = useProfileStore();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;
  const mentor = getMentorInfo(profile?.mentor);

  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [text, setText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  // Was in-memory only (useState(false)) — dismissing just collapsed the
  // button to a small re-openable icon that came right back full-size on
  // the next page load, which from the user's side looked exactly like the
  // X doing nothing at all (Diego: "le he dado clic a la X mil veces...
  // pero sigue apareciendo"). Persisted per screen now, and null (not yet
  // loaded) renders nothing so there's no flash of the full button before
  // the stored value resolves.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const dismissKey = `nuvos_explain_dismissed:${screen}`;

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissKey]);

  const stop = () => {
    getUnlockedAudioElement().pause();
    setState("idle");
  };

  const handleDismiss = () => {
    if (state === "playing") stop();
    setDismissed(true);
    try { localStorage.setItem(dismissKey, "1"); } catch { /* ignore */ }
  };

  const handleClick = async () => {
    // Unlock synchronously inside the click handler (before any await) —
    // otherwise iOS Safari blocks the later programmatic .play() call.
    unlockAudioPlayback();

    if (!isPremium) { setPaywallOpen(true); return; }
    if (state === "playing") { stop(); return; }

    const cacheKey = `nuvos_explain:${screen}:${i18n.language}:${hashContext(context)}`;
    setErrorMsg(null);
    const playAudio = async (b64: string) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = getUnlockedAudioElement();
      audio.pause();
      audio.src = url;
      audio.onended = () => setState("idle");
      audio.onerror = () => setState("idle");
      setState("playing");
      await audio.play().catch(() => setState("idle"));
    };

    const cached = readExplainCache(cacheKey);
    if (cached) {
      setText(cached.text);
      if (cached.audio) { await playAudio(cached.audio); } else { setState("idle"); }
      return;
    }

    setState("loading");
    setText(null);
    try {
      const res = await explainApi.explain(screen, context, i18n.language);
      const resultText = res.data?.text || "";
      setText(resultText || null);
      if (resultText) writeExplainCache(cacheKey, resultText, res.data?.audio || null);
      if (!res.data?.audio) { setState("idle"); return; }
      await playAudio(res.data.audio);
    } catch {
      // Was a silent revert to idle with zero feedback — a Premium user
      // tapping this and getting nothing back couldn't tell "I tapped
      // wrong" from "the paid feature just failed" (same fix already
      // shipped on mobile's ExplainButton — this brings web to parity).
      setState("idle");
      setErrorMsg(t("explainButton.error"));
      setTimeout(() => setErrorMsg((cur) => (cur === null ? cur : null)), 4000);
    }
  };

  // dismissed === null: still reading the persisted value — render nothing
  // rather than flash the full button and then hide it a beat later.
  // dismissed === true: the user closed it on this screen before — gone
  // for good, not just collapsed to a re-openable icon.
  if (dismissed !== false) return null;

  return (
    <>
      <div className={`fixed bottom-6 right-6 z-30 ${className}`}>
        <div className="relative">
          <button
            onClick={handleClick}
            className="flex items-center gap-1.5 pl-3 pr-8 py-2 rounded-full text-xs font-bold shadow-lg transition-opacity hover:opacity-80"
            style={{ background: "var(--accent-l)", color: "#000" }}
          >
            {state === "loading" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : state === "playing" ? (
              <Square className="w-3 h-3" />
            ) : (
              <span>{mentor?.emoji ?? "🎙️"}</span>
            )}
            {state === "loading" ? t("explainButton.loading") : state === "playing" ? t("explainButton.stop") : t("explainButton.cta")}
          </button>

          <button
            onClick={handleDismiss}
            aria-label={t("explainButton.dismiss") ?? undefined}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center shadow"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            <X className="w-3 h-3" />
          </button>

          {(errorMsg || (text && state !== "idle")) && (
            <div
              className="absolute z-20 bottom-full right-0 mb-2 w-64 rounded-xl p-3 text-xs leading-relaxed shadow-lg"
              style={{ background: "var(--card)", border: `1px solid ${errorMsg ? "#ef4444" : "var(--border)"}`, color: errorMsg ? "#ef4444" : "var(--sub)" }}
            >
              {errorMsg || text}
            </div>
          )}
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explainButton.paywallReason")} />
    </>
  );
}
