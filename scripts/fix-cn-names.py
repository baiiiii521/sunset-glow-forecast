#!/usr/bin/env python3
"""霞榜数据修补：
1) 没有中文名的中国城市，用最近的中国行政区名替换（只改显示名，不动分数）
2) 按分数重算 level / grade，保证「显示的分数」和「等级」一致
   （历史数据里有 64.6 四舍五入成 65 但等级还是低一档的情况）
"""
import json, math, re, sys, os

root = os.path.expanduser('~/glow')
data = os.path.join(root, 'data')
FILES = ['rankings.json', 'rankings-all.json']
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
GRADES = ['无烧', '微烧', '小烧', '小到中烧', '中到大烧', '大烧']


def level_of(score):
    score = score or 0
    for lv in range(5, 0, -1):
        if score >= (80, 65, 50, 35, 20)[5 - lv]:
            return lv
    return 0
fixed = []
for name in FILES:
    path = os.path.join(data, name)
    if not os.path.exists(path):
        continue
    rank = json.load(open(path, encoding='utf-8'))
    changed = False
    for scope in ('global', 'china'):
        for c in rank.get(scope, []):
            city = c['city']
            # 等级跟着显示分数走
            lv = level_of(c.get('score'))
            if c.get('level') != lv:
                fixed.append((name, city['name'] + ' 等级', '%s→%s' % (c.get('level'), lv)))
                c['level'] = lv
                c['grade'] = GRADES[lv]
                changed = True
            if city.get('country') != '中国' or CJK.search(city['name']):
                continue
            z = zh_near(city['lat'], city['lon'])
            if z:
                fixed.append((name, city['name'], z))
                city['name'] = z
                changed = True
    # 等级变了，分档统计要跟着变；只有「统计总数 == 榜面条目数」时才重算
    st = rank.get('stats') or {}
    for scope in ('global', 'china'):
        block = st.get(scope) or {}
        counts = block.get('counts')
        lst = rank.get(scope) or []
        if isinstance(counts, list) and sum(counts) == len(lst):
            real = [0] * 6
            for c in lst:
                lv = c.get('level')
                if isinstance(lv, int) and 0 <= lv <= 5:
                    real[lv] += 1
            if real != counts:
                block['counts'] = real
                st[scope] = block
                changed = True
    if st:
        rank['stats'] = st

    if changed:
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(rank, f, ensure_ascii=False)
        os.replace(tmp, path)
print('改名:', fixed or '无')
