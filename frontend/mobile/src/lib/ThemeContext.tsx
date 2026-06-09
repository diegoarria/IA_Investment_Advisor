import React, { createContext, useContext, useState } from "react";

// Exact mirror of the web app's CSS variables (globals.css)
export const dark = {
  // ── Backgrounds ──────────────────────────────────────────────────
  bg:           "#03060e",   // --bg
  bgRaised:     "#060c1a",   // --raised
  card:         "#090f1f",   // --card
  cardElevated: "#0d1526",   // --card-2

  // ── Borders ──────────────────────────────────────────────────────
  border:       "#162035",   // --border
  borderStrong: "#1e2e48",   // --border-s

  // ── Text hierarchy ────────────────────────────────────────────────
  text:         "#eef2ff",   // --text
  textSub:      "#8fa3c0",   // --sub
  textMuted:    "#546b85",   // --muted
  textDim:      "#2a3f58",   // --dim
  placeholder:  "#2a3f58",

  // ── Accent ───────────────────────────────────────────────────────
  accent:       "#00b96d",   // --accent
  accentLight:  "#00e887",   // --accent-l
  accentDark:   "#008c52",   // --accent-d
  accentGlow:   "#00b96d2e", // --accent-glow (rgba(0,185,109,0.18))
  accentPulse:  "#00e88714", // --accent-pulse (rgba(0,232,135,0.08))

  // ── Semantic ─────────────────────────────────────────────────────
  up:           "#00e887",   // --up
  down:         "#f43f5e",   // --down
  warning:      "#f59e0b",
  info:         "#3b82f6",
};

export const light = {
  bg:           "#f4f7fb",   // --bg (light)
  bgRaised:     "#eaeff7",   // --raised (light)
  card:         "#ffffff",   // --card (light)
  cardElevated: "#f8fafd",   // --card-2 (light)

  border:       "#dce5f0",   // --border (light)
  borderStrong: "#c8d8ea",   // --border-s (light)

  text:         "#0a1628",   // --text (light)
  textSub:      "#304660",   // --sub (light)
  textMuted:    "#5b7a96",   // --muted (light)
  textDim:      "#9ab4cc",   // --dim (light)
  placeholder:  "#9ab4cc",

  accent:       "#009958",   // --accent (light)
  accentLight:  "#00b96d",   // --accent-l (light)
  accentDark:   "#007a44",   // --accent-d (light)
  accentGlow:   "#00995814", // --accent-glow (light)
  accentPulse:  "#00b96d0a",

  up:           "#009958",   // --up (light)
  down:         "#e1173d",   // --down (light)
  warning:      "#d97706",
  info:         "#2563eb",
};

export type Colors = typeof dark;

interface ThemeCtx {
  colors: Colors;
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeCtx>({
  colors: dark,
  isDark: true,
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);
  return (
    <ThemeContext.Provider
      value={{ colors: isDark ? dark : light, isDark, toggle: () => setIsDark((v) => !v) }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
