#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""评估脚本：把「预报分数 + 云量」和「真值」对起来算准确率。

两条真值线：
  · 云量：glow-dataset.jsonl 里已带机场 METAR 实测（现在就能算，低云可信）
  · 霞分：glow-labels.jsonl 里的人工标注（0 没烧 / 1 微烧 / 2 小烧 / 3 中烧 / 4 大烧）
          —— 标注条数 ≥10 才会算命中率/AUC，样本太少时不硬算。

用法：python3 eval.py [--labels-only]
"""
from __future__ import annotations

import json
import os
import statistics as st

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "glow-dataset.jsonl")
LABELS = os.path.join(REPO, "data", "glow-labels.jsonl")

GRADE_BOUNDS = [(80, "大烧"), (65, "中到大烧"), (50, "小到中烧"), (35, "小烧"), (20, "微烧"), (0, "无烧")]


def level_of(score: float) -> int:
    for th, _ in GRADE_BOUNDS:
        if score >= th:
            return {80: 5, 65: 4, 50: 3, 35: 2, 20: 1, 0: 0}[th]
    return 0


def load(path):
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def corr(a, b):
    if len(a) < 3:
        return float("nan")
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return num / den if den else float("nan")


def cloud_eval(rows):
    print("=" * 60)
    print("① 云量：预报 vs 机场实测（越低越准；低云可信，高云 METAR 漏报）")
    print(f"样本 {len(rows)}")
    for k, label in (("low", "低云"), ("mid", "中云"), ("high", "高云")):
        pairs = [(r["fc"][k], r["obs"][k] * 100) for r in rows
                 if r.get("fc") and r["fc"].get(k) is not None and r.get("obs") and r["obs"].get(k) is not None]
        if len(pairs) < 5:
            print(f"  {label}: 样本不足")
            continue
        fc = [a for a, _ in pairs]
        ob = [b for _, b in pairs]
        bias = st.mean(ob) - st.mean(fc)
        mae = st.mean([abs(a - b) for a, b in pairs])
        r = corr(fc, ob)
        print(f"  {label:4s} 预报均值 {st.mean(fc):5.1f}% 实测 {st.mean(ob):5.1f}%  偏差 {bias:+5.1f}  MAE {mae:5.1f}  r={r:+.2f}")


def label_eval(rows):
    labels = {(r["date"], r["city"]): r["level"] for r in load(LABELS)}
    joined = [r for r in rows if (r.get("date"), r.get("city")) in labels and r.get("score") and "score" in r["score"]]
    print("=" * 60)
    print("② 霞分 vs 人工标注")
    print(f"数据集 {len(rows)} 行，标注 {len(labels)} 条，可匹配 {len(joined)} 条")
    if len(joined) < 10:
        print("标注 <10 条，不硬算命中率。继续攒：python3 scripts/label.py --date ... --level ...")
        if joined:
            print("已匹配样本：")
            for r in joined:
                s = r["score"]
                print(f"  {r['date']} {r['city']:8s} 霞分 {s['score']:3d} {s['grade']:6s}  → 实测 {labels[(r['date'], r['city'])]}")
        return
    # 命中率：预报档位 vs 标注档位（标注 0-4 映射到 0/1/2/3/5）
    MAP = {0: 0, 1: 1, 2: 2, 3: 4, 4: 5}
    hit = exact = 0
    for r in joined:
        pl = level_of(r["score"]["score"])
        ol = MAP[labels[(r["date"], r["city"])]]
        if abs(pl - ol) <= 1:
            hit += 1
        if pl == ol:
            exact += 1
    n = len(joined)
    print(f"±1 档命中率 {hit}/{n} = {hit / n * 100:.0f}%｜精确命中 {exact}/{n} = {exact / n * 100:.0f}%")
    # 烧不烧二分类 AUC（label>=2 视为「有烧」）
    pairs = [(r["score"]["score"], 1 if labels[(r["date"], r["city"])] >= 2 else 0) for r in joined]
    pos = [s for s, y in pairs if y == 1]
    neg = [s for s, y in pairs if y == 0]
    if pos and neg:
        auc = sum(1 for p in pos for q in neg if p > q) / (len(pos) * len(neg))
        print(f"「有烧(≥小烧)」二分类 AUC = {auc:.2f}（0.5 随机，1 完美）")


def main():
    rows = load(DATA)
    if not rows:
        print("还没有数据集。先跑 python3 scripts/daily_snapshot.py")
        return
    cloud_eval(rows)
    print()
    label_eval(rows)


if __name__ == "__main__":
    main()
