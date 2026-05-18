/** Notion legal pages (public). */

export const TERMS_OF_SERVICE_URL =
  "https://www.notion.so/ACTNOTE-Terms-of-Service-35ab26f4c46a805890b5de6a58513e86?source=copy_link";

export const PRIVACY_POLICY_URL =
  "https://www.notion.so/ACTNOTE-Privacy-Policy-35ab26f4c46a80e18e94d5ef43814663?source=copy_link";

/** 공식 지원 메일 — 랜딩 푸터 Support 링크 고정. */
export const SUPPORT_EMAIL = "actnote.support@gmail.com";

/** Landing footer — opens default mail client addressed to support. */
export function supportMailtoHref(): string {
  const subject = encodeURIComponent("ACTNOTE — Support");
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
}
