import { FREE_EMAIL_DOMAINS } from "./free-email-domains";

/** 이메일 주소에서 @ 뒷부분을 추출하여 소문자로 정규화한다. */
function extractDomain(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1) return "";
  return trimmed.slice(at + 1);
}

/**
 * 무료/개인 이메일 도메인 여부를 판별한다.
 * true이면 가입 차단 대상 (gmail.com, naver.com 등).
 */
export function isFreeEmailDomain(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return false;
  return FREE_EMAIL_DOMAINS.has(domain);
}

/** 도메인 문자열만 받는 버전 (invite 체크 등에서 사용). */
export function isFreeEmailDomainByDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}
