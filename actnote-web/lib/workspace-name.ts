/** Workspace display name rules (onboarding + settings). */

export const MAX_WORKSPACE_NAME_LENGTH = 50;

// Allowed on submit: letters, numbers, space, apostrophe (DB default "User's workspace"), - _ & . and Unicode scripts (incl. Hangul).
const ALLOWED_PATTERN =
  /^[A-Za-z0-9 \-_&.'\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF]+$/;

export function validateWorkspaceName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Workspace name is required.";
  if (trimmed.length > MAX_WORKSPACE_NAME_LENGTH) {
    return `Must be ${MAX_WORKSPACE_NAME_LENGTH} characters or fewer.`;
  }
  if (!ALLOWED_PATTERN.test(trimmed)) {
    return "Only letters, numbers, spaces, apostrophes ('), and - _ & . are allowed.";
  }
  return null;
}
