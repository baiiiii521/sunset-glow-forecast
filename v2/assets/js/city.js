/* ============================================================
   GLOW v2 · city.js — P02 城市页
   ============================================================ */
(function () {
  'use strict';
  var G = window.GLOW, API = G.API;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var q = new URLSearchParams(location.search);
  var place = {
    name: q.get('c') || '胡志明市',
    lat: Number.isFinite(parseFloat(q.get('lat'))) ? parseFloat(q.get('lat')) : 10.79,
    lon: Number.isFinite(parseFloat(q.get('lon'))) ? parseFloat(q.get('lon')) : 106.75
  };
  var _d = parseInt(q.get('d'), 10);
  var state = { week: null, idx: Number.isInteger(_d) && _d >= 0 ? _d : 0, scope: 'all', data: null };
  var gradeColor = function (l) { return 'var(--lv' + l + ')'; };

  /* ---------- 头部 ---------- */
  function renderHead() {
    $('#cityName').textContent = place.name;
    $('#cityMeta').innerHTML = '<span>' + Math.abs(place.lat).toFixed(2) + '°' + (place.lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(place.lon).toFixed(2) + '°' + (place.lon >= 0 ? 'E' : 'W') + '</span>' +
      '<span>' + (state.week ? state.week.tzName : '') + '</span>' +
      '<span id="updAt">' + (state.updAt || '—') + '</span>';
    document.title = place.name + ' · 七天霞预报';
  }

  /* ---------- 今天 ---------- */
  function renderToday() {
    var d = state.data;
    if (!d) return;
    var now = Date.now();
    if (!d.events || !d.events.length) {
      $('#tdCap').textContent = '这段时间没有可评分的场次（极昼/极夜或无日落）';
      $('#todayRow').innerHTML = '<div class="tcard big"><div class="lab">无场次</div>' +
        '<div class="tscore">--<span>/100</span></div><div class="tgrade">换个日期或地点试试</div></div>';
      return;
    }
    var ev = d.events.filter(function (e) { return e.epoch > now - 20 * 60000; })[0] || d.events[0];
    var lv = ev.level != null ? ev.level : G.band(ev.score);
    var win = API.viewingWindow ? API.viewingWindow(ev.epoch, ev.type === 'sunset', d.offsetSec).replace('约 ', '') : '—';
    $('#tdCap').textContent = '取数于 ' + G.fmtTime(d.fetchedAt, d.offsetSec) + ' · 下一个' + (ev.type === 'sunset' ? '日落' : '日出') + '场';
    $('#todayRow').innerHTML =
      '<div class="tcard big" style="--c:' + gradeColor(lv) + '">' +
        '<div class="lab">' + (ev.type === 'sunset' ? '日落' : '日出') + ' · ' + G.fmtDate(ev.epoch, d.offsetSec) + '</div>' +
        '<div class="tscore">' + ev.score + '<span>/100</span></div>' +
        '<div class="tgrade">' + (G.GRADE[lv] || ev.grade) + ' · ' + G.SENT[lv] + '</div>' +
      '</div>' +
      [['最佳窗口', win], [ev.type === 'sunrise' ? '日出' : '日落', G.fmtTime(ev.epoch, d.offsetSec)], ['方位', Math.round(ev.bearing || 0) + '°'],
       ['通透', (ev.clarity && ev.clarity.score) || '—'], ['把握', ev.conf || '—'],
       ['模式', ((ev.ensemble && ev.ensemble.members) || []).length + ' 家']]
        .map(function (r) { return '<div class="tcard"><div class="lab">' + r[0] + '</div><div class="tv">' + r[1] + '</div></div>'; }).join('');
    G.setSky(lv, ev.type === 'sunrise', true);
  }

  /* ---------- 七天矩阵 ---------- */
  function renderMatrix() {
    var w = state.week;
    if (!w) return;
    var rows = [
      { k: 'sunset', nm: '晚霞', get: function (d) { return d.sunset; } },
      { k: 'sunrise', nm: '朝霞', get: function (d) { return d.sunrise; } }
    ].filter(function (r) { return state.scope === 'all' || state.scope === r.k; });

    var head = '<div class="mx-corner"></div>' + w.days.map(function (d, i) {
      var dt = new Date(d.date + 'T12:00:00Z');
      return '<div class="mx-day' + (i === state.idx ? ' on' : '') + '">' +
        '<b>' + (i === 0 ? '今天' : G.WD[dt.getUTCDay()]) + '</b>' +
        '<span>' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate() + '</span></div>';
    }).join('');

    var body = rows.map(function (r) {
      return '<div class="mx-label">' + r.nm + '</div>' + w.days.map(function (d, i) {
        var ev = r.get(d);
        if (!ev) return '<div class="mx-cell empty" data-i="' + i + '"><span>—</span></div>';
        var lv = ev.level != null ? ev.level : G.band(ev.score);
        return '<button class="mx-cell l' + lv + (i === state.idx ? ' on' : '') + '" data-i="' + i + '" data-lv="' + lv + '"' +
          ' aria-label="' + d.date + ' ' + r.nm + ' ' + ev.score + ' 分 ' + G.GRADE[lv] + '">' +
          '<b>' + ev.score + '</b><span>' + G.GRADE[lv] + '</span>' +
          '<i class="mx-bar" style="height:' + Math.max(8, ev.score) + '%;background:' + gradeColor(lv) + '"></i></button>';
      }).join('');
    }).join('');

    $('#matrix').innerHTML = '<div class="mx-grid ' + (state.scope === 'all' ? 'two' : 'one') + '">' + head + body + '</div>';
    $('#matrixLegend').innerHTML = G.GRADE.map(function (g, i) {
      return '<span><i style="background:var(--lv' + i + ')"></i>' + g + '</span>';
    }).join('') + '<span class="hint">点格子 → 下方剖面与模式同步</span>';

    $$('.mx-cell:not(.empty)').forEach(function (b) {
      b.addEventListener('click', function () {
        state.idx = +b.dataset.i;
        renderMatrix(); renderDeck(); renderModels(); renderHead();
        var u = new URL(location.href); u.searchParams.set('d', state.idx);
        history.replaceState(null, '', u);
      });
    });
  }

  /* ---------- 云层剖面 ---------- */
  function renderDeck() {
    var w = state.week; if (!w) return;
    var day = w.days[state.idx];
    var anchor = (day.sunset || day.sunrise);
    if (!anchor) { $('#dkCap').textContent = '这天没有可用数据'; return; }

    var hourly = w.fc.hourly || {};
    var times = hourly.time || [];
    var off = w.offsetSec;
    var pts = [];
    var SPAN = 180; // 分钟
    var N = 72;
    for (var i = 0; i < N; i++) {
      var t = anchor.epoch + (-SPAN + 2 * SPAN * i / (N - 1)) * 60000;
      // 找最近的整点
      var best = -1, bd = 1e18;
      for (var k = 0; k < times.length; k++) {
        var ep = G.A.toEpoch(times[k], off);
        var dd = Math.abs(ep - t);
        if (dd < bd) { bd = dd; best = k; }
      }
      if (best < 0) continue;
      pts.push({
        x: i / (N - 1),
        low: hourly.cloud_cover_low ? hourly.cloud_cover_low[best] : null,
        mid: hourly.cloud_cover_mid ? hourly.cloud_cover_mid[best] : null,
        high: hourly.cloud_cover_high ? hourly.cloud_cover_high[best] : null
      });
    }
    if (!pts.length) { $('#dkCap').textContent = '这天没有逐时云量'; return; }

    var W = 1000, H = 260;
    function area(key, base, color, op) {
      var d = 'M0,' + H;
      pts.forEach(function (p) {
        var v = p[key] == null ? 0 : p[key];
        var h = v / 100 * (H - 30);
        d += ' L' + (p.x * W).toFixed(1) + ',' + (H - h).toFixed(1);
      });
      d += ' L' + W + ',' + H + ' Z';
      return d;
    }
    var path = function (key, color, op) { return '<path d="' + area(key) + '" fill="' + color + '" opacity="' + op + '"/>'; };
    var svg = '<defs><linearGradient id="dl" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="rgba(246,239,230,.5)"/><stop offset="1" stop-color="rgba(246,239,230,.08)"/></linearGradient></defs>';
    // 网格
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = H - v / 100 * (H - 30);
      svg += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="rgba(246,239,230,.08)" stroke-dasharray="2 6"/>';
    });
    svg += path('high', '#FF7E8B', .55) + path('mid', '#FF9F45', .55) + path('low', 'url(#dl)', .8);
    // 中轴
    svg += '<line x1="500" y1="0" x2="500" y2="' + H + '" stroke="rgba(255,90,31,.9)" stroke-width="1.5"/>';
    svg += '<circle cx="500" cy="14" r="4" fill="#FF5A1F"/>';
    $('#deckSvg').innerHTML = svg;
    $('#dkTitle').textContent = '三层云，各自在挡什么。';
    $('#dkCap').textContent = new Date(day.date + 'T12:00:00Z').getUTCMonth() + 1 + ' 月 ' +
      new Date(day.date + 'T12:00:00Z').getUTCDate() + ' 日 · 以 ' +
      (anchor.type === 'sunset' ? '日落 ' : '日出 ') + G.fmtTime(anchor.epoch, off) + ' 为轴心，前后三小时。';
  }

  /* ---------- 模式 ---------- */
  function renderModels() {
    var w = state.week; if (!w) return;
    var day = w.days[state.idx];
    var ev = day.sunset || day.sunrise;
    var mem = (ev && ev.ensemble && ev.ensemble.members) || [];
    var lvms = { best_match: '综合 ×3', ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON' };
    if (!mem.length) { $('#modelsBox').innerHTML = '<div class="small">这场没有模式数据</div>'; return; }
    var max = Math.max.apply(null, mem.map(function (m) { return m.score; }));
    var min = Math.min.apply(null, mem.map(function (m) { return m.score; }));
    $('#modelsBox').innerHTML =
      '<div class="mrow">' + mem.map(function (m) {
        var lv = G.band(m.score);
        return '<div class="mcard"><div class="row between"><span class="lab">' + (lvms[m.model] || m.model) + '</span>' +
          '<b style="color:' + gradeColor(lv) + '">' + m.score + '</b></div>' +
          '<div class="bar" style="margin-top:10px"><i style="width:' + m.score + '%;background:' + gradeColor(lv) + '"></i></div>' +
          '<div class="small" style="margin-top:8px">' + G.GRADE[lv] + '</div></div>';
      }).join('') + '</div>' +
      '<p class="small" style="margin-top:20px">分歧 ' + (max - min) + ' 分（' + min + '–' + max + '）。' +
      (max - min >= 25 ? '分歧偏大，这一场不太稳。' : '分歧不大，可信度较好。') + '</p>';
  }


  /* ---------- 今日榜归属（不在榜 → 已实时计算） ---------- */
  function renderBoardBadge(fetchedAt, offset) {
    var el = document.getElementById('boardBadge');
    if (!el) return;
    fetch('../data/rankings.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) {
        var rank = 0, rec = null;
        ['china', 'global'].forEach(function (k) {
          (d[k] || []).forEach(function (r, i) {
            if (!rec && r.city && r.city.name === place.name) { rec = r; rank = i + 1; }
          });
        });
        var when = d.computedAt ? new Date(d.computedAt) : null;
        var stamp = when ? ((when.getMonth() + 1) + '-' + when.getDate() + ' ' +
          G.pad(when.getHours()) + ':' + G.pad(when.getMinutes())) : '';
        var stale = when && (Date.now() - when.getTime() > 36 * 3600e3);
        if (rec) {
          el.className = 'board-badge in' + (stale ? ' stale' : '');
          el.textContent = (stale ? '榜单已过期（生成于 ' + stamp + '）' : '今日霞榜在榜') +
            ' · 第 ' + rank + ' 名 · ' + rec.score + ' 分';
        } else {
          el.className = 'board-badge live' + (stale ? ' stale' : '');
          el.textContent = (stale ? '榜单已过期（生成于 ' + stamp + '）' : '该城市不在今日霞榜') +
            ' · 已按实时数据现算（取数 ' + G.fmtTime(fetchedAt, offset) + '）';
        }
      }).catch(function () {
        el.className = 'board-badge live';
        el.textContent = '今日榜单不可用 · 本页数据为实时现算';
      });
  }

  /* ---------- 启动 ---------- */
  /* 首屏用每小时快照先画一版，接口失败时它就是兜底 */
  function paintFromSnapshot() {
    G.snapshotFor(place.name, place.lat, place.lon).then(function (snap) {
      if (!snap || state.data) return;
      var r = snap.row, lv = r.level != null ? r.level : G.band(r.score);
      var ageH = (Date.now() - snap.computedAt) / 3600e3;   // 与榜单同口径：>36h 视为过期
      var stampTxt = G.stamp(snap.computedAt) + (ageH > 36 ? '（' + Math.round(ageH) + ' 小时前，可能已过期）' : '');
      $('#tdCap').textContent = '快照 ' + stampTxt + ' · 单模式粗算 · 正在获取实时数据…';
      $('#todayRow').innerHTML =
        '<div class="tcard big" style="--c:' + gradeColor(lv) + '">' +
          '<div class="lab">快照 · ' + (r.day === 'today' ? '今天' : '明天') + '</div>' +
          '<div class="tscore">' + r.score + '<span>/100</span></div>' +
          '<div class="tgrade">' + (G.GRADE[lv] || r.grade) + '</div></div>' +
        '<div class="tcard"><div class="lab">日落</div><div class="tv">' + G.fmtTime(r.epoch, r.offsetSec) + '</div></div>' +
        '<div class="tcard"><div class="lab">方位</div><div class="tv">' + Math.round(r.bearing || 0) + '°</div></div>';
      G.setSky(lv, r.day === 'sunrise', true);
    });
  }

  function boot() {
    G.initSky(); G.masthead(); G.tabbar('city'); G.reveal('.reveal-auto');
    renderHead();
    paintFromSnapshot();
    FORECAST.fourEvents(place.lat, place.lon).then(function (d) {
      state.data = d; renderToday(); renderBoardBadge(d.fetchedAt, d.offsetSec);
      state.updAt = '更新 ' + G.fmtTime(d.fetchedAt, d.offsetSec);
      var el = document.getElementById('updAt'); if (el) el.textContent = state.updAt;
    }).catch(function (e) {
      console.error(e);
      G.notice('接口限流或超时，先显示每小时快照，完整明细稍后重试', 'warn');
      G.snapshotFor(place.name, place.lat, place.lon).then(function (snap) {
        if (!snap) { $('#tdCap').textContent = '取数失败，请稍后重试'; return; }
        var r = snap.row, lv = r.level != null ? r.level : G.band(r.score);
        var ageH2 = (Date.now() - snap.computedAt) / 3600e3;
        $('#tdCap').textContent = '接口不可用 · 快照 ' + G.stamp(snap.computedAt) +
          (ageH2 > 36 ? '（' + Math.round(ageH2) + ' 小时前，可能已过期）' : '') + ' · 单模式粗算';
        $('#todayRow').innerHTML = '<div class="tcard big" style="--c:' + gradeColor(lv) + '">' +
          '<div class="lab">快照 · ' + (r.day === 'today' ? '今天' : '明天') + '</div>' +
          '<div class="tscore">' + r.score + '<span>/100</span></div>' +
          '<div class="tgrade">' + (G.GRADE[lv] || r.grade) + '（缓存）</div></div>';
        G.setSky(lv, r.day === 'sunrise', true);
      });
    });

    FORECAST.weeklyCached(place.lat, place.lon, 7).then(function (w) {
      state.week = w;
      if (state.idx >= w.days.length) state.idx = 0;
      renderMatrix(); renderDeck(); renderModels(); renderHead();
    }).catch(function (e) {
      $('#matrix').innerHTML = '<div class="small">七天预报取数失败：' + (e && e.message) + '</div>';
      console.error(e);
    });

    $$('.ctab').forEach(function (b) {
      b.addEventListener('click', function () {
        state.scope = b.dataset.k;
        $$('.ctab').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        renderMatrix();
      });
    });

    var sh = document.getElementById('shareBtn');
    if (sh) sh.addEventListener('click', function () {
      if (navigator.share) navigator.share({ title: place.name + ' 霞预报', url: location.href }).catch(function () {});
      else navigator.clipboard.writeText(location.href);
    });
    G.initSearch({});
  }

  boot();
})();
