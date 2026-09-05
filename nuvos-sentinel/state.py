"""Local SQLite persistence for the Sentinel's own state — deliberately NOT
Supabase: this service must keep working (and remember its debounce state
across restarts) even if Nuvos's own database is the thing that's down.
A small single-process, low-write-volume monitor doesn't need more than
this."""
import sqlite3
import time
from contextlib import contextmanager
from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS check_state (
  kind TEXT PRIMARY KEY,
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  consecutive_ok INTEGER NOT NULL DEFAULT 0,
  is_down INTEGER NOT NULL DEFAULT 0,
  last_alert_at REAL,
  last_detail TEXT
);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  opened_at REAL NOT NULL,
  closed_at REAL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS flagged_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER,
  ip TEXT NOT NULL,
  event_count INTEGER,
  device TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT,
  isp TEXT,
  organization TEXT,
  asn TEXT,
  connection_type TEXT,
  is_vpn INTEGER,
  is_tor INTEGER,
  is_proxy INTEGER,
  fraud_score INTEGER,
  flagged_at REAL NOT NULL
);
"""


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _conn() as conn:
        conn.executescript(_SCHEMA)


def get_state(kind: str) -> dict:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM check_state WHERE kind = ?", (kind,)).fetchone()
        if row:
            return dict(row)
        conn.execute(
            "INSERT INTO check_state (kind, consecutive_fails, consecutive_ok, is_down) VALUES (?, 0, 0, 0)",
            (kind,),
        )
        return {"kind": kind, "consecutive_fails": 0, "consecutive_ok": 0, "is_down": 0, "last_alert_at": None, "last_detail": None}


def save_state(kind: str, **fields) -> None:
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _conn() as conn:
        conn.execute(f"UPDATE check_state SET {cols} WHERE kind = ?", (*fields.values(), kind))


def open_incident(kind: str, detail: str) -> int:
    with _conn() as conn:
        cur = conn.execute(
            "INSERT INTO incidents (kind, opened_at, detail) VALUES (?, ?, ?)",
            (kind, time.time(), detail),
        )
        return cur.lastrowid


def close_incident(kind: str) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE incidents SET closed_at = ? WHERE kind = ? AND closed_at IS NULL",
            (time.time(), kind),
        )


def recent_incidents(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM incidents ORDER BY opened_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def all_states() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM check_state").fetchall()
        return [dict(r) for r in rows]


def save_flagged_ip(incident_id: int | None, ip: str, event_count: int, device: str | None, intel: dict) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO flagged_ips
               (incident_id, ip, event_count, device, city, region, postal_code, country,
                isp, organization, asn, connection_type, is_vpn, is_tor, is_proxy, fraud_score, flagged_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                incident_id, ip, event_count, device,
                intel.get("city"), intel.get("region"), intel.get("postal_code"), intel.get("country"),
                intel.get("isp"), intel.get("organization"), intel.get("asn"), intel.get("connection_type"),
                int(bool(intel.get("is_vpn"))), int(bool(intel.get("is_tor"))), int(bool(intel.get("is_proxy"))),
                intel.get("fraud_score"), time.time(),
            ),
        )


def recent_flagged_ips(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM flagged_ips ORDER BY flagged_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def cleanup_old(days: int = 90) -> dict:
    """Prunes CLOSED incidents (and the flagged_ips tied to them) older than
    `days` — an open/ongoing incident is never deleted regardless of age.
    Without this, incidents/flagged_ips grow forever; a small SQLite file on
    a low-write monitor doesn't need more history than this to be useful."""
    cutoff = time.time() - days * 86400
    with _conn() as conn:
        old_ids = [r[0] for r in conn.execute(
            "SELECT id FROM incidents WHERE closed_at IS NOT NULL AND closed_at < ?", (cutoff,)
        ).fetchall()]
        if not old_ids:
            return {"incidents_deleted": 0, "flagged_ips_deleted": 0}
        placeholders = ",".join("?" * len(old_ids))
        fi_cur = conn.execute(f"DELETE FROM flagged_ips WHERE incident_id IN ({placeholders})", old_ids)
        inc_cur = conn.execute(f"DELETE FROM incidents WHERE id IN ({placeholders})", old_ids)
        # Orphaned flagged_ips from before incident linking existed, or any
        # row whose incident_id is null — prune by its own age directly.
        conn.execute("DELETE FROM flagged_ips WHERE incident_id IS NULL AND flagged_at < ?", (cutoff,))
        return {"incidents_deleted": inc_cur.rowcount, "flagged_ips_deleted": fi_cur.rowcount}


def uptime_percentage(kind: str, window_seconds: float) -> float:
    """% of the last `window_seconds` where `kind` was NOT in a down
    incident. Sums overlap of each incident with the window — an incident
    still open counts as down through "now"."""
    now = time.time()
    window_start = now - window_seconds
    with _conn() as conn:
        rows = conn.execute(
            "SELECT opened_at, closed_at FROM incidents WHERE kind = ? AND (closed_at IS NULL OR closed_at > ?)",
            (kind, window_start),
        ).fetchall()
    down_seconds = 0.0
    for r in rows:
        start = max(r["opened_at"], window_start)
        end = min(r["closed_at"] if r["closed_at"] is not None else now, now)
        if end > start:
            down_seconds += end - start
    return max(0.0, min(1.0, 1 - (down_seconds / window_seconds))) * 100


def daily_incident_days(kind: str, days: int = 14) -> set[str]:
    """Set of 'YYYY-MM-DD' day-strings (local server time) that had at least
    one incident for `kind`, over the last `days` — cheap sparkline data,
    no need for per-second precision."""
    cutoff = time.time() - days * 86400
    with _conn() as conn:
        rows = conn.execute(
            "SELECT opened_at, closed_at FROM incidents WHERE kind = ? AND (closed_at IS NULL OR closed_at > ?)",
            (kind, cutoff),
        ).fetchall()
    day_set: set[str] = set()
    for r in rows:
        start = r["opened_at"]
        end = r["closed_at"] if r["closed_at"] is not None else time.time()
        day = int(start // 86400)
        end_day = int(end // 86400)
        while day <= end_day:
            day_set.add(time.strftime("%Y-%m-%d", time.gmtime(day * 86400)))
            day += 1
    return day_set
