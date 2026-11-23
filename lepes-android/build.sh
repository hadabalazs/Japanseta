#!/usr/bin/env bash
# Builds a signed release APK with only the Android SDK build-tools + a JDK. No Gradle.
# Output: dist/lepes.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
[ -x "$BT/aapt2" ] && [ -f "$JAR" ] || { echo "Missing build-tools 35.0.0 / platform android-35 in $SDK"; exit 1; }
if [ -z "${JAVA_HOME:-}" ] && /usr/libexec/java_home -v 17+ >/dev/null 2>&1; then export JAVA_HOME="$(/usr/libexec/java_home -v 17+)"; fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"

rm -rf build && mkdir -p build/gen build/classes dist

# Release signing key: created once, then reused. Back up signing/ — updates must be signed with the same key.
KS=signing/lepes-release.jks
PROPS=signing/keystore.properties
if [ ! -f "$KS" ]; then
  mkdir -p signing
  PASS="$(openssl rand -hex 16)"
  keytool -genkeypair -keystore "$KS" -alias lepes -keyalg RSA -keysize 3072 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Lepes" >/dev/null
  printf 'password=%s\n' "$PASS" > "$PROPS"
  chmod 600 "$KS" "$PROPS"
  echo "Created new signing key in signing/ (keep a backup)."
fi
PASS="$(sed -n 's/^password=//p' "$PROPS")"

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml \
  -A assets --java build/gen build/res.zip

javac --release 8 -classpath "$JAR" -Xlint:-options -encoding UTF-8 \
  -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$JAR" --output build $(find build/classes -name '*.class')
(cd build && zip -q unsigned.apk classes.dex)

"$BT/zipalign" -p -f 4 build/unsigned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$KS" --ks-key-alias lepes --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --out dist/lepes.apk build/aligned.apk
"$BT/apksigner" verify dist/lepes.apk
rm -f dist/lepes.apk.idsig
echo "Built dist/lepes.apk ($(du -h dist/lepes.apk | cut -f1))"
