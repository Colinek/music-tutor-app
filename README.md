# Music Tutor Web App (MVP)

This project is a static web app you can host on GitHub Pages.

It supports:
- Song selection from `songs.json`
- MIDI playback in browser
- GM SoundFont playback (multi-instrument, including drum tracks where present)
- MusicXML score rendering with OpenSheetMusicDisplay
- Score display toggle: full score or reference part only
- Microphone pitch detection
- Real-time comparison against a reference track (default Track 1 / index `0`)

## 1. Files You Need Per Song

For each piece, create a folder under `assets/songs/<song_id>/` with:
- one MIDI file (`.mid`)
- one MusicXML file (`.xml`, `.musicxml`, or `.mxl`)

Example:

```text
assets/songs/
  twinkle/
    twinkle.mid
    twinkle.xml
  ode_to_joy/
    ode.mid
    ode.xml
```

## 2. Authoring Rules (Important)

- Put the pupil/reference part on Track 1 (index `0`) in the MIDI file.
- Keep MIDI and MusicXML exported from the same source score/session.
- Linearize repeats in both exports (no playback-only jumps).
- Keep any count-in consistent between MIDI and XML.
- For accurate reference-part display, keep MIDI track order aligned with MusicXML part order.

## 3. Build `songs.json`

Automatic:

```bash
./scripts/generate-songs-json.sh
```

Manual entry format:

```json
[
  {
    "id": "twinkle",
    "title": "Twinkle Twinkle",
    "folder": "assets/songs/twinkle/",
    "midiFilename": "twinkle.mid",
    "xmlFilename": "twinkle.xml",
    "analysisTrackIndex": 0,
    "syncOffsetSeconds": 0
  }
]
```

`syncOffsetSeconds` is optional.
Use a positive value if the score is behind the MIDI.

## 4. Run Locally

Use any static server (the app uses `fetch`, so opening as `file://` is not enough).

Examples:

```bash
# Option A (if Python works)
python3 -m http.server 8080

# Option B (if Node works)
npx serve .
```

Then open `http://localhost:8080`.

## 5. Deploy to GitHub Pages

1. Create a GitHub repo and copy this folder into it.
2. Commit and push to `main`.
3. In GitHub: `Settings` -> `Pages`.
4. Source: `Deploy from a branch`.
5. Branch: `main`, folder: `/ (root)`.
6. Save and wait for deployment.
7. Open the Pages URL shown by GitHub.

## 6. Notes on Storage Choices

- Best path: keep MIDI/XML in the same GitHub repo as the app.
- If files are on Google Drive, direct browser fetch often fails due CORS and file-ID access patterns.
- If you must keep content off GitHub, use an API layer or signed file service and keep a mapping file (`songs.json` or spreadsheet export).

## 7. Current MVP Limits

- Feedback is pitch + timing window based, not full musical phrasing assessment.
- Browser synth playback is functional but not orchestral quality.
- Cursor movement is approximate by note onsets.
- Recommend headphones to reduce backing-track bleed into mic.

## 8. Better Vocal Playback (SATB)

The app now uses WebAudioFont presets for fuller GM instrument playback, with
fallback synth voicing if a preset cannot be loaded.

For best results in your MIDI:
- Name tracks with voice labels (`Soprano`, `Alto`, `Tenor`, `Bass`), or keep them in SATB order.
- Use vocal-like GM programs where possible (Choir/Voice family).
