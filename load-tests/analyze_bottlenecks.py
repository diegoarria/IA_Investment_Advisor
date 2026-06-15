"""
Nuvos AI — Análisis Estático de Cuellos de Botella
====================================================

Script que audita el código fuente del backend e identifica:
  - Llamadas síncronas que bloquean el event loop
  - N+1 queries a Supabase
  - Falta de connection pooling
  - Endpoints sin caché
  - Operaciones bloqueantes en rutas async
  - ThreadPoolExecutors creados per-request (overhead)

Uso:
    cd /path/to/IA_Investment_Advisor
    python load-tests/analyze_bottlenecks.py

Genera: load-tests/reports/bottleneck_analysis.txt
"""

import ast
import os
import sys
import re
from pathlib import Path
from dataclasses import dataclass, field
from typing import List

ROUTES_DIR = Path(__file__).parent.parent / "backend" / "app" / "api" / "routes"
REPORT_FILE = Path(__file__).parent / "reports" / "bottleneck_analysis.txt"

@dataclass
class Issue:
    severity: str    # CRITICAL / HIGH / MEDIUM / LOW
    file:     str
    line:     int
    rule:     str
    detail:   str
    fix:      str

issues: List[Issue] = []


# ── Rule engine ───────────────────────────────────────────────────────────────

BLOCKING_PATTERNS = [
    # Pattern,                             Rule name
    (r"get_supabase\(\)\s*\n?\s*\.\w+",    "SYNC_SUPABASE_CALL"),
    (r"\.execute\(\)",                      "SYNC_DB_EXECUTE"),
    (r"redis\w*\.get\(",                    "SYNC_REDIS_GET"),
    (r"redis\w*\.set\(",                    "SYNC_REDIS_SET"),
    (r"ThreadPoolExecutor\(",               "PER_REQUEST_THREAD_POOL"),
    (r"time\.sleep\(",                      "BLOCKING_SLEEP"),
    (r"requests\.get\(",                    "SYNC_HTTP_REQUESTS"),
    (r"requests\.post\(",                   "SYNC_HTTP_REQUESTS"),
]

DB_LOOP_PATTERN = re.compile(r"for .+:\s*\n.{0,20}\.table\(", re.MULTILINE)
MISSING_CACHE_PATTERN = re.compile(r"@router\.(get|post)\(.*\)\s*\nasync def", re.MULTILINE)
CACHE_USAGE_PATTERN   = re.compile(r"cache_get\(|cache_set\(")


def analyze_file(path: Path) -> None:
    code = path.read_text(encoding="utf-8")
    lines = code.splitlines()
    fname = path.name

    # Rule 1: Supabase calls outside asyncio.to_thread
    in_async = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()

        if stripped.startswith("async def "):
            in_async = True
        elif stripped.startswith("def ") and not stripped.startswith("async def"):
            in_async = False

        # Supabase .execute() called directly in async context
        if in_async and ".execute()" in stripped and "asyncio.to_thread" not in stripped:
            # Check if it's inside a to_thread callback (heuristic: indented function)
            context_lines = lines[max(0, i-10):i]
            in_thread = any("asyncio.to_thread" in l or "def _" in l for l in context_lines)
            if not in_thread:
                issues.append(Issue(
                    severity="CRITICAL",
                    file=fname, line=i,
                    rule="SYNC_DB_IN_ASYNC",
                    detail=f"Supabase .execute() called synchronously in async context: {stripped[:80]}",
                    fix="Wrap in asyncio.to_thread() or switch to supabase-py's async client (AsyncClient)"
                ))

    # Rule 2: per-request ThreadPoolExecutor
    for i, line in enumerate(lines, 1):
        if "ThreadPoolExecutor(" in line and "with " in line:
            # Check if this is inside a route handler (not a module-level function)
            issues.append(Issue(
                severity="HIGH",
                file=fname, line=i,
                rule="PER_REQUEST_THREAD_POOL",
                detail=f"ThreadPoolExecutor created per request: {line.strip()[:80]}",
                fix="Create a module-level thread pool and reuse it: _pool = ThreadPoolExecutor(max_workers=20)"
            ))

    # Rule 3: Potential N+1 — DB call inside a for loop
    for m in DB_LOOP_PATTERN.finditer(code):
        lineno = code[:m.start()].count("\n") + 1
        issues.append(Issue(
            severity="HIGH",
            file=fname, line=lineno,
            rule="POTENTIAL_N_PLUS_1",
            detail="DB .table() call appears inside a for loop — possible N+1 query pattern",
            fix="Batch the IDs and do a single .in_() query, or prefetch all data before the loop"
        ))

    # Rule 4: Async routes with no cache
    route_matches = list(MISSING_CACHE_PATTERN.finditer(code))
    has_cache = bool(CACHE_USAGE_PATTERN.search(code))
    if route_matches and not has_cache:
        issues.append(Issue(
            severity="MEDIUM",
            file=fname, line=1,
            rule="NO_CACHE_IN_FILE",
            detail=f"{len(route_matches)} route(s) found but NO cache_get/cache_set usage in file",
            fix="Add caching for read-heavy endpoints (e.g., notifications, watchlist) with TTL 30-300 s"
        ))

    # Rule 5: Blocking time.sleep in async routes
    for i, line in enumerate(lines, 1):
        if "time.sleep(" in line:
            issues.append(Issue(
                severity="HIGH",
                file=fname, line=i,
                rule="BLOCKING_SLEEP",
                detail=f"time.sleep() blocks the event loop: {line.strip()[:80]}",
                fix="Replace with 'await asyncio.sleep()'"
            ))

    # Rule 6: Sync requests library
    for i, line in enumerate(lines, 1):
        if re.search(r"\brequests\.(get|post|put|delete)\b", line):
            issues.append(Issue(
                severity="HIGH",
                file=fname, line=i,
                rule="SYNC_HTTP_CLIENT",
                detail=f"Synchronous requests library used: {line.strip()[:80]}",
                fix="Replace with httpx.AsyncClient or wrap in asyncio.to_thread()"
            ))


def check_single_worker() -> None:
    procfile = Path(__file__).parent.parent / "backend" / "Procfile"
    if procfile.exists():
        content = procfile.read_text()
        if "uvicorn" in content and "--workers" not in content and "WEB_CONCURRENCY" not in content:
            issues.append(Issue(
                severity="CRITICAL",
                file="Procfile", line=1,
                rule="SINGLE_UVICORN_WORKER",
                detail="Procfile starts uvicorn without --workers flag → single-process server",
                fix=(
                    "Add --workers $(nproc) or use gunicorn:\n"
                    "  web: gunicorn main:app -k uvicorn.workers.UvicornWorker -w 4 --bind 0.0.0.0:$PORT\n"
                    "Or set WEB_CONCURRENCY env var on Railway/Render"
                )
            ))

def check_db_singleton() -> None:
    db_file = Path(__file__).parent.parent / "backend" / "app" / "core" / "database.py"
    if db_file.exists():
        content = db_file.read_text()
        if "create_client" in content and "AsyncClient" not in content:
            issues.append(Issue(
                severity="CRITICAL",
                file="core/database.py", line=1,
                rule="SYNC_SUPABASE_CLIENT",
                detail="Using synchronous supabase-py Client — all DB calls block the asyncio event loop",
                fix=(
                    "Switch to AsyncClient:\n"
                    "  from supabase._async.client import AsyncClient, create_async_client\n"
                    "  async def get_supabase() -> AsyncClient:\n"
                    "      return await create_async_client(url, key)"
                )
            ))

def check_no_connection_pool() -> None:
    issues.append(Issue(
        severity="MEDIUM",
        file="core/database.py", line=1,
        rule="NO_PG_CONNECTION_POOL",
        detail="Supabase REST (PostgREST) handles connection pooling, but direct Postgres access has no explicit pgBouncer config",
        fix="Enable PgBouncer in Supabase dashboard (Transaction mode) for high-concurrency writes. For direct psycopg2 use: asyncpg with min_size=5, max_size=20"
    ))

def check_redis_config() -> None:
    cache_file = Path(__file__).parent.parent / "backend" / "app" / "core" / "cache.py"
    if cache_file.exists():
        content = cache_file.read_text()
        if "socket_timeout=2" in content and "max_connections" not in content:
            issues.append(Issue(
                severity="MEDIUM",
                file="core/cache.py", line=1,
                rule="NO_REDIS_POOL_SIZE",
                detail="Redis client has no explicit connection pool size — defaults to 10 connections max",
                fix="Set max_connections: redis.from_url(url, max_connections=50, decode_responses=True)"
            ))
        if "_redis" in content and "BlockingConnectionPool" not in content:
            issues.append(Issue(
                severity="LOW",
                file="core/cache.py", line=1,
                rule="NON_BLOCKING_REDIS_POOL",
                detail="Redis uses non-blocking pool — under load, connection exhaustion returns None silently",
                fix="Use BlockingConnectionPool with timeout: redis.BlockingConnectionPool(max_connections=50, timeout=5)"
            ))

def check_anthropic_semaphore() -> None:
    market_file = Path(__file__).parent.parent / "backend" / "app" / "api" / "routes" / "market.py"
    if market_file.exists():
        content = market_file.read_text()
        if "Semaphore(10)" in content:
            issues.append(Issue(
                severity="MEDIUM",
                file="routes/market.py", line=1,
                rule="ANTHROPIC_CONCURRENCY_LIMIT",
                detail="Screenshot/PDF endpoint limited to 10 concurrent Anthropic calls (threading.Semaphore(10))",
                fix="This is actually correct. Ensure the Anthropic tier supports 10+ concurrent requests. Consider a queue for overflow."
            ))

def print_report() -> None:
    REPORT_FILE.parent.mkdir(exist_ok=True)

    severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    sorted_issues = sorted(issues, key=lambda x: severity_order.get(x.severity, 99))

    counts = {s: sum(1 for i in issues if i.severity == s) for s in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]}

    lines_out = []
    lines_out.append("=" * 70)
    lines_out.append("  NUVOS AI — BOTTLENECK ANALYSIS REPORT")
    lines_out.append(f"  Generado: {__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines_out.append("=" * 70)
    lines_out.append(f"  CRITICAL: {counts['CRITICAL']}  |  HIGH: {counts['HIGH']}  |  MEDIUM: {counts['MEDIUM']}  |  LOW: {counts['LOW']}")
    lines_out.append("=" * 70)

    for issue in sorted_issues:
        icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵"}.get(issue.severity, "⚪")
        lines_out.append(f"\n{icon} [{issue.severity}] {issue.rule}")
        lines_out.append(f"   File: {issue.file}:{issue.line}")
        lines_out.append(f"   Issue: {issue.detail}")
        lines_out.append(f"   Fix:   {issue.fix}")

    lines_out.append("\n" + "=" * 70)
    lines_out.append("  PRIORITY FIX LIST (ordered by impact on scalability):")
    lines_out.append("=" * 70)
    lines_out.append("  1. [CRITICAL] Switch Supabase to AsyncClient — every DB call currently blocks the event loop")
    lines_out.append("  2. [CRITICAL] Add --workers 4 to uvicorn (or use gunicorn) — currently single-process")
    lines_out.append("  3. [HIGH]     Reuse module-level ThreadPoolExecutors instead of creating per-request")
    lines_out.append("  4. [HIGH]     Increase Redis connection pool size to 50+")
    lines_out.append("  5. [MEDIUM]   Add caching to notifications, watchlist, and profile endpoints")
    lines_out.append("  6. [MEDIUM]   Enable PgBouncer in Supabase for transaction-mode connection pooling")
    lines_out.append("=" * 70)

    report = "\n".join(lines_out)
    print(report)
    REPORT_FILE.write_text(report)
    print(f"\n  Report saved to: {REPORT_FILE}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Analyzing backend routes...")

    check_single_worker()
    check_db_singleton()
    check_no_connection_pool()
    check_redis_config()
    check_anthropic_semaphore()

    for py_file in sorted(ROUTES_DIR.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        print(f"  Scanning {py_file.name}...")
        try:
            analyze_file(py_file)
        except Exception as e:
            print(f"    ERROR: {e}")

    print_report()
