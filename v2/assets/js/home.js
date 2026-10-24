/* ============================================================
   GLOW v2 · home.js — P01（今晚 + 七日 + 霞榜预告）
   数据：../algo.js + ../api.js（与线上同源，不重算算法）
   ============================================================ */
(function () {
  'use strict';
  var G = window.GLOW, A = G.A, API = G.API;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DEFAULT = { name: '胡志明市 · Thủ Đức', short: '胡志明市', lat: 10.79, lon: 106.75 };
  var state = { data: null, place: null, idx: 0, week: null, scope: 'global', tl: { t: 0, playing: false } };
  var placeSeq = 0;   // 每次换地点 +1，旧响应回来时直接丢弃

  var gradeColor = function (level) { return 'var(--lv' + level + ')'; };
  // 任何拼进 innerHTML 的外部字符串都必须过这里（城市名来自 URL 参数）
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- Hero ---------------- */
  function renderHero() {
    var d = state.data, ev = d.events[state.idx];
    var sunrise = ev.type === 'sunrise';
    var level = ev.level != null ? ev.level : G.band(ev.score);
    var offset = d.offsetSec;

    $('#heroWord').textContent = ev.day === 'tomorrow' ? (sunrise ? '明早' : '明晚') : (sunrise ? '今早' : '今晚');
    $('#placeLine').innerHTML = '<span>' + esc(state.place.name) + '</span>' +
      '<em>' + G.fmtDate(ev.epoch, offset) + '</em>' +
      '<em>' + Math.abs(state.place.lat).toFixed(2) + '°' + (state.place.lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(state.place.lon).toFixed(2) + '°' + (state.place.lon >= 0 ? 'E' : 'W') + '</em>' +
      '<em>更新于 ' + G.fmtTime(d.fetchedAt, offset) + '</em>';

    var sc = $('#heroScore');
    sc.textContent = ev.score;
    sc.className = 'score-xl g' + level;
    $('#heroGrade').textContent = G.GRADE[level] || ev.grade;

    var bar = $('#heroBar');
    bar.style.width = ev.score + '%';
    bar.style.background = gradeColor(level);
    bar.style.boxShadow = level >= 4 ? '0 0 12px rgba(255,90,31,.45)' : 'none';

    $('#heroVerdict').firstChild.textContent = G.SENT[level] + ' ';
    $('#heroWhy').textContent = (ev.reasons && ev.reasons[0]) || '';

    var win = API.viewingWindow ? API.viewingWindow(ev.epoch, !sunrise, offset).replace('约 ', '') : '';
    $('#heroWindow').textContent = win || '—';
    $('#heroSunset').textContent = G.fmtTime(ev.epoch, offset);
    var sunLab = document.getElementById('heroSunLabel');
    if (sunLab) sunLab.textContent = sunrise ? '日出' : '日落';
    $('#heroBearing').textContent = Math.round(ev.bearing || 0) + '°';

    var ens = ev.ensemble || {};
    var clarity = ev.clarity || { name: '—', score: '—' };
    var chips = [
      ['把握', ev.conf || '—', ''],
      ['通透', String(clarity.score), clarity.name],
      ['模式', String((ens.members || []).length || '—'), '家'],
      ['方位', Math.round(ev.bearing || 0) + '°', '']
    ];
    $('#heroChips').innerHTML = chips.map(function (c) {
      return '<span class="chip"><span class="k">' + c[0] + '</span><b>' + c[1] + '</b>' +
        (c[2] ? '<span class="k">' + c[2] + '</span>' : '') + '</span>';
    }).join('');

    // 移动端紧凑事实条
    var fm = $('#heroFactsM');
    if (fm) {
      fm.innerHTML = [
        ['窗口', win || '—'],
        [sunrise ? '日出' : '日落', G.fmtTime(ev.epoch, offset)],
        ['方位', Math.round(ev.bearing || 0) + '°'],
        ['通透', String(clarity.score)]
      ].map(function (r) {
        return '<div><span class="lab">' + r[0] + '</span><b>' + r[1] + '</b></div>';
      }).join('');
    }

    renderSunPath(ev, sunrise, offset);
    renderModels(ev);
    G.setSky(level, sunrise, false);
  }

  function renderSunPath(ev, sunrise, offset) {
    var pts = [
      { e: 6, label: '+6° 金色' },
      { e: 0, label: sunrise ? '0° 日出' : '0° 日落' },
      { e: -2, label: '−2° 火烧' },
      { e: -6, label: '−6° 蓝调' },
      { e: -18, label: '−18° 夜' }
    ];
    var rows = pts.map(function (p) {
      var t = p.e === 0 ? ev.epoch : solveElev(ev.epoch, p.e);
      return { label: p.label, t: t, now: p.e === 0 };
    }).filter(function (r) { return r.t !== null; }).sort(function (a, b) { return a.t - b.t; });
    var nowRow = rows.find(function (r) { return r.now; });
    $('#sunPath').innerHTML = rows.map(function (r) {
      return '<div class="rail-row' + (r === nowRow ? ' now' : '') + '"><span>' + r.label +
        '</span><span>' + G.fmtTime(r.t, offset) + '</span></div>';
    }).join('');
    $('#railSunset').textContent = (sunrise ? 'SUNRISE ' : 'SUNSET ') + G.fmtTime(ev.epoch, offset);
  }

  function solveElev(center, target) {
    var lo = center - 3 * 3600e3, hi = center + 3 * 3600e3, prev = null;
    for (var i = 0; i <= 48; i++) {
      var t = lo + (hi - lo) * i / 48;
      var e = G.solarElev(state.place.lat, state.place.lon, t) - target;
      if (prev && prev.e * e <= 0) {
        var a = prev.t, b = t;
        for (var k = 0; k < 18; k++) {
          var m = (a + b) / 2;
          var em = G.solarElev(state.place.lat, state.place.lon, m) - target;
          if (em * prev.e <= 0) b = m; else a = m;
        }
        return Math.round((a + b) / 2);
      }
      prev = { t: t, e: e };
    }
    return null;
  }

  function renderModels(ev) {
    var m = (ev.ensemble && ev.ensemble.members) || [];
    if (!m.length) { $('#models').innerHTML = '<div class="rail-row"><span>无数据</span><span>—</span></div>'; return; }
    var label = { best_match: '综合 ×3', ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON' };
    $('#models').innerHTML = m.map(function (x) {
      return '<div class="rail-row"><span>' + (label[x.model] || x.label || x.model) + '</span><span>' + x.score + '</span></div>';
    }).join('');
  }

  /* ---------------- 四场 ---------------- */
  function renderEvents() {
    var d = state.data;
    $('#events').innerHTML = d.events.map(function (ev, i) {
      var level = ev.level != null ? ev.level : G.band(ev.score);
      var isSun = ev.type === 'sunrise';
      var day = ev.day === 'today' ? (isSun ? '今早' : '今晚') : (isSun ? '明早' : '明晚');
      var past = ev.epoch < Date.now() - 15 * 60000;
      return '<button class="ev' + (i === state.idx ? ' on' : '') + '" role="tab" aria-selected="' + (i === state.idx) + '" data-i="' + i + '">' +
        '<span class="ev-top"><span>' + String(i + 1).padStart(2, '0') + (past ? ' · 已过' : '') + ' ' + day + '</span>' +
        '<span>' + G.fmtTime(ev.epoch, d.offsetSec) + '</span></span>' +
        '<div class="ev-score g' + level + '">' + ev.score + '</div>' +
        '<div class="bar" style="margin-top:14px"><i style="width:' + ev.score + '%;background:' + gradeColor(level) + '"></i></div>' +
        '<div class="ev-why">' + ((ev.reasons && ev.reasons[0]) || ev.grade) + '</div>' +
        '<div class="ev-grade">' + (G.GRADE[level] || ev.grade) + '</div>' +
        '</button>';
    }).join('');
    $$('.ev', $('#events')).forEach(function (b) {
      b.addEventListener('click', function () {
        state.idx = +b.dataset.i;
        renderHero(); renderEvents(); renderGates(); buildTimeline(); syncURL();
      });
    });
  }

  function renderGates() {
    var ev = state.data.events[state.idx];
    var c = ev.comps || {};
    var pick = function (k) { return (c[k] && c[k][0] != null) ? Math.round(c[k][0]) : null; };
    var rows = [
      ['幕布', pick('curtainV2')],
      ['缺口', pick('gapV2')],
      ['低云', pick('low')]
    ];
    $('#gates').innerHTML = rows.map(function (r) {
      var v = r[1] == null ? '—' : Math.max(0, Math.min(100, r[1]));
      return '<div class="gate"><div class="lab">' + r[0] + '</div><div class="v">' + v + '</div>' +
        '<div class="pbar" style="margin-top:8px"><i style="width:' + (v === '—' ? 0 : v) + '%;background:var(--ember)"></i></div></div>';
    }).join('');
  }

  /* ---------------- 时间轴 ---------------- */
  var TL_SPAN = 150;
  function buildTimeline() {
    var ev = state.data.events[state.idx], bars = '', N = 75;
    for (var i = 0; i < N; i++) {
      var min = -TL_SPAN + (300 * i / (N - 1));
      var e = G.solarElev(state.place.lat, state.place.lon, ev.epoch + min * 60000);
      var v = Math.max(0, Math.min(1, Math.exp(-Math.pow((e + 2) / 6.5, 2)))) * 100;
      bars += '<div class="tl-bar" data-v="' + v.toFixed(1) + '" style="height:' + (8 + v * .36) + 'px;background:' +
        (v > 70 ? 'rgba(255,90,31,.9)' : v > 45 ? 'rgba(255,159,69,.75)' : v > 22 ? 'rgba(255,126,139,.55)' : 'rgba(246,239,230,.18)') + '"></div>';
    }
    $('#tlBars').innerHTML = bars;
    var bands = [
      '<div class="tl-band" style="flex:1;background:var(--plasma)"></div>',
      '<div class="tl-band" style="flex:1.4;background:var(--ember)"></div>',
      '<div class="tl-band" style="flex:1.2;background:var(--gold)"></div>'
    ];
    // 日出：蓝调 → 火烧 → 金色；日落反过来
    if (ev.type === 'sunset') bands.reverse();
    $('#tlBands').innerHTML = bands.join('');

    var ticks = '';
    for (var m = -TL_SPAN; m <= TL_SPAN; m += 60) {
      if (m === 0) continue;
      var p = (m + TL_SPAN) / (2 * TL_SPAN) * 100;
      ticks += '<span style="left:' + Math.min(96, Math.max(4, p)) + '%">' + G.fmtTime(ev.epoch + m * 60000, state.data.offsetSec) + '</span>';
    }
    $('#tlTicks').innerHTML = ticks;

    setTL(state.tl.t || 0);
    var rise = ev.type === 'sunrise';
    $('#tlTitle').innerHTML = rise ? '拖着时间走，<br>看天一点点亮起来' : '拖着时间走，<br>看天一点点暗下去';
    $('#tlCaption').textContent = '以 ' + (rise ? '日出' : '日落') + ' ' + G.fmtTime(ev.epoch, state.data.offsetSec) + ' 为轴心，前后两个半小时。';
  }

  function setTL(t) {
    t = Math.max(-TL_SPAN, Math.min(TL_SPAN, t));
    state.tl.t = t;
    var ev = state.data.events[state.idx], offset = state.data.offsetSec;
    var epoch = ev.epoch + t * 60000;
    var e = G.solarElev(state.place.lat, state.place.lon, epoch);
    var pct = Math.round(Math.max(0, Math.min(1, Math.exp(-Math.pow((e + 2) / 6.5, 2)))) * ev.score);

    $('#tlClock').textContent = G.fmtTime(epoch, offset);
    $('#tlElev').textContent = (e >= 0 ? '+' : '') + e.toFixed(1) + '°';
    $('#tlPct').textContent = pct + ' / 100';
    var phase = e > 6 ? ['白昼', 'DAY'] : e > -1 ? ['金色时刻', 'GOLD'] : e > -6 ? ['火烧云', 'FIRE'] : e > -12 ? ['蓝调时刻', 'BLUE'] : ['夜', 'NIGHT'];
    $('#tlPhase').textContent = phase[0];
    $('#tlPhaseEn').textContent = phase[1];
    $('#tlHead').style.left = ((t + TL_SPAN) / (2 * TL_SPAN) * 100) + '%';
    $('#tlHeadLabel').textContent = G.fmtTime(epoch, offset);
    $('#tlTrack').setAttribute('aria-valuenow', Math.round(t));
    $('#tlTrack').setAttribute('aria-valuetext', G.fmtTime(epoch, offset) + '，太阳高度 ' + e.toFixed(1) + ' 度');
    var top = e > 0 ? '#2A1A55' : e > -6 ? '#7A1A58' : e > -12 ? '#241441' : '#0E0B22';
    $('#tlSky').style.background = 'radial-gradient(120% 80% at 56% 100%, ' +
      (e > -1 ? '#FF5A1F' : e > -6 ? '#8A3A6E' : '#3A1B58') + ' 0%, ' + top + ' 60%, #06050E 100%)';
  }

  function bindTimeline() {
    var track = $('#tlTrack'), dragging = false;
    function fromEvent(ev) {
      var r = track.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      return (x / r.width) * 2 * TL_SPAN - TL_SPAN;
    }
    track.addEventListener('pointerdown', function (e) { dragging = true; track.setPointerCapture(e.pointerId); setTL(fromEvent(e)); });
    track.addEventListener('pointermove', function (e) { if (dragging) setTL(fromEvent(e)); });
    track.addEventListener('pointerup', function () { dragging = false; });
    track.addEventListener('pointercancel', function () { dragging = false; });
    track.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 20 : 2;
      if (e.key === 'ArrowRight') { setTL(state.tl.t + step); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { setTL(state.tl.t - step); e.preventDefault(); }
      if (e.key === ' ') { togglePlay(); e.preventDefault(); }
    });
    var raf;
    function togglePlay() { state.tl.playing ? stopPlay() : startPlay(); }
    function startPlay() {
      state.tl.playing = true;
      if (state.tl.t >= TL_SPAN) setTL(-TL_SPAN);
      var last = performance.now();
      (function loop(now) {
        if (!state.tl.playing) return;
        var dt = now - last; last = now;
        setTL(state.tl.t + dt / 1000 * 12);
        if (state.tl.t >= TL_SPAN) { state.tl.playing = false; return; }
        raf = requestAnimationFrame(loop);
      })(last);
    }
    function stopPlay() { state.tl.playing = false; cancelAnimationFrame(raf); }
  }

  /* ---------------- 剖面 ---------------- */
  // 11 项与算法 WEIGHTS 一一对应，数值直接取 ev.comps（不再自行拼公式）
  var ZONES = [
    { z: '8–12 km', rows: [
      { nm: '幕布（中+高云受光）', en: 'CURTAIN', w: '×0.5', k: 'curtainV2' }
    ]},
    { z: '0–2 km', rows: [
      { nm: '低云遮挡', en: 'STRATOCU', w: '×0.2', k: 'low' }
    ]},
    { z: '上游 50–400 km', rows: [
      { nm: '晴空缺口', en: 'UPSTREAM', w: '×0.3', k: 'gapV2' }
    ]},
    { z: '地面', rows: [
      { nm: '降水', w: '×10', k: 'precip' },
      { nm: '雨洗（前 3 小时）', w: '×10', k: 'washed' },
      { nm: '气溶胶 AOD', w: '×5', k: 'aod' },
      { nm: '能见度', w: '×3', k: 'vis' },
      { nm: 'PM2.5', w: '×3', k: 'pm' },
      { nm: '露点差', w: '×2', k: 'dew' },
      { nm: '风', w: '×2', k: 'wind' },
      { nm: 'CAPE', w: '×2', k: 'cape' }
    ]}
  ];

  function renderProfile(ev) {
    var comps = ev.comps || {}, inp = ev.inputs || {}, html = '';
    ZONES.forEach(function (z) {
      var first = true;
      z.rows.forEach(function (r) {
        var cell = comps[r.k];
        var v = cell ? cell[0] : null;
        var note = cell ? cell[1] : '';
        var gate = r.w === '×0.5' || r.w === '×0.3' || r.w === '×0.2';
        var bar = v == null
          ? '<span class="pbar" style="background:transparent;border-top:1px dashed rgba(246,239,230,.3)"></span>'
          : '<span class="pbar"><i style="width:' + Math.max(0, Math.min(100, Math.round(v))) + '%;background:' + (gate ? 'var(--ember)' : 'var(--mist)') + '"></i></span>';
        html += '<div class="prow">' +
          '<span class="zz">' + (first ? z.z : '') + '</span>' +
          '<span class="nm">' + r.nm + (r.en ? '<i>' + r.en + '</i>' : '') +
            (r.k === 'curtainV2' && inp.high != null ? '<i style="color:var(--veil)">高' + Math.round(inp.high) + '% / 中' + Math.round(inp.mid) + '%</i>' : '') +
          '</span>' +
          '<span class="sb">' + bar + '</span>' +
          '<span class="w">' + r.w + '</span>' +
          '<span class="v">' + (v == null ? '<span style="font-size:10px;color:var(--veil)">无数据</span>' : Math.round(v)) + '</span>' +
          '</div>';
        first = false;
      });
    });
    $('#pfRows').innerHTML = html;
    $('#pfLegend').innerHTML = [
      ['门控 0.5 / 0.3 / 0.2 · 几何加权', 'var(--ember)'],
      ['空气项 ×0.7–1.0 调制', 'var(--mist)'],
      ['缺数据 = 退出加权', 'dash']
    ].map(function (x) {
      return '<div class="row gap12 center"><span style="width:18px;height:2px;background:' + (x[1] === 'dash' ? 'transparent' : x[1]) +
        (x[1] === 'dash' ? ';border-top:1px dashed rgba(246,239,230,.35)' : '') + '"></span>' +
        '<span class="small" style="font-size:13px">' + x[0] + '</span></div>';
    }).join('');
  }

  /* ---------------- 七日 ---------------- */
  function renderWeek() {
    var d = state.week;
    if (!d) return;
    var best = 0;
    d.days.forEach(function (day, i) {
      var m = Math.max(day.sunset ? day.sunset.score : 0, day.sunrise ? day.sunrise.score : 0);
      if (m > best) best = m;
    });
    $('#weekGrid').innerHTML = d.days.map(function (day, i) {
      var ss = day.sunset, sr = day.sunrise;
      var sl = ss ? (ss.level != null ? ss.level : G.band(ss.score)) : -1;
      var rl = sr ? (sr.level != null ? sr.level : G.band(sr.score)) : -1;
      var isBest = (ss && ss.score === best) || (sr && sr.score === best);
      var dt = new Date(day.date + 'T12:00:00Z');
      var wd = G.WD[dt.getUTCDay()];
      return '<button class="wk' + (isBest ? ' best' : '') + '" type="button" data-day="' + i + '" data-type="sunset">' +
        '<span class="wk-d">' + (i === 0 ? '今天' : wd) + '</span>' +
        '<span class="wk-n">' + (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate() + '</span>' +
        '<span class="wk-bar">' +
          '<i class="ss" style="height:' + (ss ? Math.max(6, ss.score) : 0) + '%;background:' + (ss ? gradeColor(sl) : 'transparent') + '"></i>' +
          '<i class="sr" style="height:' + (sr ? Math.max(6, sr.score) : 0) + '%;background:' + (sr ? gradeColor(rl) : 'transparent') + '"></i>' +
        '</span>' +
        '<span class="wk-v">' + (ss ? ss.score : '—') + '</span>' +
        '<span class="wk-g">' + (ss ? G.GRADE[sl] : '无数据') + '</span>' +
        (isBest ? '<span class="wk-flag">7 日最高</span>' : '') +
        '</button>';
    }).join('');

    var bestDay = d.days.filter(function (x) {
      return (x.sunset && x.sunset.score === best) || (x.sunrise && x.sunrise.score === best);
    })[0] || d.days[0];
    var lg = document.getElementById('weekLegend');
    if (lg) lg.innerHTML = '<span><i style="background:var(--lv3)"></i>晚霞（日落）</span><span><i style="background:var(--lv1);opacity:.75"></i>朝霞（日出）</span>';
    $('#weekNote').textContent = '最高 ' + best + ' 分 · ' +
      (new Date(bestDay.date + 'T12:00:00Z').getUTCMonth() + 1) + ' 月 ' +
      new Date(bestDay.date + 'T12:00:00Z').getUTCDate() + ' 日 · ' + d.days.length + ' 天 · ' + d.tzName;
    $('#weekCity').href = 'city.html?c=' + encodeURIComponent(state.place.short || state.place.name) +
      '&lat=' + state.place.lat + '&lon=' + state.place.lon;

    $$('.wk').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = +b.dataset.day, day = d.days[i];
        if (day && day.sunset) {
          // 跳回七天内的对应场次：写入 URL，城市页负责展示
          location.href = 'city.html?c=' + encodeURIComponent(state.place.short || state.place.name) +
            '&lat=' + state.place.lat + '&lon=' + state.place.lon + '&d=' + i;
        }
      });
    });
  }

  /* ---------------- 霞榜预告 ---------------- */
  function renderBoard() {
    fetch('../data/rankings.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var list = (d[state.scope] || []).slice(0, 5);
      if (!list.length) throw new Error('empty');
      var when = d.computedAt ? new Date(d.computedAt) : null;
      var stale = when && (Date.now() - when.getTime() > 36 * 3600e3);
      $('#bdMeta').textContent = when ? ((stale ? '⚠ 非今日 · ' : '更新 ') + (when.getMonth() + 1) + '-' + when.getDate() + ' ' +
        G.pad(when.getHours()) + ':' + G.pad(when.getMinutes())) : '';
      $('#bdMeta').style.color = stale ? 'var(--gold)' : '';
      $('#bList').innerHTML = list.map(function (c, i) {
        var lv = c.level != null ? c.level : G.band(c.score);
        var t = '';
        try { t = G.fmtTime(c.epoch, c.offsetSec || 0); } catch (e) {}
        return '<a class="trow" href="city.html?c=' + encodeURIComponent(c.city.name) + '&lat=' + c.city.lat + '&lon=' + c.city.lon + '">' +
          '<span class="rk">' + G.pad(i + 1) + '</span>' +
          '<span class="ct">' + c.city.name + '</span>' +
          '<span class="dt">' + t + '</span>' +
          '<span class="sc" style="color:' + gradeColor(lv) + '">' + c.score + '</span></a>';
      }).join('');
      var st = (d.stats || {})[state.scope] || {};
      $('#bBelt').innerHTML = '<svg viewBox="0 0 800 96" preserveAspectRatio="none" style="width:100%;height:100%">' +
        '<rect x="240" width="320" height="96" fill="url(#tm)"/>' +
        '<defs><linearGradient id="tm" x1="0" x2="1"><stop offset="0" stop-color="rgba(255,90,31,0)"/>' +
        '<stop offset=".35" stop-color="rgba(255,90,31,.28)"/><stop offset=".5" stop-color="rgba(255,195,107,.42)"/>' +
        '<stop offset=".65" stop-color="rgba(255,90,31,.28)"/><stop offset="1" stop-color="rgba(255,90,31,0)"/></linearGradient></defs>' +
        '<path d="M40 62 L80 46 L120 52 L160 40 L200 56" stroke="rgba(246,239,230,.18)" fill="none"/>' +
        '<path d="M600 64 L640 50 L680 56 L720 44 L760 60" stroke="rgba(246,239,230,.18)" fill="none"/>' +
        '<circle cx="400" cy="48" r="4.5" fill="#FF5A1F"/>' +
        '<text x="412" y="44" fill="#F6EFE6" font-size="10" font-family="JetBrains Mono">本地日落线</text>' +
        '<text x="20" y="86" fill="rgba(246,239,230,.5)" font-size="10" font-family="JetBrains Mono">' +
        ((st.counts && st.counts.length) ? st.counts.join(' · ') : '') + '</text></svg>';
    }).catch(function () {
      $('#bdMeta').textContent = '榜单暂不可用';
      $('#bList').innerHTML = '<div class="trow"><span class="ct">今日霞榜未生成</span></div>';
    });
  }

  function bindBoardTabs() {
    $$('#bdTabs .tab').forEach(function (b) {
      b.addEventListener('click', function () {
        state.scope = b.dataset.scope;
        $$('#bdTabs .tab').forEach(function (x) {
          var on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-selected', on);
        });
        renderBoard();
      });
    });
  }

  /* ---------------- URL 状态 ---------------- */
  function readURL() {
    var q = new URLSearchParams(location.search);
    var lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon')), c = q.get('c');
    if (!isNaN(lat) && !isNaN(lon)) return { name: c || (lat.toFixed(2) + ', ' + lon.toFixed(2)), short: c || '当前位置', lat: lat, lon: lon };
    return null;
  }
  function syncURL() {
    var ev = state.data && state.data.events[state.idx];
    if (!ev) return;
    var q = new URLSearchParams();
    q.set('c', state.place.short || state.place.name);
    q.set('lat', state.place.lat.toFixed(4));
    q.set('lon', state.place.lon.toFixed(4));
    q.set('ev', state.idx);
    try { history.replaceState(null, '', '?' + q.toString()); } catch (e) {}
  }


  /* ---------------- 空状态（未设置区域） ---------------- */
  function renderEmpty() {
    $('#heroWord').textContent = '未设置区域';
    var sc = $('#heroScore'); sc.textContent = '—'; sc.className = 'score-xl';
    $('#heroGrade').textContent = '等待位置';
    $('#heroVerdict').firstChild.textContent = '点「定位」用当前位置，或搜一个城市。 ';
    $('#heroWhy').textContent = '';
    $('#heroWindow').textContent = '--:--–--:--';
    $('#heroSunset').textContent = '--:--';
    $('#heroBearing').textContent = '---°';
    $('#heroBar').style.width = '0';
    $('#heroChips').innerHTML = '';
    $('#placeLine').innerHTML = '<span>未设置区域</span><em>示例天幕：大烧</em>';
    var fm = $('#heroFactsM');
    if (fm) fm.innerHTML = '';
    G.setSky(5, false, true);   // 按要求：默认背景用大烧
    $('#events').innerHTML = '<div class="empty-note">定位或搜索城市后，这里显示今明两日四场预报。</div>';
    $('#gates').innerHTML = '';
    $('#pfRows').innerHTML = '<div class="empty-note">定位后显示 11 项因素的分层评分。</div>';
    $('#weekGrid').innerHTML = '<div class="empty-note">定位后显示未来七天。</div>';
    $('#weekNote').textContent = '尚未选择位置';
    $('#weekCity').textContent = '搜索城市 →';
    $('#weekCity').href = '#';
    $('#tlCaption').textContent = '选择一个位置后，这条时间轴会以当地日落为轴心。';
    $('#tlTitle').innerHTML = '拖着时间走，<br>看天一点点暗下去';
  }

  function setHeroStatus(txt) {
    var v = $('#heroVerdict');
    if (v) v.firstChild.textContent = txt + ' ';
  }

  /* ---------------- 定位 ---------------- */
  function reverseGeocode(lat, lon) {
    var url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat +
      '&longitude=' + lon + '&localityLanguage=zh';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var city = j.city || j.locality || '';
      var sub = j.principalSubdivision && j.principalSubdivision !== city ? j.principalSubdivision : '';
      var name = [city, sub].filter(Boolean).join(' · ');
      return {
        name: name || (lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°'),
        short: city || j.locality || '当前位置',
        lat: lat, lon: lon, source: 'geo'
      };
    });
  }

  function applyPlace(place) {
    var seq = ++placeSeq;
    state.place = place;
    state.data = null;
    // 清空上一处的读数，避免切城市时短暂出现「新城市名 + 旧数据」
    $('#heroScore').textContent = '--';
    $('#heroGrade').textContent = '取数中';
    $('#heroChips').innerHTML = '';
    $('#gates').innerHTML = '';
    $('#pfRows').innerHTML = '';
    $('#events').innerHTML = '';
    $('#weekGrid').innerHTML = '';
    $('#searchLabel').textContent = place.short || place.name;
    load(place, seq);
    FORECAST.weekly(place.lat, place.lon, 7).then(function (w) {
      if (seq !== placeSeq) return;          // 已经不是当前地点，丢弃
      state.week = w; renderWeek();
    }).catch(function (e) {
      if (seq !== placeSeq) return;
      $('#weekNote').textContent = '七日预报取数失败'; console.error(e);
    });
  }

  function locate() {
    var btn = document.getElementById('locateBtn');
    if (btn) btn.classList.add('busy');
    setHeroStatus('正在定位…');
    if (!navigator.geolocation || !window.isSecureContext) {
      setHeroStatus('这个环境不能定位，可以直接搜索城市');
      if (btn) btn.classList.remove('busy');
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(function (p) {
        if (btn) btn.classList.remove('busy');
        applyPlace(p);
      }).catch(function () {
        if (btn) btn.classList.remove('busy');
        applyPlace({ name: '我的位置', short: '当前位置', lat: pos.coords.latitude, lon: pos.coords.longitude, source: 'geo' });
      });
    }, function (err) {
      if (btn) btn.classList.remove('busy');
      setHeroStatus(err && err.code === 1 ? '你拒绝了定位，可以搜索城市' : '定位失败，可以搜索城市');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  }

  /* ---------------- 启动 ---------------- */
  function load(place, seq) {
    state.place = place;
    $('#searchLabel').textContent = place.short || place.name;
    return API.evaluatePlace(place.lat, place.lon).then(function (d) {
      if (seq != null && seq !== placeSeq) return;   // 迟到的旧地点，丢弃
      state.data = d;
      var now = Date.now(), first = 0;
      for (var i = 0; i < d.events.length; i++) { if (d.events[i].epoch > now - 15 * 60000) { first = i; break; } }
      var q = new URLSearchParams(location.search);
      var evq = q.get('ev');
      if (evq != null && /^\d+$/.test(evq) && +evq >= 0 && +evq < d.events.length) first = +evq;
      state.idx = first;
      renderHero(); renderEvents(); renderGates(); buildTimeline(); renderProfile(d.events[first]);
      syncURL();
    }).catch(function (err) {
      console.error(err);
      G.notice('接口限流或超时，先显示每小时快照', 'warn');
      G.snapshotFor(place.name, place.lat).then(function (snap) {
        if (!snap) {
          $('#heroVerdict').firstChild.textContent = '今天取数失败。';
          $('#heroWhy').textContent = (err && err.message) || '请稍后重试';
          return;
        }
        var r = snap.row, lv = r.level != null ? r.level : G.band(r.score);
        var sc = $('#heroScore'); sc.textContent = r.score; sc.className = 'score-xl g' + lv;
        $('#heroGrade').textContent = (G.GRADE[lv] || r.grade) + ' · 快照';
        $('#heroVerdict').firstChild.textContent = '接口不可用，这是 ' + G.stamp(snap.computedAt) + ' 的快照。 ';
        $('#heroWhy').textContent = '';
        $('#heroWindow').textContent = '—';
        $('#heroSunset').textContent = G.fmtTime(r.epoch, r.offsetSec);
        $('#heroBearing').textContent = Math.round(r.bearing || 0) + '°';
        G.setSky(lv, r.day === 'sunrise', true);
      });
    });
  }

  function boot() {
    G.initSky(); G.masthead(); G.tabbar('home'); bindTimeline(); bindBoardTabs(); renderBoard(); G.reveal('.reveal-auto');
    G.initSearch({ onPick: applyPlace, onLocate: locate });
    var place = readURL();
    if (place) applyPlace(place); else renderEmpty();

    $$('#events').length || null;
    document.getElementById('events').addEventListener('click', function (e) {
      var b = e.target.closest('.ev'); if (!b) return;
      renderProfile(state.data.events[+b.dataset.i]);
    });

    var share = function () {
      var ev = state.data && state.data.events[state.idx];
      var txt = ev ? ('今晚霞分 ' + ev.score + ' · ' + (G.GRADE[ev.level != null ? ev.level : G.band(ev.score)] || '') + ' · ' + state.place.name) : 'GLOW';
      if (navigator.share) navigator.share({ title: '霞', text: txt, url: location.href }).catch(function () {});
      else { navigator.clipboard.writeText(location.href); }
    };
    ['shareBtn', 'shareBtn2'].forEach(function (id) { var b = document.getElementById(id); if (b) b.addEventListener('click', share); });

  }

  boot();
})();
