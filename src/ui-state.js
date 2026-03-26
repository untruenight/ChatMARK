// ============================================================
// store/ui-state.js — 북마크 UI 상태 영속화 (핀, 확장, 정렬 등)
// ============================================================
// 비유: "인테리어 설정 저장". 어떤 북마크가 펼쳐져 있는지, 핀되어 있는지 등
//       UI 레이아웃 상태를 storage에 저장/복원합니다.

import state from './state.js';
import { storageGet, storageSet, storageRemove } from './storage.js';
import {
  normalizeUrlKey,
  getBookmarkUiStateShardStorageKey,
  getPopupLayoutShardStorageKey
} from './bookmarks.js';

// ---- 콜백 주입 (순환 의존 방지) ----
// UI layer (store → ui 방향 금지)
let _releaseResizeLockedExpandedBookmarkForInteraction = null;
let _syncExpandedBookmarkState = null;

// popup.js (DOM 측정 체인 포함)
let _normalizePopupLayout = null;

export function setUiStateCallbacks(callbacks) {
  _releaseResizeLockedExpandedBookmarkForInteraction = callbacks.releaseResizeLockedExpandedBookmarkForInteraction || null;
  _syncExpandedBookmarkState = callbacks.syncExpandedBookmarkState || null;
  _normalizePopupLayout = callbacks.normalizePopupLayout || null;
}

// ============================================================
// 북마크 ID 유틸
// ============================================================

export function buildKnownBookmarkIdMap(bookmarks) {
  const knownBookmarkIds = {};
  (Array.isArray(bookmarks) ? bookmarks : []).forEach(function (bookmark) {
    if (bookmark && bookmark.id) {
      knownBookmarkIds[bookmark.id] = true;
    }
  });
  return knownBookmarkIds;
}

function getBookmarkIdList(bookmarks) {
  return (Array.isArray(bookmarks) ? bookmarks : [])
    .map(function (bookmark) {
      return bookmark && bookmark.id ? bookmark.id : "";
    })
    .filter(Boolean);
}

function areBookmarkIdListsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

// ============================================================
// Interaction ID 관리
// ============================================================

export function sanitizeBookmarkInteractionId(bookmarkId, knownBookmarkIds) {
  if (!bookmarkId) {
    return "";
  }

  if (knownBookmarkIds && knownBookmarkIds[bookmarkId]) {
    return bookmarkId;
  }

  return "";
}

export function sanitizeBookmarkInteractionIds(bookmarkIds, knownBookmarkIds) {
  if (!Array.isArray(bookmarkIds) || !bookmarkIds.length) {
    return [];
  }

  const seen = {};
  return bookmarkIds.filter(function (bookmarkId) {
    if (!bookmarkId || seen[bookmarkId]) {
      return false;
    }
    if (knownBookmarkIds && !knownBookmarkIds[bookmarkId]) {
      return false;
    }
    seen[bookmarkId] = true;
    return true;
  });
}

export function removeBookmarkInteractionId(bookmarkIds, bookmarkId) {
  if (!Array.isArray(bookmarkIds) || !bookmarkIds.length) {
    return [];
  }

  return bookmarkIds.filter(function (id) {
    return id && id !== bookmarkId;
  });
}

// ============================================================
// 수동 정렬
// ============================================================

function getDisplayOrderedBookmarks(bookmarks, manualOrderBookmarkIds) {
  const source = Array.isArray(bookmarks) ? bookmarks.slice() : [];
  if (!source.length || !Array.isArray(manualOrderBookmarkIds) || !manualOrderBookmarkIds.length) {
    return source;
  }

  const bookmarkById = {};
  source.forEach(function (bookmark) {
    if (bookmark && bookmark.id) {
      bookmarkById[bookmark.id] = bookmark;
    }
  });

  const ordered = [];
  const usedBookmarkIds = {};
  manualOrderBookmarkIds.forEach(function (bookmarkId) {
    if (!bookmarkId || usedBookmarkIds[bookmarkId] || !bookmarkById[bookmarkId]) {
      return;
    }

    usedBookmarkIds[bookmarkId] = true;
    ordered.push(bookmarkById[bookmarkId]);
  });

  source.forEach(function (bookmark) {
    if (!bookmark || !bookmark.id || usedBookmarkIds[bookmark.id]) {
      return;
    }

    ordered.push(bookmark);
  });

  return ordered;
}

export function normalizeManualOrderBookmarkIds(bookmarks, manualOrderBookmarkIds) {
  const source = Array.isArray(bookmarks) ? bookmarks.slice() : [];
  if (!source.length) {
    return [];
  }

  const knownBookmarkIds = buildKnownBookmarkIdMap(source);
  const sanitizedManualOrder = sanitizeBookmarkInteractionIds(manualOrderBookmarkIds, knownBookmarkIds);
  if (!sanitizedManualOrder.length) {
    return [];
  }

  const defaultIds = getBookmarkIdList(source);
  const orderedIds = getBookmarkIdList(getDisplayOrderedBookmarks(source, sanitizedManualOrder));
  if (!orderedIds.length || areBookmarkIdListsEqual(defaultIds, orderedIds)) {
    return [];
  }

  return orderedIds;
}

// ============================================================
// UI State 정규화 + 영속화
// ============================================================

export function normalizeBookmarkUiStateMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  Object.keys(value).forEach(function (urlKey) {
    const normalizedUrlKey = normalizeUrlKey(urlKey);
    if (!normalizedUrlKey) {
      return;
    }

    const entry = normalizeBookmarkUiStateEntry(value[urlKey]);
    if (
      !entry.pinnedBookmarkIds.length &&
      !entry.expandedPinnedBookmarkIds.length &&
      !entry.expandedPopupContentBookmarkIds.length &&
      !entry.manualOrderBookmarkIds.length
    ) {
      return;
    }

    normalized[normalizedUrlKey] = entry;
  });

  return normalized;
}

export function normalizeBookmarkUiStateEntry(value) {
  const entry = value && typeof value === "object" ? value : {};
  return {
    pinnedBookmarkIds: sanitizeBookmarkInteractionIds(entry.pinnedBookmarkIds),
    expandedPinnedBookmarkIds: sanitizeBookmarkInteractionIds(entry.expandedPinnedBookmarkIds),
    expandedPopupContentBookmarkIds: sanitizeBookmarkInteractionIds(entry.expandedPopupContentBookmarkIds),
    manualOrderBookmarkIds: sanitizeBookmarkInteractionIds(entry.manualOrderBookmarkIds)
  };
}

export function hasMeaningfulBookmarkUiStateEntry(entry) {
  return Boolean(
    entry &&
    (
      (Array.isArray(entry.pinnedBookmarkIds) && entry.pinnedBookmarkIds.length) ||
      (Array.isArray(entry.expandedPinnedBookmarkIds) && entry.expandedPinnedBookmarkIds.length) ||
      (Array.isArray(entry.expandedPopupContentBookmarkIds) && entry.expandedPopupContentBookmarkIds.length) ||
      (Array.isArray(entry.manualOrderBookmarkIds) && entry.manualOrderBookmarkIds.length)
    )
  );
}

export function buildSingleBookmarkUiStateObject(urlKey, entry) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  const normalizedEntry = normalizeBookmarkUiStateEntry(entry);
  if (!normalizedUrlKey || !hasMeaningfulBookmarkUiStateEntry(normalizedEntry)) {
    return {};
  }

  const nextState = {};
  nextState[normalizedUrlKey] = normalizedEntry;
  return nextState;
}

function getCurrentBookmarkUiStateEntry() {
  return normalizeBookmarkUiStateEntry({
    pinnedBookmarkIds: state.pinnedBookmarkIds,
    expandedPinnedBookmarkIds: state.expandedPinnedBookmarkIds,
    expandedPopupContentBookmarkIds: state.expandedPopupContentBookmarkIds,
    manualOrderBookmarkIds: state.manualOrderBookmarkIds
  });
}

export function applyCurrentBookmarkUiState() {
  const entry = normalizeBookmarkUiStateEntry(state.bookmarkUiStateByUrl[state.currentUrlKey]);
  const knownBookmarkIds = buildKnownBookmarkIdMap(state.currentBookmarks);
  state.pinnedBookmarkIds = sanitizeBookmarkInteractionIds(entry.pinnedBookmarkIds, knownBookmarkIds);
  state.expandedPinnedBookmarkIds = sanitizeBookmarkInteractionIds(entry.expandedPinnedBookmarkIds, knownBookmarkIds);
  state.expandedPopupContentBookmarkIds = sanitizeBookmarkInteractionIds(entry.expandedPopupContentBookmarkIds, knownBookmarkIds);
  state.manualOrderBookmarkIds = normalizeManualOrderBookmarkIds(state.currentBookmarks, entry.manualOrderBookmarkIds);
}

export async function persistBookmarkUiState() {
  const entry = getCurrentBookmarkUiStateEntry();
  const normalizedUrlKey = normalizeUrlKey(state.currentUrlKey);
  const uiStateKey = getBookmarkUiStateShardStorageKey(normalizedUrlKey);

  if (!normalizedUrlKey || !uiStateKey) {
    return;
  }

  state.bookmarkUiStateByUrl = buildSingleBookmarkUiStateObject(normalizedUrlKey, entry);
  state.bookmarkUiStateReloadSuppressAt = Date.now();

  if (!hasMeaningfulBookmarkUiStateEntry(entry)) {
    await storageRemove(uiStateKey);
    return;
  }

  const payload = {};
  payload[uiStateKey] = normalizeBookmarkUiStateEntry(entry);
  await storageSet(payload);
}

// ============================================================
// 핀/확장 토글
// ============================================================

export async function togglePinnedBookmark(bookmarkId) {
  const nextBookmarkId = bookmarkId || "";
  if (!nextBookmarkId) {
    return;
  }

  if (_releaseResizeLockedExpandedBookmarkForInteraction) _releaseResizeLockedExpandedBookmarkForInteraction(nextBookmarkId);
  const pinnedBookmarkIds = Array.isArray(state.pinnedBookmarkIds) ? state.pinnedBookmarkIds.slice() : [];
  const pinnedIndex = pinnedBookmarkIds.indexOf(nextBookmarkId);
  if (pinnedIndex >= 0) {
    pinnedBookmarkIds.splice(pinnedIndex, 1);
  } else {
    pinnedBookmarkIds.push(nextBookmarkId);
  }

  state.pinnedBookmarkIds = pinnedBookmarkIds;
  if (_syncExpandedBookmarkState) _syncExpandedBookmarkState({ full: true });
  await persistBookmarkUiState();
}

export async function toggleExpandedPinnedBookmark(bookmarkId) {
  const nextBookmarkId = bookmarkId || "";
  if (!nextBookmarkId) {
    return;
  }

  if (_releaseResizeLockedExpandedBookmarkForInteraction) _releaseResizeLockedExpandedBookmarkForInteraction(nextBookmarkId);
  const expandedPinnedBookmarkIds = Array.isArray(state.expandedPinnedBookmarkIds)
    ? state.expandedPinnedBookmarkIds.slice()
    : [];
  const pinnedIndex = expandedPinnedBookmarkIds.indexOf(nextBookmarkId);
  if (pinnedIndex >= 0) {
    expandedPinnedBookmarkIds.splice(pinnedIndex, 1);
  } else {
    expandedPinnedBookmarkIds.push(nextBookmarkId);
  }

  state.expandedPinnedBookmarkIds = expandedPinnedBookmarkIds;
  if (_syncExpandedBookmarkState) _syncExpandedBookmarkState({ full: true });
  await persistBookmarkUiState();
}

export function isBookmarkPopupPinned(bookmarkId) {
  return Boolean(bookmarkId && Array.isArray(state.pinnedBookmarkIds) && state.pinnedBookmarkIds.indexOf(bookmarkId) >= 0);
}

export function isBookmarkExpansionPinned(bookmarkId) {
  return Boolean(bookmarkId && Array.isArray(state.expandedPinnedBookmarkIds) && state.expandedPinnedBookmarkIds.indexOf(bookmarkId) >= 0);
}

// ============================================================
// 팝업 레이아웃 영속화
// ============================================================

export function deletePopupLayout(bookmarkId) {
  if (!bookmarkId || !state.popupLayoutByBookmarkId || !Object.prototype.hasOwnProperty.call(state.popupLayoutByBookmarkId, bookmarkId)) {
    return false;
  }

  const nextLayouts = Object.assign({}, state.popupLayoutByBookmarkId);
  delete nextLayouts[bookmarkId];
  state.popupLayoutByBookmarkId = nextLayouts;
  return true;
}

export function normalizePopupLayoutMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  Object.keys(value).forEach(function (bookmarkId) {
    const layout = _normalizePopupLayout ? _normalizePopupLayout(value[bookmarkId]) : null;
    if (!layout) {
      return;
    }
    normalized[bookmarkId] = layout;
  });
  return normalized;
}

export async function persistPopupLayouts() {
  const normalizedUrlKey = normalizeUrlKey(state.currentUrlKey);
  const popupLayoutKey = getPopupLayoutShardStorageKey(normalizedUrlKey);
  if (!normalizedUrlKey || !popupLayoutKey) {
    return;
  }

  state.popupLayoutReloadSuppressAt = Date.now();

  const knownBookmarkIds = new Set(
    state.currentBookmarks.map(function (bookmark) {
      return bookmark && bookmark.id ? bookmark.id : "";
    }).filter(Boolean)
  );
  const nextLayouts = {};
  Object.keys(normalizePopupLayoutMap(state.popupLayoutByBookmarkId)).forEach(function (bookmarkId) {
    if (!knownBookmarkIds.has(bookmarkId)) {
      return;
    }
    nextLayouts[bookmarkId] = state.popupLayoutByBookmarkId[bookmarkId];
  });
  state.popupLayoutByBookmarkId = normalizePopupLayoutMap(nextLayouts);

  if (!Object.keys(state.popupLayoutByBookmarkId).length) {
    await storageRemove(popupLayoutKey);
    return;
  }

  const payload = {};
  payload[popupLayoutKey] = normalizePopupLayoutMap(state.popupLayoutByBookmarkId);
  await storageSet(payload);
}
