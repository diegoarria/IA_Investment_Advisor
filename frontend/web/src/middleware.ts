import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Diego, 2026-10-21 — temporary full-site maintenance page while the
// Railway security incident (builds paused platform-wide) blocks us from
// redeploying the backend with a working Anthropic key (the old one was
// disabled before the new one could be rolled out, breaking Arthur/AI
// features live). Flip to false and push to restore the real app —
// Vercel is independent of Railway, so this takes effect immediately.
const MAINTENANCE_MODE = true;

const MAINTENANCE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nuvos AI — Mantenimiento</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #03060e; color: #eef2ff;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    padding: 24px; text-align: center;
  }
  .card { max-width: 440px; }
  .logo {
    width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 24px;
    background: linear-gradient(135deg, #00b96d, #00e887);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 24px; color: #03060e;
  }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.6; color: #8fa3c0; margin: 0 0 8px; }
  .eta { font-size: 13px; color: #546b85; margin-top: 20px; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo">N</div>
    <h1>Estamos en mantenimiento</h1>
    <p>Nuvos AI está temporalmente fuera de línea mientras hacemos ajustes técnicos.</p>
    <p>Volveremos pronto. Gracias por tu paciencia.</p>
    <div class="eta">Si necesitas algo urgente, escríbenos a soporte.</div>
  </div>
</body>
</html>`;

export function middleware(request: NextRequest) {
  if (!MAINTENANCE_MODE) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || /\.(ico|png|svg|jpg|jpeg|webp|txt|xml|json|webmanifest)$/.test(pathname)) {
    return NextResponse.next();
  }

  return new NextResponse(MAINTENANCE_HTML, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
