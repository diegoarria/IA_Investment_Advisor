"use client";

import React from "react";
import { apiBase } from "@/lib/apiBase";

function reportClientError(message: string, stack: string | undefined) {
  try {
    const payload = JSON.stringify({
      message,
      stack,
      url: typeof window !== "undefined" ? window.location.href : "",
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    });
    const url = `${apiBase()}/api/telemetry/client-error`;
    // sendBeacon survives the page tearing down mid-crash, which a normal
    // fetch often doesn't — this endpoint is public/unauthenticated by
    // design (see backend/app/api/routes/telemetry.py), so no headers/cookies
    // are needed for it to work even for a logged-out user.
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
}

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

// Catches render errors anywhere below it in the component tree (a
// "pantalla en blanco" for the user) and reports them to the standalone
// Nuvos Sentinel monitor's client_errors feed instead of failing silently.
// Does NOT catch errors thrown by the root layout itself — see
// app/global-error.tsx for that framework-level case.
export default class GlobalErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError(error.message, error.stack || info.componentStack || undefined);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p>Algo salió mal. Por favor recarga la página.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
