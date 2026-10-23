/* ============================================================
 * Jev（TypeSafe System One）客户端 —— 给算法/推送做独立复核用。
 * 只返回概率，不生成文字；和主模型是两套系统，适合交叉验证。
 *
 * Key 解析顺序：环境变量 TYPESAFE_API_KEY → ~/.config/typesafe/key
 * 注意：key 本身以 apikey_ 开头，不要带 jev_ 前缀（会 401）。
 *
 * 设计取舍（实测得出，别改回去）：
 * - 只问「这一档对这种天气是否合理」，并把领域规则写进 instructions。
 *   问「引用的数字是否与数据一致」实测不可靠（正确样本也给 0.03）。
 * - 批量复核必须把每个城市的条件嵌进各自的 question.instructions，
 *   只靠共享 state 里的数组位置时，所有城市会被判成同一个分数（实测全 0.31）。
 * - 阈值：<0.5 视为存疑。实测正常样本 0.62–0.79，阴天报大烧 0.06，万里无云报大烧 0.17。
 * ============================================================ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const API = 'https://api.typesafe.ai/v1/systemone';
const KEY_FILE = path.join(os.homedir(), '.config', 'typesafe', 'key');

function apiKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  try {
    return fs.readFileSync(KEY_FILE, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

function hasKey() {
  return apiKey().length > 0;
}

/**
 * 一次请求问多个问题（并行评估，比逐个问便宜得多）。
 * 任何失败都返回 {ok:false}，调用方必须把复核当成可选增强，不能让它挡住主流程。
 */
async function systemOne(state, questions, opts) {
  opts = opts || {};
  const key = apiKey();
  if (!key) return { ok: false, error: 'no-key' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 12000);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model || 'jev-latest', state: state, questions: questions }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const data = await res.json();
    return { ok: true, model: data.model, answers: data.answers, usage: data.usage };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 复核：结论对这种天气是否合理 ---------------- */
const PLAUSIBLE_RULES =
  'Domain rules: high cloud (cirrus, 8-9 km) and mid-level cloud (altocumulus / altostratus, 3-6 km) ' +
  'are both the glowing curtain that produces sunset colour; a sky with a good amount of either is ' +
  'favourable, and mid-level altocumulus can be the most spectacular. Thick low cloud (below 2 km) ' +
  'and rain block the light and suppress colour. High aerosol optical depth dulls the colour. ' +
  'A clear sky with no mid or high cloud correctly receives the lowest grade (no burn) even when ' +
  'the air is clean, because there is nothing to be lit.';

const PLAUSIBLE_CRITERIA = {
  true: 'The grade is roughly what these conditions would produce under the stated rules.',
  false: 'The grade is clearly too high or too low for these conditions.',
};

function plausibleQuestion(conditions) {
  return {
    type: 'noul',
    instructions: {
      question: 'Is the stated grade plausible for these conditions?',
      rules: PLAUSIBLE_RULES,
      conditions: conditions,
    },
    criteria: PLAUSIBLE_CRITERIA,
  };
}

/** 单场事件复核：conditions 为 {grade, score, high_cloud_pct, mid_cloud_pct, low_cloud_pct, ...} */
async function verifyEvent(conditions, opts) {
  const res = await systemOne(conditions, { plausible: plausibleQuestion(conditions) }, opts);
  if (!res.ok) return res;
  return { ok: true, p: res.answers.plausible.noul, model: res.model };
}

/** 批量复核：每个城市一条问题、条件嵌在自己的 instructions 里，一次请求 */
async function verifyCities(cities, opts) {
  const questions = {};
  cities.forEach(function (c, i) { questions['c' + i] = plausibleQuestion(c); });
  const res = await systemOne({ note: 'Each question embeds its own city conditions.' }, questions, opts);
  if (!res.ok) return res;
  const out = cities.map(function (c, i) {
    return res.answers['c' + i] ? res.answers['c' + i].noul : null;
  });
  return { ok: true, scores: out, model: res.model };
}

module.exports = { systemOne, verifyEvent, verifyCities, hasKey, apiKey, PLAUSIBLE_RULES, PLAUSIBLE_CRITERIA };
