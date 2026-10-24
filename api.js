/* ============================================================
 * 全球朝霞晚霞预测 · 数据层（SunsetAPI）
 * 全部走浏览器端 fetch，直调 Open-Meteo 免费 API（支持 CORS，无需 key）。
 * 一次全新地点查询 = 1 本地预报 + 1 空气质量 + 1 多模式云量（本地 + 朝/晚霞各 5 个上游点）= 3 个请求，
 * 按 Open-Meteo 计费口径（多点、超 10 个变量会折算成多次）按需分批调用。
 * 榜单每城 = 1 本地预报 + 1 空气质量 + 1 多模式云量（本地 + 5 个上游点）= 3 个请求，约 10 次调用。
 * ============================================================ */
(function (global) {
  'use strict';
  var A = global.SunsetAlgo;

  var GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  // 可选：走自有缓存代理（nginx / node）。设置 window.GLOW_OM_BASE='/om' 即启用。
  var OM = (typeof globalThis !== 'undefined' && globalThis.GLOW_OM_BASE) || '';
  var FC_URL = OM ? OM + '/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
  var AQ_URL = OM ? OM + '/air-quality/v1/air-quality' : 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var FC_DIRECT = 'https://api.open-meteo.com/v1/forecast';
  var AQ_DIRECT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  // 启用代理时把坐标取整到 0.05°（约 5km）：定位用户的缓存命中率从≈0 提到可用
  function q(v) { return OM ? (Math.round(v * 20) / 20).toFixed(3) : v.toFixed(4); }
  // 代理挂掉时回落到直连，避免 /om 成为全站单点
  function directOf(url) {
    if (!OM) return null;
    if (url.indexOf(FC_URL) === 0) return url.replace(FC_URL, FC_DIRECT);
    if (url.indexOf(AQ_URL) === 0) return url.replace(AQ_URL, AQ_DIRECT);
    return null;
  }

  var HOURLY_VARS = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
    'precipitation_probability', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid',
    'cloud_cover_high', 'visibility', 'pressure_msl', 'wind_speed_10m',
    'wind_direction_10m', 'cape'
  ].join(',');

  // Open-Meteo 免费层按分钟限流（429）：退避后重试，最多再试 2 次（等 4s、12s）
  var RETRY_429 = [4000, 12000];

  function fetchJSON(url, timeoutMs, attempt) {
    var direct = (!attempt && directOf(url)) || null;
    attempt = attempt || 0;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      clearTimeout(timer);
      if (r.status === 429 && attempt < RETRY_429.length) {
        return new Promise(function (res) { setTimeout(res, RETRY_429[attempt]); })
          .then(function () { return fetchJSON(url, timeoutMs, attempt + 1); });
      }
      if (!r.ok) throw new Error('HTTP ' + r.status + '（' + url.split('?')[0] + '）');
      return r.json();
    }).catch(function (e) {
      clearTimeout(timer);
      // 代理（/om）失败：回落直连再试一次，避免 /om 成为单点
      if (direct) return fetchJSON(direct, timeoutMs, attempt);
      if (e.name === 'AbortError') throw new Error('请求超时');
      throw e;
    });
  }

  /* ---------------- 时间工具（全部用真实 epoch 比较） ---------------- */

  // 某 epoch 在 offsetSec 时区下的墙上时间对象
  function zonedParts(epoch, offsetSec) {
    var d = new Date(epoch + offsetSec * 1000);
    return {
      y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(),
      hh: d.getUTCHours(), mm: d.getUTCMinutes(),
      dateStr: d.toISOString().slice(0, 10),
      timeStr: d.toISOString().slice(11, 16)
    };
  }

  function dayOfYear(y, m, day) {
    return Math.floor((Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 0)) / 86400000);
  }

  function fmtTime(epoch, offsetSec) {
    return zonedParts(epoch, offsetSec).timeStr;
  }

  function fmtDate(epoch, offsetSec) {
    var p = zonedParts(epoch, offsetSec);
    var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(epoch + offsetSec * 1000).getUTCDay()];
    return p.m + '月' + p.day + '日（' + wd + '）';
  }

  // 最佳观测窗：日落 -15~+30 分钟；日出 -30~+15 分钟（经验窗口，仅供参考）
  function viewingWindow(epoch, isSunset, offsetSec) {
    var start = epoch + (isSunset ? -15 : -30) * 60000;
    var end = epoch + (isSunset ? 30 : 15) * 60000;
    return '约 ' + fmtTime(start, offsetSec) + '–' + fmtTime(end, offsetSec);
  }

  /* ---------------- 城市搜索（含南阳 bug 修复） ---------------- */

  // GeoNames feature_code 权重：行政等级越高越靠前
  var FEATURE_WEIGHT = {
    PPLC: 100, PPLA: 90, PPLA2: 85, PPLA3: 70, PPLA4: 50,
    PPL: 30, PPLL: 20, PPLX: 15
  };

  function rankScore(r) {
    var fw = FEATURE_WEIGHT[r.feature_code] || 10;
    var pop = r.population || 0;
    var popBonus = pop > 0 ? Math.min(40, 8 * Math.log10(pop)) : 0;
    return fw + popBonus;
  }

  function normalizePlace(r) {
    return {
      name: r.name,
      admin1: r.admin1 || '',
      admin2: r.admin2 || '',
      country: r.country || '',
      lat: r.latitude,
      lon: r.longitude,
      population: r.population || null,
      feature: r.feature_code || '',
      timezone: r.timezone || ''
    };
  }

  // 搜索地点。关键修复：中文查询除原文外同时补查「市」后缀变体，
  // 并拉取 count=100 后在客户端按行政等级 + 人口重排 —— 因为
  // GeoNames 库里河南南阳市存的是拼音名 "Nanyang"，只用中文名查时
  // 它排在几十个同名小村镇之后，原实现取前 8 条就永远看不到它。
  function searchPlaces(query) {
    var q = (query || '').trim();
    if (!q) return Promise.resolve([]);
    var isCJK = /[\u4e00-\u9fff]/.test(q);
    var queries = [q];
    if (isCJK && !/[市省区县镇乡]$/.test(q)) queries.push(q + '市');
    var lang = isCJK ? 'zh' : 'en';
    var jobs = queries.map(function (qq) {
      var url = GEO_URL + '?name=' + encodeURIComponent(qq) +
        '&count=100&language=' + lang + '&format=json';
      return fetchJSON(url).catch(function () { return { results: [] }; });
    });
    return Promise.all(jobs).then(function (pages) {
      var map = new Map();
      pages.forEach(function (page) {
        (page.results || []).forEach(function (r) {
          var key = r.latitude.toFixed(4) + ',' + r.longitude.toFixed(4);
          var existing = map.get(key);
          if (!existing) { map.set(key, r); return; }
          // 去重时保留更高分者；同分优先中文名（“南阳”与“南阳市”同坐标时显示“南阳市”）
          var newRank = rankScore(r), oldRank = rankScore(existing);
          var newCJK = /[\u4e00-\u9fff]/.test(r.name || '');
          var oldCJK = /[\u4e00-\u9fff]/.test(existing.name || '');
          if (newRank > oldRank || (newRank === oldRank && newCJK && !oldCJK)) map.set(key, r);
        });
      });
      var list = Array.from(map.values()).map(normalizePlace);
      list.forEach(function (p) { p._rank = rankScore(p); });
      list.sort(function (a, b) {
        if (b._rank !== a._rank) return b._rank - a._rank;
        return (b.population || 0) - (a.population || 0);
      });
      return list.slice(0, 8).map(function (p) {
        delete p._rank;
        return p;
      });
    });
  }

  /* ---------------- 预报抓取与评分 ---------------- */

  function forecastURL(lat, lon, tz, days) {
    return FC_URL + '?latitude=' + q(lat) + '&longitude=' + q(lon) +
      '&hourly=' + HOURLY_VARS + '&minutely_15=' + CLOUD_VARS.join(',') + '&daily=sunrise,sunset&timezone=' +
      encodeURIComponent(tz) + '&forecast_days=' + (days || 3);
  }

  function aqURL(lat, lon, tz, days) {
    return AQ_URL + '?latitude=' + q(lat) + '&longitude=' + q(lon) +
      '&hourly=aerosol_optical_depth,pm2_5,pm10,dust&timezone=' +
      encodeURIComponent(tz) + '&forecast_days=' + (days || 3);
  }

  /* ---------------- 多模式集合 ----------------
   * 同一时刻各家数值模式的云量常常差很多（2026-10-19 西安日落：ECMWF 中云 54%、
   * GFS 低云 47%、CMA 几乎全晴）。只用一个模式会把这种不确定性藏起来，
   * 所以云量（本地 + 上游各点）一次请求取 4 个模式，每个模式各算一遍霞分再加权平均（综合模式权重 3）。
   * CMA GRAPES 于 2026-10-21 移出：三天交叉对比中它与对方预报 / 回顾的吻合度最差且最不稳定
   * （9 段里 5 段 <0.6，最低 0.14），去掉后回顾与预报的吻合度都提高（docs/compare-2026-10-21.md）。
   * 降水、能见度、露点、风、CAPE 仍用综合模式（best_match），空气质量用 CAMS。 */
  var MODELS = [
    ['best_match', '综合'], ['ecmwf_ifs025', 'ECMWF'], ['gfs_seamless', 'GFS'],
    ['icon_seamless', 'ICON']
  ];
  var MODEL_WEIGHT = { best_match: 3 };
  var CLOUD_VARS = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];

  // points: [{lat, lon}]，一次请求返回所有点 × 所有模式
  function ensembleURL(points, tz, days) {
    return FC_URL + '?latitude=' + points.map(function (p) { return q(p.lat); }).join(',') +
      '&longitude=' + points.map(function (p) { return q(p.lon); }).join(',') +
      '&hourly=' + CLOUD_VARS.join(',') + '&models=' + MODELS.map(function (m) { return m[0]; }).join(',') +
      '&timezone=' + encodeURIComponent(tz) + '&forecast_days=' + (days || 3);
  }

  function fetchEnsemble(points, tz, days) {
    var url = ensembleURL(points, tz, days);
    return fetchJSON(url).catch(function () {
      return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return fetchJSON(url); });
    }).then(function (j) { return Array.isArray(j) ? j : [j]; }).catch(function () { return null; });
  }

  // 从多模式返回里取出某个模式、某个点的云量，按 baseTimes（主预报的时间轴）对齐
  function memberHourly(loc, model, baseTimes) {
    if (!loc || !loc.hourly) return null;
    var h = loc.hourly, pos = {};
    (h.time || []).forEach(function (t, k) { pos[t] = k; });
    var out = { time: baseTimes };
    var any = false;
    CLOUD_VARS.forEach(function (v) {
      var arr = h[v + '_' + model];
      out[v] = baseTimes.map(function (t) {
        var k = pos[t];
        var x = (k === undefined || !arr) ? null : arr[k];
        if (x !== null && x !== undefined) any = true;
        return x === undefined ? null : x;
      });
    });
    return any ? out : null;
  }

  // 本地事件时刻云量是否齐全（某些模式在部分地区 / 时效没有数据）
  function hasCloudAt(h, i) {
    return ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'].every(function (v) {
      return h[v] && h[v][i] !== null && h[v][i] !== undefined;
    });
  }

  function shallowCopy(o) { var r = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }

  /**
   * 对一次事件做集合评分。
   * ens: fetchEnsemble 的结果（0 号是本地点，upIdx 指向这次事件的三个上游点），为 null 时退回单模式、无上游。
   */
  // 15 分钟分辨率云量（只有综合模式有）：取离目标时刻最近的 15 分钟格点
  function minutelyCloud(fc, offsetSec, epoch) {
    var m = fc && fc.minutely_15;
    if (!m || !m.time || !m.time.length) return null;
    var mt = m.time.map(function (t) { return A.toEpoch(t, offsetSec); });
    var k = A.idxNearest(mt, epoch);
    var out = {
      mid: A.hv(m, 'cloud_cover_mid', k, null),
      high: A.hv(m, 'cloud_cover_high', k, null),
      low: A.hv(m, 'cloud_cover_low', k, null)
    };
    return (out.mid === null && out.high === null && out.low === null) ? null : out;
  }

  function scoreEvent(fc, aq, eventEpoch, bearing, offsetSec, ens, upIdx, upDist) {
    var res;
    if (ens && ens[0]) {
      var baseTimes = fc.hourly.time || [];
      var times = baseTimes.map(function (t) { return A.toEpoch(t, offsetSec); });
      var i = A.idxFloor(times, eventEpoch);
      var members = MODELS.map(function (m) {
        var lh = memberHourly(ens[0], m[0], baseTimes);
        if (!lh || !hasCloudAt(lh, i)) return null;
        var hourly = shallowCopy(fc.hourly);
        CLOUD_VARS.forEach(function (v) { hourly[v] = lh[v]; });
        var fcM = { hourly: hourly, utc_offset_seconds: offsetSec };
        var ups = upIdx.map(function (k) {
          var uh = memberHourly(ens[k], m[0], baseTimes);
          return uh ? { hourly: uh, utc_offset_seconds: offsetSec } : null;
        }).filter(function (x) { return !!x; });
        var memberRes;
        if (m[0] === 'best_match' && fc.minutely_15) {
          // 综合模式用 15 分钟云量，在日落前后 30 分钟窗口里取霞分最高的那一刻
          var best = null;
          [-30, -15, 0, 15].forEach(function (dt) {
            var e = eventEpoch + dt * 60000;
            var ov = minutelyCloud(fc, offsetSec, e);
            var r = A.evaluate(fcM, aq, ups, e, bearing, offsetSec, ov, upDist);
            if (!best || r.rawScore > best.r.rawScore) best = { r: r, dt: dt };
          });
          memberRes = best.r;
          memberRes.peakOffsetMin = best.dt;
        } else {
          memberRes = A.evaluate(fcM, aq, ups, eventEpoch, bearing, offsetSec, null, upDist);
        }
        return { model: m[0], label: m[1], weight: MODEL_WEIGHT[m[0]] || 1, res: memberRes };
      });
      res = A.combine(members);
    }
    if (!res) {
      var ov0 = fc.minutely_15 ? minutelyCloud(fc, offsetSec, eventEpoch) : null;
      res = A.evaluate(fc, aq, [], eventEpoch, bearing, offsetSec, ov0, upDist);
      res.ensemble = null;
      if (res.conf === '高') res.conf = '中';
    }
    res.bearing = bearing;
    res.epoch = eventEpoch;
    return res;
  }

  // 一个点 + 若干方位上游点（50/100/200/300/400km），返回 [点列表, 每个方位对应的上游下标]
  var UP_DIST_KM = [50, 100, 200, 300, 400];
  function ensemblePoints(lat, lon, bearings) {
    var pts = [{ lat: lat, lon: lon }];
    var idx = bearings.map(function (b) {
      return UP_DIST_KM.map(function (dist) {
        pts.push(A.destination(lat, lon, b, dist));
        return pts.length - 1;
      });
    });
    return { points: pts, upIdx: idx, dist: UP_DIST_KM };
  }

  // 计算一个地点的今明两日四场预报
  function evaluatePlace(lat, lon) {
    return fetchJSON(forecastURL(lat, lon, 'auto')).then(function (fc) {
      var offsetSec = fc.utc_offset_seconds || 0;
      var tzName = fc.timezone || 'UTC';
      var daily = fc.daily || {};
      var dayIdx = {};
      (daily.time || []).forEach(function (d, k) { dayIdx[d] = k; });
      var todayStr = zonedParts(Date.now(), offsetSec).dateStr;
      var tomorrowStr = zonedParts(Date.now() + 86400000, offsetSec).dateStr;
      if (dayIdx[todayStr] === undefined || dayIdx[tomorrowStr] === undefined) {
        throw new Error('预报数据不含今天/明天');
      }
      var specs = [
        { day: 'today', type: 'sunrise', timeStr: daily.sunrise[dayIdx[todayStr]], dateStr: todayStr },
        { day: 'today', type: 'sunset', timeStr: daily.sunset[dayIdx[todayStr]], dateStr: todayStr },
        { day: 'tomorrow', type: 'sunrise', timeStr: daily.sunrise[dayIdx[tomorrowStr]], dateStr: tomorrowStr },
        { day: 'tomorrow', type: 'sunset', timeStr: daily.sunset[dayIdx[tomorrowStr]], dateStr: tomorrowStr }
      ];
      specs.forEach(function (sp) {
        sp.epoch = A.toEpoch(sp.timeStr, offsetSec);
        var parts = zonedParts(sp.epoch, offsetSec);
        var doy = dayOfYear(parts.y, parts.m, parts.day);
        sp.bearing = sp.type === 'sunset' ? A.sunsetBearing(lat, doy) : A.sunriseBearing(lat, doy);
      });
      // 今明两天同类事件方位角只差 <0.5°，上游点共用（朝霞一组、晚霞一组），整地点 1 次请求
      var ep = ensemblePoints(lat, lon, [specs[0].bearing, specs[1].bearing]);
      return Promise.all([
        fetchJSON(aqURL(lat, lon, tzName)).catch(function () { return null; }),
        fetchEnsemble(ep.points, tzName)
      ]).then(function (pair) {
        var aq = pair[0], ens = pair[1];
        var events = specs.map(function (sp) {
          var res = scoreEvent(fc, aq, sp.epoch, sp.bearing, offsetSec, ens, ep.upIdx[sp.type === 'sunrise' ? 0 : 1], ep.dist);
          res.day = sp.day;
          res.type = sp.type;
          return res;
        });
        return { tzName: tzName, offsetSec: offsetSec, fetchedAt: Date.now(), events: events };
      });
    });
  }

  // 计算一个城市的下一场晚霞（用于榜单）
  function evaluateNextSunset(city) {
    return fetchJSON(forecastURL(city.lat, city.lon, 'auto')).then(function (fc) {
      var offsetSec = fc.utc_offset_seconds || 0;
      var tzName = fc.timezone || 'UTC';
      var daily = fc.daily || {};
      var dayIdx = {};
      (daily.time || []).forEach(function (d, k) { dayIdx[d] = k; });
      var todayStr = zonedParts(Date.now(), offsetSec).dateStr;
      var tomorrowStr = zonedParts(Date.now() + 86400000, offsetSec).dateStr;
      var todaySunset = (daily.sunset && dayIdx[todayStr] !== undefined)
        ? A.toEpoch(daily.sunset[dayIdx[todayStr]], offsetSec) : null;
      var useToday = todaySunset !== null && todaySunset > Date.now();
      var dateStr = useToday ? todayStr : tomorrowStr;
      var sunsetStr = useToday ? daily.sunset[dayIdx[todayStr]] : daily.sunset[dayIdx[tomorrowStr]];
      if (!sunsetStr) throw new Error('无日落时间');
      var epoch = A.toEpoch(sunsetStr, offsetSec);
      var parts = zonedParts(epoch, offsetSec);
      var bearing = A.sunsetBearing(city.lat, dayOfYear(parts.y, parts.m, parts.day));
      var ep = ensemblePoints(city.lat, city.lon, [bearing]);
      return Promise.all([
        fetchJSON(aqURL(city.lat, city.lon, tzName)).catch(function () { return null; }),
        fetchEnsemble(ep.points, tzName)
      ]).then(function (pair) {
        return Promise.resolve(scoreEvent(fc, pair[0], epoch, bearing, offsetSec, pair[1], ep.upIdx[0], ep.dist)).then(function (res) {
          res.city = city;
          res.day = useToday ? 'today' : 'tomorrow';
          res.type = 'sunset';
          res.offsetSec = offsetSec;
          res.tzName = tzName;
          return res;
        });
      });
    });
  }

  /* ---------------- 榜单城市清单 ---------------- */

  var GLOBAL_CITIES = [
    { name: '纽约', country: '美国', lat: 40.71, lon: -74.01 },
    { name: '洛杉矶', country: '美国', lat: 34.05, lon: -118.24 },
    { name: '芝加哥', country: '美国', lat: 41.88, lon: -87.63 },
    { name: '温哥华', country: '加拿大', lat: 49.28, lon: -123.12 },
    { name: '多伦多', country: '加拿大', lat: 43.65, lon: -79.38 },
    { name: '墨西哥城', country: '墨西哥', lat: 19.43, lon: -99.13 },
    { name: '圣保罗', country: '巴西', lat: -23.55, lon: -46.63 },
    { name: '布宜诺斯艾利斯', country: '阿根廷', lat: -34.60, lon: -58.38 },
    { name: '利马', country: '秘鲁', lat: -12.05, lon: -77.04 },
    { name: '伦敦', country: '英国', lat: 51.51, lon: -0.13 },
    { name: '巴黎', country: '法国', lat: 48.85, lon: 2.35 },
    { name: '马德里', country: '西班牙', lat: 40.42, lon: -3.70 },
    { name: '柏林', country: '德国', lat: 52.52, lon: 13.40 },
    { name: '罗马', country: '意大利', lat: 41.90, lon: 12.50 },
    { name: '阿姆斯特丹', country: '荷兰', lat: 52.37, lon: 4.90 },
    { name: '斯德哥尔摩', country: '瑞典', lat: 59.33, lon: 18.07 },
    { name: '雅典', country: '希腊', lat: 37.98, lon: 23.73 },
    { name: '雷克雅未克', country: '冰岛', lat: 64.15, lon: -21.90 },
    { name: '莫斯科', country: '俄罗斯', lat: 55.76, lon: 37.62 },
    { name: '伊斯坦布尔', country: '土耳其', lat: 41.01, lon: 28.98 },
    { name: '开罗', country: '埃及', lat: 30.04, lon: 31.24 },
    { name: '拉各斯', country: '尼日利亚', lat: 6.52, lon: 3.37 },
    { name: '内罗毕', country: '肯尼亚', lat: -1.29, lon: 36.82 },
    { name: '约翰内斯堡', country: '南非', lat: -26.20, lon: 28.04 },
    { name: '迪拜', country: '阿联酋', lat: 25.20, lon: 55.27 },
    { name: '孟买', country: '印度', lat: 19.08, lon: 72.88 },
    { name: '曼谷', country: '泰国', lat: 13.76, lon: 100.50 },
    { name: '新加坡', country: '新加坡', lat: 1.35, lon: 103.82 },
    { name: '雅加达', country: '印度尼西亚', lat: -6.21, lon: 106.85 },
    { name: '胡志明市', country: '越南', lat: 10.82, lon: 106.63 },
    { name: '马尼拉', country: '菲律宾', lat: 14.60, lon: 120.98 },
    { name: '首尔', country: '韩国', lat: 37.57, lon: 126.98 },
    { name: '东京', country: '日本', lat: 35.68, lon: 139.69 },
    { name: '悉尼', country: '澳大利亚', lat: -33.87, lon: 151.21 },
    { name: '奥克兰', country: '新西兰', lat: -36.85, lon: 174.76 },
    { name: '檀香山', country: '美国', lat: 21.31, lon: -157.86 }
  ];

  var CHINA_CITIES = [
    { name: '北京', country: '中国', lat: 39.90, lon: 116.40 },
    { name: '上海', country: '中国', lat: 31.23, lon: 121.47 },
    { name: '广州', country: '中国', lat: 23.13, lon: 113.26 },
    { name: '深圳', country: '中国', lat: 22.54, lon: 114.06 },
    { name: '成都', country: '中国', lat: 30.57, lon: 104.07 },
    { name: '重庆', country: '中国', lat: 29.56, lon: 106.55 },
    { name: '杭州', country: '中国', lat: 30.27, lon: 120.15 },
    { name: '南京', country: '中国', lat: 32.06, lon: 118.80 },
    { name: '武汉', country: '中国', lat: 30.59, lon: 114.30 },
    { name: '西安', country: '中国', lat: 34.34, lon: 108.94 },
    { name: '天津', country: '中国', lat: 39.08, lon: 117.20 },
    { name: '苏州', country: '中国', lat: 31.30, lon: 120.62 },
    { name: '长沙', country: '中国', lat: 28.23, lon: 112.94 },
    { name: '郑州', country: '中国', lat: 34.75, lon: 113.63 },
    { name: '青岛', country: '中国', lat: 36.07, lon: 120.38 },
    { name: '大连', country: '中国', lat: 38.91, lon: 121.61 },
    { name: '厦门', country: '中国', lat: 24.48, lon: 118.08 },
    { name: '昆明', country: '中国', lat: 25.04, lon: 102.71 },
    { name: '哈尔滨', country: '中国', lat: 45.75, lon: 126.63 },
    { name: '沈阳', country: '中国', lat: 41.80, lon: 123.43 },
    { name: '长春', country: '中国', lat: 43.88, lon: 125.32 },
    { name: '济南', country: '中国', lat: 36.67, lon: 117.00 },
    { name: '合肥', country: '中国', lat: 31.82, lon: 117.27 },
    { name: '福州', country: '中国', lat: 26.08, lon: 119.30 },
    { name: '南昌', country: '中国', lat: 28.68, lon: 115.89 },
    { name: '贵阳', country: '中国', lat: 26.65, lon: 106.63 },
    { name: '兰州', country: '中国', lat: 36.06, lon: 103.83 },
    { name: '银川', country: '中国', lat: 38.49, lon: 106.21 },
    { name: '西宁', country: '中国', lat: 36.62, lon: 101.78 },
    { name: '乌鲁木齐', country: '中国', lat: 43.82, lon: 87.62 },
    { name: '拉萨', country: '中国', lat: 29.65, lon: 91.13 },
    { name: '海口', country: '中国', lat: 20.04, lon: 110.35 },
    { name: '南宁', country: '中国', lat: 22.82, lon: 108.37 },
    { name: '南阳', country: '中国', lat: 33.01, lon: 112.55 }
  ];

  var CONF_RANK = { '高': 3, '中': 2, '低': 1 };

  function sortBoard(results) {
    return results.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (CONF_RANK[b.conf] || 0) - (CONF_RANK[a.conf] || 0);
    });
  }

  // 批量算榜单（带并发限制 + 进度回调），返回 {global:[10], china:[10], computedAt}
  // opts.concurrency：每组（全球 / 中国）同时算几座城，默认 6（浏览器）；服务器每日任务用 2，避免 429。
  // 第一轮失败的城市会在最后串行重试一次。
  function loadRankings(onProgress, opts) {
    opts = opts || {};
    var conc = opts.concurrency || 6;
    var total = GLOBAL_CITIES.length + CHINA_CITIES.length;
    var done = 0;
    function runOne(city) {
      return evaluateNextSunset(city).catch(function (e) {
        return { city: city, failed: true, error: String(e && e.message || e) };
      }).then(function (r) {
        done += 1;
        if (onProgress) onProgress(done, total);
        return r;
      });
    }
    function runBatch(cities, concurrency) {
      var results = [];
      var idx = 0;
      function worker() {
        if (idx >= cities.length) return Promise.resolve();
        var c = cities[idx++];
        return runOne(c).then(function (r) { results.push(r); }).then(worker);
      }
      var workers = [];
      for (var w = 0; w < concurrency; w++) workers.push(worker());
      return Promise.all(workers).then(function () { return results; });
    }
    function retryFailed(results) {
      var failed = results.filter(function (r) { return r.failed; });
      var ok = results.filter(function (r) { return !r.failed; });
      return failed.reduce(function (p, r) {
        return p.then(function () {
          return new Promise(function (res) { setTimeout(res, 1500); })
            .then(function () { return evaluateNextSunset(r.city); })
            .then(function (x) { ok.push(x); }, function (e) { ok.push({ city: r.city, failed: true, error: String(e && e.message || e) }); });
        });
      }, Promise.resolve()).then(function () { return ok; });
    }
    return Promise.all([
      runBatch(GLOBAL_CITIES, conc),
      runBatch(CHINA_CITIES, conc)
    ]).then(function (pair) {
      return retryFailed(pair[0]).then(function (g) {
        return retryFailed(pair[1]).then(function (c) { return [g, c]; });
      });
    }).then(function (pair) {
      var okG = pair[0].filter(function (r) { return !r.failed; });
      var okC = pair[1].filter(function (r) { return !r.failed; });
      function counts(list) {
        var c = [0, 0, 0, 0, 0, 0];
        list.forEach(function (r) { c[typeof r.level === 'number' ? r.level : A.levelOf(r.score)]++; });
        return { counts: c };
      }
      return {
        global: sortBoard(okG).slice(0, 10),
        china: sortBoard(okC).slice(0, 10),
        stats: { global: counts(okG), china: counts(okC) },
        failed: pair[0].concat(pair[1]).filter(function (r) { return r.failed; }).map(function (r) { return r.city.name + '：' + r.error; }),
        singleModel: okG.concat(okC).filter(function (r) { return !r.ensemble; }).length,
        computedAt: Date.now()
      };
    });
  }

  var api = {
    fetchJSON: fetchJSON,
    zonedParts: zonedParts, dayOfYear: dayOfYear,
    fmtTime: fmtTime, fmtDate: fmtDate, viewingWindow: viewingWindow,
    searchPlaces: searchPlaces, rankScore: rankScore, normalizePlace: normalizePlace,
    evaluatePlace: evaluatePlace, evaluateNextSunset: evaluateNextSunset,
    // 批量打分（霞榜扩容 / 每小时快照）：一次请求多坐标
    CLOUD_VARS: CLOUD_VARS, HOURLY_VARS: HOURLY_VARS, UP_DIST_KM: UP_DIST_KM,
    FC_URL: FC_URL, AQ_URL: AQ_URL,
    loadRankings: loadRankings, sortBoard: sortBoard,
    GLOBAL_CITIES: GLOBAL_CITIES, CHINA_CITIES: CHINA_CITIES,
    forecastURL: forecastURL, aqURL: aqURL, ensembleURL: ensembleURL, MODELS: MODELS,
    // 内部构件（供 CLI / 霞榜复用同口径：多日系列、单场评分）
    scoreEvent: scoreEvent, ensemblePoints: ensemblePoints, fetchEnsemble: fetchEnsemble,
    memberHourly: memberHourly, hasCloudAt: hasCloudAt
  };
  global.SunsetAPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
