"use client";
export const dynamic = "force-dynamic";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuthStore, useProfileStore } from "@/lib/store";
import { profile as profileApi } from "@/lib/api";

export default function AuthCallback() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    async function handleCallback() {
      const supabase = getSupabaseClient();

      // First try: Supabase may have already exchanged the code automatically
      const { data: { session: existingSession } } = await supabase.auth.getSession();
      if (existingSession) {
        await saveAndRedirect(existingSession);
        return;
      }

      // Second try: manual exchange using just the code param
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) { router.push("/"); return; }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data.session) {
        console.error("OAuth callback error:", error);
        router.push("/");
        return;
      }

      await saveAndRedirect(data.session);
    }

    async function saveAndRedirect(session: any) {
      localStorage.setItem("access_token", session.access_token);
      if (session.refresh_token) localStorage.setItem("refresh_token", session.refresh_token);
      setAuth(session.access_token, session.user.id);
      try {
        const p = await profileApi.get();
        setProfile(p.data);
        window.location.href = "/home";
      } catch {
        window.location.href = "/onboarding";
      }
    }

    handleCallback();
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
