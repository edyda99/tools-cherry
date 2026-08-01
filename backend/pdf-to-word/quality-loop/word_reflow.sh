#!/bin/zsh
# Benchmark engine: Microsoft Word's own PDF→Word reflow. Converts every
# corpus/<name>.pdf to out/bench_word/<name>.docx by scripting Word.
# Must run from a TCC-granted host (Terminal / vpn-exec relay).
#
# Same safety rules as render_word.sh (a run once exported the user's own open
# document because `active document` raced a live Word session):
#  - PDFs are staged INTO Word's container first, then opened via AppleScript
#    `open` (in-container paths never raise sandbox dialogs, and an
#    AppleScript-driven open lets `display alerts none` suppress the
#    "Word will now convert your PDF" alert);
#  - every reference is BY NAME, never `active document`;
#  - if any open document name contains one of our stems, ABORT;
#  - Word writes the docx inside its own container, then it is moved out.
set -e
cd "$(dirname "$0")"
out="out/bench_word"
stage_in="$HOME/Library/Containers/com.microsoft.Word/Data/qloop-in"
stage_out="$HOME/Library/Containers/com.microsoft.Word/Data/qloop-out"
mkdir -p "$out" "$stage_in" "$stage_out"

open -a "Microsoft Word"
sleep 3
osascript -e 'tell application "Microsoft Word" to set display alerts to alerts none'
restore_alerts() { osascript -e 'tell application "Microsoft Word" to set display alerts to alerts all' 2>/dev/null || true }
trap restore_alerts EXIT

ok=0
for f in corpus/*.pdf(N); do
  base="${f:t:r}"
  [[ -f "$out/$base.docx" ]] && { echo "skip $base (already converted)"; continue }
  # `name of documents` throws -1708 when Word has no documents open — treat as empty
  pre="$(osascript -e 'tell application "Microsoft Word" to get name of documents' 2>/dev/null || echo '')"
  if [[ "$pre" == *"$base"* ]]; then
    echo "ABORT: a document matching $base is already open in Word (not ours)" >&2
    exit 3
  fi
  cp "$f" "$stage_in/$base.pdf"
  osascript -e "tell application \"Microsoft Word\" to open POSIX file \"$stage_in/$base.pdf\"" &
  opened=""
  for i in {1..60}; do
    sleep 1
    now="$(osascript -e 'tell application "Microsoft Word" to get name of documents' 2>/dev/null || true)"
    if [[ "$now" == *"$base"* ]]; then opened=1; break; fi
  done
  if [[ -z "$opened" ]]; then
    echo "FAIL: Word never opened $base.pdf — a blocking dialog may need one manual dismissal" >&2
    exit 4
  fi
  # capture the exact new document name (reflow may name it "x.pdf" or "x");
  # never iterate `documents` — Word throws -1708 on that idiom
  if [[ "$(osascript -e "tell application \"Microsoft Word\" to exists document \"$base.pdf\"")" == "true" ]]; then
    docname="$base.pdf"
  else
    docname="$base"
  fi
  osascript \
    -e "with timeout of 300 seconds" \
    -e "tell application \"Microsoft Word\"" \
    -e "save as document \"$docname\" file name \"$stage_out/$base.docx\" file format format document" \
    -e "end tell" \
    -e "end timeout"
  # save-as renames the document; close by whichever name now exists
  osascript -e "tell application \"Microsoft Word\"
    if exists document \"$base.docx\" then
      close document \"$base.docx\" saving no
    else if exists document \"$docname\" then
      close document \"$docname\" saving no
    end if
  end tell"
  if unzip -l "$stage_out/$base.docx" > /dev/null 2>&1; then
    mv "$stage_out/$base.docx" "$out/$base.docx"
    ok=$((ok+1)); echo "converted $base.docx"
  else
    echo "FAIL: $base output is not a docx zip (wrong save format?)" >&2
  fi
  rm -f "$stage_in/$base.pdf"
done
echo "word reflow: $ok converted into $out"
