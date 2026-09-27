// Anonymous visitor tracking (admin panel "Invitados"). This filesystem route
// wins over next.config's /api/:path* rewrite so it can read Vercel's edge geo
// headers (x-vercel-ip-*) and hand them to the backend — the IP is only used
// for rate limiting there, never stored. Best-effort: always answers 204.
export const dynamic = "force-dynamic";

const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN || "https://iainvestmentadvisor-production.up.railway.app";

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const h = req.headers;
    const fwd: Record<string, string> = { "content-type": "application/json" };
    const pass: [string, string][] = [
      ["x-vercel-ip-country", "x-nuvos-geo-country"],
      ["x-vercel-ip-country-region", "x-nuvos-geo-region"],
      ["x-vercel-ip-city", "x-nuvos-geo-city"],
      ["user-agent", "x-nuvos-ua"],
    ];
    for (const [from, to] of pass) {
      const v = h.get(from);
      if (v) fwd[to] = v;
    }
    const ip = (h.get("x-forwarded-for") || h.get("x-real-ip") || "").split(",")[0].trim();
    if (ip) fwd["x-forwarded-for"] = ip;
    await fetch(`${BACKEND_ORIGIN}/api/guest/track`, {
      method: "POST",
      headers: fwd,
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* tracking must never break anything */
  }
  return new Response(null, { status: 204 });
}
