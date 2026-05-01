# Actnote

음성 회의록 → STT → 화자 분리 → LLM 액션 아이템 추출 콘솔 파이프라인 (1주차).

> 미니 프로젝트 3 : 생성형 AI 툴 활용 기획

---

## 1. 사전 준비

다음 키 / 라이선스가 필요합니다.

- **OpenAI API Key** — Whisper API 호출 (https://platform.openai.com/api-keys)
- **Anthropic API Key** — Claude Sonnet 4.6 호출 (https://console.anthropic.com/)
- **HuggingFace Token** — pyannote 화자 분리 모델 다운로드용
  - 토큰 발급: https://huggingface.co/settings/tokens
  - 모델 라이선스 동의 필수:
    - https://huggingface.co/pyannote/speaker-diarization-3.1
    - https://huggingface.co/pyannote/segmentation-3.0

> ⚠ MVP 범위는 **영어 회의만** 지원합니다 (북미·유럽 PM 타깃).

---

## 2. 셋업

```bash
# uv 설치 (Windows PowerShell 기준)
# https://docs.astral.sh/uv/getting-started/installation/

# 의존성 설치
uv sync

# 환경 변수 설정
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
# 그 다음 .env에 실제 API 키를 채워 넣으세요.
```

---

## 3. 사용법

```bash
# 풀 파이프라인 (STT → 화자 분리 → 정렬 → LLM)
uv run python scripts/run_pipeline.py --audio path/to/meeting.wav

# 회의 제목 지정 (선택)
uv run python scripts/run_pipeline.py --audio path/to/meeting.wav --title "Weekly sync"

# 벤치마크: 폴더 안 .wav / .mp3 전부 순회 (비용 예상 출력 → y/n 확인 → 실행)
uv run python scripts/benchmark.py --test-data path/to/audio_folder

# 비용 확인했을 때 프롬프트 생략
uv run python scripts/benchmark.py --test-data path/to/audio_folder --confirm

# 벤치 종료 후 RAG용 문자 청크(500/1000/1500/2000자) 통계 CSV 추가
uv run python scripts/benchmark.py --test-data path/to/audio_folder --confirm --chunk-test
```

벤치마크 출력:

| 산출물 | 설명 |
| --- | --- |
| `{output}/results.csv` | 파일별 시간·비용·액션 수·confidence 등 |
| `{output}/chunk_comparison.csv` | `--chunk-test` 시만 (성공 분 transcript 텍스트 합본 기준) |
| `{output}/<파일stem>/` | 파일별 파이프라인 산출물 (`transcript.json`, `diarization.json`, …) |

벤치마크는 **확인 후** `cost_tracker.reset()`으로 카운터를 초기화한 뒤 배치를 돕니다. 배치 시작 전에 **현재 누적 + 예상 비용이 `MAX_TOTAL_COST_USD`를 넘으면 즉시 종료**합니다 (추가 진행 없음).

각 모듈은 단독 실행 가능합니다 (`uv run python -m src.<module>` 또는 `uv run python src/<module>.py`).

```bash
uv run python -m src.cost_tracker   # 비용 트래커 단독 테스트
```

---

## 4. 비용 가드레일

`.env`에서 임계값을 조정할 수 있습니다.

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `MAX_COST_PER_MEETING_USD` | `1.0` | 한 회의 처리 예상 비용 초과 시 경고 |
| `MAX_TOTAL_COST_USD` | `10.0` | 누적 비용 초과 시 자동 중단 + 사용자 confirmation |

가격 단가 (2026.05 기준):

- OpenAI Whisper API: **$0.006 / 분**
- Claude Sonnet 4.6: **input $3 / Mtok**, **output $15 / Mtok**
- 60분 회의 처리당 약 **$0.42** 예상

---

## 5. 폴더 구조

```
actnote/
├── src/
│   ├── stt.py              # Step 2: Whisper STT
│   ├── diarization.py      # Step 3: pyannote 화자 분리
│   ├── alignment.py        # Step 4: STT + 화자 정렬
│   ├── llm_extractor.py    # Step 5: Claude 액션 아이템 추출
│   ├── pipeline.py         # Step 6: 풀 파이프라인 오케스트레이션
│   └── cost_tracker.py     # API 비용 추적 (완료)
├── scripts/
│   ├── run_pipeline.py     # CLI 진입점 (Step 6)
│   └── benchmark.py        # 벤치마크 (Step 7)
├── test_data/              # 테스트 음성 (gitignore)
├── output/                 # 결과 저장 (gitignore)
└── pyproject.toml
```

---

## 6. 범위 제한 (1주차)

다음은 **이번 주에 구현하지 않습니다**:

- 웹 UI / 프론트엔드
- 데이터베이스 / Supabase
- 사용자 인증
- 백그라운드 큐 (Celery 등)
- 외부 통합 (Notion / Slack / Jira)
- 실시간 처리 / WebSocket
- Docker / 배포 설정
- 한국어 처리 (영어 only)
