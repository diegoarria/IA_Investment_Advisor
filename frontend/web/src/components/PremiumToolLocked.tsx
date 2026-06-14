"use client";

import { LucideIcon, Lock, Sparkles } from "lucide-react";

interface Benefit {
  icon: LucideIcon;
  text: string;
}

interface Props {
  title: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  color: string;
  benefits: Benefit[];
  onUnlock: () => void;
}

export default function PremiumToolLocked({
  title, tagline, description, icon: Icon, color, benefits, onUnlock,
}: Props) {
  return (
    <div
      onClick={onUnlock}
      className="rounded-3xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
      style={{ background: "var(--card)", boxShadow: "0 4px 24px rgba(0,0,0,0.12)" }}
    >
      {/* ── Hero ── */}
      <div className="relative flex flex-col items-center pt-9 pb-7 overflow-hidden"
           style={{ background: color + "18" }}>
        {/* Decorative circles */}
        <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full pointer-events-none"
             style={{ background: color + "15" }} />
        <div className="absolute -bottom-8 -left-5 w-28 h-28 rounded-full pointer-events-none"
             style={{ background: color + "0A" }} />

        {/* PREMIUM badge */}
        <div className="relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full border mb-5"
             style={{ background: "var(--card)", borderColor: color + "50" }}>
          <Lock className="w-3 h-3" style={{ color }} />
          <span className="text-[10px] font-black tracking-widest" style={{ color }}>PREMIUM</span>
          <Sparkles className="w-3 h-3" style={{ color }} />
        </div>

        {/* Icon with double ring */}
        <div className="relative z-10 w-[88px] h-[88px] rounded-[28px] border-2 flex items-center justify-center"
             style={{ background: color + "25", borderColor: color + "40" }}>
          <div className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
               style={{ background: color }}>
            <Icon className="w-8 h-8 text-white" />
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="p-6 pt-5">
        <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
            style={{ color: "var(--text)" }}>
          {title}
        </h3>
        <p className="text-[13px] font-bold text-center mb-3 tracking-wide" style={{ color }}>
          {tagline}
        </p>
        <p className="text-[13px] leading-[1.55] text-center mb-5" style={{ color: "var(--sub)" }}>
          {description}
        </p>

        {/* Benefits list */}
        <div className="rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
          {benefits.map((b, i) => {
            const BIcon = b.icon;
            return (
              <div key={b.text}
                   className="flex items-center gap-3 px-3.5 py-3"
                   style={{ borderBottom: i < benefits.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0"
                     style={{ background: color + "12" }}>
                  <BIcon className="w-4 h-4" style={{ color }} />
                </div>
                <span className="text-[13px] leading-snug font-medium" style={{ color: "var(--sub)" }}>
                  {b.text}
                </span>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={(e) => { e.stopPropagation(); onUnlock(); }}
          className="relative w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-extrabold text-[15px] text-white overflow-hidden tracking-wide transition-opacity hover:opacity-90"
          style={{ background: color }}
        >
          <div className="absolute inset-0 top-0 h-1/2 pointer-events-none"
               style={{ background: "rgba(255,255,255,0.12)" }} />
          <Sparkles className="w-4 h-4" />
          Desbloquear con Premium
        </button>
      </div>
    </div>
  );
}
