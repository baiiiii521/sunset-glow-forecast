#!/usr/bin/env python3
"""生成中国地图 SVG（省级边界 + 台湾 + 南海诸岛 + 九段线 + 南海附图）。

数据源：https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json
输出：
  v2/assets/img/china.svg   主图 + 右下角南海诸岛附图
  v2/assets/img/china.json  投影参数（供前端算城市点位）

注意：这是视觉用底图。正式发布需自然资源部标准地图（含审图号）。
"""
import json, math, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", "data", "china-100000_full.json")
OUT_SVG = os.path.join(ROOT, "v2", "assets", "img", "china.svg")
OUT_JSON = os.path.join(ROOT, "v2", "assets", "img", "china.json")
SRC = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"

# 主图范围（不含南海诸岛，避免国土变形）
MAIN = dict(lon0=73.2, lon1=135.6, lat0=17.6, lat1=53.8)
# 南海附图范围
INSET = dict(lon0=104.5, lon1=124.5, lat0=2.6, lat1=23.6)
W = 1000.0          # 主图宽度（SVG 单位）
INSET_W = 168.0     # 附图宽度
PAD = 0.0


def merc_y(lat):
    lat = max(-85.0, min(85.0, lat))
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


def load():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding="utf-8"))
    req = urllib.request.Request(SRC, headers={"User-Agent": "glow-build/1.0"})
    raw = urllib.request.urlopen(req, timeout=40).read()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    open(CACHE, "wb").write(raw)
    return json.loads(raw)


class Proj:
    def __init__(self, bbox, width, dx=0.0, dy=0.0):
        self.b = bbox
        mx0, mx1 = bbox["lon0"], bbox["lon1"]
        my0, my1 = merc_y(bbox["lat1"]), merc_y(bbox["lat0"])  # my0=北边, my1=南边
        self.k = width / (mx1 - mx0)
        self.h = (my0 - my1) * self.k
        self.dx, self.dy = dx, dy

    def __call__(self, lon, lat):
        x = (lon - self.b["lon0"]) * self.k + self.dx
        y = (merc_y(self.b["lat1"]) - merc_y(lat)) * self.k + self.dy
        return x, y

    def params(self):
        return dict(lon0=self.b["lon0"], lon1=self.b["lon1"],
                    lat0=self.b["lat0"], lat1=self.b["lat1"],
                    k=self.k, dx=self.dx, dy=self.dy)


def rings(geom):
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"]]
    if t == "MultiPolygon":
        return geom["coordinates"]
    return []


def path_of(geom, proj, r=1):
    out = []
    for poly in rings(geom):
        for ring in poly:
            if len(ring) < 4:
                continue
            pts = [proj(lon, lat) for lon, lat in ring]
            d = "M" + " ".join(f"{x:.{r}f} {y:.{r}f}" for x, y in pts)
            out.append(d)
    return "".join(out)


def line_paths(geom, proj, r=1):
    t = geom["type"]
    lines = []
    if t == "LineString":
        lines = [geom["coordinates"]]
    elif t == "MultiLineString":
        lines = geom["coordinates"]
    elif t in ("Polygon", "MultiPolygon"):
        # 九段线数据是细长多边形，取外环中线近似为折线
        for poly in rings(geom):
            for ring in poly:
                if len(ring) >= 4:
                    lines.append(ring)
    out = []
    for coords in lines:
        pts = [proj(lon, lat) for lon, lat in coords]
        out.append("M" + " ".join(f"{x:.{r}f} {y:.{r}f}" for x, y in pts))
    return out


def main():
    gj = load()
    feats = gj["features"]
    prov = [f for f in feats if f["properties"].get("adcode") != "100000_JD"
            and f["properties"].get("name")]
    jd = [f for f in feats if f["properties"].get("adcode") == "100000_JD"]

    p_main = Proj(MAIN, W)
    H = p_main.h

    # 附图贴在右下角
    p_ins = Proj(INSET, INSET_W)
    ins_h = p_ins.h
    ins_x = W - INSET_W          # 右下角，另起一段高度避免压住陆地
    ins_y = H + 12
    p_ins.dx, p_ins.dy = ins_x, ins_y

    body = []
    body.append(f'<rect x="0" y="0" width="{W:.0f}" height="{H:.0f}" fill="none"/>')
    # 省级面
    for f in prov:
        d = path_of(f["geometry"], p_main)
        if d:
            body.append(f'<path class="prov" d="{d}"/>')
    # 附图：首先屏蔽底下的主图（南海一带）
    body.append(f'<rect class="inset-bg" x="{ins_x - 6:.1f}" y="{ins_y - 22:.1f}" '
                f'width="{INSET_W + 12:.1f}" height="{ins_h + 28:.1f}" rx="2"/>')
    body.append(f'<text class="inset-label" x="{ins_x - 2:.1f}" y="{ins_y - 8:.1f}">南海诸岛</text>')
    body.append(f'<g clip-path="url(#insetClip)">')
    for f in prov:
        d = path_of(f["geometry"], p_ins)
        if d:
            body.append(f'<path class="prov" d="{d}"/>')
    for f in jd:
        for d in line_paths(f["geometry"], p_ins):
            body.append(f'<path class="jd" d="{d}"/>')
    body.append("</g>")

    H_TOTAL = ins_y + ins_h + 4
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H_TOTAL:.0f}" preserveAspectRatio="xMidYMid meet">
<defs><clipPath id="insetClip"><rect x="{ins_x - 6:.1f}" y="{ins_y - 6:.1f}" width="{INSET_W + 12:.1f}" height="{ins_h + 12:.1f}"/></clipPath></defs>
<style>
  .prov{{fill:rgba(246,239,230,.075);stroke:rgba(246,239,230,.5);stroke-width:.8;stroke-linejoin:round}}
  .jd{{fill:none;stroke:rgba(255,145,90,.85);stroke-width:1.6;stroke-dasharray:7 5;stroke-linecap:round}}
  .inset-bg{{fill:#08070F;stroke:rgba(246,239,230,.28);stroke-width:.9}}
  .inset-label{{fill:rgba(246,239,230,.72);font:10px ui-monospace,monospace;letter-spacing:.12em}}
</style>
{chr(10).join(body)}
</svg>
'''
    os.makedirs(os.path.dirname(OUT_SVG), exist_ok=True)
    open(OUT_SVG, "w", encoding="utf-8").write(svg)

    meta = dict(
        source=SRC,
        note="视觉用底图；正式发布需替换为自然资源部标准地图并标注审图号",
        width=W, height=H_TOTAL,
        main=p_main.params(),
        inset=dict(p_ins.params(), w=INSET_W, h=ins_h, x=ins_x, y=ins_y),
        provinces=len(prov), hasNineDash=bool(jd),
    )
    json.dump(meta, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"china.svg {os.path.getsize(OUT_SVG)/1024:.0f}KB  viewBox 0 0 {W:.0f} {H_TOTAL:.0f}  省 {len(prov)}  九段线 {bool(jd)}")
    print(f"inset {INSET_W:.0f}×{ins_h:.0f} at ({ins_x:.0f},{ins_y:.0f})")


if __name__ == "__main__":
    main()
