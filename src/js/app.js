import * as D from "./dates.js";
import { PRESETS, WEIGHTS, emptyState, sampleState, distributeByDb, newId } from "./defaults.js";
import * as SC from "./schedule.js";
import { loadState, saveState, exportBackup, saveTextFile, parseBackup, readFileText } from "./store.js";
import { buildIcs } from "./ics.js";

let state, view = "today", cur = D.today(), step = 0, quick = null, logEdit = null, logKind = "normal", setupErr = "";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VIEWS = [["today", "今日"], ["log", "記録"], ["review", "復習"], ["plan", "計画"], ["stats", "成績"]];
const AREA_OPTS = () => state.areas.map((a, i) => [i, a.name]);

/* ---------- 入力欄と state のひも付け ---------- */
const get = p => p.split(".").reduce((x, k) => x?.[k], state);
function set(p, v) { const ks = p.split("."), last = ks.pop(); ks.reduce((x, k) => x[k], state)[last] = v; }
const inp = (p, type = "text", attrs = "") => `<input type="${type}" data-bind="${p}" value="${esc(get(p))}" ${attrs}>`;
const num = (p, attrs = "") => inp(p, "number", `data-num ${attrs}`);
const sel = (p, opts, isNum = false) => `<select data-bind="${p}" ${isNum ? "data-num" : ""}>${opts.map(([v, l]) => `<option value="${v}" ${String(get(p)) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
const chk = (p, label) => `<label class="chk"><input type="checkbox" data-bind="${p}" data-bool ${get(p) ? "checked" : ""}> ${label}</label>`;
const dowsBox = p => `<div class="dows">${[1, 2, 3, 4, 5, 6, 0].map(w => `<label class="chk"><input type="checkbox" data-dows="${p}" value="${w}" ${get(p).includes(w) ? "checked" : ""}>${D.WD[w]}</label>`).join("")}</div>`;
const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
const DOW_OPTS = [1, 2, 3, 4, 5, 6, 0].map(w => [w, D.WD[w] + "曜"]);

document.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.bind) {
    let v = el.dataset.bool !== undefined ? el.checked : el.value;
    if (el.dataset.num !== undefined) v = v === "" ? 0 : +v;
    set(el.dataset.bind, v);
    changed(el.dataset.bind);
  } else if (el.dataset.dows) {
    set(el.dataset.dows, [...document.querySelectorAll(`[data-dows="${el.dataset.dows}"]:checked`)].map(x => +x.value));
    changed(el.dataset.dows);
  } else if (el.dataset.file && el.files[0]) {
    FILE[el.dataset.file](el.files[0]).finally(() => { el.value = ""; });
  } else if (el.id === "lg-solved" || el.id === "lg-correct") autoRate();
});
document.addEventListener("input", e => { if (["lg-solved", "lg-correct", "q-solved", "q-correct"].includes(e.target.id)) autoRate(); });
document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el || !ACT[el.dataset.act]) return;
  if (!["next", "finish"].includes(el.dataset.act)) setupErr = "";
  ACT[el.dataset.act](el.dataset.arg, el);
});

// 前提条件を変えたら、まだ来ていない日だけを組み直す(F-10)
function changed(p) {
  setupErr = "";
  if (/^settings\.(theme|fontScale)$/.test(p)) applyTheme();
  else if (!/^settings\.(targetRate|lastBackup|calendar)$/.test(p)) replan();
  persist();
  render();
}
function replan() {
  const t = D.today();
  if (state.settings.setupDone) SC.freezePast(state, t);
  state.plan = SC.generatePlan(state, t);
  if (state.settings.calendar && state.settings.lastIcsExport) state.icsStale = true; // カレンダーの書き出し直しを促す
}
const persist = () => saveState(state);
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }
function applyTheme() {
  const s = state.settings, r = document.documentElement;
  if (s.theme === "system") r.removeAttribute("data-theme"); else r.dataset.theme = s.theme;
  r.style.setProperty("--fs", s.fontScale || 1);
}

/* ---------- 画面 ---------- */
function render() {
  if (!state.settings.setupDone) { $("#app").innerHTML = `<div class="setup">${vSetup()}</div>`; return; }
  $("#app").innerHTML = `<nav class="side" aria-label="メニュー"><div class="brand">ST国試<br>学習プランナー<small>${esc(countdown())}</small></div>
    ${VIEWS.map(([k, l]) => `<button data-act="go" data-arg="${k}" class="${view === k ? "on" : ""}">${l}</button>`).join("")}
    <div class="sp"></div><button data-act="go" data-arg="settings" class="${view === "settings" ? "on" : ""}">⚙ 設定</button></nav>
    <main>${V[view]()}</main>`;
}
function countdown() {
  const n = D.diffDays(D.today(), state.settings.examDate);
  return n > 0 ? `試験まであと${n}日` : n === 0 ? "今日は試験日" : "試験日を過ぎました";
}

const V = {
  today() {
    const t = D.today(), s = state.settings, tasks = todayList();
    const banners = [];
    const lastB = s.lastBackup || s.setupDate;
    if (lastB && D.diffDays(lastB, t) >= 7) banners.push(`<div class="banner">${s.lastBackup ? `最後のバックアップから${D.diffDays(lastB, t)}日たちました。` : "まだバックアップを書き出していません。"}パソコンの故障に備えて書き出しておきましょう。 <button class="p" data-act="backup">いま書き出す</button></div>`);
    if (s.calendar && state.icsStale) banners.push(`<div class="banner info">計画が変わりました。Googleカレンダーの予定も新しくするには、書き出し直して読み込んでください。 <button class="p" data-act="ics">カレンダーに書き出す</button></div>`);
    if (cur === t) {
      const un = SC.unrecordedDays(state, t);
      if (un.length) banners.push(`<div class="banner info">記録がまだの日: ${un.map(d => `<button class="link" data-act="day" data-arg="${d}">${D.md(d)}</button>`).join(" ")}</div>`);
    }
    if (state.edits[cur]) banners.push(`<p class="mut">この日のタスクは手動で編集しています。</p>`);
    return `<h1>${cur === t ? "今日" : esc(D.label(cur))}</h1>
      <p class="mut">${esc(D.label(cur))} · <span class="countdown">${esc(countdown())}</span></p>
      ${banners.join("")}
      <div class="card"><div class="datenav"><button data-act="day" data-arg="-1">前の日</button>${`<input type="date" id="cur" value="${cur}">`}<button data-act="day" data-arg="1">次の日</button>${cur !== t ? `<button data-act="day" data-arg="${t}">今日へ</button>` : ""}</div>
      ${tasks.some(x => x.at) ? `<p class="mut">昨日の残りは、今日やれば計画はそのままです。今日もできなかった分は、明日「${s.leftover === "review" ? "次の復習の日" : "次の学習日"}」に回します。</p>` : ""}
      <ul class="tasks">${tasks.map(x => {
        const on = (state.done[x.at || cur] || []).includes(x.key);
        return `<li class="${on ? "done" : ""}"><label><input type="checkbox" data-act="toggle" data-arg="${esc(x.key)}" data-at="${x.at || ""}" ${on ? "checked" : ""}><span>${x.at ? '<span class="tag">昨日の残り</span> ' : ""}${esc(x.label)}</span></label>${quick === x.key && x.assign ? quickForm(x) : ""}</li>`;
      }).join("") || `<li class="mut">この日の予定はありません</li>`}</ul>
      <details><summary class="mut">この日のタスクを編集</summary><p class="mut">1行が1つのタスクです。</p><textarea id="ed" rows="8">${esc(tasks.filter(x => !x.at).map(x => x.label).join("\n"))}</textarea>
      <div class="row"><button class="p" data-act="editSave">保存</button>${state.edits[cur] ? `<button data-act="editReset">自動に戻す</button>` : ""}</div></details></div>`;
  },

  log() {
    const l = logEdit ? state.logs.find(x => x.id === logEdit) : null, d = l || { date: cur > D.today() ? D.today() : cur, kind: logKind, area: 0, minutes: 60 };
    const kind = l ? l.kind : logKind;
    const form = kind === "mock" && !l ? `<p class="mut">模試・通し演習のあと、分野ごとに解いた問題数と正解数を入力します。空欄の分野は記録しません。</p>
      <div class="row">${field("日付", `<input type="date" id="mk-date" value="${d.date}">`)}${field("名前", `<input id="mk-name" placeholder="例: 学校模試1">`)}</div>
      <table><tr><th>分野</th><th class="num">解いた問題数</th><th class="num">正解数</th></tr>${state.areas.map((a, i) => `<tr><td>${esc(a.name)}</td><td class="num"><input type="number" min="0" id="mk-s${i}"></td><td class="num"><input type="number" min="0" id="mk-c${i}"></td></tr>`).join("")}</table>
      <div class="row"><button class="p" data-act="mockSave">記録</button></div>`
      : `<div class="row">${field("日付", `<input type="date" id="lg-date" value="${d.date}">`)}
        ${field("分野", `<select id="lg-area">${AREA_OPTS().map(([v, n]) => `<option value="${v}" ${d.area === v ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="" ${d.area == null ? "selected" : ""}>回ごと(分野なし)</option></select>`)}
        ${field("学習時間(分)", `<input type="number" id="lg-min" min="0" value="${d.minutes ?? ""}">`)}
        ${field("解いた問題数", `<input type="number" id="lg-solved" min="0" value="${d.solved ?? ""}">`)}
        ${field("正解数", `<input type="number" id="lg-correct" min="0" value="${d.correct ?? ""}">`)}
        ${field("正答率(%)", `<input type="number" id="lg-rate" min="0" max="100" value="${d.rate ?? ""}" placeholder="自動計算">`)}</div>
        ${field("メモ", `<input id="lg-memo" value="${esc(d.memo)}">`)}
        <div class="row"><button class="p" data-act="logSave">${l ? "更新" : "記録"}</button>${l ? `<button data-act="logCancel">やめる</button>` : ""}</div>`;
    const rows = [...state.logs].sort((a, b) => a.date < b.date ? 1 : -1);
    return `<h1>記録</h1><p class="mut">日付・分野・学習時間・正答率を記録します。正答率は解いた問題数と正解数から自動で計算します。</p>
      <div class="card">${l ? "<h2>記録を編集</h2>" : `<div class="row"><button class="${kind === "normal" ? "p" : ""}" data-act="logKind" data-arg="normal">ふだんの記録</button><button class="${kind === "mock" ? "p" : ""}" data-act="logKind" data-arg="mock">模試・通し演習の結果</button></div>`}${form}</div>
      <div class="card"><h2>履歴(${rows.length}件)</h2>
      ${rows.length ? `<table><tr><th>日付</th><th>分野</th><th class="num">時間</th><th class="num">正解/解いた</th><th class="num">正答率</th><th>メモ</th><th></th></tr>${rows.slice(0, 200).map(x => `<tr><td>${D.md(x.date)}${x.kind === "mock" ? '<span class="tag">模試</span>' : ""}</td><td>${esc(x.area == null ? "回ごと" : state.areas[x.area]?.name)}</td><td class="num">${x.minutes || 0}分</td><td class="num">${x.solved ? `${x.correct ?? "-"}/${x.solved}` : ""}</td><td class="num">${x.rate == null ? "" : x.rate + "%"}</td><td>${esc(x.memo)}</td><td><button class="link" data-act="logEdit" data-arg="${x.id}">編集</button><button class="link danger" data-act="logDel" data-arg="${x.id}">削除</button></td></tr>`).join("")}</table>` : `<p class="mut">まだ記録がありません。</p>`}
      <h3>記録の取り込み</h3><p class="mut">Web版やスプレッドシートの記録をCSV(日付・分野・時間・解いた問題数・正解数・正答率)で読み込めます。時間の列名が「分」なら分、それ以外は時間として読みます。</p>
      <input type="file" accept=".csv,text/csv" data-file="csv"></div>`;
  },

  review() {
    const s = state.settings, t = D.today(), S = SC.areaStats(state), weak = SC.weakList(state);
    let r = t; while (D.dow(r) !== s.reviewDow) r = D.addDays(r, -1);
    const f = state.focus[r], from = f?.from || t, applied = f?.list || [], days = [];
    for (let d = D.addDays(r, 1), i = 0; i < 6; d = D.addDays(d, 1), i++) if (d >= from && SC.isStudyDay(state, d)) days.push(d);
    return `<h1>今週の復習</h1><p class="mut">目標(${s.targetRate}%)を下回る分野を正答率の低い順に、未計測の分野をそのあとに並べます。反映すると、次の復習の日(${D.WD[s.reviewDow]}曜)までの学習日の確認時間に1分野ずつ入ります。</p>
      <div class="card"><h2>弱点の分野</h2><ol>${weak.slice(0, Math.max(days.length, 5)).map(i => `<li>${esc(state.areas[i].name)} <span class="mut">${S[i].rate == null ? "未計測" : "直近" + Math.round(S[i].rate) + "%"}</span></li>`).join("") || "<li class='mut'>目標を下回る分野はありません</li>"}</ol>
      <h3>割り振り(次の復習の日 ${D.md(D.addDays(r, 7))} まで)</h3><table>${days.map((d, i) => `<tr><td>${D.md(d)}(${D.WD[D.dow(d)]})</td><td>${weak.length ? esc(state.areas[(applied.length ? applied : weak)[i % (applied.length || weak.length)]].name) : "-"}</td></tr>`).join("")}</table>
      <div class="row"><button class="p" data-act="reflect" data-arg="${r}" ${weak.length ? "" : "disabled"}>${applied.length ? "最新の成績で反映し直す" : "この週のタスクに反映"}</button>${applied.length ?`<span class="mut">反映済み</span><button data-act="unreflect" data-arg="${r}">取り消す</button>` : ""}</div></div>`;
  },

  plan() {
    const s = state.settings, p = state.plan || {}, over = SC.overflowDays(state);
    return `<h1>計画</h1><p class="mut">決めた期間で全問を解き終わるように、問題数に比例して分野ごとの日数を割り振り、同じ分野が続かないように日をばらします。条件を変えると、明日以降の計画が組み直されます(済んだ日の記録は残ります)。</p>
      <div class="card"><h2>過去問1周の期間</h2><div class="row">${field("開始日", inp("settings.qStart", "date"))}${field("終了日", inp("settings.qEnd", "date"))}${field("1問あたり(分)", num("settings.mpq", 'step="0.1" min="0.3"'))}
      ${field("解き残しの回し先", sel("settings.leftover", [["spread", "残りの学習日に振り分ける"], ["review", "次の復習の日に回す"]]))}</div>
      ${planSummary(true)}<div class="row"><button data-act="replanNow">いますぐ作り直す</button><span class="mut">予定どおり解けなかった問題を、上の設定に従って回します。</span></div></div>
      <div class="card"><h2>分野ごとの日程</h2>${(p.blocks || []).length ? `<table><tr><th>分野・回</th><th class="num">残り</th><th>日程</th></tr>${p.blocks.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${b.count}問</td><td class="mut">${b.days.map(D.md).join("・")}(${b.days.length}日)</td></tr>`).join("")}</table>` : `<p class="mut">期間内の残りの問題はありません。</p>`}</div>
      <div class="card"><h2>問題集と問題数</h2>${booksEditor()}</div>`;
  },

  stats() {
    const S = SC.areaStats(state), t = state.settings.targetRate;
    return `<h1>分野別の成績</h1><p class="mut">棒は各分野の直近3回の平均正答率、縦線は目標です。重点度は過去問1周が終わったあとの時間配分に使います。</p>
      <div class="card"><div class="row">${field("目標正答率(%)", num("settings.targetRate", 'min="0" max="100"'))}<span class="mut">累計 ${Math.round(state.logs.reduce((a, l) => a + (+l.minutes || 0), 0) / 6) / 10} 時間 / 解いた問題 ${S.reduce((a, x) => a + x.solved, 0)}問</span></div>
      <div class="bar"><span class="mut">分野</span><span class="mut">正答率</span><span class="mut v">直近</span><span class="mut v">解いた数</span><span class="mut">重点度</span></div>
      ${state.areas.map((a, i) => { const v = S[i].rate; return `<div class="bar ${v != null && v < t ? "lo" : ""}"><span>${esc(a.name)}</span><div class="track" role="img" aria-label="${v == null ? "未計測" : Math.round(v) + "%"}"><i style="width:${v || 0}%"></i><b style="left:${t}%"></b></div><span class="v">${v == null ? '<span class="mut">未計測</span>' : Math.round(v) + "%"}</span><span class="v">${S[i].solved}問</span>${sel(`areas.${i}.weight`, WEIGHTS)}</div>`; }).join("")}</div>`;
  },

  settings() {
    const s = state.settings;
    return `<h1>設定</h1><p class="mut">前提条件を変えると、明日以降の計画が組み直されます。</p>
      <div class="card"><h2>試験日と学習時間</h2>${timeFields()}</div>
      <div class="card"><h2>特別な日</h2>${specialsEditor()}</div>
      <div class="card"><h2>1周後の時間配分</h2><p class="mut">過去問1周の終了日より後は、重点度の比率で分野の日を割り振ります(比率は要件の未決事項。いまは仮の値)。</p>
      <div class="row">${WEIGHTS.map(([k, l]) => field(l, num(`settings.weightRatio.${k}`, 'min="0"'))).join("")}</div></div>
      <div class="card"><h2>Googleカレンダー</h2><div class="row">${chk("settings.calendar", "Googleカレンダーに予定を入れる")}</div>
      ${s.calendar ? `<p class="mut">今日から試験日までの予定を1日1件ずつカレンダー用のファイル(.ics)に書き出します。件名は「【ST国試】過去問 Ⅻ … 48問」のようになり、時間割は予定の説明に入ります。</p>
      <div class="row"><button class="p" data-act="ics">カレンダーに書き出す</button><span class="mut">最後の書き出し: ${s.lastIcsExport ? esc(D.label(s.lastIcsExport)) : "まだありません"}</span></div>
      <h3>Googleカレンダーへの読み込み方(パソコンのブラウザで)</h3>
      <ol class="mut"><li>はじめてのときだけ: 設定 →「カレンダーを追加」→「新しいカレンダーを作成」で「ST国試」カレンダーを作る</li>
      <li>右上の歯車 →「設定」→ 左の「インポート/エクスポート」</li>
      <li>「パソコンからファイルを選択」で書き出したファイルを選び、追加先を「ST国試」にして「インポート」</li></ol>
      <p class="mut">計画が変わったら、書き出し直して同じように読み込みます。予定が二重になったときは、「ST国試」カレンダーを削除して作り直してから読み込んでください。</p>` : `<p class="mut">オンにすると、勉強の予定をGoogleカレンダーに入れられます。使わない人はオフのままで大丈夫です。</p>`}</div>
      <div class="card"><h2>表示</h2><div class="row">${field("テーマ", sel("settings.theme", [["system", "パソコンに合わせる"], ["light", "ライト"], ["dark", "ダーク"]]))}${field("文字サイズ", sel("settings.fontScale", [[0.9, "小"], [1, "標準"], [1.15, "大"], [1.3, "特大"]], true))}</div></div>
      <div class="card"><h2>データのバックアップ</h2><p class="mut">設定と記録をすべて1つのファイルに書き出し、読み込んで元に戻せます。最後の書き出し: ${s.lastBackup ? esc(D.label(s.lastBackup)) : "まだありません"}</p>
      <div class="row"><button class="p" data-act="backup">書き出す</button><label class="field"><span>バックアップから元に戻す</span><input type="file" accept=".json,application/json" data-file="restore"></label></div></div>`;
  },
};

function timeFields(withExam = true) {
  return `${withExam ? `<div class="row">${field("試験日", inp("settings.examDate", "date"))}</div>` : ""}
    <div class="grid2"><div><h3>平日の学習時間帯</h3><div class="row">${inp("settings.weekday.start", "time")}〜${inp("settings.weekday.end", "time")}</div></div>
    <div><h3>休日(土日・祝日)の学習時間帯</h3><div class="row">${inp("settings.holiday.start", "time")}〜${inp("settings.holiday.end", "time")}</div></div></div>
    <div class="row">${field("休憩(分)", num("settings.breakMin", 'min="0"'))}${field("1問あたり(分)", num("settings.mpq", 'step="0.1" min="0.3"'))}</div>`;
}

function specialsEditor() {
  const s = state.settings, sp = state.specials.map((x, i) => [x, i]);
  const rows = (type, cols, empty) => {
    const list = sp.filter(([x]) => x.type === type);
    return list.length ? `<table>${list.map(([x, i]) => `<tr>${cols.map(([k, t, a]) => `<td>${inp(`specials.${i}.${k}`, t, a || "")}</td>`).join("")}<td><button class="link danger" data-act="delSpecial" data-arg="${x.id}">削除</button></td></tr>`).join("")}</table>` : `<p class="mut">${empty}</p>`;
  };
  const fin = sp.find(([x]) => x.type === "final");
  return `<div class="grid2"><div>${field("復習の日", sel("settings.reviewDow", DOW_OPTS, true))}</div><div><span class="mut">学習しない曜日</span>${dowsBox("settings.offDows")}</div></div>
    <div class="row">${chk("settings.holidayStudy", "祝日も学習する")}<span class="mut">しない場合、その日の分は同じ週のほかの学習日に振り分けます。</span></div>
    <div class="row">${field("予定どおり解けなかった問題", sel("settings.leftover", [["spread", "計画の作り直しで残りの学習日に振り分ける"], ["review", "次の復習の日に回す"]]))}</div>
    <h3>実習期間 <button class="link" data-act="addSpecial" data-arg="practicum">+ 追加</button></h3><p class="mut">開始日・終了日・実習中に確保する時間(症例メモなど、分)</p>${rows("practicum", [["start", "date"], ["end", "date"], ["reserve", "number", 'data-num min="0"']], "実習期間はありません")}
    <h3>模試 <button class="link" data-act="addSpecial" data-arg="mock">+ 追加</button></h3><p class="mut">名前・日付・時間帯。学校の模試は最初から入っています。</p>${rows("mock", [["name", "text"], ["start", "date"], ["from", "time"], ["to", "time"]], "模試はありません")}
    <h3>通し演習 <button class="link" data-act="addSpecial" data-arg="full">+ 追加</button></h3>${rows("full", [["name", "text"], ["start", "date"], ["from", "time"], ["to", "time"]], "通し演習はありません")}
    <h3>学習しない日(個別の日付) <button class="link" data-act="addSpecial" data-arg="off">+ 追加</button></h3>${rows("off", [["start", "date"], ["memo", "text", 'placeholder="メモ"']], "ありません")}
    <h3>直前期 ${fin ? "" : `<button class="link" data-act="addSpecial" data-arg="final">+ 設定する</button>`}</h3>${fin ? `<p class="mut">開始日と、その期間の時間帯</p>` : ""}${rows("final", [["start", "date"], ["from", "time"], ["to", "time"]], "直前期は設定していません")}`;
}

function booksEditor() {
  const have = new Set(state.books.map(b => b.preset));
  return state.books.map((b, i) => {
    const total = b.layout === "round" ? b.rounds.reduce((a, r) => a + (+r.q || 0), 0) : b.areaQ.reduce((a, q) => a + (+q || 0), 0);
    const body = b.layout === "round"
      ? `<table><tr><th>回</th><th class="num">問題数</th><th></th></tr>${b.rounds.map((r, j) => `<tr><td>${inp(`books.${i}.rounds.${j}.label`)}</td><td class="num">${num(`books.${i}.rounds.${j}.q`, 'min="0"')}</td><td><button class="link danger" data-act="delRound" data-arg="${i}.${j}">削除</button></td></tr>`).join("")}</table><button class="link" data-act="addRound" data-arg="${i}">+ 回を追加</button>`
      : `<table><tr><th>分野</th><th class="num">問題数</th></tr>${state.areas.map((a, j) => `<tr><td>${esc(a.name)}</td><td class="num">${num(`books.${i}.areaQ.${j}`, 'min="0"')}</td></tr>`).join("")}</table>
        <div class="row"><span class="mut">分野別の数がわからないときは合計だけ入力:</span><input type="number" min="0" id="bt-${i}" placeholder="合計"><button data-act="bookTotal" data-arg="${i}">データベースの比率で振り分け</button></div>`;
    return `<details class="card" ${state.books.length === 1 ? "open" : ""}><summary><b>${esc(b.name)}</b> <span class="mut">${b.layout === "round" ? "回ごと" : "分野別"} · 全${total}問</span>${b.provisional ? '<span class="tag">問題数は仮の値</span>' : ""}</summary>
      <div class="row">${field("名前", inp(`books.${i}.name`, "text", 'size="40"'))}${field("出版社", inp(`books.${i}.publisher`))}</div>${body}
      <div class="row"><button class="link danger" data-act="delBook" data-arg="${b.id}">この問題集を外す</button></div></details>`;
  }).join("") + `<div class="row"><span class="mut">追加:</span>${Object.entries(PRESETS).filter(([k]) => !have.has(k)).map(([k, f]) => `<button data-act="addBook" data-arg="${k}">${esc(f().name.replace(/^20\d\d年版 言語聴覚士国家試験/, ""))}</button>`).join("")}
    <button data-act="addBook" data-arg="area">自分で入力(分野別)</button><button data-act="addBook" data-arg="round">自分で入力(回ごと)</button></div>`;
}

function planSummary(inPlan) {
  const p = state.plan, s = state.settings;
  if (!p) return "";
  if (!s.qStart || !s.qEnd) return `<p class="err">過去問1周の開始日と終了日を入れてください。</p>`;
  if (!p.ok) return `<p class="err">期間内に使える日が${p.days}日です。分野・回の数(${p.units})以上になるよう期間を広げてください。</p>`;
  const over = SC.overflowDays(state);
  return `<p>${inPlan ? "残り" : "全"}${p.total}問 / 学習日${p.days}日 / 1日平均${p.days ? Math.round(p.total / p.days) : 0}問 <span class="mut">(復習の日・模試・通し演習・学習しない日は除く)</span></p>
    ${over.length ? `<p class="err">学習時間帯に入りきらない日が${over.length}日あります(${over.slice(0, 5).map(D.md).join("・")}${over.length > 5 ? "…" : ""})。期間を延ばすか、問題を減らすか、学習時間帯を広げてください。</p>` : ""}`;
}

/* ---------- 初回設定(F-00) ---------- */
const STEPS = ["ようこそ", "試験日", "学習時間", "特別な日", "問題集と重点度", "計画の確認"];
function vSetup() {
  const s = state.settings;
  const body = [
    () => `<h1>ST国試 学習プランナーへようこそ</h1><p>試験日・学習できる時間・使う問題集などを入力すると、国家試験までに過去問を1周し、弱点を復習で埋める計画を自動で作ります。</p>
      <p class="mut">入力はあとから設定画面でいつでも変えられます。データはこのパソコンの中にだけ保存されます。</p>
      <div class="row"><button class="p" data-act="next">はじめる</button><button data-act="loadSample">サンプル(設定例)で試す</button></div>`,
    () => `<h2>試験日</h2>${field("国家試験の日", inp("settings.examDate", "date"))}`,
    () => `<h2>学習できる時間</h2>${timeFields(false)}`,
    () => `<h2>実習・模試などの特別な日</h2><p class="mut">なければそのまま次へ進めます。</p>${specialsEditor()}`,
    () => `<h2>問題集と問題数</h2><p class="mut">使う問題集を選んで、分野ごとの問題数を確認してください。よく使う3冊は問題数の例が入ります。</p>${booksEditor()}
      <details class="card"><summary><b>分野の重点度</b> <span class="mut">(任意・過去問1周が終わったあとの時間配分に使います)</span></summary><table>${state.areas.map((a, i) => `<tr><td>${esc(a.name)}</td><td>${sel(`areas.${i}.weight`, WEIGHTS)}</td></tr>`).join("")}</table></details>`,
    () => `<h2>過去問1周の期間と計画の確認</h2><div class="row">${field("開始日", inp("settings.qStart", "date"))}${field("終了日", inp("settings.qEnd", "date"))}</div>${planSummary(false)}
      ${state.plan?.ok ? `<h3>最初の1週間</h3>${firstWeek()}` : ""}`,
  ][step]();
  return `<div class="steps">${STEPS.map((n, i) => `<span class="${i === step ? "on" : ""}">${i + 1}. ${n}</span>`).join("")}</div>${body}
    ${setupErr ? `<p class="err">${esc(setupErr)}</p>` : ""}
    ${step ? `<div class="nav"><button data-act="prev">戻る</button>${step < STEPS.length - 1 ? `<button class="p" data-act="next">次へ</button>` : `<button class="p" data-act="finish">この計画ではじめる</button>`}</div>` : ""}`;
}
function firstWeek() {
  const p = state.plan, d0 = Object.keys(p.m).sort()[0];
  if (!d0) return "";
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(d0, i));
  return `<table>${days.map(d => `<tr><td>${D.md(d)}(${D.WD[D.dow(d)]})</td><td>${(p.m[d] || []).map(a => esc(SC.qLabel(a))).join("<br>") || `<span class="mut">${esc(SC.computeDay(state, d)[0]?.label || "")}</span>`}</td></tr>`).join("")}</table>`;
}
function validateStep() {
  const s = state.settings;
  if (step === 1 && !s.examDate) return "試験日を入れてください。";
  if (step === 2 && [s.weekday, s.holiday].some(b => D.toMin(b.end) <= D.toMin(b.start))) return "学習時間帯の終了は開始より後にしてください。";
  if (step === 4 && !SC.buildUnits(state).length) return "問題集を1冊以上選び、問題数を入れてください。";
  if (step === 5) {
    if (!s.qStart || !s.qEnd || s.qEnd < s.qStart) return "過去問1周の開始日と終了日を入れてください。";
    if (!state.plan?.ok) return "期間内の学習日が足りません。期間を広げてください。";
  }
  return "";
}

/* ---------- 操作 ---------- */
const ACT = {
  go(v) { view = v; quick = null; logEdit = null; render(); },
  day(a) { cur = /^-?\d+$/.test(a) ? D.addDays(cur, +a) : a; quick = null; view = "today"; render(); },
  toggle(key, el) {
    const at = el?.dataset.at || "", list = state.done[at || cur] ||= [], i = list.indexOf(key);
    const late = state.done[cur] ||= [], mark = "late:" + key;
    if (i >= 0) { list.splice(i, 1); if (at && late.includes(mark)) late.splice(late.indexOf(mark), 1); if (quick === key) quick = null; }
    else { list.push(key); if (at && !late.includes(mark)) late.push(mark); const x = todayList().find(t => t.key === key); quick = x?.assign ? key : null; }
    persist(); render();
    if (quick) $("#q-correct")?.focus();
  },
  quickSave(key) {
    const x = todayList().find(t => t.key === key);
    addLog({ date: cur, kind: "normal", area: $("#q-area").value === "" ? null : +$("#q-area").value, minutes: +$("#q-min").value || 0, solved: +$("#q-solved").value || 0, correct: $("#q-correct").value === "" ? null : +$("#q-correct").value, memo: x?.assign?.label || "" });
    quick = null; persist(); render(); toast("記録しました");
  },
  quickSkip() { quick = null; render(); },
  editSave() {
    const old = SC.dayTasks(state, cur, D.today());
    state.edits[cur] = $("#ed").value.split("\n").map(s => s.trim()).filter(Boolean).map(label => old.find(t => t.label === label) || { key: "e:" + label, label });
    persist(); render(); toast("保存しました");
  },
  editReset() { delete state.edits[cur]; persist(); render(); },
  logKind(k) { logKind = k; render(); },
  logSave() {
    const v = id => $(id).value, n = id => v(id) === "" ? null : +v(id);
    const rec = { date: v("#lg-date"), kind: logEdit ? state.logs.find(x => x.id === logEdit).kind : "normal", area: v("#lg-area") === "" ? null : +v("#lg-area"), minutes: n("#lg-min") || 0, solved: n("#lg-solved"), correct: n("#lg-correct"), rate: n("#lg-rate"), memo: v("#lg-memo") };
    if (!rec.date) return toast("日付を入れてください");
    if (logEdit) Object.assign(state.logs.find(x => x.id === logEdit), withRate(rec)); else addLog(rec);
    logEdit = null; persist(); render(); toast("記録しました");
  },
  logEdit(id) { logEdit = id; render(); scrollTo(0, 0); },
  logCancel() { logEdit = null; render(); },
  logDel(id) { if (!confirm("この記録を削除しますか?")) return; state.logs = state.logs.filter(x => x.id !== id); persist(); render(); },
  mockSave() {
    const date = $("#mk-date").value, name = $("#mk-name").value || "模試";
    let n = 0;
    state.areas.forEach((a, i) => {
      const sv = $(`#mk-s${i}`).value, cv = $(`#mk-c${i}`).value;
      if (sv === "" || +sv <= 0) return;
      addLog({ date, kind: "mock", area: i, minutes: 0, solved: +sv, correct: cv === "" ? 0 : +cv, memo: name }); n++;
    });
    if (!n) return toast("解いた問題数を1つ以上入れてください");
    persist(); render(); toast(`${n}分野の結果を記録しました`);
  },
  reflect(r) { state.focus[r] = { from: D.today(), list: SC.weakList(state).slice(0, 6) }; persist(); render(); toast("この週のタスクに反映しました"); },
  unreflect(r) { delete state.focus[r]; persist(); render(); },
  replanNow() { replan(); persist(); render(); toast("計画を作り直しました"); },
  addSpecial(type) {
    const base = { id: newId(), type, start: D.today() };
    Object.assign(base, { practicum: { end: D.today(), reserve: 15 }, mock: { name: "模試", from: "09:00", to: "16:00" }, full: { name: "通し演習", from: "10:00", to: "16:00" }, final: { from: "17:00", to: "17:45" }, off: { memo: "" } }[type]);
    state.specials.push(base); replan(); persist(); render();
  },
  delSpecial(id) { state.specials = state.specials.filter(x => x.id !== id); replan(); persist(); render(); },
  addBook(k) {
    const b = PRESETS[k] ? { ...PRESETS[k](), preset: k } : k === "round"
      ? { name: "問題集(回ごと)", layout: "round", rounds: [{ label: "第1回", q: 200 }] }
      : { name: "問題集(分野別)", layout: "area", areaQ: state.areas.map(() => 0) };
    state.books.push({ id: newId(), ...b }); replan(); persist(); render();
  },
  delBook(id) { if (!confirm("この問題集を外しますか?")) return; state.books = state.books.filter(b => b.id !== id); replan(); persist(); render(); },
  bookTotal(i) { const t = +$(`#bt-${i}`).value; if (!t) return; state.books[i].areaQ = distributeByDb(t); state.books[i].provisional = true; replan(); persist(); render(); },
  addRound(i) { const r = state.books[i].rounds; r.push({ label: `第${r.length + 1}回`, q: 200 }); replan(); persist(); render(); },
  delRound(a) { const [i, j] = a.split(".").map(Number); state.books[i].rounds.splice(j, 1); replan(); persist(); render(); },
  async backup() {
    if (await exportBackup(state, `st-planner-backup-${D.today()}.json`)) { state.settings.lastBackup = D.today(); persist(); render(); toast("バックアップを書き出しました"); }
  },
  async ics() {
    const t = D.today();
    if (await saveTextFile(buildIcs(state, t), "st-planner.ics", "カレンダー", "ics", "text/calendar")) {
      Object.assign(state.settings, { lastIcsExport: t }); state.icsStale = false; persist(); render(); toast("カレンダー用のファイルを書き出しました");
    }
  },
  loadSample() { state = sampleState(); replan(); step = 5; persist(); render(); },
  next() { setupErr = validateStep(); if (!setupErr) step++; render(); scrollTo(0, 0); },
  prev() { setupErr = ""; step--; render(); },
  finish() {
    setupErr = validateStep(); if (setupErr) return render();
    Object.assign(state.settings, { setupDone: true, setupDate: D.today() });
    replan(); persist(); view = "today"; cur = D.today(); render(); toast("計画を作りました");
  },
};

const FILE = {
  async restore(file) {
    try {
      const st = parseBackup(await readFileText(file));
      if (!confirm("いまのデータをバックアップの内容で置き換えます。よろしいですか?")) return;
      state = { ...emptyState(), ...st }; applyTheme(); persist(); render(); toast("バックアップから元に戻しました");
    } catch (e) { alert("読み込めませんでした: " + e.message); }
  },
  async csv(file) {
    const rows = parseCSV(await readFileText(file)).filter(r => r.some(c => c.trim()));
    if (!rows.length) return toast("データがありません");
    const head = rows[0].map(h => h.trim()), hasHead = !/^\d{4}[-/]/.test(head[0] || "");
    const col = (re, def) => { const i = hasHead ? head.findIndex(h => re.test(h)) : -1; return i >= 0 ? i : hasHead ? -1 : def; };
    const ci = { date: col(/日付|date/i, 0), area: col(/分野|領域|area/i, 1), time: col(/時間|^分$|[(（]分[)）]|hour|min/i, 2), solved: col(/解いた|solved/i, 3), correct: col(/正解数|correct/i, 4), rate: col(/正答率|rate|%/i, 5) };
    const minutes = hasHead && ci.time >= 0 && /^分$|[(（]分[)）]|min/i.test(head[ci.time]);
    let n = 0, skip = 0;
    for (const r of rows.slice(hasHead ? 1 : 0)) {
      const date = normDate(r[ci.date]), area = matchArea(r[ci.area]);
      if (!date) { skip++; continue; }
      const val = i => i >= 0 && r[i] != null && r[i].trim() !== "" ? +r[i].replace("%", "") : null, tv = val(ci.time);
      addLog({ date, kind: "normal", area, minutes: tv == null ? 0 : Math.round(minutes ? tv : tv * 60), solved: val(ci.solved), correct: val(ci.correct), rate: val(ci.rate), memo: "取り込み" });
      n++;
    }
    persist(); render(); toast(`${n}件取り込みました${skip ? `(${skip}行は日付が読めず飛ばしました)` : ""}`);
  },
};

// 表示中の日のタスク。今日なら先頭に「昨日の残り」を付ける(at = 元の日付。チェックは元の日に付く)
function todayList() {
  const t = D.today(), tasks = SC.dayTasks(state, cur, t);
  if (cur !== t) return tasks;
  const y = D.addDays(t, -1), mpq = state.settings.mpq;
  const pend = SC.pendingFromYesterday(state, t).map(a => {
    const min = Math.max(5, Math.round(a.n * mpq / 5) * 5);
    return { key: a.key, at: y, min, label: `${SC.qLabel(a)} 約${min}分`, assign: { area: a.area, n: a.n, label: a.label, round: a.round } };
  });
  return [...pend, ...tasks];
}

/* ---------- 記録の補助 ---------- */
function withRate(r) {
  if (r.solved > 0 && r.correct != null) r.rate = Math.round(r.correct / r.solved * 100);
  if (r.rate != null) r.rate = Math.min(100, Math.max(0, r.rate));
  return r;
}
function addLog(r) { state.logs.push(withRate({ id: newId(), ...r })); }
function autoRate() {
  for (const [s, c, out] of [["#lg-solved", "#lg-correct", "#lg-rate"], ["#q-solved", "#q-correct", "#q-rate"]]) {
    const S = $(s), C = $(c), O = $(out);
    if (S && C && O && +S.value > 0 && C.value !== "") O[O.tagName === "INPUT" ? "value" : "textContent"] = Math.round(+C.value / +S.value * 100) + (O.tagName === "INPUT" ? "" : "%");
  }
}
function quickForm(x) {
  const a = x.assign;
  return `<div class="quick"><div class="row"><b>記録する</b><span class="mut">${esc(a.label)}</span></div><div class="row">
    ${field("正解数", `<input type="number" id="q-correct" min="0" max="${a.n}">`)}${field("解いた問題数", `<input type="number" id="q-solved" min="0" value="${a.n}">`)}
    ${field("学習時間(分)", `<input type="number" id="q-min" min="0" value="${x.min}">`)}
    ${field("分野", `<select id="q-area">${AREA_OPTS().map(([v, n]) => `<option value="${v}" ${a.area === v ? "selected" : ""}>${esc(n)}</option>`).join("")}<option value="" ${a.area == null ? "selected" : ""}>回ごと(分野なし)</option></select>`)}
    <span>正答率 <b id="q-rate">-</b></span></div>
    <div class="row"><button class="p" data-act="quickSave" data-arg="${esc(x.key)}">記録</button><button data-act="quickSkip">あとで</button></div></div>`;
}
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function normDate(s) {
  const m = String(s || "").trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  return m ? `${m[1]}-${D.p2(+m[2])}-${D.p2(+m[3])}` : null;
}
function matchArea(s) {
  s = String(s || "").trim();
  if (!s) return null;
  const head = s.split(/[\s ]/)[0];
  const i = state.areas.findIndex(a => a.name === s || a.name.split(" ")[0] === head || a.name.includes(s) || s.includes(a.name.split(" ")[1]));
  return i >= 0 ? i : null;
}

document.addEventListener("change", e => { if (e.target.id === "cur" && e.target.value) ACT.day(e.target.value); });

/* ---------- 起動 ---------- */
(async () => {
  state = { ...emptyState(), ...(await loadState() || {}) };
  applyTheme();
  const t = D.today();
  if (state.settings.setupDone) {
    SC.freezePast(state, t);
    if (!state.plan) state.plan = SC.generatePlan(state, t);
    else if (SC.absorbLeftovers(state, t) && state.settings.calendar && state.settings.lastIcsExport) state.icsStale = true; // 解き残しを回す(F-12)
    persist();
  } else if (!state.plan) state.plan = SC.generatePlan(state, t);
  render();
  // 日付が変わったら自動で切り替える(F-01)
  setInterval(() => {
    const now = D.today();
    if (now !== t && state.settings.setupDone) location.reload();
  }, 60_000);
})();
