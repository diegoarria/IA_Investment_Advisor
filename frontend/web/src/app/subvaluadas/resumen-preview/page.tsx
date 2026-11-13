"use client";

// Redirect shim — this route generalized into /[ticker] (universal, any
// ticker) on 2026-11-12. Kept so the bare URL Diego already has open/
// bookmarked keeps working, defaulting to the original pilot ticker.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ResumenPreviewRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/subvaluadas/resumen-preview/GOOGL");
  }, [router]);
  return null;
}
