/* ============================================================
 * 全球朝霞晚霞预测 · 核心算法（SunsetAlgo）
 * 两层：v1 条件分与 ~/workspace/sunset-forecast/predict.py 保持一致的移植
 * （11 项加权评分，parity 测试对照 condScore / condGrade / condConf）；
 * v2 霞分在其上做幕布 × 缺口 × 低云的几何门控、六级分档、通透度和多模式集合（见文件末尾）。
 *
 * 注意：predict.py 中 c_gap 在 up_total_avg=30 附近存在不连续跳变
 * （<=30 时用 100-1.2x，>30 时用 lerp(100→40)），此处忠实移植，
 * 未擅自“修复”，以保证与现有实现输出一致。
 * 另：predict.py 的 hv() 对负索引会回绕取数组尾部（Python 语义），
 * 本移植按“缺失数据”处理（返回默认值），仅在事件小时 <3 时有差异，
 * 实际日出/日落事件不可能落在数组前 3 小时，故无影响。
 *
 * UMD：浏览器端挂到 window.SunsetAlgo，Node 端可 require。
 * ============================================================ */
(function (global) {
  'use strict';

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function lerp(x, x0, x1, y0, y1) {
    if (x <= x0) return y0;
    if (x >= x1) return y1;
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  // Python round() 是银行家舍入（half-even），与 JS Math.round 不同。
  function pyRound(x) {
    var f = Math.floor(x);
    var d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return (f % 2 === 0) ? f : f + 1;
  }

  // 对应 Python 的 f"{x:.0f}"
  function fmt0(x) { return String(pyRound(x)); }

  // 对应 Python 的 f"{x:.{digits}f}"
  function fmtFixed(x, digits) {
    var p = Math.pow(10, digits);
    return (pyRound(x * p) / p).toFixed(digits);
  }

  /* v2 新口径开关（默认全关 = 影子模式）。这些开关会改变霞分分布，
   * 没有标注数据不允许直接打开：先跑 scripts/replay-gap.js 看回放对比，
   * 由所有者决定。打开/关闭只改这一处。
   *  - gapV3：上游缺口改光路几何口径（cGap3，见下方注释）
   *  - windowAlign：多模式成员的云量对齐到同一时刻线性插值（替代
   *    只给 best_match 在 [-30,-15,0,+15] 里挑最大值的旧口径） */
  var FLAGS = { gapV3: false, windowAlign: false };

  function destination(lat, lon, bearingDeg, distKm) {
    var R = 6371.0;
    var d = distKm / R;
    var br = bearingDeg * Math.PI / 180;
    var lat1 = lat * Math.PI / 180;
    var lon1 = lon * Math.PI / 180;
    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    var lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
  }

  function solarDeclination(dayOfYear) {
    return -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (dayOfYear + 10) / 365.25);
  }

  function sunsetBearing(lat, dayOfYear) {
    var phi = lat * Math.PI / 180;
    var cosA = clamp(Math.sin(solarDeclination(dayOfYear)) / Math.cos(phi), -1, 1);
    return 360 - Math.acos(cosA) * 180 / Math.PI;
  }

  function sunriseBearing(lat, dayOfYear) {
    var phi = lat * Math.PI / 180;
    var cosA = clamp(Math.sin(solarDeclination(dayOfYear)) / Math.cos(phi), -1, 1);
    return Math.acos(cosA) * 180 / Math.PI;
  }

  /* ---------------- 云底受光 + 光谱亮度（移植 Skyglow，物理可解释） ----------------
   * 云底越高，进入地球阴影越晚（illumination_limit = -deg(sqrt(2h/R))），
   * 且照亮云底的光路更干净（瑞利 τ∝λ^-4.1 + 米 τ∝λ^-1.3·AOD）→ 更亮更红。
   * 用于给幕布项加「亮度/受光」因子，以及输出概率。 */
  var R_EARTH = 6371.0, RAYLEIGH_TAU_550 = 0.098, AEROSOL_ANGSTROM = 1.3,
      RAYLEIGH_SCALE_H = 7.5, AEROSOL_SCALE_H = 1.4, AEROSOL_AIRMASS_GAIN = 12.0;
  var DECK_BASE = { high: 8.6, mid: 5.2, low: 1.2 };
  var GLOW_ELEV = -1.0;   // 火烧云视觉峰值：太阳在地平线下约 1°

  function illuminationLimit(baseKm) {
    return -(Math.sqrt(2 * baseKm / R_EARTH)) * 180 / Math.PI;
  }

  function _airmass(sunElevDeg, baseKm) {
    var tanRay = 38 * Math.exp(-baseKm / RAYLEIGH_SCALE_H);
    var tanAer = AEROSOL_AIRMASS_GAIN * Math.exp(-baseKm / AEROSOL_SCALE_H);
    if (sunElevDeg >= 0) {
      var s = Math.max(Math.sin(sunElevDeg * Math.PI / 180), 0.005);
      return [Math.min(tanRay, 1 / s), Math.min(tanAer, 0.75 / s)];
    }
    var alpha = -sunElevDeg * Math.PI / 180;
    var ht = Math.max(0, baseKm - R_EARTH * alpha * alpha / 2);
    return [38 * Math.exp(-ht / RAYLEIGH_SCALE_H), AEROSOL_AIRMASS_GAIN * Math.exp(-ht / AEROSOL_SCALE_H)];
  }

  // 只算亮度（相对太阳直射，0–1），不积 RGB——给幕布加权够用了
  function deckLum(baseKm, aod, sunElevDeg) {
    sunElevDeg = (sunElevDeg === undefined || sunElevDeg === null) ? GLOW_ELEV : sunElevDeg;
    var m = _airmass(sunElevDeg, baseKm);
    var mRay = m[0], mAer = m[1];
    aod = Math.max(0, (aod === null || aod === undefined) ? 0.15 : aod);
    var Y = 0, Yw = 0;
    var gy = function (l, mu, s1, s2) { var s = l < mu ? s1 : s2; return Math.exp(-0.5 * Math.pow((l - mu) / s, 2)); };
    var ybar = function (l) { return 0.821 * gy(l, 568.8, 46.9, 40.5) + 0.286 * gy(l, 530.9, 16.3, 31.1); };
    for (var l = 400; l <= 700; l += 5) {
      var lm = l * 1e-9, h = 6.626e-34, c = 3e8, k = 1.381e-23;
      var planck = (2 * h * c * c / Math.pow(lm, 5)) / (Math.exp(h * c / (lm * k * 5778)) - 1);
      var tau = RAYLEIGH_TAU_550 * Math.pow(550 / l, 4.1) * mRay + aod * Math.pow(550 / l, AEROSOL_ANGSTROM) * mAer;
      var spec = planck * Math.exp(-tau);
      var yb = ybar(l);
      Y += spec * yb; Yw += planck * yb;
    }
    return Y / Math.max(Yw, 1e-9);
  }

  // 分数 → 概率（sigmoid，参数锚定 Skyglow 在上海 1109 条标签上拟合的等级概率档位）
  // 使 小到中烧(50)≈26%、中到大烧(65)≈38%、大烧(80)≈52%，基准烧率 ~17%。
  function scoreToProb(score) {
    var z = 0.0375 * (score - 77.9);
    if (z < -60) return 0; if (z > 60) return 1;
    return 1 / (1 + Math.exp(-z));
  }

  // 把 "YYYY-MM-DDTHH:MM"（某时区的墙上时间）换算成真实 epoch（毫秒）。
  // offsetSec 为该时区相对 UTC 的秒数（Open-Meteo 返回的 utc_offset_seconds）。
  function toEpoch(timeStr, offsetSec) {
    return Date.parse(timeStr + ':00Z') - offsetSec * 1000;
  }

  // 在 epoch 数组中找 <= target 的最后一个下标（对应 Python idx_floor）。
  function idxFloor(times, target) {
    var best = 0;
    for (var i = 0; i < times.length; i++) {
      if (times[i] <= target) best = i; else break;
    }
    return best;
  }

  // 找最接近 target 的下标（对应 Python idx_nearest）。
  function idxNearest(times, target) {
    var best = 0, bestDiff = null;
    for (var i = 0; i < times.length; i++) {
      var diff = Math.abs(times[i] - target);
      if (bestDiff === null || diff < bestDiff) { best = i; bestDiff = diff; }
    }
    return best;
  }

  function hv(hourly, key, i, def) {
    var arr = (hourly && hourly[key]) || [];
    if (i === null || i === undefined || i < 0 || i >= arr.length) return def;
    var v = arr[i];
    return (v === null || v === undefined) ? def : v;
  }

  // 把逐小时云量在 epoch 处做整点间线性插值（frac = 距整点的小数），
  // 返回浅拷贝（不动原数组）。某一格为 null 时取另一格（就近），
  // 两格都 null 保持 null。用于让所有模式成员对齐到同一时刻（FLAGS.windowAlign）。
  var CLOUD_KEYS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];
  function blendCloudAt(hourly, epoch, offsetSec) {
    if (!hourly || !hourly.time || !hourly.time.length) return hourly;
    var times = hourly.time.map(function (t) { return toEpoch(t, offsetSec); });
    var i = idxFloor(times, epoch);
    if (i < 0 || i + 1 >= times.length) return hourly;
    var frac = clamp((epoch - times[i]) / 3600000, 0, 1);
    if (frac <= 0) return hourly;
    var out = {};
    for (var kk in hourly) if (Object.prototype.hasOwnProperty.call(hourly, kk)) out[kk] = hourly[kk];
    CLOUD_KEYS.forEach(function (v) {
      var arr = hourly[v];
      if (!arr) return;
      var a = arr[i], b = arr[i + 1];
      var m;
      if (a === null || a === undefined) m = (b === null || b === undefined) ? null : b;
      else if (b === null || b === undefined) m = a;
      else m = (1 - frac) * a + frac * b;
      var copy = arr.slice();
      copy[i] = m;
      out[v] = copy;
    });
    return out;
  }

  /* ---------------- 各分项评分：返回 [分数(0-100 或 null), 说明] ---------------- */

  function cCurtain(mid, high) {
    var c = clamp((mid || 0) + (high || 0), 0, 100);
    if (c <= 0) return [0, '无中高云幕布'];
    if (c <= 30) return [70 * c / 30, '中高云偏薄（' + fmt0(c) + '%）'];
    if (c <= 70) return [70 + 30 * (c - 30) / 40, '中高云幕布充足（' + fmt0(c) + '%）'];
    if (c <= 90) return [100 - 30 * (c - 70) / 20, '中高云较厚（' + fmt0(c) + '%）'];
    return [70 - 40 * (c - 90) / 10, '中高云近全覆盖（' + fmt0(c) + '%）'];
  }

  // v2 专用幕布：中云和高云各占天空比例，直接相加会重复计算重叠部分。
  // 按随机重叠合成 1-(1-m)(1-h)：60% 高云 + 40% 中云 = 76%，不是 100%。
  function cCurtainV2(mid, high) {
    var m = clamp(mid || 0, 0, 100), hh = clamp(high || 0, 0, 100);
    return cCurtain(0, 100 * (1 - (1 - m / 100) * (1 - hh / 100)));
  }

  // 幕布「受光亮度」因子（Skyglow 光谱，仅用于 v2 霞分，不动 v1 条件分/parity）：
  // 高云(8.6km)光路更干净、更亮，中云(5.2km)次之；AOD 越高越暗。
  // 返回 0.6–1.0 的乘子：纯高云=1.0，纯中云≈0.75，乘在幕布分上。
  function curtainLight(high, mid, aod) {
    var hi = clamp(high || 0, 0, 100), mi = clamp(mid || 0, 0, 100);
    if (hi + mi <= 0) return 1.0;
    var lumHigh = deckLum(DECK_BASE.high, aod), lumMid = deckLum(DECK_BASE.mid, aod);
    var light = (hi * lumHigh + mi * lumMid) / Math.max(hi + mi, 1);
    return clamp(light / Math.max(lumHigh, 1e-9), 0.6, 1.0);
  }

  function cLow(low) {
    low = low || 0;
    if (low <= 20) return [100, '低云少'];
    if (low <= 60) return [lerp(low, 20, 60, 100, 30), '低云 ' + fmt0(low) + '%'];
    return [lerp(low, 60, 100, 30, 0), '低云厚 ' + fmt0(low) + '%'];
  }

  function cGap(upLowAvg, upTotalAvg) {
    if (upTotalAvg === null || upTotalAvg === undefined) return [null, '无上游云量数据'];
    var s;
    if (upTotalAvg <= 30) s = clamp(100 - upTotalAvg * 1.2, 0, 100);
    else if (upTotalAvg <= 70) s = lerp(upTotalAvg, 30, 70, 100, 40);
    else s = lerp(upTotalAvg, 70, 100, 40, 0);
    if ((upLowAvg || 0) > 50) s = Math.max(0, s - 20);
    if (s >= 80) return [s, '太阳方向晴空缺口大'];
    if (s >= 50) return [s, '太阳方向有部分云'];
    return [s, '太阳方向上游云多，缺口小'];
  }

  // v2 缺口：只把上游低云和一半中云算作挡光，高云（卷云）不算。
  // 日落前后照亮云底的光是贴着地平线从低空射来的，挡住它的是远处的低云 / 中云。
  // 2026-10-20 对照：v1 缺口（用总云量）与对方判断在 4 段里有 3 段负相关；
  // 改用这一版后，对方「今日朝霞回顾」的吻合度 0.58 → 0.70，对其预报的吻合度基本不变。
  function cGap2(upLowAvg, upMidAvg) {
    if (upLowAvg === null || upLowAvg === undefined) return [null, '无上游云量数据'];
    var block = clamp(upLowAvg + 0.5 * (upMidAvg || 0), 0, 100);
    var s = clamp(lerp(block, 10, 90, 100, 0), 0, 100);
    var txt = '上游挡光云 ' + fmt0(block) + '%';
    if (s >= 80) return [s, '太阳方向晴空缺口大（' + txt + '）'];
    if (s >= 50) return [s, '太阳方向有部分低 / 中云（' + txt + '）'];
    return [s, '太阳方向低 / 中云多，缺口小（' + txt + '）'];
  }

  /* ---------------- cGap3：按光路几何算缺口（影子输出，FLAGS.gapV3 控制，默认关） ----------------
   * 几何：太阳压到地平线下 α 度时，射向本地高度 h 云底的光，在朝太阳方向 d km 处
   * 离地 z = h − d·tanα + d²/2R。α=0 时光线随距离升高（远处挡不到）；α 逼近
   * 照亮极限 −√(2h/R)（高云 8.6km→2.98°、中云 5.2km→2.31°）时在 d=tanα·R 处擦地
   * （高云约 331km），那时低云才真正挡光。旧口径 1/(1+d/100) 给近处最高权重，
   * 方向恰好相反——但也不能只取照亮极限那一刻（多数时候光路还很高，低云挡不到）。
   * 所以按 α ∈ {1°,2°,2.9°}（约日落后 1/6/12 分钟）取阶段平均，每阶段只算
   * α 小于该层照亮极限的部分。
   * 每点挡光量：光线高度 z 对云层的「软隶属度」（低云 0–3.5km、中云 3–6.5km，
   * 不设硬阈值，避免 3.36km vs 3.5km 这种边界翻转）；沿光路合成
   * T = Π(1−cᵢ)^(Δdᵢ/L)，去相关长度 L=200km（相邻模式格点云量不独立，
   * 纯连乘会把碎云当成五道独立的墙，过度悲观）。 */
  var GAP3 = {
    STAGES_DEG: [1, 2, 2.9],
    TOPS: { low: 3.5, mid: 6.5 },
    MID_BASE_KM: 3.0,
    DECORR_KM: 200
  };
  function gap3Membership(kind, zKm) {
    if (kind === 'low') return clamp((GAP3.TOPS.low - zKm) / GAP3.TOPS.low, 0, 1);
    // 中云是梯形：光线在中云底(≈3km)以下穿过就不该被它挡住（z≤2 完全不算，
    // 2–3km 过渡）；只设上界会把从云底下方掠过的光也当成全挡
    return clamp((zKm - GAP3.MID_BASE_KM + 1) / 1, 0, 1) * clamp((GAP3.TOPS.mid - zKm) / (GAP3.TOPS.mid - GAP3.MID_BASE_KM), 0, 1);
  }
  // pts: [{d, low, mid}]（d=km，low/mid=百分比或 null）；midLocal/highLocal 用于按幕布构成加权两条光路
  function cGap3(pts, midLocal, highLocal) {
    var usable = (pts || []).filter(function (p) {
      return p && p.d != null && ((p.low != null) || (p.mid != null));
    });
    if (!usable.length) return [null, '无上游云量数据'];
    usable.sort(function (a, b) { return a.d - b.d; });
    // 每个采样点代表的光路长度（中点规则；单点按 100km 计），
    // 再归一到固定总长：精算 5 点合计约 425km、粗筛 3 点只有约 325km，
    // 不归一的话同样云况下粗筛透射会更乐观，粗筛排名会偏
    var spans = usable.map(function (p, k) {
      var prev = k > 0 ? usable[k - 1].d : Math.max(0, p.d - 100);
      var next = k < usable.length - 1 ? usable[k + 1].d : p.d + 100;
      return Math.max(1, (next - prev) / 2);
    });
    var spanTotal = spans.reduce(function (a, b) { return a + b; }, 0);
    var PATH_KM = 450;   // 光路代表长度：0 到最后一个采样点外延
    spans = spans.map(function (s) { return s * PATH_KM / spanTotal; });
    function deckT(deckH) {
      var limitDeg = -illuminationLimit(deckH);
      var stages = GAP3.STAGES_DEG.filter(function (a) { return a < limitDeg; });
      if (!stages.length) return null;
      var ts = stages.map(function (aDeg) {
        var tanA = Math.tan(aDeg * Math.PI / 180);
        var T = 1;
        usable.forEach(function (p, k) {
          var z = deckH - p.d * tanA + p.d * p.d / (2 * R_EARTH);
          if (z < 0) z = 0;
          var c = 0;
          if (p.low != null) { var cl = gap3Membership('low', z) * p.low / 100; c = c + cl - c * cl; }
          if (p.mid != null) { var cm = gap3Membership('mid', z) * p.mid / 100; c = c + cm - c * cm; }
          T *= Math.pow(1 - c, spans[k] / GAP3.DECORR_KM);
        });
        return Math.max(T, 0.05);
      });
      return ts.reduce(function (a, b) { return a + b; }, 0) / ts.length;
    }
    var tHigh = deckT(DECK_BASE.high), tMid = deckT(DECK_BASE.mid);
    var hi = clamp(highLocal || 0, 0, 100), mi = clamp(midLocal || 0, 0, 100);
    // 幕布以高云为主时看高云光路，以中云为主时看中云光路；两者都无云时等权
    var share = (hi + mi) > 0 ? hi / (hi + mi) : 0.5;
    var parts = [];
    if (tHigh !== null) parts.push([share, tHigh]);
    if (tMid !== null) parts.push([1 - share, tMid]);
    if (!parts.length) return [null, '无上游云量数据'];
    var wsum = parts.reduce(function (a, x) { return a + x[0]; }, 0);
    var T = parts.reduce(function (a, x) { return a + x[0] * x[1]; }, 0) / (wsum || 1);
    var s = clamp(100 * T, 0, 100);
    var txt = '光路透射 ' + fmtFixed(T * 100, 0) + '%';
    if (s >= 80) return [s, '太阳方向光路通畅（' + txt + '）'];
    if (s >= 50) return [s, '太阳方向光路部分被挡（' + txt + '）'];
    return [s, '太阳方向光路被挡（' + txt + '）'];
  }

  function cPrecip(precip, prob) {
    precip = precip || 0;
    prob = prob || 0;
    if (precip > 0.2 || prob > 60) return [0, '霞时刻有降水'];
    if (prob > 30 || precip > 0) return [50, '霞时刻降水概率 ' + fmt0(prob) + '%'];
    return [100, '霞时刻无降水'];
  }

  function cWashed(pre3, precipNow, probNow) {
    var dryNow = (precipNow || 0) <= 0.2 && (probNow || 0) <= 60;
    if (pre3 >= 1 && dryNow) return [100, '霞前 3 小时降水 ' + fmtFixed(pre3, 1) + 'mm 已停（雨后洗净）'];
    if (pre3 >= 1 && !dryNow) return [0, '霞前降水 ' + fmtFixed(pre3, 1) + 'mm 但霞时刻未停'];
    if (pre3 > 0.2 && dryNow) return [50, '霞前有少量降水'];
    return [0, '霞前无降水'];
  }

  function cAod(aod) {
    if (aod === null || aod === undefined) return [null, '无 AOD 数据'];
    if (aod < 0.05) return [40, 'AOD 过低（' + fmtFixed(aod, 2) + '），颜色偏淡'];
    if (aod <= 0.35) return [100, 'AOD 适中（' + fmtFixed(aod, 2) + '）'];
    if (aod <= 0.5) return [lerp(aod, 0.35, 0.5, 100, 30), 'AOD 偏高（' + fmtFixed(aod, 2) + '）'];
    if (aod <= 1.0) return [lerp(aod, 0.5, 1.0, 30, 0), 'AOD 很高（' + fmtFixed(aod, 2) + '），压暗'];
    return [0, 'AOD 极高（' + fmtFixed(aod, 2) + '）'];
  }

  function cVis(visM) {
    if (visM === null || visM === undefined) return [null, '无能见度数据'];
    var km = visM / 1000.0;
    if (km >= 15) return [100, '能见度 ' + fmt0(km) + 'km'];
    if (km >= 8) return [lerp(km, 8, 15, 40, 100), '能见度 ' + fmt0(km) + 'km'];
    return [lerp(km, 0, 8, 0, 40), '能见度低 ' + fmt0(km) + 'km'];
  }

  function cPm(pm) {
    if (pm === null || pm === undefined) return [null, '无 PM2.5 数据'];
    if (pm <= 15) return [100, 'PM2.5 ' + fmt0(pm)];
    if (pm <= 35) return [lerp(pm, 15, 35, 100, 40), 'PM2.5 ' + fmt0(pm)];
    if (pm <= 75) return [lerp(pm, 35, 75, 40, 0), 'PM2.5 高 ' + fmt0(pm)];
    return [0, 'PM2.5 很高 ' + fmt0(pm)];
  }

  function cDew(temp, dew) {
    if (temp === null || temp === undefined || dew === null || dew === undefined) return [null, '无露点数据'];
    var d = temp - dew;
    if (d >= 5) return [100, '露点差 ' + fmtFixed(d, 1) + '°C（干透）'];
    if (d >= 2) return [lerp(d, 2, 5, 30, 100), '露点差 ' + fmtFixed(d, 1) + '°C'];
    return [lerp(d, 0, 2, 0, 30), '露点差小 ' + fmtFixed(d, 1) + '°C（近饱和）'];
  }

  function cWind(ws) {
    if (ws === null || ws === undefined) return [null, '无风速数据'];
    if (ws < 5) return [60, '风速 ' + fmt0(ws) + 'km/h（近静风）'];
    if (ws <= 20) return [100, '风速 ' + fmt0(ws) + 'km/h（微风）'];
    if (ws <= 35) return [lerp(ws, 20, 35, 100, 40), '风速 ' + fmt0(ws) + 'km/h'];
    return [lerp(ws, 35, 60, 40, 0), '风速大 ' + fmt0(ws) + 'km/h'];
  }

  function cCape(cape, low, prob) {
    if (cape === null || cape === undefined) return [null, '无 CAPE 数据'];
    if (cape > 2000 && (low || 0) > 50 && (prob || 0) > 50) return [0, 'CAPE 高（' + fmt0(cape) + '）+ 低云厚，对流未消'];
    if (cape > 1500) return [60, 'CAPE ' + fmt0(cape) + '（对流活跃）'];
    return [100, 'CAPE ' + fmt0(cape)];
  }

  var WEIGHTS = [
    ['curtain', 30], ['low', 20], ['gap', 20], ['precip', 10],
    ['aod', 5], ['vis', 3], ['pm', 3],
    ['dew', 2], ['wind', 2], ['cape', 2]
  ]; // 合计 97；雨后洗净是纯加成（0–3 分），不进加权平均

  /**
   * 对单个事件（一次日出 / 日落）评分。
   * fcLocal: Open-Meteo 预报 API 原始返回（含 hourly + utc_offset_seconds）
   * aqLocal: Open-Meteo 空气质量 API 原始返回（可为 null，表示缺失）
   * upstreamFcs: 上游 50/150/300km 三点预报原始返回数组（按距离顺序）
   * eventEpoch: 事件真实 epoch（毫秒）
   * bearing: 日出/日落方位角（度）
   * offsetSec: 主点时区 utc_offset_seconds
   */
  function evaluate(fcLocal, aqLocal, upstreamFcs, eventEpoch, bearing, offsetSec, cloudOverride, upDist) {
    var h = fcLocal.hourly || {};
    var times = (h.time || []).map(function (t) { return toEpoch(t, offsetSec); });
    var i = idxFloor(times, eventEpoch);

    // 缺字段要能区分出来：null = 没数据，0 = 真的晴。缺数据不能当利好
    var midRaw = (cloudOverride && cloudOverride.mid !== undefined && cloudOverride.mid !== null) ? cloudOverride.mid : hv(h, 'cloud_cover_mid', i, null);
    var highRaw = (cloudOverride && cloudOverride.high !== undefined && cloudOverride.high !== null) ? cloudOverride.high : hv(h, 'cloud_cover_high', i, null);
    var lowRaw = (cloudOverride && cloudOverride.low !== undefined && cloudOverride.low !== null) ? cloudOverride.low : hv(h, 'cloud_cover_low', i, null);
    var cloudMissing = (midRaw === null || midRaw === undefined || highRaw === null || highRaw === undefined || lowRaw === null || lowRaw === undefined);
    var mid = cloudMissing ? 0 : midRaw;
    var high = cloudMissing ? 0 : highRaw;
    var low = cloudMissing ? 0 : lowRaw;
    var precip = hv(h, 'precipitation', i, 0);
    var prob = hv(h, 'precipitation_probability', i, 0);
    // Open-Meteo 的 precipitation / precipitation_probability 是「前一小时」的累计，
    // 标在 17:00 的值覆盖的是 16–17 点。事件在 17:44 时，真正相关的是标在 18:00 的那格。
    var ip = Math.min(i + 1, (h.time ? h.time.length - 1 : i));
    var precipV2 = hv(h, 'precipitation', ip, null);
    var probV2 = hv(h, 'precipitation_probability', ip, null);
    var vis = hv(h, 'visibility', i, null);
    var temp = hv(h, 'temperature_2m', i, null);
    var dew = hv(h, 'dew_point_2m', i, null);
    var ws = hv(h, 'wind_speed_10m', i, null);
    var wd = hv(h, 'wind_direction_10m', i, null);
    var cape = hv(h, 'cape', i, null);

    var pre3 = 0;
    for (var k = 1; k <= 3; k++) pre3 += hv(h, 'precipitation', i - k, 0) || 0;
    // v2 雨洗窗口：i,i-1,i-2 三格（前一小时口径下覆盖 [i-3h, i]，即「霞前 3 小时」；
    // 旧 pre3 取 i-1..i-3，漏掉紧贴事件的那一小时）。「霞时刻停没停」由 ip 那格单独判断，
    // 同一小时的雨不会既算「洗净」又算「未停」。
    var pre3V2 = 0;
    for (var k2 = 0; k2 <= 2; k2++) pre3V2 += hv(h, 'precipitation', i - k2, 0) || 0;

    // 上游晴空缺口：upstreamFcs 按 50/150/300km 顺序
    var upLow = [], upTotal = [], upMid = [], upW = [], upPts = [];
    (upstreamFcs || []).forEach(function (fcUp, idxUp) {
      if (!fcUp || !fcUp.hourly) return;
      var upOffset = (fcUp.utc_offset_seconds !== undefined && fcUp.utc_offset_seconds !== null)
        ? fcUp.utc_offset_seconds : offsetSec;
      var utimes = (fcUp.hourly.time || []).map(function (t) { return toEpoch(t, upOffset); });
      var j = idxFloor(utimes, eventEpoch);
      var l = hv(fcUp.hourly, 'cloud_cover_low', j, null);
      var t = hv(fcUp.hourly, 'cloud_cover', j, null);
      var mm = hv(fcUp.hourly, 'cloud_cover_mid', j, null);
      // 距离越近挡光越狠：w = 1/(1+d/100)；没有距离表时等权
      var w = (upDist && upDist[idxUp] !== undefined) ? 1 / (1 + upDist[idxUp] / 100) : 1;
      if (l !== null && l !== undefined) { upLow.push(l); upW.push(w); }
      if (mm !== null && mm !== undefined) upMid.push(mm);
      if (t !== null && t !== undefined) upTotal.push(t);
      // cGap3 用：每点 {d, low, mid}（d 缺失的点它自己会剔除）
      upPts.push({
        d: (upDist && upDist[idxUp] !== undefined) ? upDist[idxUp] : null,
        low: l, mid: mm
      });
    });
    var wsum = upW.reduce(function (a, b) { return a + b; }, 0);
    var upLowAvg = (upLow.length && wsum)
      ? upLow.reduce(function (a, v, k) { return a + v * upW[k]; }, 0) / wsum
      : (upLow.length ? upLow.reduce(function (a, b) { return a + b; }, 0) / upLow.length : null);
    var upTotalAvg = upTotal.length ? upTotal.reduce(function (a, b) { return a + b; }, 0) / upTotal.length : null;
    var upMidAvg = upMid.length ? upMid.reduce(function (a, b) { return a + b; }, 0) / upMid.length : null;

    // 空气质量：取最近时刻
    var aod = null, pm = null;
    if (aqLocal && aqLocal.hourly) {
      var aqOffset = (aqLocal.utc_offset_seconds !== undefined && aqLocal.utc_offset_seconds !== null)
        ? aqLocal.utc_offset_seconds : offsetSec;
      var aqTimes = (aqLocal.hourly.time || []).map(function (t) { return toEpoch(t, aqOffset); });
      var ai = idxNearest(aqTimes, eventEpoch);
      aod = hv(aqLocal.hourly, 'aerosol_optical_depth', ai, null);
      pm = hv(aqLocal.hourly, 'pm2_5', ai, null);
    }

    var comps = {
      curtain: cloudMissing ? [null, '缺云量数据'] : cCurtain(mid, high),
      low: cloudMissing ? [null, '缺云量数据'] : cLow(low),
      gap: cGap(upLowAvg, upTotalAvg),
      gapV2: cloudMissing ? [null, '缺云量数据'] : cGap2(upLowAvg, upMidAvg),
      gapV3: cloudMissing ? [null, '缺云量数据'] : cGap3(upPts, mid, high),
      precip: cPrecip(precip, prob),
      precipV2: cPrecip(precipV2 === null ? precip : precipV2, probV2 === null ? prob : probV2),
      washed: cWashed(pre3, precip, prob),
      washedV2: cWashed(pre3V2, precipV2 === null ? precip : precipV2, probV2 === null ? prob : probV2),
      aod: cAod(aod),
      vis: cVis(vis),
      pm: cPm(pm),
      dew: cDew(temp, dew),
      wind: cWind(ws),
      cape: cCape(cape, low, prob)
    };
    // v2 幕布「受光亮度」：高云比中云更亮、AOD 越高越暗（Skyglow 光谱），只影响霞分
    var lightNorm = curtainLight(high, mid, aod);
    var baseCurtain = cloudMissing ? null : cCurtainV2(mid, high);
    if (baseCurtain === null) comps.curtainV2 = [null, '缺云量数据'];
    else comps.curtainV2 = [clamp(baseCurtain[0] * (0.75 + 0.25 * lightNorm), 0, 100), baseCurtain[1]];

    var totalW = 0, totalS = 0;
    WEIGHTS.forEach(function (w) {
      var s = comps[w[0]][0];
      if (s !== null && s !== undefined) { totalW += w[1]; totalS += s * w[1]; }
    });
    var score = totalW ? totalS / totalW : 50.0;
    // 雨后洗净是纯加成：0–3 分
    var washedScore = comps.washed[0];
    if (washedScore) score = Math.min(100, score + washedScore * 0.03);

    // 季节修正：偏南风 + AOD 高 = 跨境烟霾风险
    var hazeNote = '';
    if (wd !== null && wd !== undefined && wd >= 135 && wd <= 225 && aod !== null && aod !== undefined && aod > 0.35) {
      score = Math.max(0, score - 5);
      hazeNote = '偏南风 + AOD 高，跨境烟霾风险';
    }

    // 霞时刻降水 = 直接降级：最高小烧
    if (comps.precip[0] === 0) score = Math.min(score, 40);

    // 等级（用未取整分数判定，与 predict.py 一致）
    var grade, gradeEmoji;
    if (score >= 75) { grade = '大烧'; gradeEmoji = '🔥🔥🔥'; }
    else if (score >= 55) { grade = '中烧'; gradeEmoji = '🔥🔥'; }
    else if (score >= 35) { grade = '小烧'; gradeEmoji = '🔥'; }
    else { grade = '无烧'; gradeEmoji = '☁️'; }

    // 置信度：离最近等级边界越远越可信
    var dist = Math.min.apply(null, [35, 55, 75].map(function (b) { return Math.abs(score - b); }));
    var conf = dist >= 12 ? '高' : (dist >= 6 ? '中' : '低');
    var anyMissing = WEIGHTS.some(function (w) { return comps[w[0]][0] === null || comps[w[0]][0] === undefined; });
    if (anyMissing && conf === '高') conf = '中';

    // 理由：幕布永远是头条 + 两个最差的其他因素 + 雨后洗净加成
    var others = WEIGHTS
      .filter(function (w) { return w[0] !== 'curtain'; })
      .map(function (w) { return { s: comps[w[0]][0], label: comps[w[0]][1] }; })
      .filter(function (o) { return o.s !== null && o.s !== undefined; })
      .sort(function (a, b) { return a.s - b.s; });
    var reasons = [comps.curtain[1]].concat(others.slice(0, 2).map(function (o) { return o.label; }));
    if (comps.washed[0] === 100) reasons.push(comps.washed[1]);
    if (hazeNote) reasons.push(hazeNote);

    // v2 理由：全部分项换 v2 口径（幕布/缺口/降水/雨洗），v1 的 reasons 保持与 predict.py 一致
    var gapCompName = (FLAGS.gapV3 && comps.gapV3[0] !== null && comps.gapV3[0] !== undefined) ? 'gapV3' : 'gapV2';
    var othersV2 = WEIGHTS
      .filter(function (w) { return w[0] !== 'curtain'; })
      .map(function (w) {
        var name = w[0];
        if (name === 'gap') name = gapCompName;
        else if (name === 'precip') name = 'precipV2';
        var c = comps[name];
        return { s: c[0], label: c[1] };
      })
      .filter(function (o) { return o.s !== null && o.s !== undefined; })
      .sort(function (a, b) { return a.s - b.s; });
    var reasonsV2 = [comps.curtainV2[1]].concat(othersV2.slice(0, 2).map(function (o) { return o.label; }));
    if (comps.washedV2[0] === 100) reasonsV2.push(comps.washedV2[1]);
    if (hazeNote) reasonsV2.push(hazeNote);

    // 剧本类型
    var script;
    if (comps.precip[0] === 0) script = '降水遮挡型';
    else if (comps.cape[0] === 0) script = '对流未消型';
    else if (comps.washed[0] === 100 && score >= 55) script = '雨后型';
    else if ((comps.pm[0] !== null && comps.pm[0] !== undefined && comps.pm[0] < 40) ||
      (comps.vis[0] !== null && comps.vis[0] !== undefined && comps.vis[0] < 40)) script = '霾型';
    else if (comps.curtain[0] >= 70 && (precip || 0) <= 0.2) script = '晴空薄高云型';
    else script = '混合型';

    // v2：条件分只回答「条件好不好」，霞分再回答「会不会烧起来」
    var g = glow(comps);
    var shown = pyRound(g);          // 页面看到的是四舍五入后的分数，等级必须跟它一致
    var lv = levelOf(shown);
    var cl = clarityOf(aod, vis, pm, (temp === null || temp === undefined || dew === null || dew === undefined) ? null : temp - dew);

    return {
      // v2 结果（页面展示用）
      score: shown,
      rawScore: g,
      probability: scoreToProb(g),
      level: lv,
      grade: LEVELS[lv].name,
      conf: levelConf(g, anyMissing),
      clarity: cl,
      // v1 条件分（与 predict.py 一致，parity 测试对照这一组）
      condScore: pyRound(score),
      condRawScore: score,
      condGrade: grade,
      gradeEmoji: gradeEmoji,
      condConf: conf,
      reasons: reasons,
      reasonsV2: reasonsV2,
      script: script,
      comps: comps,
      inputs: {
        mid: mid, high: high, low: low, precip: precip, prob: prob,
        visKm: (vis === null || vis === undefined) ? null : vis / 1000,
        aod: aod, pm: pm,
        dewSpread: (temp === null || temp === undefined || dew === null || dew === undefined) ? null : temp - dew,
        temp: temp, dewPoint: dew,
        windSpeed: ws, windDir: wd, cape: cape,
        upLowAvg: upLowAvg, upTotalAvg: upTotalAvg, upMidAvg: upMidAvg, pre3: pre3, pre3V2: pre3V2
      }
    };
  }

  /* ---------------- v2：霞分、六级、通透度、多模式集合 ----------------
   * 和公众号「super朝霞晚霞预报」2026-10-19 的 493 点榜单交叉对比后发现：
   * v1 的 10 项加权平均里，低云 / 降水 / 风 / CAPE 在晴空时都是满分，
   * 把「没有云」的晴天也抬到 60–70 分（中烧）。火烧云要三件事同时成立：
   * 头顶有中高云可被照亮（幕布）、太阳方向光路通（缺口）、低云不挡（低云），
   * 缺一样就烧不起来，所以这三项改成几何加权（任何一项接近 0 都会把霞分拉到 0），
   * 其余空气因素只做 ±15% 的调制。 */

  var LEVELS = [
    { name: '无烧', min: 0, tip: '云况不足，基本看不到' },
    { name: '微烧', min: 20, tip: '云边可能泛一点淡色' },
    { name: '小烧', min: 35, tip: '有机会出现小片霞色' },
    { name: '小到中烧', min: 50, tip: '出现火烧云的机会较大' },
    { name: '中到大烧', min: 65, tip: '大概率烧起来，值得去看' },
    { name: '大烧', min: 80, tip: '条件极好，可能非常壮观' }
  ];
  var LEVEL_BOUNDS = [20, 35, 50, 65, 80];

  function levelOf(score) {
    for (var k = LEVELS.length - 1; k > 0; k--) if (score >= LEVELS[k].min) return k;
    return 0;
  }

  function levelConf(score, anyMissing) {
    var dist = Math.min.apply(null, LEVEL_BOUNDS.map(function (b) { return Math.abs(score - b); }));
    var c = dist >= 6 ? '高' : (dist >= 3 ? '中' : '低');
    if (anyMissing && c === '高') c = '中';
    return c;
  }

  var KEY_W = [['curtainV2', 0.5], ['gapV2', 0.3], ['low', 0.2]];
  var AIR_W = [['precipV2', 10], ['aod', 5], ['vis', 3], ['pm', 3], ['dew', 2], ['wind', 2], ['cape', 2]];

  function glow(comps) {
    // 空气项和封顶一律用 precipV2（覆盖事件那一小时的降水，Open-Meteo 是前一小时口径）；
    // 外部手工构造的 comps 可能没有 precipV2，两处都留了回退
    var gapCompName = (FLAGS.gapV3 && comps.gapV3 && comps.gapV3[0] !== null && comps.gapV3[0] !== undefined)
      ? 'gapV3' : 'gapV2';
    var lw = 0, ls = 0, keyMissing = false, minKey = 100;
    KEY_W.forEach(function (w) {
      var name = (w[0] === 'gapV2') ? gapCompName : w[0];
      var s = comps[name][0];
      if (s === null || s === undefined) { keyMissing = true; return; }   // 缺数据：不假装它通过
      if (s < minKey) minKey = s;
      lw += w[1];
      ls += w[1] * Math.log(Math.max(s, 1) / 100);
    });
    var key = lw ? 100 * Math.exp(ls / lw) : 0;
    // 几何平均对单个 0 很宽容（低云 99% 还能给 37 分），但 0 和 99% 之间不该有断崖。
    // 这里用线性斜坡把「几乎不可能」压下去：s→0 时乘数→0，且处处连续单调。
    if (minKey < 10) key *= minKey / 10;
    var aw = 0, as = 0;
    AIR_W.forEach(function (w) {
      var c = comps[w[0]] || (w[0] === 'precipV2' ? comps.precip : null);   // 防御：外部手工构造的 comps 可能没有 precipV2
      if (!c) return;
      var s = c[0];
      if (s === null || s === undefined) return;
      aw += w[1]; as += w[1] * s;
    });
    var air = aw ? as / aw : 70;
    var g = key * (0.7 + 0.3 * air / 100);
    // 雨后洗净：最多 +5，用 v2 窗口。注意 washedV2[0]===0 是「判定没洗」，不是缺数据，
    // 不能因 0 是假值就回退 v1 加成（否则 v2 的窗口修正等于没生效）
    var washedComp = comps.washedV2 || comps.washed;
    if (washedComp[0]) g += washedComp[0] * 0.05;
    var precipCap = comps.precipV2 || comps.precip;
    if (precipCap[0] === 0) g = Math.min(g, 34); // 霞时刻降水：最高微烧
    // 幕布/缺口/低云任一项缺数据：最多给到「微烧」，不拿未知当利好
    if (keyMissing) g = Math.min(g, 34);
    comps.__incomplete = keyMissing;
    return clamp(g, 0, 100);
  }

  // 通透度（1–7）：大气干不干净、远处看得清不清，决定霞色鲜艳度；和云况分开评
  var CLARITY = ['', '浑浊', '灰蒙', '微霾', '一般', '较通透', '通透', '极通透'];
  function clarityOf(aod, visM, pm, dewSpread) {
    var parts = [];
    if (aod !== null && aod !== undefined) parts.push([35, aod <= 0.1 ? 100 : lerp(aod, 0.1, 0.8, 100, 0)]);
    if (visM !== null && visM !== undefined) parts.push([30, lerp(visM / 1000, 5, 30, 0, 100)]);
    if (pm !== null && pm !== undefined) parts.push([25, pm <= 10 ? 100 : lerp(pm, 10, 75, 100, 0)]);
    if (dewSpread !== null && dewSpread !== undefined) parts.push([10, lerp(dewSpread, 1, 8, 0, 100)]);
    if (!parts.length) return null;
    var w = 0, s = 0;
    parts.forEach(function (p) { w += p[0]; s += p[0] * p[1]; });
    s = s / w;
    var lv = s >= 88 ? 7 : s >= 75 ? 6 : s >= 62 ? 5 : s >= 48 ? 4 : s >= 35 ? 3 : s >= 22 ? 2 : 1;
    return { level: lv, name: CLARITY[lv], score: pyRound(s) };
  }

  /**
   * 多模式集合：members = [{ model, label, weight, res }]（res 为 evaluate 结果，weight 缺省 1）。
   * 霞分取加权平均（综合模式在有区域高分辨率模式的地方会优先用它们，权重 3，见 api.js MODEL_WEIGHT）；
   * 和公众号 10-19 榜单对照，加权平均的排序吻合度高于中位数和任一单一模式。
   * 说明（理由、分项）沿用最接近霞分的那个模式，保证解释和分数一致；
   * 置信度看各模式是否落在同一档附近，而不是只看离边界多远。
   */
  function combine(members) {
    var ok = members.filter(function (m) { return m && m.res; });
    if (!ok.length) return null;
    var scores = ok.map(function (m) { return m.res.rawScore; }).sort(function (a, b) { return a - b; });
    var n = scores.length;
    var tw = 0, ts = 0;
    ok.forEach(function (m) { var w = m.weight || 1; tw += w; ts += w * m.res.rawScore; });
    var mean = ts / tw;
    var rep = ok.slice().sort(function (a, b) { return Math.abs(a.res.rawScore - mean) - Math.abs(b.res.rawScore - mean); })[0];
    var shownMean = pyRound(mean);   // 同理：等级按展示分数算
    var lv = levelOf(shownMean);
    var near = ok.filter(function (m) { return Math.abs(levelOf(m.res.rawScore) - lv) <= 1; }).length;
    var good = ok.filter(function (m) { return m.res.rawScore >= 50; }).length;
    var spread = scores[n - 1] - scores[0];
    // 一致度要和分数用同一套权重：分数是按权重加权平均，一致度若按成员个数算，
    // 一个高权重模式跑偏时会出现「分数被它拉走、把握却显示高」的矛盾。
    var nearW = 0;
    ok.forEach(function (m) {
      if (Math.abs(levelOf(m.res.rawScore) - lv) <= 1) nearW += (m.weight || 1);
    });
    var agreeW = tw ? nearW / tw : 0;          // 加权一致度 0–1
    var agreePct = Math.round(agreeW * 100);
    var conf;
    if (n < 3) conf = rep.res.conf;
    else if (agreeW >= 0.8 && spread <= 30) conf = '高';
    else if (agreeW >= 0.6) conf = '中';
    else conf = '低';
    var out = {};
    for (var k in rep.res) if (Object.prototype.hasOwnProperty.call(rep.res, k)) out[k] = rep.res[k];
    out.score = shownMean;
    out.rawScore = mean;
    out.probability = scoreToProb(mean);
    out.level = lv;
    out.grade = LEVELS[lv].name;
    out.conf = conf;
    out.repModel = rep.label;
    out.ensemble = {
      n: n, good: good, near: near, spread: pyRound(spread),
      // 两个口径分开给：agreePct 是「按权重算的一致度」，nearPct 是「按成员个数算的一致度」
      agreePct: agreePct,
      nearPct: Math.round(100 * near / n),
      weightSum: pyRound(tw),
      agreeBasis: 'weighted',
      members: ok.map(function (m) { return { model: m.model, label: m.label, score: m.res.score, grade: m.res.grade }; })
    };
    return out;
  }

  var api = {
    clamp: clamp, lerp: lerp, pyRound: pyRound, fmt0: fmt0, fmtFixed: fmtFixed,
    destination: destination, solarDeclination: solarDeclination,
    sunsetBearing: sunsetBearing, sunriseBearing: sunriseBearing,
    toEpoch: toEpoch, idxFloor: idxFloor, idxNearest: idxNearest, hv: hv,
    cCurtain: cCurtain, cCurtainV2: cCurtainV2, cLow: cLow, cGap: cGap, cPrecip: cPrecip,
    cWashed: cWashed, cGap2: cGap2, cGap3: cGap3, GAP3: GAP3, cAod: cAod, cVis: cVis, cPm: cPm, cDew: cDew,
    cWind: cWind, cCape: cCape, WEIGHTS: WEIGHTS, evaluate: evaluate,
    FLAGS: FLAGS, blendCloudAt: blendCloudAt,
    LEVELS: LEVELS, LEVEL_BOUNDS: LEVEL_BOUNDS, levelOf: levelOf, levelConf: levelConf,
    glow: glow, clarityOf: clarityOf, CLARITY: CLARITY, combine: combine,
    deckLum: deckLum, illuminationLimit: illuminationLimit, curtainLight: curtainLight,
    scoreToProb: scoreToProb, DECK_BASE: DECK_BASE, GLOW_ELEV: GLOW_ELEV
  };
  global.SunsetAlgo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
