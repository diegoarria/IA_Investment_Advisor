"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
// Fase 4, Incremento 13 (Cierre, Parte M) — see portfolio/page.tsx's comment.
const StockDetailModal = dynamic(() => import("@/components/StockDetailModal"), { ssr: false });

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const router = useRouter();
  return <StockDetailModal ticker={ticker.toUpperCase()} onClose={() => router.back()} />;
}
