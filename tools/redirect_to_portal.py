"""Answers on the addresses people remember and points them at the portal.

The portal serves on one port, but nobody remembers which: this machine has
had the dev server on 5173, the demo bundle on 4173, and "localhost" with no
port at all is what a browser tries first. Each wrong guess is refused, and a
refused connection reads as "the portal is down" - today's support call.

So this listens on the wrong-but-plausible addresses and redirects to the
right one. 307 rather than 301 on purpose: browsers cache a 301 so hard that
the redirect would outlive any later change of the real port.

Ports it cannot bind (something real is running there, or 80 is held by IIS)
are skipped without complaint - whatever answers there is answering, which is
all this exists to guarantee.

    python redirect_to_portal.py --target 4173 --listen 80 --listen 5173
"""

import argparse
import http.server
import socketserver
import threading


class Redirect(http.server.BaseHTTPRequestHandler):
    target = "http://127.0.0.1:4173"

    def _send(self) -> None:
        self.send_response(307)
        self.send_header("Location", f"{self.target}{self.path}")
        self.end_headers()

    do_GET = do_POST = do_HEAD = _send

    def log_message(self, *args) -> None:  # silence per-request noise
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False  # losing a race for the port means bowing out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, required=True)
    parser.add_argument("--listen", type=int, action="append", required=True)
    options = parser.parse_args()

    Redirect.target = f"http://127.0.0.1:{options.target}"

    bound = []
    for port in options.listen:
        if port == options.target:
            continue
        try:
            server = Server(("127.0.0.1", port), Redirect)
        except OSError:
            continue  # taken - whoever holds it is answering, which is enough
        threading.Thread(target=server.serve_forever, daemon=True).start()
        bound.append(port)

    if not bound:
        return 0  # everything already answered; nothing to do is success

    print(f"redirecting {bound} -> {Redirect.target}", flush=True)
    threading.Event().wait()  # daemon threads carry the work
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
