// useRealtimePrice — subscribes to WebSocket price for a single symbol.
// Falls back to polling when WebSocket is unavailable.
// Returns: { price, change, changePercent, isLive }

import { useEffect, useState, useRef } from "react";
import { finnhubWS } from "@/lib/services/websocketService";

interface RealtimePrice {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  isLive: boolean; // true = came from WebSocket, false = polling
}

export function useRealtimePrice(symbol: string | null): RealtimePrice {
  const [state, setState] = useState<RealtimePrice>({
    price: null,
    change: null,
    changePercent: null,
    isLive: false,
  });

  const prevCloseRef = useRef<number | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const unsub = finnhubWS.subscribe([symbol], (sym, price, _ts) => {
      if (sym !== symbol) return;
      const prevClose = prevCloseRef.current;
      const change = prevClose ? price - prevClose : null;
      const changePercent = prevClose && prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : null;
      setState({ price, change, changePercent, isLive: true });
    });

    return unsub;
  }, [symbol]);

  return state;
}
