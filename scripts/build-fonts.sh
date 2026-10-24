#!/usr/bin/env bash
# 自托管字体：Noto Serif SC（子集化）+ JetBrains Mono
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE="scripts/data/fonts"
OUT="v2/assets/fonts"
mkdir -p "$CACHE" "$OUT"

SERIF_BASE="https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/SubsetOTF/SC"

fetch() {  # url dest
  [ -f "$2" ] || curl -fL --max-time 300 -o "$2" "$1"
}

fetch "$SERIF_BASE/NotoSerifSC-Black.otf"   "$CACHE/NotoSerifSC-Black.otf"
fetch "$SERIF_BASE/NotoSerifSC-Regular.otf" "$CACHE/NotoSerifSC-Regular.otf"

# GB2312 可编码汉字（6763）+ ASCII + 常用标点
python3 - "$CACHE/chars.txt" <<'PY'
import sys
chars = []
for c in range(0x20, 0x7F):
    chars.append(chr(c))
for c in range(0x4E00, 0x9FA6):
    try:
        chr(c).encode('gb2312')
        chars.append(chr(c))
    except UnicodeEncodeError:
        pass
chars += list('·—–…“”‘’《》〈〉「」『』【】（）·、。，；：？！％℃°′″×÷±≈≤≥')
seen = set()
out = [ch for ch in chars if not (ch in seen or seen.add(ch))]
open(sys.argv[1], 'w', encoding='utf-8').write(''.join(out))
print('chars', len(out))
PY

PYFT="$(python3 -c 'import glob,sys;print(glob.glob("'$HOME'/Library/Python/*/bin/pyftsubset")[0])' 2>/dev/null || echo pyftsubset)"

subset() { # in out
  "$PYFT" "$1" --text-file="$CACHE/chars.txt" --flavor=woff2 --output-file="$2" \
    --layout-features='*' --no-hinting --desubroutinize
}

subset "$CACHE/NotoSerifSC-Black.otf"   "$OUT/noto-serif-sc-900.woff2"
subset "$CACHE/NotoSerifSC-Regular.otf" "$OUT/noto-serif-sc-400.woff2"

# JetBrains Mono（拉丁子集，fontsource 提供 woff2）
for w in 400 600; do
  fetch "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.0.20/files/jetbrains-mono-latin-$w-normal.woff2" \
        "$OUT/jetbrains-mono-$w.woff2"
done

ls -lh "$OUT"
