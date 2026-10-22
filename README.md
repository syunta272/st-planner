# ST国試 学習プランナー(デスクトップ版)

要件定義書「ST国試 学習プランナー デスクトップアプリ 要件定義書」のMVP(F-00〜F-10、F-12、F-13。F-08を除く)を実装したもの。

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/` | 画面(HTML・CSS・JavaScript)。ビルド不要で、ブラウザでもそのまま動く |
| `src/js/schedule.js` | スケジュール自動配分(要件6章)。Web版の計算をそのまま移植 |
| `src/js/store.js` | 保存。デスクトップではアプリ用フォルダの `data.json`、ブラウザでは localStorage |
| `src/test.html` | 受け入れ条件のテスト(ブラウザで開くと実行) |
| `src-tauri/` | Mac・Windows のデスクトップアプリにする設定(Tauri 2) |
| `.github/workflows/build.yml` | インストーラー(.dmg / .exe)を GitHub Actions で作る |

## 手元で動かす(ブラウザ)

```bash
python3 -m http.server 5173 --directory src
```

http://localhost:5173 でアプリ、http://localhost:5173/test.html でテスト。

## インストーラーを作る

1. このフォルダを GitHub のリポジトリに push する。
2. GitHub の「Actions」→「build」→「Run workflow」を押す(または `v0.1.0` のようなタグを push)。
3. 終わったら実行結果の「Artifacts」から `mac-dmg` と `windows-exe` をダウンロードし、Googleドライブの共有フォルダに置く。

手元でビルドする場合は Node.js 20 と Rust を入れてから `npm install && npx tauri icon app-icon.png && npm run build`。

署名なしで配るため、初回起動時に Mac は「開発元を確認できません」、Windows は SmartScreen の警告が出る(要件7章)。

## 要件の未決事項に対して仮に決めたこと

- 1周後の重点度の比率は 厚め:標準:軽め = 3:2:1(設定画面で変更可)。
- 祝日に学習する日は「休日」の時間帯を使う。
- データの保存先はアプリ用フォルダ固定(OneDrive などへの変更は未実装)。
- 学校の模試日程は本人の設定例の4日を仮に入れている(`src/js/defaults.js` の `SCHOOL_MOCKS`)。
- 必修ポイントの問題数は合計2000問をデータベースの比率で仮に振り分け、3年間の本は第26〜28回としている。配布前に現物で確認する。
