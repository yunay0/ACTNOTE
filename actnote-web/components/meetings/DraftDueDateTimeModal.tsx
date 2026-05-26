"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { DraftModalPortal } from "@/components/meetings/DraftModalPortal";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function pad2(n: number): string {
  return String(Math.max(0, n)).padStart(2, "0");
}

/** 브라우저 로컬 날짜만 (연·월·일) */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `datetime-local` 문자열 파싱 → 날짜(로컬 0시) + 시·분 */
function parseDatetimeLocalParts(val: string): { day: Date; hh: number; mm: number } | null {
  const v = val.trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: startOfLocalDay(d),
    hh: d.getHours(),
    mm: d.getMinutes(),
  };
}

function formatMmDdYyyy(day: Date | null): string {
  if (!day) return "MM / DD / YYYY";
  return `${pad2(day.getMonth() + 1)} / ${pad2(day.getDate())} / ${day.getFullYear()}`;
}

function toDatetimeLocalString(day: Date, hh: number, mm: number): string {
  const y = day.getFullYear();
  const mo = day.getMonth() + 1;
  const d = day.getDate();
  return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** 월 그리드: 월~일, leading/trailing null 패딩 */
function monthGridCells(year: number, monthIndex: number): (number | null)[] {
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const dim = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export interface DraftDueDateTimeModalProps {
  open: boolean;
  /** `<input type="datetime-local">` 형식 초기값 (빈 문자면 미선택) */
  initialDatetimeLocal: string;
  saving: boolean;
  onClose: () => void;
  /** 로컬 datetime 문자열 */
  onConfirm: (datetimeLocal: string) => void;
}

/**
 * Draft 액션 마감일 — Figma 157:9403 Due Date & Time 다이얼로그 (인라인 달력 + Clear/Apply).
 */
export function DraftDueDateTimeModal(props: DraftDueDateTimeModalProps): ReactElement | null {
  const [pickerOpen, setPickerOpen] = useState(true);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  /** 상단 필드에 반영된 날짜 (Apply 후) */
  const [fieldDate, setFieldDate] = useState<Date | null>(null);
  /** 달력에서 선택 중 (Apply 전) */
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const resetFromInitial = useCallback(() => {
    const p = parseDatetimeLocalParts(props.initialDatetimeLocal);
    const now = new Date();
    if (p) {
      setFieldDate(p.day);
      setPendingDate(p.day);
      setViewYear(p.day.getFullYear());
      setViewMonth(p.day.getMonth());
    } else {
      setFieldDate(null);
      setPendingDate(null);
      setViewYear(now.getFullYear());
      setViewMonth(now.getMonth());
    }
    setPickerOpen(true);
  }, [props.initialDatetimeLocal]);

  useEffect(() => {
    if (props.open) resetFromInitial();
  }, [props.open, resetFromInitial]);

  const grid = useMemo(() => monthGridCells(viewYear, viewMonth), [viewYear, viewMonth]);

  function shiftMonth(delta: number): void {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  function handleApplyPicker(): void {
    setFieldDate(pendingDate);
    setPickerOpen(false);
  }

  function handleClearPicker(): void {
    setPendingDate(null);
  }

  function handleSet(): void {
    const day = fieldDate ?? pendingDate;
    if (!day) {
      alert("Choose a due date in the calendar, tap Apply, then Set.");
      return;
    }
    // 시간은 받지 않음 — 정오(12:00) 고정으로 타임존 경계 문제 회피.
    props.onConfirm(toDatetimeLocalString(day, 12, 0));
  }

  if (!props.open) return null;

  return (
    <DraftModalPortal open={props.open}>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a2540]/35 p-4 backdrop-blur-[2px]"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !props.saving) props.onClose();
        }}
      >
        <div
          className="max-h-[min(90vh,640px)] w-full max-w-[400px] overflow-y-auto rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-[0px_20px_30px_rgba(10,37,64,0.2)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="due-dt-title"
          onClick={(e) => e.stopPropagation()}
        >
        <h2 id="due-dt-title" className="text-xl font-bold text-[#0a2540]">
          Due Date
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-[#64748b]">Please Select Due Date</p>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <span className="text-[14px] font-medium tracking-tight text-[#545f71]">Date</span>
            <div
              className={`overflow-hidden rounded-md border border-solid ${
                pickerOpen ? "border-[#545f71]" : "border-[#e2e8f0]"
              } bg-white`}
            >
              <button
                type="button"
                onClick={() =>
                  setPickerOpen((o) => {
                    const next = !o;
                    if (next) setPendingDate(fieldDate);
                    return next;
                  })
                }
                className="flex h-12 w-full items-center justify-between gap-3 border-b border-[#eef1f4] px-3 text-left"
              >
                <span
                  className={`text-[16px] tracking-tight ${fieldDate || pendingDate ? "text-[#545f71]" : "text-[#94a3b8]"}`}
                >
                  {formatMmDdYyyy((pickerOpen ? pendingDate : null) ?? fieldDate)}
                </span>
                <Calendar className="size-6 shrink-0 text-[#545f71]" aria-hidden />
              </button>

              {pickerOpen ? (
                <div className="border-t border-[#eef1f4] px-2 pb-2 pt-3">
                  <div className="relative flex h-9 items-center justify-center">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      className="absolute left-1 flex size-8 items-center justify-center rounded-md text-[#757575] hover:bg-[#f8fafc]"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="text-[16px] font-semibold tracking-tight text-[#757575]">
                      {monthLabel(viewYear, viewMonth)}
                    </span>
                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      className="absolute right-1 flex size-8 items-center justify-center rounded-md text-[#757575] hover:bg-[#f8fafc]"
                      aria-label="Next month"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>

                  <div className="mt-2 grid grid-cols-7 gap-0 text-center text-[14px] text-[#757575]">
                    {WEEKDAYS.map((w) => (
                      <div key={w} className="py-2 text-[13px] font-normal">
                        {w}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-y-1 text-center text-[16px]">
                    {grid.map((cell, idx) => {
                      if (cell == null) {
                        return <div key={`e-${idx}`} className="h-10" />;
                      }
                      const cellDate = new Date(viewYear, viewMonth, cell);
                      const selected =
                        pendingDate != null && sameLocalDay(pendingDate, cellDate);
                      return (
                        <div key={idx} className="flex h-10 items-center justify-center p-0.5">
                          <button
                            type="button"
                            onClick={() => setPendingDate(cellDate)}
                            className={
                              selected
                                ? "flex size-10 items-center justify-center rounded-full bg-[#757575] text-[15px] font-semibold text-white"
                                : "flex size-10 items-center justify-center rounded-full text-[#757575] hover:bg-[#f4f4f4]"
                            }
                          >
                            {cell}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleClearPicker}
                      className="flex h-12 flex-1 items-center justify-center rounded-md bg-[#f4f4f4] text-[16px] font-semibold text-[#757575]"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={handleApplyPicker}
                      className="flex h-12 flex-1 items-center justify-center rounded-md bg-[#757575] text-[16px] font-semibold text-white"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

        </div>

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.saving}
            className="flex h-12 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.saving}
            onClick={handleSet}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#ff6b35] text-[15px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] hover:opacity-90 disabled:opacity-60"
          >
            {props.saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Set
          </button>
        </div>
      </div>
    </div>
    </DraftModalPortal>
  );
}
