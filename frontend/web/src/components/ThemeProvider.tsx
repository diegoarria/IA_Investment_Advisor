"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePathname } from "next/navigation";
import { useThemeStore, useAuthStore, useWatchlistStore, useLearnStore, useLanguageStore } from "@/lib/store";
import "@/i18n";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { getSupabaseClient } from "@/lib/supabase";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://iainvestmentadvisor-production.up.railway.app";

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

  // On every app load: restore session from stored tokens so the user
  // is never logged out as long as their refresh_token is valid.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const accessToken  = localStorage.getItem("access_token");
    const refreshToken = localStorage.getItem("refresh_token");
    if (!accessToken && !refreshToken) { setAuthRestoring(false); return; }

    // If already authenticated AND tokens look fresh, skip restore
    if (isAuthenticated && accessToken) { setAuthRestoring(false); return; }

    async function restoreSession() {
      try {
        // Ask Supabase to restore the session — it auto-refreshes if expired
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.auth.setSession({
          access_token:  accessToken  ?? "",
          refresh_token: refreshToken ?? "",
        });

        if (data.session) {
          const s = data.session;
          localStorage.setItem("access_token",  s.access_token);
          if (s.refresh_token) localStorage.setItem("refresh_token", s.refresh_token);
          setAuth(s.access_token, s.user.id);
          return;
        }
        if (error) throw error;
      } catch {
        // Supabase couldn't restore — try our backend refresh endpoint as fallback
        if (!refreshToken) { clearStored(); return; }
        try {
          const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ refresh_token: refreshToken }),
          });
          if (!res.ok) { clearStored(); return; }
          const json = await res.json();
          localStorage.setItem("access_token",  json.access_token);
          if (json.refresh_token) localStorage.setItem("refresh_token", json.refresh_token);
          // Get user_id from the new token via Supabase
          const supabase = getSupabaseClient();
          const { data: userData } = await supabase.auth.getUser(json.access_token);
          if (userData.user) setAuth(json.access_token, userData.user.id);
        } catch { clearStored(); }
      }
    }

    function clearStored() {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      setAuthRestoring(false);
    }

    restoreSession().finally(() => setAuthRestoring(false));
  }, []);

  // Keep tokens fresh: whenever Supabase silently refreshes the JWT, update localStorage
  useEffect(() => {
    const supabase = getSupabaseClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        localStorage.setItem("access_token", session.access_token);
        if (session.refresh_token) localStorage.setItem("refresh_token", session.refresh_token);
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
