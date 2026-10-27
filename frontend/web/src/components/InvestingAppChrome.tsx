"use client";

import { usePathname } from "next/navigation";

/**
 * Diego, 2026-10-26: "/consulting... que sea un sitio aparte de la
 * plataforma principal." The root layout mounts a stack of Nuvos AI
 * (investing app) specific global providers unconditionally — upsell
 * popups, the Premium subscription-status poller, referral/guest banners.
 * None of this makes sense for a MY NUVOS participant, who is a separate
 * account with no investing-app profile at all (a status poll would just
 * 403, and an upsell popup for "Premium" would be actively confusing on a
 * leadership-coaching portal). Rather than touching the root layout's
 * provider list, this is a single gate: on /consulting/*, render nothing;
 * everywhere else, render children exactly as before.
 */
export default function InvestingAppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/consulting")) return null;
  return <>{children}</>;
}
