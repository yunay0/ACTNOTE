import type { FormEvent } from "react";

/** 네이티브 검증 말풍선 문구를 영어로 고정 (OS/브라우저 한국어 UI 우회). */
export function englishFieldInvalidMessage(e: FormEvent<HTMLInputElement>): void {
  const el = e.currentTarget;
  if (el.type === "checkbox") {
    if (el.validity.valueMissing) {
      el.setCustomValidity("Please agree to continue.");
    } else {
      el.setCustomValidity("");
    }
    return;
  }
  if (el.validity.valueMissing) {
    el.setCustomValidity("Please fill out this field.");
    return;
  }
  if (el.validity.typeMismatch) {
    el.setCustomValidity(
      "Please enter an email address in this format: name@example.com.",
    );
    return;
  }
  if (el.validity.tooShort) {
    const min = el.minLength;
    el.setCustomValidity(
      min > 0
        ? `Please lengthen this text to ${min} characters or more.`
        : "This text is too short.",
    );
    return;
  }
  el.setCustomValidity("");
}

/** 입력 시 커스텀 메시지 초기화 — 브라우저가 다시 표준 규칙으로 검사하도록 함. */
export function clearNativeValidity(el: HTMLInputElement): void {
  el.setCustomValidity("");
}
