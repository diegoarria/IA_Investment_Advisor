"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import StockDetailModal from "@/components/StockDetailModal";

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const router = useRouter();
  return <StockDetailModal ticker={ticker.toUpperCase()} onClose={() => router.back()} />;
}
