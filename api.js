/* ============================================================
 * 全球朝霞晚霞预测 · 数据层（SunsetAPI）
 * 全部走浏览器端 fetch，直调 Open-Meteo 免费 API（支持 CORS，无需 key）。
 * 一次全新地点查询 = 1 本地预报 + 12 上游预报（4 场 × 3 点）+ 1 空气质量 = 14 次调用。
 * 榜单每城 = 1 本地预报 + 3 上游 + 1 空气质量 = 5 次调用。
 * ============================================================ */
(function (global) {
  'use strict';
  var A = global.SunsetAlgo;

  var GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var FC_URL = 'https://api.open-meteo.com/v1/forecast';
  var AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

  var HOURLY_VARS = [
    'temperature_2m', 'relative_humidity_2m', 'dew_point_2m', 'precipitation',
    'precipitation_probability', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid',
    'cloud_cover_high', 'visibility', 'pressure_msl', 'wind_speed_10m',
    'wind_direction_10m', 'cape'
  ].join(',');

  function fetchJSON(url, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000);
    return fetch(url, { signal: ctrl.signal }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status + '（' + url.split('?')[0] + '）');
      return r.json();
    }).catch(function (e) {
      clearTimeout(timer);
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

  function forecastURL(lat, lon, tz) {
    return FC_URL + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&hourly=' + HOURLY_VARS + '&daily=sunrise,sunset&timezone=' +
      encodeURIComponent(tz) + '&forecast_days=3';
  }

  function aqURL(lat, lon, tz) {
    return AQ_URL + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&hourly=aerosol_optical_depth,pm2_5,pm10,dust&timezone=' +
      encodeURIComponent(tz) + '&forecast_days=3';
  }

  // 抓上游三点预报（50/150/300km），单个失败不阻塞整体
  function fetchUpstream(lat, lon, bearing, tz) {
    var jobs = [50, 150, 300].map(function (dist) {
      var dest = A.destination(lat, lon, bearing, dist);
      return fetchJSON(forecastURL(dest.lat, dest.lon, tz)).catch(function () { return null; });
    });
    return Promise.all(jobs).then(function (arr) { return arr.filter(function (x) { return !!x; }); });
  }

  // 对一次事件评分（本地预报 + 空气质量已抓好）
  function scoreEvent(fc, aq, eventEpoch, bearing, offsetSec, lat, lon, tz) {
    return fetchUpstream(lat, lon, bearing, tz).then(function (ups) {
      var res = A.evaluate(fc, aq, ups, eventEpoch, bearing, offsetSec);
      res.bearing = bearing;
      res.epoch = eventEpoch;
      return res;
    });
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
      return fetchJSON(aqURL(lat, lon, tzName)).catch(function () { return null; }).then(function (aq) {
        var jobs = specs.map(function (sp) {
          var epoch = A.toEpoch(sp.timeStr, offsetSec);
          var parts = zonedParts(epoch, offsetSec);
          var doy = dayOfYear(parts.y, parts.m, parts.day);
          var bearing = sp.type === 'sunset'
            ? A.sunsetBearing(lat, doy)
            : A.sunriseBearing(lat, doy);
          return scoreEvent(fc, aq, epoch, bearing, offsetSec, lat, lon, tzName).then(function (res) {
            res.day = sp.day;
            res.type = sp.type;
            return res;
          });
        });
        return Promise.all(jobs).then(function (events) {
          return { tzName: tzName, offsetSec: offsetSec, fetchedAt: Date.now(), events: events };
        });
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
      return fetchJSON(aqURL(city.lat, city.lon, tzName)).catch(function () { return null; }).then(function (aq) {
        return scoreEvent(fc, aq, epoch, bearing, offsetSec, city.lat, city.lon, tzName).then(function (res) {
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
  function loadRankings(onProgress) {
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
    return Promise.all([
      runBatch(GLOBAL_CITIES, 6),
      runBatch(CHINA_CITIES, 6)
    ]).then(function (pair) {
      var g = sortBoard(pair[0].filter(function (r) { return !r.failed; })).slice(0, 10);
      var c = sortBoard(pair[1].filter(function (r) { return !r.failed; })).slice(0, 10);
      return { global: g, china: c, computedAt: Date.now() };
    });
  }

  var api = {
    fetchJSON: fetchJSON,
    zonedParts: zonedParts, dayOfYear: dayOfYear,
    fmtTime: fmtTime, fmtDate: fmtDate, viewingWindow: viewingWindow,
    searchPlaces: searchPlaces, rankScore: rankScore, normalizePlace: normalizePlace,
    evaluatePlace: evaluatePlace, evaluateNextSunset: evaluateNextSunset,
    loadRankings: loadRankings, sortBoard: sortBoard,
    GLOBAL_CITIES: GLOBAL_CITIES, CHINA_CITIES: CHINA_CITIES,
    forecastURL: forecastURL, aqURL: aqURL
  };
  global.SunsetAPI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
