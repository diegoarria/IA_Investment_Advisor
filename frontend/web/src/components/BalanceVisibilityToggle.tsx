"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBalanceVisibilityStore } from "@/lib/store";

// Shared "eye" toggle for Home/Patrimonio/Portfolio — one preference, so
// hiding the balance on any one of those screens hides it everywhere else too.
export default function BalanceVisibilityToggle({
  className,
  style,
  stopPropagation,
}: {
  className?: string;
  style?: React.CSSProperties;
  stopPropagation?: boolean;
}) {
  const { t } = useTranslation();
  const { hidden, toggle } = useBalanceVisibilityStore();

  return (
    <button
      onClick={(e) => { if (stopPropagation) e.stopPropagation(); toggle(); }}
      className={className ?? "p-1.5 rounded-lg transition-opacity hover:opacity-70"}
      style={style ?? { color: "var(--muted)" }}
      aria-label={hidden ? t("home.portfolioHero.showBalance") : t("home.portfolioHero.hideBalance")}
      title={hidden ? t("home.portfolioHero.showBalance") : t("home.portfolioHero.hideBalance")}
    >
      {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
}
