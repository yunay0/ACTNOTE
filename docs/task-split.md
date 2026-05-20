# 0.5v 작업 분리 — 프론트 / 백엔드

> 최종 갱신: 2026-05-20  
> 역할: 동욱(백엔드) / 유나(프론트)  
> 기준: 기획서 docs/0.3.md + docs/0.5.md 원본

---

## 프론트 단독 (유나)

프론트에서만 처리하면 되는 항목. 백엔드 API/DB 변경 불필요.

| # | ID | 기능 | 작업 내용 | 파일 |
|---|---|---|---|---|
| F-1 | UX-002 | 랜딩 버튼 연결 | Sign in / Start 버튼 → Google OAuth 페이지 연결. 정책 링크 연결. | 랜딩/로그인 페이지 |
| F-2 | UX-004 | 탭 색상 수정 | 기획서 스펙: Analyzing=초록, Draft=노랑, Published=파랑 (현재 코드와 불일치) | `meetings/page.tsx` |
| F-3 | STT-002 | 화자 라벨 표시 | transcript 블록에 SPEAKER_00 → 이름 or "화자 1" 라벨 표시. `meeting_speaker_mapping` 또는 `participants` 매핑 사용. | `meetings/[id]/page.tsx` |
| F-4 | DRAFT-010 | 화자 확정 드롭다운 | `ai_draft_notes.speaker_candidates` (confidence ≥ 0.4) 읽어서 화자별 드롭다운 표시 → 선택 시 `meeting_speaker_mapping` INSERT. | `meetings/[id]/page.tsx` |
| F-5 | PUB-003/004 | Notion 링크 표시 | 발행 후 `meetings.notion_page_id` NULL 아니면 링크 노출. | `meetings/[id]/page.tsx` |
| F-6 | INTEG-005 | 역할별 분기 | Notion 미연동 팝업에서 Owner와 Member 메시지 분리. (Owner: 설정으로 이동 / Member: 담당자에게 문의) | `meetings/[id]/page.tsx` |
| F-7 | WS-004 | Owner 삭제 팝업 | Owner가 자기 자신을 삭제 시도 시 경고 팝업 표시 (현재 반응 없음). last_owner_cannot_be_demoted 에러 활용. | `settings/workspace/page.tsx` |

---

## 백엔드 단독 (동욱)

프론트 없이 백엔드에서만 완결 가능한 항목.

| # | ID | 기능 | 작업 내용 | 파일 |
|---|---|---|---|---|
| B-1 | SEC-001 | 옵트아웃 DB 반영 | `settings/workspace` 토글 → `workspaces.opt_out_training` 실제 UPDATE 확인. 안 되면 RPC or 직접 UPDATE 추가. | `src/policy.py`, 마이그레이션 |
| B-2 | INTEG-006-001 | Notion 회의록 템플릿 | Notion API로 공식 템플릿 페이지/DB 생성 로직. 연동 설정 시 대상 DB 없으면 자동 생성 or 링크 제공. | `src/notion_sync.py` |
| B-3 | INTEG-006-002 | Notion 이슈트래커 템플릿 | 티켓 대상 Notion DB 없을 때 공식 템플릿 제공. | `src/notion_sync.py` |
| B-4 | 이메일 정리 | Resend 코드 분기 제거 | 이메일 방향 확정(Gmail SMTP or 보류) 후 불필요 분기 정리. `email_notifier.py`, `smtp_mail.py`. | `src/email_notifier.py` |

---

## 풀스택 (백엔드 API 먼저 → 프론트 연결)

백엔드가 API/마이그레이션을 준비하면 프론트가 연결하는 항목.  
**동욱이 API 준비 완료 후 유나에게 인터페이스 전달 필요.**

| # | ID | 기능 | 백엔드 작업 (동욱) | 프론트 작업 (유나) |
|---|---|---|---|---|
| FS-1 | INTEG-001 | Notion 회의록 연동 설정 UI | Notion DB 목록 조회 API(`GET /api/integrations/notion/databases`) + 필드 매핑 저장 API(`POST /api/integrations/notion/mapping`) 구현 | `settings/integrations` 페이지에서 DB 선택 + 필드 매핑 UI 구현 |
| FS-2 | INTEG-002 | Notion 티켓 발행용 연동 설정 | 티켓 DB 분리 저장 (`integrations` 테이블에 `ticket_db_id`, `ticket_field_mapping` 컬럼 추가, 마이그레이션 024) | INTEG-001과 별도 섹션으로 티켓 DB 설정 UI |
| FS-3 | DRAFT-007 | 관련 문서 링크 UI | `document_links` 저장 형식 확정 + 수정 API(Supabase 직접 or RPC) 확인 | 회의 상세에서 문서 링크 추가·삭제 UI |
| FS-4 | DRAFT-010 | 화자 확정 저장 | `meeting_speaker_mapping` 테이블 마이그레이션(스키마 협의) + INSERT RPC | 화자 드롭다운 선택 시 RPC 호출 |

---

## 보류 (오늘 범위 외)

| ID | 기능 | 이유 |
|---|---|---|
| WS-006 | 멤버 접근 요청/승인 | 새 테이블 + 승인 플로우 필요. 큰 작업. |
| INTEG-002 (Google Drive) | Google Drive 연동 | 기획서 기준 v1.0+ 예정. 0.5v 범위 외. |
| NOTI 이메일 | Resend/SMTP 이메일 알림 | 이메일 방향 미결정으로 보류. |

---

## 프론트-백엔드 인터페이스 정의 (FS 항목용)

### FS-1: INTEG-001 Notion DB 목록 조회

```
GET /api/integrations/notion/databases
Response: { databases: [{ id: string, title: string }] }
```

### FS-2: INTEG-002 필드 매핑 저장

```
POST /api/integrations/notion/mapping
Body: {
  meeting_db_id: string,        // 회의록 발행 대상 DB
  ticket_db_id: string,         // 티켓 발행 대상 DB (INTEG-002)
  field_mapping: {
    title: string,
    summary: string,
    decisions: string,
    action_items: string,
  }
}
```

### FS-4: DRAFT-010 화자 확정 저장

```sql
-- 마이그레이션 024 협의 필요
CREATE TABLE meeting_speaker_mapping (
  meeting_id uuid REFERENCES meetings(id),
  speaker_label text,           -- SPEAKER_00
  user_id uuid REFERENCES profiles(id),
  confirmed_at timestamptz,
  PRIMARY KEY (meeting_id, speaker_label)
);
```
