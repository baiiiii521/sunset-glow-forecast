#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""预报云量 vs 机场 METAR 实测云量（日落时刻）。

为什么用 METAR：
  METAR 是真实观测（每 30 分钟一次），直接给出分层云底高度和云量（FEW/SCT/BKN/OVC），
  正好对应算法的「高/中/低云」。比卫星渲染图做阈值判断精确得多，而且免费、无 key。

用法：
  python3 verify_vs_metar.py                       # 今天，默认城市
  python3 verify_vs_metar.py --cities hcmc,nanyang --json
  python3 verify_vs_metar.py --past                  # 含昨天（预报用当前模式回算，仅作参考）

云量换算（八分量中值）：FEW=0.19 SCT=0.44 BKN=0.75 OVC=1.0
层高分类（ft→m）：低 <2000m(6500ft)｜中 2000–6000m｜高 >6000m
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.parse
import urllib.request

CITIES = {
    "hcmc": ("胡志明市", 10.79, 106.75, "VVTS"),
    "hanoi": ("河内", 21.03, 105.85, "VVNB"),
    "nanyang": ("南阳", 32.99, 112.53, "ZSNY"),
    "zhengzhou": ("郑州", 34.75, 113.63, "ZHCC"),
    "hangzhou": ("杭州", 30.27, 120.16, "ZSHC"),
    "shanghai": ("上海", 31.23, 121.47, "ZSPD"),
    "beijing": ("北京", 39.90, 116.41, "ZBAA"),
    "chengdu": ("成都", 30.57, 104.07, "ZUUU"),
    "kunming": ("昆明", 25.04, 102.72, "ZPPP"),
    "xian": ("西安", 34.34, 108.94, "ZLXY"),
    "guangzhou": ("广州", 23.13, 113.26, "ZGGG"),
    "bangkok": ("曼谷", 13.76, 100.50, "VTBS"),
    "singapore": ("新加坡", 1.35, 103.82, "WSSS"),
    "jakarta": ("雅加达", -6.21, 106.85, "WIII"),
    "manila": ("马尼拉", 14.60, 120.98, "RPLL"),
    "taipei": ("台北", 25.03, 121.57, "RCTP"),
    "tokyo": ("东京", 35.68, 139.69, "RJTT"),
    "seoul": ("首尔", 37.57, 126.98, "RKSI"),
    "sydney": ("悉尼", -33.87, 151.21, "YSSY"),
}

OCTA = {"FEW": 0.19, "SCT": 0.44, "BKN": 0.75, "OVC": 1.0, "VV": 1.0}


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=45) as r:
        return json.load(r)


def forecast_at(lat: float, lon: float, day: int) -> dict:
    q = {"latitude": lat, "longitude": lon,
         "hourly": "cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
         "daily": "sunset", "timezone": "auto", "forecast_days": str(day + 3),
         "past_days": str(max(0, -day) + 1)}
    d = get_json("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q))
    off = d["utc_offset_seconds"]
    ds = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=off) + dt.timedelta(days=day)).date().isoformat()
    k = d["daily"]["time"].index(ds)
    sunset_local = dt.datetime.fromisoformat(d["daily"]["sunset"][k]).replace(tzinfo=dt.timezone.utc)
    hour = sunset_local.strftime("%Y-%m-%dT%H:00")
    i = d["hourly"]["time"].index(hour)
    h = d["hourly"]
    return {"date": ds, "sunset_utc": sunset_local - dt.timedelta(seconds=off),
            "fc_low": h["cloud_cover_low"][i], "fc_mid": h["cloud_cover_mid"][i],
            "fc_high": h["cloud_cover_high"][i], "fc_total": h["cloud_cover"][i]}


def metar_layers(icao: str, when: dt.datetime) -> dict | None:
    """取离 when 最近的一条 METAR（±45 分钟内），返回分层云量。"""
    d = get_json(f"https://aviationweather.gov/api/data/metar?ids={icao}&hours=72&format=json")
    if not d:
        return None
    best, best_dt = None, None
    for m in d:
        t = dt.datetime.fromisoformat(m["reportTime"].replace("Z", "+00:00"))
        gap = abs((t - when).total_seconds())
        if best_dt is None or gap < best_dt:
            best, best_dt = m, gap
    if best is None or best_dt > 45 * 60:
        return None
    lo = mid = high = 0.0
    for c in (best.get("clouds") or []):
        base_ft = c.get("base")
        frac = OCTA.get(c.get("cover", ""), 0.0)
        if base_ft is None:
            continue
        base_m = base_ft * 0.3048
        if base_m < 2000:
            lo = max(lo, frac)
        elif base_m < 6000:
            mid = max(mid, frac)
        else:
            high = max(high, frac)
    return {"utc": best["reportTime"], "gap_min": round(best_dt / 60),
            "obs_low": round(lo, 2), "obs_mid": round(mid, 2), "obs_high": round(high, 2),
            "raw": best.get("rawOb", "")[:90]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities", default=",".join(CITIES.keys()))
    ap.add_argument("--past", action="store_true", help="同时看昨天")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    rows = []
    for key in [k.strip() for k in a.cities.split(",") if k.strip()]:
        if key not in CITIES:
            continue
        name, lat, lon, icao = CITIES[key]
        for day in ([0, -1] if a.past else [0]):
            try:
                f = forecast_at(lat, lon, day)
            except Exception as e:
                rows.append({"city": name, "error": f"预报 {e}"})
                continue
            if f["sunset_utc"] > now - dt.timedelta(minutes=20):
                rows.append({"city": name, "date": f["date"], "skip": "日落还没到，无法对照"})
                continue
            try:
                o = metar_layers(icao, f["sunset_utc"])
            except Exception as e:
                rows.append({"city": name, "date": f["date"], "error": f"METAR {e}"})
                continue
            if not o:
                rows.append({"city": name, "date": f["date"], "error": "无 METAR"})
                continue
            rows.append({"city": name, "date": f["date"], **{k: f[k] for k in ("fc_low", "fc_mid", "fc_high", "fc_total")}, **o})

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return

    print(f"{'城市':8s} {'日期':11s} {'预报低/中/高':14s} {'实测低/中/高':14s} {'Δ低':>5s} {'Δ中':>5s} {'Δ高':>5s}")
    ok = []
    for r in rows:
        if "error" in r or "skip" in r:
            continue
        d = lambda a_, b_: (b_ - a_)
        print(f"{r['city']:8s} {r['date']:11s} "
              f"{r['fc_low']:3d}/{r['fc_mid']:3d}/{r['fc_high']:3d}    "
              f"{r['obs_low']*100:3.0f}/{r['obs_mid']*100:3.0f}/{r['obs_high']*100:3.0f}    "
              f"{d(r['fc_low'], r['obs_low']*100):+5.0f} {d(r['fc_mid'], r['obs_mid']*100):+5.0f} {d(r['fc_high'], r['obs_high']*100):+5.0f}")
        ok.append(r)
    if ok:
        n = len(ok)
        print(f"\n样本 {n}｜平均偏差：低 {sum(r['obs_low']*100 - r['fc_low'] for r in ok)/n:+.0f}%"
              f"  中 {sum(r['obs_mid']*100 - r['fc_mid'] for r in ok)/n:+.0f}%"
              f"  高 {sum(r['obs_high']*100 - r['fc_high'] for r in ok)/n:+.0f}%")


if __name__ == "__main__":
    main()
