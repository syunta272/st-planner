// データは各自のパソコン内にだけ保存する(要件7章)。
// デスクトップアプリ(Tauri)ではアプリ用フォルダの data.json、ブラウザで開いたときは localStorage に置く。
// 同期フォルダ(iCloud Driveなど)を選ぶと、そこの data.json を2台のパソコンで読み書きする。
// どこに保存するかは、データとは別にアプリ用フォルダの config.json に持つ(データを開く前に場所がわかるように)。
import { mergeStates } from "./sync.js";

const KEY = "st-planner-state-v1";
const FILE = "data.json";
const CONFIG = "config.json";
const tauri = () => window.__TAURI__;
const appData = () => ({ baseDir: tauri().fs.BaseDirectory.AppData });

export const isDesktop = () => !!tauri()?.fs;

let syncPath = null;      // 同期フォルダの data.json(使っていなければ null)
let lastDiskText = null;  // 最後に読んだ・書いた同期ファイルの中身(ほかのパソコンが書いたかの判定に使う)
let onExternal = null;    // ほかのパソコンの変更を取り込んだときに呼ぶ
export let syncError = "";

const join = (dir, name) => dir.replace(/[\\/]+$/, "") + (dir.includes("\\") ? "\\" : "/") + name;
export const syncFolder = () => syncPath && syncPath.replace(/[\\/]data\.json$/, "");
export const setOnExternalChange = fn => { onExternal = fn; };
let getState = null; // 保存の直前に、いちばん新しい状態を取る(取り込みで状態が入れ替わっても古い方を書かないように)
export const setStateGetter = fn => { getState = fn; };

async function ensureAppDir() {
  const { fs } = tauri();
  if (!(await fs.exists("", appData()))) await fs.mkdir("", { ...appData(), recursive: true });
}
async function readConfig() {
  try { const { fs } = tauri(); if (await fs.exists(CONFIG, appData())) return JSON.parse(await fs.readTextFile(CONFIG, appData())); } catch (e) { console.error(e); }
  return {};
}
async function writeConfig(cfg) { await ensureAppDir(); await tauri().fs.writeTextFile(CONFIG, JSON.stringify(cfg), appData()); }

export async function loadState() {
  if (isDesktop()) {
    const { fs } = tauri(), cfg = await readConfig();
    if (cfg.syncDir) {
      syncPath = join(cfg.syncDir, FILE);
      try {
        if (await fs.exists(syncPath)) { lastDiskText = await fs.readTextFile(syncPath); return JSON.parse(lastDiskText); }
      } catch (e) { console.error("sync load failed", e); syncError = "同期フォルダが読めないため、このパソコンの控えを開いています。"; }
    }
    try {
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

async function writeNow(state0) {
  let state = getState?.() || state0;
  state.savedAt = Date.now();
  if (isDesktop()) {
    const { fs } = tauri();
    if (syncPath) {
      try {
        // 前に読んだあとで、ほかのパソコンが書いていたら合わせてから書く
        const disk = (await fs.exists(syncPath)) ? await fs.readTextFile(syncPath) : null;
        if (disk && lastDiskText !== null && disk !== lastDiskText) {
          const merged = mergeStates(state, JSON.parse(disk));
          merged.savedAt = Date.now();
          onExternal?.(merged);
          state = merged;
        }
        const text = JSON.stringify(state);
        await fs.writeTextFile(syncPath, text);
        lastDiskText = text;
        syncError = "";
      } catch (e) { console.error("sync save failed", e); syncError = "同期フォルダに保存できませんでした。このパソコンには保存しています。"; }
    }
    try { await ensureAppDir(); await fs.writeTextFile(FILE, JSON.stringify(state), appData()); return; } // このパソコンの控え
    catch (e) { console.error("save failed", e); }
  }
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.error("save failed", e); }
}

// ほかのパソコンの変更を確かめる(アプリに戻ったときと、開いている間30秒ごと)
export async function checkExternal(state) {
  if (!isDesktop() || !syncPath) return false;
  try {
    const { fs } = tauri();
    if (!(await fs.exists(syncPath))) return false;
    const disk = await fs.readTextFile(syncPath);
    if (disk === lastDiskText) return false;
    lastDiskText = disk;
    const diskState = JSON.parse(disk), merged = mergeStates(state, diskState);
    onExternal?.(merged);
    // このパソコンにしかない変更があったときだけ書き戻す(2台で書き合いを続けないように)
    const same = (x, y) => JSON.stringify({ ...x, savedAt: 0 }) === JSON.stringify({ ...y, savedAt: 0 });
    if (!same(merged, diskState)) saveState(merged);
    return true;
  } catch (e) { console.error("sync check failed", e); return false; }
}

// 同期フォルダを使い始める。フォルダにほかのパソコンのデータがあれば、このパソコンのデータと合わせる。
export async function connectFolder(dir, state) {
  const { fs } = tauri(), path = join(dir, FILE);
  if (!(await fs.exists(dir))) await fs.mkdir(dir, { recursive: true });
  let next = state, found = false;
  if (await fs.exists(path)) { next = mergeStates(state, JSON.parse(await fs.readTextFile(path))); found = true; }
  next.savedAt = Date.now();
  const text = JSON.stringify(next);
  await fs.writeTextFile(path, text);
  syncPath = path; lastDiskText = text; syncError = "";
  await writeConfig({ ...(await readConfig()), syncDir: dir });
  return { state: next, found };
}

export async function disconnectFolder(state) {
  syncPath = null; lastDiskText = null; syncError = "";
  await writeConfig({ ...(await readConfig()), syncDir: null });
  await writeNow(state);
}

export async function iCloudFolder() {
  const home = await tauri().path.homeDir(), root = join(home, "Library/Mobile Documents/com~apple~CloudDocs");
  if (!(await tauri().fs.exists(root))) throw new Error("iCloud Driveが見つかりません。Macの「システム設定」→ Apple ID → iCloud で iCloud Drive をオンにしてください。");
  return join(root, "ST-Planner");
}

export async function pickFolder() {
  const dir = await tauri().dialog.open({ directory: true, multiple: false, title: "同期に使うフォルダを選ぶ" });
  return Array.isArray(dir) ? dir[0] : dir;
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
