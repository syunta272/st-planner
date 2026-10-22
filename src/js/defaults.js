// アプリに同梱する初期データ(要件8章)。年度や個人の条件はここに書かず、入力値から計算する。
export const AREAS = ["Ⅰ 基礎医学", "Ⅱ 臨床医学", "Ⅲ 臨床歯科医学・口腔外科学", "Ⅳ 音声・言語・聴覚医学", "Ⅴ 心理学", "Ⅵ 音声・言語学", "Ⅶ 社会福祉・教育", "Ⅷ 言語聴覚障害学", "Ⅸ 失語症", "Ⅹ 高次脳機能障害", "Ⅺ 言語発達障害学", "Ⅻ 発声発語・摂食嚥下障害学", "XIII 聴覚障害学"];

// データベース10年間+300 の分野別問題数(本人が数えた値)。合計だけわかる問題集の仮振り分けにも使う。
export const DB_Q = [90, 264, 36, 142, 253, 280, 89, 71, 159, 73, 224, 339, 280];

export const WEIGHTS = [["thick", "厚め"], ["normal", "標準"], ["light", "軽め"]];

export const newId = () => Math.random().toString(36).slice(2, 10);

export function distributeByDb(total) {
  const sum = DB_Q.reduce((a, b) => a + b, 0);
  const raw = DB_Q.map(q => total * q / sum), out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).slice(0, rest).forEach(([, i]) => out[i]++);
  return out;
}

const rounds = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ label: `第${from + i}回`, q: 200 }));

// 問題集の入力例(要件2章の表)。値は配布前に現物で確認する。
export const PRESETS = {
  db: () => ({ name: "2026年版 言語聴覚士国家試験データベース10年間+300", short: "DB", publisher: "GLANZ PLANNING", layout: "area", areaQ: [...DB_Q] }),
  hisshu: () => ({ name: "言語聴覚士国家試験必修ポイント(ST基礎科目・ST専門科目)", short: "必修", publisher: "医歯薬出版", layout: "area", areaQ: distributeByDb(2000), provisional: true }),
  daiyo: () => ({ name: "2026年版 言語聴覚士国家試験過去問題3年間の解答と解説", short: "3年間", publisher: "大揚社", layout: "round", rounds: rounds(26, 28), provisional: true }),
};

// 学校の模試日程(配布時に入れておく)。日程は確定しだい差し替える。
export const SCHOOL_MOCKS = [
  { name: "学校模試1", start: "2026-12-06" }, { name: "学校模試2", start: "2026-12-09" },
  { name: "学校模試3", start: "2026-12-16" }, { name: "学校模試4", start: "2026-12-23" },
];

export function emptyState() {
  return {
    version: 1,
    settings: {
      setupDone: false, setupDate: null, examDate: "2027-02-20",
      weekday: { start: "17:00", end: "20:00" }, holiday: { start: "17:00", end: "20:00" }, breakMin: 10,
      qStart: "", qEnd: "", mpq: 1, reviewDow: 0, offDows: [], holidayStudy: true, leftover: "spread",
      targetRate: 70, weightRatio: { thick: 3, normal: 2, light: 1 }, lastBackup: null, theme: "system", fontScale: 1,
    },
    areas: AREAS.map(name => ({ name, weight: "normal" })),
    books: [],
    specials: SCHOOL_MOCKS.map(m => ({ id: newId(), type: "mock", name: m.name, start: m.start, from: "09:00", to: "16:00" })),
    plan: null, done: {}, edits: {}, frozen: {}, frozenThrough: null, focus: {}, logs: [],
  };
}

// 本人の設定例(要件2章)。動作確認用のサンプル。
export function sampleState() {
  const s = emptyState();
  Object.assign(s.settings, { qStart: "2026-11-01", qEnd: "2026-12-31" });
  const thick = [4, 5, 8, 9, 12], light = [0, 1, 6];
  s.areas.forEach((a, i) => { a.weight = thick.includes(i) ? "thick" : light.includes(i) ? "light" : "normal"; });
  s.books = [{ id: newId(), ...PRESETS.db() }];
  s.specials = [
    { id: newId(), type: "practicum", start: "2026-09-28", end: "2026-11-30", reserve: 15 },
    ...["2026-12-06", "2026-12-09", "2026-12-16", "2026-12-23"].map((d, i) => ({ id: newId(), type: "mock", name: `模試${i + 1}`, start: d, from: "09:00", to: "16:00" })),
    { id: newId(), type: "full", name: "第28回 通し演習", start: "2026-12-05", from: "10:00", to: "16:00" },
    { id: newId(), type: "full", name: "通し演習", start: "2027-02-06", from: "10:00", to: "16:00" },
    { id: newId(), type: "full", name: "通し演習", start: "2027-02-13", from: "10:00", to: "16:00" },
    { id: newId(), type: "final", start: "2027-02-17", from: "17:00", to: "17:45" },
  ];
  return s;
}
