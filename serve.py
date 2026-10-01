#!/usr/bin/env python3
"""Local web server for the Flashcards app. Uses only Python's standard library.

    python serve.py           serve the app at http://localhost:8372
    python serve.py --open    ...and open it in the browser

The server listens on this computer only (127.0.0.1) and serves nothing but the
files in the app/ folder. Your cards never pass through it: the browser reads
and writes your data folder directly.
"""

import argparse
import http.client
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import urllib.parse
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
APP_NAME = "simple-flashcards"
# Not 8765: that is the port of AnkiConnect, which an Anki user may have running.
DEFAULT_PORT = 8372

# Set explicitly: on Windows, Python takes these from the registry, where
# ".js" is sometimes mapped to text/plain, which stops the app from loading.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}

PROBE_NAME = re.compile(r"^flashcards-probe-[0-9a-z]{16}\.txt$")


def app_files():
    """Every file of the app, as URL paths relative to its root (tests excluded)."""
    files = []
    for folder, subfolders, names in os.walk(APP_DIR):
        relative = os.path.relpath(folder, APP_DIR)
        if relative == ".":
            subfolders[:] = [name for name in subfolders if name != "tests"]
        for name in names:
            if name.startswith(".") or name == "LICENSE":
                continue
            path = name if relative == "." else os.path.join(relative, name)
            files.append(path.replace(os.sep, "/"))
    return sorted(files)


def is_inside_app_folder(file_name):
    """True if a file with this name exists anywhere under the app's own folder."""
    for _folder, subfolders, names in os.walk(ROOT):
        subfolders[:] = [name for name in subfolders if name != ".git"]
        if file_name in names:
            return True
    return False


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "Flashcards"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/__info":
            self.send_json({"app": APP_NAME})
        elif url.path == "/__files":
            self.send_json({"files": app_files()})
        elif url.path == "/__inside":
            name = urllib.parse.parse_qs(url.query).get("probe", [""])[0]
            if PROBE_NAME.match(name):
                self.send_json({"inside": is_inside_app_folder(name)})
            else:
                self.send_error(400)
        else:
            super().do_GET()

    def send_json(self, value):
        body = json.dumps(value).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # Always check with the server, so an update (git pull) shows at once.
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path):
        extension = os.path.splitext(path)[1].lower()
        return MIME_TYPES.get(extension) or super().guess_type(path)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def log_message(self, format, *args):
        pass


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # On Windows this option would let a second copy take a port already in use.
    allow_reuse_address = os.name != "nt"


def who_is_listening(port):
    """'app' if this app already runs on the port, 'other' for another program, None if free."""
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.5):
            pass
    except OSError:
        return None
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1.5)
    try:
        connection.request("GET", "/__info")
        info = json.loads(connection.getresponse().read().decode("utf-8"))
        return "app" if isinstance(info, dict) and info.get("app") == APP_NAME else "other"
    except Exception:
        return "other"
    finally:
        connection.close()


def open_in_browser(url):
    """Open the app in Microsoft Edge or Chrome; other browsers lack the file access it needs."""
    try:
        if os.name == "nt":
            for browser in ("msedge", "chrome"):
                if subprocess.run(["cmd", "/c", "start", "", browser, url]).returncode == 0:
                    return
        elif sys.platform == "darwin":
            for browser in ("Microsoft Edge", "Google Chrome"):
                done = subprocess.run(["open", "-a", browser, url], stderr=subprocess.DEVNULL)
                if done.returncode == 0:
                    return
        else:
            for browser in ("microsoft-edge", "google-chrome", "chromium", "chromium-browser"):
                if shutil.which(browser):
                    subprocess.Popen([browser, url])
                    return
    except OSError:
        pass
    webbrowser.open(url)


def report_failure(message):
    """Print the problem; on Windows also show it in a box, since the server window starts minimised."""
    print(message)
    if os.name == "nt":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, message, "Flashcards", 0x10)
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Serve the Flashcards app on this computer.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="port to listen on (default %(default)s)")
    parser.add_argument("--open", action="store_true", help="open the app in the browser")
    args = parser.parse_args()
    url = "http://localhost:%d/" % args.port

    listening = who_is_listening(args.port)
    if listening == "app":
        print("The app is already running at %s" % url)
        if args.open:
            open_in_browser(url)
        return 0
    if listening == "other":
        report_failure(
            "Port %d is used by another program.\n\n"
            "Close that program, or start the app on another port:\n"
            "    python serve.py --port %d --open\n\n"
            "On another port the browser treats the app as a different site: you will have to "
            "choose your data folder again, and install the app again if you had installed it."
            % (args.port, args.port + 1)
        )
        return 1

    try:
        server = Server(("127.0.0.1", args.port), Handler)
    except OSError as error:
        report_failure("Could not start the server on port %d: %s" % (args.port, error))
        return 1

    print("Flashcards is running at %s" % url)
    print("Keep this window open while you use the app. Close it (or press Ctrl+C) to stop.")
    if args.open:
        threading.Timer(0.3, open_in_browser, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
