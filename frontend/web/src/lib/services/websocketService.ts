// Finnhub WebSocket service — wss://ws.finnhub.io?token=<API_KEY>
// Real-time trade events: { type:"trade", data:[{ p, s, t, v }] }
//
// Usage:
//   const ws = FinnhubWebSocket.getInstance();
//   ws.subscribe(["AAPL", "GOOGL"], (sym, price, ts) => { ... });
//   ws.unsubscribe(["AAPL"]);

import type { FinnhubMessage } from "@/lib/types/stock";

type PriceCallback = (symbol: string, price: number, timestamp: number) => void;

const WS_URL = "wss://ws.finnhub.io";
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // exponential backoff

class FinnhubWebSocket {
  private static instance: FinnhubWebSocket | null = null;

  private ws: WebSocket | null = null;
  private token: string | null = null;
  private subscribed = new Set<string>();
  private listeners = new Map<string, Set<PriceCallback>>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private tokenFetched = false;

  private constructor() {}

  static getInstance(): FinnhubWebSocket {
    if (!FinnhubWebSocket.instance) {
      FinnhubWebSocket.instance = new FinnhubWebSocket();
    }
    return FinnhubWebSocket.instance;
  }

  // Fetch WS token from our authenticated backend (keeps key server-side)
  private async fetchToken(): Promise<string | null> {
    if (this.token) return this.token;
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/market/ws-token`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      const data = await res.json() as { token?: string };
      this.token = data.token ?? null;
      return this.token;
    } catch {
      return null;
    }
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (!this.tokenFetched) {
      this.tokenFetched = true;
      await this.fetchToken();
    }
    if (!this.token) return; // no Finnhub key — polling fallback handles it

    this.intentionallyClosed = false;
    const url = `${WS_URL}?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      // Re-subscribe all symbols after reconnect
      this.subscribed.forEach((sym) => this.sendSubscribe(sym));
    });

    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as FinnhubMessage;
        if (msg.type !== "trade" || !msg.data) return;
        for (const trade of msg.data) {
          const cbs = this.listeners.get(trade.s);
          if (cbs) cbs.forEach((cb) => cb(trade.s, trade.p, trade.t));
        }
      } catch { /* malformed */ }
    });

    this.ws.addEventListener("close", () => {
      if (!this.intentionallyClosed) this.scheduleReconnect();
    });

    this.ws.addEventListener("error", () => {
      this.ws?.close();
    });
  }

  private sendSubscribe(symbol: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "subscribe", symbol }));
    }
  }

  private sendUnsubscribe(symbol: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "unsubscribe", symbol }));
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // Add a price listener for a symbol. Connects WS automatically.
  subscribe(symbols: string[], callback: PriceCallback): () => void {
    for (const sym of symbols) {
      if (!this.listeners.has(sym)) this.listeners.set(sym, new Set());
      this.listeners.get(sym)!.add(callback);

      if (!this.subscribed.has(sym)) {
        this.subscribed.add(sym);
        this.sendSubscribe(sym);
      }
    }
    // Connect on first subscriber
    if (!this.ws) this.connect();

    return () => this.unsubscribe(symbols, callback);
  }

  unsubscribe(symbols: string[], callback?: PriceCallback) {
    for (const sym of symbols) {
      const cbs = this.listeners.get(sym);
      if (!cbs) continue;
      if (callback) cbs.delete(callback);
      else cbs.clear();

      if (cbs.size === 0) {
        this.listeners.delete(sym);
        this.subscribed.delete(sym);
        this.sendUnsubscribe(sym);
      }
    }
  }

  disconnect() {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const finnhubWS = FinnhubWebSocket.getInstance();
export type { PriceCallback };
