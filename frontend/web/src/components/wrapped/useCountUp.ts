"use client";

import { useEffect, useState } from "react";

/** Animates a number counting up (or down, for a negative target) from 0 to
 * `target` on mount — the "odometer" effect every Spotify-Wrapped-style
 * reveal uses on its one hero number per screen. Re-runs whenever `target`
 * changes, which in practice means "on mount" since each screen is a fresh
 * component instance every time the user navigates to it. */
export function useCountUp(target: number, durationMs = 900, decimals = 0): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return decimals > 0 ? Number(value.toFixed(decimals)) : Math.round(value);
}
