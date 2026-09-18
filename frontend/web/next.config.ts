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
      // https://cdn.belvo.io — loads the Belvo Connect Widget's loader +
      // module script (BrokerConnectModal.tsx); https://cdn.mxpnl.com and
      // https://hcaptcha.com are dependencies the widget's own bundle pulls
      // in (Mixpanel analytics, hCaptcha challenge) — confirmed by
      // inspecting the widget's shipped JS, since Belvo doesn't document a
      // CSP allowlist. Without cdn.belvo.io here the widget script is
      // silently blocked (console-only CSP violation, no visible error) and
      // `belvoReady` never flips true, surfacing as "El widget de conexión
      // no está listo" on every click regardless of bank.
      // https://cdn.plaid.com — Plaid Link's script (BrokerConnectModal.tsx's
      // handlePlaidBroker, wired to the IBKR/Schwab/Robinhood buttons); same
      // silent-CSP-block failure mode as Belvo below, confirmed by
      // inspecting the shipped link-initialize.js bundle directly (Plaid's
      // own CSP docs recommend the same host).
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com https://js.stripe.com https://cdn.belvo.io https://cdn.mxpnl.com https://hcaptcha.com https://cdn.plaid.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      // widget-api/widget-customization.belvo.com — the widget's own runtime
      // API calls (institution data, step config) made directly from the
      // browser, not proxied through our backend. api-js.mixpanel.com and
      // the configcat hosts are the same widget-bundle dependencies as above.
      // https://*.plaid.com — Link talks to whichever of
      // sandbox/development/production.plaid.com matches the link_token's
      // env (set server-side via PLAID_ENV), plus secure.plaid.com for
      // identity-verification steps some institutions require.
      "connect-src 'self' https://*.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.stripe.com https://widget-api.belvo.com https://widget-customization.belvo.com https://api-js.mixpanel.com https://app.configcat.com https://cdn-eu.configcat.com https://cdn-global.configcat.com https://hcaptcha.com https://*.plaid.com " + BACKEND_ORIGIN,
      // Stripe's Payment Element renders its actual card fields inside an
      // iframe it injects itself (js.stripe.com) — needed alongside the
      // script-src entry above, or the fields silently fail to render even
      // once the script itself loads. hcaptcha.com — the widget's captcha
      // challenge renders in its own iframe the same way. cdn.plaid.com —
      // Plaid Link's OAuth step (some banks) renders in its own iframe too.
      "frame-src https://js.stripe.com https://hooks.stripe.com https://hcaptcha.com https://cdn.plaid.com",
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
