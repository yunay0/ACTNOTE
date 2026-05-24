/** datetime-local 브라우저 값 ↔ Supabase TIMESTAMPTZ / 마감일 DATE */

export function yyyyMmDdFromLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** DB ISO → `<input type="datetime-local">` 값 (브라우저 로컬) */
export function utcIsoToDatetimeLocalValue(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${min}`;
}

/** 시간 없이 `YYYY-MM-DD` 만 있으면 자정 로컬로 datetime-local 문자열 생성 */
export function dueDateYmdToDatetimeLocalStart(ymd: string): string | null {
  const raw = String(ymd).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [yStr, moStr, dStr] = raw.split("-");
  const d = new Date(Number(yStr), Number(moStr) - 1, Number(dStr), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T00:00`;
}

/** 로컬 datetime 픽 → 저장용 `{ due_at, due_date }` */
export function fromDatetimeLocalToDueFields(val: string): { due_at: string; due_date: string } | null {
  const v = String(val).trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return {
    due_at: d.toISOString(),
    due_date: yyyyMmDdFromLocalDate(d),
  };
}
