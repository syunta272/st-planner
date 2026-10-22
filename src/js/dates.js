// 日付はすべて "YYYY-MM-DD" の文字列で扱う。今日の日付は日本時間で決める(要件7章)。
export const p2 = n => String(n).padStart(2, "0");
export const P = s => new Date(s + "T00:00");
export const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const addDays = (s, n) => { const d = P(s); d.setDate(d.getDate() + n); return ymd(d); };
export const dow = s => P(s).getDay(); // 0=日
export const weekStart = s => addDays(s, -((dow(s) + 6) % 7)); // 月曜はじまり
export const diffDays = (a, b) => Math.round((P(b) - P(a)) / 864e5);
export const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
export const toMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const hm = m => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
export const md = s => `${+s.slice(5, 7)}/${+s.slice(8)}`;
export const WD = "日月火水木金土";
export const label = s => `${+s.slice(0, 4)}年${md(s)}(${WD[dow(s)]})`;

// 日本の祝日(振替休日・国民の休日を含む)。毎年の更新が要らないよう計算で求める。
const cache = {};
function holidaysOf(y) {
  if (cache[y]) return cache[y];
  const set = new Set(), add = (m, d) => set.add(`${y}-${p2(m)}-${p2(d)}`);
  const nthMon = (m, n) => 1 + ((8 - new Date(y, m - 1, 1).getDay()) % 7) + (n - 1) * 7;
  [[1, 1], [2, 11], [2, 23], [4, 29], [5, 3], [5, 4], [5, 5], [8, 11], [11, 3], [11, 23]].forEach(([m, d]) => add(m, d));
  add(1, nthMon(1, 2)); add(7, nthMon(7, 3)); add(9, nthMon(9, 3)); add(10, nthMon(10, 2));
  const f = Math.floor((y - 1980) / 4);
  add(3, Math.floor(20.8431 + 0.242194 * (y - 1980)) - f);
  add(9, Math.floor(23.2488 + 0.242194 * (y - 1980)) - f);
  for (const d of [...set].sort()) { // 国民の休日: 祝日に挟まれた平日
    const n2 = addDays(d, 2);
    if (set.has(n2) && !set.has(addDays(d, 1)) && dow(addDays(d, 1)) !== 0) set.add(addDays(d, 1));
  }
  for (const d of [...set].sort()) { // 振替休日
    if (dow(d) !== 0) continue;
    let n = addDays(d, 1);
    while (set.has(n)) n = addDays(n, 1);
    set.add(n);
  }
  return (cache[y] = set);
}
export const isHoliday = s => holidaysOf(+s.slice(0, 4)).has(s);
