# 素材生成计划（asset-generation-plan）

> 工具：**Codex CLI**（`codex-image` → 本机 `codex` 的 `image_gen`）
> 约束：不得用其他生图工具替代；每张图独立 Prompt；生成后必须过质量检查。

---

## 1. 工具确认（已实测）

```
$ codex --version
codex-cli 0.163.0

$ codex-image --help
codex-image — 用本机 Codex CLI 的内置 image_gen 工具生成图片
  -o|--out PATH     输出文件
  -a|--aspect R     画幅提示 1:1 3:4 4:3 16:9 9:16
  -n|--count N      生成几张（默认 1）
  -q|--quality Q    draft|standard|hero
  -m|--model M      codex 模型
  -T|--timeout SEC  默认 300
  --json            只输出 JSON
退出码：0 成功 / 3 没产出 / 4 校验不过 / 5 codex 调用失败
```

实测单张 **30–120s**，输出 1672×941，约 1.6–2.2MB。

---

## 2. 生成流程（每张图都走一遍）

```
读参考图 → 定素材需求 → 写独立 Prompt → codex-image 调用
   → 视觉检查（8 项） → 不合格改 Prompt 重生成 → 合格归档 → 更新索引
```

**8 项质量检查**

| # | 检查 | 不合格处理 |
|---|---|---|
| 1 | 构图与参考图一致（地平线位置、留白方向） | 调 prompt 的 composition 段 |
| 2 | 主体位置正确（左 1/3 空、右 2/3 云） | 加 "copy space on the left third" |
| 3 | 比例 16:9 | `--aspect 16:9` |
| 4 | 色彩符合品牌（ember/gold/violet） | 明确色名与饱和度 |
| 5 | 光线自然（光源在右下低空） | 加 lighting direction |
| 6 | 无 AI 破绽（变形、重复、物理错误） | 重生成 |
| 7 | 无文字/水印/月亮/星星 | 加 negative 描述 |
| 8 | 裁切后仍成立（cover 到 16:9 与 21:9） | 重生成 |

---

## 3. 批次计划

### 批次 1 · 天幕 12 张（P0）

```bash
# 已在 Phase 1 完成首版，Phase 2 只做「抽检 + 必要时重出」
for L in 0 1 2 3 4 5; do
  codex-image -f 02-assets-planning/image-prompt-library/sky-dusk-L$L.txt \
    --aspect 16:9 --quality hero \
    --out public/assets/photography/sky/H01_hero_sky_L${L}_dusk_v01.jpg
done
for L in 0 1 2 3 4 5; do
  codex-image -f 02-assets-planning/image-prompt-library/sky-dawn-L$L.txt \
    --aspect 16:9 --quality hero \
    --out public/assets/photography/sky/H01_hero_sky_L${L}_dawn_v01.jpg
done
```

**已知返工点**：朝霞 L0 首版被画成 9/10 大烧（"dawn" 诱导暖色），Prompt 已加
`NO sun, NO sunrise glow, NO warm colour at all` 后重出为 0/10。

### 批次 2 · 分享卡底图（P1）

```bash
codex-image -f 02-assets-planning/image-prompt-library/share-card.txt \
  --aspect 16:9 --quality hero --out public/assets/generated/backgrounds/S01_share_card_bg_v01.jpg
```

### 批次 3 · 图标导出（P2，代码资产）

```bash
# 由 SVG 印章导出，不走生图
rsvg-convert -w 512 stamp.svg -o public/assets/icons/app-512.png
```

---

## 4. 归档规则

```
public/assets/photography/sky/H01_hero_sky_L4_dusk_v01.jpg
                                  └ 页面└模块 └素材名  └版本
```

- 同一素材重做 → 升版本号，旧版移入 `_archive/`，不覆盖。
- 每张图的 Prompt 与生成参数写入 `image-prompt-library/`，可复现。
- 生成记录追加到 `02-assets-planning/generation-log.md`（时间 / 命令 / 耗时 / 结果 / 评分）。

---

## 5. 当前状态

| 素材 | 状态 | 备注 |
|---|---|---|
| 12 张天幕 | ✅ 已有（v01，1672×941） | 视觉已过（总览 9.5/10），分辨率待定 |
| 分享卡底图 | ❌ 未生成 | 批次 2 待执行 |
| 图标 | ❌ 未导出 | 批次 3 |

---

## 6. 风险

| 风险 | 说明 | 应对 |
|---|---|---|
| 分辨率上限 | image_gen 输出 ~1672 宽 | 见 `asset-inventory §4` |
| 语义漂移 | "dawn/dusk" 会被模型理解为「加暖色」 | Prompt 里显式写 no warm colour |
| 一致性 | 12 张来自 12 次独立生成 | 固定同一套 composition/lighting 段落 |
| 合规 | 天幕为示意（非真实地点） | 界面标注「AI 天幕 · 示意」，不冒充实拍 |
