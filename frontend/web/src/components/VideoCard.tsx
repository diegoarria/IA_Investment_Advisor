"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Heart, MessageCircle, Bookmark, Share2, Play, Volume2, VolumeX, ChevronDown } from "lucide-react";
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
  const [playing, setPlaying]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [showCaption, setShowCaption] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments]       = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [likeCount, setLikeCount]     = useState(clip.like_count);
  const [liked, setLiked]             = useState(clip.liked);
  const [saved, setSaved]             = useState(clip.saved);
  const [loadingLike, setLoadingLike] = useState(false);
  const [copied, setCopied]           = useState(false);

  // Autoplay / pause when active changes
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isActive) {
      v.play().catch(() => {});
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [isActive]);

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

  const openComments = () => {
    setShowComments(true);
    loadComments();
  };

  const avatar = SPEAKER_AVATAR[clip.speaker] ?? "🎓";
  const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="relative w-full h-full flex items-center justify-center"
         style={{ background: "#000" }}>
      {/* Video */}
      <video
        ref={videoRef}
        src={clip.video_url}
        poster={clip.thumbnail_url || undefined}
        loop
        playsInline
        preload="metadata"
        muted={isMuted}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={togglePlay}
        className="w-full h-full object-cover cursor-pointer"
        style={{ maxHeight: "100vh" }}
      />

      {/* Play icon overlay (shows briefly when paused) */}
      {!playing && isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-full flex items-center justify-center"
               style={{ background: "rgba(0,0,0,0.4)", width: 72, height: 72 }}>
            <Play className="w-9 h-9 text-white ml-1" fill="white" />
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5"
           style={{ background: "rgba(255,255,255,0.2)" }}>
        <div className="h-full transition-all duration-200"
             style={{ width: `${progress}%`, background: "var(--accent-l, #00d47e)" }} />
      </div>

      {/* Bottom overlay: speaker + title + caption */}
      <div className="absolute bottom-4 left-4 right-16 space-y-2">
        {/* Speaker */}
        <div className="flex items-center gap-2">
          <span className="text-2xl">{avatar}</span>
          <div>
            <p className="text-white font-bold text-sm leading-tight">{clip.speaker}</p>
            {clip.tags.length > 0 && (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                #{clip.tags[0]}
              </p>
            )}
          </div>
        </div>

        {/* Title */}
        <p className="text-white font-semibold text-sm leading-snug drop-shadow-lg">
          {clip.title}
        </p>

        {/* Caption toggle */}
        {clip.translated_caption && (
          <button
            onClick={() => setShowCaption((v) => !v)}
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.2)" }}>
            {showCaption ? "Ocultar subtítulos" : "Ver subtítulos"}
          </button>
        )}

        {showCaption && (
          <div className="p-2 rounded-lg text-xs leading-relaxed"
               style={{ background: "rgba(0,0,0,0.7)", color: "white", maxHeight: 120, overflowY: "auto" }}>
            {clip.translated_caption}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="absolute right-3 bottom-10 flex flex-col items-center gap-5">
        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-1">
          <div className="rounded-full p-2.5"
               style={{ background: "rgba(0,0,0,0.4)" }}>
            <Heart
              className="w-6 h-6"
              fill={liked ? "#ff2d55" : "none"}
              style={{ color: liked ? "#ff2d55" : "white" }}
            />
          </div>
          <span className="text-white text-xs font-semibold">{fmtCount(likeCount)}</span>
        </button>

        {/* Comments */}
        <button onClick={openComments} className="flex flex-col items-center gap-1">
          <div className="rounded-full p-2.5"
               style={{ background: "rgba(0,0,0,0.4)" }}>
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">{fmtCount(clip.comment_count)}</span>
        </button>

        {/* Save */}
        <button onClick={handleSave} className="flex flex-col items-center gap-1">
          <div className="rounded-full p-2.5"
               style={{ background: "rgba(0,0,0,0.4)" }}>
            <Bookmark
              className="w-6 h-6"
              fill={saved ? "#ffd700" : "none"}
              style={{ color: saved ? "#ffd700" : "white" }}
            />
          </div>
          <span className="text-white text-xs font-semibold">{saved ? "Guardado" : "Guardar"}</span>
        </button>

        {/* Share */}
        <button onClick={handleShare} className="flex flex-col items-center gap-1">
          <div className="rounded-full p-2.5"
               style={{ background: "rgba(0,0,0,0.4)" }}>
            <Share2 className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs font-semibold">{copied ? "¡Copiado!" : "Compartir"}</span>
        </button>

        {/* Mute */}
        <button onClick={onMuteToggle} className="flex flex-col items-center gap-1">
          <div className="rounded-full p-2.5"
               style={{ background: "rgba(0,0,0,0.4)" }}>
            {isMuted
              ? <VolumeX className="w-6 h-6 text-white" />
              : <Volume2 className="w-6 h-6 text-white" />}
          </div>
        </button>
      </div>

      {/* Comments drawer */}
      {showComments && (
        <div
          className="absolute inset-x-0 bottom-0 rounded-t-2xl flex flex-col"
          style={{
            height: "60%",
            background: "var(--card, #1a1a1a)",
            border: "1px solid var(--border, #333)",
          }}>
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
               style={{ borderColor: "var(--border, #333)" }}>
            <input
              type="text"
              placeholder="Escribe un comentario..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && postComment()}
              className="flex-1 rounded-full px-3 py-1.5 text-sm outline-none"
              style={{
                background: "var(--raised, #2a2a2a)",
                color: "var(--text, #fff)",
                border: "1px solid var(--border, #333)",
              }}
            />
            <button
              onClick={postComment}
              disabled={!commentText.trim()}
              className="px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-40"
              style={{ background: "var(--accent-l, #00d47e)", color: "#000" }}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
