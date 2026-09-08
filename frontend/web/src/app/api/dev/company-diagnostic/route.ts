// Dev-only proxy: fetches company-diagnostic server-side (Next.js server ->
// backend, no browser CORS/networking involved) so the /dev/company-diagnostic
// preview page never has to make a cross-origin request from the browser.
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Diego, 2026-09-08 (pre-launch audit, P2): this dev-only scaffolding had
  // no auth guard and no env gate — it was reachable in production at
  // nuvosai.com/dev/company-diagnostic by anyone who found the URL. It
  // only proxies to an already-public backend endpoint (no auth bypass or
  // sensitive data exposure), but it has none of the launch polish a real
  // user-facing page would, so it shouldn't be live at all outside dev.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ detail: "Not found" }, { status: 404 });
  }
  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ detail: "Missing ticker" }, { status: 400 });
  }
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const url = `${backendUrl}/api/market/screener/company-diagnostic/public?query=${encodeURIComponent(ticker)}&guest_id=dev-preview&lang=es`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ detail: `Backend unreachable: ${(err as Error).message}` }, { status: 502 });
  }
}
