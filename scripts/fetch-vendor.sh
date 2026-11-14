#!/usr/bin/env bash
# Downloads the MediaPipe audio runtime and the YAMNet model into extension/vendor.
# They are committed to the repo; run this to refresh or upgrade them.
set -euo pipefail

VERSION="1.2.3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/extension/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$DEST/wasm"
(cd "$TMP" && npm pack "@mediapipe/tasks-audio@$VERSION" --silent && tar xzf mediapipe-tasks-audio-*.tgz)
cp "$TMP/package/audio_bundle.mjs" "$DEST/"
cp "$TMP/package/wasm/audio_wasm_internal.js" "$TMP/package/wasm/audio_wasm_internal.wasm" "$DEST/wasm/"
curl -fsSL -o "$DEST/yamnet.tflite" \
  https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite

echo "Vendor files ready in $DEST"
