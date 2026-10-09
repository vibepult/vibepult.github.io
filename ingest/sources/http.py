"""One throttled GET for every source. Shells out to curl: Metal Archives' Cloudflare
challenge rejects Python's TLS fingerprint but lets curl through."""
import subprocess
import time
from urllib.parse import urlparse

UA = "vibepult/0.1 (personal research; github.com/vibepult/vibepult)"
SPACING = {"itunes.apple.com": 3.5, "api.deezer.com": 1.0, "www.metal-archives.com": 3.0}
RETRY_ON = (0, 403, 429)  # 0: curl itself failed (DNS, reset, timeout)
ATTEMPTS = 3
BACKOFF = 10.0  # seconds, doubled per retry

_last = {}  # host -> monotonic time of the last request


class HTTPError(Exception):
    def __init__(self, url, status):
        super().__init__(f"HTTP {status} for {url}")
        self.status = status

    @property
    def transient(self):
        """The source is unwell (curl failed, blocked, throttled, 5xx): the request may succeed later."""
        return self.status in RETRY_ON or self.status >= 500


def _curl(url):
    """(status, body); status 0 when curl could not complete the request. Only https, and the URL is never read as an option."""
    try:
        out = subprocess.run(["curl", "-s", "-L", "--proto", "=https", "--proto-redir", "=https", "--max-filesize", "50000000",
                              "-A", UA, "-w", "\n%{http_code}", "--", url], capture_output=True, check=True, timeout=60).stdout
    except subprocess.CalledProcessError as e:
        return (413, b"") if e.returncode == 63 else (0, b"")  # 63: over --max-filesize, never worth a retry
    except subprocess.TimeoutExpired:
        return 0, b""
    body, _, status = out.rpartition(b"\n")
    return int(status or 0), body


def get(url, sleep=time.sleep, now=time.monotonic, fetch=_curl):
    """GET with per-host spacing and exponential backoff on 403/429. Returns bytes."""
    host = urlparse(url).hostname
    for attempt in range(ATTEMPTS):
        wait = _last.get(host, -1e9) + SPACING.get(host, 0) - now()
        if wait > 0:
            sleep(wait)
        _last[host] = now()
        status, body = fetch(url)
        if status == 200:
            return body
        if status not in RETRY_ON or attempt == ATTEMPTS - 1:
            raise HTTPError(url, status)
        sleep(BACKOFF * 2 ** attempt)
