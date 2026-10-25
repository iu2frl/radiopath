#!/usr/bin/env bash
# Downloads the ITU-R data set of the HF model (P.533 / P.372) from the ITU-R Study Group 3 repository. About 138 MB.
# Usage:
#   scripts/fetch-hf-data.sh [-f] [DIR]    # DIR defaults to RADIOPATH_HF_DIR from .env, else tmp/hf-data
# Existing files of the right size are skipped, -f downloads everything again.
set -euo pipefail

SOURCE="https://raw.githubusercontent.com/ITU-R-Study-Group-3/ITU-R-HF/master/P533/Data"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ION_SIZE=11197844 # ionosNN.bin, fixed layout

FORCE=0
while getopts "f" opt; do
	case $opt in
	f) FORCE=1 ;;
	*) exit 2 ;;
	esac
done
shift $((OPTIND - 1))

DIR=${1:-}
if [ -z "$DIR" ] && [ -r "$ROOT/.env" ]; then
	DIR=$(sed -n 's/^RADIOPATH_HF_DIR=//p' "$ROOT/.env" | tail -1)
fi
DIR=${DIR:-$ROOT/tmp/hf-data}
mkdir -p "$DIR"

# fetch NAME EXPECTED_SIZE; size 0 means any non-empty file (text files differ by line endings)
fetch() {
	local name=$1 want=$2 file="$DIR/$1" size=0
	if [ "$FORCE" = 0 ] && [ -s "$file" ]; then
		size=$(wc -c < "$file" | tr -d ' ')
		if [ "$want" = 0 ] || [ "$size" = "$want" ]; then
			echo "skip   $name"
			return 0
		fi
	fi
	echo "fetch  $name"
	curl -fsS --retry 3 -o "$file.part" "$SOURCE/${name// /%20}"
	size=$(wc -c < "$file.part" | tr -d ' ')
	if [ "$size" = 0 ] || { [ "$want" != 0 ] && [ "$size" != "$want" ]; }; then
		rm -f "$file.part"
		echo "bad size $size for $name" >&2
		return 1
	fi
	mv -f "$file.part" "$file"
}

fetch "P1239-3 Decile Factors.txt" 0
for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
	fetch "COEFF${m}W.txt" 0
	fetch "ionos${m}.bin" "$ION_SIZE"
done
echo "done: $DIR (set RADIOPATH_HF_DIR to this directory)"
