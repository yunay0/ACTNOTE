"""SEC-001: 학습 옵트아웃 정책 조회.

워크스페이스·사용자 단위 opt_out_training 플래그를 읽어
AI API 호출 시 학습 데이터 포함 여부를 결정한다.
"""

from __future__ import annotations

import logging

_log = logging.getLogger(__name__)


def get_opt_out_status(
    workspace_id: str,
    user_id: str | None = None,
    sb_client=None,
) -> bool:
    """학습 옵트아웃 여부 반환.

    워크스페이스 또는 사용자 중 하나라도 opt_out_training=True이면 True.
    DB 조회 실패 시 보수적으로 True 반환 (프라이버시 우선).

    Args:
        workspace_id: 조회할 워크스페이스 UUID.
        user_id: 조회할 사용자 UUID. None이면 사용자 단위 조회 생략.
        sb_client: Supabase 클라이언트. None이면 환경변수로 생성.

    Returns:
        True = 학습 옵트아웃 (API에 training 데이터 미포함).
        False = 학습 허용.
    """
    try:
        if sb_client is None:
            from src.storage import create_supabase_client_from_env
            sb_client = create_supabase_client_from_env()

        ws_resp = (
            sb_client.table("workspaces")
            .select("opt_out_training")
            .eq("id", workspace_id)
            .single()
            .execute()
        )
        if ws_resp.data and ws_resp.data.get("opt_out_training"):
            return True

        if user_id:
            user_resp = (
                sb_client.table("users")
                .select("opt_out_training")
                .eq("id", user_id)
                .single()
                .execute()
            )
            if user_resp.data and user_resp.data.get("opt_out_training"):
                return True

        return False

    except Exception as e:
        _log.warning("opt_out 조회 실패 — 보수적으로 True 반환: %s", e)
        return True


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv()

    from src.storage import create_supabase_client_from_env

    sb = create_supabase_client_from_env()

    ws_id = os.getenv("TEST_WORKSPACE_ID", "")
    user_id = os.getenv("TEST_USER_ID", None)

    if not ws_id:
        print("TEST_WORKSPACE_ID 환경변수를 설정하세요.")
        raise SystemExit(1)

    # opt_out=True 테스트: workspaces.opt_out_training=TRUE로 업데이트
    sb.table("workspaces").update({"opt_out_training": True}).eq("id", ws_id).execute()
    result = get_opt_out_status(ws_id, user_id, sb_client=sb)
    assert result is True, f"opt_out=True 기대, 실제={result}"
    print(f"[OK] opt_out=True: {result}")

    # opt_out=False 테스트: workspaces.opt_out_training=FALSE로 업데이트
    sb.table("workspaces").update({"opt_out_training": False}).eq("id", ws_id).execute()
    result = get_opt_out_status(ws_id, user_id, sb_client=sb)
    assert result is False, f"opt_out=False 기대, 실제={result}"
    print(f"[OK] opt_out=False: {result}")

    # 원상복구
    sb.table("workspaces").update({"opt_out_training": True}).eq("id", ws_id).execute()
    print("[OK] 원상복구 완료 (opt_out_training=TRUE)")
