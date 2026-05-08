"use client";

import { useState, useEffect, useCallback } from "react";
import type { Meeting } from "@/lib/types/meeting";
import { isProcessing, MOCK_PROCESSING_MS } from "@/lib/types/meeting";

const STORAGE_KEY = "actnote_meetings";

export function useMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [hydrated, setHydrated] = useState(false);

  function load(): Meeting[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Meeting[]) : [];
    } catch {
      return [];
    }
  }

  function save(list: Meeting[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    setMeetings(list);
  }

  // 최초 로드 + 모크 상태 자동 업데이트 폴링
  useEffect(() => {
    function tick() {
      const list = load();
      const now = Date.now();
      let changed = false;

      const updated = list.map((m) => {
        if (!isProcessing(m.status)) return m;
        const elapsed = now - new Date(m.created_at).getTime();
        if (elapsed >= MOCK_PROCESSING_MS) {
          changed = true;
          // 모크: 분석 완료 → 임시 저장
          return { ...m, status: "ready" as const };
        }
        return m;
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setMeetings(updated);
      } else {
        setMeetings(list);
      }
    }

    tick();
    setHydrated(true);

    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  const addMeeting = useCallback((meeting: Meeting) => {
    setMeetings((prev) => {
      const updated = [meeting, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteMeeting = useCallback((id: string) => {
    setMeetings((prev) => {
      const updated = prev.filter((m) => m.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const getMeeting = useCallback(
    (id: string): Meeting | undefined => meetings.find((m) => m.id === id),
    [meetings]
  );

  const publishMeeting = useCallback((id: string) => {
    setMeetings((prev) => {
      const updated = prev.map((m) =>
        m.id === id ? { ...m, status: "published" as const } : m
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { meetings, addMeeting, deleteMeeting, getMeeting, publishMeeting, hydrated };
}
