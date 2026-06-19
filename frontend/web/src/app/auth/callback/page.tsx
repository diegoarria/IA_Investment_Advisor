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
    const supabase = getSupabaseClient();
    let done = false;

    async function saveAndRedirect(session: any) {
      if (done) return;
      done = true;
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

    // Primary: Supabase auto-detects the code in the URL and fires SIGNED_IN.
    // This handles PKCE exchange without us calling exchangeCodeForSession manually
    // (calling it manually can conflict with the auto-exchange and cause "code reuse" errors).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        subscription.unsubscribe();
        saveAndRedirect(session);
      }
    });

    // Secondary: in case the session was already set before this component mounted
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !done) {
        subscription.unsubscribe();
        saveAndRedirect(session);
      }
    });

    // Safety timeout: if Supabase never fires (bad code, expired, etc.) send to login
    const timeout = setTimeout(() => {
      if (!done) {
        subscription.unsubscribe();
        router.push("/");
      }
    }, 8000);

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
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
