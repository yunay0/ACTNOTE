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

## 상세 룰 (별도 파일)
- 프론트엔드 코딩 스타일: @.cursor/rules/frontend-style.mdc
- 도메인 모델: @.cursor/rules/actnote-domain.mdc
- 백엔드-프론트 협업: @.cursor/rules/handoff-protocol.mdc