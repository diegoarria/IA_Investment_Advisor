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
  // A security audit found none of these set anywhere (backend or here) —
  // no clickjacking protection, no MIME-sniffing protection, no CSP
  // backstop if an XSS bug is ever found. CSP here is intentionally NOT a
  // strict nonce-based policy — this app relies heavily on inline style={{}}
  // attributes (would need script/style nonces threaded through every page
  // via middleware, real work + real risk of breaking hydration if done
  // wrong) — so 'unsafe-inline' stays allowed for script/style while the
  // genuinely dangerous vectors (arbitrary third-party script sources,
  // framing, plugins) are locked down. Real defense-in-depth over a
  // theoretically stricter policy that could take the site down if
  // mis-shipped; tightening to nonces is a good future increment, done with
  // its own staged rollout (report-only first), not blind.
  async headers() {
    const csp = [
      "default-src 'self'",
      // https://js.stripe.com — the embedded Payment Element (EmbeddedCheckout.tsx,
      // 2026-09-15) loads Stripe.js from here; blocked silently (console-only,
      // no visible error) before this was added — confirmed live, the paywall
      // rendered as an empty gap with no card form at all.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.stripe.com " + BACKEND_ORIGIN,
      // Stripe's Payment Element renders its actual card fields inside an
      // iframe it injects itself (js.stripe.com) — needed alongside the
      // script-src entry above, or the fields silently fail to render even
      // once the script itself loads.
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      // NOTE: if/when the Belvo Connect Widget (an iframe Belvo serves —
      // see backend/app/api/routes/belvo.py's docstring) gets wired into
      // this frontend, add its host to frame-src above too.
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // microphone stays self-only, not blocked — voice input/voice
          // calls (chat/page.tsx, VoiceCallModal.tsx) need real mic access.
          { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
