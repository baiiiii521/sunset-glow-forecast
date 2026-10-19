/* ============================================================
 * 全球朝霞晚霞预测 · 界面层
 * 结论优先：先给一句话结论 + 行动建议，技术细节默认折叠。
 * 动态天空画布：评分驱动配色，尊重 prefers-reduced-motion。
 * ============================================================ */
(function () {
  'use strict';
  var A = window.SunsetAlgo;
  var API = window.SunsetAPI;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 结论映射 ---------------- */

  var BOUNDS = [35, 55, 75];

  function verdictOf(ev) {
    var score = ev.rawScore !== undefined ? ev.rawScore : ev.score;
    var nearest = BOUNDS[0], nd = Infinity;
    BOUNDS.forEach(function (b) {
      var d = Math.abs(score - b);
      if (d < nd) { nd = d; nearest = b; }
    });
    var dir = score < nearest ? 'up' : (score > nearest ? 'down' : 'flat');
    var title, action;
    if (ev.grade === '大烧') { title = '有大烧'; action = '值得专门去看'; }
    else if (ev.grade === '中烧') {
      title = '有·中烧';
      action = (ev.conf === '高') ? '值得专门去看'
        : (dir === 'up' ? '值得去看，可能比这更好' : '顺便看看就行，可能比这更差');
    } else if (ev.grade === '小烧') {
      title = '有一点·小烧';
      action = (dir === 'up') ? '顺便看看就行，可能比这更好' : '顺便看看就行，别专门跑一趟';
    } else { title = '基本没有'; action = '不用等了'; }
    var confText;
    if (ev.conf === '高') confText = '把握较大';
    else if (ev.conf === '中') confText = '把握一般，' + (dir === 'up' ? '可能比这更好' : dir === 'down' ? '可能比这更差' : '在分级边界附近');
    else confText = '把握不大，' + (dir === 'up' ? '可能比这更好' : dir === 'down' ? '可能比这更差' : '在分级边界附近');
    var mainReason = (ev.comps && ev.comps.precip && ev.comps.precip[0] === 0)
      ? '霞时刻有降水，基本看不到'
      : ((ev.reasons && ev.reasons[0]) || '');
    return { title: title, action: action, confText: confText, mainReason: mainReason, dir: dir };
  }

  var EVENT_LABEL = {
    'today|sunrise': '今日朝霞', 'today|sunset': '今晚晚霞',
    'tomorrow|sunrise': '明日朝霞', 'tomorrow|sunset': '明日晚霞'
  };
  var EVENT_ICON = { sunrise: '🌅', sunset: '🌇' };

  /* ---------------- 状态 ---------------- */

  var state = {
    place: { name: '胡志明市', admin1: '', admin2: '', country: '越南', lat: 10.8231, lon: 106.6297, timezone: 'Asia/Ho_Chi_Minh' },
    data: null,
    loading: false,
    rankings: null,
    rankingsTab: 'global'
  };

  var LS_FAV = 'sg_favorites_v1';
  var LS_LAST = 'sg_last_place_v1';
  var LS_RANK = 'sg_rankings_v1';
  var RANK_TTL = 30 * 60 * 1000;

  function loadJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  /* ---------------- 动态天空画布 ---------------- */

  var sky = {
    canvas: null, ctx: null, target: 30, shown: 30,
    stars: [], clouds: [], dust: [], meteors: [], nextMeteor: 0,
    last: 0, running: false
  };

  // 配色关键帧：[分数, 顶部色, 地平线色, 太阳色, 光晕强度, 星星透明度]
  var PALETTE = [
    [0, [11, 16, 38], [30, 42, 82], [245, 217, 160], 0.15, 1.0],
    [35, [20, 26, 61], [61, 42, 94], [255, 210, 138], 0.25, 0.7],
    [55, [43, 26, 77], [138, 47, 77], [255, 179, 71], 0.45, 0.4],
    [75, [61, 20, 80], [194, 65, 12], [255, 140, 26], 0.7, 0.15],
    [100, [42, 10, 46], [220, 38, 38], [255, 210, 63], 0.9, 0.05]
  ];

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function paletteAt(score) {
    var s = Math.max(0, Math.min(100, score));
    var i = 0;
    while (i < PALETTE.length - 2 && s > PALETTE[i + 1][0]) i++;
    var p0 = PALETTE[i], p1 = PALETTE[i + 1];
    var t = (s - p0[0]) / (p1[0] - p0[0] || 1);
    return {
      top: mix(p0[1], p1[1], t), horizon: mix(p0[2], p1[2], t),
      sun: mix(p0[3], p1[3], t), glow: p0[4] + (p1[4] - p0[4]) * t,
      starAlpha: p0[5] + (p1[5] - p0[5]) * t
    };
  }

  function rgb(c, a) {
    return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? 1 : a) + ')';
  }

  function initSky() {
    sky.canvas = $('#sky');
    if (!sky.canvas) return;
    sky.ctx = sky.canvas.getContext('2d');
    resizeSky();
    window.addEventListener('resize', resizeSky);
    for (var i = 0; i < 90; i++) {
      sky.stars.push({ x: Math.random(), y: Math.random() * 0.6, r: 0.5 + Math.random() * 1.3, ph: Math.random() * Math.PI * 2 });
    }
    for (var c = 0; c < 6; c++) {
      sky.clouds.push({
        x: Math.random(), y: 0.45 + Math.random() * 0.3,
        r: 0.14 + Math.random() * 0.22, speed: 0.000012 + Math.random() * 0.000012,
        a: 0.10 + Math.random() * 0.10
      });
    }
    for (var d = 0; d < 26; d++) {
      sky.dust.push({
        x: Math.random(), y: 0.55 + Math.random() * 0.45,
        vy: 0.000008 + Math.random() * 0.000012, vx: (Math.random() - 0.5) * 0.00001,
        r: 0.8 + Math.random() * 1.8, ph: Math.random() * Math.PI * 2
      });
    }
    sky.nextMeteor = performance.now() + 4000;
    sky.last = performance.now();
    if (REDUCED) { drawSky(0); return; }
    sky.running = true;
    requestAnimationFrame(tickSky);
  }

  function resizeSky() {
    if (!sky.canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sky.canvas.width = window.innerWidth * dpr;
    sky.canvas.height = window.innerHeight * dpr;
    sky.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function tickSky(now) {
    if (!sky.running) return;
    var dt = Math.min(now - sky.last, 100);
    sky.last = now;
    sky.shown += (sky.target - sky.shown) * Math.min(1, dt / 600);
    drawSky(now, dt);
    requestAnimationFrame(tickSky);
  }

  function drawSky(now, dt) {
    var ctx = sky.ctx, W = window.innerWidth, H = window.innerHeight;
    var t = now || 0;
    var pal = paletteAt(sky.shown);
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgb(pal.top));
    grad.addColorStop(1, rgb(pal.horizon));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    var sunX = W * 0.5, sunY = H * 0.72;
    var sunR = Math.min(W, H) * 0.085;

    // 星星（闪烁加快）
    ctx.fillStyle = '#fff';
    sky.stars.forEach(function (s) {
      var a = pal.starAlpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.004 + s.ph)));
      ctx.globalAlpha = Math.max(0, a);
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 太阳光芒：持续旋转，低分也可见（最低透明度 0.05）
    var rayAlpha = 0.05 + pal.glow * 0.10;
    ctx.save();
    ctx.translate(sunX, sunY);
    ctx.rotate(t * 0.0001);
    ctx.strokeStyle = rgb(pal.sun, rayAlpha);
    ctx.lineWidth = 1.2;
    for (var i = 0; i < 12; i++) {
      var ang = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * sunR * 1.3, Math.sin(ang) * sunR * 1.3);
      ctx.lineTo(Math.cos(ang) * sunR * 3.2, Math.sin(ang) * sunR * 3.2);
      ctx.stroke();
    }
    ctx.restore();

    // 太阳 + 约 7 秒呼吸光晕
    var breathe = 1 + 0.07 * Math.sin(t * 2 * Math.PI / 7000);
    var glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 4.2 * breathe);
    glow.addColorStop(0, rgb(pal.sun, 0.55 * pal.glow + 0.2));
    glow.addColorStop(1, rgb(pal.sun, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 4.2 * breathe, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(pal.sun);
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * breathe, 0, Math.PI * 2);
    ctx.fill();

    // 地平线光晕
    var hg = ctx.createRadialGradient(sunX, H * 0.86, 0, sunX, H * 0.86, W * 0.45 * breathe);
    hg.addColorStop(0, rgb(pal.horizon, 0.5));
    hg.addColorStop(1, rgb(pal.horizon, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, H * 0.5, W, H * 0.5);

    // 云层漂移：几十秒横穿天空
    if (dt) sky.clouds.forEach(function (c) { c.x += c.speed * dt; if (c.x - c.r > 1.05) c.x = -c.r; });
    sky.clouds.forEach(function (c) {
      var cg = ctx.createRadialGradient(c.x * W, c.y * H, 0, c.x * W, c.y * H, c.r * W);
      cg.addColorStop(0, rgb(pal.horizon, c.a + 0.08));
      cg.addColorStop(1, rgb(pal.horizon, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(c.x * W, c.y * H, c.r * W, c.r * W * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // 光尘粒子：26 颗上升，大烧时变金色火星
    var dustColor = sky.shown >= 75 ? [251, 191, 36] : [255, 233, 196];
    sky.dust.forEach(function (p) {
      if (dt) {
        p.y -= p.vy * dt;
        p.x += p.vx * dt;
        if (p.y < 0.25) { p.y = 0.9 + Math.random() * 0.1; p.x = Math.random(); }
      }
      var a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.002 + p.ph));
      ctx.fillStyle = rgb(dustColor, a);
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // 流星：约每 6 秒一道
    if (dt && t > sky.nextMeteor) {
      sky.meteors.push({
        x: 0.15 + Math.random() * 0.7, y: 0.05 + Math.random() * 0.25,
        vx: 0.0011 + Math.random() * 0.0006, vy: 0.0005 + Math.random() * 0.0003,
        life: 1
      });
      sky.nextMeteor = t + 4000 + Math.random() * 4000;
    }
    sky.meteors = sky.meteors.filter(function (m) { return m.life > 0; });
    sky.meteors.forEach(function (m) {
      if (dt) { m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt / 900; }
      var tail = 0.09;
      var g2 = ctx.createLinearGradient(m.x * W, m.y * H, (m.x - m.vx * 300 * tail) * W, (m.y - m.vy * 300 * tail) * H);
      g2.addColorStop(0, 'rgba(255,255,255,' + Math.max(0, m.life * 0.9) + ')');
      g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g2;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(m.x * W, m.y * H);
      ctx.lineTo((m.x - m.vx * 300 * tail) * W, (m.y - m.vy * 300 * tail) * H);
      ctx.stroke();
    });
  }

  /* ---------------- 评分数字滚动计数 ---------------- */

  function animateNumber(el, target) {
    if (REDUCED) { el.textContent = target; return; }
    var start = performance.now(), dur = 800;
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------- 渲染 ---------------- */

  var COMP_LABELS = {
    curtain: ['中高云幕布', 30], low: ['低云', 20], gap: ['太阳方向晴空缺口', 20],
    precip: ['霞时刻降水', 10], aod: ['气溶胶光学厚度', 5], vis: ['能见度', 3],
    pm: ['PM2.5', 3], dew: ['露点差', 2], wind: ['风速', 2], cape: ['对流 CAPE', 2]
  };

  function gradeClass(g) {
    return { '大烧': 'g-big', '中烧': 'g-mid', '小烧': 'g-small', '无烧': 'g-none' }[g] || '';
  }

  function fmtInput(v, suffix) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '无数据';
    return (typeof v === 'number' ? (Math.round(v * 10) / 10) : v) + (suffix || '');
  }

  function detailHTML(ev) {
    var rows = '';
    Object.keys(COMP_LABELS).forEach(function (key) {
      var comp = ev.comps[key];
      if (!comp) return;
      var score = comp[0], label = comp[1];
      var bar = (score === null || score === undefined)
        ? '<span class="detail-missing">无数据，已排除</span>'
        : '<span class="scorebar"><span style="width:' + Math.max(0, Math.min(100, score)) + '%"></span></span>' +
          '<span class="detail-score">' + Math.round(score) + '</span>';
      rows += '<div class="detail-row"><span class="detail-name">' + COMP_LABELS[key][0] +
        '（权重 ' + COMP_LABELS[key][1] + '）</span>' + bar +
        '<span class="detail-label">' + esc(label) + '</span></div>';
    });
    var washed = ev.comps.washed;
    rows += '<div class="detail-row"><span class="detail-name">雨后洗净（加成 0–3 分）</span>' +
      '<span class="detail-score">+' + (washed[0] ? (washed[0] * 0.03).toFixed(1) : '0.0') + '</span>' +
      '<span class="detail-label">' + esc(washed[1]) + '</span></div>';
    var inp = ev.inputs || {};
    var raw = [
      ['中云', fmtInput(inp.mid, '%')], ['高云', fmtInput(inp.high, '%')], ['低云', fmtInput(inp.low, '%')],
      ['霞时刻降水', fmtInput(inp.precip, ' mm')], ['降水概率', fmtInput(inp.prob, '%')],
      ['能见度', fmtInput(inp.visKm, ' km')], ['AOD（550nm）', inp.aod === null || inp.aod === undefined ? '无数据' : inp.aod.toFixed(2)],
      ['PM2.5', fmtInput(inp.pm, ' µg/m³')], ['露点差', fmtInput(inp.dewSpread, ' °C')],
      ['风速', fmtInput(inp.windSpeed, ' km/h')], ['风向', fmtInput(inp.windDir, '°')],
      ['CAPE', fmtInput(inp.cape, ' J/kg')],
      ['上游低云均值', fmtInput(inp.upLowAvg, '%')], ['上游总云均值', fmtInput(inp.upTotalAvg, '%')],
      ['霞前 3 小时降水', fmtInput(inp.pre3, ' mm')]
    ];
    var rawHTML = raw.map(function (r) {
      return '<div class="raw-item"><span>' + r[0] + '</span><b>' + esc(String(r[1])) + '</b></div>';
    }).join('');
    return '<div class="detail-rows">' + rows + '</div>' +
      '<div class="detail-sub">原始输入数据</div>' +
      '<div class="raw-grid">' + rawHTML + '</div>';
  }

  function eventCardHTML(ev, offsetSec) {
    var key = ev.day + '|' + ev.type;
    var label = EVENT_LABEL[key] || '';
    var icon = EVENT_ICON[ev.type] || '';
    var v = verdictOf(ev);
    var past = ev.epoch < Date.now();
    var timeStr = API.fmtTime(ev.epoch, offsetSec);
    var dateStr = API.fmtDate(ev.epoch, offsetSec);
    var win = API.viewingWindow(ev.epoch, ev.type === 'sunset', offsetSec);
    return '<article class="event-card reveal" id="ev-' + key + '">' +
      '<div class="ev-head"><span class="ev-icon">' + icon + '</span>' +
      '<div><h3>' + label + (past ? ' <span class="past-tag">已过去</span>' : '') + '</h3>' +
      '<p>' + esc(dateStr) + ' ' + timeStr + ' · 最佳观测窗 ' + esc(win) + '</p></div>' +
      '<span class="grade-badge ' + gradeClass(ev.grade) + '">' + esc(ev.grade) + ' ' + esc(ev.gradeEmoji) + '</span></div>' +
      '<div class="ev-verdict"><div class="ev-title">' + esc(v.title) + '</div>' +
      '<div class="ev-action">' + esc(v.action) + '</div>' +
      '<div class="ev-reason">' + esc(v.mainReason) + '</div>' +
      '<div class="ev-conf">' + esc(v.confText) + '</div></div>' +
      '<div class="ev-score"><span class="score-num" data-score="' + ev.score + '">0</span><span class="score-max">/100</span>' +
      '<span class="ev-meta">置信度 ' + esc(ev.conf) + ' · ' + esc(ev.script) + '</span></div>' +
      '<button class="why-btn" type="button">为什么这样判断？ <span class="why-arrow">▾</span></button>' +
      '<div class="ev-detail" hidden>' + detailHTML(ev) + '</div>' +
      '</article>';
  }

  function renderPlace() {
    var p = state.place, data = state.data;
    $('#cityName').textContent = p.name;
    $('#placeMeta').textContent = [p.admin1, p.country].filter(Boolean).join(' · ') +
      ' · ' + p.lat.toFixed(2) + '°, ' + p.lon.toFixed(2) + '°' +
      (data ? ' · ' + esc(data.tzName) : '');
    $('#favBtn').textContent = isFav(p) ? '★ 已收藏' : '☆ 收藏此地';
    if (!data) return;
    $('#fetchTime').textContent = '数据拉取于 ' + new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false });
    var now = Date.now();
    var next = null;
    data.events.forEach(function (ev) { if (!next && ev.epoch > now) next = ev; });
    if (!next) next = data.events[data.events.length - 1];
    var v = verdictOf(next);
    $('#heroKicker').textContent = '下一场 · ' + EVENT_LABEL[next.day + '|' + next.type] + ' ' + API.fmtTime(next.epoch, data.offsetSec);
    $('#heroTitle').textContent = v.title;
    $('#heroAction').textContent = v.action;
    $('#heroReason').textContent = v.mainReason;
    $('#heroConf').textContent = v.confText + ' · 评分 ' + next.score + '/100 · ' + next.script;
    $('#heroWindow').textContent = '最佳观测窗 ' + API.viewingWindow(next.epoch, next.type === 'sunset', data.offsetSec);
    sky.target = next.score;
    // 四场速览
    $('#quickView').innerHTML = data.events.map(function (ev) {
      var past = ev.epoch < now;
      return '<button class="quick-chip ' + (past ? 'past' : '') + '" data-ev="' + ev.day + '|' + ev.type + '" type="button">' +
        '<span class="qc-label">' + EVENT_LABEL[ev.day + '|' + ev.type] + (past ? '（已过去）' : '') + '</span>' +
        '<span class="qc-time">' + API.fmtTime(ev.epoch, data.offsetSec) + '</span>' +
        '<span class="qc-grade ' + gradeClass(ev.grade) + '">' + esc(ev.grade) + ' ' + ev.score + '分</span></button>';
    }).join('');
    // 四场卡片
    $('#events').innerHTML = data.events.map(function (ev) { return eventCardHTML(ev, data.offsetSec); }).join('');
    $$('.event-card .score-num', $('#events')).forEach(function (el) {
      animateNumber(el, parseInt(el.getAttribute('data-score'), 10) || 0);
    });
    $$('.event-card .why-btn', $('#events')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var detail = btn.parentElement.querySelector('.ev-detail');
        var open = !detail.hidden;
        detail.hidden = open;
        btn.querySelector('.why-arrow').textContent = open ? '▾' : '▴';
        btn.firstChild.textContent = open ? '为什么这样判断？ ' : '收起明细 ';
      });
    });
    $$('.quick-chip', $('#quickView')).forEach(function (chip) {
      chip.addEventListener('click', function () {
        var el = document.getElementById('ev-' + chip.getAttribute('data-ev'));
        if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      });
    });
    // 入场动画重播
    var hero = $('#heroSection');
    hero.classList.remove('enter');
    void hero.offsetWidth;
    hero.classList.add('enter');
    observeReveals();
  }

  /* ---------------- 搜索 ---------------- */

  var searchTimer = null;
  var searchSeq = 0;

  function renderCandidates(list, status) {
    var box = $('#searchResults');
    if (status) {
      box.innerHTML = '<div class="cand-status">' + esc(status) + '</div>';
      box.hidden = false;
      return;
    }
    if (!list || !list.length) { box.hidden = true; return; }
    box.innerHTML = list.map(function (p, idx) {
      var sub = [p.admin1, p.admin2 && p.admin2 !== p.name ? p.admin2 : '', p.country].filter(Boolean).join(' · ');
      return '<button class="cand" data-idx="' + idx + '" type="button">' +
        '<span class="cand-name">' + esc(p.name) + '</span>' +
        '<span class="cand-sub">' + esc(sub) + '</span>' +
        '<span class="cand-coord">' + p.lat.toFixed(2) + '°, ' + p.lon.toFixed(2) + '°</span></button>';
    }).join('');
    box.hidden = false;
    $$('.cand', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = list[parseInt(btn.getAttribute('data-idx'), 10)];
        box.hidden = true;
        $('#searchInput').value = p.name;
        $('#searchInput').blur();
        setPlace({ name: p.name, admin1: p.admin1, admin2: p.admin2, country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone || '' });
      });
    });
  }

  function doSearch() {
    var q = $('#searchInput').value.trim();
    if (!q) { $('#searchResults').hidden = true; return; }
    var seq = ++searchSeq;
    renderCandidates(null, '正在搜索…');
    API.searchPlaces(q).then(function (list) {
      if (seq !== searchSeq) return;
      if (!list.length) renderCandidates(null, '未找到该地点，请换个名字试试');
      else renderCandidates(list, null);
    }).catch(function (e) {
      if (seq !== searchSeq) return;
      renderCandidates(null, '搜索失败：' + (e && e.message || '请检查网络'));
    });
  }

  /* ---------------- 收藏 ---------------- */

  function getFavs() { return loadJSON(LS_FAV, []); }

  function isFav(p) {
    return getFavs().some(function (f) {
      return Math.abs(f.lat - p.lat) < 0.01 && Math.abs(f.lon - p.lon) < 0.01;
    });
  }

  function renderFavs() {
    var favs = getFavs();
    $('#favBar').innerHTML = favs.map(function (f, idx) {
      return '<span class="fav-chip"><button class="fav-go" data-idx="' + idx + '" type="button">' + esc(f.name) + '</button>' +
        '<button class="fav-del" data-idx="' + idx + '" type="button" title="取消收藏">×</button></span>';
    }).join('') || '<span class="fav-empty">暂无收藏</span>';
    $$('.fav-go', $('#favBar')).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = favs[parseInt(b.getAttribute('data-idx'), 10)];
        if (f) setPlace(f);
      });
    });
    $$('.fav-del', $('#favBar')).forEach(function (b) {
      b.addEventListener('click', function () {
        var favs2 = getFavs();
        favs2.splice(parseInt(b.getAttribute('data-idx'), 10), 1);
        saveJSON(LS_FAV, favs2);
        renderFavs();
        $('#favBtn').textContent = isFav(state.place) ? '★ 已收藏' : '☆ 收藏此地';
      });
    });
  }

  function toggleFav() {
    var favs = getFavs();
    var idx = -1;
    favs.forEach(function (f, i) {
      if (Math.abs(f.lat - state.place.lat) < 0.01 && Math.abs(f.lon - state.place.lon) < 0.01) idx = i;
    });
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push({
      name: state.place.name, admin1: state.place.admin1, country: state.place.country,
      lat: state.place.lat, lon: state.place.lon, timezone: state.place.timezone || ''
    });
    saveJSON(LS_FAV, favs);
    renderFavs();
    $('#favBtn').textContent = idx >= 0 ? '☆ 收藏此地' : '★ 已收藏';
  }

  /* ---------------- 榜单 ---------------- */

  function boardRowHTML(r, rank) {
    var c = r.city;
    return '<tr class="board-row" data-lat="' + c.lat + '" data-lon="' + c.lon +
      '" data-name="' + esc(c.name) + '" data-country="' + esc(c.country) + '">' +
      '<td class="board-rank">' + rank + '</td>' +
      '<td class="board-city">' + esc(c.name) + '<span>' + esc(c.country) + '</span></td>' +
      '<td>' + API.fmtTime(r.epoch, r.offsetSec || 0) + '</td>' +
      '<td><span class="grade-badge ' + gradeClass(r.grade) + '">' + esc(r.grade) + '</span></td>' +
      '<td><span class="board-score">' + r.score + '</span><span class="scorebar"><span style="width:' + r.score + '%"></span></span></td>' +
      '<td>置信度 ' + esc(r.conf) + '</td></tr>';
  }

  function renderBoard() {
    var data = state.rankings;
    if (!data) return;
    var list = state.rankingsTab === 'global' ? data.global : data.china;
    $('#boardBody').innerHTML = list.map(function (r, i) { return boardRowHTML(r, i + 1); }).join('') ||
      '<tr><td colspan="6">暂无数据</td></tr>';
    $$('.board-row', $('#boardBody')).forEach(function (tr) {
      tr.addEventListener('click', function () {
        setPlace({
          name: tr.getAttribute('data-name'), admin1: '', admin2: '',
          country: tr.getAttribute('data-country'),
          lat: parseFloat(tr.getAttribute('data-lat')), lon: parseFloat(tr.getAttribute('data-lon')),
          timezone: ''
        });
        document.getElementById('top').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
      });
    });
    // 跑马灯：双榜前 3
    var items = [];
    data.global.slice(0, 3).forEach(function (r) { items.push('全球TOP ' + r.city.name + ' ' + r.score + '分 ' + r.grade); });
    data.china.slice(0, 3).forEach(function (r) { items.push('中国TOP ' + r.city.name + ' ' + r.score + '分 ' + r.grade); });
    var ticker = items.join('　·　') + '　·　';
    $('#tickerInner').textContent = ticker + ticker;
    $('#ticker').hidden = false;
    $('#boardNote').textContent = '榜单计算于 ' + new Date(data.computedAt).toLocaleTimeString('zh-CN', { hour12: false }) + '，30 分钟缓存';
  }

  function loadBoard() {
    var cached = loadJSON(LS_RANK, null);
    if (cached && Date.now() - cached.computedAt < RANK_TTL && cached.global && cached.china) {
      state.rankings = cached;
      renderBoard();
      return;
    }
    var btn = $('#boardLoadBtn');
    btn.disabled = true;
    btn.textContent = '正在计算榜单（70 城）… 0%';
    API.loadRankings(function (done, total) {
      btn.textContent = '正在计算榜单（70 城）… ' + Math.round(done / total * 100) + '%';
    }).then(function (data) {
      state.rankings = data;
      saveJSON(LS_RANK, data);
      btn.disabled = false;
      btn.textContent = '重新计算榜单';
      renderBoard();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '加载榜单';
      $('#boardNote').textContent = '榜单加载失败：' + (e && e.message || '请检查网络');
    });
  }

  /* ---------------- 地点切换 ---------------- */

  function setPlace(place) {
    state.place = place;
    state.data = null;
    state.loading = true;
    saveJSON(LS_LAST, place);
    $('#cityName').textContent = place.name;
    $('#heroTitle').textContent = '正在拉取预报…';
    $('#heroAction').textContent = '';
    $('#heroReason').textContent = '';
    $('#heroConf').textContent = '';
    $('#heroKicker').textContent = '正在查询';
    $('#heroWindow').textContent = '';
    $('#events').innerHTML = '';
    $('#quickView').innerHTML = '';
    $('#placeMeta').textContent = [place.admin1, place.country].filter(Boolean).join(' · ') +
      ' · ' + place.lat.toFixed(2) + '°, ' + place.lon.toFixed(2) + '°';
    $('#favBtn').textContent = isFav(place) ? '★ 已收藏' : '☆ 收藏此地';
    $('#loadError').hidden = true;
    API.evaluatePlace(place.lat, place.lon).then(function (data) {
      state.data = data;
      state.loading = false;
      renderPlace();
    }).catch(function (e) {
      state.loading = false;
      $('#heroTitle').textContent = '预报暂时不可用';
      $('#heroAction').textContent = '';
      $('#heroReason').textContent = '拉取预报失败：' + (e && e.message || '请检查网络');
      $('#heroConf').textContent = '未编造任何数据';
      $('#loadError').hidden = false;
      $('#loadError').textContent = '预报拉取失败：' + (e && e.message || '请检查网络') + '。请稍后重试。';
    });
  }

  /* ---------------- 滚动显现 ---------------- */

  var revealObserver = null;
  function observeReveals() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach(function (el) { el.classList.add('visible'); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('visible'); revealObserver.unobserve(en.target); }
        });
      }, { threshold: 0.08 });
    }
    $$('.reveal:not(.visible)').forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    initSky();
    renderFavs();
    var saved = loadJSON(LS_LAST, null);
    if (saved && saved.name && typeof saved.lat === 'number') state.place = saved;
    $('#searchInput').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 300);
    });
    $('#searchInput').addEventListener('focus', function () {
      if ($('#searchInput').value.trim()) doSearch();
    });
    $('#searchBtn').addEventListener('click', doSearch);
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.search')) $('#searchResults').hidden = true;
    });
    $('#favBtn').addEventListener('click', toggleFav);
    $('#boardLoadBtn').addEventListener('click', loadBoard);
    $('#boardTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tab]');
      if (!btn) return;
      state.rankingsTab = btn.getAttribute('data-tab');
      $$('#boardTabs .tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      renderBoard();
    });
    observeReveals();
    setPlace(state.place);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
