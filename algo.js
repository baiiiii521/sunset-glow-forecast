/* ============================================================
 * 全球朝霞晚霞预测 · 核心算法（SunsetAlgo）
 * 与 ~/workspace/sunset-forecast/predict.py 保持一致的移植。
 * 唯一依据：predict.py（11 项加权评分）+ 文献报告。
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

  /* ---------------- 各分项评分：返回 [分数(0-100 或 null), 说明] ---------------- */

  function cCurtain(mid, high) {
    var c = clamp((mid || 0) + (high || 0), 0, 100);
    if (c <= 0) return [0, '无中高云幕布'];
    if (c <= 30) return [70 * c / 30, '中高云偏薄（' + fmt0(c) + '%）'];
    if (c <= 70) return [70 + 30 * (c - 30) / 40, '中高云幕布充足（' + fmt0(c) + '%）'];
    if (c <= 90) return [100 - 30 * (c - 70) / 20, '中高云较厚（' + fmt0(c) + '%）'];
    return [70 - 40 * (c - 90) / 10, '中高云近全覆盖（' + fmt0(c) + '%）'];
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
  function evaluate(fcLocal, aqLocal, upstreamFcs, eventEpoch, bearing, offsetSec) {
    var h = fcLocal.hourly || {};
    var times = (h.time || []).map(function (t) { return toEpoch(t, offsetSec); });
    var i = idxFloor(times, eventEpoch);

    var mid = hv(h, 'cloud_cover_mid', i, 0);
    var high = hv(h, 'cloud_cover_high', i, 0);
    var low = hv(h, 'cloud_cover_low', i, 0);
    var precip = hv(h, 'precipitation', i, 0);
    var prob = hv(h, 'precipitation_probability', i, 0);
    var vis = hv(h, 'visibility', i, null);
    var temp = hv(h, 'temperature_2m', i, null);
    var dew = hv(h, 'dew_point_2m', i, null);
    var ws = hv(h, 'wind_speed_10m', i, null);
    var wd = hv(h, 'wind_direction_10m', i, null);
    var cape = hv(h, 'cape', i, null);

    var pre3 = 0;
    for (var k = 1; k <= 3; k++) pre3 += hv(h, 'precipitation', i - k, 0) || 0;

    // 上游晴空缺口：upstreamFcs 按 50/150/300km 顺序
    var upLow = [], upTotal = [];
    (upstreamFcs || []).forEach(function (fcUp) {
      if (!fcUp || !fcUp.hourly) return;
      var upOffset = (fcUp.utc_offset_seconds !== undefined && fcUp.utc_offset_seconds !== null)
        ? fcUp.utc_offset_seconds : offsetSec;
      var utimes = (fcUp.hourly.time || []).map(function (t) { return toEpoch(t, upOffset); });
      var j = idxFloor(utimes, eventEpoch);
      var l = hv(fcUp.hourly, 'cloud_cover_low', j, null);
      var t = hv(fcUp.hourly, 'cloud_cover', j, null);
      if (l !== null && l !== undefined) upLow.push(l);
      if (t !== null && t !== undefined) upTotal.push(t);
    });
    var upLowAvg = upLow.length ? upLow.reduce(function (a, b) { return a + b; }, 0) / upLow.length : null;
    var upTotalAvg = upTotal.length ? upTotal.reduce(function (a, b) { return a + b; }, 0) / upTotal.length : null;

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
      curtain: cCurtain(mid, high),
      low: cLow(low),
      gap: cGap(upLowAvg, upTotalAvg),
      precip: cPrecip(precip, prob),
      washed: cWashed(pre3, precip, prob),
      aod: cAod(aod),
      vis: cVis(vis),
      pm: cPm(pm),
      dew: cDew(temp, dew),
      wind: cWind(ws),
      cape: cCape(cape, low, prob)
    };

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

    // 剧本类型
    var script;
    if (comps.precip[0] === 0) script = '降水遮挡型';
    else if (comps.cape[0] === 0) script = '对流未消型';
    else if (comps.washed[0] === 100 && score >= 55) script = '雨后型';
    else if ((comps.pm[0] !== null && comps.pm[0] !== undefined && comps.pm[0] < 40) ||
      (comps.vis[0] !== null && comps.vis[0] !== undefined && comps.vis[0] < 40)) script = '霾型';
    else if (comps.curtain[0] >= 70 && (precip || 0) <= 0.2) script = '晴空薄高云型';
    else script = '混合型';

    return {
      score: pyRound(score),
      rawScore: score,
      grade: grade,
      gradeEmoji: gradeEmoji,
      conf: conf,
      reasons: reasons,
      script: script,
      comps: comps,
      inputs: {
        mid: mid, high: high, low: low, precip: precip, prob: prob,
        visKm: (vis === null || vis === undefined) ? null : vis / 1000,
        aod: aod, pm: pm,
        dewSpread: (temp === null || temp === undefined || dew === null || dew === undefined) ? null : temp - dew,
        temp: temp, dewPoint: dew,
        windSpeed: ws, windDir: wd, cape: cape,
        upLowAvg: upLowAvg, upTotalAvg: upTotalAvg, pre3: pre3
      }
    };
  }

  var api = {
    clamp: clamp, lerp: lerp, pyRound: pyRound, fmt0: fmt0, fmtFixed: fmtFixed,
    destination: destination, solarDeclination: solarDeclination,
    sunsetBearing: sunsetBearing, sunriseBearing: sunriseBearing,
    toEpoch: toEpoch, idxFloor: idxFloor, idxNearest: idxNearest, hv: hv,
    cCurtain: cCurtain, cLow: cLow, cGap: cGap, cPrecip: cPrecip,
    cWashed: cWashed, cAod: cAod, cVis: cVis, cPm: cPm, cDew: cDew,
    cWind: cWind, cCape: cCape, WEIGHTS: WEIGHTS, evaluate: evaluate
  };
  global.SunsetAlgo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
