/**
 * Supabase 자동 생성 타입 플레이스홀더.
 * 실제 스키마 적용 후 아래 명령어로 교체:
 *   npx supabase gen types typescript --project-id <PROJECT_ID> > lib/types/supabase.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      meetings: {
        Row: {
          id: string;
          created_at: string;
          title: string;
          status:
            | "uploaded"
            | "transcribing"
            | "diarizing"
            | "summarizing"
            | "ready"
            | "error";
          summary: string | null;
          audio_url: string | null;
          workspace_id: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          title: string;
          status?:
            | "uploaded"
            | "transcribing"
            | "diarizing"
            | "summarizing"
            | "ready"
            | "error";
          summary?: string | null;
          audio_url?: string | null;
          workspace_id: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          title?: string;
          status?:
            | "uploaded"
            | "transcribing"
            | "diarizing"
            | "summarizing"
            | "ready"
            | "error";
          summary?: string | null;
          audio_url?: string | null;
          workspace_id?: string;
        };
      };
      action_items: {
        Row: {
          id: string;
          meeting_id: string;
          content: string;
          assignee: string | null;
          due_date: string | null;
          change_type: "ADD" | "UPDATE" | "DELETE";
          valid_from: string;
          valid_until: string | null;
          superseded_by: string | null;
          workspace_id: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          content: string;
          assignee?: string | null;
          due_date?: string | null;
          change_type: "ADD" | "UPDATE" | "DELETE";
          valid_from?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          workspace_id: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          content?: string;
          assignee?: string | null;
          due_date?: string | null;
          change_type?: "ADD" | "UPDATE" | "DELETE";
          valid_from?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          workspace_id?: string;
        };
      };
      decisions: {
        Row: {
          id: string;
          meeting_id: string;
          content: string;
          valid_from: string;
          valid_until: string | null;
          superseded_by: string | null;
          workspace_id: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          content: string;
          valid_from?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          workspace_id: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          content?: string;
          valid_from?: string;
          valid_until?: string | null;
          superseded_by?: string | null;
          workspace_id?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
