"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuthStore, useProfileStore } from "@/lib/store";
import { profile as profileApi } from "@/lib/api";

export default function AuthCallback() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) { router.push("/"); return; }

    supabase.auth.exchangeCodeForSession(window.location.href).then(async ({ data, error }) => {
      if (error || !data.session) { router.push("/"); return; }

      const { access_token, refresh_token, user } = data.session;
      localStorage.setItem("access_token", access_token);
      if (refresh_token) localStorage.setItem("refresh_token", refresh_token);
      setAuth(access_token, user.id);

      try {
        const p = await profileApi.get();
        setProfile(p.data);
        window.location.href = "/home";
      } catch {
        window.location.href = "/onboarding";
      }
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div
        className="w-8 h-8 border-2 border-white/10 border-t-green-400 rounded-full"
        style={{ animation: "spin 0.7s linear infinite" }}
      />
    </div>
  );
}
