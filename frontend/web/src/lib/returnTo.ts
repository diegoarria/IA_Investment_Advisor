// "After you log in, take me back to where the email/link sent me."
// Set by a page that needs a session (see products/page.tsx ?open=session),
// consumed once by the login flow in app/page.tsx. Only same-site relative
// paths are ever honored, so this can never become an open redirect.
const KEY = "nuvos_return_to";

export function setReturnTo(path: string): void {
  try { localStorage.setItem(KEY, path); } catch { /* ignore */ }
}

export function consumeReturnTo(): string | null {
  try {
    const p = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return p && p.startsWith("/") && !p.startsWith("//") ? p : null;
  } catch { return null; }
}
