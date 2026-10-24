/* ============================================================
   GLOW v2 · glow.js — 共享核心（格式化 / 等级 / 天幕 / 入场）
   ============================================================ */
window.GLOW = (function () {
  'use strict';
  var A = window.SunsetAlgo, API = window.SunsetAPI;
  var GRADE = ['无烧', '微烧', '小烧', '小到中烧', '中到大烧', '大烧'];
  var SENT = { 0: '没什么戏。', 1: '云边可能泛点色。', 2: '顺路看看就行。', 3: '可以去等一等。', 4: '值得跑一趟。', 5: '别错过。' };
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function band(score) { return score >= 80 ? 5 : score >= 65 ? 4 : score >= 50 ? 3 : score >= 35 ? 2 : score >= 20 ? 1 : 0; }
  function lvColor(level) { return 'var(--lv' + level + ')'; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function fmtTime(epoch, offsetSec) {
    try { return API.fmtTime(epoch, offsetSec); } catch (e) { return '--:--'; }
  }
  function fmtDate(epoch, offsetSec) {
    try { return API.fmtDate(epoch, offsetSec); } catch (e) { return ''; }
  }
  function weekday(epoch, offsetSec) {
    return WD[new Date(epoch + offsetSec * 1000).getUTCDay()];
  }

  /* 太阳高度（NOAA 简化式） */
  function solarElev(lat, lon, epoch) {
    var d = new Date(epoch);
    var utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    var doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
    var g = 2 * Math.PI / 365 * (doy - 1 + (utcMin / 1440 - 0.5));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var ha = (utcMin + eq + 4 * lon) / 4 - 180;
    var la = lat * Math.PI / 180, hr = ha * Math.PI / 180;
    var cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(hr);
    return 90 - Math.acos(Math.max(-1, Math.min(1, cz))) * 180 / Math.PI;
  }

  /* 天幕：按等级换图 + 交叉淡入 */
  var sky = { a: null, b: null, busy: false, cur: '' };
  function initSky() {
    sky.a = document.getElementById('skyA'); sky.b = document.getElementById('skyB');
    if (sky.a) sky.cur = sky.a.getAttribute('src') || '';
  }
  function skySrc(level, dawn) {
    return (window.GLOW_BASE || '') + 'assets/img/sky/H01_hero_sky_L' + level + '_' + (dawn ? 'dawn' : 'dusk') + '_v01.jpg';
  }
  function setSky(level, dawn, instant) {
    if (!sky.a) return;
    var src = skySrc(level, dawn);
    if (src === sky.cur || sky.busy) { if (instant) { sky.a.src = src; sky.cur = src; } return; }
    if (instant) { sky.a.src = src; sky.cur = src; return; }
    sky.busy = true;
    sky.b.src = src;
    var go = function () {
      sky.b.style.opacity = 1; sky.a.style.opacity = 0;
      setTimeout(function () {
        sky.a.src = src; sky.cur = src; sky.a.style.opacity = 1; sky.b.style.opacity = 0; sky.busy = false;
      }, 920);
    };
    if (sky.b.complete && sky.b.naturalWidth) go(); else sky.b.onload = go;
  }

  /* 入场动画 + 兜底 */
  function reveal(sel) {
    var items = Array.prototype.slice.call(document.querySelectorAll(sel || '.reveal-auto'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
      }, { threshold: .12 });
      items.forEach(function (el) { el.classList.add('reveal'); io.observe(el); });
    }
    setTimeout(function () { items.forEach(function (el) { el.classList.add('in'); }); }, 1200);
  }

  /* 顶栏：滚动毛玻璃 + 鼠标视差 */
  function masthead() {
    var mast = document.getElementById('mast');
    if (mast) {
      var f = function () { mast.classList.toggle('solid', window.scrollY > 120); };
      f(); window.addEventListener('scroll', f, { passive: true });
    }
    document.addEventListener('mousemove', function (e) {
      document.documentElement.style.setProperty('--mx', ((e.clientX / innerWidth - .5) * 2).toFixed(3));
      document.documentElement.style.setProperty('--my', ((e.clientY / innerHeight - .5) * 2).toFixed(3));
    }, { passive: true });
  }

  /* 底部 tabbar（移动端） */
  function tabbar(active) {
    var bar = document.getElementById('tabbar');
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('a'), function (a) {
      if (a.dataset.k === active) a.setAttribute('aria-current', 'page');
    });
  }

  /* 路由：城市 */
  function cityHref(name) { return 'city.html?c=' + encodeURIComponent(name); }


  /* ---------------- 统一搜索（中国 2,850 点 + 全球 2,024 城） ---------------- */
  var _cn = null, _world = null;
  var REGION = (function () { try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }); } catch (e) { return null; } })();
  function ccName(cc) {
    if (!cc) return '';
    try { return REGION ? (REGION.of(cc) || cc) : cc; } catch (e) { return cc; }
  }
  function loadCNPts() {
    if (_cn) return Promise.resolve(_cn);
    return fetch('../data/points-china.json').then(function (r) { return r.json(); })
      .then(function (j) { _cn = j.points || []; return _cn; }).catch(function () { _cn = []; return _cn; });
  }
  function loadWorldCities() {
    if (_world) return Promise.resolve(_world);
    return fetch('../data/world-cities.json').then(function (r) { return r.json(); })
      .then(function (j) { _world = j || []; return _world; }).catch(function () { _world = []; return _world; });
  }

  // 0=完全同名 1=前缀 2=包含；同级按人口降序
  function rank(nameZh, nameEn, q) {
    var a = (nameZh || '').toLowerCase(), b = (nameEn || '').toLowerCase(), t = q.toLowerCase();
    if (a === t || b === t) return 0;
    if (a.indexOf(t) === 0 || b.indexOf(t) === 0) return 1;
    if (a.indexOf(t) > -1 || b.indexOf(t) > -1) return 2;
    return -1;
  }

  function searchAll(q) {
    return Promise.all([loadCNPts(), loadWorldCities()]).then(function (res) {
      var pts = res[0], world = res[1], out = [];
      world.forEach(function (c) {
        var r = rank(c.zh, c.en, q);
        if (r < 0) return;
        out.push({ kind: 'city', name: (c.zh || c.en), sub: [c.en, ccName(c.cc)].filter(Boolean).join(' · '),
          lat: c.lat, lon: c.lon, score: r, pop: c.pop });
      });
      pts.forEach(function (p) {
        var r = rank(p.name, '', q);
        if (r < 0) return;
        out.push({ kind: 'cn', name: p.name, sub: p.path || '', lat: p.lat, lon: p.lon, score: r, pop: 0 });
      });
      out.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        if (a.kind !== b.kind) return a.kind === 'city' ? -1 : 1;   // 同级时城市优先于区县
        if (b.pop !== a.pop) return b.pop - a.pop;
        return a.name.length - b.name.length;
      });
      // 同名去重
      var seen = {}, list = [];
      out.forEach(function (x) { if (!seen[x.name]) { seen[x.name] = 1; list.push(x); } });
      return list.slice(0, 9);
    });
  }

  function initSearch(opts) {
    opts = opts || {};
    var panel = document.getElementById('searchPanel');
    var btn = document.getElementById('searchBtn');
    var input = document.getElementById('spInput');
    var box = document.getElementById('spResults');
    if (!panel || !btn || !input || !box) return;
    var seq = 0, timer = null;

    function open() {
      panel.hidden = false;
      document.body.classList.add('sp-open');
      setTimeout(function () { input.focus(); }, 30);
    }
    function close() { panel.hidden = true; document.body.classList.remove('sp-open'); }

    function run() {
      var q = (input.value || '').trim();
      if (!q) { box.innerHTML = ''; return; }
      var my = ++seq;
      box.innerHTML = '<div class="small" style="padding:12px 0">搜索中…</div>';
      searchAll(q).then(function (list) {
        if (my !== seq) return;
        box.innerHTML = list.length ? list.map(function (p) {
          return '<button type="button" class="sres" data-lat="' + p.lat + '" data-lon="' + p.lon +
            '" data-name="' + p.name + '"><b>' + p.name + '</b><span>' + (p.sub || '') + '</span></button>';
        }).join('') : '<div class="small" style="padding:14px 0">没找到。试试英文名（Nha Trang / Da Nang）</div>';
      });
    }

    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 180); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.sres'); if (!b) return;
      close();
      var place = { name: b.dataset.name, short: b.dataset.name, lat: +b.dataset.lat, lon: +b.dataset.lon, source: 'manual' };
      if (opts.onPick) opts.onPick(place);
      else location.href = 'city.html?c=' + encodeURIComponent(place.name) + '&lat=' + place.lat + '&lon=' + place.lon;
    });
    btn.addEventListener('click', open);
    panel.addEventListener('click', function (e) {
      if (e.target === panel || e.target.classList.contains('sp-back')) close();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
      if (e.key === 'Escape' && !panel.hidden) close();
    });
    ['locateBtn', 'spLocate'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b && opts.onLocate) b.addEventListener('click', function () { close(); opts.onLocate(); });
    });
    // 预热数据集
    loadCNPts(); loadWorldCities();
  }


  /* ---------------- 快照（首屏秒开 / 429 降级） ---------------- */
  var _snap = null, _snapAt = 0;
  function loadSnapshots() {
    if (_snap && Date.now() - _snapAt < 10 * 60 * 1000) return Promise.resolve(_snap);
    return fetch('../data/snapshots.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _snap = j; _snapAt = Date.now(); return j; })
      .catch(function () { _snap = { cities: {} }; return _snap; });
  }
  // 快照匹配：优先同名同纬，其次按坐标最近（≤0.08° ≈ 9km），不再强求名字一致
  function snapshotFor(name, lat, lon) {
    return loadSnapshots().then(function (j) {
      var c = j.cities || {};
      // 没有合法经度就宁可不用快照，也不要把别的城市安到当前位置上
      if (!isFinite(lon) || !isFinite(lat)) return null;
      var k = name + '|' + Number(lat).toFixed(2) + '|' + Number(lon).toFixed(2);
      if (c[k]) return { row: c[k], computedAt: j.computedAt };
      var best = null;
      Object.keys(c).forEach(function (key) {
        var parts = key.split('|');
        var dLat = Math.abs(parseFloat(parts[1]) - Number(lat));
        var dLon = parts[2] == null ? 0 : Math.abs(parseFloat(parts[2]) - Number(lon));
        if (dLat > 0.08 || dLon > 0.08) return;
        var d = dLat + dLon;
        if (parts[0] === name) d -= 0.05;          // 同名优先
        if (!best || d < best.d) best = { d: d, row: c[key] };
      });
      return best ? { row: best.row, computedAt: j.computedAt } : null;
    });
  }
  function stamp(epoch) {
    var d = new Date(epoch);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* 页面级提示条（限流 / 快照） */
  function notice(text, kind) {
    var el = document.getElementById('glowNotice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'glowNotice';
      el.className = 'glow-notice';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.className = 'glow-notice show' + (kind ? ' ' + kind : '');
  }
  function clearNotice() {
    var el = document.getElementById('glowNotice');
    if (el) el.className = 'glow-notice';
  }

  return {
    A: A, API: API, GRADE: GRADE, SENT: SENT, WD: WD,
    band: band, lvColor: lvColor, pad: pad,
    fmtTime: fmtTime, fmtDate: fmtDate, weekday: weekday,
    solarElev: solarElev,
    initSky: initSky, setSky: setSky, skySrc: skySrc,
    reveal: reveal, masthead: masthead, tabbar: tabbar, cityHref: cityHref,
    initSearch: initSearch, searchAll: searchAll,
    snapshotFor: snapshotFor, loadSnapshots: loadSnapshots, notice: notice, clearNotice: clearNotice, stamp: stamp
  };
})();
