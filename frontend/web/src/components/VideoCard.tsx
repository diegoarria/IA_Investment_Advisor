"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Heart, MessageCircle, Bookmark, Share2, Play, Volume2, VolumeX, ChevronDown } from "lucide-react";
import { feedApi } from "@/lib/api";
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
  user_profiles?: { name: string };
  replies?: Comment[];
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
  const videoRef      = useRef<HTMLVideoElement>(null);
  const preAudioRef   = useRef<HTMLAudioElement>(null);
  const postAudioRef  = useRef<HTMLAudioElement>(null);
  const scrubBarRef   = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing]       = useState(false);
  const [phase, setPhase]               = useState<"pre"|"video"|"post"|"idle">("idle");
  const [audioRemaining, setAudioRemaining] = useState(0); // seconds left in pre/post audio
  const [playing, setPlaying]           = useState(false);
  const [progress, setProgress]         = useState(0);
  const [showCaption, setShowCaption]   = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments]         = useState<Comment[]>([]);
  const [commentText, setCommentText]   = useState("");
  const [likeCount, setLikeCount]       = useState(clip.like_count);
  const [liked, setLiked]               = useState(clip.liked);
  const [saved, setSaved]               = useState(clip.saved);
  const [loadingLike, setLoadingLike]   = useState(false);
  const [copied, setCopied]             = useState(false);

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

  const postComment = async () => {
    if (!commentText.trim()) return;
    try {
      await feedApi.postComment(clip.id, commentText.trim());
      setCommentText("");
      loadComments();
    } catch {}
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
  };

  const avatar = SPEAKER_AVATAR[clip.speaker] ?? "🎓";
  const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  // TikTok-style: portrait frame + actions to the right
  return (
    <div className="flex items-center gap-3" style={{ height: "100svh" }}>

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

        {/* Phase badge: pre / post — with countdown + skip */}
        {(phase === "pre" || phase === "post") && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
            {/* Label + timer */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold"
                 style={{ background: "rgba(139,92,246,0.9)", color: "white", backdropFilter: "blur(8px)" }}>
              <span className="animate-pulse">🎙️</span>
              <span>{phase === "pre" ? "Introducción" : "Análisis IA"}</span>
              {audioRemaining > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{ background: "rgba(255,255,255,0.2)" }}>
                  {audioRemaining}s
                </span>
              )}
            </div>
            {/* Skip button — always visible */}
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
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-bold"
              style={{ background: "rgba(0,0,0,0.55)", color: "white", border: "1px solid rgba(255,255,255,0.25)", backdropFilter: "blur(8px)" }}>
              Saltar ›
            </button>
          </div>
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
        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-1.5"
             style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
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
          {clip.translated_caption && (
            <button onClick={() => setShowCaption((v) => !v)}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.75)",
                             border: "1px solid rgba(255,255,255,0.2)" }}>
              {showCaption ? "Ocultar subtítulos" : "CC · Subtítulos"}
            </button>
          )}
          {showCaption && (
            <div className="p-2 rounded-lg text-xs leading-relaxed"
                 style={{ background: "rgba(0,0,0,0.75)", color: "white", maxHeight: 100, overflowY: "auto" }}>
              {clip.translated_caption}
            </div>
          )}
        </div>

        {/* Comments drawer — anchored inside video */}
        {showComments && (
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl flex flex-col"
               style={{ height: "65%", background: "#111", border: "1px solid #333" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b"
               style={{ borderColor: "var(--border, #333)" }}>
            <p className="font-bold text-sm" style={{ color: "var(--text, #fff)" }}>
              Comentarios ({clip.comment_count})
            </p>
            <button onClick={() => setShowComments(false)}>
              <ChevronDown className="w-5 h-5" style={{ color: "var(--muted, #888)" }} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
            {comments.length === 0 ? (
              <p className="text-center py-6 text-sm" style={{ color: "var(--muted, #888)" }}>
                Sé el primero en comentar
              </p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-start gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                         style={{ background: "var(--accent-l, #00d47e)", color: "#000" }}>
                      {(c.user_profiles?.name || "?")[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: "var(--text, #fff)" }}>
                        {c.user_profiles?.name || "Usuario"}
                      </p>
                      <p className="text-xs" style={{ color: "var(--sub, #aaa)" }}>{c.text}</p>
                    </div>
                  </div>
                  {c.replies?.map((r) => (
                    <div key={r.id} className="flex items-start gap-2 ml-9">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                           style={{ background: "var(--raised, #2a2a2a)", color: "var(--muted, #888)" }}>
                        {(r.user_profiles?.name || "?")[0].toUpperCase()}
                      </div>
                      <p className="text-xs" style={{ color: "var(--sub, #aaa)" }}>{r.text}</p>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2 px-4 py-3 border-t"
               style={{ borderColor: "#333" }}>
            <input
              type="text"
              placeholder="Escribe un comentario..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && postComment()}
              className="flex-1 rounded-full px-3 py-1.5 text-sm outline-none"
              style={{ background: "#222", color: "#fff", border: "1px solid #333" }}
            />
            <button onClick={postComment} disabled={!commentText.trim()}
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
