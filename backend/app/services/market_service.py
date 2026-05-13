import yfinance as yf
from datetime import datetime, timedelta
import pandas as pd


def get_asset_data(symbol: str) -> dict:
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        hist = ticker.history(period="1y")
        current_price = hist["Close"].iloc[-1] if not hist.empty else None
        year_ago_price = hist["Close"].iloc[0] if not hist.empty else None
        ytd_return = None
        if current_price and year_ago_price:
            ytd_return = round(((current_price - year_ago_price) / year_ago_price) * 100, 2)

        volatility = None
        if not hist.empty and len(hist) > 20:
            daily_returns = hist["Close"].pct_change().dropna()
            volatility = round(daily_returns.std() * (252 ** 0.5) * 100, 2)

        return {
            "symbol": symbol,
            "name": info.get("longName", symbol),
            "sector": info.get("sector", "N/A"),
            "industry": info.get("industry", "N/A"),
            "current_price": round(current_price, 2) if current_price else None,
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "revenue_growth": info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            "profit_margin": info.get("profitMargins"),
            "debt_to_equity": info.get("debtToEquity"),
            "return_on_equity": info.get("returnOnEquity"),
            "ytd_return_pct": ytd_return,
            "annual_volatility_pct": volatility,
            "52_week_high": info.get("fiftyTwoWeekHigh"),
            "52_week_low": info.get("fiftyTwoWeekLow"),
            "dividend_yield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "description": info.get("longBusinessSummary", "")[:500] if info.get("longBusinessSummary") else None,
            "employee_count": info.get("fullTimeEmployees"),
            "next_earnings_date": str(info.get("earningsTimestamp", "")) if info.get("earningsTimestamp") else None,
        }
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


def get_multiple_assets(symbols: list[str]) -> dict:
    return {symbol: get_asset_data(symbol) for symbol in symbols}


def get_market_summary() -> dict:
    indices = {
        "S&P 500": "^GSPC",
        "NASDAQ": "^IXIC",
        "Dow Jones": "^DJI",
        "VIX (Volatilidad)": "^VIX",
    }
    summary = {}
    for name, symbol in indices.items():
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5d")
            if not hist.empty and len(hist) >= 2:
                current = hist["Close"].iloc[-1]
                prev = hist["Close"].iloc[-2]
                change_pct = ((current - prev) / prev) * 100
                summary[name] = {
                    "value": round(current, 2),
                    "change_pct": round(change_pct, 2),
                    "direction": "up" if change_pct > 0 else "down"
                }
        except Exception:
            pass
    return summary


def detect_significant_moves(threshold_pct: float = 3.0) -> list[dict]:
    watchlist = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"]
    moves = []
    for symbol in watchlist:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="2d")
            if len(hist) >= 2:
                current = hist["Close"].iloc[-1]
                prev = hist["Close"].iloc[-2]
                change_pct = ((current - prev) / prev) * 100
                if abs(change_pct) >= threshold_pct:
                    moves.append({
                        "symbol": symbol,
                        "change_pct": round(change_pct, 2),
                        "direction": "up" if change_pct > 0 else "down",
                        "current_price": round(current, 2)
                    })
        except Exception:
            pass
    return sorted(moves, key=lambda x: abs(x["change_pct"]), reverse=True)


def get_upcoming_earnings(symbols: list[str] | None = None) -> list[dict]:
    default_symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD"]
    targets = symbols or default_symbols
    upcoming = []
    for symbol in targets:
        try:
            ticker = yf.Ticker(symbol)
            cal = ticker.calendar
            if cal is not None and not cal.empty:
                if "Earnings Date" in cal.index:
                    earnings_date = cal.loc["Earnings Date"].iloc[0]
                    if isinstance(earnings_date, pd.Timestamp):
                        days_until = (earnings_date.date() - datetime.now().date()).days
                        if 0 <= days_until <= 14:
                            upcoming.append({
                                "symbol": symbol,
                                "earnings_date": str(earnings_date.date()),
                                "days_until": days_until
                            })
        except Exception:
            pass
    return sorted(upcoming, key=lambda x: x["days_until"])
