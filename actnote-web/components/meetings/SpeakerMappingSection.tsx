"use client";

import {
  useEffect,
  useMemo,
  useState,
  forwardRef,
  useCallback,
  useImperativeHandle,
} from "react";
import { Mic2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { workspaceMemberDisplayName } from "@/lib/user/member-display";
import { TranscriptViewer, type TranscriptLine } from "@/components/meetings/TranscriptViewer";

export type SpeakerCandidate = {
  user_id: string;
  name: string;
  email: string;
  confidence: number;
  reason: string;
};

export type { TranscriptLine };

export type SpeakerMappingSectionHandle = {
  /** DB에 현재 선택된 화자 매핑을 저장합니다. 라벨이 없으면 no-op 후 true 반환 */
  persist: () => Promise<boolean>;
};

type MemberOption = {
  user_id: string;
  name: string | null;
  email: string;
};

const CONFIDENCE_MIN = 0.4;

function parseDraftNotes(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw) && raw !== null) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    try {
      const p = JSON.parse(s) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeCandidates(raw: unknown): Record<string, SpeakerCandidate[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, SpeakerCandidate[]> = {};
  for (const [label, arr] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const list: SpeakerCandidate[] = [];
    for (const c of arr) {
      if (!c || typeof c !== "object") continue;
      const o = c as Record<string, unknown>;
      const userId = typeof o.user_id === "string" ? o.user_id : "";
      if (!userId) continue;
      const conf = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
      if (!Number.isFinite(conf) || conf < CONFIDENCE_MIN) continue;
      list.push({
        user_id: userId,
        name: typeof o.name === "string" ? o.name : "",
        email: typeof o.email === "string" ? o.email : "",
        confidence: conf,
        reason: typeof o.reason === "string" ? o.reason : "",
      });
    }
    if (list.length) out[label] = list.sort((a, b) => b.confidence - a.confidence);
  }
  return out;
}

function normalizeMapping(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export const SpeakerMappingSection = forwardRef<
  SpeakerMappingSectionHandle,
  {
    meetingId: string;
    speakerCandidates: Record<string, SpeakerCandidate[]>;
    initialMapping: Record<string, string>;
    transcripts: TranscriptLine[];
    members: MemberOption[];
    canEdit: boolean;
    onSaved?: () => void;
  }
>(function SpeakerMappingSection(props, ref) {
  const {
    meetingId,
    speakerCandidates,
    initialMapping,
    transcripts,
    members,
    canEdit,
    onSaved,
  } = props;

  const labels = useMemo(() => {
    const fromCandidates = Object.keys(speakerCandidates);
    const fromTx = new Set<string>();
    for (const row of transcripts) {
      const sl = (row.speaker_label ?? "").trim();
      if (sl && sl !== "UNKNOWN") fromTx.add(sl);
    }
    const merged = [...fromCandidates, ...Array.from(fromTx)];
    return Array.from(new Set(merged)).sort();
  }, [speakerCandidates, transcripts]);

  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setMapping(initialMapping);
  }, [initialMapping]);

  const persistMapping = useCallback(
    async (showUiMessage: boolean): Promise<boolean> => {
      if (labels.length === 0 && transcripts.length === 0) {
        return true;
      }

      const supabase = createClient();

      const { data: row, error: fetchErr } = await (supabase as any)
        .from("meetings")
        .select("ai_draft_notes")
        .eq("id", meetingId)
        .single();

      if (fetchErr || !row) {
        const msg = fetchErr?.message ?? "Could not load draft notes.";
        if (showUiMessage) {
          setMessage(msg);
        } else {
          alert(`Failed to save speaker mapping: ${msg}`);
        }
        return false;
      }

      const base = parseDraftNotes(row.ai_draft_notes) ?? {};
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(mapping)) {
        if (v && v.trim()) cleaned[k] = v.trim();
      }
      const next = { ...base, speaker_mapping: cleaned };

      const { error: upErr } = await (supabase as any)
        .from("meetings")
        .update({ ai_draft_notes: JSON.stringify(next) })
        .eq("id", meetingId);

      if (upErr) {
        if (showUiMessage) {
          setMessage(upErr.message);
        } else {
          alert(`Failed to save speaker mapping: ${upErr.message}`);
        }
        return false;
      }

      if (showUiMessage) {
        setMessage("Saved.");
        setTimeout(() => setMessage(null), 2500);
      }
      onSaved?.();
      return true;
    },
    [labels.length, transcripts.length, meetingId, mapping, onSaved]
  );

  useImperativeHandle(
    ref,
    () => ({
      persist: () => persistMapping(false),
    }),
    [persistMapping]
  );

  async function handleSave() {
    setMessage(null);
    setSaving(true);
    try {
      await persistMapping(true);
    } finally {
      setSaving(false);
    }
  }

  if (labels.length === 0 && transcripts.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <Mic2 className="h-4 w-4 text-[#ff6b35]" />
        <h2 className="text-[15px] font-bold text-[#0a2540]">Speakers & transcript</h2>
      </div>
      <p className="text-[13px] text-[#64748b] leading-relaxed">
        <span className="font-semibold text-[#475569]">DRAFT-010:</span> Diarization labels (e.g.{" "}
        SPEAKER_00) are anonymous. When AI suggests workspace members from speech patterns, pick the
        correct person to confirm. You can also assign anyone from the team list.
      </p>

      {labels.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#94a3b8]">
            Map speakers to members
          </p>
          {labels.map((label) => {
            const cands = speakerCandidates[label] ?? [];
            const value = mapping[label] ?? "";
            return (
              <div
                key={label}
                className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3 space-y-2"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-bold text-[#0a2540]">{label}</span>
                  <select
                    disabled={!canEdit}
                    value={value}
                    onChange={(e) =>
                      setMapping((prev) => {
                        const next = { ...prev };
                        if (e.target.value) next[label] = e.target.value;
                        else delete next[label];
                        return next;
                      })
                    }
                    className="h-9 w-full sm:w-72 rounded-lg border border-[#e2e8f0] bg-white px-3 text-sm text-[#0a2540] disabled:bg-[#f1f5f9] disabled:cursor-not-allowed"
                  >
                    <option value="">Unmapped</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.email
                          ? `${workspaceMemberDisplayName(m.name, m.email)} (${m.email})`
                          : workspaceMemberDisplayName(m.name, m.email)}
                      </option>
                    ))}
                  </select>
                </div>
                {cands.length > 0 && (
                  <div className="text-[12px] text-[#64748b] space-y-1">
                    <span className="font-semibold text-[#475569]">AI suggestions:</span>
                    <ul className="list-none space-y-1 pl-0">
                      {cands.map((c) => (
                        <li key={c.user_id} className="flex flex-wrap gap-x-2">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setMapping((prev) => ({ ...prev, [label]: c.user_id }))
                            }
                            className="text-left font-medium text-[#2e5c8a] hover:underline disabled:text-[#94a3b8] disabled:no-underline"
                          >
                            {c.name || c.email.split("@")[0]}
                          </button>
                          <span className="text-[#94a3b8]">
                            {Math.round(c.confidence * 100)}% — {c.reason || "no reason given"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cands.length === 0 && (
                  <p className="text-[11px] text-[#94a3b8]">
                    No AI match above {CONFIDENCE_MIN * 100}% — choose manually.
                  </p>
                )}
              </div>
            );
          })}
          {canEdit && (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                {saving ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save speaker mapping
              </button>
              {message && <span className="text-sm text-[#64748b]">{message}</span>}
            </div>
          )}
        </div>
      )}

      {transcripts.length > 0 && (
        <TranscriptViewer
          bare
          transcripts={transcripts}
          speakerMapping={mapping}
          members={members}
        />
      )}
    </section>
  );
});

export { normalizeCandidates, normalizeMapping };
