# Blechelse Ansagen-Studio

A web frontend for building German station announcements from Blechelse voice clips. Pick a train, destination, platform and time; the app chains the matching clips, plays them back (optionally with station-hall reverb) and exports the result as a WAV file.

**The audio clips are not included.** Users load their own clip folder; files stay on their device.

## Features

- Announcement types: Einfahrt, Ankunft, Bereitstellung, Information (delay, reason, platform change, cancellation, extra/skipped stops), Abfahrt (doors closing), Durchfahrt, Sonderansagen
- German / English (French for special announcements), several languages in one announcement
- Live platform-display preview, clip chain with missing-clip warnings
- Station search across all stations in the clip folder
- Gong on/off, gap between clips, "Bahnhofshall" reverb, WAV export
- Clip browser to search and play any single clip
- Light/dark theme, works on mobile

## Usage

Open `index.html` in a browser (no build step, no server needed), then drag the clip folder onto the page or click **Ordner auswählen**.

Expected folder layout (as produced by `blechelse_scraper.py`):

```
blechelse_wavs/
├── manifest.json      # optional: gives stations etc. readable names
├── gong/...
├── dt/  module/ module_3_1/ ziele/ zuggattungen/ gleise_zahlen/ zeiten/ gruende/ nza/
├── en/ ...
└── fr/ ...
```

Without `manifest.json` everything still works, but stations are shown by their number.

### Self-hosting with clips

Put the clip folder next to `index.html` as `clips/` (it must contain `manifest.json`) and serve the folder over HTTP. The app loads it automatically. Alternatively point to another location with `?clips=https://example.org/my-clips/`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `css/styles.css` | Styling (light/dark) |
| `js/announcements.js` | Which clips make up each announcement type |
| `js/library.js` | Loading the clip folder, catalog of stations/train types |
| `js/player.js` | Gapless playback, reverb, WAV export (Web Audio API) |
| `js/app.js` | UI |

Unofficial fan project, not affiliated with Deutsche Bahn AG.
