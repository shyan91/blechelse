# Blechelse Ansagen-Studio

A web frontend for building German station announcements from Blechelse voice clips. Pick a train, destination, platform and time; the app chains the matching clips, plays them back (optionally with station-hall reverb) and exports the result as a WAV file.

**The audio clips are not part of this repository.** Whoever hosts the site provides them: put the clip folder at `clips/` next to `index.html` (see [Hosting](#hosting)). If a clip is missing, the site shows an error when an announcement that needs it is played or exported.

## Features

- Announcement types: Einfahrt, Ankunft, Bereitstellung, Information (delay, reason, platform change, cancellation, extra/skipped stops), Abfahrt (doors closing), Durchfahrt, Sonderansagen
- German / English (French for special announcements), several languages in one announcement
- Live platform-display preview, clip chain with missing-clip warnings
- Station search across all stations in the clip folder
- Gong on/off, gap between clips, "Bahnhofshall" reverb, WAV export
- Clip browser to search and play any single clip
- Light/dark theme, works on mobile

## Hosting

1. Get the clips, e.g. with `blechelse_scraper.py`. You get a folder like this:

   ```
   blechelse_wavs/
   ├── manifest.json      # list of all clips + readable names (stations etc.)
   ├── gong/...
   ├── dt/  module/ module_3_1/ ziele/ zuggattungen/ gleise_zahlen/ zeiten/ gruende/ nza/
   ├── en/ ...
   └── fr/ ...
   ```

2. Serve the site with the clips:

   **Dev server / simple hosting** (Python 3, no dependencies):

   ```
   python3 serve.py --clips /path/to/blechelse_wavs            # http://localhost:8000
   python3 serve.py --clips /path/to/blechelse_wavs --host 0.0.0.0 --port 8080
   ```

   `serve.py` mounts the folder at `/clips/`. If it has no `manifest.json`, one is built from the files on disk (stations then show as numbers).

   **Any static web server** (nginx, Apache, GitHub Pages, ...): copy or symlink the clip folder to `clips/` next to `index.html`. `manifest.json` provides the station list and names; if yours has none, create it once with `python3 serve.py --clips /path/to/blechelse_wavs --write-manifest`.

   **Clips on another server / CDN:** set `clipsUrl` in `config.js` (that server must allow CORS), or open the site with `?clips=https://example.org/clips/`.

`clips/`, `blechelse_wavs/` and `*.wav` are in `.gitignore`, so clips can't be committed by accident.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `config.js` | Where the clips are served from (`clipsUrl`) |
| `serve.py` | Dev/hosting server that serves the site plus a clip folder |
| `css/styles.css` | Styling (light/dark) |
| `js/announcements.js` | Which clips make up each announcement type |
| `js/library.js` | Loading the clip index from the server, catalog of stations/train types |
| `js/player.js` | Gapless playback, reverb, WAV export (Web Audio API) |
| `js/app.js` | UI |

Unofficial fan project, not affiliated with Deutsche Bahn AG.
