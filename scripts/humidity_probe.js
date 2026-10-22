// 湿度厚度诊断：气压层湿度能不能区分「薄卷云」和「厚灰盖」。
// 只出分类统计，不改分数 —— 决定要不要接进算法用。
const path = require('path');
const ROOT = process.argv[2] || process.cwd();
const algo = require(path.join(ROOT, 'algo.js'));
global.SunsetAlgo = algo;
const api = require(path.join(ROOT, 'api.js'));

const CITIES = [
  ['胡志明', 10.79, 106.75], ['河内', 21.03, 105.85], ['南阳', 32.99, 112.53],
  ['杭州', 30.27, 120.16], ['上海', 31.23, 121.47], ['北京', 39.90, 116.41],
  ['成都', 30.57, 104.07], ['昆明', 25.04, 102.72], ['西安', 34.34, 108.94],
  ['广州', 23.13, 113.26], ['曼谷', 13.76, 100.50], ['新加坡', 1.35, 103.82],
  ['雅加达', -6.21, 106.85], ['马尼拉', 14.60, 120.98], ['东京', 35.68, 139.69],
  ['首尔', 37.57, 126.98], ['悉尼', -33.87, 151.21], ['台北', 25.03, 121.57]
];

(async () => {
  let thin = 0, thick = 0, both = 0, neither = 0;
  const rows = [];
  for (const [name, lat, lon] of CITIES) {
    try {
      const fc = await api.fetchJSON(api.forecastURL(lat, lon, 'auto', 2));
      const off = fc.utc_offset_seconds || 0;
      const daily = fc.daily || {};
      const idx = {}; (daily.time || []).forEach((d, k) => idx[d] = k);
      const ds = api.zonedParts(Date.now(), off).dateStr;
      const sunset = (daily.sunset || [])[idx[ds]];
      if (!sunset) continue;
      const epoch = algo.toEpoch(sunset, off);
      // 云量（综合模式，日落整点）
      const h = fc.hourly || {};
      const times = (h.time || []).map(t => algo.toEpoch(t, off));
      const i = algo.idxFloor(times, epoch);
      const high = h.cloud_cover_high ? h.cloud_cover_high[i] : null;
      const mid = h.cloud_cover_mid ? h.cloud_cover_mid[i] : null;
      // 湿度（ECMWF 气压层）
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&hourly=relative_humidity_300hPa,relative_humidity_500hPa,relative_humidity_700hPa' +
        '&models=ecmwf_ifs025&forecast_days=2&timezone=auto';
      const rh = await api.fetchJSON(url);
      const rhh = rh.hourly || {};
      const rht = (rhh.time || []).map(t => algo.toEpoch(t, rh.utc_offset_seconds || off));
      const j = algo.idxFloor(rht, epoch);
      const rh300 = rhh.relative_humidity_300hPa ? rhh.relative_humidity_300hPa[j] : null;
      const rh500 = rhh.relative_humidity_500hPa ? rhh.relative_humidity_500hPa[j] : null;
      const isThin = (high !== null && high > 40) && (rh300 !== null && rh300 < 45);
      const isThick = (mid !== null && mid > 40) && (rh500 !== null && rh500 > 80);
      if (isThin) thin++; if (isThick) thick++;
      if (isThin && isThick) both++;
      if (!isThin && !isThick) neither++;
      rows.push({ name, high, mid, rh300, rh500, thin: isThin, thick: isThick });
    } catch (e) { rows.push({ name, error: String(e.message).slice(0, 50) }); }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log('城市数', rows.length);
  console.log('薄卷云候选(高云>40% 且 300hPa 湿度<45%)', thin, '个 —— 现在会被当厚云，可能低估');
  console.log('厚灰盖候选(中云>40% 且 500hPa 湿度>80%)', thick, '个 —— 现在只看云量，没看厚度');
  for (const r of rows) {
    if (r.error) { console.log('  ', r.name, 'ERR', r.error); continue; }
    const flag = r.thin ? '  [薄卷云·该加分]' : (r.thick ? '  [厚云·该减分]' : '');
    console.log(`  ${r.name.padEnd(6)} 高云${String(r.high).padStart(3)}% 中云${String(r.mid).padStart(3)}% RH300=${r.rh300 ?? '—'}% RH500=${r.rh500 ?? '—'}%${flag}`);
  }
})();
