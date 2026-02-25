#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-assets/songs}"
OUTPUT_FILE="${2:-songs.json}"

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Root songs directory not found: $ROOT_DIR" >&2
  exit 1
fi

entries=()
while IFS= read -r dir; do
  id="$(basename "$dir")"

  midi_file="$(find "$dir" -maxdepth 1 -type f \( -iname '*.mid' -o -iname '*.midi' \) | sort | head -n1 || true)"
  xml_file="$(find "$dir" -maxdepth 1 -type f \( -iname '*.xml' -o -iname '*.musicxml' -o -iname '*.mxl' \) | sort | head -n1 || true)"

  if [[ -z "$midi_file" || -z "$xml_file" ]]; then
    echo "Skipping '$id' (need both MIDI and MusicXML)." >&2
    continue
  fi

  midi_name="$(basename "$midi_file")"
  xml_name="$(basename "$xml_file")"
  title="$(echo "$id" | tr '_' ' ' | tr '-' ' ')"

  entry=$(cat <<JSON
  {
    "id": "$id",
    "title": "$title",
    "folder": "$ROOT_DIR/$id/",
    "midiFilename": "$midi_name",
    "xmlFilename": "$xml_name",
    "analysisTrackIndex": 0,
    "syncOffsetSeconds": 0
  }
JSON
)

  entries+=("$entry")
done < <(find "$ROOT_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

{
  echo "["
  for i in "${!entries[@]}"; do
    if [[ "$i" -gt 0 ]]; then
      echo ","
    fi
    printf '%s' "${entries[$i]}"
  done
  echo
  echo "]"
} > "$OUTPUT_FILE"

echo "Wrote $OUTPUT_FILE"
