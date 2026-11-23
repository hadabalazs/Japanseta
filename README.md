# Japanseta

Walking pace setter app. **Lépés** (Hungarian UI) alternates fast and slow walking intervals with
sound cues: two short tones = walk fast, one long tone = walk slow. Durations 1–15 minutes each.

## Contents

- [`lepes-android/`](lepes-android/) — native Android app, distributed as a ~40 KB APK. Works with
  the screen locked. Build, signing, release and test instructions: [lepes-android/README.md](lepes-android/README.md).
  End-user install guide (Hungarian): [lepes-android/TELEPITES.md](lepes-android/TELEPITES.md).
- [`lepes-android/web-original/`](lepes-android/web-original/) — original PWA source (static site,
  Node 20+ for tests/build: `node --test engine.test.mjs`, `node build.mjs`). Deploy `dist/` to any
  static host (e.g. Netlify). Needed for iPhone users.
