"use client";

import { useState } from "react";
import { Square, Loader2 } from "lucide-react";
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

// "Explícame esto" — the same mentor that narrates Mentor IA voice calls,
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
  const [paywallOpen, setPaywallOpen] = useState(false);

  const stop = () => {
    getUnlockedAudioElement().pause();
    setState("idle");
  };

  const handleClick = async () => {
    // Unlock synchronously inside the click handler (before any await) —
    // otherwise iOS Safari blocks the later programmatic .play() call.
    unlockAudioPlayback();

    if (!isPremium) { setPaywallOpen(true); return; }
    if (state === "playing") { stop(); return; }

    const cacheKey = `nuvos_explain:${screen}:${i18n.language}:${hashContext(context)}`;
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
      setState("idle");
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={handleClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-80 ${className}`}
          style={{ background: `${mentor?.color ?? "#00a85e"}18`, color: mentor?.color ?? "var(--accent-l)" }}
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

        {text && state !== "idle" && (
          <div
            className="absolute z-20 top-full right-0 mt-2 w-64 rounded-xl p-3 text-xs leading-relaxed shadow-lg"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--sub)" }}
          >
            {text}
          </div>
        )}
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explainButton.paywallReason")} />
    </>
  );
}
