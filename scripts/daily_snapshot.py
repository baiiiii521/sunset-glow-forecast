#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每日霞光数据集快照：日落过后，把「预报云量 + 我们的霞分 + 机场实测云量」写一行 JSONL。

目的：攒出**带真值的数据集**，之后才能做校准（分数→概率）和权重学习。
不推送任何消息，只落盘。

用法：
  python3 daily_snapshot.py                 # 今天，全部城市
  python3 daily_snapshot.py --days 1        # 顺带补昨天
落盘：~/Developer/sunset-glow-forecast/sunset-glow-forecast/data/glow-dataset.jsonl
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verify_vs_metar as vm  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "glow-dataset.jsonl")


def score_for(lat: float, lon: float, day: int) -> dict | None:
    """调 node CLI 拿当前算法（v2）的分数。"""
    node = "/opt/homebrew/bin/node"
    if not os.path.exists(node):
        node = "node"
    cmd = [node, os.path.join(REPO, "scripts", "daily-push.js"),
           "--lat", str(lat), "--lon", str(lon), "--json", "--offset", str(max(0, day))]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=180).stdout
        d = json.loads(out)
        if d.get("days"):
            row = d["days"][0]
            return {"score": row["sunset"]["score"], "grade": row["sunset"]["grade"],
                    "conf": row["sunset"]["conf"], "members": [m["score"] for m in (row["sunset"].get("ensemble") or {}).get("members", [])]}
    except Exception as e:
        return {"error": str(e)[:80]}
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", default=",".join(vm.CITIES.keys()))
    ap.add_argument("--days", type=int, default=1, help="0=只今天；1=今天+昨天（跨时区补全）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    # 已有 (date, city) 去重，重复跑不会写重复行
    seen = set()
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as fh:
            for line in fh:
                try:
                    r = json.loads(line)
                    seen.add((r.get("date"), r.get("city")))
                except Exception:
                    pass

    now = dt.datetime.now(dt.timezone.utc)
    rows = []
    for key in [k.strip() for k in a.cities.split(",") if k.strip()]:
        if key not in vm.CITIES:
            continue
        name, lat, lon, icao = vm.CITIES[key]
        for back in range(a.days + 1):
            day = -back
            try:
                f = vm.forecast_at(lat, lon, day)
            except Exception:
                continue
            if f["sunset_utc"] > now - dt.timedelta(minutes=15):
                continue
            if (f["date"], name) in seen:
                continue
            try:
                o = vm.metar_layers(icao, f["sunset_utc"])
            except Exception:
                o = None
            s = score_for(lat, lon, day)
            rows.append({
                "date": f["date"], "city": name, "icao": icao, "lat": lat, "lon": lon,
                "sunset_utc": f["sunset_utc"].strftime("%Y-%m-%dT%H:%M:%SZ"),
                "fc": {k: f["fc_" + k] for k in ("low", "mid", "high", "total")},
                "obs": {k: o["obs_" + k] for k in ("low", "mid", "high")} if o else None,
                "obs_raw": o["raw"] if o else None,
                "score": s,
                "snapshot_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
            print(f"{name:8s} {f['date']} 预报 {f['fc_low']}/{f['fc_mid']}/{f['fc_high']} "
                  f"实测 {('-', '-', '-') if not o else (round(o['obs_low']*100), round(o['obs_mid']*100), round(o['obs_high']*100))} "
                  f"分数 {(s or {}).get('score')}")

    if a.dry_run:
        print(f"\n[dry-run] 将写入 {len(rows)} 行")
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "a", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\n已追加 {len(rows)} 行 -> {OUT}")


if __name__ == "__main__":
    main()
