"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { notifications as notifApi } from "@/lib/api";
import { useAuthStore, useNotificationStore } from "@/lib/store";
import { Bell, ArrowLeft, CheckCheck } from "lucide-react";

const TYPE_ICONS: Record<string, string> = {
  market_move: "📉",
  earnings_event: "📊",
  learning_progress: "🚀",
  personalized_insight: "🧠",
  market_summary: "📈",
};

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { notifications, unreadCount, setNotifications, markRead } = useNotificationStore();

  useEffect(() => {
    if (!isAuthenticated) { router.push("/"); return; }
    notifApi.getAll().then((res) => {
      setNotifications(res.data.notifications, res.data.unread_count);
    });
  }, [isAuthenticated]);

  const handleMarkAllRead = async () => {
    await notifApi.markAllRead();
    setNotifications(notifications.map((n) => ({ ...n, read: true })), 0);
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("es", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    });
  };

  return (
    <div className="min-h-screen bg-[#0f1117] p-4">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => router.push("/chat")}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Volver al chat
        </button>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-600/20 border border-brand-500/30 rounded-xl flex items-center justify-center">
              <Bell className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Notificaciones</h1>
              <p className="text-gray-400 text-sm">{unreadCount} sin leer</p>
            </div>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="flex items-center gap-1 text-sm text-brand-400 hover:text-brand-300"
            >
              <CheckCheck className="w-4 h-4" /> Marcar todas leídas
            </button>
          )}
        </div>

        {notifications.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <Bell className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Sin notificaciones todavía</p>
            <p className="text-sm mt-1">Las notificaciones aparecen cuando hay movimientos del mercado relevantes para ti</p>
          </div>
        )}

        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => { markRead(n.id); notifApi.markRead(n.id); }}
              className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                n.read
                  ? "border-[#2a2d3a] bg-[#1a1d27]"
                  : "border-brand-500/40 bg-brand-500/5"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">{TYPE_ICONS[n.type] || "🔔"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`font-semibold text-sm ${n.read ? "text-gray-300" : "text-white"}`}>
                      {n.title}
                    </span>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-brand-400 flex-shrink-0 mt-1" />}
                  </div>
                  <p className="text-gray-400 text-sm mt-1">{n.message}</p>
                  <p className="text-gray-600 text-xs mt-2">{formatDate(n.created_at)}</p>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); router.push(`/chat`); }}
                className="mt-3 text-xs text-brand-400 hover:text-brand-300"
              >
                Discutir con mi mentor →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
