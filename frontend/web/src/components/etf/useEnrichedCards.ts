"use client";

// Nuvos ETF Fase 2B — progressive enrichment for a list of tickers.
// Fetches at most 6 at a time (matches the backend's _MAX_CARDS_PER_REQUEST
// cap) via GET /api/etf/cards, never the full ticker list in one call —
// this is the client half of "no consultar masivamente".

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { etfApi } from "@/lib/api";
import type { EtfCardData } from "./EtfCard";

const PAGE_SIZE = 6;

export function useEnrichedCards(tickers: string[]) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const [cards, setCards] = useState<Record<string, EtfCardData>>({});
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const tickersKey = tickers.join("|");
  const prevKeyRef = useRef<string>("");

  const loadMore = () => {
    const nextBatch = tickers.slice(loadedCount, loadedCount + PAGE_SIZE);
    if (nextBatch.length === 0 || loading) return;
    setLoading(true);
    setError(false);
    etfApi.getCards(nextBatch, lang)
      .then((res) => {
        const incoming: Record<string, EtfCardData> = {};
        for (const c of res.data?.cards ?? []) incoming[c.ticker] = c;
        setCards((prev) => ({ ...prev, ...incoming }));
        setLoadedCount((n) => n + nextBatch.length);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  // New ticker list (category switch, new search) — reset and load the
  // first page automatically. Same list reference content-wise: no-op.
  useEffect(() => {
    if (tickersKey === prevKeyRef.current) return;
    prevKeyRef.current = tickersKey;
    setCards({});
    setLoadedCount(0);
    setError(false);
    if (tickers.length === 0) return;
    setLoading(true);
    etfApi.getCards(tickers.slice(0, PAGE_SIZE), lang)
      .then((res) => {
        const incoming: Record<string, EtfCardData> = {};
        for (const c of res.data?.cards ?? []) incoming[c.ticker] = c;
        setCards(incoming);
        setLoadedCount(Math.min(PAGE_SIZE, tickers.length));
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey]);

  const orderedCards = tickers.slice(0, loadedCount).map((t) => cards[t]).filter(Boolean);
  const hasMore = loadedCount < tickers.length;

  return { cards: orderedCards, loading, error, hasMore, loadMore, loadedCount, total: tickers.length };
}
