// useStockData — subscribes to real-time + enriched stock data for a list of symbols.
// Combines WebSocket prices (when available) with REST-polled enriched data.
//
// Usage:
//   const { data, isLoading, isOnline } = useStockData(["AAPL", "GOOGL", "NVDA"]);

import { useEffect, useState, useRef, useCallback } from "react";
import { subscribeRealtime, unsubscribeRealtime } from "@/lib/services/stockService";
import type { StockData } from "@/lib/types/stock";

interface UseStockDataResult {
  data: Map<string, StockData>;
  isLoading: boolean;
  isOnline: boolean;
  refresh: () => void;
}

export function useStockData(symbols: string[]): UseStockDataResult {
  const [data, setData] = useState<Map<string, StockData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const symbolsKey = symbols.join(",");
  const unsubRef = useRef<(() => void) | null>(null);

  const handleUpdate = useCallback((stock: StockData) => {
    setData((prev) => {
      const next = new Map(prev);
      next.set(stock.symbol, stock);
      return next;
    });
    setIsLoading(false);
    setIsOnline(true);
  }, []);

  const subscribe = useCallback(async () => {
    if (!symbols.length) { setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const unsub = await subscribeRealtime(symbols, handleUpdate);
      unsubRef.current = unsub;
    } catch {
      setIsOnline(false);
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  useEffect(() => {
    subscribe();
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [subscribe]);

  // Offline/online detection
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const refresh = useCallback(() => {
    unsubRef.current?.();
    subscribe();
  }, [subscribe]);

  return { data, isLoading, isOnline, refresh };
}
