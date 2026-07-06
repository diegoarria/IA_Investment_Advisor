"""Shared speech I/O — Whisper STT + ElevenLabs/OpenAI TTS as raw bytes.
Used by both the turn-based /chat/transcribe + /chat/speak HTTP endpoints
and the real-time voice-call WebSocket pipeline, so the two never drift."""
import base64
import logging
import os

logger = logging.getLogger(__name__)


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

    eleven_key = os.getenv("ELEVENLABS_API_KEY")
    if eleven_key:
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "SOYHLrjzK2X1ezoPC6cr")
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
