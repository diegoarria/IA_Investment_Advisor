"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Heart, MessageCircle, Bookmark, Share2, Play, Pause, Volume2, VolumeX, ChevronDown, SkipForward, Subtitles, Trash2, Download } from "lucide-react";
import { feedApi } from "@/lib/api";
import { useProfileStore, useAuthStore } from "@/lib/store";
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
  const myUserId  = useAuthStore((s) => s.userId);
  const videoRef      = useRef<HTMLVideoElement>(null);
  const preAudioRef   = useRef<HTMLAudioElement>(null);
  const postAudioRef  = useRef<HTMLAudioElement>(null);
  const scrubBarRef   = useRef<HTMLDivElement>(null);
  const hlsRef        = useRef<Hls | null>(null);
  const viewTrackedRef = useRef(false);
  const [scrubbing, setScrubbing]       = useState(false);
  const [phase, setPhase]               = useState<"pre"|"video"|"post"|"idle">("idle");
  const [audioRemaining, setAudioRemaining] = useState(0); // seconds left in pre/post audio
  const [playing, setPlaying]           = useState(false);
  const [progress, setProgress]         = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [comments, setComments]         = useState<Comment[]>([]);
  const [commentCount, setCommentCount] = useState(clip.comment_count);
  const [commentText, setCommentText]   = useState("");
  const [replyingTo, setReplyingTo]     = useState<{ id: string; name: string } | null>(null);
  const [replyText, setReplyText]       = useState("");
  const [likeCount, setLikeCount]       = useState(clip.like_count);
  const [liked, setLiked]               = useState(clip.liked);
  const [saved, setSaved]               = useState(clip.saved);
  const [loadingLike, setLoadingLike]   = useState(false);
  const [downloading, setDownloading]   = useState(false);
  const [captionLang, setCaptionLang]   = useState<"off"|"es"|"en">("off");
  const [showCaptionPicker, setShowCaptionPicker] = useState(false);
  const [tapIcon, setTapIcon]           = useState<"play"|"pause"|null>(null);
  const [showThumb, setShowThumb]       = useState(true); // covers black screen while video buffers
  const [shareOpen, setShareOpen]       = useState(false);
  const [sharingTo, setSharingTo]       = useState<"instagram"|"facebook"|null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Video source setup — only runs when this card is active.
  // hls.loadSource() always fetches the manifest immediately even with autoStartLoad:false.
  // Creating HLS only on activation avoids the prior bug where stopLoad() on mount
  // aborted the manifest for inactive cards, leaving startLoad(-1) with nothing to load.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isActive || !clip.video_url) return;

    const url = clip.video_url;
    viewTrackedRef.current = false;

    if (url.includes(".m3u8")) {
      if (Hls.isSupported()) {
        const hls = new Hls({ startLevel: -1, maxBufferLength: 30, maxMaxBufferLength: 60 });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) { hls.destroy(); hlsRef.current = null; }
        });
        hls.loadSource(url);
        hls.attachMedia(v);
        hlsRef.current = hls;
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = url;
        v.load();
      }
    } else {
      v.src = url;
      v.load();
    }

    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, [isActive, clip.video_url]); // eslint-disable-line

  const safePlay = useCallback(async (el: HTMLVideoElement) => {
    el.muted = isMuted;
    try {
      await el.play();
    } catch {
      // Browser blocked autoplay with sound — retry muted as fallback
      el.muted = true;
      await new Promise((r) => setTimeout(r, 50));
      el.play().catch(() => {});
    }
    setPlaying(true);
  }, [isMuted]);

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
      setShowThumb(true);
      return;
    }

    const startVideo = () => { setPhase("video"); safePlay(v); };

    if (clip.pre_audio_url && pre) {
      setPhase("pre");
      pre.play().catch(startVideo);
    } else {
      startVideo();
    }
  }, [isActive, clip.pre_audio_url, safePlay]); // eslint-disable-line

  // When pre-audio ends → start video
  const handlePreEnded = useCallback(() => {
    setPhase("video");
    if (videoRef.current) safePlay(videoRef.current);
  }, [safePlay]);

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
    const ratio = v.currentTime / v.duration;
    setProgress(ratio * 100);
    // Track view only once per clip (at 15%) — avoid 30+ API calls/second
    if (!viewTrackedRef.current && ratio >= 0.15) {
      viewTrackedRef.current = true;
      feedApi.view(clip.id, Math.round(ratio * 100)).catch(() => {});
    }
  }, [clip.id]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      safePlay(v);
    } else {
      v.pause();
      setPlaying(false);
    }
    setTapIcon(v.paused ? "play" : "pause");
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapIcon(null), 700);
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

  const handleDownload = async () => {
    if (downloading) return;
    if (clip.video_url.includes(".m3u8")) {
      // HLS stream — can't proxy easily; open in new tab so user can save manually
      window.open(clip.video_url, "_blank");
      return;
    }
    setDownloading(true);
    try {
      // Proxy through backend so download works regardless of CDN CORS policy
      const token = localStorage.getItem("access_token");
      const res = await fetch(`/api/feed/clips/${clip.id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${clip.title.replace(/[^a-z0-9 ]/gi, "_")}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: direct link in new tab
      window.open(clip.video_url, "_blank");
    } finally {
      setDownloading(false);
    }
  };

  const handleShare = () => setShareOpen((v) => !v);

  const buildBrandedBlob = async (): Promise<Blob | null> => {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Background
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(0, 0, 1080, 1920);

    // Thumbnail
    if (clip.thumbnail_url) {
      try {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = clip.thumbnail_url; });
        const scale = Math.max(1080 / img.width, 1920 / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (1080 - w) / 2, (1920 - h) / 2, w, h);
      } catch {}
    }

    // Gradient overlay
    const grad = ctx.createLinearGradient(0, 800, 0, 1920);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1920);

    // Nuvos logo
    try {
      const logo = new window.Image();
      logo.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { logo.onload = () => res(); logo.onerror = rej; logo.src = "/logo.png"; });
      ctx.drawImage(logo, 60, 1750, 220, 72);
    } catch {}

    // Speaker
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "600 38px Inter, sans-serif";
    ctx.fillText(clip.speaker, 60, 1680);

    // Title — word-wrapped
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 54px Inter, sans-serif";
    const words = clip.title.split(" ");
    let line = "", y = 1730;
    for (const word of words) {
      const test = line + word + " ";
      if (ctx.measureText(test).width > 960 && line) {
        ctx.fillText(line.trim(), 60, y); y += 68; line = word + " ";
      } else { line = test; }
    }
    if (line.trim()) ctx.fillText(line.trim(), 60, y);

    // "Nuvos AI" badge top-right
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.roundRect(880, 44, 156, 48, 24); ctx.fill();
    ctx.fillStyle = "#a78bfa";
    ctx.font = "800 24px Inter, sans-serif";
    ctx.fillText("NUVOS AI", 900, 75);

    return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
  };

  const shareToStories = async (platform: "instagram" | "facebook") => {
    setSharingTo(platform);
    setShareOpen(false);

    // Build branded image (best-effort; continues even if thumbnail has CORS issues)
    const blob = await buildBrandedBlob();

    if (blob) {
      const file = new File([blob], "nuvos-story.jpg", { type: "image/jpeg" });

      // Mobile browsers: Web Share API opens the OS share sheet where
      // Instagram / Facebook appear with "Add to Story" as a target.
      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: clip.title });
          setSharingTo(null);
          return;
        } catch {}
      }

      // Desktop / fallback: download the branded image so the user can upload it manually
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl; a.download = "nuvos-story.jpg";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    }

    // Open Stories composer: deep link for mobile browsers (app installed),
    // then fall back to the web URL after 1.5s if the app didn't intercept it.
    const webUrls: Record<string, string> = {
      instagram: "https://www.instagram.com/",
      facebook:  "https://www.facebook.com/stories/create",
    };
    const deepLinks: Record<string, string> = {
      instagram: "instagram://story-camera",
      facebook:  "fb://stories",
    };
    // window.location.href triggers the deep link without popup-blocker issues
    window.location.href = deepLinks[platform];
    setTimeout(() => window.open(webUrls[platform], "_blank"), 1500);

    setSharingTo(null);
  };

  const shareToWhatsApp = () => {
    setShareOpen(false);
    const clipUrl = `${window.location.origin}/feed?clip=${clip.id}`;
    const text = encodeURIComponent(
      `🎯 *${clip.title}*\n\n📣 ${clip.speaker} | Nuvos AI\n\n👉 ${clipUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const loadComments = async () => {
    try {
      const res = await feedApi.getComments(clip.id);
      const fetched: Comment[] = res.data?.comments;
      if (Array.isArray(fetched)) {
        setComments(fetched);
        const total = fetched.reduce((sum, c) => sum + 1 + (c.replies?.length || 0), 0);
        setCommentCount(total);
      }
    } catch (err) {
      console.error("[VideoCard] loadComments failed:", err);
    }
  };

  const postComment = async (text?: string, parentId?: string) => {
    const body = text ?? commentText;
    if (!body.trim()) return;
    const tempId = `opt-${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      user_id: myUserId || "",
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
    setCommentCount((n) => n + 1);
    try {
      const res = await feedApi.postComment(clip.id, body.trim(), parentId);
      const realId: string | undefined = res.data?.comment?.id;
      if (realId) {
        // swap temp id with real server id — no full refetch, existing comments untouched
        if (parentId) {
          setComments((prev) => prev.map((c) => c.id === parentId
            ? { ...c, replies: (c.replies || []).map((r) => r.id === tempId ? { ...r, id: realId, user_id: myUserId || "" } : r) }
            : c));
        } else {
          setComments((prev) => prev.map((c) => c.id === tempId ? { ...c, id: realId, user_id: myUserId || "" } : c));
        }
      }
    } catch {
      // rollback only the optimistic entry
      if (parentId) {
        setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: (c.replies || []).filter((r) => r.id !== tempId) } : c));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
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
    if (phase !== "video") { setPhase("video"); safePlay(v); }
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

  const deleteComment = async (commentId: string, parentId?: string) => {
    if (parentId) {
      setComments((prev) => prev.map((c) => c.id === parentId ? { ...c, replies: (c.replies || []).filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    setCommentCount((n) => Math.max(0, n - 1));
    try {
      await feedApi.deleteComment(clip.id, commentId);
    } catch {
      loadComments(); // rollback on error
    }
  };

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
    <div className="flex items-center gap-3" style={{ height: "100%" }}>
      <style>{`
        @keyframes soundbar {
          from { transform: scaleY(0.3); opacity: 0.5; }
          to   { transform: scaleY(1);   opacity: 1; }
        }
        @keyframes tapFlash {
          0%   { transform: scale(0.7); opacity: 1; }
          60%  { transform: scale(1.1); opacity: 0.9; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>

      {/* Portrait video frame — 9:16 aspect ratio, fills available height.
          transform:translateZ(0) on the container forces a GPU compositor layer
          so Safari doesn't black-out the overflow-hidden clip region for offscreen
          videos when they first scroll into view. */}
      <div className="relative rounded-xl overflow-hidden shrink-0"
           style={{
             height: "100%",
             aspectRatio: "9/16",
             maxWidth: "calc(100% - 64px)",
             background: "#000",
             transform: "translateZ(0)",
             WebkitTransform: "translateZ(0)",
           } as React.CSSProperties}>

        {/* Hidden pre/post audio elements — only load when this card is active */}
        {clip.pre_audio_url && (
          <audio ref={preAudioRef} src={isActive ? clip.pre_audio_url : undefined} preload="none"
                 onEnded={handlePreEnded}
                 onTimeUpdate={(e) => {
                   const a = e.currentTarget;
                   setAudioRemaining(Math.ceil(a.duration - a.currentTime));
                 }}
                 onLoadedMetadata={(e) => setAudioRemaining(Math.ceil(e.currentTarget.duration))} />
        )}
        {clip.post_audio_url && (
          <audio ref={postAudioRef} src={isActive ? clip.post_audio_url : undefined} preload="none"
                 onEnded={() => setPhase("idle")}
                 onTimeUpdate={(e) => {
                   const a = e.currentTarget;
                   setAudioRemaining(Math.ceil(a.duration - a.currentTime));
                 }}
                 onLoadedMetadata={(e) => setAudioRemaining(Math.ceil(e.currentTarget.duration))} />
        )}

        {/* Video — preload="none" on all cards; src/loading controlled by effects above.
            transform:translateZ(0) forces a GPU compositing layer so Safari doesn't
            render offscreen videos as black when they first enter the viewport. */}
        <video
          ref={videoRef}
          playsInline
          preload="none"
          muted={isMuted}
          onTimeUpdate={handleTimeUpdate}
          onCanPlay={() => setShowThumb(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={handleVideoEnded}
          onError={() => {}}
          className="w-full h-full object-cover"
          style={{ transform: "translateZ(0)", WebkitTransform: "translateZ(0)" } as React.CSSProperties}
        />

        {/* Thumbnail overlay — hides the black buffering screen until first frame is ready */}
        {showThumb && clip.thumbnail_url && (
          <img
            src={clip.thumbnail_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            style={{ zIndex: 2 }}
          />
        )}

        {/* Transparent tap zone — sits above video, below all interactive overlays */}
        <div
          onClick={togglePlay}
          className="absolute inset-0 cursor-pointer"
          style={{ zIndex: 1 }}
        />

        {/* Tap flash icon */}
        {tapIcon && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 6 }}
          >
            <div
              className="rounded-full flex items-center justify-center"
              style={{
                background: "rgba(0,0,0,0.45)",
                width: 72, height: 72,
                animation: "tapFlash 0.65s ease-out forwards",
              }}
            >
              {tapIcon === "play"
                ? <Play  className="w-9 h-9 text-white ml-1" fill="white" />
                : <Pause className="w-9 h-9 text-white" fill="white" />}
            </div>
          </div>
        )}

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
                  if (videoRef.current) safePlay(videoRef.current);
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
              background: "var(--card)",
              border: "1px solid var(--border)",
              transform: drawerOpen ? "translateY(0)" : "translateY(100%)",
              transition: "transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)",
              zIndex: 30,
            }}>

            {/* Drag handle + header */}
            <div className="shrink-0">
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-8 h-1 rounded-full" style={{ background: "var(--border-s)" }} />
              </div>
              <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
                <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                  Comentarios ({commentCount})
                </p>
                <button onClick={closeComments}>
                  <ChevronDown className="w-5 h-5" style={{ color: "var(--muted)" }} />
                </button>
              </div>
            </div>

            {/* Comment list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {comments.length === 0 ? (
                <p className="text-center py-6 text-sm" style={{ color: "var(--muted)" }}>
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
                               style={{ background: "var(--accent)", color: "#000" }}>
                            {cName[0].toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>{cName}</p>
                            <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                              {new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                            </p>
                            {c.user_id === myUserId && (
                              <button onClick={() => deleteComment(c.id)} className="ml-auto p-1 rounded-full opacity-40 hover:opacity-100 transition-opacity">
                                <Trash2 className="w-3 h-3" style={{ color: "var(--down)" }} />
                              </button>
                            )}
                          </div>
                          <p className="text-xs leading-snug mt-0.5" style={{ color: "var(--sub)" }}>{c.text}</p>
                          <button
                            onClick={() => setReplyingTo(replyingTo?.id === c.id ? null : { id: c.id, name: cName })}
                            className="text-[11px] font-semibold mt-1"
                            style={{ color: replyingTo?.id === c.id ? "var(--accent)" : "var(--muted)" }}>
                            Responder
                          </button>
                        </div>
                      </div>

                      {/* Replies thread */}
                      {c.replies && c.replies.length > 0 && (
                        <div className="ml-9 space-y-2 border-l pl-3" style={{ borderColor: "var(--border)" }}>
                          {c.replies.map((r) => {
                            const rName = r.user_profiles?.name || "Usuario";
                            return (
                              <div key={r.id} className="flex items-start gap-2">
                                {r.user_profiles?.avatar_url ? (
                                  <img src={r.user_profiles.avatar_url} alt={rName}
                                       className="w-5 h-5 rounded-full shrink-0 object-cover" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                                       style={{ background: "var(--raised)", color: "var(--sub)" }}>
                                    {rName[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-[11px] font-semibold" style={{ color: "var(--text)" }}>{rName}</p>
                                    <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                                      {new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                                    </p>
                                    {r.user_id === myUserId && (
                                      <button onClick={() => deleteComment(r.id, c.id)} className="ml-auto p-1 rounded-full opacity-40 hover:opacity-100 transition-opacity">
                                        <Trash2 className="w-3 h-3" style={{ color: "var(--down)" }} />
                                      </button>
                                    )}
                                  </div>
                                  <p className="text-[11px] leading-snug mt-0.5" style={{ color: "var(--sub)" }}>{r.text}</p>
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
                            style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
                          />
                          <button
                            onClick={() => postComment(replyText, c.id)}
                            disabled={!replyText.trim()}
                            className="px-2.5 py-1.5 rounded-full text-[11px] font-bold disabled:opacity-40"
                            style={{ background: "var(--accent)", color: "#000" }}>
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
            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
              <input
                type="text"
                placeholder="Escribe un comentario..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && postComment()}
                className="flex-1 rounded-full px-3 py-1.5 text-sm outline-none"
                style={{ background: "var(--raised)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
              <button
                onClick={() => postComment()}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-40"
                style={{ background: "var(--accent)", color: "#000" }}>
                Enviar
              </button>
            </div>
          </div>
        )}
      </div>{/* end portrait frame */}

      {/* Right actions column — outside the video, TikTok style */}
      <div className="flex flex-col items-center gap-3 shrink-0">
        <button onClick={handleLike} className="flex flex-col items-center gap-0.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: "var(--raised)" }}>
            <Heart className="w-5 h-5" fill={liked ? "#ff2d55" : "none"}
                   style={{ color: liked ? "#ff2d55" : "var(--text)" }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>{fmtCount(likeCount)}</span>
        </button>

        <button onClick={openComments} className="flex flex-col items-center gap-0.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: "var(--raised)" }}>
            <MessageCircle className="w-5 h-5" style={{ color: "var(--text)" }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>{fmtCount(commentCount)}</span>
        </button>

        <button onClick={handleSave} className="flex flex-col items-center gap-0.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: "var(--raised)" }}>
            <Bookmark className="w-5 h-5" fill={saved ? "#ffd700" : "none"}
                      style={{ color: saved ? "#ffd700" : "var(--text)" }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>{saved ? "Guardado" : "Guardar"}</span>
        </button>

        <button onClick={handleDownload} disabled={downloading} className="flex flex-col items-center gap-0.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: "var(--raised)", opacity: downloading ? 0.5 : 1 }}>
            <Download className="w-4 h-4" style={{ color: downloading ? "var(--accent)" : "var(--text)" }} />
          </div>
          <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>
            {downloading ? "..." : "Bajar"}
          </span>
        </button>

        {/* Captions button + picker */}
        <div className="relative flex flex-col items-center gap-0.5">
          <button
            onClick={() => setShowCaptionPicker((v) => !v)}
            className="flex flex-col items-center gap-0.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center"
                 style={{ background: captionLang !== "off" ? "var(--accent-glow)" : "var(--raised)" }}>
              <Subtitles className="w-4 h-4" style={{ color: captionLang !== "off" ? "var(--accent-l)" : "var(--text)" }} />
            </div>
            <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>
              {captionLang === "off" ? "CC" : captionLang === "es" ? "ES" : "EN"}
            </span>
          </button>

          {/* Lang picker popup */}
          {showCaptionPicker && (
            <div className="absolute right-12 top-0 flex flex-col rounded-xl overflow-hidden z-30"
                 style={{ background: "var(--card)", border: "1px solid var(--border)", minWidth: 90 }}>
              {(["off", "es", "en"] as const).map((lang) => (
                <button key={lang}
                        onClick={() => { setCaptionLang(lang); setShowCaptionPicker(false); }}
                        className="px-4 py-2 text-xs font-semibold text-left transition-all"
                        style={{
                          color: captionLang === lang ? "var(--accent)" : "var(--text)",
                          background: captionLang === lang ? "var(--accent-pulse)" : "transparent",
                        }}>
                  {lang === "off" ? "Apagado" : lang === "es" ? "🇪🇸 Español" : "🇺🇸 English"}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Share button + popup */}
        <div className="relative flex flex-col items-center gap-0.5">
          <button onClick={handleShare} className="flex flex-col items-center gap-0.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center"
                 style={{ background: shareOpen ? "var(--accent-glow)" : "var(--raised)" }}>
              <Share2 className="w-5 h-5" style={{ color: shareOpen ? "var(--accent-l)" : "var(--text)" }} />
            </div>
            <span className="text-[10px] font-semibold" style={{ color: "var(--sub)" }}>Compartir</span>
          </button>

          {shareOpen && (
            <div
              className="absolute right-12 bottom-0 rounded-2xl overflow-hidden z-40 flex flex-col"
              style={{ background: "var(--card)", border: "1px solid var(--border)", minWidth: 190, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
            >
              {/* Historia section */}
              <p className="text-[10px] font-bold px-3 pt-3 pb-1 uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Historia
              </p>
              <button
                onClick={() => shareToStories("instagram")}
                disabled={sharingTo !== null}
                className="flex items-center gap-2.5 px-3 py-2 transition-all hover:opacity-80 disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                     style={{ background: "linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)" }}>
                  {sharingTo === "instagram"
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    : <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                  }
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>Instagram</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Historia</p>
                </div>
              </button>
              <button
                onClick={() => shareToStories("facebook")}
                disabled={sharingTo !== null}
                className="flex items-center gap-2.5 px-3 py-2 transition-all hover:opacity-80 disabled:opacity-50"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                     style={{ background: "#1877F2" }}>
                  {sharingTo === "facebook"
                    ? <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    : <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                  }
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>Facebook</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Historia</p>
                </div>
              </button>

              {/* Divider */}
              <div style={{ height: 1, background: "var(--border)", margin: "4px 12px" }} />

              {/* WhatsApp */}
              <p className="text-[10px] font-bold px-3 pt-2 pb-1 uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                Enviar a contactos
              </p>
              <button
                onClick={shareToWhatsApp}
                className="flex items-center gap-2.5 px-3 py-2 pb-3 transition-all hover:opacity-80"
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                     style={{ background: "#25D366" }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>WhatsApp</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>Enviar link a contactos</p>
                </div>
              </button>
            </div>
          )}
        </div>

        <button onClick={onMuteToggle}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
               style={{ background: "var(--raised)" }}>
            {isMuted ? <VolumeX className="w-4 h-4" style={{ color: "var(--text)" }} /> : <Volume2 className="w-4 h-4" style={{ color: "var(--text)" }} />}
          </div>
        </button>
      </div>

    </div>
  );
}
