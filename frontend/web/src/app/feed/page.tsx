"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Search, X } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import VideoCard from "@/components/VideoCard";
import { feedApi } from "@/lib/api";

interface Clip {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  speaker: string;
  tags: string[];
  translated_caption: string;
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

export default function FeedPage() {
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
  const [sort, setSort]             = useState<"recent" | "trending">("recent");

  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs     = useRef<(HTMLDivElement | null)[]>([]);

  const loadClips = useCallback(async (reset = false) => {
    const cursor = reset ? 0 : (nextCursor ?? 0);
    if (!reset && nextCursor === null) return;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const res = await feedApi.getClips({ cursor, speaker: speaker ?? undefined, tag: tag ?? undefined, sort });
      const newClips: Clip[] = res.data.clips || [];
      setClips((prev) => reset ? newClips : [...prev, ...newClips]);
      setNextCursor(res.data.next_cursor ?? null);
      if (reset) setActiveIndex(0);
    } catch {
      // network error — keep existing clips
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [speaker, tag, sort, nextCursor]);

  useEffect(() => { loadClips(true); }, [speaker, tag, sort]); // eslint-disable-line

  // IntersectionObserver: detect which card is active
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = itemRefs.current.findIndex((el) => el === entry.target);
            if (idx !== -1) setActiveIndex(idx);
          }
        });
      },
      { root: containerRef.current, threshold: 0.7 },
    );

    itemRefs.current.forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [clips]);

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
    setSpeaker(newSpeaker);
    setTag(newTag);
    setFilterOpen(false);
  };

  const clearFilters = () => { setSpeaker(null); setTag(null); };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#000" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Feed container — snap scroll */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-scroll"
        style={{
          scrollSnapType: "y mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}>

        {/* Filter bar (sticky top) */}
        <div className="sticky top-0 z-20 flex items-center gap-2 px-3 py-2"
             style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
          <button onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-1.5 rounded-full"
                  style={{ background: "rgba(255,255,255,0.1)" }}>
            <span className="text-white text-xs">☰</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: "none" }}>
            <button
              onClick={() => setSort(sort === "recent" ? "trending" : "recent")}
              className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: sort === "trending" ? "var(--accent-l, #00d47e)" : "rgba(255,255,255,0.15)",
                color: sort === "trending" ? "#000" : "white",
              }}>
              {sort === "trending" ? "🔥 Trending" : "🕐 Reciente"}
            </button>

            {(speaker || tag) && (
              <button onClick={clearFilters}
                      className="shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold"
                      style={{ background: "rgba(255,100,100,0.3)", color: "white" }}>
                <X className="w-3 h-3" /> {speaker || tag}
              </button>
            )}

            <button onClick={() => setFilterOpen(true)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                    style={{ background: "rgba(255,255,255,0.15)", color: "white" }}>
              <Search className="w-3 h-3" /> Filtrar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-screen flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        ) : clips.length === 0 ? (
          <div className="h-screen flex flex-col items-center justify-center gap-3">
            <p className="text-white text-lg font-bold">Sin contenido aún</p>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
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
              <div
                key={clip.id}
                ref={(el) => { itemRefs.current[i] = el; }}
                className="flex items-center justify-center"
                style={{ height: "100svh", scrollSnapAlign: "start", scrollSnapStop: "always" }}>
                <VideoCard
                  clip={clip}
                  isActive={activeIndex === i}
                  isMuted={isMuted}
                  onMuteToggle={() => setIsMuted((m) => !m)}
                  onLikeChange={handleLikeChange}
                  onSaveChange={handleSaveChange}
                />
              </div>
            ))}

            {loadingMore && (
              <div className="flex items-center justify-center py-6"
                   style={{ height: "80px", scrollSnapAlign: "start" }}>
                <Loader2 className="w-6 h-6 animate-spin text-white" />
              </div>
            )}

            {nextCursor === null && clips.length > 0 && (
              <div className="flex items-center justify-center py-6 text-sm"
                   style={{ color: "rgba(255,255,255,0.4)", scrollSnapAlign: "start" }}>
                Has visto todo el contenido disponible
              </div>
            )}
          </>
        )}
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
