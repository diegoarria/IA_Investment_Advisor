"""
SSRF (Server-Side Request Forgery) guard for any endpoint that fetches a
URL supplied by a client — e.g. /market/summarize-news's article scraper.

Validates scheme + resolves the hostname and rejects anything pointing at a
private/loopback/link-local/reserved address (RFC 1918 ranges, 127.0.0.0/8,
169.254.0.0/16 including the cloud metadata endpoint, etc.) — otherwise an
authenticated user could point the server at its own internal network
(Railway's internal services, localhost, cloud metadata) and have the
result reflected back to them.

is_safe_redirect_target() re-validates on every hop when manually following
redirects, closing the "safe URL that 302s to an internal one" bypass that
a plain httpx.AsyncClient(follow_redirects=True) wouldn't catch.
"""

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

_ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_HOSTNAMES = {"localhost", "localhost.localdomain", "0.0.0.0", "metadata.google.internal"}


def _hostname_resolves_safely(hostname: str) -> bool:
    if not hostname or hostname.lower() in _BLOCKED_HOSTNAMES:
        return False
    try:
        addrs = socket.getaddrinfo(hostname, None)
    except Exception:
        # Can't resolve — treat as unsafe rather than letting a DNS hiccup
        # silently allow an unvalidated fetch through.
        return False
    if not addrs:
        return False
    for family, _type, _proto, _canon, sockaddr in addrs:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if (
            ip.is_private or ip.is_loopback or ip.is_link_local
            or ip.is_reserved or ip.is_multicast or ip.is_unspecified
        ):
            return False
    return True


def is_safe_external_url(url: str) -> bool:
    """True only for an http(s) URL whose hostname resolves exclusively to
    public IP addresses. Call again on every redirect hop — don't just
    check the original URL and then blindly follow redirects."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in _ALLOWED_SCHEMES:
        return False
    return _hostname_resolves_safely(parsed.hostname or "")


async def fetch_external_url(client, url: str, *, headers: dict | None = None, max_redirects: int = 5):
    """GET a client-supplied URL with SSRF protection: validates the
    hostname before every request, including every redirect hop, instead of
    trusting httpx's own follow_redirects=True (which never re-validates a
    Location header against a blocklist). `client` must be an
    httpx.AsyncClient constructed WITHOUT follow_redirects=True.

    Returns the final response, or None if the URL (or any redirect target)
    resolves to a non-public address, or too many redirects occur."""
    current = url
    for _ in range(max_redirects + 1):
        if not is_safe_external_url(current):
            return None
        resp = await client.get(current, headers=headers)
        if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
            current = urljoin(current, resp.headers["location"])
            continue
        return resp
    return None
