"use client";

import { LucideIcon, Lock, Zap } from "lucide-react";

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
      className="rounded-2xl border overflow-hidden cursor-pointer hover:opacity-95 transition-opacity"
      style={{ borderColor: color + "30", background: "var(--card)" }}
    >
      {/* Accent bar */}
      <div className="h-1" style={{ background: color }} />

      <div className="p-6 flex flex-col items-center text-center">
        {/* Lock badge */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border mb-5"
             style={{ background: color + "12", borderColor: color + "30" }}>
          <Lock className="w-3 h-3" style={{ color }} />
          <span className="text-[10px] font-black tracking-widest" style={{ color }}>PREMIUM</span>
        </div>

        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
             style={{ background: color + "15" }}>
          <Icon className="w-10 h-10" style={{ color }} />
        </div>

        {/* Title */}
        <h3 className="text-xl font-black mb-1.5 tracking-tight" style={{ color: "var(--text)" }}>
          {title}
        </h3>
        <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>{tagline}</p>

        {/* Description */}
        <p className="text-sm leading-relaxed mb-5 max-w-sm" style={{ color: "var(--sub)" }}>
          {description}
        </p>

        {/* Benefits grid */}
        <div className="w-full grid grid-cols-2 gap-2 mb-5">
          {benefits.map((b) => {
            const BIcon = b.icon;
            return (
              <div key={b.text}
                   className="flex items-start gap-2.5 p-3 rounded-xl text-left"
                   style={{ background: color + "0A", border: `1px solid ${color}20` }}>
                <BIcon className="w-4 h-4 shrink-0 mt-0.5" style={{ color }} />
                <span className="text-xs leading-snug" style={{ color: "var(--sub)" }}>{b.text}</span>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <button
          onClick={onUnlock}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm text-white transition-opacity hover:opacity-90"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
        >
          <Zap className="w-4 h-4" />
          Desbloquear con Premium
        </button>
      </div>
    </div>
  );
}
