// カレンダー書き出し(F-11): 今日から試験日までの予定を .ics にする。
// 1日1件(学習時間帯いっぱい)で、件名にその日の中身、説明に時間割を入れる。
import { addDays, toMin, p2 } from "./dates.js";
import * as SC from "./schedule.js";

const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// 75オクテットごとに折り返す(RFC 5545)。日本語の途中で切らないよう文字単位で数える。
function fold(line) {
  const enc = new TextEncoder(), out = [];
  let cur = "", len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

// 日本時間の日付と分 → UTC の "YYYYMMDDTHHMMSSZ"
function utc(ds, min) {
  const d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10), 0, min - 9 * 60));
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
}
const ymd8 = ds => ds.replace(/-/g, "");
const timeOf = label => label.match(/^(\d\d:\d\d)-(\d\d:\d\d) (.*)$/);

// その日の予定を1件にまとめる。予定がない日・学習しない日は入れない。
export function dayEvent(st, ds, today) {
  const tasks = SC.dayTasks(st, ds, today);
  if (!tasks.length) return null;
  const s = st.settings, timed = tasks.map(t => timeOf(t.label)).filter(Boolean);
  const plain = tasks.filter(t => !timeOf(t.label)).map(t => t.label);
  if (!timed.length && plain.some(l => l.startsWith("学習しない日") || l.startsWith("祝日"))) return null;
  const qs = tasks.filter(t => t.assign).map(t => `${t.assign.label} ${t.assign.n}問`);
  const exam = plain.find(l => l.startsWith("【模試】") || /通し演習/.test(l));
  const head = ds === s.examDate ? "試験日"
    : exam ? exam.replace("【模試】", "模試: ").replace(/\s*\d\d:\d\d-\d\d:\d\d\s*/, " ")
    : qs.length ? (timed.some(t => t[3].startsWith("解き残し")) ? "復習の日・解き残し " : "過去問 ") + qs.join("・")
    : timed.some(t => /今週の間違いノート/.test(t[3])) ? "復習の日"
    : timed.filter(t => t[3] !== "休憩").sort((a, b) => (toMin(b[2]) - toMin(b[1])) - (toMin(a[2]) - toMin(a[1])))[0]?.[3] || plain[0];
  const desc = tasks.map(t => t.label).join("\n");
  const ev = { uid: `${ymd8(ds)}@st-planner`, summary: `【ST国試】${head.trim()}`, desc };
  if (ds === s.examDate || !timed.length) return { ...ev, allDay: ds };
  const ex = plain.map(l => l.match(/(\d\d:\d\d)-(\d\d:\d\d)/)).filter(Boolean); // 模試・通し演習の時間帯
  const starts = [...timed.map(t => toMin(t[1])), ...ex.map(m => toMin(m[1]))], ends = [...timed.map(t => toMin(t[2])), ...ex.map(m => toMin(m[2]))];
  return { ...ev, start: utc(ds, Math.min(...starts)), end: utc(ds, Math.max(...ends)) };
}

export function buildIcs(st, today, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const seq = Math.floor(now.getTime() / 60000) % 2e9; // 書き出すたびに増やし、読み込み直したときに新しい方を優先させる
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//st-planner//JA", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:ST国試", "X-WR-TIMEZONE:Asia/Tokyo"];
  for (let d = today; d <= st.settings.examDate; d = addDays(d, 1)) {
    const e = dayEvent(st, d, today);
    if (!e) continue;
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `SEQUENCE:${seq}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${ymd8(e.allDay)}`, `DTEND;VALUE=DATE:${ymd8(addDays(e.allDay, 1))}`);
    else lines.push(`DTSTART:${e.start}`, `DTEND:${e.end}`);
    lines.push(`SUMMARY:${esc(e.summary)}`, `DESCRIPTION:${esc(e.desc)}`, "TRANSP:OPAQUE", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
