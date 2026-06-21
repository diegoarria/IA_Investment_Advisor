"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import React from "react";
import { Loader2, Search, X, Shuffle } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import VideoCard from "@/components/VideoCard";
import { feedApi } from "@/lib/api";

// Isolates each video so a single broken clip can't crash the whole feed
class ClipErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex items-center justify-center"
          style={{ height: "100%", scrollSnapAlign: "start", scrollSnapStop: "always" }}
        >
          <p className="text-sm" style={{ color: "var(--muted)" }}>Video no disponible</p>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Clip {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  speaker: string;
  tags: string[];
  translated_caption: string;
  caption_en?: string;
  duration_sec: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
  pre_audio_url?: string;
  post_audio_url?: string;
  pre_text?: string;
  post_text?: string;
}

const SPEAKERS = [
  "Warren Buffett", "Charlie Munger", "Ray Dalio", "Peter Lynch",
  "Morgan Housel", "Benjamin Graham", "Howard Marks", "Bill Ackman",
  "Michael Burry", "Nassim Taleb",
];

const TAGS = [
  "value investing", "macro", "mindset", "riesgo", "psicología",
  "deuda", "diversificación", "largo plazo", "crisis", "análisis",
];

function FeedPageInner() {
  const searchParams = useSearchParams();
  const [clips, setClips]           = useState<Clip[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMuted, setIsMuted]       = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [speaker, setSpeaker]       = useState<string | null>(null);
  const [tag, setTag]               = useState<string | null>(null);
  const [sort, setSort]             = useState<"recent" | "trending" | "random">("recent");
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning]     = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const seenIdsRef   = useRef<Set<string>>(new Set());

  const loadClips = useCallback(async (reset = false) => {
    const cursor = reset ? 0 : (nextCursor ?? 0);
    if (!reset && nextCursor === null) return;
    reset ? setLoading(true) : setLoadingMore(true);
    // Always clear seen history on a full reset so fresh content is never filtered out
    if (reset) seenIdsRef.current.clear();
    try {
      const res = await feedApi.getClips({ cursor, speaker: speaker ?? undefined, tag: tag ?? undefined, sort });
      let newClips: Clip[] = res.data.clips || [];
      // Deduplicate within session; if all already seen reset and show them anyway
      let unseen = newClips.filter((c) => !seenIdsRef.current.has(c.id));
      if (unseen.length === 0 && newClips.length > 0) {
        seenIdsRef.current.clear();
        unseen = newClips;
      }
      unseen.forEach((c) => seenIdsRef.current.add(c.id));
      setClips((prev) => reset ? unseen : [...prev, ...unseen]);
      setNextCursor(res.data.next_cursor ?? null);
      if (reset) setActiveIndex(0);
    } catch {
      // keep existing clips on network error; don't blank the feed
      if (reset) setClips([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setSpinning(false);
    }
  }, [speaker, tag, sort, nextCursor]); // eslint-disable-line

  useEffect(() => { loadClips(true); }, [speaker, tag, sort, refreshKey]); // eslint-disable-line

  // Deep-link: /feed?clip=<id> — fetch that clip and put it first
  const deepLinkClipId = searchParams.get("clip");
  useEffect(() => {
    if (!deepLinkClipId) return;
    feedApi.getClip(deepLinkClipId).then((res) => {
      const clip: Clip = res.data;
      setClips((prev) => {
        if (prev.some((c) => c.id === clip.id)) return prev;
        return [clip, ...prev];
      });
      setActiveIndex(0);
      containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
    }).catch(() => {});
  }, [deepLinkClipId]); // eslint-disable-line

  const handleShuffle = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
    setSpinning(true);
    setSort("random");
    setRefreshKey((k) => k + 1);
  };

  // Active index from scroll position.
  // Uses scrollend (Safari 17.5+) + debounced scroll fallback to handle Safari's
  // snap animation — the scroll event can fire with intermediate scrollTop values
  // during the snap, so we debounce to always read the final resting position.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const idx = Math.round(container.scrollTop / container.clientHeight);
      setActiveIndex(Math.min(Math.max(0, idx), clips.length - 1));
    };
    let debounceId: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(update, 120);
    };
    container.addEventListener("scrollend", update, { passive: true });
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(debounceId);
      container.removeEventListener("scrollend", update);
      container.removeEventListener("scroll", onScroll);
    };
  }, [clips.length]);

  // Load more when near end
  useEffect(() => {
    if (activeIndex >= clips.length - 3 && nextCursor !== null && !loadingMore) {
      loadClips(false);
    }
  }, [activeIndex, clips.length, nextCursor, loadingMore, loadClips]);

  const handleLikeChange = (id: string, liked: boolean, count: number) => {
    setClips((prev) => prev.map((c) => c.id === id ? { ...c, liked, like_count: count } : c));
  };

  const handleSaveChange = (id: string, saved: boolean) => {
    setClips((prev) => prev.map((c) => c.id === id ? { ...c, saved } : c));
  };

  const applyFilter = (newSpeaker: string | null, newTag: string | null) => {
    seenIdsRef.current.clear();
    setSpeaker(newSpeaker);
    setTag(newTag);
    setFilterOpen(false);
  };

  const clearFilters = () => { seenIdsRef.current.clear(); setSpeaker(null); setTag(null); };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Right side: filter bar (outside scroll container) + scroll container */}
      <div className="flex-1 flex flex-col overflow-hidden relative">

        {/* Filter bar — OUTSIDE the scroll container so it never shifts snap points */}
        <div className="shrink-0 z-20 flex items-center gap-2 px-3 py-2"
             style={{ background: "linear-gradient(to bottom, rgba(var(--bg-rgb), 0.92) 0%, transparent 100%)" }}>
          <button onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-1.5 rounded-full"
                  style={{ background: "var(--raised)" }}>
            <span style={{ color: "var(--text)", fontSize: "12px" }}>☰</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => { setSort(sort === "recent" ? "trending" : "recent"); setRefreshKey((k) => k + 1); }}
              className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: sort === "trending" ? "var(--accent-l)" : "var(--raised)",
                color: sort === "trending" ? "#000" : "var(--text)",
              }}>
              {sort === "trending" ? "🔥 Trending" : "🕐 Reciente"}
            </button>

            <button
              onClick={handleShuffle}
              title="Mostrar videos aleatorios"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all active:scale-95"
              style={{
                background: sort === "random" ? "rgba(139,92,246,0.18)" : "var(--raised)",
                color: sort === "random" ? "#a78bfa" : "var(--text)",
                border: sort === "random" ? "1px solid rgba(139,92,246,0.4)" : "1px solid transparent",
              }}>
              <Shuffle
                className="w-3 h-3"
                style={{ animation: spinning ? "spin 0.5s linear" : "none" }}
              />
              Aleatorio
            </button>

            {(speaker || tag) && (
              <button onClick={clearFilters}
                      className="shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold"
                      style={{ background: "rgba(244,63,94,0.15)", color: "var(--down)" }}>
                <X className="w-3 h-3" /> {speaker || tag}
              </button>
            )}

            <button onClick={() => setFilterOpen(true)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                    style={{ background: "var(--raised)", color: "var(--text)" }}>
              <Search className="w-3 h-3" /> Filtrar
            </button>
          </div>
        </div>

        {/* Scroll container — below filter bar, takes remaining height.
            Cards use height:100% so snap math is exact (no svh offset). */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-scroll"
          style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none" }}>

          {loading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
            </div>
          ) : clips.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <p className="text-lg font-bold" style={{ color: "var(--text)" }}>Sin contenido aún</p>
              <p className="text-sm" style={{ color: "var(--sub)" }}>
                Pronto cargaremos clips educativos de los mejores inversores
              </p>
              {(speaker || tag) && (
                <button onClick={clearFilters}
                        className="px-4 py-2 rounded-xl text-sm font-semibold"
                        style={{ background: "var(--accent-l, #00d47e)", color: "#000" }}>
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <>
              {clips.map((clip, i) => (
                <ClipErrorBoundary key={clip.id}>
                  <div
                    className="flex items-center justify-center"
                    style={{ height: "100%", scrollSnapAlign: "start", scrollSnapStop: "always" }}>
                    <VideoCard
                      clip={clip}
                      isActive={activeIndex === i}
                      isMuted={isMuted}
                      onMuteToggle={() => setIsMuted((m) => !m)}
                      onLikeChange={handleLikeChange}
                      onSaveChange={handleSaveChange}
                    />
                  </div>
                </ClipErrorBoundary>
              ))}

              {loadingMore && (
                <div className="flex items-center justify-center py-6"
                     style={{ height: "80px", scrollSnapAlign: "start" }}>
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent)" }} />
                </div>
              )}

              {nextCursor === null && clips.length > 0 && (
                <div className="flex items-center justify-center py-6 text-sm"
                     style={{ color: "var(--muted)", scrollSnapAlign: "start" }}>
                  Has visto todo el contenido disponible
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filter drawer */}
      {filterOpen && (
        <div className="fixed inset-0 z-50 flex items-end"
             style={{ background: "rgba(0,0,0,0.7)" }}
             onClick={() => setFilterOpen(false)}>
          <div
            className="w-full rounded-t-2xl p-5 space-y-4"
            style={{ background: "var(--card, #1a1a1a)", border: "1px solid var(--border, #333)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold" style={{ color: "var(--text, #fff)" }}>Filtrar contenido</p>
              <button onClick={() => setFilterOpen(false)}>
                <X className="w-5 h-5" style={{ color: "var(--muted, #888)" }} />
              </button>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted, #888)" }}>POR INVERSOR</p>
              <div className="flex flex-wrap gap-2">
                {SPEAKERS.map((s) => (
                  <button key={s}
                          onClick={() => applyFilter(speaker === s ? null : s, null)}
                          className="px-3 py-1 rounded-full text-xs font-medium"
                          style={{
                            background: speaker === s ? "var(--accent-l, #00d47e)" : "var(--raised, #2a2a2a)",
                            color: speaker === s ? "#000" : "var(--sub, #aaa)",
                          }}>
                    {s.split(" ")[1] ?? s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted, #888)" }}>POR TEMA</p>
              <div className="flex flex-wrap gap-2">
                {TAGS.map((t) => (
                  <button key={t}
                          onClick={() => applyFilter(null, tag === t ? null : t)}
                          className="px-3 py-1 rounded-full text-xs font-medium"
                          style={{
                            background: tag === t ? "var(--accent-l, #00d47e)" : "var(--raised, #2a2a2a)",
                            color: tag === t ? "#000" : "var(--sub, #aaa)",
                          }}>
                    #{t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={null}>
      <FeedPageInner />
    </Suspense>
  );
}
