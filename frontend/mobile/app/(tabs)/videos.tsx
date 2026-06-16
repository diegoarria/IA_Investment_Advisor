import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Dimensions, ScrollView, Modal, Share, KeyboardAvoidingView, Platform,
  PanResponder, Animated, Image, RefreshControl, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Video, ResizeMode, Audio } from "expo-av";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { feedApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";

const { width: W, height: H } = Dimensions.get("window");

const SPEAKERS = [
  "Todos", "Warren Buffett", "Charlie Munger", "Ray Dalio",
  "Peter Lynch", "Morgan Housel", "Benjamin Graham",
  "Howard Marks", "Bill Ackman", "Michael Burry", "Nassim Taleb",
];

const TAGS = [
  "Todos", "value investing", "macro", "mindset", "riesgo",
  "psicología", "deuda", "diversificación", "largo plazo", "crisis", "análisis",
];

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

function getCaptionChunks(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 7) {
    chunks.push(words.slice(i, i + 7).join(" "));
  }
  return chunks;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Single clip card ──────────────────────────────────────────────────────────
function ClipCard({
  clip,
  isActive,
  colors,
  onLike,
  onSave,
  cardHeight,
}: {
  clip: Clip;
  isActive: boolean;
  colors: Colors;
  onLike: (id: string) => void;
  onSave: (id: string) => void;
  cardHeight: number;
}) {
  const videoRef = useRef<Video>(null);
  const myProfile = useAppStore((s) => s.profile);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [captionLang, setCaptionLang] = useState<"off" | "es" | "en">("off");
  const [showCaptionPicker, setShowCaptionPicker] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentCount, setCommentCount] = useState(clip.comment_count ?? 0);
  const [commentText, setCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [replyText, setReplyText] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("user_id").then((id) => setMyUserId(id ?? null)).catch(() => {});
  }, []);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tapIcon, setTapIcon] = useState<"play" | "pause" | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Pre/post AI audio
  const [phase, setPhase] = useState<"pre" | "video" | "post" | "idle">("idle");
  const [audioRemaining, setAudioRemaining] = useState(0);
  const preSound  = useRef<Audio.Sound | null>(null);
  const postSound = useRef<Audio.Sound | null>(null);
  const activeRef = useRef(false);

  // Animated sound bars (5 bars, staggered)
  const barScales = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;

  // Animate bars during pre/post phase
  useEffect(() => {
    if (phase !== "pre" && phase !== "post") {
      barScales.forEach((s) => { s.stopAnimation(); s.setValue(0.3); });
      return;
    }
    const loops = barScales.map((scale, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(scale, { toValue: 1,   duration: 300 + i * 60, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.2, duration: 300 + i * 60, useNativeDriver: true }),
        ])
      )
    );
    const starts = loops.map((loop, i) => {
      const id = setTimeout(() => loop.start(), i * 110);
      return id;
    });
    return () => {
      starts.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [phase]);

  // Cleanup sounds on unmount
  useEffect(() => {
    return () => {
      preSound.current?.unloadAsync().catch(() => {});
      postSound.current?.unloadAsync().catch(() => {});
      clearTimeout(tapTimer.current);
    };
  }, []);

  const skipAudio = () => {
    if (phase === "pre") {
      preSound.current?.stopAsync().catch(() => {});
      preSound.current?.unloadAsync().catch(() => {});
      preSound.current = null;
      setPhase("video");
      setAudioRemaining(0);
      setIsPlaying(true);
    } else if (phase === "post") {
      postSound.current?.stopAsync().catch(() => {});
      postSound.current?.unloadAsync().catch(() => {});
      postSound.current = null;
      setPhase("video");
      setAudioRemaining(0);
      setProgress(0);
      setIsPlaying(true);
      videoRef.current?.setPositionAsync(0).catch(() => {});
    }
  };

  const togglePlay = () => {
    if (phase !== "video") return;
    const willPlay = !isPlaying;
    setIsPlaying(willPlay);
    setTapIcon(willPlay ? "play" : "pause");
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapIcon(null), 700);
  };

  // Progress bar — use refs inside PanResponder to avoid stale closures
  const [progress, setProgress] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const durationRef = useRef(0);
  const barWidthRef = useRef(0);

  const doSeek = useCallback((locationX: number) => {
    if (barWidthRef.current <= 0 || !videoRef.current || durationRef.current <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / barWidthRef.current));
    setProgress(ratio);
    videoRef.current.setPositionAsync(ratio * durationRef.current).catch(() => {});
  }, []);

  const progressPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => { setIsSeeking(true);  doSeek(e.nativeEvent.locationX); },
      onPanResponderMove: (e) =>  { doSeek(e.nativeEvent.locationX); },
      onPanResponderRelease:   () => setIsSeeking(false),
      onPanResponderTerminate: () => setIsSeeking(false),
    })
  ).current;

  useEffect(() => {
    activeRef.current = isActive;

    if (!isActive) {
      preSound.current?.stopAsync().catch(() => {});
      preSound.current?.unloadAsync().catch(() => {});
      preSound.current = null;
      postSound.current?.stopAsync().catch(() => {});
      postSound.current?.unloadAsync().catch(() => {});
      postSound.current = null;
      setIsPlaying(false);
      setPhase("idle");
      setAudioRemaining(0);
      setTapIcon(null);
      return;
    }

    if (!clip.pre_audio_url) {
      setPhase("video");
      setIsPlaying(true);
      return;
    }

    setPhase("pre");
    let cancelled = false;
    (async () => {
      try {
        if (preSound.current) {
          await preSound.current.stopAsync().catch(() => {});
          await preSound.current.unloadAsync().catch(() => {});
          preSound.current = null;
        }
        if (cancelled || !activeRef.current) return;

        const { sound } = await Audio.Sound.createAsync(
          { uri: clip.pre_audio_url! },
          { shouldPlay: true, progressUpdateIntervalMillis: 1000 }
        );
        if (cancelled || !activeRef.current) { sound.unloadAsync(); return; }

        preSound.current = sound;
        sound.setOnPlaybackStatusUpdate((s) => {
          if (!s.isLoaded || !activeRef.current) return;
          if (s.durationMillis) {
            const rem = Math.ceil((s.durationMillis - s.positionMillis) / 1000);
            setAudioRemaining((prev) => (prev !== rem ? rem : prev));
          }
          if (s.didJustFinish) {
            setPhase("video");
            setAudioRemaining(0);
            setIsPlaying(true);
          }
        });
      } catch {
        if (cancelled || !activeRef.current) return;
        setPhase("video");
        setIsPlaying(true);
      }
    })();

    return () => { cancelled = true; };
  }, [isActive]);

  const loadComments = async () => {
    setCommentsLoading(true);
    try {
      const res = await feedApi.getComments(clip.id);
      const fetched: Comment[] = res.data?.comments ?? [];
      setComments(fetched);
      const total = fetched.reduce((sum, c) => sum + 1 + (c.replies?.length ?? 0), 0);
      setCommentCount(total);
    } catch {}
    setCommentsLoading(false);
  };

  const openComments = () => {
    setCommentsOpen(true);
    loadComments();
  };

  const postComment = async (text?: string, parentId?: string) => {
    const body = (text ?? commentText).trim();
    if (!body) return;
    const tempId = `opt-${Date.now()}`;
    const optimistic: Comment = {
      id: tempId,
      user_id: myUserId ?? "",
      text: body,
      created_at: new Date().toISOString(),
      user_profiles: { name: myProfile?.name ?? "Tú" },
      replies: [],
    };
    if (parentId) {
      setComments((prev) => prev.map((c) =>
        c.id === parentId ? { ...c, replies: [...(c.replies ?? []), optimistic] } : c
      ));
      setReplyText("");
      setReplyingTo(null);
    } else {
      setComments((prev) => [...prev, optimistic]);
      setCommentText("");
    }
    setCommentCount((n) => n + 1);
    try {
      const res = await feedApi.postComment(clip.id, body, parentId);
      const realId: string | undefined = res.data?.comment?.id;
      if (realId) {
        if (parentId) {
          setComments((prev) => prev.map((c) =>
            c.id === parentId
              ? { ...c, replies: (c.replies ?? []).map((r) => r.id === tempId ? { ...r, id: realId, user_id: myUserId ?? "" } : r) }
              : c
          ));
        } else {
          setComments((prev) => prev.map((c) => c.id === tempId ? { ...c, id: realId, user_id: myUserId ?? "" } : c));
        }
      }
    } catch {
      if (parentId) {
        setComments((prev) => prev.map((c) =>
          c.id === parentId ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== tempId) } : c
        ));
      } else {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
      }
      setCommentCount((n) => Math.max(0, n - 1));
    }
  };

  const deleteComment = async (commentId: string, parentId?: string) => {
    if (parentId) {
      setComments((prev) => prev.map((c) =>
        c.id === parentId ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== commentId) } : c
      ));
    } else {
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    }
    setCommentCount((n) => Math.max(0, n - 1));
    try {
      await feedApi.deleteComment(clip.id, commentId);
    } catch {
      loadComments();
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({ message: `${clip.title} — ${clip.speaker} | Nuvos AI` });
    } catch {}
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    if (clip.video_url.includes(".m3u8")) {
      Alert.alert("No disponible", "Este video es streaming (HLS) y no puede descargarse directamente.");
      return;
    }
    setDownloading(true);
    try {
      const token = await SecureStore.getItemAsync("access_token");
      const filename = `${clip.title.replace(/[^a-z0-9 ]/gi, "_").slice(0, 60)}.mp4`;
      const localUri = FileSystem.cacheDirectory + filename;
      const dlResult = await FileSystem.downloadAsync(
        feedApi.downloadClipUrl(clip.id),
        localUri,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {}
      );
      if (dlResult.status !== 200) throw new Error("download failed");
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dlResult.uri, { mimeType: "video/mp4", dialogTitle: "Guardar video" });
      } else {
        Alert.alert("Descargado", `Guardado en: ${dlResult.uri}`);
      }
    } catch {
      Alert.alert("Error", "No se pudo descargar el video. Intenta de nuevo.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <View style={[styles.card, { width: W, height: cardHeight }]}>
      {/* Video */}
      <Video
        ref={videoRef}
        source={{ uri: clip.video_url }}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        isLooping={!clip.post_audio_url}
        shouldPlay={isPlaying && phase === "video"}
        isMuted={isMuted}
        useNativeControls={false}
        onPlaybackStatusUpdate={(status) => {
          if (!status.isLoaded) return;
          if (status.durationMillis) durationRef.current = status.durationMillis;
          if (!isSeeking && status.durationMillis) {
            setProgress(status.positionMillis / status.durationMillis);
          }
          if (status.didJustFinish && clip.post_audio_url) {
            setPhase("post");
            setIsPlaying(false);
            setProgress(0);
            (async () => {
              try {
                if (postSound.current) {
                  await postSound.current.stopAsync().catch(() => {});
                  await postSound.current.unloadAsync().catch(() => {});
                  postSound.current = null;
                }
                if (!activeRef.current) return;

                const { sound } = await Audio.Sound.createAsync(
                  { uri: clip.post_audio_url! },
                  { shouldPlay: true, progressUpdateIntervalMillis: 1000 }
                );
                if (!activeRef.current) { sound.unloadAsync(); return; }

                postSound.current = sound;
                sound.setOnPlaybackStatusUpdate((s) => {
                  if (!s.isLoaded || !activeRef.current) return;
                  if (s.durationMillis) {
                    const rem = Math.ceil((s.durationMillis - s.positionMillis) / 1000);
                    setAudioRemaining((prev) => (prev !== rem ? rem : prev));
                  }
                  if (s.didJustFinish) {
                    setPhase("video");
                    setAudioRemaining(0);
                    setProgress(0);
                    setIsPlaying(true);
                    videoRef.current?.setPositionAsync(0).catch(() => {});
                  }
                });
              } catch {
                if (!activeRef.current) return;
                setPhase("video");
                setProgress(0);
                setIsPlaying(true);
                videoRef.current?.setPositionAsync(0).catch(() => {});
              }
            })();
          }
        }}
      />

      {/* Tap-to-toggle-play zone */}
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={togglePlay}
      />

      {/* Tap flash icon */}
      {tapIcon !== null && (
        <View style={pStyles.tapFlashWrap} pointerEvents="none">
          <View style={pStyles.tapFlashCircle}>
            <Ionicons
              name={tapIcon === "play" ? "play" : "pause"}
              size={40}
              color="white"
            />
          </View>
        </View>
      )}

      {/* Mute toggle */}
      <TouchableOpacity style={styles.muteBtn} onPress={() => setIsMuted((m) => !m)}>
        <Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={18} color="white" />
      </TouchableOpacity>

      {/* AI pre/post audio badge */}
      {(phase === "pre" || phase === "post") && (
        <View style={phStyles.badge} pointerEvents="none">
          <View style={phStyles.bars}>
            {barScales.map((scale, i) => (
              <Animated.View
                key={i}
                style={[phStyles.bar, { transform: [{ scaleY: scale }] }]}
              />
            ))}
          </View>
          <Text style={phStyles.label}>
            {phase === "pre" ? "Introducción IA" : "Análisis IA"}
          </Text>
          {audioRemaining > 0 && (
            <Text style={phStyles.timer}>{audioRemaining}s</Text>
          )}
        </View>
      )}

      {/* Skip AI audio button */}
      {(phase === "pre" || phase === "post") && (
        <TouchableOpacity style={phStyles.skipBtn} onPress={skipAudio} activeOpacity={0.8}>
          <Text style={phStyles.skipText}>Saltar</Text>
          <Ionicons name="play-skip-forward" size={13} color="white" />
        </TouchableOpacity>
      )}

      {/* Dark overlay at bottom */}
      <View style={styles.overlay} />

      {/* Speaker badge */}
      <View style={styles.speakerBadge}>
        <Text style={styles.speakerText}>{clip.speaker}</Text>
      </View>

      {/* Duration */}
      <View style={styles.durationBadge}>
        <Text style={styles.durationText}>{formatDuration(clip.duration_sec)}</Text>
      </View>

      {/* Synchronized caption overlay */}
      {captionLang !== "off" && phase === "video" && (() => {
        const captionText = captionLang === "es"
          ? (clip.translated_caption || "")
          : (clip.caption_en || "");
        const chunks = getCaptionChunks(captionText);
        const chunkIndex = chunks.length > 0
          ? Math.min(Math.floor(progress * chunks.length), chunks.length - 1)
          : 0;
        const currentCaption = chunks[chunkIndex] || "";
        return currentCaption ? (
          <View pointerEvents="none" style={capStyles.wrap}>
            <Text style={capStyles.text}>{currentCaption}</Text>
          </View>
        ) : null;
      })()}

      {/* Bottom info */}
      <View style={styles.bottomInfo}>
        <Text style={styles.clipTitle} numberOfLines={2}>{clip.title}</Text>
        {clip.tags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
            {clip.tags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Right actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => onLike(clip.id)}>
          <Ionicons
            name={clip.liked ? "heart" : "heart-outline"}
            size={28}
            color={clip.liked ? "#ef4444" : "white"}
          />
          <Text style={styles.actionLabel}>{formatCount(clip.like_count)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={openComments}>
          <Ionicons name="chatbubble-outline" size={24} color="white" />
          <Text style={styles.actionLabel}>{formatCount(commentCount)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={() => onSave(clip.id)}>
          <Ionicons
            name={clip.saved ? "bookmark" : "bookmark-outline"}
            size={26}
            color={clip.saved ? "#f59e0b" : "white"}
          />
          <Text style={styles.actionLabel}>{clip.saved ? "Guardado" : "Guardar"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleShare}>
          <Ionicons name="share-social-outline" size={26} color="white" />
          <Text style={styles.actionLabel}>Compartir</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={handleDownload} disabled={downloading}>
          <Ionicons name={downloading ? "hourglass-outline" : "download-outline"} size={26} color={downloading ? "rgba(255,255,255,0.5)" : "white"} />
          <Text style={styles.actionLabel}>{downloading ? "..." : "Bajar"}</Text>
        </TouchableOpacity>

        {/* CC captions button */}
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => setShowCaptionPicker((v) => !v)}
        >
          <View style={[ccStyles.ccBadge, captionLang !== "off" && ccStyles.ccBadgeActive]}>
            <Ionicons
              name="text-outline"
              size={18}
              color={captionLang !== "off" ? "#a78bfa" : "white"}
            />
          </View>
          <Text style={styles.actionLabel}>
            {captionLang === "off" ? "CC" : captionLang === "es" ? "ES" : "EN"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="eye-outline" size={22} color="rgba(255,255,255,0.7)" />
          <Text style={styles.actionLabel}>{formatCount(clip.view_count)}</Text>
        </TouchableOpacity>
      </View>

      {/* CC lang picker */}
      {showCaptionPicker && (
        <View style={ccStyles.picker}>
          {(["off", "es", "en"] as const).map((lang) => (
            <TouchableOpacity
              key={lang}
              style={[ccStyles.pickerOption, captionLang === lang && ccStyles.pickerOptionActive]}
              onPress={() => { setCaptionLang(lang); setShowCaptionPicker(false); }}
            >
              <Text style={[ccStyles.pickerText, captionLang === lang && { color: "#a78bfa" }]}>
                {lang === "off" ? "Apagado" : lang === "es" ? "🇪🇸 Español" : "🇺🇸 English"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Progress bar */}
      <View
        style={pStyles.bar}
        onLayout={(e) => { barWidthRef.current = e.nativeEvent.layout.width; }}
        {...progressPan.panHandlers}
      >
        <View style={pStyles.times}>
          <Text style={pStyles.time}>
            {formatDuration(Math.floor((progress * durationRef.current) / 1000))}
          </Text>
          <Text style={pStyles.time}>{formatDuration(clip.duration_sec)}</Text>
        </View>
        <View style={pStyles.track}>
          <View style={[pStyles.fill, { width: `${(progress * 100).toFixed(2)}%` as any }]}>
            <View style={[pStyles.thumb, isSeeking && pStyles.thumbActive]} />
          </View>
        </View>
      </View>

      {/* Comments modal */}
      <Modal visible={commentsOpen} transparent animationType="slide" onRequestClose={() => { setCommentsOpen(false); setReplyingTo(null); setReplyText(""); }}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)" }}
          activeOpacity={1}
          onPress={() => { setCommentsOpen(false); setReplyingTo(null); setReplyText(""); }}
        />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
          <View style={{
            height: H * 0.62,
            backgroundColor: colors.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: 24,
            flexDirection: "column",
          }}>
            {/* Handle */}
            <View style={[styles.captionHandle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={cmtStyles.header}>
              <Text style={[cmtStyles.headerTitle, { color: colors.text }]}>
                Comentarios ({commentCount})
              </Text>
              <TouchableOpacity onPress={() => { setCommentsOpen(false); setReplyingTo(null); setReplyText(""); }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* List */}
            <ScrollView style={{ flex: 1, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {commentsLoading ? (
                <ActivityIndicator color={colors.accentLight} style={{ marginTop: 24 }} />
              ) : comments.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 32 }}>
                  <Ionicons name="chatbubbles-outline" size={32} color={colors.textDim} />
                  <Text style={[cmtStyles.body, { color: colors.textMuted, marginTop: 8 }]}>
                    Sé el primero en comentar
                  </Text>
                </View>
              ) : (
                comments.map((c) => {
                  const cName = c.user_profiles?.name ?? "Usuario";
                  const isMyComment = c.user_id === myUserId;
                  return (
                    <View key={c.id} style={{ marginBottom: 16 }}>
                      {/* Top-level comment */}
                      <View style={cmtStyles.row}>
                        {c.user_profiles?.avatar_url ? (
                          <Image source={{ uri: c.user_profiles.avatar_url }} style={cmtStyles.avatarImg} />
                        ) : (
                          <View style={[cmtStyles.avatar, { backgroundColor: colors.accent }]}>
                            <Text style={cmtStyles.avatarLetter}>{cName[0].toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <View style={cmtStyles.nameRow}>
                            <Text style={[cmtStyles.name, { color: colors.text }]}>{cName}</Text>
                            <Text style={[cmtStyles.date, { color: colors.textDim }]}>
                              {new Date(c.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                            </Text>
                            {isMyComment && (
                              <TouchableOpacity onPress={() => deleteComment(c.id)} style={cmtStyles.deleteBtn}>
                                <Ionicons name="trash-outline" size={13} color={colors.textDim} />
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={[cmtStyles.body, { color: colors.textSub }]}>{c.text}</Text>
                          <TouchableOpacity
                            onPress={() => setReplyingTo(replyingTo?.id === c.id ? null : { id: c.id, name: cName })}
                            style={{ marginTop: 4 }}
                          >
                            <Text style={[cmtStyles.replyBtn, { color: replyingTo?.id === c.id ? colors.accentLight : colors.textMuted }]}>
                              Responder
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Replies thread */}
                      {(c.replies ?? []).length > 0 && (
                        <View style={[cmtStyles.repliesThread, { borderLeftColor: colors.border }]}>
                          {(c.replies ?? []).map((r) => {
                            const rName = r.user_profiles?.name ?? "Usuario";
                            const isMyReply = r.user_id === myUserId;
                            return (
                              <View key={r.id} style={cmtStyles.row}>
                                {r.user_profiles?.avatar_url ? (
                                  <Image source={{ uri: r.user_profiles.avatar_url }} style={cmtStyles.avatarImgSm} />
                                ) : (
                                  <View style={[cmtStyles.avatarSm, { backgroundColor: colors.accent }]}>
                                    <Text style={cmtStyles.avatarLetterSm}>{rName[0].toUpperCase()}</Text>
                                  </View>
                                )}
                                <View style={{ flex: 1 }}>
                                  <View style={cmtStyles.nameRow}>
                                    <Text style={[cmtStyles.nameSm, { color: colors.text }]}>{rName}</Text>
                                    <Text style={[cmtStyles.date, { color: colors.textDim }]}>
                                      {new Date(r.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
                                    </Text>
                                    {isMyReply && (
                                      <TouchableOpacity onPress={() => deleteComment(r.id, c.id)} style={cmtStyles.deleteBtn}>
                                        <Ionicons name="trash-outline" size={12} color={colors.textDim} />
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                  <Text style={[cmtStyles.bodySm, { color: colors.textSub }]}>{r.text}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}

                      {/* Inline reply input */}
                      {replyingTo?.id === c.id && (
                        <View style={[cmtStyles.replyInput, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                          <TextInput
                            autoFocus
                            style={[cmtStyles.replyTextField, { color: colors.text }]}
                            placeholder={`Responder a ${replyingTo.name}…`}
                            placeholderTextColor={colors.textDim}
                            value={replyText}
                            onChangeText={setReplyText}
                            onSubmitEditing={() => postComment(replyText, c.id)}
                            returnKeyType="send"
                            maxLength={300}
                          />
                          <TouchableOpacity onPress={() => postComment(replyText, c.id)} disabled={!replyText.trim()}>
                            <Ionicons name="send" size={18} color={replyText.trim() ? colors.accentLight : colors.textDim} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* Main comment input */}
            <View style={[cmtStyles.inputRow, { borderTopColor: colors.border }]}>
              <TextInput
                style={[styles.commentInput, { backgroundColor: colors.bg, color: colors.text, borderColor: colors.border }]}
                placeholder="Escribe un comentario..."
                placeholderTextColor={colors.textDim}
                value={commentText}
                onChangeText={setCommentText}
                onSubmitEditing={() => postComment()}
                returnKeyType="send"
                maxLength={300}
              />
              <TouchableOpacity onPress={() => postComment()} disabled={!commentText.trim()}>
                <Ionicons name="send" size={22} color={commentText.trim() ? colors.accentLight : colors.textDim} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function VideosScreen() {
  const { colors } = useTheme();

  const [clips, setClips]             = useState<Clip[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor]   = useState<number | null>(0);
  const [activeIndex, setActiveIndex] = useState(0);

  const [filterOpen, setFilterOpen]   = useState(false);
  const [speaker, setSpeaker]         = useState<string | null>(null);
  const [tag, setTag]                 = useState<string | null>(null);
  const [sort, setSort]               = useState<"recent" | "trending" | "random">("recent");
  const [refreshing, setRefreshing]   = useState(false);

  const flatRef = useRef<FlatList>(null);
  const [cardHeight, setCardHeight] = useState(H);

  const seenIdsRef = useRef<Set<string>>(new Set());

  // Saved clips panel
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedClips, setSavedClips] = useState<Clip[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const loadSaved = async () => {
    setSavedLoading(true);
    try {
      const res = await feedApi.getSaved();
      setSavedClips(res.data.clips || []);
    } catch {}
    setSavedLoading(false);
  };

  const handleUnsave = (id: string) => {
    setSavedClips((prev) => prev.filter((c) => c.id !== id));
    feedApi.saveClip(id).catch(() => {}); // toggle removes
    // also update main feed
    setClips((prev) => prev.map((c) => c.id === id ? { ...c, saved: false } : c));
  };

  const handleDownloadSaved = async (clip: Clip) => {
    if (downloadingId) return;
    if (clip.video_url.includes(".m3u8")) {
      Alert.alert("No disponible", "Este video es streaming y no puede descargarse.");
      return;
    }
    setDownloadingId(clip.id);
    try {
      const token = await SecureStore.getItemAsync("access_token");
      const filename = `${clip.title.replace(/[^a-z0-9 ]/gi, "_").slice(0, 60)}.mp4`;
      const localUri = FileSystem.cacheDirectory + filename;
      const dlResult = await FileSystem.downloadAsync(
        feedApi.downloadClipUrl(clip.id),
        localUri,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {}
      );
      if (dlResult.status !== 200) throw new Error();
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dlResult.uri, { mimeType: "video/mp4", dialogTitle: "Guardar video" });
      }
    } catch {
      Alert.alert("Error", "No se pudo descargar. Intenta de nuevo.");
    } finally {
      setDownloadingId(null);
    }
  };

  const loadClips = useCallback(async (reset = false, overrideSort?: "recent" | "trending" | "random") => {
    const cursor = reset ? 0 : (nextCursor ?? 0);
    if (!reset && nextCursor === null) return;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const res = await feedApi.getClips({
        cursor,
        speaker: speaker ?? undefined,
        tag: tag ?? undefined,
        sort: overrideSort ?? sort,
      });
      let newClips: Clip[] = res.data.clips ?? [];
      // Filter already-seen clips; if all seen (full cycle), reset history
      let unseen = newClips.filter((c) => !seenIdsRef.current.has(c.id));
      if (unseen.length === 0 && newClips.length > 0) {
        seenIdsRef.current.clear();
        unseen = newClips;
      }
      unseen.forEach((c) => seenIdsRef.current.add(c.id));
      setClips((prev) => reset ? unseen : [...prev, ...unseen]);
      setNextCursor(res.data.next_cursor ?? null);
      if (reset) setActiveIndex(0);
    } catch {}
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
  }, [speaker, tag, sort, nextCursor]);

  useEffect(() => { loadClips(true); }, [speaker, tag, sort]); // eslint-disable-line

  const handlePullRefresh = useCallback(() => {
    setRefreshing(true);
    setSort("random");
    setNextCursor(0);
    loadClips(true, "random");
  }, [loadClips]);

  // iOS: allow audio even when silent switch is on
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
  }, []);

  // Pause everything when screen loses focus
  useFocusEffect(useCallback(() => {
    return () => setActiveIndex(-1);
  }, []));

  const handleLike = async (id: string) => {
    const prev = clips.find((c) => c.id === id);
    if (!prev) return;
    setClips((cs) => cs.map((c) =>
      c.id === id
        ? { ...c, liked: !c.liked, like_count: c.liked ? c.like_count - 1 : c.like_count + 1 }
        : c
    ));
    feedApi.likeClip(id).catch(() => {
      // rollback on error
      setClips((cs) => cs.map((c) => c.id === id ? { ...c, liked: prev.liked, like_count: prev.like_count } : c));
    });
  };

  const handleSave = async (id: string) => {
    setClips((prev) => prev.map((c) => c.id === id ? { ...c, saved: !c.saved } : c));
    feedApi.saveClip(id).catch(() => {});
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const idx = viewableItems[0].index ?? 0;
      setActiveIndex(idx);
      // Load more when near end
      setClips((prev) => {
        if (idx >= prev.length - 3) {
          setNextCursor((cur) => {
            if (cur !== null) loadClips(false);
            return cur;
          });
        }
        return prev;
      });
    }
  }).current;

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: "#000" }]} edges={["top"]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#00d47e" />
          <Text style={{ color: "white", marginTop: 12, fontSize: 14 }}>Cargando videos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (clips.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: "#000" }]} edges={["top"]}>
        <View style={styles.center}>
          <Ionicons name="videocam-off-outline" size={48} color="rgba(255,255,255,0.4)" />
          <Text style={{ color: "rgba(255,255,255,0.6)", marginTop: 12, fontSize: 15 }}>
            No hay videos disponibles
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: "#000" }]}>
      {/* Header buttons */}
      <TouchableOpacity
        style={styles.filterBtn}
        onPress={() => setFilterOpen(true)}
      >
        <Ionicons name="options-outline" size={20} color="white" />
        {(speaker || tag) && <View style={styles.filterDot} />}
      </TouchableOpacity>

      {/* Saved clips button */}
      <TouchableOpacity
        style={[styles.filterBtn, { right: 60 }]}
        onPress={() => { setSavedOpen(true); loadSaved(); }}
      >
        <Ionicons name="bookmark-outline" size={20} color="white" />
      </TouchableOpacity>

      {/* Active filters chips */}
      {(speaker || tag || sort !== "recent") && (
        <View style={styles.activeFilters}>
          {speaker && (
            <TouchableOpacity style={styles.filterChip} onPress={() => { seenIdsRef.current.clear(); setSpeaker(null); }}>
              <Text style={styles.filterChipText}>{speaker} ✕</Text>
            </TouchableOpacity>
          )}
          {tag && (
            <TouchableOpacity style={styles.filterChip} onPress={() => { seenIdsRef.current.clear(); setTag(null); }}>
              <Text style={styles.filterChipText}>#{tag} ✕</Text>
            </TouchableOpacity>
          )}
          {sort === "trending" && (
            <TouchableOpacity style={styles.filterChip} onPress={() => setSort("recent")}>
              <Text style={styles.filterChipText}>🔥 Trending ✕</Text>
            </TouchableOpacity>
          )}
          {sort === "random" && (
            <TouchableOpacity style={[styles.filterChip, { backgroundColor: "rgba(139,92,246,0.18)", borderColor: "rgba(139,92,246,0.4)" }]} onPress={() => setSort("recent")}>
              <Text style={[styles.filterChipText, { color: "#a78bfa" }]}>🔀 Aleatorio ✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        ref={flatRef}
        data={clips}
        keyExtractor={(c) => c.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
        getItemLayout={(_, index) => ({ length: cardHeight, offset: cardHeight * index, index })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor="#a78bfa"
            colors={["#a78bfa"]}
            title="Cargando aleatorio..."
            titleColor="#a78bfa"
          />
        }
        renderItem={({ item, index }) => (
          <ClipCard
            clip={item}
            isActive={index === activeIndex}
            colors={colors}
            onLike={handleLike}
            onSave={handleSave}
            cardHeight={cardHeight}
          />
        )}
        ListFooterComponent={loadingMore ? (
          <View style={[styles.center, { height: cardHeight, backgroundColor: "#000" }]}>
            <ActivityIndicator size="small" color="#00d47e" />
          </View>
        ) : null}
      />

      {/* Filter Modal */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={styles.filterOverlay} activeOpacity={1} onPress={() => setFilterOpen(false)}>
          <View style={[styles.filterSheet, { backgroundColor: colors.card }]}>
            <View style={[styles.captionHandle, { backgroundColor: colors.border }]} />

            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Ordenar</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              {(["recent", "trending"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.filterOption, sort === s && { backgroundColor: "#00d47e22", borderColor: "#00d47e" }, { borderColor: colors.border }]}
                  onPress={() => { setSort(s); }}
                >
                  <Text style={[styles.filterOptionText, { color: sort === s ? "#00d47e" : colors.textSub }]}>
                    {s === "recent" ? "⏰ Recientes" : "🔥 Trending"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Inversor</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              {SPEAKERS.map((sp) => {
                const active = sp === "Todos" ? !speaker : speaker === sp;
                return (
                  <TouchableOpacity
                    key={sp}
                    style={[styles.filterOption, active && { backgroundColor: "#00d47e22", borderColor: "#00d47e" }, { borderColor: colors.border, marginRight: 8 }]}
                    onPress={() => { seenIdsRef.current.clear(); setSpeaker(sp === "Todos" ? null : sp); }}
                  >
                    <Text style={[styles.filterOptionText, { color: active ? "#00d47e" : colors.textSub }]}>{sp}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Tema</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 24 }}>
              {TAGS.map((t) => {
                const active = t === "Todos" ? !tag : tag === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.filterOption, active && { backgroundColor: "#00d47e22", borderColor: "#00d47e" }, { borderColor: colors.border, marginRight: 8 }]}
                    onPress={() => { seenIdsRef.current.clear(); setTag(t === "Todos" ? null : t); }}
                  >
                    <Text style={[styles.filterOptionText, { color: active ? "#00d47e" : colors.textSub }]}>#{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: "#00d47e" }]}
              onPress={() => setFilterOpen(false)}
            >
              <Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Aplicar filtros</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Saved Clips Modal */}
      <Modal visible={savedOpen} transparent animationType="slide" onRequestClose={() => setSavedOpen(false)}>
        <TouchableOpacity style={styles.filterOverlay} activeOpacity={1} onPress={() => setSavedOpen(false)} />
        <View style={[savedStyles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.captionHandle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={savedStyles.header}>
            <Ionicons name="bookmark" size={18} color="#f59e0b" style={{ marginRight: 6 }} />
            <Text style={[savedStyles.title, { color: colors.text }]}>Videos guardados</Text>
            <TouchableOpacity onPress={() => setSavedOpen(false)} style={{ marginLeft: "auto" }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {savedLoading ? (
            <View style={savedStyles.center}>
              <ActivityIndicator color="#00d47e" />
            </View>
          ) : savedClips.length === 0 ? (
            <View style={savedStyles.center}>
              <Ionicons name="bookmark-outline" size={40} color={colors.textDim} />
              <Text style={[savedStyles.empty, { color: colors.textMuted }]}>
                Aún no guardaste videos
              </Text>
              <Text style={[savedStyles.emptySub, { color: colors.textDim }]}>
                Toca el ícono de marcador en cualquier video
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {savedClips.map((clip) => (
                <View key={clip.id} style={[savedStyles.row, { borderBottomColor: colors.border }]}>
                  {/* Thumbnail */}
                  <View style={savedStyles.thumb}>
                    {clip.thumbnail_url
                      ? <Image source={{ uri: clip.thumbnail_url }} style={{ width: "100%", height: "100%", borderRadius: 10 }} />
                      : <Ionicons name="videocam-outline" size={24} color={colors.textDim} />}
                    {clip.duration_sec > 0 && (
                      <View style={savedStyles.duration}>
                        <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>
                          {formatDuration(clip.duration_sec)}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Info + actions */}
                  <View style={{ flex: 1 }}>
                    <Text style={[savedStyles.clipTitle, { color: colors.text }]} numberOfLines={2}>
                      {clip.title}
                    </Text>
                    <Text style={[savedStyles.speaker, { color: colors.textMuted }]}>{clip.speaker}</Text>

                    <View style={savedStyles.actions}>
                      <TouchableOpacity
                        style={[savedStyles.btn, { backgroundColor: "rgba(0,212,126,0.12)" }]}
                        onPress={() => handleDownloadSaved(clip)}
                        disabled={downloadingId === clip.id}>
                        <Ionicons
                          name={downloadingId === clip.id ? "hourglass-outline" : "download-outline"}
                          size={14}
                          color="#00d47e"
                        />
                        <Text style={[savedStyles.btnText, { color: "#00d47e" }]}>
                          {downloadingId === clip.id ? "Bajando..." : "Descargar"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[savedStyles.btn, { backgroundColor: "rgba(245,158,11,0.12)" }]}
                        onPress={() => handleUnsave(clip.id)}>
                        <Ionicons name="bookmark" size={14} color="#f59e0b" />
                        <Text style={[savedStyles.btnText, { color: "#f59e0b" }]}>Quitar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const savedStyles = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, maxHeight: H * 0.75,
  },
  header: { flexDirection: "row", alignItems: "center", paddingVertical: 14 },
  title: { fontSize: 16, fontWeight: "800" },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  empty: { fontSize: 15, fontWeight: "700", marginTop: 12 },
  emptySub: { fontSize: 12, textAlign: "center", marginTop: 4 },
  row: {
    flexDirection: "row", gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 72, height: 104, borderRadius: 10, overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  duration: {
    position: "absolute", bottom: 4, right: 4,
    backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1,
  },
  clipTitle: { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  speaker: { fontSize: 11, marginTop: 3 },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  btnText: { fontSize: 11, fontWeight: "700" },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  card: { position: "relative", backgroundColor: "#000" },
  overlay: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 280,
  },

  speakerBadge: {
    position: "absolute", top: 16, left: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20,
  },
  speakerText: { color: "white", fontSize: 12, fontWeight: "700" },

  durationBadge: {
    position: "absolute", top: 16, right: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10,
  },
  durationText: { color: "white", fontSize: 11, fontWeight: "600" },

  bottomInfo: {
    position: "absolute", bottom: 24, left: 16, right: 80,
  },
  clipTitle: {
    color: "white", fontSize: 15, fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  tag: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6,
  },
  tagText: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "600" },

  captionBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    marginTop: 10, alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  captionBtnText: { color: "rgba(255,255,255,0.8)", fontSize: 12 },

  actions: {
    position: "absolute", right: 12, bottom: 80,
    alignItems: "center", gap: 20,
  },
  actionBtn: { alignItems: "center", gap: 3 },
  actionLabel: {
    color: "white", fontSize: 11, fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  filterBtn: {
    position: "absolute", top: 56, right: 16, zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20,
    padding: 10,
  },
  filterDot: {
    position: "absolute", top: 6, right: 6,
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#00d47e",
  },
  activeFilters: {
    position: "absolute", top: 56, left: 16, zIndex: 10,
    flexDirection: "row", gap: 6,
  },
  filterChip: {
    backgroundColor: "rgba(0,212,126,0.25)", borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "#00d47e50",
  },
  filterChipText: { color: "#00d47e", fontSize: 11, fontWeight: "700" },

  filterOverlay: { flex: 1, justifyContent: "flex-end" },
  filterSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40,
  },
  filterSectionTitle: {
    fontSize: 13, fontWeight: "700", letterSpacing: 0.3,
    textTransform: "uppercase", marginBottom: 10,
  },
  filterOption: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  filterOptionText: { fontSize: 13, fontWeight: "600" },
  applyBtn: {
    borderRadius: 14, paddingVertical: 15,
    alignItems: "center",
  },

  captionOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  captionSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, maxHeight: H * 0.65,
  },
  captionHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  captionTitle: { fontSize: 16, fontWeight: "800" },
  captionSpeaker: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  captionBody: { fontSize: 14, lineHeight: 22 },
  muteBtn: {
    position: "absolute", top: 56, left: 16,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, padding: 8,
  },
  commentInput: {
    flex: 1, borderRadius: 20, paddingHorizontal: 14,
    paddingVertical: 8, fontSize: 14, borderWidth: StyleSheet.hairlineWidth,
  },
});

const pStyles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 20,
  },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  time: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 10,
    fontWeight: "600" as const,
  },
  track: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 2,
  },
  fill: {
    height: 3,
    backgroundColor: "white",
    borderRadius: 2,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  thumb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "white",
    marginRight: -6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  thumbActive: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: -8,
  },
  tapFlashWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  tapFlashCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
});

const phStyles = StyleSheet.create({
  badge: {
    position: "absolute",
    top: 20,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "rgba(10,10,20,0.72)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.45)",
  },
  bars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 16,
  },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: "#a78bfa",
  },
  label: {
    color: "#e2d9ff",
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  timer: {
    color: "rgba(167,139,250,0.85)",
    fontSize: 11,
    fontWeight: "600" as const,
  },
  skipBtn: {
    position: "absolute",
    bottom: 36,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: "rgba(20,20,30,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  skipText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
});

// Synchronized caption overlay
const capStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    alignItems: "center",
  },
  text: {
    color: "white",
    fontSize: 14,
    fontWeight: "600" as const,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: "hidden",
  },
});

// CC button + lang picker
const ccStyles = StyleSheet.create({
  ccBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  ccBadgeActive: {
    backgroundColor: "rgba(139,92,246,0.25)",
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.5)",
  },
  picker: {
    position: "absolute",
    right: 70,
    bottom: 240,
    backgroundColor: "rgba(15,15,25,0.92)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(139,92,246,0.3)",
    overflow: "hidden",
    minWidth: 130,
  },
  pickerOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerOptionActive: {
    backgroundColor: "rgba(139,92,246,0.15)",
  },
  pickerText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "600" as const,
  },
});

// Comment rows — full web parity
const cmtStyles = StyleSheet.create({
  // Modal header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "800" as const,
  },

  // Comment row
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  // Avatar — image
  avatarImg: {
    width: 30,
    height: 30,
    borderRadius: 15,
    flexShrink: 0,
  },
  avatarImgSm: {
    width: 22,
    height: 22,
    borderRadius: 11,
    flexShrink: 0,
  },

  // Avatar — initial letter
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarSm: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarLetter: {
    color: "white",
    fontSize: 12,
    fontWeight: "700" as const,
  },
  avatarLetterSm: {
    color: "white",
    fontSize: 9,
    fontWeight: "700" as const,
  },

  // Name row
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 3,
    flexWrap: "wrap" as const,
  },
  name: {
    fontSize: 12,
    fontWeight: "700" as const,
  },
  nameSm: {
    fontSize: 11,
    fontWeight: "700" as const,
  },
  date: {
    fontSize: 10,
  },

  // Comment text
  body: {
    fontSize: 13,
    lineHeight: 19,
  },
  bodySm: {
    fontSize: 12,
    lineHeight: 17,
  },

  // Delete button
  deleteBtn: {
    marginLeft: "auto" as any,
    padding: 3,
    opacity: 0.5,
  },

  // Reply button label
  replyBtn: {
    fontSize: 11,
    fontWeight: "600" as const,
    marginTop: 4,
  },

  // Replies indented thread
  repliesThread: {
    marginLeft: 40,
    marginTop: 8,
    paddingLeft: 12,
    borderLeftWidth: 1,
    gap: 12,
  },

  // Inline reply input
  replyInput: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 40,
    marginTop: 8,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  replyTextField: {
    flex: 1,
    fontSize: 13,
  },

  // Main input row at bottom
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    borderTopWidth: 1,
    paddingTop: 12,
  },
});
