#!/bin/zsh
# Convert every <out_dir>/<name>.docx to <out_dir>/visual/render/<name>.pdf by
# scripting Microsoft Word. Must run from a TCC-promptable host (Terminal /
# vpn-exec relay) — python3-launched osascript is denied Apple events here, so
# visual_check.py is run with --skip-convert after this script.
#
# Safety rules learned the hard way (a run once exported the user's own open
# document because `active document` raced a live Word session):
#  - documents are opened via LaunchServices (`open -a`), the sandbox-blessed
#    path that never raises access dialogs for any location;
#  - every AppleScript reference is BY NAME, never `active document`;
#  - if a document with one of our names is already open, ABORT — never close
#    or save anything this script did not open;
#  - Word writes the PDF inside its own container (always writable), then the
#    file is moved into the repo.
set -e
cd "$(dirname "$0")"
out="$1"
[[ -d "$out" ]] || { echo "usage: render_word.sh out/iterN" >&2; exit 2 }
render="$out/visual/render"
stage="$HOME/Library/Containers/com.microsoft.Word/Data/qloop-out"
mkdir -p "$render" "$stage"

ok=0
for f in "$out"/*.docx(N); do
  n="${f:t}"
  base="${f:t:r}"
  if [[ "$(osascript -e "tell application \"Microsoft Word\" to exists document \"$n\"")" == "true" ]]; then
    echo "ABORT: a document named $n is already open in Word (not ours) — close it and rerun" >&2
    exit 3
  fi
  open -a "Microsoft Word" "${f:A}"
  opened=""
  for i in {1..40}; do
    sleep 0.5
    if [[ "$(osascript -e "tell application \"Microsoft Word\" to exists document \"$n\"")" == "true" ]]; then
      opened=1; break
    fi
  done
  if [[ -z "$opened" ]]; then
    echo "FAIL: Word never opened $n (no dialog-free path?) — stopping" >&2
    exit 4
  fi
  osascript \
    -e "with timeout of 300 seconds" \
    -e "tell application \"Microsoft Word\"" \
    -e "save as document \"$n\" file format format PDF file name \"$stage/$base.pdf\"" \
    -e "close document \"$n\" saving no" \
    -e "end tell" \
    -e "end timeout"
  mv "$stage/$base.pdf" "$render/$base.pdf"
  ok=$((ok+1))
  echo "rendered $base.pdf"
done
rmdir "$stage" 2>/dev/null || true
echo "rendered $ok pdfs into $render"
