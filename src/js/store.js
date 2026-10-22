// データは各自のパソコン内にだけ保存する(要件7章)。
// デスクトップアプリ(Tauri)ではアプリ用フォルダの data.json、ブラウザで開いたときは localStorage に置く。
const KEY = "st-planner-state-v1";
const FILE = "data.json";
const tauri = () => window.__TAURI__;
const appData = () => ({ baseDir: tauri().fs.BaseDirectory.AppData });

export const isDesktop = () => !!tauri()?.fs;

export async function loadState() {
  if (isDesktop()) {
    try {
      const { fs } = tauri();
      if (await fs.exists(FILE, appData())) return JSON.parse(await fs.readTextFile(FILE, appData()));
      return null;
    } catch (e) { console.error("load failed", e); }
  }
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

let timer = null;
export function saveState(state) {
  clearTimeout(timer);
  timer = setTimeout(() => writeNow(state), 300);
}

async function writeNow(state) {
  const text = JSON.stringify(state);
  if (isDesktop()) {
    try {
      const { fs } = tauri();
      if (!(await fs.exists("", appData()))) await fs.mkdir("", { ...appData(), recursive: true });
      await fs.writeTextFile(FILE, text, appData());
      return;
    } catch (e) { console.error("save failed", e); }
  }
  try { localStorage.setItem(KEY, text); } catch (e) { console.error("save failed", e); }
}

// バックアップ(F-13): 設定と記録をすべて1つのファイルに書き出す
export function exportBackup(state, filename) {
  const text = JSON.stringify({ app: "st-planner", version: 1, exportedAt: new Date().toISOString(), state }, null, 1);
  return saveTextFile(text, filename, "バックアップ", "json", "application/json");
}

// ファイルを書き出す。デスクトップでは保存先を選ぶ画面、ブラウザではダウンロード。
export async function saveTextFile(text, filename, kind, ext, mime) {
  if (isDesktop() && tauri().dialog) {
    const path = await tauri().dialog.save({ defaultPath: filename, filters: [{ name: kind, extensions: [ext] }] });
    if (!path) return false;
    await tauri().fs.writeTextFile(path, text);
    return true;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

export function parseBackup(text) {
  const obj = JSON.parse(text);
  if (obj?.app !== "st-planner" || !obj.state?.settings) throw new Error("このアプリのバックアップファイルではありません");
  return obj.state;
}

export const readFileText = file => new Promise((ok, ng) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^﻿/, ""));
  r.onerror = () => ng(r.error);
  r.readAsText(file);
});
