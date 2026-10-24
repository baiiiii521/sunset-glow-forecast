#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预报 vs 卫星观测对照：同一地点、同一日落时刻，比「预报云量」和「卫星看到的云」。

为什么只比云量、不比分数：
  GIBS 的 Himawari 图层是渲染后的 JPEG，不是原始亮温，无法反演"云底有没有被点亮"；
  但"天上有没有云、云有多高多厚"可以直接看出来。而云量预报误差往往比评分公式误差更大，
  所以先量这一层，才知道该改算法还是该换数据源。

用法：
  python3 verify_vs_sat.py --cities hcmc,nanyang,hangzhou --days 0
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.parse
import urllib.request

import obs_himawari as obs

CITIES = {
    "hcmc": ("胡志明市", 10.79, 106.75),
    "hanoi": ("河内", 21.03, 105.85),
    "nanyang": ("南阳", 32.99, 112.53),
    "hangzhou": ("杭州", 30.27, 120.16),
    "shanghai": ("上海", 31.23, 121.47),
    "beijing": ("北京", 39.90, 116.41),
    "bangkok": ("曼谷", 13.76, 100.50),
    "singapore": ("新加坡", 1.35, 103.82),
    "manila": ("马尼拉", 14.60, 120.98),
    "tokyo": ("东京", 35.68, 139.69),
}

FC = "https://api.open-meteo.com/v1/forecast"


def forecast(lat: float, lon: float, day: int) -> dict:
    q = {
        "latitude": lat, "longitude": lon,
        "hourly": "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
        "daily": "sunset", "timezone": "auto", "forecast_days": str(day + 2),
    }
    url = FC + "?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=30) as r:
        d = json.load(r)
    off = d["utc_offset_seconds"]
    times = d["hourly"]["time"]
    sunsets = d["daily"]["sunset"]
    ds = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=off) + dt.timedelta(days=day)).date().isoformat()
    k = d["daily"]["time"].index(ds)
    sunset_local = dt.datetime.fromisoformat(sunsets[k])
    sunset_utc = sunset_local - dt.timedelta(seconds=off)
    hour = sunset_local.strftime("%Y-%m-%dT%H:00")
    i = times.index(hour)
    h = d["hourly"]
    return {
        "date": ds, "sunset_utc": sunset_utc,
        "fc_total": h["cloud_cover"][i], "fc_low": h["cloud_cover_low"][i],
        "fc_mid": h["cloud_cover_mid"][i], "fc_high": h["cloud_cover_high"][i],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", default="hcmc,nanyang,hangzhou,shanghai,bangkok,manila,tokyo,singapore")
    ap.add_argument("--days", type=int, default=0)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rows = []
    for key in a.cities.split(","):
        key = key.strip()
        if key not in CITIES:
            continue
        name, lat, lon = CITIES[key]
        try:
            f = forecast(lat, lon, a.days)
        except Exception as e:
            rows.append({"city": name, "error": f"预报失败 {e}"})
            continue
        # 卫星时间取整到最近的 10 分钟（Himawari 全盘 10 分钟一张）
        t = f["sunset_utc"].replace(second=0, microsecond=0)
        t = t - dt.timedelta(minutes=t.minute % 10)
        utc = t.strftime("%Y-%m-%dT%H:%M:%SZ")
        bb = obs.bbox_for(lat, lon, 1.6)
        ir = obs.stats(obs.fetch("ir", utc, bb))
        # 可见光只在白天有意义：取日落前 60 分钟那一张
        t_vis = t - dt.timedelta(minutes=60)
        vis = obs.stats(obs.fetch("vis", t_vis.strftime("%Y-%m-%dT%H:%M:%SZ"), bb))
        rows.append({
            "city": name, "date": f["date"], "utc": utc,
            "fc_total": f["fc_total"], "fc_low": f["fc_low"], "fc_mid": f["fc_mid"], "fc_high": f["fc_high"],
            "obs_cloud": ir.get("cloud_frac"), "obs_high": ir.get("high_frac"), "obs_clear": ir.get("clear_frac"),
            "obs_vis_mean": vis.get("mean"),
        })

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    print(f"{'城市':8s} {'日期':10s} {'预报 高/中/低/总':22s} {'卫星 云/高云/晴':18s}")
    for r in rows:
        if "error" in r:
            print(f"{r['city']:8s} {r['error']}")
            continue
        print(f"{r['city']:8s} {r['date']:10s} "
              f"{r['fc_high']:3d}/{r['fc_mid']:3d}/{r['fc_low']:3d}/{r['fc_total']:3d}          "
              f"{(r['obs_cloud'] or 0)*100:5.1f}/{(r['obs_high'] or 0)*100:5.1f}/{(r['obs_clear'] or 0)*100:5.1f}")


if __name__ == "__main__":
    main()
