# 图像 Prompt 库（image-prompt-library）

> 每张素材一个独立文件，可直接 `codex-image -f <file>` 复现。
> 文件结构：中文规格（用途/构图/光照/色彩/避免）+ `## PROMPT (EN)` 英文段（直接喂给 CLI）。

---

## 索引

| 文件 | 素材 | 档位 | 分数 | 用途 |
|---|---|---|---|---|
| `sky-dusk-L0.txt` | 晚霞 L0 | 无烧 | 12 | 首屏 / 城市页头 |
| `sky-dusk-L1.txt` | 晚霞 L1 | 微烧 | 28 | 同上 |
| `sky-dusk-L2.txt` | 晚霞 L2 | 小烧 | 42 | 同上 |
| `sky-dusk-L3.txt` | 晚霞 L3 | 小到中烧 | 58 | 同上 |
| `sky-dusk-L4.txt` | 晚霞 L4 | 中到大烧 | 68 | **默认档** |
| `sky-dusk-L5.txt` | 晚霞 L5 | 大烧 | 86 | 同上 |
| `sky-dawn-L0.txt` | 朝霞 L0 | 无烧 | 12 | 明早场次 |
| `sky-dawn-L1.txt` … `L5.txt` | 朝霞 L1–L5 | — | 28–86 | 同上 |
| `share-card.txt` | 分享卡底图 | — | — | OG / 分享浮层 |

---

## 使用

```bash
cd public/assets/photography/sky
codex-image -f ../../../02-assets-planning/image-prompt-library/sky-dusk-L4.txt \
  --aspect 16:9 --quality hero \
  --out H01_hero_sky_L4_dusk_v01.jpg
```

生成后按 `asset-generation-plan.md §2` 的 8 项检查验收，不通过就改 Prompt 重出。

---

## 共用约束（所有天幕）

1. 地平线压在 80% 高度，天空占 80%。
2. 左 1/3 更暗更平，给标题与分数留位。
3. 无月、无星、无水印、无文字、无 UI。
4. 光源固定在右下低空（与默认日落方位 257° 的叙事一致）。
5. 自然曝光、细颗粒、轻微降饱和；拒绝 HDR 与霓虹。
