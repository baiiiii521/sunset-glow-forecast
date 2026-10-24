#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人工真值标注：把「这场到底烧没烧」记下来，后面才能算准确率。

为什么需要它：SunsetBot 2025-03 之后没再更新，微博也停了；国内已没有活的、
可程序化的火烧云真值源。机场 METAR 只能给「云」，给不了「霞」。
最便宜、最准的真值就是你自己抬头看一眼。

用法：
  python3 label.py --date 2026-10-22 --city 胡志明市 --level 3
  python3 label.py --date 2026-10-22 --city 胡志明市 --level 0 --note "西边全灰"
  python3 label.py --list                      # 看已标注的
等级：0 没烧 | 1 微烧（云边泛色） | 2 小烧（一小片） | 3 中烧（半个天） | 4 大烧（漫天）

落盘：data/glow-labels.jsonl（按 date+city 去重，后写的覆盖先写的）
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "glow-labels.jsonl")
NAMES = {0: "没烧", 1: "微烧", 2: "小烧", 3: "中烧", 4: "大烧"}


def load() -> list[dict]:
    if not os.path.exists(OUT):
        return []
    out = []
    with open(OUT, encoding="utf-8") as fh:
        for line in fh:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD（当地日期）")
    ap.add_argument("--city", default="胡志明市")
    ap.add_argument("--level", type=int, choices=[0, 1, 2, 3, 4])
    ap.add_argument("--note", default="")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()

    rows = load()
    if a.list or a.level is None:
        if not rows:
            print("还没有标注。加一条：python3 label.py --date 2026-10-22 --city 胡志明市 --level 3")
            return
        for r in sorted(rows, key=lambda x: (x["date"], x["city"])):
            print(f"{r['date']}  {r['city']:8s}  {r['level']} {NAMES[r['level']]:4s}  {r.get('note','')}")
        print(f"\n共 {len(rows)} 条")
        return

    if not a.date:
        a.date = dt.date.today().isoformat()
    row = {"date": a.date, "city": a.city, "level": a.level,
           "note": a.note, "labeled_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    rows = [r for r in rows if not (r["date"] == a.date and r["city"] == a.city)]
    rows.append(row)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        for r in sorted(rows, key=lambda x: (x["date"], x["city"])):
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"已记录：{a.date} {a.city} → {a.level} {NAMES[a.level]}" + (f"（{a.note}）" if a.note else ""))


if __name__ == "__main__":
    main()
