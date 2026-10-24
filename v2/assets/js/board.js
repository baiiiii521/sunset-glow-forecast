/* ============================================================
   GLOW v2 · board.js — P03 霞榜
   全球图：等距圆柱（1440×720，1°=4px）
   中国图：墨卡托 + 南海诸岛附图 + 九段线（scripts/build-china-map.py 生成）
   ============================================================ */
(function () {
  'use strict';
  var G = window.GLOW;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = { data: null, scope: 'global', points: null, cn: null };
  var gcolor = function (l) { return 'var(--lv' + l + ')'; };

  /* ---------- 投影 ---------- */
  function mercY(lat) {
    lat = Math.max(-85, Math.min(85, lat));
    return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  }
  function worldPt(lat, lon) { return { x: (lon + 180) * 4, y: (90 - lat) * 4 }; }
  function chinaPt(lat, lon) {
    var c = state.cn;
    if (!c) return worldPt(lat, lon);
    var m = c.main;
    var inMain = lat >= m.lat0 && lat <= m.lat1 && lon >= m.lon0 && lon <= m.lon1;
    var p = inMain ? m : c.inset;
    return {
      x: (lon - p.lon0) * p.k + p.dx,
      y: (mercY(p.lat1) - mercY(lat)) * p.k + p.dy,
      inset: !inMain
    };
  }
  function projPt(lat, lon) { return state.scope === 'china' ? chinaPt(lat, lon) : worldPt(lat, lon); }
  function activeSvg() { return state.scope === 'china' ? $('#chinaSvg') : $('#worldSvg'); }

  function cityHref(c) {
    return 'city.html?c=' + encodeURIComponent(c.name) + '&lat=' + c.lat + '&lon=' + c.lon;
  }

  /* ---------- 地图装载 ---------- */
  function inject(svgEl, txt) {
    var inner = txt.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    svgEl.innerHTML = '<g class="land">' + inner + '</g><g class="dots"></g>';
  }
  function fetchSvg(url) { return fetch(url).then(function (r) { return r.text(); }); }

  function loadMaps() {
    return Promise.all([
      fetchSvg('assets/img/world.svg'),
      fetchSvg('assets/img/china.svg'),
      fetch('assets/img/china.json').then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (a) {
      inject($('#worldSvg'), a[0]);
      inject($('#chinaSvg'), a[1]);
      state.cn = a[2];
      $('#chinaSvg').setAttribute('viewBox', a[2] ? ('0 0 ' + a[2].width + ' ' + a[2].height) : '0 0 1000 938');
    }).catch(function (e) { console.error('map load', e); });
  }

  function setScope(scope) {
    state.scope = scope;
    var w = $('#worldSvg'), c = $('#chinaSvg');
    // SVG 元素没有 hidden IDL 属性，必须操作 attribute
    var show = function (el, on) {
      if (!el) return;
      if (on) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    };
    show(w, scope === 'global');
    show(c, scope === 'china');
    drawDots();
  }

  /* ---------- 点位 ---------- */
  function drawDots() {
    var d = state.data; if (!d) return;
    var svg = activeSvg(); if (!svg) return;
    var g = svg.querySelector('.dots'); if (!g) return;
    var list = d[state.scope] || [];
    var others = (state.scope === 'global' ? (d.china || []) : (d.global || []));

    var html = '';
    others.forEach(function (c) {
      var p = projPt(c.city.lat, c.city.lon);
      if (p.inset) return;
      html += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (state.scope === 'china' ? 2.2 : 3) + '" fill="rgba(246,239,230,.20)"/>';
    });
    list.forEach(function (c, i) {
      var p = projPt(c.city.lat, c.city.lon);
      var lv = c.level != null ? c.level : G.band(c.score);
      var r = (state.scope === 'china' ? 6.5 : 5.5) + (c.score / 100) * 4;
      var showLabel = state.scope === 'china' || i < 6;
      html += '<g class="dot" data-i="' + i + '" tabindex="0" role="button" aria-label="' + c.city.name + ' ' + c.score + ' 分">' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (r * 2.1).toFixed(1) + '" fill="' + gcolor(lv) + '" opacity=".12"/>' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + gcolor(lv) + '"/>' +
        (showLabel ? '<text x="' + (p.x + 11).toFixed(1) + '" y="' + (p.y + 4).toFixed(1) + '" font-size="' +
          (state.scope === 'china' ? 13 : 11) + '" font-family="JetBrains Mono" fill="#F6EFE6">' + c.city.name + '</text>' : '') +
        '</g>';
    });
    g.innerHTML = html;
    $$('.dot', g).forEach(function (el) {
      var c = list[+el.dataset.i];
      el.addEventListener('click', function () { location.href = cityHref(c.city); });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') location.href = cityHref(c.city); });
      el.addEventListener('mouseenter', function (e) {
        var tip = $('#mapTip'); if (!tip) return;
        tip.hidden = false;
        tip.innerHTML = '<b>' + c.city.name + '</b><span>' + c.score + ' 分 · ' + c.grade + '</span><span>' + (c.city.country || '') + '</span>';
        var r = $('#mapCanvas').getBoundingClientRect();
        tip.style.left = (e.clientX - r.left + 14) + 'px';
        tip.style.top = (e.clientY - r.top + 14) + 'px';
      });
      el.addEventListener('mouseleave', function () { var t = $('#mapTip'); if (t) t.hidden = true; });
    });
  }

  /* ---------- 列表 ---------- */
  function rows(list) {
    return list.map(function (c, i) {
      var lv = c.level != null ? c.level : G.band(c.score);
      var t = '';
      try { t = G.fmtTime(c.epoch, c.offsetSec); } catch (e) {}
      return '<a class="brow" href="' + cityHref(c.city) + '">' +
        '<span class="rk">' + G.pad(i + 1) + '</span>' +
        '<span class="nm">' + c.city.name + '<em>' + (c.city.country || '') + '</em></span>' +
        '<span class="tt">' + t + '</span>' +
        '<span class="sc" style="color:' + gcolor(lv) + '">' + c.score + '</span></a>';
    }).join('');
  }

  function render() {
    var d = state.data; if (!d) return;
    $('#mpTitle').textContent = 'TOP 10 · ' + (state.scope === 'global' ? '全球' : '中国');
    var when = d.computedAt ? new Date(d.computedAt) : null;
    var stale = when && (Date.now() - when.getTime() > 36 * 3600e3);
    $('#boardMeta').textContent = when ? ((stale ? '⚠ 非今日 · ' : '更新 ') + (when.getMonth() + 1) + '-' + when.getDate() + ' ' +
      G.pad(when.getHours()) + ':' + G.pad(when.getMinutes())) : '';
    $('#boardMeta').style.color = stale ? 'var(--gold)' : '';

    var bn = document.getElementById('staleBanner');
    if (bn) {
      bn.hidden = !stale;
      if (stale) bn.textContent = '这份榜单生成于 ' + (when.getMonth() + 1) + ' 月 ' + when.getDate() + ' 日，不是今天的预报——页面照实展示，不假装是今日数据。';
    }

    $('#mapList').innerHTML = rows((d[state.scope] || []).slice(0, 10));
    $('#cnList').innerHTML = rows((d.china || []).slice(0, 5));
    $('#glList').innerHTML = rows((d.global || []).slice(0, 5));

    var st = d.stats || {};
    var fmtStat = function (s) {
      if (!s || !s.counts) return '';
      var total = s.counts.reduce(function (a, b) { return a + b; }, 0);
      return total + ' 城 · ' + s.counts.slice(2).reduce(function (a, b) { return a + b; }, 0) + ' 城有霞';
    };
    $('#cnStat').textContent = fmtStat(st.china);
    $('#glStat').textContent = fmtStat(st.global);

    var maxC = 1;
    if (st[state.scope] && st[state.scope].counts) maxC = Math.max.apply(null, st[state.scope].counts) || 1;
    $('#distBox').innerHTML = G.GRADE.map(function (g, i) {
      var v = (st[state.scope] && st[state.scope].counts) ? st[state.scope].counts[i] : 0;
      return '<div class="dcol"><div class="dbar"><i style="height:' + Math.max(2, v / maxC * 100) + '%;background:' + gcolor(i) + '"></i></div>' +
        '<div class="dnum">' + v + '</div><div class="dlab">' + g + '</div></div>';
    }).join('');

    drawDots();
  }

  /* ---------- 索引区检索（复用 GLOW.searchAll：中国点 + 全球城市） ---------- */
  function bindSearch() {
    var el = $('#q2');
    var box = $('#searchResults');
    if (!el || !box) return;
    var timer, seq = 0;
    el.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = (el.value || '').trim();
        if (!q) { box.innerHTML = ''; return; }
        var my = ++seq;
        box.innerHTML = '<div class="small" style="padding:12px 0">搜索中…</div>';
        G.searchAll(q).then(function (list) {
          if (my !== seq) return;
          box.innerHTML = list.length ? list.map(function (p) {
            return '<a class="sres" href="city.html?c=' + encodeURIComponent(p.name) + '&lat=' + p.lat + '&lon=' + p.lon + '">' +
              '<b>' + p.name + '</b><span>' + (p.sub || '') + '</span></a>';
          }).join('') : '<div class="small" style="padding:14px 0">没找到。试试英文名（Nha Trang / Da Nang）</div>';
        });
      }, 200);
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    G.masthead(); G.tabbar('board'); G.reveal('.reveal-auto');
    loadMaps().then(function () { if (state.data) { setScope(state.scope); render(); } });
    fetch('../data/rankings.json', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { state.data = d; render(); })
      .catch(function (e) {
        $('#boardMeta').textContent = '榜单暂不可用';
        $('#mapList').innerHTML = '<div class="small" style="padding:20px 0">今日霞榜未生成</div>';
        console.error(e);
      });
    $$('.sw').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.sw').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
        setScope(b.dataset.scope);
        render();
      });
    });
    bindSearch();
    G.initSearch({});
  }

  boot();
})();
