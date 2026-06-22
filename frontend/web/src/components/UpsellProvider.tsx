"use client";

import { useEffect } from "react";
import { useUpsellStore } from "@/lib/upsellStore";
import UpsellModal from "@/components/UpsellModal";

export default function UpsellProvider() {
  const { trigger, activeOffer, userTier, prices, triggerSource, dismiss } = useUpsellStore();

  useEffect(() => {
    // Delay session_start check so auth can load first
    const t = setTimeout(() => trigger("session_start"), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!activeOffer) return null;

  return (
    <UpsellModal
      offer={activeOffer}
      userTier={userTier}
      prices={prices}
      triggerSource={triggerSource ?? undefined}
      onClose={dismiss}
    />
  );
}
