"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Bookmark, Play, ArrowLeft } from "lucide-react";
import { feedApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useTranslation } from "react-i18next";

interface SavedClip {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  video_url: string;
  speaker: string;
  tags: string[];
  duration_sec: number;
  view_count: number;
  like_count: number;
}

export default function SavedClipsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [clips, setClips]     = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    feedApi.getSaved()
      .then((res) => setClips(res.data.clips || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const handleDownload = async (clip: SavedClip) => {
    if (downloading) return;
    if (clip.video_url.includes(".m3u8")) {
      window.open(clip.video_url, "_blank");
      return;
    }
    setDownloading(clip.id);
    try {
      const res = await fetch(`/api/feed/clips/${clip.id}/download`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${clip.title.replace(/[^a-z0-9 ]/gi, "_")}.mp4`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(clip.video_url, "_blank");
    } finally {
      setDownloading(null);
    }
  };

  const handleUnsave = async (clipId: string) => {
    setClips((prev) => prev.filter((c) => c.id !== clipId));
    try {
      await feedApi.save(clipId); // toggle — removes the save
    } catch {
      feedApi.getSaved().then((r) => setClips(r.data.clips || []));
    }
  };

  const fmtDuration = (sec: number) => {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()}
                  className="p-2 rounded-full"
                  style={{ background: "var(--raised)" }}>
            <ArrowLeft className="w-4 h-4" style={{ color: "var(--text)" }} />
          </button>
          <div>
            <h1 className="text-xl font-black flex items-center gap-2">
              <Bookmark className="w-5 h-5" fill="#ffd700" style={{ color: "#ffd700" }} />
              {t("feed.savedTitle")}
            </h1>
            {!loading && (
              <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                {t(clips.length === 1 ? "feed.savedCountSingular" : "feed.savedCountPlural", { count: clips.length })}
              </p>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
          </div>
        ) : clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <Bookmark className="w-12 h-12" style={{ color: "var(--muted)" }} />
            <p className="font-bold text-lg" style={{ color: "var(--text)" }}>{t("feed.savedEmptyTitle")}</p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {t("feed.savedEmptySubtitle")}
            </p>
            <button
              onClick={() => router.push("/feed")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm"
              style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)", color: "#000" }}>
              <Play className="w-4 h-4" /> {t("feed.goToFeed")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {clips.map((clip) => (
              <div key={clip.id}
                   className="flex gap-3 rounded-2xl p-3 border"
                   style={{ background: "var(--card)", borderColor: "var(--border)" }}>

                {/* Thumbnail */}
                <div
                  className="relative shrink-0 rounded-xl overflow-hidden cursor-pointer"
                  style={{ width: 96, height: 140, background: "var(--raised)" }}
                  onClick={() => router.push("/feed")}>
                  {clip.thumbnail_url ? (
                    <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl">🎬</div>
                  )}
                  {clip.duration_sec > 0 && (
                    <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold"
                         style={{ background: "rgba(0,0,0,0.7)", color: "#fff" }}>
                      {fmtDuration(clip.duration_sec)}
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                       style={{ background: "rgba(0,0,0,0.4)" }}>
                    <Play className="w-6 h-6 text-white" fill="white" />
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <p className="font-bold text-sm leading-snug line-clamp-2" style={{ color: "var(--text)" }}>
                      {clip.title}
                    </p>
                    <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>{clip.speaker}</p>
                    {clip.tags?.slice(0, 2).map((t) => (
                      <span key={t} className="inline-block mr-1 mt-1 px-2 py-0.5 rounded-full text-[10px]"
                            style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        #{t}
                      </span>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => handleDownload(clip)}
                      disabled={downloading === clip.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                      style={{ background: "rgba(0,212,126,0.12)", color: "var(--accent)" }}>
                      {downloading === clip.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Download className="w-3 h-3" />}
                      {downloading === clip.id ? t("feed.downloading") : t("feed.download")}
                    </button>

                    <button
                      onClick={() => handleUnsave(clip.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ background: "rgba(255,215,0,0.1)", color: "#b8980c" }}>
                      <Bookmark className="w-3 h-3" fill="currentColor" />
                      {t("feed.remove")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
