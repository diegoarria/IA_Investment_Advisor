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

    async function saveAndRedirect(session: { access_token: string; refresh_token?: string; user: { id: string } }) {
      if (done) return;
      done = true;
      localStorage.setItem("access_token", session.access_token);
      if (session.refresh_token) localStorage.setItem("refresh_token", session.refresh_token);
      setAuth(session.access_token, session.user.id);
      try {
        const p = await profileApi.get();
        setProfile(p.data);
        window.location.href = "/home";
      } catch (err: any) {
        window.location.href = err?.response?.status === 404 ? "/onboarding" : "/home";
      }
    }

    async function handleCallback() {
      // Step 1: session might already exist if Supabase processed the URL elsewhere
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (existing) {
        await saveAndRedirect(existing);
        return;
      }

      // Step 2: manually exchange the PKCE code — the singleton client was created on /
      // before the OAuth redirect, so detectSessionInUrl never ran on this URL.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (data?.session) {
          await saveAndRedirect(data.session);
          return;
        }
        if (error) {
          router.push("/");
          return;
        }
      }

      // Step 3: fallback — listen for SIGNED_IN in case the SDK processes it asynchronously
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session && !done) {
          subscription.unsubscribe();
          saveAndRedirect(session);
        }
      });

      const timeout = setTimeout(() => {
        if (!done) {
          subscription.unsubscribe();
          router.push("/");
        }
      }, 5000);

      return () => {
        clearTimeout(timeout);
        subscription.unsubscribe();
      };
    }

    handleCallback().catch(() => {
      if (!done) router.push("/");
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
      <div className="w-8 h-8 border-2 border-white/10 border-t-green-400 rounded-full"
           style={{ animation: "spin 0.7s linear infinite" }} />
    </div>
  );
}
