"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Heart, MessageCircle, Bookmark, Share2, Play, Volume2, VolumeX, ChevronDown, SkipForward, Subtitles } from "lucide-react";
import { feedApi } from "@/lib/api";
import { useProfileStore } from "@/lib/store";
import Hls from "hls.js";

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

interface Comment {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
  user_profiles?: { name: string; avatar_url?: string };
  replies?: Comment[];
}

// Split caption text into ~7-word chunks for time-proportional display
function getCaptionChunks(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 7) {
    chunks.push(words.slice(i, i + 7).join(" "));
  }
  return chunks;
}

const SPEAKER_AVATAR: Record<string, string> = {
  "Warren Buffett":   "🧙",
  "Charlie Munger":   "📚",
  "Ray Dalio":        "🌊",
  "Benjamin Graham":  "📖",
  "Peter Lynch":      "🏃",
  "Morgan Housel":    "✍️",
  "Howard Marks":     "🎯",
  "Seth Klarman":     "🔬",
  "Bill Ackman":      "⚡",
  "Grant Cardone":    "🚀",
  "Robert Kiyosaki":  "🏠",
  "Nassim Taleb":     "🎲",
  "Michael Burry":    "🐻",
};

interface VideoCardProps {
  clip: Clip;
  isActive: boolean;
  isMuted: boolean;
  onMuteToggle: () => void;
  onLikeChange: (id: string, liked: boolean, count: number) => void;
  onSaveChange: (id: string, saved: boolean) => void;
}

export default function VideoCard({
  clip, isActive, isMuted, onMuteToggle, onLikeChange, onSaveChange,
}: VideoCardProps) {
  const myProfile = useProfileStore((s) => s.profile);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const preAudioRef   = useRef<HTMLAudioElement>(null);
  const postAudioRef  = useRef<HTMLAudioElement>(null);
  const scrubBarRef   = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing]       = useState(false);
  const [phase, setPhase]               = useState<"pre"|"video"|"post"|"idle">("idle");
  const [audioRemaining, setAudioRemaining] = useState(0); // seconds left in pre/post audio
  const [playing, setPlaying]           = useState(false);
  const [progress, setProgress]         = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [comments, setComments]         = useState<Comment[]>([]);
  const [commentText, setCommentText]   = useState("");
  const [replyingTo, setReplyingTo]     = useState<{ id: string; name: string } | null>(null);
  const [replyText, setReplyText]       = useState("");
  const [likeCount, setLikeCount]       = useState(clip.like_count);
  const [liked, setLiked]               = useState(clip.liked);
  const [saved, setSaved]               = useState(clip.saved);
  const [loadingLike, setLoadingLike]   = useState(false);
  const [copied, setCopied]             = useState(false);
  const [captionLang, setCaptionLang]   = useState<"off"|"es"|"en">("off");
  const [showCaptionPicker, setShowCaptionPicker] = useState(false);

  // HLS.js setup for .m3u8 streams (Chrome / Firefox)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const url = clip.video_url;
    if (!url) return;

    if (url.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({ startLevel: -1, autoStartLoad: true });
        hls.loadSource(url);
        hls.attachMedia(v);
        return () => hls.destroy();
      }
      // Safari supports HLS natively
    } else {
      v.src = url;
    }
  }, [clip.video_url]);

  // Sequenced playback: pre-audio → video → post-audio
  useEffect(() => {
    const v    = videoRef.current;
    const pre  = preAudioRef.current;
    const post = postAudioRef.current;
    if (!v) return;

    if (!isActive) {
      v.pause(); v.currentTime = 0;
      if (pre)  { pre.pause();  pre.currentTime  = 0; }
      if (post) { post.pause(); post.currentTime = 0; }
      setPhase("idle");
      return;
    }

    if (clip.pre_audio_url && pre) {
      setPhase("pre");
      pre.play().catch(() => { setPhase("video"); v.play().catch(() => {}); });
    } else {
      setPhase("video");
      v.play().catch(() => {});
    }
  }, [isActive, clip.pre_audio_url]);

  // When pre-audio ends → start video
  const handlePreEnded = useCallback(() => {
    setPhase("video");
    videoRef.current?.play().catch(() => {});
  }, []);

  // When video ends → play post-audio if available
  const handleVideoEnded = useCallback(() => {
    const post = postAudioRef.current;
    if (clip.post_audio_url && post) {
      setPhase("post");
      post.play().catch(() => setPhase("idle"));
    } else {
      setPhase("idle");
    }
  }, [clip.post_audio_url]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = isMuted;
  }, [isMuted]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
    // Track view at 15%
    if (v.currentTime / v.duration >= 0.15) {
      feedApi.view(clip.id, Math.round((v.currentTime / v.duration) * 100)).catch(() => {});
    }
  }, [clip.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
  };

  const handleLike = async () => {
    if (loadingLike) return;
    setLoadingLike(true);
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      await feedApi.like(clip.id);
      onLikeChange(clip.id, next, likeCount + (next ? 1 : -1));
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    } finally {
      setLoadingLike(false);
    }
  };

  const handleSave = async () => {
    const next = !saved;
    setSaved(next);
    try {
      await feedApi.save(clip.id);
      onSaveChange(clip.id, next);
    } catch {
      setSaved(!next);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/feed?clip=${clip.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (navigator.share) navigator.share({ title: clip.title, url });
    }
  };

  const loadComments = async () => {
    try {
      const res = await feedApi.getComments(clip.id);
      setComments(res.data.comments || []);
    } catch {}
  };

  const postComment = async (text?: string, parentId?: string) => {
    const body = text ?? commentText;
    if (!body.trim()) return;
    const optimistic: Comment = {
      id: `opt-${Date.now()}`,
      user_id: "",
      text: body.trim(),
      created_at: new Date().toISOString(),
      user_profiles: { name: myProfile?.name || "Tú", avatar_url: myProfile?.avatar_url ?? undefined },
      replies: [],
    };
    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: [...(c.replies || []), optimistic] } : c));
      setReplyText(""); setReplyingTo(null);
    } else {
      setComments((prev) => [...prev, optimistic]);
      setCommentText("");
    }
    try {
      await feedApi.postComment(clip.id, body.trim(), parentId);
      loadComments(); // replace optimistic entry with real server data
    } catch {
      // rollback
      if (parentId) {
        setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: (c.replies || []).filter((r) => r.id !== optimistic.id) } : c));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
      }
    }
  };

  const seekTo = useCallback((clientX: number) => {
    const bar = scrubBarRef.current;
    const v   = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const { left, width } = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - left) / width));
    v.currentTime = pct * v.duration;
    setProgress(pct * 100);
    if (phase !== "video") { setPhase("video"); v.play().catch(() => {}); }
  }, [phase]);

  const handleScrubStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== "video") return;
    setScrubbing(true);
    const x = "touches" in e ? e.touches[0].clientX : e.clientX;
    seekTo(x);
  };

  const handleScrubMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!scrubbing) return;
    const x = "touches" in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
    seekTo(x);
  }, [scrubbing, seekTo]);

  const handleScrubEnd = useCallback(() => setScrubbing(false), []);

  useEffect(() => {
    if (scrubbing) {
      window.addEventListener("mousemove", handleScrubMove);
      window.addEventListener("mouseup",   handleScrubEnd);
      window.addEventListener("touchmove", handleScrubMove);
      window.addEventListener("touchend",  handleScrubEnd);
    }
    return () => {
      window.removeEventListener("mousemove", handleScrubMove);
      window.removeEventListener("mouseup",   handleScrubEnd);
      window.removeEventListener("touchmove", handleScrubMove);
      window.removeEventListener("touchend",  handleScrubEnd);
    };
  }, [scrubbing, handleScrubMove, handleScrubEnd]);

  const openComments = () => {
    setShowComments(true);
    loadComments();
    setTimeout(() => setDrawerOpen(true), 20);
  };

  const closeComments = () => {
    setDrawerOpen(false);
    setTimeout(() => { setShowComments(false); setReplyingTo(null); setReplyText(""); }, 340);
  };

  const avatar = SPEAKER_AVATAR[clip.speaker] ?? "🎓";
  const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  // TikTok-style: portrait frame + actions to the right
  return (
    <div className="flex items-center gap-3" style={{ height: "100svh" }}>
      <style>{`
        @keyframes soundbar {
          from { transform: scaleY(0.3); opacity: 0.5; }
          to   { transform: scaleY(1);   opacity: 1; }
        }
      `}</style>

      {/* Portrait video frame — 9:16 */}
      <div className="relative rounded-xl overflow-hidden shrink-0"
           style={{
             height: "min(100svh, calc(100vw * 9/16))",
             width: "min(calc(100svh * 9/16), 100vw - 80px)",
             maxHeight: "100svh",
             background: "#000",
           }}>

        {/* Hidden pre/post audio elements */}
        {clip.pre_audio_url && (
          <audio ref={preAudioRef} src={clip.pre_audio_url} preload="auto"
                 onEnded={handlePreEnded}
                 onTimeUpdate={(e) => {
                   const a = e.currentTarget;
                   setAudioRemaining(Math.ceil(a.duration - a.currentTime));
                 }}
                 onLoadedMetadata={(e) => setAudioRemaining(Math.ceil(e.currentTarget.duration))} />
        )}
        {clip.post_audio_url && (
          <audio ref={postAudioRef} src={clip.post_audio_url} preload="auto"
                 onEnded={() => setPhase("idle")}
                 onTimeUpdate={(e) => {
                   const a = e.currentTarget;
                   setAudioRemaining(Math.ceil(a.duration - a.currentTime));
                 }}
                 onLoadedMetadata={(e) => setAudioRemaining(Math.ceil(e.currentTarget.duration))} />
        )}

        {/* Video */}
        <video
          ref={videoRef}
          src={clip.video_url.includes(".m3u8") ? undefined : clip.video_url}
          poster={clip.thumbnail_url || undefined}
          playsInline
          preload="metadata"
          muted={isMuted}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={handleVideoEnded}
          onClick={togglePlay}
          className="w-full h-full object-cover cursor-pointer"
        />

        {/* Phase badge: pre / post */}
        {(phase === "pre" || phase === "post") && (
          <>
            {/* Top badge — label + animated bars + progress */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10"
                 style={{ minWidth: 160 }}>
              <div className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-2xl"
                   style={{ background: "rgba(10,10,20,0.72)", backdropFilter: "blur(12px)", border: "1px solid rgba(139,92,246,0.4)" }}>
                {/* Top row: waveform + label + timer */}
                <div className="flex items-center gap-2">
                  {/* Animated sound bars */}
                  <div className="flex items-end gap-[2px]" style={{ height: 14 }}>
                    {[0.4, 0.8, 0.55, 1, 0.65].map((h, i) => (
                      <div key={i}
                           className="rounded-full"
                           style={{
                             width: 2.5,
                             height: `${h * 100}%`,
                             background: "#a78bfa",
                             animation: `soundbar 0.8s ease-in-out ${i * 0.12}s infinite alternate`,
                           }} />
                    ))}
                  </div>
                  <span className="text-xs font-bold tracking-wide" style={{ color: "#e2d9ff" }}>
                    {phase === "pre" ? "Introducción IA" : "Análisis IA"}
                  </span>
                  {audioRemaining > 0 && (
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: "rgba(167,139,250,0.8)" }}>
                      {audioRemaining}s
                    </span>
                  )}
                </div>
                {/* Thin progress bar */}
                {audioRemaining > 0 && (
                  <div className="w-full rounded-full overflow-hidden" style={{ height: 2, background: "rgba(255,255,255,0.12)" }}>
                    <div className="h-full rounded-full" style={{ background: "#a78bfa", transition: "width 1s linear" }} />
                  </div>
                )}
              </div>
            </div>

            {/* Skip button — bottom right, YouTube style */}
            <button
              onClick={() => {
                if (phase === "pre") {
                  preAudioRef.current?.pause();
                  setPhase("video");
                  videoRef.current?.play().catch(() => {});
                } else {
                  postAudioRef.current?.pause();
                  setPhase("idle");
                }
              }}
              className="absolute z-10 flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all hover:bg-white hover:text-black active:scale-95"
              style={{
                bottom: 28,
                right: 12,
                background: "rgba(20,20,30,0.75)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.3)",
                backdropFilter: "blur(10px)",
                borderRadius: 4,
                letterSpacing: "0.03em",
              }}>
              Saltar
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </>
        )}

        {/* Play overlay */}
        {!playing && isActive && phase === "video" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full flex items-center justify-center"
                 style={{ background: "rgba(0,0,0,0.45)", width: 64, height: 64 }}>
              <Play className="w-8 h-8 text-white ml-1" fill="white" />
            </div>
          </div>
        )}

        {/* Scrubber — tall hit area, thin visible bar, draggable knob */}
        <div
          ref={scrubBarRef}
          onMouseDown={handleScrubStart}
          onTouchStart={handleScrubStart}
          className="absolute left-0 right-0 flex items-center cursor-pointer select-none"
          style={{ bottom: 0, height: 20, zIndex: 20 }}>
          {/* Track */}
          <div className="w-full relative" style={{ height: scrubbing ? 4 : 2, background: "rgba(255,255,255,0.25)", transition: "height 0.15s" }}>
            {/* Fill */}
            <div className="absolute left-0 top-0 h-full"
                 style={{ width: `${progress}%`, background: "#00d47e", transition: scrubbing ? "none" : "width 0.2s" }} />
            {/* Knob */}
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all"
                 style={{
                   left: `${progress}%`,
                   width:  scrubbing ? 14 : 8,
                   height: scrubbing ? 14 : 8,
                   background: "#fff",
                   boxShadow: "0 0 4px rgba(0,0,0,0.5)",
                   opacity: scrubbing ? 1 : 0.85,
                   transition: "width 0.15s, height 0.15s",
                 }} />
          </div>
        </div>

        {/* Bottom info overlay */}
        {(() => {
          const captionText = captionLang === "es"
            ? (clip.translated_caption || "")
            : (clip.caption_en || "");
          const chunks = getCaptionChunks(captionText);
          const chunkIndex = chunks.length > 0
            ? Math.min(Math.floor((progress / 100) * chunks.length), chunks.length - 1)
            : 0;
          const currentCaption = chunks[chunkIndex] || "";

          return (
            <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2"
                 style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
              {/* Synced caption — above speaker name, only during video playback */}
              {captionLang !== "off" && phase === "video" && currentCaption && (
                <div className="px-3 py-1.5 rounded-lg text-sm font-medium leading-snug text-center"
                     style={{ background: "rgba(0,0,0,0.72)", color: "white" }}>
                  {currentCaption}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xl">{avatar}</span>
                <div>
                  <p className="text-white font-bold text-sm leading-tight">{clip.speaker}</p>
                  {clip.tags[0] && (
                    <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>#{clip.tags[0]}</p>
                  )}
                </div>
              </div>
              <p className="text-white text-sm font-medium leading-snug">{clip.title}</p>
            </div>
          );
        })()}

        {/* Comments drawer — slide-up from bottom, 50% height */}
        {showComments && (
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl flex flex-col"
            style={{
              height: "50%",
              background: "#111",
              border: "1px solid #222",
              transform: drawerOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)",
              zIndex: 30,
            }}>

            {/* Drag handle + header */}
            <div className="shrink-0">
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-8 h-1 rounded-full" style={{ background: "#3a3a3a" }} />
              </div>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "#222" }}>
                <p className="font-bold text-sm" style={{ color: "#fff" }}>
                  Comentarios ({clip.comment_count})
                </p>
                <button onClick={closeComments}>
                  <ChevronDown className="w-5 h-5" style={{ color: "#666" }} />
                </button>
              </div>
            </div>

            {/* Comment list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {comments.length === 0 ? (
                <p className="text-center py-6 text-sm" style={{ color: "#555" }}>
                  Sé el primero en comentar
                </p>
              ) : (
                comments.map((c) => {
                  const cName = c.user_profiles?.name || "Usuario";
                  return (
                    <div key={c.id} className="space-y-2">
                      {/* Top-level comment */}
                      <div className="flex items-start gap-2.5">
                        {c.user_profiles?.avatar_url ? (
                          <img src={c.user_profiles.avatar_url} alt={cName}
                               className="w-7 h-7 rounded-full shrink-0 object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                               style={{ background: "#00d47e", color: "#000" }}>
                            {cName[0].toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <p className="text-xs font-semibold" style={{ color: "#fff" }}>{cName}</p>
                            <p className="text-[10px]" style={{ color: "#555" }}>
                              {new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                            </p>
                          </div>
                          <p className="text-xs leading-snug mt-0.5" style={{ color: "#ccc" }}>{c.text}</p>
                          <button
                            onClick={() => setReplyingTo(replyingTo?.id === c.id ? null : { id: c.id, name: cName })}
                            className="text-[11px] font-semibold mt-1"
                            style={{ color: replyingTo?.id === c.id ? "#00d47e" : "#555" }}>
                            Responder
                          </button>
                        </div>
                      </div>

                      {/* Replies thread */}
                      {c.replies && c.replies.length > 0 && (
                        <div className="ml-9 space-y-2 border-l pl-3" style={{ borderColor: "#2a2a2a" }}>
                          {c.replies.map((r) => {
                            const rName = r.user_profiles?.name || "Usuario";
                            return (
                              <div key={r.id} className="flex items-start gap-2">
                                {r.user_profiles?.avatar_url ? (
                                  <img src={r.user_profiles.avatar_url} alt={rName}
                                       className="w-5 h-5 rounded-full shrink-0 object-cover" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                       style={{ background: "#2a2a2a", color: "#888" }}>
                                    {rName[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <p className="text-[11px] font-semibold" style={{ color: "#ddd" }}>{rName}</p>
                                    <p className="text-[10px]" style={{ color: "#555" }}>
                                      {new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                                    </p>
                                  </div>
                                  <p className="text-[11px] leading-snug mt-0.5" style={{ color: "#aaa" }}>{r.text}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Inline reply input */}
                      {replyingTo?.id === c.id && (
                        <div className="ml-9 flex items-center gap-2">
                          <input
                            autoFocus
                            type="text"
                            placeholder={`Responder a ${replyingTo.name}…`}
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && postComment(replyText, c.id)}
                            className="flex-1 rounded-full px-3 py-1.5 text-xs outline-none"
                            style={{ background: "#1a1a1a", color: "#fff", border: "1px solid #333" }}
                          />
                          <button
                            onClick={() => postComment(replyText, c.id)}
                            disabled={!replyText.trim()}
                            className="px-2.5 py-1.5 rounded-full text-[11px] font-bold disabled:opacity-40"
                            style={{ background: "#00d47e", color: "#000" }}>
                            ↵
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Main comment input */}
            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: "#1e1e1e" }}>
              <input
                type="text"
                placeholder="Escribe un comentario..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && postComment()}
                className="flex-1 rounded-full px-3 py-1.5 text-sm outline-none"
                style={{ background: "#1a1a1a", color: "#fff", border: "1px solid #2a2a2a" }}
              />
              <button
                onClick={() => postComment()}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-40"
                style={{ background: "#00d47e", color: "#000" }}>
                Enviar
              </button>
            </div>
          </div>
        )}
      </div>{/* end portrait frame */}

      {/* Right actions column — outside the video, TikTok style */}
      <div className="flex flex-col items-center gap-5 shrink-0">
        <button onClick={handleLike} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.1)" }}>
            <Heart className="w-6 h-6" fill={liked ? "#ff2d55" : "none"}
                   style={{ color: liked ? "#ff2d55" : "white" }} />
          </div>
          <span className="text-white text-xs font-semibold">{fmtCount(likeCount)}</span>
        </button>

        <button onClick={openComments} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.1)" }}>
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">{fmtCount(clip.comment_count)}</span>
        </button>

        <button onClick={handleSave} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.1)" }}>
            <Bookmark className="w-6 h-6" fill={saved ? "#ffd700" : "none"}
                      style={{ color: saved ? "#ffd700" : "white" }} />
          </div>
          <span className="text-white text-xs font-semibold">{saved ? "Guardado" : "Guardar"}</span>
        </button>

        {/* Captions button + picker */}
        <div className="relative flex flex-col items-center gap-1">
          <button
            onClick={() => setShowCaptionPicker((v) => !v)}
            className="flex flex-col items-center gap-1">
            <div className="w-11 h-11 rounded-full flex items-center justify-center"
                 style={{ background: captionLang !== "off" ? "rgba(0,212,126,0.25)" : "rgba(255,255,255,0.1)" }}>
              <Subtitles className="w-5 h-5" style={{ color: captionLang !== "off" ? "#00d47e" : "white" }} />
            </div>
            <span className="text-white text-xs font-semibold">
              {captionLang === "off" ? "CC" : captionLang === "es" ? "ES" : "EN"}
            </span>
          </button>

          {/* Lang picker popup */}
          {showCaptionPicker && (
            <div className="absolute right-14 top-0 flex flex-col rounded-xl overflow-hidden z-30"
                 style={{ background: "rgba(20,20,30,0.95)", border: "1px solid rgba(255,255,255,0.15)", minWidth: 90 }}>
              {(["off", "es", "en"] as const).map((lang) => (
                <button key={lang}
                        onClick={() => { setCaptionLang(lang); setShowCaptionPicker(false); }}
                        className="px-4 py-2.5 text-xs font-semibold text-left transition-all"
                        style={{
                          color: captionLang === lang ? "#00d47e" : "white",
                          background: captionLang === lang ? "rgba(0,212,126,0.1)" : "transparent",
                        }}>
                  {lang === "off" ? "Apagado" : lang === "es" ? "🇪🇸 Español" : "🇺🇸 English"}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={handleShare} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.1)" }}>
            <Share2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">{copied ? "✓" : "Compartir"}</span>
        </button>

        <button onClick={onMuteToggle}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.1)" }}>
            {isMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
          </div>
        </button>
      </div>

    </div>
  );
}
