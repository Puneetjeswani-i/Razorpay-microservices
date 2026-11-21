"""
CORS proxy for the API gateway.

The hosted dashboard (GitHub Pages) calls the API gateway straight from the browser.
Browsers only allow that if the gateway answers the CORS preflight (OPTIONS) and sends
Access-Control-* headers. The gateway does neither, and its auth filter rejects OPTIONS
requests without an Authorization header. This proxy sits in front of the gateway and
handles CORS, so the backend code stays unchanged:

    browser  ->  cors_proxy.py (:8090)  ->  api-gateway-service (:8080)

Usage:
    python cors_proxy.py                      # listen on 8090, forward to http://127.0.0.1:8080
    python cors_proxy.py --port 8090 --target http://127.0.0.1:8080 \
        --allow-origin https://puneetjeswani-i.github.io

Only the Python standard library is used.
"""

import argparse
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_ORIGINS = [
    "https://puneetjeswani-i.github.io",
    "http://localhost",
    "http://127.0.0.1",
]
ALLOW_HEADERS = "Authorization, Content-Type, X-Idempotency-Key"
ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
EXPOSE_HEADERS = "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After"
# Hop-by-hop headers must not be forwarded by a proxy.
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
              "trailers", "transfer-encoding", "upgrade", "content-length", "host"}
# Set by this server itself; don't copy them from the gateway's response.
OWN_HEADERS = {"server", "date"}


def origin_allowed(origin, allowed):
    if not origin:
        return False
    for a in allowed:
        if a == "*" or origin == a:
            return True
        # http://localhost and http://127.0.0.1 match any port
        if a in ("http://localhost", "http://127.0.0.1") and origin.startswith(a + ":"):
            return True
    return False


def make_handler(target, allowed):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin_allowed(origin, allowed):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Expose-Headers", EXPOSE_HEADERS)

        def do_OPTIONS(self):
            # Answer the preflight here; it never reaches the gateway.
            self.send_response(204)
            self._cors()
            self.send_header("Access-Control-Allow-Methods", ALLOW_METHODS)
            self.send_header("Access-Control-Allow-Headers", ALLOW_HEADERS)
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _forward(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in HOP_BY_HOP and k.lower() not in ("origin", "referer")}
            req = urllib.request.Request(target + self.path, data=body, headers=headers, method=self.command)
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    status, res_headers, data = res.status, res.headers, res.read()
            except urllib.error.HTTPError as e:  # 4xx / 5xx from the gateway: pass it through
                status, res_headers, data = e.code, e.headers, e.read()
            except (urllib.error.URLError, OSError) as e:
                status, res_headers = 502, {}
                data = ('{"errorCode":"GATEWAY_UNREACHABLE","errorDescription":"The proxy could not reach '
                        + target + '. Is the API gateway running?"}').encode()
                self.log_error("upstream error: %s", e)

            self.send_response(status)
            for k, v in res_headers.items():
                if k.lower() not in HOP_BY_HOP | OWN_HEADERS and not k.lower().startswith("access-control-"):
                    self.send_header(k, v)
            if not res_headers:
                self.send_header("Content-Type", "application/json")
            self._cors()
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _forward

    return Handler


def main():
    p = argparse.ArgumentParser(description="CORS proxy in front of the API gateway")
    p.add_argument("--port", type=int, default=8090, help="port to listen on (default 8090)")
    p.add_argument("--target", default="http://127.0.0.1:8080", help="API gateway URL (default http://127.0.0.1:8080)")
    p.add_argument("--allow-origin", action="append",
                   help="allowed browser origin; repeat for several (default: the GitHub Pages site and localhost)")
    args = p.parse_args()

    allowed = args.allow_origin or DEFAULT_ORIGINS
    target = args.target.rstrip("/")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(target, allowed))
    print(f"CORS proxy on http://localhost:{args.port} -> {target}")
    print("Allowed origins: " + ", ".join(allowed))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
