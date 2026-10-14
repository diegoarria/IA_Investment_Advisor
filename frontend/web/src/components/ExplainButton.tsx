"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Square, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { explain as explainApi } from "@/lib/api";
import { useProfileStore, useSubscriptionStore, hasPremiumAccess } from "@/lib/store";
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
  const isPremium = hasPremiumAccess(sub);
  const mentor = getMentorInfo(profile?.mentor);

  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [text, setText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  // Two earlier attempts at this both read as "broken" from the user's
  // side: in-memory-only dismiss came right back full-size on every page
  // load (Diego: "le he dado clic a la X mil veces... pero sigue
  // apareciendo"); a 7-day localStorage dismiss fixed that but rendered
  // `null` while suppressed — zero visual trace, indistinguishable from
  // the button being gone/broken (Diego, 2026-09-22, re: Nuvos Radar:
  // "necesito que los hagas funcionar siempre"). Now dismissing never
  // fully hides it: it collapses to a small re-openable icon (persisted
  // per screen so it doesn't re-nag full-size on reload) that's always
  // tappable to bring the full button back — solves both complaints at
  // once instead of trading one for the other.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const dismissKey = `nuvos_explain_dismissed:${screen}`;

  // Karaoke-style follow-along, Diego 2026-10-14: there's no real per-word
  // timing data from either TTS provider here (OpenAI's tts-1 returns none;
  // ElevenLabs only does via a separate /with-timestamps endpoint this app
  // doesn't call) — so this is an honest approximation, not fabricated
  // precision: words advance proportionally to audio.currentTime/duration,
  // which tracks real playback speed closely enough for continuous
  // narration at a fairly even pace (how this voice reads) to feel in sync.
  const [activeWordIdx, setActiveWordIdx] = useState(-1);
  const words = useMemo(() => (text ? text.split(/\s+/).filter(Boolean) : []), [text]);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (activeWordIdx >= 0) {
      activeWordRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeWordIdx]);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissKey]);

  const stop = () => {
    const audio = getUnlockedAudioElement();
    audio.pause();
    audio.ontimeupdate = null;
    setState("idle");
    setActiveWordIdx(-1);
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

    // A single tap on the collapsed icon must both restore the full button
    // AND generate the explanation — restoring without also explaining
    // read as "I tapped it and nothing happened" (Diego, re: Nuvos Radar).
    if (dismissed) {
      setDismissed(false);
      try { localStorage.removeItem(dismissKey); } catch { /* ignore */ }
    }

    if (!isPremium) { setPaywallOpen(true); return; }
    if (state === "playing") { stop(); return; }

    const cacheKey = `nuvos_explain:${screen}:${i18n.language}:${hashContext(context)}`;
    setErrorMsg(null);
    // `fullText` is passed explicitly rather than read from the `text`
    // state — this runs right after a `setText(...)` call in the same
    // handler, and state updates aren't guaranteed to have flushed yet by
    // the time this needs the word count for highlighting.
    const playAudio = async (b64: string, fullText: string) => {
      const wordCount = fullText.split(/\s+/).filter(Boolean).length;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = getUnlockedAudioElement();
      audio.pause();
      audio.src = url;
      audio.ontimeupdate = () => {
        if (!wordCount || !audio.duration || !isFinite(audio.duration)) return;
        setActiveWordIdx(Math.min(wordCount - 1, Math.floor((audio.currentTime / audio.duration) * wordCount)));
      };
      const finish = () => { setState("idle"); setActiveWordIdx(-1); audio.ontimeupdate = null; };
      audio.onended = finish;
      audio.onerror = finish;
      setState("playing");
      setActiveWordIdx(0);
      await audio.play().catch(finish);
    };

    const cached = readExplainCache(cacheKey);
    if (cached) {
      setText(cached.text);
      if (cached.audio) { await playAudio(cached.audio, cached.text); } else { setState("idle"); }
      return;
    }

    setState("loading");
    setText(null);
    setActiveWordIdx(-1);
    try {
      const res = await explainApi.explain(screen, context, i18n.language);
      const resultText = res.data?.text || "";
      setText(resultText || null);
      if (resultText) writeExplainCache(cacheKey, resultText, res.data?.audio || null);
      if (!res.data?.audio) { setState("idle"); return; }
      await playAudio(res.data.audio, resultText);
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
  // rather than flash the full button and then collapse it a beat later.
  if (dismissed === null) return null;

  // dismissed === true: collapsed to a small icon, never fully gone — one
  // tap both restores the full button and generates the explanation.
  if (dismissed) {
    return (
      <div className={`fixed bottom-6 right-6 z-30 ${className}`}>
        <button
          onClick={handleClick}
          aria-label={t("explainButton.cta") ?? undefined}
          className="group relative w-9 h-9 rounded-full flex items-center justify-center shadow-[0_6px_20px_rgba(0,0,0,0.35)] transition-transform hover:scale-105 active:scale-95"
          style={{ background: "linear-gradient(145deg, var(--card), var(--raised))", border: "1px solid var(--border)" }}
        >
          <span
            className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-40 transition-opacity"
            style={{ background: "radial-gradient(circle, var(--accent-l), transparent 70%)" }}
          />
          <span className="relative text-sm">{mentor?.emoji ?? "🎙️"}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={`fixed bottom-6 right-6 z-30 ${className}`}>
        <div className="relative">
          {/* Soft ambient glow behind the pill — same footprint as before,
              just a more premium base layer instead of a flat fill. */}
          <div
            className="absolute -inset-1 rounded-full blur-md opacity-60 pointer-events-none"
            style={{ background: "linear-gradient(135deg, var(--accent-l), #00897b)" }}
          />
          <button
            onClick={handleClick}
            className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 rounded-full text-xs font-bold shadow-[0_4px_16px_rgba(0,0,0,0.25)] transition-transform hover:scale-[1.03] active:scale-95"
            style={{ background: "linear-gradient(135deg, var(--accent-l), #00c389)", color: "#04120c" }}
          >
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full shrink-0"
              style={{ background: "rgba(0,0,0,0.12)" }}
            >
              {state === "loading" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : state === "playing" ? (
                <Square className="w-2.5 h-2.5" />
              ) : (
                <span className="text-[11px] leading-none">{mentor?.emoji ?? "🎙️"}</span>
              )}
            </span>
            {state === "loading" ? t("explainButton.loading") : state === "playing" ? t("explainButton.stop") : t("explainButton.cta")}
            {state === "playing" && (
              <span className="flex items-center gap-[2px] ml-0.5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-[2.5px] rounded-full bg-black/60 animate-pulse"
                        style={{ height: 6 + (i % 2) * 4, animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            )}
          </button>

          <button
            onClick={handleDismiss}
            aria-label={t("explainButton.dismiss") ?? undefined}
            className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full flex items-center justify-center shadow-md transition-transform hover:scale-110"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            <X className="w-3 h-3" />
          </button>

          {/* Was gated on `state !== "idle"` — playAudio() reverts state to
              "idle" the instant playback ends OR fails (onerror/.catch), so
              a blocked/failed audio load hid the already-generated text at
              the same moment, with nothing on screen to show for the tap at
              all. Text now stays visible on its own once generated, and is
              only cleared when a fresh explanation starts loading.

              Diego, 2026-10-14: this used to be an unbounded-height box
              (`bottom-full` with no max-height) — a long explanation (the
              richer earnings reports especially) could grow past the top of
              the viewport with no way to read the rest. Now a fixed-height
              card with its own scrollable body, capped relative to the
              viewport so it always fits on screen regardless of content
              length or window size. */}
          {(errorMsg || text) && (
            <div
              className="absolute z-20 bottom-full right-0 mb-3 w-72 max-w-[calc(100vw-3rem)] rounded-2xl shadow-[0_12px_32px_rgba(0,0,0,0.45)] overflow-hidden flex flex-col"
              style={{
                background: "var(--card)",
                border: `1px solid ${errorMsg ? "#ef4444" : "var(--border)"}`,
                maxHeight: "min(60vh, 420px)",
              }}
            >
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 shrink-0"
                style={{
                  background: errorMsg ? "rgba(239,68,68,0.08)" : "color-mix(in srgb, var(--accent-l) 10%, transparent)",
                  borderBottom: `1px solid ${errorMsg ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
                }}
              >
                <span
                  className="flex items-center justify-center w-6 h-6 rounded-full text-[11px] shrink-0"
                  style={{ background: errorMsg ? "rgba(239,68,68,0.15)" : "var(--raised)" }}
                >
                  {errorMsg ? "⚠️" : mentor?.emoji ?? "🎙️"}
                </span>
                <span className="text-[11px] font-black uppercase tracking-wide truncate" style={{ color: errorMsg ? "#ef4444" : "var(--text)" }}>
                  {errorMsg ? t("explainButton.error") : mentor?.name || t("explainButton.cta")}
                </span>
              </div>
              <div className="overflow-y-auto scrollbar-thin px-3.5 py-3 text-xs leading-relaxed"
                   style={{ color: errorMsg ? "#ef4444" : "var(--sub)" }}>
                {errorMsg ? errorMsg : activeWordIdx < 0 ? text : (
                  words.map((w, i) => (
                    <span
                      key={i}
                      ref={i === activeWordIdx ? activeWordRef : undefined}
                      style={
                        i === activeWordIdx
                          ? { background: "var(--accent-l)", color: "#04120c", borderRadius: 4, padding: "0 3px", fontWeight: 700 }
                          : i < activeWordIdx
                          ? { color: "var(--text)" }
                          : { opacity: 0.45 }
                      }
                    >
                      {w}{" "}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("explainButton.paywallReason")} />
    </>
  );
}
