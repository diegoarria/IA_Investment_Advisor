"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

if (typeof window !== "undefined") {
  posthog.init("phc_kB3B3Jfcr4jWSevFviqHnBtVa4AmVxNJ23NeJMVt2Lcb", {
    api_host: "https://us.i.posthog.com",
    capture_pageview: false, // manual below
    capture_pageleave: true,
    person_profiles: "identified_only",
  });
}

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    ph?.capture("$pageview", { $current_url: window.location.href });
  }, [pathname, searchParams, ph]);

  return null;
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}
