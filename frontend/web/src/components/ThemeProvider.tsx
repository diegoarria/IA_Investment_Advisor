"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useThemeStore, useAuthStore, useWatchlistStore, useLearnStore } from "@/lib/store";
import { getSupabaseClient } from "@/lib/supabase";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://iainvestmentadvisor-production.up.railway.app";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, loadThemeFromServer } = useThemeStore();
  const { isAuthenticated, setAuth } = useAuthStore();
  const lastSyncRef = useRef<number>(0);
  const pathname = usePathname();
  const isAuthPage = pathname === "/" || pathname?.startsWith("/auth") || pathname === "/join";

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // On every app load: restore session from stored tokens so the user
  // is never logged out as long as their refresh_token is valid.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthenticated) return;

    const accessToken  = localStorage.getItem("access_token");
    const refreshToken = localStorage.getItem("refresh_token");
    if (!accessToken && !refreshToken) return;

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
    }

    restoreSession();
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
      useWatchlistStore.getState().loadFromServer();
      useLearnStore.getState().restoreFromServer();
    };

    syncAll();

    const onVisibility = () => {
      if (document.visibilityState === "visible") syncAll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isAuthenticated]);

  return (
    <div style={isAuthPage ? {} : { height: "100vh", overflow: "hidden" }}>
      {children}
    </div>
  );
}
