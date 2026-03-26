// ============================================================
// utils/text.js — 텍스트 처리 유틸리티 (순수 함수들)
// ============================================================
// 비유: "텍스트 가공 공장". 입력 텍스트를 다듬고, 자르고, 지문(해시)을 만듭니다.
// 이 파일의 함수들은 DOM에 접근하지 않으므로 단위 테스트가 쉽습니다.

/**
 * 공백을 정리하고 양끝을 트림합니다.
 * "  hello   world  " → "hello world"
 */
export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 짧은 라벨을 만듭니다 (최대 80자).
 */
export function createLabel(value) {
  const text = normalizeText(value) || "Bookmark";
  return truncateText(text, 80);
}

/**
 * 텍스트를 maxLength 이하로 자르고, 넘으면 끝에 "…"을 붙입니다.
 * normalizeText를 먼저 적용합니다.
 */
export function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

/**
 * 원본 텍스트를 정규화 없이 그대로 자릅니다.
 * 코드 블록 등 공백이 의미 있는 경우에 사용합니다.
 */
export function truncateRawText(value, maxLength) {
  const text = String(value || "");
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(0, maxLength - 1)) + "…";
}

/**
 * 텍스트의 "지문"(fingerprint)을 생성합니다.
 * 비유: 사람의 지문처럼, 텍스트를 짧은 고유 문자열로 요약합니다.
 * 앞 320자만 샘플링하여 FNV-1a 변형 해시를 적용합니다.
 * 결과: "길이:해시" (예: "156:a3f2b1")
 */
export function fingerprintText(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  const sample = normalized.slice(0, 320);
  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return normalized.length + ":" + (hash >>> 0).toString(36);
}

/**
 * 원본 텍스트(코드 등)의 지문. 앞 480자 샘플링.
 */
export function fingerprintRawText(value) {
  const rawText = String(value || "");
  if (!rawText) {
    return "";
  }

  const sample = rawText.slice(0, 480);
  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  return rawText.length + ":" + (hash >>> 0).toString(36);
}

/**
 * 값을 min~max 범위로 제한합니다.
 * clamp(150, 0, 100) → 100
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 배열에서 중복 요소를 제거합니다.
 */
export function uniqueElements(elements) {
  return Array.from(new Set(elements));
}

/**
 * 문자열 배열에서 빈 값 제거 + 중복 제거.
 */
export function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

/**
 * 정수가 아니면 -1을 반환합니다.
 */
export function normalizeInteger(value) {
  return Number.isInteger(value) ? value : -1;
}
