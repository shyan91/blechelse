#!/usr/bin/env python3
"""
Serve the Blechelse site together with your clip folder.

The clips are not part of this repository. Point this server at the folder you
downloaded (e.g. with blechelse_scraper.py) and it is served under /clips/:

    python3 serve.py --clips /path/to/blechelse_wavs
    python3 serve.py --clips ../blechelse_wavs --port 8080 --host 0.0.0.0

If the folder has no manifest.json, one is built from the files on disk
(stations then show as numbers). --write-manifest saves it into the folder so a
plain static web server (nginx, GitHub Pages, ...) can use the folder as-is.

Without --clips it serves a ./clips folder next to this script, if present.
"""

import argparse
import functools
import http.server
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
LANG_ROOTS = ("dt", "en", "fr", "gong")


def scan_clips(clips: Path) -> dict:
    """Return {"/dt/...wav": description} merged with an existing manifest.json."""
    manifest = {}
    existing = clips / "manifest.json"
    if existing.exists():
        try:
            manifest = json.loads(existing.read_text(encoding="utf-8"))
        except ValueError:
            print("warning: manifest.json is not valid JSON, rebuilding", file=sys.stderr)
    found = 0
    for top in LANG_ROOTS:
        base = clips / top
        if not base.is_dir():
            continue
        for path in base.rglob("*.wav"):
            key = "/" + path.relative_to(clips).as_posix()
            manifest.setdefault(key, "")
            found += 1
    # drop entries whose file no longer exists
    manifest = {k: v for k, v in manifest.items() if (clips / k.lstrip("/")).is_file()}
    return dict(sorted(manifest.items())), found


class Handler(http.server.SimpleHTTPRequestHandler):
    clips_dir: Path = None
    manifest_bytes: bytes = b"{}"

    def translate_path(self, path):
        p = unquote(urlparse(path).path)
        if p.startswith("/clips/") and self.clips_dir:
            rel = Path(p[len("/clips/"):])
            target = (self.clips_dir / rel).resolve()
            if self.clips_dir in target.parents or target == self.clips_dir:
                return str(target)
            return str(self.clips_dir / "__forbidden__")
        return super().translate_path(path)

    def do_GET(self):
        if urlparse(self.path).path == "/clips/manifest.json" and self.clips_dir:
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(self.manifest_bytes)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(self.manifest_bytes)
            return
        super().do_GET()

    def end_headers(self):
        if self.path.startswith("/clips/") and self.path.endswith(".wav"):
            self.send_header("Cache-Control", "public, max-age=86400")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--clips", help="folder containing dt/, en/, fr/, gong/ (default: ./clips)")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to allow other devices")
    ap.add_argument("--write-manifest", action="store_true",
                    help="save the (re)built manifest.json into the clip folder and exit")
    ap.add_argument("--quiet", action="store_true", help="don't log every request")
    args = ap.parse_args()

    clips = Path(args.clips).expanduser().resolve() if args.clips else ROOT / "clips"
    if not clips.is_dir():
        print(f"Clip folder not found: {clips}\n"
              f"The clips are not part of the repository. Pass --clips /path/to/blechelse_wavs.",
              file=sys.stderr)
        if args.write_manifest or args.clips:
            sys.exit(1)
        clips = None

    manifest = {}
    if clips:
        manifest, found = scan_clips(clips)
        named = sum(1 for v in manifest.values() if v)
        print(f"Clips: {clips}  ({found} wav files, {named} with names)")
        if args.write_manifest:
            (clips / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
            print(f"Wrote {clips / 'manifest.json'}")
            return

    Handler.clips_dir = clips
    Handler.manifest_bytes = json.dumps(manifest, ensure_ascii=False).encode("utf-8")
    Handler.quiet = args.quiet
    handler = functools.partial(Handler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    print(f"Serving on http://{shown}:{args.port}/  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
