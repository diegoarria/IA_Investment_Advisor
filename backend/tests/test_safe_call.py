"""
Tests — app.services.safe_call (Fase 3, Incremento 10).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import asyncio

import pytest

from app.services.safe_call import safe_call


class TestSafeCall:
    @pytest.mark.asyncio
    async def test_returns_the_real_result_on_success(self):
        async def ok():
            return 42
        assert await safe_call(ok(), None, "test") == 42

    @pytest.mark.asyncio
    async def test_returns_fallback_on_exception(self):
        async def fails():
            raise ValueError("boom")
        assert await safe_call(fails(), "fallback", "test") == "fallback"

    @pytest.mark.asyncio
    async def test_returns_fallback_on_timeout(self):
        async def slow():
            await asyncio.sleep(1)
            return "too late"
        assert await safe_call(slow(), "fallback", "test", timeout=0.01) == "fallback"

    @pytest.mark.asyncio
    async def test_never_raises(self):
        async def fails():
            raise RuntimeError("boom")
        # must not raise, regardless of context being present or not
        assert await safe_call(fails(), None, "test", context="AAPL") is None
