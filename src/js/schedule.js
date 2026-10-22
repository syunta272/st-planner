// スケジュール自動配分(要件6章)。Web版の sched() と同じ計算で、同じ入力なら同じ結果になる。
import { addDays, dow, weekStart, isHoliday, toMin, hm } from "./dates.js";

const sum = a => a.reduce((x, y) => x + y, 0);

export const finalSpecial = st => st.specials.find(x => x.type === "final" && x.start);
export const specialOn = (st, ds, type) =>
  st.specials.find(x => x.type === type && x.start && ds >= x.start && ds <= (x.end || x.start));

export function bandFor(s, ds) {
  const w = dow(ds);
  return w === 0 || w === 6 || isHoliday(ds) ? s.holiday : s.weekday;
}

// 学習日 = 復習の日・学習しない日・模試・通し演習・直前期を除いた日。祝日はいったん含め、あとで同じ週に寄せる。
export function isStudyDay(st, ds) {
  const s = st.settings, w = dow(ds);
  if (ds >= s.examDate || w === s.reviewDow || s.offDows.includes(w)) return false;
  if (["off", "mock", "full"].some(t => specialOn(st, ds, t))) return false;
  const fin = finalSpecial(st);
  return !(fin && ds >= fin.start);
}

// 問題番号の範囲 [[from, to], ...] の操作
export const count = rs => sum(rs.map(([f, t]) => t - f + 1));
function complement(q, used) {
  const mark = new Uint8Array(q + 2), out = [];
  for (const [f, t] of used) for (let i = f; i <= t && i <= q; i++) mark[i] = 1;
  let st = 0;
  for (let i = 1; i <= q + 1; i++) {
    if (i <= q && !mark[i]) { if (!st) st = i; } else if (st) { out.push([st, i - 1]); st = 0; }
  }
  return out;
}
function take(rs, offset, n) {
  const out = [];
  for (const [f, t] of rs) {
    if (n <= 0) break;
    const len = t - f + 1;
    if (offset >= len) { offset -= len; continue; }
    const a = f + offset, b = Math.min(t, a + n - 1);
    out.push([a, b]); n -= b - a + 1; offset = 0;
  }
  return out;
}
const fmtRound = (f, t) => t <= 100 ? `午前${f}〜${t}` : f > 100 ? `午後${f - 100}〜${t - 100}` : `午前${f}〜100・午後1〜${t - 100}`;
export const fmtRanges = (rs, round) => rs.map(([f, t]) => round ? fmtRound(f, t) : `${f}〜${t}問目`).join("・");
export const qLabel = a => `過去問『${a.label}』 ${a.n}問(${fmtRanges(a.ranges, a.round)}/全${a.tot}問)`;

// 問題集から配分の単位を作る。分野別の本は分野ごと、回ごとの本は回ごと。
export function buildUnits(st) {
  const multi = st.books.length > 1, units = [];
  for (const b of st.books) {
    const tag = multi ? `(${b.short || b.name.slice(0, 6)})` : "";
    if (b.layout === "round") b.rounds.forEach((r, j) => { if (r.q > 0) units.push({ key: `${b.id}:r${j}`, label: r.label + tag, area: null, q: +r.q, round: true }); });
    else b.areaQ.forEach((q, i) => { if (q > 0) units.push({ key: `${b.id}:a${i}`, label: st.areas[i].name + tag, area: i, q: +q, round: false }); });
  }
  return units;
}

// 手順2・3: 日数を問題数に比例して割り振り(各最低1日)、印を等間隔に置いて日付を割り当てる。
export function spreadDays(Q, D) {
  const n = D.length, N = Q.length, k = Q.map(() => 1);
  for (let r = n - N; r > 0; r--) { let b = 0; Q.forEach((v, i) => { if (v / k[i] > Q[b] / k[b]) b = i; }); k[b]++; }
  const pos = [];
  Q.forEach((q, i) => { for (let j = 0; j < k[i]; j++) pos.push([(j + 0.5) * n / k[i], i]); });
  pos.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const dd = Q.map(() => []);
  pos.forEach((x, t) => dd[x[1]].push(D[t]));
  return { k, dd };
}

const mkAssign = (u, rs) => ({
  key: `q:${u.key}:${rs.map(r => r.join("-")).join(",")}`, unit: u.key, label: u.label,
  area: u.area, round: u.round, ranges: rs, n: count(rs), tot: u.q,
});

export function allocate(units, D) {
  if (!units.length) return { ok: true, m: {}, blocks: [] };
  if (D.length < units.length) return { ok: false, m: {}, blocks: [] };
  const Q = units.map(u => u.count), { k, dd } = spreadDays(Q, D), m = {}, blocks = [];
  units.forEach((u, i) => {
    let dn = 0;
    dd[i].forEach((ds, j) => { // 手順4: j日目の終わりの番号 = 問題数 ×(j+1)÷ 日数(四捨五入)
      const to = Math.round(Q[i] * (j + 1) / k[i]);
      if (to > dn) (m[ds] ||= []).push(mkAssign(u, take(u.remaining, dn, to - dn)));
      dn = to;
    });
    blocks.push({ unit: u, days: dd[i] });
  });
  return { ok: true, m, blocks };
}

export const isDone = (st, ds, a) => (st.done[ds] || []).includes(a.key);

function nextReviewDay(st, from) {
  const s = st.settings;
  for (let i = 0, d = from; i < 14 && d < s.examDate; i++, d = addDays(d, 1))
    if (dow(d) === s.reviewDow && !specialOn(st, d, "off")) return d;
  return null;
}

// 祝日に学習しない設定なら、その日の分を同じ週のいちばん少ない学習日に寄せる(週の問題数は変えない)。
function moveHolidays(st, m, D) {
  if (st.settings.holidayStudy) return;
  for (const ds of D) {
    if (!isHoliday(ds) || !m[ds]) continue;
    const ok = d => d !== ds && !isHoliday(d);
    let cand = D.filter(d => ok(d) && weekStart(d) === weekStart(ds));
    if (!cand.length) cand = D.filter(d => ok(d) && d > ds).slice(0, 1);
    if (!cand.length) cand = D.filter(ok).slice(-1);
    if (!cand.length) continue;
    const load = d => sum((m[d] || []).map(a => a.n));
    const to = cand.reduce((b, d) => load(d) < load(b) ? d : b);
    (m[to] ||= []).push(...m[ds].map(a => ({ ...a, fromHoliday: ds })));
    delete m[ds];
  }
}

// 計画の作成と作り直し(F-04・F-10・F-12)。fromDate より前の日はそのまま残し、
// 済んでいない問題は設定に応じて残りの学習日に配り直すか、次の復習の日に回す。
export function generatePlan(st, fromDate) {
  const s = st.settings, units = buildUnits(st), keys = new Set(units.map(u => u.key));
  const old = st.plan?.m || {}, m = {}, used = {}, carry = [];
  const use = a => (used[a.unit] ||= []).push(...a.ranges);
  for (const ds of Object.keys(old).sort()) for (const a0 of old[ds]) {
    const a = { ...a0 };
    if (ds >= fromDate) { // 未来の日は作り直す。復習の日に回した解き残しと、もう済ませた分は残す
      if ((a.carried || isDone(st, ds, a)) && keys.has(a.unit)) { (m[ds] ||= []).push(a); use(a); }
      continue;
    }
    (m[ds] ||= []).push(a);
    if (!keys.has(a.unit) || a.moved) continue;
    if (isDone(st, ds, a)) { use(a); continue; }
    a.moved = true;
    if (s.leftover === "review") carry.push(a);
  }
  const rd = carry.length && nextReviewDay(st, fromDate);
  if (rd) for (const a of carry) { const c = { ...a, moved: false, carried: true, origin: a.origin || "" }; (m[rd] ||= []).push(c); use(c); }

  const live = units.map(u => {
    const remaining = complement(u.q, used[u.key] || []);
    return { ...u, remaining, count: count(remaining) };
  }).filter(u => u.count > 0);
  const start = s.qStart && fromDate > s.qStart ? fromDate : s.qStart, D = [];
  if (start && s.qEnd) for (let d = start; d <= s.qEnd; d = addDays(d, 1)) if (isStudyDay(st, d)) D.push(d);
  const r = allocate(live, D);
  for (const [ds, list] of Object.entries(r.m)) (m[ds] ||= []).push(...list);
  moveHolidays(st, m, D);
  return { m, ok: r.ok, days: D.length, units: live.length, total: sum(live.map(u => u.count)), blocks: r.blocks.map(b => ({ label: b.unit.label, count: b.unit.count, days: b.days })), from: fromDate };
}

// 1周後(過去問の終了日〜直前期)は、重点度の比率で分野の日を割り振る。
let postCache = { key: "", map: {} };
function postMap(st) {
  const s = st.settings, fin = finalSpecial(st);
  const key = JSON.stringify([s.qEnd, s.examDate, s.reviewDow, s.offDows, s.weightRatio, st.areas.map(a => a.weight), st.specials]);
  if (postCache.key === key) return postCache.map;
  const D = [], map = {};
  if (s.qEnd) for (let d = addDays(s.qEnd, 1); d < s.examDate && !(fin && d >= fin.start); d = addDays(d, 1)) if (isStudyDay(st, d)) D.push(d);
  const idx = st.areas.map((a, i) => i).filter(i => (s.weightRatio[st.areas[i].weight] || 0) > 0);
  const Q = idx.map(i => s.weightRatio[st.areas[i].weight]);
  if (D.length >= Q.length && Q.length) spreadDays(Q, D).dd.forEach((days, j) => days.forEach(d => { map[d] = idx[j]; }));
  else D.forEach((d, j) => { if (idx.length) map[d] = idx[j % idx.length]; });
  postCache = { key, map };
  return map;
}

// 今週の復習(F-03)で「反映」した弱点分野を、次の復習の日までの学習日に順に割り振る。
function focusFor(st, ds) {
  const s = st.settings;
  for (let i = 1; i <= 7; i++) {
    const r = addDays(ds, -i);
    if (dow(r) !== s.reviewDow) continue;
    const f = st.focus[r]; // { from: 反映した日, list: 分野の番号 }
    if (!f?.list?.length || ds < f.from) return null;
    let n = 0;
    for (let d = f.from; d < ds; d = addDays(d, 1)) if (isStudyDay(st, d)) n++;
    return st.areas[f.list[n % f.list.length]]?.name || null;
  }
  return null;
}

const T = label => ({ key: "b:" + label, label });
function blocks(start, items) {
  let t = start;
  return items.map(([label, min, assign]) => {
    const x = { key: assign ? assign.key : "b:" + label, label: `${hm(t)}-${hm(t + min)} ${label}`, min };
    if (assign) x.assign = { area: assign.area, n: assign.n, label: assign.label, round: assign.round };
    t += min;
    return x;
  });
}
const qMin = (s, a) => Math.max(5, Math.round(a.n * s.mpq / 5) * 5);

export function computeDay(st, ds) {
  const s = st.settings;
  if (ds === s.examDate) return [T("試験日(時間・会場は公式発表で確認)")];
  if (ds > s.examDate) return [];
  const band = bandFor(s, ds), start = toMin(band.start), total = toMin(band.end) - start, w = dow(ds), BR = ["休憩", +s.breakMin];
  const off = specialOn(st, ds, "off");
  if (off || s.offDows.includes(w)) return [T("学習しない日" + (off?.memo ? `(${off.memo})` : ""))];
  const ev = specialOn(st, ds, "mock") || specialOn(st, ds, "full");
  if (ev) {
    const head = ev.type === "mock" ? `【模試】${ev.name || "模試"} ${ev.from}-${ev.to}` : `${ev.from}-${ev.to} ${ev.name || "通し演習"}(本番の時間配分で)`;
    return [T(head), ...blocks(start, [["採点して分野別の正答率を進捗入力", 60], BR, ["間違いを知識不足/読み違い/ケアレスミスに分類", 70], ["わからなかった所をテキスト・必修チェックで確認", 40]])];
  }
  const fin = finalSpecial(st);
  if (fin && ds >= fin.start) return blocks(toMin(fin.from), [["必修チェックを軽く確認して早めに就寝", Math.max(0, toMin(fin.to) - toMin(fin.from))]]);
  const list = st.plan?.m[ds] || [];
  if (w === s.reviewDow) {
    const wk = [];
    for (let i = 6; i >= 1; i--) for (const a of st.plan?.m[addDays(ds, -i)] || []) if (!a.carried && !wk.includes(a.label)) wk.push(a.label);
    return blocks(start, [...list.map(a => ["解き残し: " + qLabel(a), qMin(s, a), a]), ["今週の間違いノートを見直し", 50], BR,
      [(wk.length ? `今週の分野(${wk.join("・")})` : "今週") + "の間違い・わからなかった問題を解き直し", 70], ["テキスト・必修チェックで弱点を確認", 40], ["来週の予定確認・進捗入力", 10]]);
  }
  if (isHoliday(ds) && !s.holidayStudy && !list.length) return [T("祝日(学習しない設定)")];
  const pr = specialOn(st, ds, "practicum"), pre = pr && +pr.reserve ? [["実習症例を分野に結びつけてメモ", +pr.reserve]] : [];
  const focus = focusFor(st, ds), weak = focus ? `(弱点: ${focus})` : "";
  const rest = used => Math.max(0, total - used - s.breakMin - 20);
  if (list.length) {
    const qs = list.map(a => [qLabel(a) + (a.fromHoliday ? "(祝日分)" : ""), qMin(s, a), a]);
    return blocks(start, [...pre, ...qs, BR, ["過去問でわからなかった所をテキスト・必修チェックで確認" + weak, rest(sum([...pre, ...qs].map(x => x[1])))], ["間違いノート・進捗入力", 20]]);
  }
  const post = s.qEnd && ds > s.qEnd ? postMap(st)[ds] : undefined;
  if (post !== undefined) {
    const name = st.areas[post].name, solve = Math.min(80, rest(sum(pre.map(x => x[1]))));
    return blocks(start, [...pre, [`『${name}』の間違えた問題を解き直し`, solve], BR, [`『${name}』の弱点をテキスト・必修チェックで確認${weak}`, rest(sum(pre.map(x => x[1])) + solve)], ["間違いノート・進捗入力", 20]]);
  }
  return blocks(start, [...pre, ["テキスト・必修チェックで学習" + weak, rest(sum(pre.map(x => x[1])))], BR, ["間違いノート・進捗入力", 20]]);
}

// 過ぎた日は表示を固定し、条件を変えても組み直さない(F-10)。
export function dayTasks(st, ds, today) {
  if (st.edits[ds]) return st.edits[ds];
  if (today && ds < today && st.frozen[ds]) return st.frozen[ds];
  return computeDay(st, ds);
}

export function freezePast(st, today) {
  const y = addDays(today, -1);
  let d = st.frozenThrough ? addDays(st.frozenThrough, 1) : st.settings.setupDate || today;
  for (let g = 0; d <= y && g < 800; g++, d = addDays(d, 1)) if (!st.frozen[d]) st.frozen[d] = computeDay(st, d);
  if (!st.frozenThrough || y > st.frozenThrough) st.frozenThrough = y;
}

// 過ぎた日に済んでいない問題があり、まだ回し先を決めていないか
export const hasPendingLeftover = (st, today) =>
  Object.entries(st.plan?.m || {}).some(([ds, l]) => ds < today && l.some(a => !a.moved && !isDone(st, ds, a)));

// 1日の合計時間が学習時間帯に入りきらない日(受け入れ条件3)
export function overflowDays(st) {
  const s = st.settings, out = [];
  for (const [ds, list] of Object.entries(st.plan?.m || {})) {
    if (dow(ds) === s.reviewDow) continue;
    const band = bandFor(s, ds), pr = specialOn(st, ds, "practicum");
    const need = sum(list.map(a => qMin(s, a))) + (pr ? +pr.reserve || 0 : 0) + +s.breakMin + 20;
    if (need > toMin(band.end) - toMin(band.start)) out.push(ds);
  }
  return out.sort();
}

// 分野ごとの直近3回の正答率と、解いた問題数の合計
export function areaStats(st) {
  return st.areas.map((a, i) => {
    const L = st.logs.filter(l => l.area === i && l.rate != null).sort((x, y) => x.date < y.date ? -1 : 1).slice(-3);
    return { rate: L.length ? sum(L.map(l => l.rate)) / L.length : null, solved: sum(st.logs.filter(l => l.area === i).map(l => +l.solved || 0)) };
  });
}

// 目標を下回る分野を正答率の低い順に、未計測の分野をそのあとに並べる(Web版と同じ)
export function weakList(st) {
  const S = areaStats(st), t = st.settings.targetRate, idx = st.areas.map((a, i) => i);
  return [...idx.filter(i => S[i].rate != null && S[i].rate < t).sort((a, b) => S[a].rate - S[b].rate), ...idx.filter(i => S[i].rate == null)];
}

// アプリを開いたときに表示する、記録のない学習日(通知の代わり)
export function unrecordedDays(st, today) {
  const s = st.settings, out = [], logged = new Set(st.logs.map(l => l.date));
  const from = [s.qStart, s.setupDate].filter(Boolean).sort().pop();
  if (!from) return out;
  for (let d = addDays(today, -1); d >= from && out.length < 7; d = addDays(d, -1))
    if ((st.plan?.m[d] || []).length && !logged.has(d)) out.push(d);
  return out;
}
