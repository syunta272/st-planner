// 受け入れ条件(要件6章)の確認。test.html をブラウザで開くと実行される。
import { addDays, dow, isHoliday } from "./dates.js";
import { sampleState, PRESETS, newId } from "./defaults.js";
import * as SC from "./schedule.js";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

// Web版の sched() をそのまま写したもの(比較用)
function webSched(q, qs, qe) {
  const S0 = "2026-10-21", E = "2027-02-20", MK = ["2026-12-06", "2026-12-09", "2026-12-16", "2026-12-23"];
  const SP = d => MK.includes(d) || ["2026-12-05", "2027-02-06", "2027-02-13"].includes(d) || d >= "2027-02-17";
  const wdx = s => (dow(s) + 6) % 7, D = [];
  for (let d = qs; d <= qe; d = addDays(d, 1)) if (d >= S0 && d <= E && !SP(d) && wdx(d) != 6) D.push(d);
  const n = D.length, N = q.length, k = q.map(() => 1);
  for (let r = n - N; r > 0; r--) { let b = 0; q.forEach((v, i) => { if (v / k[i] > q[b] / k[b]) b = i; }); k[b]++; }
  const m = {}, pos = [];
  q.forEach((x, i) => { for (let j = 0; j < k[i]; j++) pos.push([(j + .5) * n / k[i], i]); });
  pos.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const dd = q.map(() => []); pos.forEach((x, t) => dd[x[1]].push(D[t]));
  q.forEach((qq, i) => { let dn = 0; dd[i].forEach((ds, j) => { const to = Math.round(qq * (j + 1) / k[i]); m[ds] = { i, from: dn + 1, to }; dn = to; }); });
  return { D, m };
}

const plan = st => { st.plan = SC.generatePlan(st, "2026-10-22"); return st.plan; };

// 1. 本人の設定例: 学習日48日、Web版と同じ結果、同じ分野の連続0日
{
  const st = sampleState(), p = plan(st), web = webSched(st.books[0].areaQ, "2026-11-01", "2026-12-31");
  check("学習日が48日", p.days === 48, `${p.days}日`);
  const dates = Object.keys(p.m).sort();
  const same = dates.length === web.D.length && dates.every(d => {
    const a = p.m[d][0], w = web.m[d];
    return p.m[d].length === 1 && w && a.area === w.i && a.ranges[0][0] === w.from && a.ranges.at(-1)[1] === w.to;
  });
  check("Web版と同じ割り振り", same);
  let consec = 0;
  for (let i = 1; i < dates.length; i++) if (p.m[dates[i]][0].area === p.m[dates[i - 1]][0].area) consec++;
  check("同じ分野が続く日が0日", consec === 0, `${consec}日`);
  const total = Object.values(p.m).flat().reduce((a, x) => a + x.n, 0);
  check("割り振った問題数の合計 = 入力した合計(2300)", total === 2300, `${total}問`);
  check("学習時間帯からはみ出す日がない", SC.overflowDays(st).length === 0, SC.overflowDays(st).join(","));
  const t = SC.computeDay(st, dates[0]);
  check("時間割が17:00から始まる", t[0].label.startsWith("17:00-"), t[0].label);
  check("実習中は症例メモの時間を取る", t.some(x => x.label.includes("症例")), t.map(x => x.label).join(" / "));
  const sun = SC.computeDay(st, "2026-11-08");
  check("復習の日は過去問を入れない", sun.every(x => !x.assign) && sun.some(x => x.label.includes("今週の分野")), sun[2]?.label);
}

// 2. 入りきらない場合は警告できる
{
  const st = sampleState();
  st.settings.weekday = { start: "17:00", end: "18:00" }; st.settings.holiday = { start: "17:00", end: "18:00" };
  plan(st);
  check("入りきらない日を検出する", SC.overflowDays(st).length > 0, `${SC.overflowDays(st).length}日`);
}

// 3. 祝日に学習しない: 祝日の分は同じ週に寄せ、合計は変わらない
{
  const st = sampleState(); st.settings.holidayStudy = false;
  const p = plan(st), hol = Object.keys(p.m).filter(isHoliday);
  const total = Object.values(p.m).flat().reduce((a, x) => a + x.n, 0);
  const moved = Object.values(p.m).flat().filter(a => a.fromHoliday);
  check("祝日に過去問が入らない", hol.length === 0, hol.join(","));
  check("祝日の分を同じ週に寄せる", moved.length > 0 && moved.every(a => Object.entries(p.m).some(([d, l]) => l.includes(a) && addDays(d, -((dow(d) + 6) % 7)) === addDays(a.fromHoliday, -((dow(a.fromHoliday) + 6) % 7)))), `${moved.length}件`);
  check("祝日に学習しなくても合計は2300", total === 2300, `${total}問`);
}

// 4. 解き残し: 残りの日に配り直す / 復習の日に回す
for (const mode of ["spread", "review"]) {
  const st = sampleState(); st.settings.leftover = mode;
  st.plan = SC.generatePlan(st, "2026-11-01");
  const days = Object.keys(st.plan.m).sort(), d1 = days[0], d2 = days[1];
  st.done[d1] = st.plan.m[d1].map(a => a.key); // 1日目だけ済ませ、2日目は解き残す
  const left = st.plan.m[d2][0];
  st.plan = SC.generatePlan(st, addDays(d2, 1));
  const all = Object.entries(st.plan.m).filter(([d]) => d > d2).flatMap(([, l]) => l);
  const covered = all.filter(a => a.unit === left.unit).some(a => a.ranges.some(([f, t]) => f <= left.ranges[0][0] && left.ranges[0][0] <= t));
  const total = all.reduce((a, x) => a + x.n, 0) + st.plan.m[d1].reduce((a, x) => a + x.n, 0);
  check(`解き残し(${mode === "spread" ? "残りの日" : "復習の日"})を回し先に入れる`, covered);
  check(`解き残し(${mode === "spread" ? "残りの日" : "復習の日"})のあとも合計は2300`, total === 2300, `${total}問`);
  if (mode === "review") {
    const rd = Object.keys(st.plan.m).find(d => st.plan.m[d].some(a => a.carried));
    check("解き残しは次の復習の日(日曜)に入る", rd && dow(rd) === 0, rd);
    check("復習の日の時間割に解き残しが出る", SC.computeDay(st, rd)[0].label.includes("解き残し"), SC.computeDay(st, rd)[0].label);
  }
}

// 5. 回ごとの問題集は回と問題番号で割り振る
{
  const st = sampleState(); st.books = [{ id: newId(), ...PRESETS.daiyo() }];
  const p = plan(st), a = Object.values(p.m).flat()[0];
  check("回ごとの本は『第26回 午前…』の形で出る", /第2\d回/.test(a.label) && SC.qLabel(a).includes("午前"), SC.qLabel(a));
  const total = Object.values(p.m).flat().reduce((x, y) => x + y.n, 0);
  check("回ごとの本も合計600問を配り切る", total === 600, `${total}問`);
}

// 6. 祝日の計算
check("2026年の祝日(秋分の日9/23・国民の休日9/22・振替なし)", isHoliday("2026-09-23") && isHoliday("2026-09-22") && isHoliday("2026-11-23") && isHoliday("2027-01-11"));
check("祝日でない日", !isHoliday("2026-11-24") && !isHoliday("2026-12-25"));

const ok = results.filter(r => r.ok).length;
document.body.innerHTML = `<h1>${ok}/${results.length} 件 OK</h1><ul>${results.map(r => `<li style="color:${r.ok ? "green" : "crimson"}">${r.ok ? "OK" : "NG"} ${r.name} <small>${r.detail}</small></li>`).join("")}</ul>`;
window.testResults = results;
