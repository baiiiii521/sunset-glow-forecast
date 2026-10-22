#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Himawari-9 观测探针（NASA GIBS WMS 版）—— 取任意时刻、任意小区域的红外/可见光切片并出统计量。

用途：给晚霞算法做「观测对照」。GIBS 的 Himawari 图层是渲染后的 JPEG（不是原始亮温），
所以这里只用它做**云量 / 云顶相对高低**的判断，不做绝对亮温反演。

用法：
  python3 obs_himawari.py --lat 10.79 --lon 106.75 --utc 2026-10-22T10:30:00Z --span 1.6
  python3 obs_himawari.py --lat 10.79 --lon 106.75 --utc 2026-10-22T09:00:00Z --json
"""
from __future__ import annotations

import argparse
import io
import json
import urllib.parse
import urllib.request

from PIL import Image

BASE = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
LAYERS = {
    "ir": "Himawari_AHI_Band13_Clean_Infrared",
    "vis": "Himawari_AHI_Band3_Red_Visible_1km",
}


def fetch(layer: str, utc: str, bbox: tuple[float, float, float, float], size: int = 512) -> Image.Image | None:
    params = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0",
        "LAYERS": LAYERS[layer], "CRS": "EPSG:4326",
        "BBOX": ",".join(f"{v:.4f}" for v in bbox),
        "WIDTH": str(size), "HEIGHT": str(size), "FORMAT": "image/jpeg",
        "TIME": utc,
    }
    url = BASE + "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=45) as r:
            data = r.read()
        im = Image.open(io.BytesIO(data)).convert("L")
        return im
    except Exception:
        return None


def stats(im: Image.Image | None) -> dict:
    if im is None:
        return {"ok": False}
    px = list(im.getdata())
    n = len(px)
    px_sorted = sorted(px)
    mean = sum(px) / n
    p = lambda q: px_sorted[min(n - 1, int(n * q))]
    # 云判别：渲染图中云比地表亮（IR 尤其明显）。阈值取经验值，随昼夜略变。
    cloud = sum(1 for v in px if v >= 150) / n          # 明显亮的像素 ≈ 云
    high = sum(1 for v in px if v >= 200) / n           # 很亮 ≈ 冷云顶（高云）
    dark = sum(1 for v in px if v <= 60) / n            # 很暗 ≈ 晴空 / 暖地表
    return {
        "ok": True, "mean": round(mean, 1), "p10": p(0.10), "p50": p(0.50), "p90": p(0.90),
        "cloud_frac": round(cloud, 3), "high_frac": round(high, 3), "clear_frac": round(dark, 3),
    }


def bbox_for(lat: float, lon: float, span: float) -> tuple[float, float, float, float]:
    # 纬度方向按 1:1 度，经度按 cos(lat) 补偿，近似正方形
    import math
    dlat = span / 2
    dlon = span / 2 / max(0.2, math.cos(math.radians(lat)))
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--utc", required=True, help="ISO8601, e.g. 2026-10-22T10:30:00Z")
    ap.add_argument("--span", type=float, default=1.6, help="区域边长（度），默认 1.6°≈180km")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    bb = bbox_for(a.lat, a.lon, a.span)
    out = {"utc": a.utc, "bbox": [round(v, 3) for v in bb], "span_deg": a.span}
    for k in ("ir", "vis"):
        out[k] = stats(fetch(k, a.utc, bb))
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        print(f"{a.utc}  bbox={out['bbox']}")
        for k in ("ir", "vis"):
            s = out[k]
            if not s.get("ok"):
                print(f"  {k:4s} 无数据")
                continue
            print(f"  {k:4s} mean={s['mean']:5.1f} p50={s['p50']:3d} p90={s['p90']:3d} "
                  f"云={s['cloud_frac']*100:5.1f}% 高云={s['high_frac']*100:5.1f}% 晴={s['clear_frac']*100:5.1f}%")


if __name__ == "__main__":
    main()
