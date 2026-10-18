#!/bin/sh
# Rebuilds the DWG writer (public/dwg-export/dwg-export.js, dwg-export.wasm, COPYING) from GNU LibreDWG 0.14 in the
# pinned Emscripten 4.0.23 container, and checks the result against the shipped files.
#
#   scripts/build-dwg-export.sh            build into a temporary directory and compare with public/dwg-export
#   scripts/build-dwg-export.sh --install  build, then copy the outputs into public/dwg-export
#
# Needs Docker and a network connection (the LibreDWG release and the emsdk image are fetched; both are pinned by
# SHA-256). The recipe itself is scripts/dwg-export/build-in-container.sh; public/dwg-export/SOURCE.md explains it.
set -eu

IMAGE='emscripten/emsdk:4.0.23@sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62'
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/public/dwg-export"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/spoolyard-dwg-export.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

cp "$ROOT/scripts/dwg-export/build-in-container.sh" "$WORK/build.sh"
docker run --rm --cpus=2 --memory=4g -v "$WORK:/build" "$IMAGE" sh /build/build.sh

status=0
for f in dwg-export.js dwg-export.wasm COPYING; do
  built=$(shasum -a 256 "$WORK/dist/$f" | cut -d' ' -f1)
  shipped=$(shasum -a 256 "$OUT/$f" 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$built" = "$shipped" ]; then echo "identical  $f  $built"; else echo "differs    $f  built $built, shipped ${shipped:-none}"; status=1; fi
done

if [ "${1:-}" = "--install" ]; then
  cp "$WORK/dist/dwg-export.js" "$WORK/dist/dwg-export.wasm" "$WORK/dist/COPYING" "$OUT/"
  echo "Installed into $OUT; update the SHA-256 values in public/dwg-export/SOURCE.md if they changed."
  exit 0
fi
exit $status
