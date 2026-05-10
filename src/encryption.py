"""SEC-009: Notion 연동 토큰 Fernet 암호화/복호화.

환경변수 ACTNOTE_ENCRYPTION_KEY 에 Fernet 키를 설정해야 한다.
키 생성: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    raw = os.environ.get("ACTNOTE_ENCRYPTION_KEY", "").strip()
    if not raw:
        raise EnvironmentError(
            "ACTNOTE_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.\n"
            "  python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "로 키를 생성하고 .env 에 추가하세요."
        )
    return Fernet(raw.encode())


def encrypt_token(plaintext: str) -> str:
    """평문 토큰을 Fernet 암호화하여 str로 반환한다."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Fernet 암호화된 토큰을 복호화하여 평문 str로 반환한다."""
    return _fernet().decrypt(ciphertext.encode()).decode()


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    from rich.console import Console

    load_dotenv()
    console = Console()

    sample = "notion-secret-test-token-abc123"
    enc = encrypt_token(sample)
    dec = decrypt_token(enc)
    assert dec == sample, f"round-trip 실패: {dec!r} != {sample!r}"
    console.print(f"[green][OK][/] encrypt → decrypt round-trip 성공")
    console.print(f"  plaintext : {sample}")
    console.print(f"  encrypted : {enc[:40]}...")
