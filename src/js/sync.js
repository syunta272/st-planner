// パソコン間の同期(要件7章「保存先にOneDriveやGoogleドライブのフォルダを選べば…」)。
// 2台が同じフォルダの data.json を読み書きする。両方で同時に変えたときは、記録とチェックを失わないように合わせる。
// - 全体は、あとで保存した方(savedAt が新しい方)を土台にする
// - 学習記録は両方を合わせる(どちらかで削除したものは消す)
// - チェックは日付ごとに、あとで変えた方を使う(doneUpdated)
// - 過ぎた日の表示(frozen)は、土台にない日をもう一方から足す
export function mergeStates(a, b) {
  const [base, other] = (b.savedAt || 0) >= (a.savedAt || 0) ? [b, a] : [a, b];
  const out = JSON.parse(JSON.stringify(base));
  const deleted = new Set([...(a.deletedLogs || []), ...(b.deletedLogs || [])]);
  const ids = new Set((out.logs || []).map(l => l.id));
  out.logs = [...(out.logs || []), ...(other.logs || []).filter(l => !ids.has(l.id))].filter(l => !deleted.has(l.id));
  out.deletedLogs = [...deleted];
  out.done ||= {}; out.doneUpdated ||= {};
  for (const d of new Set([...Object.keys(a.done || {}), ...Object.keys(b.done || {})])) {
    const ta = a.doneUpdated?.[d] || 0, tb = b.doneUpdated?.[d] || 0;
    const la = a.done?.[d] || [], lb = b.done?.[d] || [];
    out.done[d] = ta === tb ? [...new Set([...la, ...lb])] : ta > tb ? [...la] : [...lb];
    out.doneUpdated[d] = Math.max(ta, tb);
  }
  out.frozen ||= {};
  for (const [d, v] of Object.entries(other.frozen || {})) if (!out.frozen[d]) out.frozen[d] = v;
  return out;
}
