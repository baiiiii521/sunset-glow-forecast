/* ============================================================
 * 霞 · 全球火烧云预报 —— 界面层
 * 天幕即界面：选中哪一场，天空、云底光照、太阳与水面就按它的评分换色。
 * 结构：01 霞历（四场）→ 02 天色时间轴 → 03 大气剖面 → 04 霞榜 → 05 原理。
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
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function setVar(el, name, val) { if (el && el.style && el.style.setProperty) el.style.setProperty(name, val); }

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- 颜色工具 ---------------- */

  function hx(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mixHex(a, b, k) {
    var A1 = hx(a), B1 = hx(b);
    return '#' + A1.map(function (v, i) {
      var s = Math.round(v + (B1[i] - v) * k).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function rgba(h, a) { var c = hx(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(2) + ')'; }
  // keys 按第一项升序：[[x, 颜色或颜色数组], …]
  function interp(keys, x) {
    if (x <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (x <= keys[i][0]) {
        var k = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
        var a = keys[i - 1][1], b = keys[i][1];
        return Array.isArray(a) ? a.map(function (c, j) { return mixHex(c, b[j], k); }) : mixHex(a, b, k);
      }
    }
    return keys[keys.length - 1][1];
  }

  /* ---------------- 结论映射 ---------------- */

  var BOUNDS = A.LEVEL_BOUNDS;

  function levelOfEv(ev) {
    return typeof ev.level === 'number' ? ev.level : A.levelOf(ev.score);
  }

  function verdictOf(ev) {
    var score = ev.rawScore !== undefined ? ev.rawScore : ev.score;
    var nearest = BOUNDS[0], nd = Infinity;
    BOUNDS.forEach(function (b) {
      var d = Math.abs(score - b);
      if (d < nd) { nd = d; nearest = b; }
    });
    var dir = score < nearest ? 'up' : (score > nearest ? 'down' : 'flat');
    var lv = levelOfEv(ev);
    var title, action;
    if (lv === 5) { title = '大烧'; action = '值得专门去看'; }
    else if (lv === 4) {
      title = '中到大烧';
      action = (ev.conf === '高') ? '值得专门去看'
        : (dir === 'up' ? '值得去看，可能比这更好' : '值得去看，但各家预报有分歧');
    } else if (lv === 3) {
      title = '小到中烧';
      action = (dir === 'up') ? '有空就去看，可能比这更好' : '顺便看看就行';
    } else if (lv === 2) {
      title = '有一点·小烧';
      action = '顺便看看就行，别专门跑一趟';
    } else if (lv === 1) {
      title = '微烧';
      action = '云边可能泛点淡色，不必等';
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
  var DAY_LABEL = { today: '今天', tomorrow: '明天' };

  function dirName(b) {
    var names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return names[Math.round(((b % 360) + 360) % 360 / 45) % 8] + ' ' + Math.round(b) + '°';
  }

  /* ---------------- 评分 → 天幕配色 ----------------
   * near/mid/far/deep：云底从靠近太阳到远处的颜色；light：从地平线下照亮云底的光色；
   * covHi/covLo：云量阈值（越接近 0 云越密）。无烧时是厚重的灰云。 */
  function palette(score) {
    var lv = A.levelOf(score);
    if (lv >= 4) return { bg: 'linear-gradient(180deg, #1A0C38 0%, #3C1450 30%, #8A2048 55%, #E0482A 80%, #FFB25A 100%)', core: '#FF9A3A', glow: 'rgba(255,110,40,.85)', near: '#FFE09A', mid: '#FF5A22', far: '#7A1A58', deep: '#3A1240', light: '#FFB070', covHi: -1.75, covLo: -2.35, ray: 'rgba(255,190,120,.22)', rayOp: 1, water: 'linear-gradient(180deg, #8A2E30 0%, #3A1430 45%, #0B0918 100%)', tile: 'linear-gradient(160deg, #5B1250 0%, #C42A3A 55%, #FF6A2C 100%)' };
    if (lv === 3) return { bg: 'linear-gradient(180deg, #161440 0%, #33285E 32%, #7A3E68 58%, #D06A5A 82%, #F4B888 100%)', core: '#FFB060', glow: 'rgba(255,150,90,.65)', near: '#FFD2A0', mid: '#E2685E', far: '#4A2A6E', deep: '#28204A', light: '#FFC4A0', covHi: -1.6, covLo: -2.3, ray: 'rgba(255,200,150,.16)', rayOp: 0.8, water: 'linear-gradient(180deg, #6A3248 0%, #2A1838 45%, #0B0918 100%)', tile: 'linear-gradient(160deg, #4A2A6E 0%, #A84A6A 60%, #E8805A 100%)' };
    if (lv === 2) return { bg: 'linear-gradient(180deg, #121836 0%, #2A3560 38%, #5E5E80 64%, #A88E8E 86%, #DCC0A4 100%)', core: '#F4CFA4', glow: 'rgba(240,200,160,.45)', near: '#F0D6BC', mid: '#A88496', far: '#33395E', deep: '#20243E', light: '#E8D6CC', covHi: -2.15, covLo: -2.7, ray: 'rgba(240,220,200,.1)', rayOp: 0.55, water: 'linear-gradient(180deg, #4A4458 0%, #1E1C30 45%, #0B0918 100%)', tile: 'linear-gradient(160deg, #33406A 0%, #7A6E8E 60%, #B58E80 100%)' };
    return { bg: 'linear-gradient(180deg, #14171F 0%, #242936 40%, #3C414E 70%, #575C68 100%)', core: '#C4C6CC', glow: 'rgba(190,195,205,.25)', near: '#8C909A', mid: '#5C606C', far: '#30343E', deep: '#22252E', light: '#A0A4AE', covHi: -1.25, covLo: -1.7, ray: 'rgba(200,205,215,.04)', rayOp: 0.2, water: 'linear-gradient(180deg, #34384A 0%, #181A26 45%, #0B0918 100%)', tile: 'linear-gradient(160deg, #262C3A 0%, #3E4452 60%, #555B68 100%)' };
  }

  function covMatrix(k, off) { return '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ' + k + ' 0 0 0 ' + off; }

  function paintClouds(prefix, near, mid, far, light, covEl, k, cov) {
    var s0 = document.getElementById(prefix + '0'), s1 = document.getElementById(prefix + '1'), s2 = document.getElementById(prefix + '2');
    if (s0) s0.setAttribute('stop-color', near);
    if (s1) s1.setAttribute('stop-color', mid);
    if (s2) s2.setAttribute('stop-color', far);
    if (covEl) covEl.setAttribute('values', covMatrix(k, cov));
  }

  /* ---------------- 状态 ---------------- */

  var state = {
    place: null, // 还没定位、也没有上次的地点时为空：首屏留白，等定位完成再拉预报
    data: null,
    sel: 0,
    rankings: null,
    tab: 'china',
    t: 68,
    timer: null,
    tl: null
  };

  var LS_FAV = 'sg_favorites_v1';
  var LS_LAST = 'sg_last_place_v1';
  var LS_RANK = 'sg_rankings_v2';
  var RANK_TTL = 30 * 60 * 1000;
  // 服务器每天北京时间 15:00 用 scripts/build-rankings.js 算好的榜单；超过 36 小时视为过期
  var DAILY_RANK_URL = 'data/rankings.json';
  var DAILY_RANK_MAX_AGE = 36 * 3600 * 1000;

  function loadJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  function starsHTML(n, maxTop) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<i style="left:' + ((i * 37) % 97 + 1) + '%;top:' + ((i * 23) % maxTop + 2) + '%;animation-delay:' + ((i % 7) * 0.6).toFixed(1) + 's"></i>';
    }
    return out;
  }

  /* ---------------- 太阳高度角（简化天文算法，误差约 0.1°） ---------------- */

  function sunElevation(ms, lat, lon) {
    var rad = Math.PI / 180;
    var d = ms / 86400000 - 10957.5; // 距 J2000.0 的天数
    var g = (357.529 + 0.98560028 * d) * rad;
    var q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    var e = (23.439 - 0.00000036 * d) * rad;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var dec = Math.asin(Math.sin(e) * Math.sin(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    var H = (gmst * 15 + lon) * rad - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(H)) / rad;
  }

  /* ---------------- 天幕 ---------------- */

  function animateNumber(el, target) {
    if (REDUCED || typeof requestAnimationFrame !== 'function') { el.textContent = target; return; }
    var start = Date.now(), dur = 900;
    function step() {
      var p = Math.min(1, (Date.now() - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function paintHero(ev) {
    var p = palette(ev.score);
    $('#heroSky').style.background = p.bg;
    var rays = $('#heroRays');
    setVar(rays, '--ray', p.ray);
    rays.style.opacity = p.rayOp;
    $('#heroHalo').style.background = 'radial-gradient(ellipse, ' + p.glow + ' 0%, transparent 62%)';
    var sun = $('#heroSun');
    sun.style.background = 'radial-gradient(circle at 50% 45%, #FFF8E4 0%, ' + p.core + ' 75%)';
    sun.style.boxShadow = '0 0 60px 20px ' + p.core + ', 0 0 180px 60px ' + p.glow;
    $('#heroWater').style.background = p.water;
    $('#heroGlint').style.backgroundImage = 'repeating-linear-gradient(180deg, ' + p.core + ' 0 2px, transparent 2px 9px)';
    paintClouds('gHi', p.near, p.mid, p.far, p.light, document.getElementById('covHi'), 4, p.covHi);
    paintClouds('gLo', p.near, p.mid, p.deep, p.light, document.getElementById('covLo'), 5, p.covLo);
    ['lightHi', 'lightLo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.setAttribute('lighting-color', p.light);
    });
    setVar($('#heroScore'), '--glow', p.glow);
  }

  // 首访且还没拿到位置：不显示任何默认城市，提示用户点一下页面定位
  function renderEmptyHero() {
    $('#cityName').textContent = '';
    $('#placeMeta').textContent = '';
    $('#fetchTime').textContent = '';
    $('#heroEvent').textContent = '等待定位';
    $('.score-line').hidden = true;
    $('#heroTitle').textContent = '你在哪里看霞？';
    $('#heroAction').textContent = '';
    $('#heroReason').textContent = '点一下页面任意位置，或点搜索框旁的「定位」，就会显示你所在位置的朝霞晚霞预报。也可以直接搜索城市。';
    $('#heroWindow').textContent = '';
    $('#heroBearing').textContent = '';
    $('#heroConf').textContent = '';
    $('#heroGrade').textContent = '';
    $('#events').innerHTML = '<p class="ev-empty">定位或搜索城市后，这里显示今明两日四场预报。</p>';
    $('#layers').innerHTML = '<p class="ev-empty">定位后显示 11 项因素的分层评分。</p>';
    $('#profileMeta').innerHTML = '';
    $('#profileLabel').textContent = '—';
    $('#tlName').textContent = '';
    $('#tlDesc').textContent = '定位后可以拖动时间轴，看当地天色一点点变化。';
    renderFavButton();
  }

  function renderHero() {
    var data = state.data, p = state.place;
    if (!p) { renderEmptyHero(); return; }
    $('.score-line').hidden = false;
    $('#cityName').textContent = p.name;
    $('#placeMeta').textContent = [p.admin1, p.country].filter(Boolean).join(' · ') +
      (p.admin1 || p.country ? ' · ' : '') + Math.abs(p.lat).toFixed(2) + '°' + (p.lat >= 0 ? 'N' : 'S') + ' ' +
      Math.abs(p.lon).toFixed(2) + '°' + (p.lon >= 0 ? 'E' : 'W') + (data ? ' · ' + data.tzName : '');
    renderFavButton();
    if (!data) return;
    $('#fetchTime').textContent = '拉取于 ' + new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour12: false });
    var ev = data.events[state.sel];
    var v = verdictOf(ev);
    var past = ev.epoch < Date.now();
    $('#heroEvent').textContent = EVENT_LABEL[ev.day + '|' + ev.type] + ' · ' + API.fmtTime(ev.epoch, data.offsetSec) + (past ? ' · 已过去' : '');
    animateNumber($('#heroScore'), ev.score);
    $('#heroTitle').textContent = v.title;
    $('#heroAction').textContent = v.action;
    $('#heroReason').textContent = (ev.reasons || []).join('；');
    $('#heroWindow').textContent = '观测窗 ' + API.viewingWindow(ev.epoch, ev.type === 'sunset', data.offsetSec).replace('约 ', '');
    $('#heroBearing').textContent = '方位 ' + dirName(ev.bearing);
    $('#heroConf').textContent = '置信度 ' + ev.conf + ' · ' + v.confText;
    $('#heroModels').textContent = modelsText(ev);
    $('#heroClarity').textContent = ev.clarity ? '通透度 ' + ev.clarity.level + '/7 · ' + ev.clarity.name : '';
    $('#heroGrade').textContent = ev.grade;
    paintHero(ev);
  }

  // 「5 个模式：3 个看好」——看好 = 该模式霞分 ≥ 50（小到中烧及以上）
  function modelsText(ev) {
    var e = ev.ensemble;
    if (!e) return '仅单一模式（多模式数据暂缺）';
    if (e.good === 0) return e.n + ' 个预报模式都不看好';
    if (e.good === e.n) return e.n + ' 个预报模式都看好';
    return e.n + ' 个预报模式中 ' + e.good + ' 个看好';
  }

  /* ---------------- 01 霞历 ---------------- */

  function renderEvents() {
    var data = state.data;
    var box = $('#events');
    if (!data) {
      box.innerHTML = '<div class="ev-skeleton"></div><div class="ev-skeleton"></div><div class="ev-skeleton"></div><div class="ev-skeleton"></div>';
      return;
    }
    var now = Date.now();
    box.innerHTML = data.events.map(function (ev, i) {
      var p = palette(ev.score);
      var v = verdictOf(ev);
      var past = ev.epoch < now;
      return '<button class="ev-tile' + (past ? ' past' : '') + '" type="button" data-idx="' + i + '" aria-pressed="' + (i === state.sel) + '"' +
        ' style="background:' + p.tile + ';--tile-glow:' + p.glow + '">' +
        '<span class="ev-top"><span>' + DAY_LABEL[ev.day] + (past ? ' · 已过去' : '') + '</span><span>' + API.fmtTime(ev.epoch, data.offsetSec) + '</span></span>' +
        '<span class="ev-body"><span class="ev-label">' + EVENT_LABEL[ev.day + '|' + ev.type] + '</span>' +
        '<span class="ev-score"><b>' + ev.score + '</b><span>' + esc(ev.grade) + '</span></span>' +
        '<span class="ev-short">' + esc(v.title) + ' · ' + esc(v.mainReason) + '</span></span>' +
        '<span class="ev-meter" aria-hidden="true"><i style="width:' + ev.score + '%"></i></span></button>';
    }).join('');
    $$('.ev-tile', box).forEach(function (btn) {
      btn.addEventListener('click', function () { selectEvent(parseInt(btn.getAttribute('data-idx'), 10)); });
    });
  }

  function selectEvent(i) {
    state.sel = i;
    $$('.ev-tile', $('#events')).forEach(function (b) {
      b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-idx'), 10) === i));
    });
    renderHero();
    buildTimeline();
    renderProfile();
  }

  /* ---------------- 02 天色时间轴 ---------------- */

  // 天色阶段按太阳高度角（°）划分
  var PHASES = [
    { name: '白昼', en: 'DAYLIGHT', hi: 90, lo: 6, color: '#7FA8D8', fg: '#0B0918', elev: '高于 +6°', short: '太阳还高，云是白的。', desc: '太阳还挂得很高，光线直射，云是白色的。现在出门还早。' },
    { name: '金色时刻', en: 'GOLDEN HOUR', hi: 6, lo: -1, color: '#FFC36B', fg: '#0B0918', elev: '+6° 至 −1°', short: '光线变暖变斜，云边镀金。', desc: '光线变斜、变暖，云的边缘开始镀上金色。该出发去机位了。' },
    { name: '火烧云', en: 'AFTERGLOW', hi: -1, lo: -4, color: '#FF5A1F', fg: '#0B0918', elev: '−1° 至 −4°', short: '光从地平线下点燃云底。', desc: '太阳刚没入地平线，光从下方斜射上来，把整片云底点燃。就是现在。' },
    { name: '蓝调时刻', en: 'BLUE HOUR', hi: -4, lo: -8, color: '#2E56B0', fg: '#F4EDE4', elev: '−4° 至 −8°', short: '红色退场，天空均匀深蓝。', desc: '红色退场，整片天空变成均匀通透的深蓝，城市灯光亮起。拍剪影最好的时候。' },
    { name: '浅黑', en: 'NAUTICAL', hi: -8, lo: -12, color: '#1E2A5A', fg: '#F4EDE4', elev: '−8° 至 −12°', short: '地平线留一线微光。', desc: '地平线还留着一线微光，天顶已经暗下来，第一批亮星出现。' },
    { name: '黑', en: 'NIGHT', hi: -12, lo: -90, color: '#0E1124', fg: '#F4EDE4', elev: '低于 −12°', short: '天彻底黑透。', desc: '太阳已经在地平线下很深的地方，天空彻底黑透。' }
  ];
  function phaseOf(e) {
    for (var i = 0; i < PHASES.length; i++) if (e < PHASES[i].hi && e >= PHASES[i].lo) return PHASES[i];
    return e >= 6 ? PHASES[0] : PHASES[PHASES.length - 1];
  }

  // 关键帧以「太阳在地平线下的深度」d = −高度角 为横轴
  var SKY_KEYS_BASE = [
    [-14.8, ['#2E5C9A', '#5C8CC4', '#9CC0E0', '#E8E2C8']],
    [-6, ['#2A4A86', '#5A78B0', '#C8A88A', '#FFD08A']],
    [0.8, ['#1E2A5E', '#5A3C78', '#D0604E', '#FFB056'], true],
    [2, ['#1A1446', '#4A2062', '#C0384A', '#FF7A3A'], true],
    [4.4, ['#141A48', '#2A3A7A', '#6A5A9A', '#D8907A'], true],
    [6.4, ['#0E1A4A', '#1E3A7E', '#3A5EA6', '#7A8EC0']],
    [10, ['#0A0F2A', '#121C44', '#1E2C5A', '#34406E']],
    [15, ['#05060F', '#080A18', '#0C1024', '#141A30']],
    [22, ['#030308', '#05060E', '#070914', '#0A0D1A']]
  ];
  var GREY = ['#262A3A', '#3C4050', '#5A5E6C', '#8A8C94'];

  function intensityAt(score, e) { return (score / 100) * Math.exp(-Math.pow(e + 2, 2) / (2 * 2.2 * 2.2)); }

  function buildTimeline() {
    var data = state.data;
    if (!data) return;
    var ev = data.events[state.sel];
    var isRise = ev.type === 'sunrise';
    var center = isRise ? 90 : 60;
    var lat = state.place.lat, lon = state.place.lon;
    var k = clamp((ev.score - 20) / 60, 0, 1);
    var skyKeys = SKY_KEYS_BASE.map(function (r) {
      return [r[0], r[2] ? r[1].map(function (c, j) { return mixHex(GREY[j], c, k); }) : r[1]];
    });
    var lightKeys = [
      [-14.8, '#FFFFFF'], [-6, '#FFE2B4'], [0.8, mixHex('#B0A8A8', '#FFB070', k)], [2, mixHex('#9A9AA4', '#FF7A40', k)],
      [4.4, mixHex('#7A7A90', '#D0607A', k)], [7.4, '#5A6A9A'], [11, '#2A3352'], [22, '#121624']
    ];
    var epochAt = function (x) { return ev.epoch + (x - center) * 60000; };
    var elevs = [];
    for (var x = 0; x <= 150; x++) elevs.push(sunElevation(epochAt(x), lat, lon));

    // 阶段色带（按分钟游程分组）
    var bands = [];
    for (var j = 0; j <= 150; j++) {
      var ph = phaseOf(elevs[j]);
      var last = bands[bands.length - 1];
      if (last && last.ph === ph) last.to = j; else bands.push({ ph: ph, from: j, to: j });
    }
    $('#tlBands').innerHTML = bands.map(function (b) {
      var w = (b.to - b.from + 1) / 151 * 100;
      return '<span style="left:' + (b.from / 151 * 100).toFixed(2) + '%;width:' + w.toFixed(2) + '%;background:' + b.ph.color + ';color:' + b.ph.fg + '">' + (w > 5 ? b.ph.name : '') + '</span>';
    }).join('');

    // 霞强度柱（每 5 分钟）
    var bars = '';
    for (var xb = 0; xb <= 150; xb += 5) {
      var eb = elevs[xb], pb = phaseOf(eb);
      bars += '<i data-x="' + xb + '" style="height:' + (6 + intensityAt(ev.score, eb) * 110).toFixed(0) + 'px;background:' + (pb.name === '黑' ? '#2A2F48' : pb.color) + '"></i>';
    }
    $('#tlBars').innerHTML = bars;

    // 刻度
    $('#tlTicks').innerHTML = [0, 30, 60, 90, 120, 150].map(function (xt) {
      var shift = xt === 0 ? '0' : (xt === 150 ? '-100%' : '-50%');
      return '<span style="left:' + (xt / 150 * 100) + '%;transform:translateX(' + shift + ')">' + API.fmtTime(epochAt(xt), data.offsetSec) + '</span>';
    }).join('');

    // 阶段卡片
    $('#tlLegend').innerHTML = bands.map(function (b) {
      return '<button class="tl-card" type="button" data-mid="' + Math.round((b.from + b.to) / 2) + '" data-name="' + b.ph.name + '">' +
        '<span class="tl-card-h"><i style="background:' + b.ph.color + '"></i>' + b.ph.name + '</span>' +
        '<span class="tl-card-t">' + API.fmtTime(epochAt(b.from), data.offsetSec) + '–' + API.fmtTime(epochAt(b.to), data.offsetSec) + ' · ' + b.ph.elev + '</span>' +
        '<span class="tl-card-d">' + b.ph.short + '</span></button>';
    }).join('');
    $$('.tl-card', $('#tlLegend')).forEach(function (btn) {
      btn.addEventListener('click', function () { setT(parseInt(btn.getAttribute('data-mid'), 10), true); });
    });

    $('#tlCaption').textContent = '以 ' + EVENT_LABEL[ev.day + '|' + ev.type] + ' ' + API.fmtTime(ev.epoch, data.offsetSec) +
      ' 为轴心，前后两个半小时。天色按当地真实的太阳高度角划分；霞强度 = 这一场的评分 × 时间曲线（示意），峰值在太阳没入地平线后、高度角约 −2° 时。';

    state.tl = { ev: ev, elevs: elevs, epochAt: epochAt, skyKeys: skyKeys, lightKeys: lightKeys, k: k };
    paintCloudsTl();
    state.tlCloudX = null;
    updateTimeline(true);
  }

  function paintCloudsTl() {
    var cov = palette(state.tl.ev.score).covHi;
    var el = document.getElementById('covTl');
    if (el) el.setAttribute('values', covMatrix(4, cov));
  }

  // force=false 时（拖动 / 播放中）云层每移动 4 分钟才重绘一次：
  // 改 SVG 滤镜的光色会让整片分形噪声重新栅格化，是手机上卡顿的主因
  function updateTimeline(force) {
    var tl = state.tl;
    if (!tl) return;
    var x = state.t, e = tl.elevs[x], d = -e, ev = tl.ev;
    var sky = interp(tl.skyKeys, d);
    var light = interp(tl.lightKeys, d);
    var ph = phaseOf(e);
    var sunColor = mixHex('#FFF0C8', '#FF6A2A', clamp((8 - e) / 9, 0, 1));
    var sunOp = e > -1.5 ? 1 : 0;

    $('#tlStage').style.background = 'linear-gradient(180deg, ' + sky[0] + ' 0%, ' + sky[1] + ' 40%, ' + sky[2] + ' 72%, ' + sky[3] + ' 100%)';
    $('#tlStars').style.opacity = clamp((d - 6) / 7, 0, 1).toFixed(2);
    var glowA = clamp(0.9 - (d - 2.5) / 10, 0, 0.9) * (d < -7 ? 0.4 : 1);
    $('#tlGlow').style.background = 'radial-gradient(ellipse, ' + rgba(mixHex(sky[3], '#FFA050', tl.k * 0.5), glowA) + ' 0%, transparent 62%)';
    var sun = $('#tlSun');
    sun.style.bottom = (140 + e * 16).toFixed(0) + 'px';
    sun.style.opacity = sunOp;
    sun.style.background = 'radial-gradient(circle at 50% 45%, #FFF8E4 0%, ' + sunColor + ' 75%)';
    sun.style.boxShadow = '0 0 50px 16px ' + sunColor;
    $('#tlWater').style.background = 'linear-gradient(180deg, ' + mixHex(sky[3], '#0B0918', 0.45) + ' 0%, ' + mixHex(sky[2], '#0B0918', 0.75) + ' 45%, #0B0918 100%)';
    var glint = $('#tlGlint');
    glint.style.opacity = sunOp;
    glint.style.backgroundImage = 'repeating-linear-gradient(180deg, ' + sunColor + ' 0 2px, transparent 2px 9px)';
    if (force || state.tlCloudX === null || Math.abs(x - state.tlCloudX) >= 4) {
      state.tlCloudX = x;
      paintClouds('gTl', light, mixHex(light, sky[1], 0.45), mixHex(sky[0], '#000000', 0.2), light, null);
      var lt = document.getElementById('lightTl');
      if (lt) lt.setAttribute('lighting-color', light);
      var ld = document.getElementById('lightTlDir');
      if (ld) ld.setAttribute('elevation', clamp(16 + e * 2, 6, 40).toFixed(1));
    }

    $('#tlClock').textContent = API.fmtTime(tl.epochAt(x), state.data.offsetSec);
    $('#tlElev').textContent = '太阳高度 ' + (e >= 0 ? '+' : '−') + Math.abs(e).toFixed(1) + '°';
    $('#tlPct').textContent = '预计霞强度 ' + Math.round(intensityAt(ev.score, e) * 100) + '%';
    $('#tlEn').textContent = ph.en;
    $('#tlName').textContent = ph.name;
    $('#tlName').style.color = ph.name === '火烧云' ? '#FFB070' : '#FFF4E2';
    $('#tlDesc').textContent = ph.desc;
    $('#tlHead').style.left = (x / 150 * 100).toFixed(2) + '%';
    var range = $('#tlRange');
    range.value = String(x);
    range.setAttribute('aria-valuetext', $('#tlClock').textContent + ' ' + ph.name);
    $$('#tlBars i').forEach(function (b) { b.classList.toggle('on', Math.abs(parseInt(b.getAttribute('data-x'), 10) - x) <= 5); });
    $$('#tlLegend .tl-card').forEach(function (b) {
      if (b.getAttribute('data-name') === ph.name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  // 同一帧内多次 setT 只渲染一次
  var tlRaf = 0;
  function setT(x, force) {
    state.t = clamp(Math.round(x), 0, 150);
    if (force) { updateTimeline(true); return; }
    if (tlRaf) return;
    tlRaf = requestAnimationFrame(function () { tlRaf = 0; updateTimeline(false); });
  }

  // 指针拖动：鼠标、触屏统一走 pointer 事件；.scrub 设了 touch-action: pan-y，
  // 横向滑动交给这里，竖向仍然滚动页面（浏览器接管时会发 pointercancel）
  function bindScrub() {
    var scrub = $('.scrub');
    var dragging = false;
    function xFrom(e) {
      var r = $('#tlBars').getBoundingClientRect();
      return (e.clientX - r.left) / r.width * 150;
    }
    function end() {
      if (!dragging) return;
      dragging = false;
      scrub.classList.remove('dragging');
      updateTimeline(true);
    }
    scrub.addEventListener('pointerdown', function (e) {
      if (e.button > 0 || !state.tl) return;
      dragging = true;
      scrub.classList.add('dragging');
      try { scrub.setPointerCapture(e.pointerId); } catch (err) { /* 指针已失效时忽略，拖动照常 */ }
      setT(xFrom(e));
    });
    scrub.addEventListener('pointermove', function (e) { if (dragging) setT(xFrom(e)); });
    scrub.addEventListener('pointerup', end);
    scrub.addEventListener('pointercancel', end);
    scrub.addEventListener('lostpointercapture', end);
  }

  function togglePlay() {
    var btn = $('#tlPlay');
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
      btn.setAttribute('aria-pressed', 'false');
      $('#tlPlayLabel').textContent = '自动播放';
      return;
    }
    state.timer = setInterval(function () { setT(state.t >= 150 ? 0 : state.t + 1); }, 90);
    btn.setAttribute('aria-pressed', 'true');
    $('#tlPlayLabel').textContent = '暂停';
  }

  /* ---------------- 03 大气剖面 ---------------- */

  var LAYERS = [
    ['curtain', '中高云幕布', '6–12 km', 30], ['gap', '太阳方向缺口', '上游 300 km', 20],
    ['low', '低云', '0–2 km', 20], ['precip', '霞时刻降水', '云底', 10],
    ['cape', 'CAPE 对流', '对流层', 2], ['dew', '露点差', '边界层', 2],
    ['vis', '能见度', '近地面', 3], ['aod', 'AOD 气溶胶', '柱总量', 5],
    ['pm', 'PM2.5', '地面', 3], ['wind', '风速', '10 m', 2], ['washed', '雨后洗净', '加成', '+3']
  ];

  function fmtIn(v, suffix, digits) {
    if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) return '无数据';
    return (typeof v === 'number' ? v.toFixed(digits || 0) : v) + (suffix || '');
  }

  function renderProfile() {
    var data = state.data;
    if (!data) { $('#layers').innerHTML = ''; return; }
    var ev = data.events[state.sel];
    $('#profileLabel').textContent = EVENT_LABEL[ev.day + '|' + ev.type] + ' ' + API.fmtTime(ev.epoch, data.offsetSec);
    $('#layers').innerHTML = LAYERS.map(function (L, i) {
      var c = ev.comps[L[0]] || [null, '无数据'];
      var s = c[0];
      var missing = s === null || s === undefined;
      var color = missing ? '' : (s >= 75 ? 'linear-gradient(90deg,#FF5A1F,#FFC36B)' : s >= 45 ? 'linear-gradient(90deg,#A84A6A,#E8805A)' : 'linear-gradient(90deg,#3E4452,#6E7380)');
      var scoreTxt = L[0] === 'washed' ? '+' + (s ? (s * 0.05).toFixed(1) : '0.0') : (missing ? '—' : Math.round(s));
      return '<div class="layer-row" role="row">' +
        '<span class="layer-alt" role="cell">' + L[2] + '</span>' +
        '<span class="layer-name" role="cell"><b>' + L[1] + '</b><span>' + esc(c[1]) + '</span></span>' +
        '<span class="layer-track" role="cell">' + (missing ? '<em>无数据，已排除</em>' : '<i style="width:' + clamp(s, 0, 100) + '%;background:' + color + ';animation-delay:' + (i * 0.06).toFixed(2) + 's"></i>') + '</span>' +
        '<span class="layer-score" role="cell"><b>' + scoreTxt + '</b><span>×' + L[3] + '</span></span></div>';
    }).join('');
    var inp = ev.inputs || {};
    var meta = [];
    if (ev.ensemble) {
      meta.push('各模式霞分 · ' + ev.ensemble.members.map(function (m) { return m.label + ' ' + m.score; }).join(' / ') + '（加权平均，综合 ×2）');
      meta.push('本剖面云量取自 ' + ev.repModel);
    }
    meta = meta.concat([
      '剧本 · ' + ev.script,
      '中 / 高 / 低云 ' + fmtIn(inp.mid, '%') + ' / ' + fmtIn(inp.high, '%') + ' / ' + fmtIn(inp.low, '%'),
      '上游总云 ' + fmtIn(inp.upTotalAvg, '%'),
      'AOD ' + fmtIn(inp.aod, '', 2),
      'PM2.5 ' + fmtIn(inp.pm, ' µg/m³'),
      '能见度 ' + fmtIn(inp.visKm, ' km')
    ]);
    if (ev.clarity) meta.push('通透度 ' + ev.clarity.level + '/7 ' + ev.clarity.name);
    if (typeof ev.condScore === 'number') meta.push('条件分（加权平均）' + ev.condScore);
    if (ev.comps.precip && ev.comps.precip[0] === 0) meta.push('霞时刻降水 → 霞分封顶 34（最高微烧）');
    if ((ev.reasons || []).some(function (r) { return r.indexOf('跨境烟霾') >= 0; })) meta.push('偏南风 + AOD 高 → −5');
    $('#profileMeta').innerHTML = meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('');
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
        '<span class="cand-coord">' + p.lat.toFixed(2) + '°, ' + p.lon.toFixed(2) + '°</span>' +
        '<span class="cand-sub">' + esc(sub) + '</span></button>';
    }).join('');
    box.hidden = false;
    $$('.cand', box).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = list[parseInt(btn.getAttribute('data-idx'), 10)];
        box.hidden = true;
        $('#searchInput').value = p.name;
        $('#searchInput').blur();
        setPlace({ name: p.name, admin1: p.admin1, admin2: p.admin2, country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone || '' }, 'manual');
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
    return getFavs().some(function (f) { return Math.abs(f.lat - p.lat) < 0.01 && Math.abs(f.lon - p.lon) < 0.01; });
  }
  function renderFavButton() {
    $('#favBtn').hidden = !state.place;
    if (!state.place) return;
    var on = isFav(state.place);
    $('#favBtn').setAttribute('aria-pressed', String(on));
    $('#favLabel').textContent = on ? '已收藏' : '收藏此地';
  }

  function renderFavs() {
    var favs = getFavs();
    $('#favBar').innerHTML = favs.map(function (f, idx) {
      return '<span class="fav-chip"><button class="fav-go" data-idx="' + idx + '" type="button">' + esc(f.name) + '</button>' +
        '<button class="fav-del" data-idx="' + idx + '" type="button" aria-label="取消收藏 ' + esc(f.name) + '">×</button></span>';
    }).join('');
    $$('.fav-go', $('#favBar')).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = favs[parseInt(b.getAttribute('data-idx'), 10)];
        if (f) setPlace(f, 'manual');
      });
    });
    $$('.fav-del', $('#favBar')).forEach(function (b) {
      b.addEventListener('click', function () {
        var favs2 = getFavs();
        favs2.splice(parseInt(b.getAttribute('data-idx'), 10), 1);
        saveJSON(LS_FAV, favs2);
        renderFavs();
        renderFavButton();
      });
    });
  }

  function toggleFav() {
    if (!state.place) return;
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
    renderFavButton();
  }

  /* ---------------- 04 霞榜 ---------------- */

  function project(lat, lon, china) {
    if (china) return { x: (lon - 80) / 50 * 90 + 5, y: (50 - lat) / 32 * 84 + 8 };
    return { x: (lon + 180) / 360 * 92 + 4, y: (75 - lat) / 120 * 84 + 8 };
  }

  // 此刻赤道上的日落经度：当地太阳时约 18:00 的地方
  function sunsetLongitude(now) {
    var d = new Date(now);
    var utcH = d.getUTCHours() + d.getUTCMinutes() / 60;
    var lon = (18 - utcH) * 15;
    return ((lon + 540) % 360) - 180;
  }

  function placeTerminator() {
    var china = state.tab === 'china';
    var pos = project(0, sunsetLongitude(Date.now()), china).x;
    var term = $('#terminator');
    term.hidden = pos < 0 || pos > 100;
    term.style.left = pos.toFixed(1) + '%';
    $('#worldL').textContent = china ? '80°E' : '180°W';
    $('#worldR').textContent = china ? '130°E' : '180°E';
  }

  function goCity(c) {
    setPlace({ name: c.name, admin1: '', admin2: '', country: c.country, lat: c.lat, lon: c.lon, timezone: '' }, 'manual');
    var top = document.getElementById('top');
    if (top && top.scrollIntoView) top.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function renderBoard() {
    placeTerminator();
    var data = state.rankings;
    if (!data) return;
    var china = state.tab === 'china';
    var list = china ? data.china : data.global;
    $('#worldEmpty').hidden = true;
    $('#boardDots').innerHTML = list.map(function (r, i) {
      var c = r.city, p = project(c.lat, c.lon, china);
      var size = Math.max(6, 6 + (r.score - 40) / 5);
      var col = r.score >= 65 ? '#FF5A1F' : r.score >= 50 ? '#FFA65A' : '#C9A08E';
      return '<button class="dot" type="button" data-i="' + i + '" style="left:' + p.x.toFixed(1) + '%;top:' + p.y.toFixed(1) + '%" aria-label="' + esc(c.name) + ' ' + r.score + ' 分">' +
        '<i style="width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px;background:' + col + ';box-shadow:0 0 18px ' + col + '"></i>' +
        '<span>' + esc(c.name) + ' <b>' + r.score + '</b></span></button>';
    }).join('');
    $('#boardList').innerHTML = list.map(function (r, i) {
      var c = r.city;
      return '<li><button class="rank-row" type="button" data-i="' + i + '">' +
        '<span class="rank-no">' + (i < 9 ? '0' : '') + (i + 1) + '</span>' +
        '<span class="rank-city"><b>' + esc(c.name) + '</b><span>' + esc(c.country) + ' · ' + API.fmtDate(r.epoch, r.offsetSec || 0) + ' ' + API.fmtTime(r.epoch, r.offsetSec || 0) + ' 晚霞 · 置信度 ' + esc(r.conf) +
          (r.clarity ? ' · 通透度 ' + r.clarity.level + '/7' : '') + '</span></span>' +
        '<span class="rank-grade">' + esc(r.grade) + '</span>' +
        '<span class="rank-score">' + r.score + '</span></button></li>';
    }).join('') || '<li class="note">暂无数据</li>';
    $$('.dot, .rank-row', $('#board')).forEach(function (b) {
      b.addEventListener('click', function () { goCity(list[parseInt(b.getAttribute('data-i'), 10)].city); });
    });
    var items = data.global.concat(data.china).map(function (r) {
      return '<span>' + esc(r.city.name) + '<b>' + r.score + '</b></span>';
    }).join('');
    $('#tickerInner').innerHTML = items + items;
    $('#ticker').hidden = false;
    var when = new Date(data.computedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    var st = data.stats && data.stats[china ? 'china' : 'global'];
    $('#boardSummary').innerHTML = st ? summaryHTML(st, china) : '';
    $('#boardSummary').hidden = !st;
    $('#boardNote').textContent = (state.rankingsDaily
      ? '每天北京时间 15:00 由服务器统一计算一次 · 本次更新于 ' + when + '（北京时间）'
      : '实时计算于 ' + when + '（北京时间）· 30 分钟缓存') +
      ' · 全球 36 城 + 中国 34 城，同一算法计算下一场晚霞，各取 TOP 10';
    $('#boardLoadBtn').hidden = !!state.rankingsDaily;
  }

  // 全部参评城市的分档分布：一眼看出今天整体烧不烧、烧在哪一档
  function summaryHTML(st, china) {
    var total = st.counts.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return '';
    var any = total - st.counts[0];
    var hot = st.counts[4] + st.counts[5];
    var bars = A.LEVELS.map(function (L, k) {
      var n = st.counts[k];
      return '<span class="sum-seg lv' + k + '" style="flex:' + (n || 0.0001) + '" title="' + L.name + ' ' + n + '"></span>';
    }).join('');
    var legend = A.LEVELS.map(function (L, k) {
      return '<span><i class="lv' + k + '"></i>' + L.name + ' <b>' + st.counts[k] + '</b></span>';
    }).join('');
    return '<p class="sum-head">' + (china ? '全中国' : '全球') + ' ' + total + ' 城参评 · <b>' + any + '</b> 城有霞（' +
      Math.round(any / total * 100) + '%）· 中到大烧以上 <b>' + hot + '</b> 城</p>' +
      '<div class="sum-bar">' + bars + '</div><div class="sum-legend">' + legend + '</div>';
  }

  // 读服务器每天生成的榜单；拿不到或过期就返回 null，页面退回到按钮手动实时计算
  function loadDailyBoard() {
    var bucket = Math.floor(Date.now() / 3600000); // 每小时换一次查询串，避开中间缓存
    return API.fetchJSON(DAILY_RANK_URL + '?h=' + bucket, 10000).then(function (d) {
      var ok = d && d.version >= 2 && Array.isArray(d.global) && Array.isArray(d.china) && d.global.length && d.china.length &&
        typeof d.computedAt === 'number' && Date.now() - d.computedAt < DAILY_RANK_MAX_AGE;
      return ok ? d : null;
    }).catch(function () { return null; });
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
    btn.textContent = '正在计算 70 城… 0%';
    API.loadRankings(function (done, total) {
      btn.textContent = '正在计算 70 城… ' + Math.round(done / total * 100) + '%';
    }).then(function (data) {
      state.rankings = data;
      saveJSON(LS_RANK, data);
      btn.disabled = false;
      btn.textContent = '重新计算榜单';
      renderBoard();
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '加载今日晚霞榜';
      $('#boardNote').textContent = '榜单加载失败：' + (e && e.message || '请检查网络');
    });
  }

  /* ---------------- 定位 ----------------
   * 优先用浏览器 GPS / Wi-Fi 定位（仅 HTTPS 或 localhost 可用，会弹授权）；
   * 不可用、被拒绝或超时时，退回按 IP 估算到城市。
   * 逆地理编码与 IP 定位都走 BigDataCloud 的免 key 客户端接口。 */

  var GEO_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=zh';
  var geoBusy = false;

  function geoStatus(text) {
    var el = $('#geoStatus');
    el.textContent = text || '';
    el.hidden = !text;
  }

  function reverseGeocode(lat, lon) {
    var url = GEO_URL + (lat === undefined ? '' : '&latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4));
    return API.fetchJSON(url, 10000).then(function (r) {
      if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') throw new Error('定位服务没有返回坐标');
      return {
        name: r.city || r.locality || r.principalSubdivision || '我的位置',
        admin1: r.principalSubdivision && r.principalSubdivision !== r.city ? r.principalSubdivision : '',
        admin2: '', country: r.countryName || '',
        lat: lat === undefined ? r.latitude : lat,
        lon: lon === undefined ? r.longitude : lon,
        timezone: ''
      };
    });
  }

  function browserPosition() {
    return new Promise(function (resolve, reject) {
      if (!window.isSecureContext || !navigator.geolocation) { reject(new Error('insecure')); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      }, reject, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
    });
  }

  function locate() {
    if (geoBusy) return;
    geoBusy = true;
    var startSeq = placeSeq;
    var btn = $('#locateBtn');
    btn.classList.add('busy');
    geoStatus('正在定位…');
    var precise = true;
    browserPosition().then(function (c) {
      return reverseGeocode(c.lat, c.lon).catch(function () {
        return { name: '我的位置', admin1: '', admin2: '', country: '', lat: c.lat, lon: c.lon, timezone: '' };
      });
    }, function () {
      precise = false;
      return reverseGeocode();
    }).then(function (place) {
      // 定位期间用户已经手动换了地点：尊重用户的选择
      if (placeSeq !== startSeq) { geoStatus(''); return; }
      geoStatus(precise ? '已定位到你所在位置' : '按网络位置估算（大致到城市）');
      setPlace(place, 'geo');
    }).catch(function () {
      geoStatus('定位失败，可以手动搜索城市');
    }).then(function () {
      geoBusy = false;
      btn.classList.remove('busy');
    });
  }

  // 用户第一次点击页面时自动定位一次；用户自己选过地点（搜索 / 收藏 / 榜单）后不再自动覆盖
  function bindAutoLocate() {
    if (state.place && state.place.source === 'manual') return;
    function once(e) {
      document.removeEventListener('pointerdown', once, true);
      if (e.target.closest && e.target.closest('.search')) return;
      locate();
    }
    document.addEventListener('pointerdown', once, true);
  }

  /* ---------------- 地点切换 ---------------- */

  var placeSeq = 0;

  // source：manual（搜索 / 收藏 / 榜单点选）、geo（定位）、default（首访默认）
  function setPlace(place, source) {
    var seq = ++placeSeq;
    place.source = source || place.source || 'manual';
    state.place = place;
    state.data = null;
    if (place.source === 'manual') geoStatus('');
    saveJSON(LS_LAST, place);
    $('#heroScore').textContent = '--';
    $('#heroTitle').textContent = '正在拉取预报…';
    $('#heroAction').textContent = '';
    $('#heroReason').textContent = '';
    $('#heroWindow').textContent = '';
    $('#heroBearing').textContent = '';
    $('#heroConf').textContent = '';
    $('#heroGrade').textContent = '';
    $('#heroEvent').textContent = '正在查询';
    $('#fetchTime').textContent = '';
    $('#loadError').hidden = true;
    renderHero();
    renderEvents();
    renderProfile();
    API.evaluatePlace(place.lat, place.lon).then(function (data) {
      if (seq !== placeSeq) return;
      state.data = data;
      var now = Date.now(), sel = -1;
      data.events.forEach(function (ev, i) { if (sel < 0 && ev.epoch > now) sel = i; });
      state.sel = sel < 0 ? data.events.length - 1 : sel;
      renderEvents();
      renderHero();
      buildTimeline();
      renderProfile();
    }).catch(function (e) {
      if (seq !== placeSeq) return;
      $('#heroTitle').textContent = '预报暂时不可用';
      $('#heroReason').textContent = '未编造任何数据。';
      $('#events').innerHTML = '';
      $('#loadError').hidden = false;
      $('#loadError').textContent = '预报拉取失败：' + (e && e.message || '请检查网络') + '。请稍后重试。';
    });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    $('#heroStars').innerHTML = starsHTML(18, 30);
    $('#tlStars').innerHTML = starsHTML(28, 55);
    paintHero({ score: 60 });
    renderFavs();
    var saved = loadJSON(LS_LAST, null);
    // 只恢复用户自己选的或定位得到的地点；旧版本存下的默认城市（胡志明市）不再沿用
    if (saved && saved.name && typeof saved.lat === 'number' && (saved.source === 'manual' || saved.source === 'geo')) state.place = saved;

    $('#searchInput').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(doSearch, 300);
    });
    $('#searchInput').addEventListener('focus', function () {
      if ($('#searchInput').value.trim()) doSearch();
    });
    $('#searchBtn').addEventListener('click', doSearch);
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.search')) $('#searchResults').hidden = true;
    });
    $('#favBtn').addEventListener('click', toggleFav);
    $('#locateBtn').addEventListener('click', locate);
    $('#tlRange').addEventListener('input', function (e) { setT(parseInt(e.target.value, 10)); });
    bindScrub();
    $('#tlPlay').addEventListener('click', togglePlay);
    $('#boardLoadBtn').addEventListener('click', loadBoard);
    $('#boardTabs').addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-tab]');
      if (!btn) return;
      state.tab = btn.getAttribute('data-tab');
      $$('#boardTabs .tab-btn').forEach(function (b) {
        var on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      renderBoard();
    });

    renderBoard();
    loadDailyBoard().then(function (daily) {
      if (daily) {
        state.rankings = daily;
        state.rankingsDaily = true;
      } else {
        var cached = loadJSON(LS_RANK, null);
        if (cached && Date.now() - cached.computedAt < RANK_TTL && cached.global && cached.china) state.rankings = cached;
      }
      renderBoard();
    });
    setInterval(placeTerminator, 60000);
    if (state.place) setPlace(state.place, state.place.source || 'manual');
    else renderEmptyHero();
    bindAutoLocate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
