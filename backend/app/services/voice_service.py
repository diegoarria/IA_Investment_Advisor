"""Shared speech I/O — Whisper STT + ElevenLabs/OpenAI TTS as raw bytes.
Used by both the turn-based /chat/transcribe + /chat/speak HTTP endpoints
and the real-time voice-call WebSocket pipeline, so the two never drift."""
import base64
import logging
import os
import re

logger = logging.getLogger(__name__)

# TTS engines mangle bare ticker letters (spelling "VOO" or "QQQM" out loud is
# unnatural, and 4-letter clusters like "NFLX" often get mispronounced as a
# word). Swap known tickers for how a person would actually say them in
# conversation before the text ever reaches the TTS provider.
_TICKER_SPEECH_MAP: dict[str, str] = {
    # Broad-market / index ETFs — say the fund/index, not the letters.
    # No leading article ("el"/"la") here: the surrounding sentence usually
    # already has one ("El VTI es..." → "El Vanguard Total Market es...").
    "VOO": "Vanguard S and P 500", "SPY": "S and P 500", "IVV": "S and P 500",
    "VTI": "Vanguard Total Market", "QQQ": "Nasdaq 100", "QQQM": "Nasdaq 100",
    "IWM": "Russell 2000", "DIA": "Dow Jones",
    "VXUS": "Vanguard mercados internacionales", "VEA": "Vanguard mercados desarrollados",
    "VWO": "Vanguard mercados emergentes", "BND": "Vanguard de bonos",
    "SCHD": "Schwab de dividendos", "VYM": "Vanguard de alto dividendo",
    "ARKK": "ARK Innovation",
    # Companies — say the name, not the ticker
    "AAPL": "Apple", "MSFT": "Microsoft", "GOOGL": "Alphabet", "GOOG": "Alphabet",
    "AMZN": "Amazon", "META": "Meta", "TSLA": "Tesla", "NVDA": "NVIDIA",
    "NFLX": "Netflix", "SPOT": "Spotify", "DIS": "Disney", "INTC": "Intel",
    "ORCL": "Oracle", "CRM": "Salesforce", "ADBE": "Adobe", "SBUX": "Starbucks",
    "JPM": "JPMorgan", "BAC": "Bank of America",
    "GS": "Goldman Sachs", "WFC": "Wells Fargo",
    "JNJ": "Johnson y Johnson", "PFE": "Pfizer", "ABBV": "AbbVie", "UNH": "UnitedHealth",
    "MRK": "Merck", "XOM": "ExxonMobil", "CVX": "Chevron",
    "KO": "Coca-Cola", "PEP": "PepsiCo", "WMT": "Walmart", "COST": "Costco",
    "HD": "Home Depot", "MCD": "McDonald's", "NKE": "Nike", "BA": "Boeing",
    "CAT": "Caterpillar", "PG": "Procter y Gamble", "VZ": "Verizon",
    "PLTR": "Palantir", "COIN": "Coinbase", "SOFI": "SoFi", "RKLB": "Rocket Lab",
    "MSTR": "MicroStrategy", "SMCI": "Super Micro", "SHOP": "Shopify", "SQ": "Block",
    "PYPL": "PayPal", "UBER": "Uber", "ABNB": "Airbnb", "RIVN": "Rivian",
    "LCID": "Lucid", "BABA": "Alibaba", "TSM": "TSMC", "ASML": "ASML",
    "SNOW": "Snowflake", "DDOG": "Datadog", "CRWD": "CrowdStrike", "PANW": "Palo Alto",
    "AVGO": "Broadcom", "QCOM": "Qualcomm", "MU": "Micron", "AMD": "AMD",
    "BRK-B": "Berkshire Hathaway", "BRK.B": "Berkshire Hathaway",
}

_TICKER_SPEECH_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in sorted(_TICKER_SPEECH_MAP, key=len, reverse=True)) + r")\b"
)


_QUARTER_RE = re.compile(r"\bQ([1-4])(?:\s*[-/']?\s*(\d{2,4}))?\b")


def _quarter_to_speech(m: re.Match) -> str:
    q = m.group(1)
    year = m.group(2)
    if not year:
        return f"trimestre {q}"
    year = year if len(year) == 4 else f"20{year}"
    return f"trimestre {q} del {year}"


# Financial acronyms/abbreviations that read naturally as LETTERS when a human
# says them (IPO, CEO...) still trip TTS engines into spelling them out
# letter-by-letter, which sounds robotic. Say what they mean instead — this is
# the "humanized" pass, distinct from the ticker map above (which swaps a
# ticker for a proper noun, not an acronym for its meaning).
_ACRONYM_SPEECH_MAP: dict[str, str] = {
    "ETFs": "fondos cotizados", "ETF": "fondo cotizado",
    "IPO": "salida a bolsa", "IPOs": "salidas a bolsa",
    "CEO": "director ejecutivo", "CFO": "director financiero", "COO": "director de operaciones",
    "ROI": "retorno de inversión", "ROE": "retorno sobre el capital",
    "ROIC": "retorno sobre el capital invertido",
    "DCF": "flujo de caja descontado", "EPS": "utilidad por acción",
    "GDP": "producto interno bruto", "APR": "tasa de interés anual",
    "P/E": "relación precio-ganancia", "P&L": "pérdidas y ganancias",
}

_ACRONYM_SPEECH_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in sorted(_ACRONYM_SPEECH_MAP, key=len, reverse=True)) + r")\b"
)

# "&" read as a bare symbol is a common trigger for the same letter-spelling
# glitch (e.g. "S&P 500" → "ese, ampersand, pe..."). "S&P" specifically keeps
# its real-world spoken form ("S and P"); anything else just becomes "y".
_SP_INDEX_RE = re.compile(r"\bS&P\b")
_AMPERSAND_RE = re.compile(r"\s*&\s*")

# "$2.3B" / "500K" / "1.5M" read digit-by-digit-then-a-lone-letter is another
# common glitch — spell out the magnitude word instead.
_MAGNITUDE_RE = re.compile(r"\b(\d+(?:[.,]\d+)?)\s*(K|M|B)\b")
_MAGNITUDE_WORDS = {"K": "mil", "M": "millones", "B": "mil millones"}


def _magnitude_to_speech(m: re.Match) -> str:
    return f"{m.group(1)} {_MAGNITUDE_WORDS[m.group(2)]}"


def _speechify(text: str) -> str:
    """Replace bare tickers, quarter shorthand, financial acronyms, "&", and
    abbreviated amounts with how they'd actually be said out loud — the goal
    is to never hand the TTS engine a token it might spell out letter by
    letter instead of speaking naturally."""
    text = _QUARTER_RE.sub(_quarter_to_speech, text)
    text = _MAGNITUDE_RE.sub(_magnitude_to_speech, text)
    text = _ACRONYM_SPEECH_RE.sub(lambda m: _ACRONYM_SPEECH_MAP[m.group(1)], text)
    text = _TICKER_SPEECH_RE.sub(lambda m: _TICKER_SPEECH_MAP[m.group(1)], text)
    text = _SP_INDEX_RE.sub("S and P", text)
    text = _AMPERSAND_RE.sub(" y ", text)
    return text


async def transcribe_audio_bytes(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    content_type: str = "audio/webm",
) -> str:
    """Whisper transcription (Spanish). Raises on failure — caller decides how to surface it."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Servicio de voz no configurado (OPENAI_API_KEY)")
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)
    transcript = await client.audio.transcriptions.create(
        model="whisper-1",
        file=(filename, audio_bytes, content_type),
        language="es",
    )
    return transcript.text


async def synthesize_speech_bytes(text: str) -> bytes:
    """Text → MP3 bytes. ElevenLabs if configured, else OpenAI TTS fallback."""
    text = (text or "").strip()[:2000]
    if not text:
        return b""
    text = _speechify(text)

    eleven_key = os.getenv("ELEVENLABS_API_KEY")
    if eleven_key:
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "jBDyTilUWfkS9aYMESCa")
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        payload = {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.45, "similarity_boost": 0.80, "style": 0.20, "use_speaker_boost": True},
        }
        headers = {"xi-api-key": eleven_key, "Content-Type": "application/json", "Accept": "audio/mpeg"}
        import httpx
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.content

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Servicio de voz no configurado")
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)
    response = await client.audio.speech.create(model="tts-1", voice="nova", input=text)
    return response.content


async def synthesize_speech_b64(text: str) -> str:
    audio = await synthesize_speech_bytes(text)
    return base64.b64encode(audio).decode()
