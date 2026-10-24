#!/usr/bin/env python3
"""从 GeoNames cities15000 生成全球城市检索表（带中文名）。

输入：scripts/data/cities15000.zip（https://download.geonames.org/export/dump/cities15000.zip）
输出：data/world-cities.json  [{zh, en, cc, lat, lon, pop}]

中文名取自 GeoNames 的 alternatenames 字段（含各国语言别名），不手写、不猜。
人口门槛默认 30 万；国家代码由前端用 Intl.DisplayNames 转中文。
"""
import json
import re, os, re, zipfile, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP = os.path.join(ROOT, "scripts", "data", "cities15000.zip")
OUT = os.path.join(ROOT, "data", "world-cities.json")
MIN_POP = int(sys.argv[1]) if len(sys.argv) > 1 else 300000
LIMIT = int(sys.argv[2]) if len(sys.argv) > 2 else 4000

CJK = re.compile(r"[\u3400-\u9fff]")

try:
    import opencc
    _cc = opencc.OpenCC('t2s')
    def t2s(t):
        return _cc.convert(t)
except Exception:          # 没装 opencc 就保留原文，不阻断构建
    def t2s(t):
        return t


def pick_zh(alt, name):
    if not alt:
        return ""
    tokens = [t.strip() for t in alt.split(",") if t.strip()]
    zh = [t for t in tokens if CJK.search(t) and len(t) <= 12]
    if not zh:
        return ""
    # 优先「××市」或最短的纯中文名
    zh = [t2s(t) for t in zh]
    zh.sort(key=lambda t: (0 if t.endswith("市") else 1, len(t)))
    return zh[0]



# GeoNames 的中文别名里会混进日文写法（仏山/横浜/ウルムチ市），生成时必须清掉
JP_FIX = {"仏":"佛","浜":"滨","沢":"泽","竜":"龙","鉄":"铁","豊":"丰","桜":"樱",
          "駅":"驿","県":"县","広":"广","辺":"边","変":"变","図":"图","対":"对",
          "経":"经","気":"气","応":"应","悪":"恶","圧":"压","囲":"围","売":"卖",
          "読":"读","転":"转","軽":"轻","実":"实","戦":"战","険":"险","検":"检",
          "験":"验","権":"权","観":"观","歓":"欢","歯":"齿","歳":"岁","歴":"历",
          "暦":"历","薬":"药","様":"样"}
KANA_RE = re.compile(r"[\u3040-\u30ff]")


def clean_zh(zh):
    """日文新字体 → 简体；含假名的名字直接丢弃（宁可退回英文，也不显示日文）。"""
    if not zh:
        return zh
    zh = "".join(JP_FIX.get(ch, ch) for ch in zh)
    if KANA_RE.search(zh):
        return ""
    return zh


def main():
    if not os.path.exists(ZIP):
        raise SystemExit("缺少 cities15000.zip，先下载到 scripts/data/")
    rows = []
    with zipfile.ZipFile(ZIP) as z:
        with z.open("cities15000.txt") as fh:
            for line in fh:
                f = line.decode("utf-8").rstrip("\n").split("\t")
                if len(f) < 15:
                    continue
                try:
                    pop = int(f[14] or 0)
                except ValueError:
                    pop = 0
                if pop < MIN_POP:
                    continue
                lat, lon = float(f[4]), float(f[5])
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    continue
                zh = clean_zh(pick_zh(f[3], f[1]))
                rows.append({
                    "zh": zh, "en": f[1], "cc": f[8],
                    "lat": round(lat, 4), "lon": round(lon, 4), "pop": pop,
                })
    rows.sort(key=lambda r: -r["pop"])
    rows = rows[:LIMIT]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    with_zh = sum(1 for r in rows if r["zh"])
    print(f"world-cities.json {os.path.getsize(OUT)/1024:.0f}KB  城市 {len(rows)}  有中文名 {with_zh}")
    for probe in ("Hanoi", "Ho Chi Minh City", "Bangkok", "Athens"):
        hit = next((r for r in rows if r["en"] == probe), None)
        print(" ", probe, "→", (hit["zh"] or "(无中文名)") if hit else "missing")


if __name__ == "__main__":
    main()
