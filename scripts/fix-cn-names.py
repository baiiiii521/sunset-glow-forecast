#!/usr/bin/env python3
"""把霞榜里没有中文名的中国城市，用最近的中国行政区名替换（只改显示名，不动分数）。"""
import json, math, re, sys, os

root = os.path.expanduser('~/glow')
data = os.path.join(root, 'data')
rank = json.load(open(os.path.join(data, 'rankings.json'), encoding='utf-8'))
pts = json.load(open(os.path.join(data, 'points-china.json'), encoding='utf-8'))['points']


def hav(a, b):
    R = 6371.0
    dlat = (b['lat'] - a['lat']) * math.pi / 180
    dlon = (b['lon'] - a['lon']) * math.pi / 180
    x = (math.sin(dlat / 2) ** 2
         + math.cos(a['lat'] * math.pi / 180) * math.cos(b['lat'] * math.pi / 180) * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(x))


def zh_near(lat, lon, limit=25.0):
    best, bd = None, 1e9
    for p in pts:
        d = hav({'lat': lat, 'lon': lon}, p)
        if d < bd:
            bd, best = d, p
    return best['name'] if bd <= limit else None


CJK = re.compile(r'[\u4e00-\u9fa5]')
fixed = []
for scope in ('global', 'china'):
    for c in rank.get(scope, []):
        city = c['city']
        if city.get('country') != '中国' or CJK.search(city['name']):
            continue
        z = zh_near(city['lat'], city['lon'])
        if z:
            fixed.append((city['name'], z))
            city['name'] = z

if fixed:
    tmp = os.path.join(data, 'rankings.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rank, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(data, 'rankings.json'))
print('改名:', fixed or '无')
