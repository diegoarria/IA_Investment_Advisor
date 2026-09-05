"use client";

import { useEffect } from "react";
import { apiBase } from "@/lib/apiBase";

// Next.js App Router's framework-level catch for errors thrown while
// rendering the ROOT layout itself — a plain React error boundary
// (see components/GlobalErrorBoundary.tsx) can't catch those, since it
// lives inside the layout it would need to catch errors from. This file
// must define its own <html>/<body> since the root layout is exactly what
// failed to render.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const payload = JSON.stringify({
        message: error.message,
        stack: error.stack,
        url: typeof window !== "undefined" ? window.location.href : "",
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      });
      const url = `${apiBase()}/api/telemetry/client-error`;
      const sent =
        typeof navigator !== "undefined" && "sendBeacon" in navigator
          ? navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }))
          : false;
      if (!sent) {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Reporting a crash must never itself throw.
    }
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div style={{ padding: 24, textAlign: "center" }}>
          <p>Algo salió mal. Por favor recarga la página.</p>
        </div>
      </body>
    </html>
  );
}
