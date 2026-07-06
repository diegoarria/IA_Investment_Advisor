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
    "VOO": "Vanguard S&P 500", "SPY": "S&P 500", "IVV": "S&P 500",
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
    "JNJ": "Johnson & Johnson", "PFE": "Pfizer", "ABBV": "AbbVie", "UNH": "UnitedHealth",
    "MRK": "Merck", "XOM": "ExxonMobil", "CVX": "Chevron",
    "KO": "Coca-Cola", "PEP": "PepsiCo", "WMT": "Walmart", "COST": "Costco",
    "HD": "Home Depot", "MCD": "McDonald's", "NKE": "Nike", "BA": "Boeing",
    "CAT": "Caterpillar", "PG": "Procter & Gamble", "VZ": "Verizon",
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


def _speechify(text: str) -> str:
    """Replace bare tickers and quarter shorthand (Q1 2026) with how they'd
    actually be said out loud."""
    text = _QUARTER_RE.sub(_quarter_to_speech, text)
    return _TICKER_SPEECH_RE.sub(lambda m: _TICKER_SPEECH_MAP[m.group(1)], text)


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
