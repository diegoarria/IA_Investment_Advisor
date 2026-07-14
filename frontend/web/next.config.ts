import type { NextConfig } from "next";

// Same backend the frontend already falls back to hitting directly elsewhere
// (lib/api.ts, VoiceCallModal.tsx, portfolioStore.ts) when NEXT_PUBLIC_API_URL
// isn't set — reused here so this proxy works without needing a new env var.
const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN || "https://iainvestmentadvisor-production.up.railway.app";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    // Baked into the client bundle at build time — compared against /api/version
    // (which always reflects the currently-deployed code) to detect when a tab
    // that's been open since before a deploy is running stale JS.
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "dev",
  },
  // Proxies REST calls to the backend through our own domain so the auth
  // cookie is set as first-party (by nuvosai.com itself) instead of
  // third-party (by the Railway domain) — Safari's ITP and Chrome's
  // third-party-cookie blocking silently drop third-party cookies even with
  // SameSite=None; Secure set correctly, which is what broke login for every
  // web user. See lib/apiBase.ts, which is what actually routes requests here
  // instead of straight to Railway. Applied as "afterFiles" (the default for
  // a plain array), so it never shadows our own /api/version route.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
