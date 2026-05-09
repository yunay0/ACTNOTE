-- SEC-001: 학습 옵트아웃 정책
-- users.opt_out_training 기본값 FALSE → TRUE 변경 (프라이버시 우선)
-- workspaces에 opt_out_training 컬럼 추가 (기본값 TRUE)

ALTER TABLE users
    ALTER COLUMN opt_out_training SET DEFAULT TRUE;

ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS opt_out_training BOOLEAN DEFAULT TRUE;
