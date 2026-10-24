/* ============================================================
   GLOW v2 · forecast.js — 4 场 / 7 天（与推送同口径）
   ============================================================ */
window.FORECAST = (function () {
  'use strict';
  var A = window.SunsetAlgo, API = window.SunsetAPI;

  function dayOfYearFromDateStr(s) {
    var p = s.split('-');
    return Math.floor((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(+p[0], 0, 0)) / 86400000);
  }

  /* 取 N 天（默认 7）朝/晚两场评分。返回 {offsetSec, tzName, days:[{date,sunset,sunrise}]} */
  function weekly(lat, lon, n) {
    n = n || 7;
    return API.fetchJSON(API.forecastURL(lat, lon, 'auto', n)).then(function (fc) {
      var offset = fc.utc_offset_seconds || 0;
      var tz = fc.timezone || 'UTC';
      var daily = fc.daily || {};
      var dates = (daily.time || []).slice(0, n);
      var bearings = dates.map(function (d, i) {
        var doy = dayOfYearFromDateStr(d);
        return { doy: doy, ss: A.sunsetBearing(lat, doy), sr: A.sunriseBearing(lat, doy) };
      });
      var ep = API.ensemblePoints(lat, lon, [bearings[0].sr, bearings[0].ss]);
      return Promise.all([
        API.fetchJSON(API.aqURL(lat, lon, tz, n)).catch(function () { return null; }),
        API.fetchEnsemble(ep.points, tz, n)
      ]).then(function (pair) {
        var aq = pair[0], ens = pair[1];
        var days = dates.map(function (d, i) {
          // 极昼/极夜时 daily.sunset 或 sunrise 会是 null，跳过这一场，别算出 NaN
          var ssEpoch = daily.sunset && daily.sunset[i] ? A.toEpoch(daily.sunset[i], offset) : null;
          var srEpoch = daily.sunrise && daily.sunrise[i] ? A.toEpoch(daily.sunrise[i], offset) : null;
          var ss = null, sr = null;
          if (ssEpoch != null) {
            try { ss = API.scoreEvent(fc, aq, ssEpoch, bearings[i].ss, offset, ens, ep.upIdx[1], ep.dist); }
            catch (e) { console.error('晚霞评分失败', d, e && e.message); }
          }
          if (srEpoch != null) {
            try { sr = API.scoreEvent(fc, aq, srEpoch, bearings[i].sr, offset, ens, ep.upIdx[0], ep.dist); }
            catch (e) { console.error('朝霞评分失败', d, e && e.message); }
          }
          if (ss) { ss.epoch = ssEpoch; ss.bearing = bearings[i].ss; ss.type = 'sunset'; }
          if (sr) { sr.epoch = srEpoch; sr.bearing = bearings[i].sr; sr.type = 'sunrise'; }
          return { date: d, sunset: ss, sunrise: sr };
        });
        return { offsetSec: offset, tzName: tz, fetchedAt: Date.now(), days: days, fc: fc, aq: aq };
      });
    });
  }


  /* ---------------- 一次取数，两个用途 ----------------
   * 四场（今早/今晚/明早/明晚）和七日用的是同一份数据，
   * 合并后每次访问的请求数从 6 个降到 3 个（预报 + 空气质量 + 集合）。
   */
  var _cache = {};
  function weeklyCached(lat, lon, n) {
    var key = lat.toFixed(2) + ',' + lon.toFixed(2) + ',' + (n || 7);
    var hit = _cache[key];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
    var p = weekly(lat, lon, n || 7).catch(function (e) { delete _cache[key]; throw e; });
    _cache[key] = { p: p, at: Date.now() };
    return p;
  }

  // 从七日结果里切出「今早/今晚/明早/明晚」四场，字段与 evaluatePlace 一致
  function fourEvents(lat, lon) {
    return weeklyCached(lat, lon, 7).then(function (w) {
      var d0 = w.days[0] || {}, d1 = w.days[1] || {};
      var raw = [
        { day: 'today', type: 'sunrise', ev: d0.sunrise },
        { day: 'today', type: 'sunset', ev: d0.sunset },
        { day: 'tomorrow', type: 'sunrise', ev: d1.sunrise },
        { day: 'tomorrow', type: 'sunset', ev: d1.sunset }
      ];
      var events = raw.filter(function (x) { return x.ev && x.ev.epoch; }).map(function (x) {
        var e = x.ev;
        e.day = x.day; e.type = x.type;
        e.offsetSec = w.offsetSec; e.tzName = w.tzName;
        return e;
      }).sort(function (a, b) { return a.epoch - b.epoch; });
      return { events: events, offsetSec: w.offsetSec, tzName: w.tzName, fetchedAt: w.fetchedAt, days: w.days };
    });
  }

  return { weekly: weekly, weeklyCached: weeklyCached, fourEvents: fourEvents };
})();
