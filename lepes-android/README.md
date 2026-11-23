# Lépés – Android

Native Android build of the Lépés walking-interval app (Hungarian UI). Same screens and copy as the
PWA (a WebView over the original HTML/CSS), but the walk runs in a native foreground service, so the
cues keep playing with the screen locked, the app closed, or another app open.

APK size ≈ 40 KB. Minimum Android 8.0 (API 26), target Android 15 (API 35). No Gradle, no AndroidX,
no third-party dependencies, no internet permission.

## Features compared with the PWA

| | PWA | Android APK |
|---|---|---|
| Screen locked / app in background | may stop | keeps playing (foreground service) |
| Controls | in the page | in the page + notification (Pause/Resume, Stop, live countdown) |
| Vibration | screen on only | also with the screen locked |
| Other music | may stop | keeps playing, only ducked during each cue |
| Headphones unplugged | – | walk pauses |
| Battery-saver killers | – | in-app button to request battery-optimisation exemption |
| Install guide, service worker, update banner | yes | removed (not needed) |

## Project layout

```
AndroidManifest.xml          app, permissions, service declaration
res/                         theme, adaptive icon, notification icons
src/hu/lepes/app/
  MainActivity.java          WebView host, edge-to-edge insets, JS bridge (window.Lepes)
  Walk.java                  session engine: streaming AudioTrack, timing, ducking,
                             vibration, wake lock, notification
  WalkService.java           foreground service (mediaPlayback) + notification actions
  Tones.java                 tone generator, sample-identical to web-original/src/engine.js
assets/                      UI: index.html, style.css, app.js (talks to window.Lepes)
web-original/                untouched PWA source, for reference
build.sh                     build + sign script
TELEPITES.md                 Hungarian install guide for end users
```

How it works: `Walk` streams PCM generated on the fly (16 kHz mono) to an `AudioTrack`; the audio
playback position is the timer, so there is no drift and no large WAV in memory. A 250 ms main-thread
tick detects phase changes (vibration, notification update) and requests transient audio focus with
ducking ~0.6 s before each cue. The page polls `Lepes.status()` every 250 ms while visible, so state
changed from the notification shows up in the UI.

## One-time setup (macOS, Apple Silicon)

You need a JDK 17+ and the Android SDK command-line tools with `build-tools;35.0.0` and
`platforms;android-35`. Android Studio is **not** required.

```bash
# JDK 17 (Temurin) – user-local, no admin rights
mkdir -p ~/Library/Java/JavaVirtualMachines
curl -fL "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse" | tar -xz -C ~/Library/Java/JavaVirtualMachines

# Android command-line tools
mkdir -p ~/Library/Android/sdk/cmdline-tools && cd ~/Library/Android/sdk/cmdline-tools
curl -fLO https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip
unzip -q commandlinetools-mac-*_latest.zip && mv cmdline-tools latest && rm commandlinetools-mac-*_latest.zip

# SDK packages (prompts you to accept the Android SDK license)
export JAVA_HOME=$(/usr/libexec/java_home -v 17+)
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager --licenses
~/Library/Android/sdk/cmdline-tools/latest/bin/sdkmanager "build-tools;35.0.0" "platforms;android-35"
```

On Linux/Windows (WSL) the same works with the matching JDK and command-line-tools downloads; set
`ANDROID_HOME` to the SDK folder.

## Build

```bash
cd lepes-android
./build.sh
```

Output: `dist/lepes.apk` (signed release APK). The script finds the SDK in `$ANDROID_HOME` or
`~/Library/Android/sdk`, and the JDK via `$JAVA_HOME` or `/usr/libexec/java_home`.

### Signing key — important

The first build creates `signing/lepes-release.jks` and `signing/keystore.properties` (random
password). `signing/` is **git-ignored on purpose**: never commit it to this public repo.

**Back it up somewhere safe** (password manager, encrypted drive). Every future version must be signed
with the same key, otherwise phones refuse to install the update over the old version and users must
uninstall first (losing their settings). If you build on a new machine, copy `signing/` there before
running `./build.sh`, or it will silently create a new, incompatible key.

## Releasing a new version

1. Make the changes (UI in `assets/`, native code in `src/`).
2. In `AndroidManifest.xml` increase `android:versionCode` (integer, +1) and set `android:versionName`.
3. `./build.sh`
4. Test (see below), commit, then publish a GitHub release with the APK attached (tag = version):
   ```bash
   gh release create v1.0.1 dist/lepes.apk --title "Lépés 1.0.1 (Android)" --notes "What changed" --latest
   ```
   The asset must be named `lepes.apk`: the permanent download link
   https://github.com/hadabalazs/Japanseta/releases/latest/download/lepes.apk always serves the newest
   release, so links already sent to users keep working. Users install it over the old version;
   settings are kept.

Quick UI check in a desktop browser: open `assets/index.html` through any local web server. Without
the native bridge `app.js` uses a built-in stub (timer runs, no sound).

## Testing on an emulator

```bash
SDK=~/Library/Android/sdk
export JAVA_HOME=$(/usr/libexec/java_home -v 17+)
$SDK/cmdline-tools/latest/bin/sdkmanager "platform-tools" "emulator" "system-images;android-35;default;arm64-v8a"
echo no | $SDK/cmdline-tools/latest/bin/avdmanager create avd -n lepes35 -k "system-images;android-35;default;arm64-v8a" -d pixel_6
$SDK/emulator/emulator -avd lepes35 &
$SDK/platform-tools/adb wait-for-device
$SDK/platform-tools/adb install -r dist/lepes.apk
```

Useful checks:

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
$ADB shell input keyevent KEYCODE_SLEEP                                # screen off
$ADB shell dumpsys activity services hu.lepes.app | grep isForeground  # service alive
$ADB shell dumpsys audio | grep "requestAudioFocus() from uid"         # one entry per cue
$ADB shell dumpsys audio | grep -A0 "u/pid" | grep hu.lepes            # AudioTrack state
$ADB logcat -d | grep -E "FATAL|AndroidRuntime"                         # crashes
```

Verified on the emulator (Android 15): start/pause/resume/stop in app and from the notification,
cues on time with screen off and with the activity closed, UI restores a running walk on reopen,
update install keeps settings.

**Still to verify on real phones:** vibration, Doze, Bluetooth audio, headphone unplug, phone calls,
and aggressive OEM battery managers (Xiaomi, Samsung, Huawei).

## Distributing

Send people the permanent link (always the newest release):
https://github.com/hadabalazs/Japanseta/releases/latest/download/lepes.apk
together with `TELEPITES.md` (Hungarian, non-technical install steps; already contains this link).
Email attachments of `.apk` files may be blocked, so prefer the link. iPhone users need the PWA
(`web-original/`) instead.
