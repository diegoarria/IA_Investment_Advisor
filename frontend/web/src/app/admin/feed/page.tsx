"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Check, Archive, Trash2, Eye, EyeOff, Loader2, ChevronDown, ChevronUp, Mic, Pencil } from "lucide-react";
import { feedApi } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

// Only this UUID can access this page
const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

const SPEAKERS = [
  "Warren Buffett", "Charlie Munger", "Ray Dalio", "Benjamin Graham",
  "Peter Lynch", "Morgan Housel", "Howard Marks", "Seth Klarman",
  "Bill Ackman", "Michael Burry", "Grant Cardone", "Robert Kiyosaki", "Nassim Taleb",
  "Tim Cook", "Donald Trump",
];

const TAG_OPTIONS = [
  "value investing", "macro", "mindset", "riesgo", "psicología",
  "deuda", "diversificación", "largo plazo", "crisis", "análisis",
  "economía conductual", "mercados", "sectores", "opciones", "crypto",
];

interface Clip {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  speaker: string;
  tags: string[];
  language: string;
  translated_caption: string;
  duration_sec: number;
  status: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  created_at: string;
  pre_text: string;
  post_text: string;
  pre_audio_url: string;
  post_audio_url: string;
  caption_en: string;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  video_url: "",
  thumbnail_url: "",
  speaker: "Warren Buffett",
  tags: [] as string[],
  language: "es",
  translated_caption: "",
  caption_en: "",
  duration_sec: 0,
};

export default function AdminFeedPage() {
  const router    = useRouter();
  const { userId } = useAuthStore();

  const [clips, setClips]         = useState<Clip[]>([]);
  const [statusFilter, setStatus] = useState<"draft" | "published" | "archived">("draft");
  const [loading, setLoading]     = useState(true);
  const [formOpen, setFormOpen]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // null = create, string = edit
  const [form, setForm]           = useState({ ...EMPTY_FORM });
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [expandedId, setExpanded]     = useState<string | null>(null);
  const [generatingAudio, setGenAudio] = useState<string | null>(null); // clip id being processed

  // Auth guard — redirect non-admins immediately
  useEffect(() => {
    if (userId && userId !== ADMIN_UID) router.replace("/chat");
  }, [userId, router]);

  const fetchClips = async () => {
    setLoading(true);
    try {
      const res = await feedApi.adminList(statusFilter);
      setClips(res.data.clips || []);
    } catch {
      setError("No se pudieron cargar los clips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (userId === ADMIN_UID) fetchClips(); }, [statusFilter, userId]); // eslint-disable-line

  const openEdit = (clip: Clip) => {
    setEditingId(clip.id);
    setForm({
      title:              clip.title,
      description:        clip.description,
      video_url:          clip.video_url,
      thumbnail_url:      clip.thumbnail_url,
      speaker:            clip.speaker,
      tags:               clip.tags,
      language:           clip.language,
      translated_caption: clip.translated_caption,
      caption_en:         clip.caption_en || "",
      duration_sec:       clip.duration_sec,
    });
    setError(null);
    setFormOpen(true);
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !form.video_url.trim()) {
      setError("Título y URL del video son obligatorios");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await feedApi.adminUpdate(editingId, { ...form });
      } else {
        await feedApi.adminCreate({ ...form });
      }
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      setFormOpen(false);
      fetchClips();
    } catch (e) {
      apiError(e, editingId ? "No se pudo guardar" : "No se pudo crear el clip");
    } finally {
      setSaving(false);
    }
  };

  const apiError = (e: unknown, fallback: string) => {
    const msg =
      (e as { response?: { data?: { detail?: string; message?: string } } })
        ?.response?.data?.detail ||
      (e as { response?: { data?: { detail?: string; message?: string } } })
        ?.response?.data?.message ||
      (e as { message?: string })?.message ||
      fallback;
    setError(msg);
  };

  const handlePublish = async (id: string) => {
    try {
      await feedApi.adminUpdate(id, { status: "published" });
      fetchClips();
    } catch (e) { apiError(e, "Error al publicar"); }
  };

  const handleArchive = async (id: string) => {
    try {
      await feedApi.adminUpdate(id, { status: "archived" });
      fetchClips();
    } catch (e) { apiError(e, "Error al archivar"); }
  };

  const handleUnpublish = async (id: string) => {
    try {
      await feedApi.adminUpdate(id, { status: "draft" });
      fetchClips();
    } catch (e) { apiError(e, "Error al despublicar"); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este clip permanentemente?")) return;
    try {
      await feedApi.adminDelete(id);
      fetchClips();
    } catch (e) { apiError(e, "Error al eliminar"); }
  };

  const handleGenerateAudio = async (id: string) => {
    setGenAudio(id);
    setError(null);
    try {
      await feedApi.generateAudio(id);
      fetchClips();
    } catch (e) { apiError(e, "Error generando análisis de voz"); }
    finally { setGenAudio(null); }
  };

  const toggleTag = (t: string) =>
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
    }));

  if (!userId) return null;
  if (userId !== ADMIN_UID) return null;

  const STATUS_COLORS: Record<string, string> = {
    draft:     "#f59e0b",
    published: "#22c55e",
    archived:  "#6b7280",
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-6" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black">🎬 Admin — Feed de Videos</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Solo visible para ti · diego.arria19@gmail.com
            </p>
          </div>
          <button
            onClick={() => { setFormOpen(true); setError(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm text-white"
            style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
            <Plus className="w-4 h-4" /> Nuevo clip
          </button>
        </div>

        {/* Status filter tabs */}
        <div className="flex rounded-xl p-1" style={{ background: "var(--raised)" }}>
          {(["draft", "published", "archived"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
                    className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
                    style={{
                      background: statusFilter === s ? "var(--card)" : "transparent",
                      color:      statusFilter === s ? STATUS_COLORS[s] : "var(--muted)",
                    }}>
              {s === "draft" ? "📝 Borradores" : s === "published" ? "✅ Publicados" : "📦 Archivados"}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-center justify-between p-3 rounded-xl text-sm"
               style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Clips list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-l)" }} />
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border"
               style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <p className="text-4xl mb-3">🎬</p>
            <p className="font-semibold" style={{ color: "var(--text)" }}>
              No hay clips en "{statusFilter}"
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              {statusFilter === "draft" ? 'Crea un clip con "Nuevo clip" arriba' : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {clips.map((clip) => (
              <div key={clip.id} className="rounded-2xl border overflow-hidden"
                   style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                {/* Clip header */}
                <div className="flex items-start gap-4 p-4">
                  {/* Thumbnail */}
                  <div className="w-20 h-14 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
                       style={{ background: "var(--raised)" }}>
                    {clip.thumbnail_url
                      ? <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      : <span className="text-2xl">🎬</span>}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-sm" style={{ color: "var(--text)" }}>{clip.title}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                          {clip.speaker} · {clip.duration_sec ? `${clip.duration_sec}s` : "duración desconocida"}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                            style={{ background: `${STATUS_COLORS[clip.status]}20`, color: STATUS_COLORS[clip.status] }}>
                        {clip.status}
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px]" style={{ color: "var(--dim)" }}>👁 {clip.view_count}</span>
                      <span className="text-[10px]" style={{ color: "var(--dim)" }}>❤️ {clip.like_count}</span>
                      <span className="text-[10px]" style={{ color: "var(--dim)" }}>💬 {clip.comment_count}</span>
                      {clip.tags.slice(0, 2).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full"
                              style={{ background: "var(--raised)", color: "var(--muted)" }}>#{t}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 px-4 pb-4">
                  {clip.status === "draft" && (
                    <button onClick={() => handlePublish(clip.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                      <Check className="w-3 h-3" /> Publicar
                    </button>
                  )}
                  {clip.status === "published" && (
                    <button onClick={() => handleUnpublish(clip.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                      <EyeOff className="w-3 h-3" /> Despublicar
                    </button>
                  )}
                  {clip.status !== "archived" && (
                    <button onClick={() => handleArchive(clip.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                            style={{ background: "rgba(107,114,128,0.15)", color: "#9ca3af" }}>
                      <Archive className="w-3 h-3" /> Archivar
                    </button>
                  )}
                  {clip.status === "archived" && (
                    <button onClick={() => handlePublish(clip.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>
                      <Eye className="w-3 h-3" /> Republicar
                    </button>
                  )}
                  <button onClick={() => handleDelete(clip.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                    <Trash2 className="w-3 h-3" /> Eliminar
                  </button>

                  {/* Edit */}
                  <button onClick={() => openEdit(clip)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                          style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                    <Pencil className="w-3 h-3" /> Editar
                  </button>

                  {/* Generate audio */}
                  <button
                    onClick={() => handleGenerateAudio(clip.id)}
                    disabled={generatingAudio === clip.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
                    style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
                    {generatingAudio === clip.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Mic className="w-3 h-3" />}
                    {generatingAudio === clip.id ? "Generando..." : clip.pre_audio_url ? "Re-generar voz" : "Generar voz IA"}
                  </button>

                  {/* Expand to see caption / URL */}
                  <button onClick={() => setExpanded(expandedId === clip.id ? null : clip.id)}
                          className="ml-auto flex items-center gap-1 text-xs"
                          style={{ color: "var(--muted)" }}>
                    {expandedId === clip.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    Detalles
                  </button>
                </div>

                {expandedId === clip.id && (
                  <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: "var(--border)" }}>
                    <div className="pt-3">
                      <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>VIDEO URL</p>
                      <p className="text-xs break-all" style={{ color: "var(--sub)" }}>{clip.video_url}</p>
                    </div>
                    {clip.description && (
                      <div>
                        <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>DESCRIPCIÓN</p>
                        <p className="text-xs" style={{ color: "var(--sub)" }}>{clip.description}</p>
                      </div>
                    )}
                    {clip.translated_caption && (
                      <div>
                        <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>CAPTION EN ESPAÑOL</p>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{clip.translated_caption}</p>
                      </div>
                    )}

                    {/* AI voice analysis */}
                    {(clip.pre_text || clip.post_text) && (
                      <div className="rounded-xl p-3 space-y-3"
                           style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
                        <p className="text-[10px] font-bold" style={{ color: "#a78bfa" }}>🎙️ ANÁLISIS IA EN VOZ</p>
                        {clip.pre_text && (
                          <div>
                            <p className="text-[10px] font-semibold mb-1" style={{ color: "rgba(167,139,250,0.7)" }}>PRE-VIDEO</p>
                            <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{clip.pre_text}</p>
                            {clip.pre_audio_url && (
                              <audio controls src={clip.pre_audio_url} className="w-full mt-2 h-8"
                                     style={{ filter: "invert(0.8) hue-rotate(240deg)" }} />
                            )}
                          </div>
                        )}
                        {clip.post_text && (
                          <div>
                            <p className="text-[10px] font-semibold mb-1" style={{ color: "rgba(167,139,250,0.7)" }}>POST-VIDEO</p>
                            <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{clip.post_text}</p>
                            {clip.post_audio_url && (
                              <audio controls src={clip.post_audio_url} className="w-full mt-2 h-8"
                                     style={{ filter: "invert(0.8) hue-rotate(240deg)" }} />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create clip modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
             style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-lg rounded-2xl border my-4"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-bold" style={{ color: "var(--text)" }}>
                  {editingId ? "✏️ Editar clip" : "Nuevo clip"}
                </p>
                <button onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
                  <X className="w-4 h-4" style={{ color: "var(--muted)" }} />
                </button>
              </div>

              {error && (
                <p className="text-xs p-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                  {error}
                </p>
              )}

              {/* Title */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  TÍTULO *
                </label>
                <input
                  type="text"
                  placeholder="Ej: Warren Buffett explica el margen de seguridad"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              {/* Video URL */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  URL DEL VIDEO * (Cloudflare Stream, S3, YouTube embed, etc.)
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.video_url}
                  onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              {/* Thumbnail URL */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  THUMBNAIL URL (opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={form.thumbnail_url}
                  onChange={(e) => setForm((f) => ({ ...f, thumbnail_url: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              {/* Speaker + duration row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                    SPEAKER *
                  </label>
                  <select
                    value={form.speaker}
                    onChange={(e) => setForm((f) => ({ ...f, speaker: e.target.value }))}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}>
                    {SPEAKERS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                    DURACIÓN (segundos)
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="60"
                    value={form.duration_sec || ""}
                    onChange={(e) => setForm((f) => ({ ...f, duration_sec: parseInt(e.target.value) || 0 }))}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-[10px] font-bold block mb-1.5" style={{ color: "var(--muted)" }}>
                  TAGS (selecciona los que apliquen)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_OPTIONS.map((t) => (
                    <button key={t} type="button" onClick={() => toggleTag(t)}
                            className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                            style={{
                              background: form.tags.includes(t) ? "var(--accent-l)" : "var(--raised)",
                              color: form.tags.includes(t) ? "#000" : "var(--sub)",
                            }}>
                      #{t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  DESCRIPCIÓN (opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Breve descripción del clip..."
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              {/* Caption ES */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  🇪🇸 SUBTÍTULOS EN ESPAÑOL
                </label>
                <textarea
                  rows={3}
                  placeholder="Transcripción traducida al español..."
                  value={form.translated_caption}
                  onChange={(e) => setForm((f) => ({ ...f, translated_caption: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              {/* Caption EN */}
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: "var(--muted)" }}>
                  🇺🇸 SUBTÍTULOS EN INGLÉS (original)
                </label>
                <textarea
                  rows={3}
                  placeholder="Original English transcript..."
                  value={form.caption_en}
                  onChange={(e) => setForm((f) => ({ ...f, caption_en: e.target.value }))}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setFormOpen(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
                        style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                  Cancelar
                </button>
                <button onClick={handleCreate} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60"
                        style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
                  {saving
                    ? <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                    : editingId ? "Guardar cambios" : "Guardar borrador"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
