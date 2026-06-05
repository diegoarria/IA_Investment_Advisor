"use client";

import { useState } from "react";

interface StockAvatarProps {
  ticker: string;
  logoUrl?: string | null;
  size?: "sm" | "md" | "lg";
}

export default function StockAvatar({ ticker, logoUrl, size = "md" }: StockAvatarProps) {
  const initials = ticker.slice(0, 2).toUpperCase();
  const clean = ticker.replace(".", "-");

  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    `https://assets.parqet.com/logos/symbol/${clean}?format=svg`,
    `https://financialmodelingprep.com/image-stock/${clean}.png`,
  ];
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const activeSrc = sources.find((s) => !failed.has(s));

  const sizeClass =
    size === "sm" ? "w-8 h-8 text-xs" :
    size === "lg" ? "w-12 h-12 text-base" :
    "w-10 h-10 text-sm";

  const paddingClass =
    size === "sm" ? "p-1" :
    size === "lg" ? "p-2" :
    "p-1.5";

  if (activeSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={activeSrc}
        alt={ticker}
        className={`${sizeClass} ${paddingClass} rounded-full object-contain shrink-0`}
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed((prev) => new Set([...prev, activeSrc]))}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-black shrink-0`}
      style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}
    >
      {initials}
    </div>
  );
}
