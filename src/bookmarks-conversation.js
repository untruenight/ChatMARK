// ============================================================
// bookmarks-conversation.js — URL 정규화 + Conversation ID 추출
// ============================================================
// 비유: "주소 분류기". URL에서 대화 ID를 추출하고 정규화된 키를 만드는 역할입니다.

import {
  ORIGIN_ALIASES,
  SITE_PROFILES,
  DEFAULT_CONVERSATION_PATH_TOKENS,
  DEFAULT_CONVERSATION_QUERY_KEYS,
  RESERVED_CONVERSATION_SEGMENTS
} from './constants.js';
import { uniqueStrings } from './text.js';

// ============================================================
// Site profile lookup
// ============================================================

export function getCurrentSiteProfile(input) {
  try {
    const url = input instanceof URL
      ? input
      : new URL(String(input || window.location.href), window.location.origin);
    const hostname = String(url.hostname || "").toLowerCase();

    return SITE_PROFILES.find(function (profile) {
      return profile.hosts.some(function (host) {
        return hostname === host || hostname.endsWith("." + host);
      });
    }) || null;
  } catch (error) {
    return null;
  }
}

// ============================================================
// URL 정규화 + Conversation ID 추출
// ============================================================

export function getCurrentUrlKey() {
  return normalizeUrlKey(window.location.href);
}

/**
 * ⚠️ STORAGE-CRITICAL: 이 함수의 출력이 모든 v2 샤드 키의 근간입니다.
 * 출력 형식(origin + "/c/" + id)을 변경하면 기존 저장 데이터 전체가 접근 불가능해집니다.
 */
export function normalizeUrlKey(input) {
  if (!input) {
    return "";
  }

  try {
    const url = new URL(input, window.location.origin);
    url.hash = "";
    const alias = ORIGIN_ALIASES[url.origin];
    if (alias) {
      const aliasUrl = new URL(alias);
      url.hostname = aliasUrl.hostname;
      url.protocol = aliasUrl.protocol;
    }
    const conversationId = extractConversationIdFromUrl(url);
    if (conversationId) {
      return buildConversationUrlKey(url, conversationId);
    }
    return url.toString();
  } catch (error) {
    return "";
  }
}

export function extractConversationIdFromUrl(url) {
  if (!url || !url.pathname) {
    return "";
  }

  const profile = getCurrentSiteProfile(url);
  const queryValue = extractConversationIdFromQuery(url, profile);
  if (queryValue) {
    return queryValue;
  }

  const pathValue = extractConversationIdFromPathHints(url, profile);
  if (pathValue) {
    return pathValue;
  }

  const opaqueValue = extractConversationIdFromOpaquePath(url);
  if (opaqueValue) {
    return opaqueValue;
  }

  return "";
}

export function looksLikeUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

// ============================================================
// Internal helpers
// ============================================================

function extractConversationIdFromQuery(url, profile) {
  if (!url || !url.searchParams) {
    return "";
  }

  const keys = uniqueStrings((profile && profile.conversationQueryKeys || []).concat(DEFAULT_CONVERSATION_QUERY_KEYS));
  for (let index = 0; index < keys.length; index += 1) {
    const value = normalizeConversationIdCandidate(url.searchParams.get(keys[index]));
    if (value) {
      return value;
    }
  }

  return "";
}

function extractConversationIdFromPathHints(url, profile) {
  const segments = getPathSegments(url);
  const tokens = uniqueStrings((profile && profile.conversationPathTokens || []).concat(DEFAULT_CONVERSATION_PATH_TOKENS));

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = String(tokens[tokenIndex] || "").toLowerCase();

    for (let segmentIndex = segments.length - 2; segmentIndex >= 0; segmentIndex -= 1) {
      if (String(segments[segmentIndex] || "").toLowerCase() !== token) {
        continue;
      }

      const value = normalizeConversationIdCandidate(segments[segmentIndex + 1]);
      if (value) {
        return value;
      }
    }
  }

  return "";
}

function extractConversationIdFromOpaquePath(url) {
  const segments = url.pathname
    .split("/")
    .filter(Boolean);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const value = normalizeConversationIdCandidate(segments[index]);
    if (value) {
      return value;
    }
  }

  return "";
}

function getPathSegments(url) {
  if (!url || !url.pathname) {
    return [];
  }

  return url.pathname
    .split("/")
    .filter(Boolean);
}

function normalizeConversationIdCandidate(value) {
  if (!value) {
    return "";
  }

  let candidate = "";
  try {
    candidate = decodeURIComponent(String(value || ""));
  } catch (error) {
    candidate = String(value || "");
  }

  candidate = candidate.trim().replace(/^\/+|\/+$/g, "");
  return isLikelyConversationIdSegment(candidate) ? candidate : "";
}

function isLikelyConversationIdSegment(segment) {
  if (!segment) {
    return false;
  }

  const normalized = String(segment || "").trim();
  if (normalized.length < 8) {
    return false;
  }

  const lowered = normalized.toLowerCase();
  if (RESERVED_CONVERSATION_SEGMENTS.indexOf(lowered) >= 0) {
    return false;
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    return true;
  }

  if (!/^[A-Za-z0-9._:-]{8,}$/.test(normalized)) {
    return false;
  }

  return (
    /[0-9]/.test(normalized) ||
    /[-_.:]/.test(normalized) ||
    /[A-Z]/.test(normalized) ||
    /^[a-z]{16,}$/.test(normalized)
  );
}

/**
 * ⚠️ STORAGE-CRITICAL: 출력 형식(origin + "/c/" + id)을 변경하면
 * 기존 저장 데이터 전체가 접근 불가능해집니다.
 */
function buildConversationUrlKey(url, conversationId) {
  return url.origin + "/c/" + encodeURIComponent(conversationId);
}
