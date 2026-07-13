"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "next/navigation";
import { useThemeStore, useAuthStore, useWatchlistStore, useLearnStore, useLanguageStore } from "@/lib/store";
import "@/i18n";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { getSupabaseClient } from "@/lib/supabase";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { theme, loadThemeFromServer } = useThemeStore();
  const { language, loadLanguageFromServer } = useLanguageStore();
  const { isAuthenticated, setAuth, setAuthRestoring } = useAuthStore();
  const lastSyncRef = useRef<number>(0);
  const pathname = usePathname();
  const isAuthPage = pathname === "/" || pathname?.startsWith("/auth") || pathname === "/join";
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    import("@/i18n").then(({ default: i18n }) => i18n.changeLanguage(language));
  }, [language]);

  // On every app load: the httpOnly auth cookie (if any) is sent automatically,
  // so just ask the API whether it recognizes a session. If we already believe
  // we're authenticated (persisted isAuthenticated flag), skip the extra
  // round-trip — any actual data call that finds the cookie stale is already
  // handled by api.ts's 401/refresh interceptor.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isAuthenticated) { setAuthRestoring(false); return; }

    async function restoreSession() {
      try {
        const { profile: profileApi } = await import("@/lib/api");
        const res = await profileApi.get();
        setAuth("", res.data.user_id);
      } catch {
        await useAuthStore.getState().clearAuth();
      }
    }

    restoreSession().finally(() => setAuthRestoring(false));
  }, []);

  // Whenever Supabase silently refreshes the JWT (OAuth sessions it manages
  // directly), re-mint our own httpOnly cookie to match — never persisted to
  // localStorage, just handed straight to the backend for this one call.
  useEffect(() => {
    const supabase = getSupabaseClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        import("@/lib/api").then(({ auth: authApi }) => {
          authApi.setSession(session.access_token, session.refresh_token).catch(() => {});
        });
        setAuth(session.access_token, session.user.id);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const syncAll = () => {
      const now = Date.now();
      if (now - lastSyncRef.current < 30_000) return;
      lastSyncRef.current = now;

      loadThemeFromServer();
      loadLanguageFromServer();
      useWatchlistStore.getState().loadFromServer();
      useLearnStore.getState().restoreFromServer();
      usePortfolioStore.getState().loadFromServer();
    };

    syncAll();

    // Retry shortly after login/mount regardless of the 30s throttle above. Each
    // store's loadFromServer() swallows its own network errors silently with no
    // retry, so a single cold-start hiccup on a freshly logged-in browser (new
    // device, new browser) could otherwise leave it stuck showing stale/empty
    // data — looking exactly like "this browser has its own separate history" —
    // until the user happens to switch tabs. Forcing a few extra pulls closes
    // that window.
    const retryTimers = [3_000, 8_000, 15_000].map((delay) =>
      setTimeout(() => { lastSyncRef.current = 0; syncAll(); }, delay)
    );

    const onVisibility = () => {
      if (document.visibilityState === "visible") syncAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      retryTimers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuthenticated]);

  // Detect a stale tab: an open tab keeps running whatever JS it loaded with —
  // it never picks up a new deploy on its own. /api/version always reflects the
  // currently-deployed code, so comparing it against the SHA baked into this
  // tab's own bundle tells us if we're running old code, no matter how many
  // fixes have since shipped to production.
  useEffect(() => {
    const builtSha = process.env.NEXT_PUBLIC_BUILD_SHA;
    if (!builtSha || builtSha === "dev") return; // local dev — nothing to compare against

    const checkVersion = () => {
      fetch("/api/version", { cache: "no-store" })
        .then((res) => res.json())
        .then((data: { sha?: string }) => {
          if (data?.sha && data.sha !== builtSha) setNewVersionAvailable(true);
        })
        .catch(() => {});
    };

    checkVersion();
    const interval = setInterval(checkVersion, 5 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") checkVersion(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div style={isAuthPage ? {} : { height: "100vh", overflow: "hidden" }}>
      {newVersionAvailable && !bannerDismissed && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold"
             style={{ background: "var(--card)", border: "1px solid var(--accent)", color: "var(--text)" }}>
          <span>{t("themeProvider.newVersionAvailable")}</span>
          <button onClick={() => window.location.reload()}
                  className="px-3 py-1 rounded-lg text-xs font-black"
                  style={{ background: "var(--accent)", color: "#000" }}>
            {t("themeProvider.reload")}
          </button>
          <button onClick={() => setBannerDismissed(true)} aria-label={t("themeProvider.close")} style={{ color: "var(--muted)" }}>
            ✕
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
