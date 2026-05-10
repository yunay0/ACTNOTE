# ACTNOTE — Project Context

## 프로젝트 한 줄 요약
회의 음성 → AI 요약·결정사항·액션 추출 → Notion DB 자동 등록 SaaS.

## 현재 단계
메인 프로젝트 1 (5/7~5/14): NLP 핵심 기능 + 유저 플로우 UI

## 핵심 차별점
- A.U.D.N 사이클: 액션 아이템 ADD/UPDATE/DELETE/NOOP 자동 결정
- Bi-temporal: 결정사항·액션 변경 이력 시간 추적

## 작업 분담
- A: 백엔드 (Python, Supabase, Inngest)
- B: 프론트엔드 (Next.js, Supabase JS, Tailwind)

## 절대 하지 말 것
1. service_role 키를 클라이언트 코드에 노출
2. localStorage에 인증 토큰 저장
3. 마이그레이션 파일 직접 수정 (동욱이 작성)
4. 실제 회의 transcript를 디자인 mockup에 그대로 사용 (개인정보)

## 코드 작성 시 우선순위
1. 동작하는 코드 (일단 됨)
2. 타입 안전성 (TypeScript strict)
3. 가독성
4. 성능 최적화 (마지막)

## 막혔을 때
- 도메인 질문 → @.cursor/rules/actnote-domain.mdc
- 프론트엔드 룰 → @.cursor/rules/frontend-style.mdc
- 협업 규칙 → @.cursor/rules/handoff-protocol.mdc
- 그 외에는 A에게 연락

## 프로젝트 폴더 구조
이 Git 레포 루트 = 백엔드 (Python). `actnote/` 같은 중첩 폴더는 없음.
├── src/
├── scripts/
├── migrations/
└── output/

actnote-web/                 ← 프론트엔드 (Next.js, 동일 레포 내 신규 디렉터리)
├── app/
├── components/
└── lib/

## 메인2 백로그

### Worker 에러 상태 처리 (해결됨 — 2026-05-10)

**해결:** `download-audio` + `run-pipeline`을 `download-and-process` 단일 step으로 통합하고 try/except를 step **외부**(코루틴 레벨)에 두는 방식으로 정상 동작 확인. 현재 `src/worker.py`에서:
1. 예외 catch → `update-status-error` step → `notify-analysis-failed` step → re-raise 흐름이 정상 실행됨.
2. 이벤트 스펙은 `docs/events.md` 단일 진실 원천으로 분리.

**검증 방법:** 일부러 깨진 `audio_path`로 `meeting/process` 발송 → `meetings.status='error'` + `notifications` row 1건 생성 확인.

---

### 재분석 멱등성 (발견: 2026-05-09)

**문제:** 같은 `meeting_id`로 파이프라인을 재실행하면 `transcripts`, `meeting_embeddings`가 중복 INSERT됨.
재현: 같은 `meeting_id`로 `process_meeting` 이벤트 두 번 발송.

**해결 방안:**
`pipeline.py` 시작부에 멱등성 보장 로직 추가:
- `transcripts`: DELETE 후 재INSERT
- `meeting_embeddings`: DELETE 후 재INSERT
- `decisions`: `valid_until` 만료 처리 (Bi-temporal)
- `action_items`: A.U.D.N 사이클이 자동 처리 (이미 됨)

**트리거:**
- 사용자 "다시 분석" 버튼
- 파이프라인 실패 후 자동 재시도

**영향 파일:**
- `src/pipeline.py` — 시작부 멱등성 로직
- `src/worker.py` — 재분석 이벤트 핸들러 추가

---

## 기능 ID 참조 룰

작업 요청에 기능 ID(예: PUB-002, INTEG-001, SEC-009, CONTEXT-001 등)가 포함되면:

1. 먼저 `docs/features.md` 파일을 읽는다
2. 해당 ID의 스펙을 정확히 파악한다
3. 스펙대로 구현한다
4. 스펙이 모호하면 추측하지 말고 사용자에게 질문한다

기능 ID 형식: 영문 대문자 + 하이픈 + 숫자
예: CAP-001, DRAFT-002, PUB-001, INTEG-003, SEC-009, CONTEXT-001

복합 ID 요청도 동일하게 처리:
"PUB-002 + INTEG-001/003 구현해줘" → 세 기능 모두 `docs/features.md`에서 확인 후 구현

## 상세 룰 (별도 파일)
- 프론트엔드 코딩 스타일: @.cursor/rules/frontend-style.mdc
- 도메인 모델: @.cursor/rules/actnote-domain.mdc
- 백엔드-프론트 협업: @.cursor/rules/handoff-protocol.mdc