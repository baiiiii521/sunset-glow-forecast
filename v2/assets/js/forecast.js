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
          if (ssEpoch != null) { try { ss = API.scoreEvent(fc, aq, ssEpoch, bearings[i].ss, offset, ens, ep.upIdx[1], ep.dist); } catch (e) {} }
          if (srEpoch != null) { try { sr = API.scoreEvent(fc, aq, srEpoch, bearings[i].sr, offset, ens, ep.upIdx[0], ep.dist); } catch (e) {} }
          if (ss) { ss.epoch = ssEpoch; ss.bearing = bearings[i].ss; ss.type = 'sunset'; }
          if (sr) { sr.epoch = srEpoch; sr.bearing = bearings[i].sr; sr.type = 'sunrise'; }
          return { date: d, sunset: ss, sunrise: sr };
        });
        return { offsetSec: offset, tzName: tz, fetchedAt: Date.now(), days: days, fc: fc, aq: aq };
      });
    });
  }

  return { weekly: weekly };
})();
