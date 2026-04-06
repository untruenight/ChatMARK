// ============================================================
// store/bookmarks.js — 북마크 CRUD + Storage I/O
// ============================================================
// 비유: "도서관 사서". 북마크를 저장하고, 불러오고, 정리하는 역할입니다.

import state from './state.js';
import { storageGet, storageSet, storageRemove } from './storage.js';
import { logWarn } from './log.js';
import { normalizeText, createLabel, truncateText, truncateRawText, fingerprintText, fingerprintRawText, uniqueStrings, normalizeInteger, clamp } from './text.js';
import {
  BOOKMARK_SHARD_INDEX_STORAGE_KEY,
  BOOKMARK_SHARD_BUCKET_PREFIX,
  BOOKMARK_UI_STATE_SHARD_PREFIX,
  POPUP_LAYOUT_SHARD_PREFIX,
  RAIL_OPACITY_STORAGE_KEY,
  RAIL_ENABLED_STORAGE_KEY,
  DEFAULT_BOOKMARK_LABEL,
  TAB_COLORS,
  MAX_CAPTURED_SELECTION_LENGTH,
  MAX_CAPTURED_SELECTION_RAW_LENGTH,
  DEFAULT_RAIL_OPACITY,
  MIN_RAIL_OPACITY,
  MAX_RAIL_OPACITY,
  PRIMARY_STORAGE_KEY
} from './constants.js';

// ---- Conversation-key seam (Phase 4) ----
import {
  getCurrentUrlKey,
  normalizeUrlKey,
  extractConversationIdFromUrl,
  looksLikeUrl
} from './bookmarks-conversation.js';

export { getCurrentUrlKey, normalizeUrlKey, extractConversationIdFromUrl, looksLikeUrl };

// ---- 콜백 주입 (순환 의존 방지) ----
// UI layer (store → ui 방향 금지)
let _renderBookmarks = null;
let _applyRailOpacity = null;
let _releaseResizeLockedExpandedBookmarkForInteraction = null;
let _refreshCurrentBookmarksViewAfterIncrementalRemove = null;
let _pushUndoBookmarkHistory = null;
let _buildBookmarkHistoryEntry = null;
let _buildStateChangeEntry = null;

// store/ui-state layer (아직 미완성 모듈)
let _applyCurrentBookmarkUiState = null;
let _deletePopupLayout = null;
let _sanitizeBookmarkInteractionIds = null;
let _normalizeManualOrderBookmarkIds = null;
let _removeBookmarkInteractionId = null;
let _persistBookmarkUiState = null;
let _persistPopupLayouts = null;
let _normalizeBookmarkUiStateEntry = null;
let _normalizePopupLayoutMap = null;
let _buildSingleBookmarkUiStateObject = null;

// store/migration layer (순환 의존 방지: migration → bookmarks)
let _loadLegacyBookmarksForCurrentUrl = null;
let _migrateLegacyBookmarksToBookmarkShard = null;
let _loadLegacyBookmarkUiStateForCurrentUrl = null;
let _migrateLegacyBookmarkUiStateToShard = null;
let _loadLegacyPopupLayoutsForCurrentUrl = null;
let _migrateLegacyPopupLayoutsToShard = null;

export function setBookmarkCallbacks(callbacks) {
  _renderBookmarks = callbacks.renderBookmarks || null;
  _applyRailOpacity = callbacks.applyRailOpacity || null;
  _releaseResizeLockedExpandedBookmarkForInteraction = callbacks.releaseResizeLockedExpandedBookmarkForInteraction || null;
  _refreshCurrentBookmarksViewAfterIncrementalRemove = callbacks.refreshCurrentBookmarksViewAfterIncrementalRemove || null;
  _pushUndoBookmarkHistory = callbacks.pushUndoBookmarkHistory || null;
  _buildBookmarkHistoryEntry = callbacks.buildBookmarkHistoryEntry || null;
  _buildStateChangeEntry = callbacks.buildStateChangeEntry || null;
  _applyCurrentBookmarkUiState = callbacks.applyCurrentBookmarkUiState || null;
  _deletePopupLayout = callbacks.deletePopupLayout || null;
  _sanitizeBookmarkInteractionIds = callbacks.sanitizeBookmarkInteractionIds || null;
  _normalizeManualOrderBookmarkIds = callbacks.normalizeManualOrderBookmarkIds || null;
  _removeBookmarkInteractionId = callbacks.removeBookmarkInteractionId || null;
  _persistBookmarkUiState = callbacks.persistBookmarkUiState || null;
  _persistPopupLayouts = callbacks.persistPopupLayouts || null;
  _normalizeBookmarkUiStateEntry = callbacks.normalizeBookmarkUiStateEntry || null;
  _normalizePopupLayoutMap = callbacks.normalizePopupLayoutMap || null;
  _buildSingleBookmarkUiStateObject = callbacks.buildSingleBookmarkUiStateObject || null;
  _loadLegacyBookmarksForCurrentUrl = callbacks.loadLegacyBookmarksForCurrentUrl || null;
  _migrateLegacyBookmarksToBookmarkShard = callbacks.migrateLegacyBookmarksToBookmarkShard || null;
  _loadLegacyBookmarkUiStateForCurrentUrl = callbacks.loadLegacyBookmarkUiStateForCurrentUrl || null;
  _migrateLegacyBookmarkUiStateToShard = callbacks.migrateLegacyBookmarkUiStateToShard || null;
  _loadLegacyPopupLayoutsForCurrentUrl = callbacks.loadLegacyPopupLayoutsForCurrentUrl || null;
  _migrateLegacyPopupLayoutsToShard = callbacks.migrateLegacyPopupLayoutsToShard || null;
}

// ============================================================
// 샤드 스토리지 헬퍼
// ============================================================

export function getBookmarkShardUrlHash(urlKey) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  if (!normalizedUrlKey) {
    return "";
  }

  return fingerprintRawText(normalizedUrlKey);
}

export function getBookmarkShardBucketStorageKey(urlKey) {
  const urlHash = getBookmarkShardUrlHash(urlKey);
  return urlHash ? BOOKMARK_SHARD_BUCKET_PREFIX + urlHash : "";
}

export function getBookmarkUiStateShardStorageKey(urlKey) {
  const urlHash = getBookmarkShardUrlHash(urlKey);
  return urlHash ? BOOKMARK_UI_STATE_SHARD_PREFIX + urlHash : "";
}

export function getPopupLayoutShardStorageKey(urlKey) {
  const urlHash = getBookmarkShardUrlHash(urlKey);
  return urlHash ? POPUP_LAYOUT_SHARD_PREFIX + urlHash : "";
}

export function normalizeBookmarkShardIndexMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized = {};
  Object.keys(value).forEach(function (urlHash) {
    const entry = value[urlHash];
    const normalizedUrlKey = normalizeUrlKey(entry && entry.urlKey);
    if (!normalizedUrlKey) {
      return;
    }

    normalized[urlHash] = {
      urlKey: normalizedUrlKey,
      count: Math.max(0, normalizeInteger(entry && entry.count)),
      updatedAt: Number.isFinite(entry && entry.updatedAt) ? entry.updatedAt : 0
    };
  });

  return normalized;
}

function getBookmarkShardIndexEntry(indexMap, urlKey) {
  const urlHash = getBookmarkShardUrlHash(urlKey);
  if (!urlHash || !indexMap || !indexMap[urlHash]) {
    return null;
  }

  return indexMap[urlHash];
}

function hasStoredBookmarkShardBucket(rawStorage, bucketKey) {
  return Boolean(
    bucketKey &&
    rawStorage &&
    Object.prototype.hasOwnProperty.call(rawStorage, bucketKey)
  );
}

export function buildBookmarkShardIndexEntry(urlKey, bookmarks) {
  return {
    urlKey: normalizeUrlKey(urlKey),
    count: Array.isArray(bookmarks) ? bookmarks.length : 0,
    updatedAt: Date.now()
  };
}

// ============================================================
// 북마크 정규화
// ============================================================

export function normalizeBookmarkList(value, urlKey) {
  if (!Array.isArray(value)) {
    return [];
  }

  const merged = new Map();
  value.forEach(function (bookmark) {
    const normalized = normalizeBookmark(bookmark, urlKey);
    if (!normalized) {
      return;
    }
    merged.set(normalized.id, normalized);
  });
  return Array.from(merged.values()).sort(sortBookmarks);
}

export function normalizeBookmark(bookmark, urlKey) {
  if (!bookmark || typeof bookmark !== "object") {
    return null;
  }

  const normalizedUrl = normalizeUrlKey(bookmark.url || urlKey);
  if (!normalizedUrl) {
    return null;
  }

  const anchor = normalizeAnchor(bookmark.anchor || bookmark.target || bookmark);
  if (!anchor) {
    return null;
  }

  return {
    id: bookmark.id || buildLegacyBookmarkId(normalizedUrl, anchor, bookmark.label || bookmark.snippet || ""),
    url: normalizedUrl,
    label: createLabel(bookmark.label || bookmark.snippet || anchor.selectionText || anchor.blockTextSnippet || "Bookmark"),
    snippet: truncateText(bookmark.snippet || anchor.selectionText || anchor.blockTextSnippet || "", 180),
    colorIndex: normalizeColorIndex(bookmark.colorIndex),
    createdAt: Number.isFinite(bookmark.createdAt) ? bookmark.createdAt : 0,
    anchor: anchor
  };
}

export function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") {
    return null;
  }

  const blockTextSnippet = truncateText(anchor.blockTextSnippet || anchor.snippet || anchor.text || "", 220);
  const selectionText = truncateText(anchor.selectionText || anchor.selectedText || "", MAX_CAPTURED_SELECTION_LENGTH);
  const selectionDisplayText = truncateRawText(anchor.selectionDisplayText || "", MAX_CAPTURED_SELECTION_RAW_LENGTH);
  const scrollRatio = normalizeRatio(anchor.scrollRatio);
  const sandboxCard = Boolean(
    anchor.sandboxCard ||
    anchor.sandboxCardKey ||
    anchor.sandboxCardFrameHref ||
    anchor.sandboxCardFrameFingerprint ||
    anchor.sandboxCardFramePathFingerprint ||
    anchor.sandboxCardContainerFingerprint ||
    anchor.sandboxCardContainerPathFingerprint ||
    anchor.sandboxCardPositionFingerprint ||
    anchor.sandboxCardFingerprint
  );

  if (
    !blockTextSnippet &&
    !selectionText &&
    !selectionDisplayText &&
    !anchor.anchorId &&
    !anchor.elementId &&
    !sandboxCard
  ) {
    return null;
  }

  return {
    anchorId: anchor.anchorId || anchor.elementId || "",
    blockTag: anchor.blockTag || anchor.tagName || "",
    blockFingerprint: anchor.blockFingerprint || fingerprintText(blockTextSnippet),
    messageFingerprint: anchor.messageFingerprint || "",
    messageRole: anchor.messageRole || "",
    blockIndex: normalizeInteger(anchor.blockIndex),
    blockIndexInMessage: normalizeInteger(anchor.blockIndexInMessage),
    messageIndex: normalizeInteger(anchor.messageIndex),
    scrollRatio: Number.isFinite(scrollRatio) ? scrollRatio : 0.5,
    selectionStart: normalizeInteger(anchor.selectionStart),
    selectionLength: normalizeInteger(anchor.selectionLength),
    selectionStartRatio: Number.isFinite(normalizeRatio(anchor.selectionStartRatio))
      ? normalizeRatio(anchor.selectionStartRatio)
      : -1,
    selectionPrefix: truncateText(anchor.selectionPrefix || "", 64),
    selectionSuffix: truncateText(anchor.selectionSuffix || "", 64),
    selectionContextFingerprint: anchor.selectionContextFingerprint || "",
    selectionExactStart: normalizeInteger(anchor.selectionExactStart),
    selectionExactEnd: normalizeInteger(anchor.selectionExactEnd),
    selectionRawPrefix: truncateRawText(anchor.selectionRawPrefix || "", 64),
    selectionRawSuffix: truncateRawText(anchor.selectionRawSuffix || "", 64),
    selectionDisplayText: selectionDisplayText,
    selectionTextRaw: truncateRawText(anchor.selectionTextRaw || "", MAX_CAPTURED_SELECTION_RAW_LENGTH),
    selectionCodeOffsetStart: normalizeInteger(anchor.selectionCodeOffsetStart),
    selectionCodeOffsetEnd: normalizeInteger(anchor.selectionCodeOffsetEnd),
    selectionCodeLine: normalizeInteger(anchor.selectionCodeLine),
    selectionCodeColumn: normalizeInteger(anchor.selectionCodeColumn),
    selectionCodeContextFingerprint: anchor.selectionCodeContextFingerprint || "",
    selectionSpanStartFingerprint: anchor.selectionSpanStartFingerprint || "",
    selectionSpanEndFingerprint: anchor.selectionSpanEndFingerprint || "",
    selectionSpanBlockCount: normalizeInteger(anchor.selectionSpanBlockCount),
    selectionSpanHead: truncateText(anchor.selectionSpanHead || "", 32),
    selectionSpanMiddle: truncateText(anchor.selectionSpanMiddle || "", 32),
    selectionSpanTail: truncateText(anchor.selectionSpanTail || "", 32),
    selectionSpanMarkerSignature: truncateRawText(anchor.selectionSpanMarkerSignature || "", 48),
    sandboxCard: sandboxCard,
    sandboxCardKey: truncateRawText(anchor.sandboxCardKey || "", 320),
    sandboxCardIndex: normalizeInteger(anchor.sandboxCardIndex),
    sandboxCardFrameHref: truncateRawText(anchor.sandboxCardFrameHref || "", 1200),
    sandboxCardFrameName: truncateRawText(anchor.sandboxCardFrameName || "", 160),
    sandboxCardFrameSandbox: truncateRawText(anchor.sandboxCardFrameSandbox || "", 320),
    sandboxCardFrameFingerprint: anchor.sandboxCardFrameFingerprint || "",
    sandboxCardFramePathFingerprint: anchor.sandboxCardFramePathFingerprint || "",
    sandboxCardContainerFingerprint: anchor.sandboxCardContainerFingerprint || "",
    sandboxCardContainerPathFingerprint: anchor.sandboxCardContainerPathFingerprint || "",
    sandboxCardPositionFingerprint: anchor.sandboxCardPositionFingerprint || "",
    sandboxCardDomIndex: normalizeInteger(anchor.sandboxCardDomIndex),
    sandboxCardFrameSiblingIndex: normalizeInteger(anchor.sandboxCardFrameSiblingIndex),
    sandboxCardFingerprint: anchor.sandboxCardFingerprint || "",
    frameRelay: Boolean(anchor.frameRelay || anchor.frameRelayKey || anchor.frameKey || anchor.frameRelayHref || anchor.frameHref),
    frameRelayKey: truncateRawText(anchor.frameRelayKey || anchor.frameKey || "", 640),
    frameRelayOrigin: truncateRawText(anchor.frameRelayOrigin || anchor.frameOrigin || "", 320),
    frameRelayHref: truncateRawText(anchor.frameRelayHref || anchor.frameHref || "", 1200),
    frameRelayName: truncateRawText(anchor.frameRelayName || anchor.frameName || "", 160),
    selectionText: selectionText,
    blockTextSnippet: blockTextSnippet,
    messageStableId: truncateRawText(anchor.messageStableId || "", 128)
  };
}

export function normalizeColorIndex(value) {
  if (!Number.isInteger(value)) {
    return 0;
  }
  return Math.abs(value) % TAB_COLORS.length;
}

function getStoredRatio(bookmark) {
  return bookmark && bookmark.anchor && Number.isFinite(bookmark.anchor.scrollRatio) ? bookmark.anchor.scrollRatio : 0.5;
}

export function sortBookmarks(left, right) {
  return getStoredRatio(left) - getStoredRatio(right) || left.createdAt - right.createdAt;
}

export function normalizeRailOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_RAIL_OPACITY;
  }

  return clamp(numeric, MIN_RAIL_OPACITY, MAX_RAIL_OPACITY);
}

export function normalizeRailEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return true;
}

function normalizeRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clamp(value, 0, 1);
}

export function buildBookmarkId() {
  return "bm_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function buildLegacyBookmarkId(urlKey, anchor, label) {
  const parts = [
    normalizeUrlKey(urlKey),
    anchor.anchorId || "",
    anchor.blockFingerprint || "",
    anchor.selectionText || "",
    anchor.blockTextSnippet || "",
    label || "",
    String(anchor.scrollRatio)
  ];
  return "legacy_" + fingerprintText(parts.join("|"));
}

// ============================================================
// 레거시 버킷 추출
// ============================================================

export function buildSingleBucketObject(urlKey, bookmarks) {
  const bucket = {};
  bucket[normalizeUrlKey(urlKey)] = bookmarks;
  return bucket;
}

function mergeBuckets(target, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return;
  }

  Object.keys(source).forEach(function (urlKey) {
    const normalizedUrl = normalizeUrlKey(urlKey);
    const nextList = normalizeBookmarkList(source[urlKey], normalizedUrl);
    if (!nextList.length) {
      return;
    }

    if (!target[normalizedUrl]) {
      target[normalizedUrl] = [];
    }

    const mergedById = new Map();
    target[normalizedUrl].concat(nextList).forEach(function (bookmark) {
      mergedById.set(bookmark.id, bookmark);
    });
    target[normalizedUrl] = Array.from(mergedById.values()).sort(sortBookmarks);
  });
}

function sortBookmarkBuckets(buckets) {
  const sorted = {};
  Object.keys(buckets).forEach(function (urlKey) {
    const normalizedUrl = normalizeUrlKey(urlKey);
    sorted[normalizedUrl] = normalizeBookmarkList(buckets[urlKey], normalizedUrl);
  });
  return sorted;
}

export function extractBookmarkBuckets(rawStorage) {
  const buckets = {};

  mergeBuckets(buckets, rawStorage[PRIMARY_STORAGE_KEY]);
  mergeBuckets(buckets, rawStorage.chatgptBookmarksByUrl);

  if (Array.isArray(rawStorage.bookmarks)) {
    rawStorage.bookmarks.forEach(function (bookmark) {
      const normalized = normalizeBookmark(bookmark, bookmark && bookmark.url ? normalizeUrlKey(bookmark.url) : "");
      if (!normalized || !normalized.url) {
        return;
      }
      if (!buckets[normalized.url]) {
        buckets[normalized.url] = [];
      }
      buckets[normalized.url].push(normalized);
    });
  } else {
    mergeBuckets(buckets, rawStorage.bookmarks);
  }

  Object.keys(rawStorage).forEach(function (key) {
    if (!looksLikeUrl(key) || !Array.isArray(rawStorage[key])) {
      return;
    }
    mergeBuckets(buckets, buildSingleBucketObject(key, rawStorage[key]));
  });

  return sortBookmarkBuckets(buckets);
}

// ============================================================
// 북마크 CRUD
// ============================================================

let _loadBookmarksGeneration = 0;

export async function loadBookmarks() {
  try {
  const generation = ++_loadBookmarksGeneration;
  const normalizedUrlKey = normalizeUrlKey(state.currentUrlKey);
  const bucketKey = getBookmarkShardBucketStorageKey(normalizedUrlKey);
  const uiStateKey = getBookmarkUiStateShardStorageKey(normalizedUrlKey);
  const popupLayoutKey = getPopupLayoutShardStorageKey(normalizedUrlKey);
  const rawStorage = await storageGet([
    bucketKey,
    uiStateKey,
    popupLayoutKey,
    BOOKMARK_SHARD_INDEX_STORAGE_KEY,
    RAIL_OPACITY_STORAGE_KEY,
    RAIL_ENABLED_STORAGE_KEY
  ].filter(Boolean));

  state.bookmarkShardIndexByUrlHash = normalizeBookmarkShardIndexMap(rawStorage[BOOKMARK_SHARD_INDEX_STORAGE_KEY]);

  let currentRoomBookmarks = normalizeBookmarkList(rawStorage[bucketKey] || [], normalizedUrlKey);
  let currentRoomUiStateEntry = _normalizeBookmarkUiStateEntry ? _normalizeBookmarkUiStateEntry(rawStorage[uiStateKey]) : rawStorage[uiStateKey] || {};
  let currentRoomPopupLayouts = _normalizePopupLayoutMap ? _normalizePopupLayoutMap(rawStorage[popupLayoutKey]) : rawStorage[popupLayoutKey] || {};
  const currentShardIndexEntry = getBookmarkShardIndexEntry(state.bookmarkShardIndexByUrlHash, normalizedUrlKey);
  const shouldRecoverMissingIndexedShardBucket = Boolean(
    normalizedUrlKey &&
    currentShardIndexEntry &&
    currentShardIndexEntry.count > 0 &&
    !currentRoomBookmarks.length &&
    !hasStoredBookmarkShardBucket(rawStorage, bucketKey)
  );

  if (normalizedUrlKey && (!currentShardIndexEntry || shouldRecoverMissingIndexedShardBucket)) {
    if (_loadLegacyBookmarksForCurrentUrl) {
      const legacyBookmarks = await _loadLegacyBookmarksForCurrentUrl(normalizedUrlKey);
      if (legacyBookmarks.length) {
        currentRoomBookmarks = legacyBookmarks;
        if (_migrateLegacyBookmarksToBookmarkShard) {
          await _migrateLegacyBookmarksToBookmarkShard(normalizedUrlKey, currentRoomBookmarks);
        }
      }
    }

    if (!currentShardIndexEntry) {
      if (_loadLegacyBookmarkUiStateForCurrentUrl) {
        currentRoomUiStateEntry = await _loadLegacyBookmarkUiStateForCurrentUrl(normalizedUrlKey);
        if (currentRoomUiStateEntry && _migrateLegacyBookmarkUiStateToShard) {
          await _migrateLegacyBookmarkUiStateToShard(normalizedUrlKey, currentRoomUiStateEntry);
        }
      }

      if (_loadLegacyPopupLayoutsForCurrentUrl) {
        currentRoomPopupLayouts = await _loadLegacyPopupLayoutsForCurrentUrl(normalizedUrlKey, currentRoomBookmarks);
        if (Object.keys(currentRoomPopupLayouts).length && _migrateLegacyPopupLayoutsToShard) {
          await _migrateLegacyPopupLayoutsToShard(normalizedUrlKey, currentRoomPopupLayouts);
        }
      }
    }
  }

  // Discard stale results if a newer loadBookmarks() was initiated during async gap
  if (generation !== _loadBookmarksGeneration) {
    return;
  }

  state.bookmarksByUrl = normalizedUrlKey
    ? buildSingleBucketObject(normalizedUrlKey, currentRoomBookmarks)
    : {};
  state.popupLayoutByBookmarkId = _normalizePopupLayoutMap ? _normalizePopupLayoutMap(currentRoomPopupLayouts) : currentRoomPopupLayouts || {};
  state.bookmarkUiStateByUrl = _buildSingleBookmarkUiStateObject ? _buildSingleBookmarkUiStateObject(normalizedUrlKey, currentRoomUiStateEntry) : {};
  state.railOpacity = normalizeRailOpacity(rawStorage[RAIL_OPACITY_STORAGE_KEY]);
  state.railEnabled = normalizeRailEnabled(rawStorage[RAIL_ENABLED_STORAGE_KEY]);
  if (_applyRailOpacity) _applyRailOpacity();
  refreshCurrentBookmarksView();
  } catch (error) {
    logWarn("loadBookmarks failed", error);
    refreshCurrentBookmarksView();
  }
}

export async function persistBookmarks() {
  const normalizedUrlKey = normalizeUrlKey(state.currentUrlKey);
  const bucketKey = getBookmarkShardBucketStorageKey(normalizedUrlKey);
  const urlHash = getBookmarkShardUrlHash(normalizedUrlKey);
  if (!normalizedUrlKey || !bucketKey || !urlHash) {
    return;
  }

  const currentRoomBookmarks = normalizeBookmarkList(state.bookmarksByUrl[normalizedUrlKey] || [], normalizedUrlKey);
  const nextIndex = Object.assign({}, normalizeBookmarkShardIndexMap(state.bookmarkShardIndexByUrlHash));
  const payload = {};

  state.bookmarkBucketReloadSuppressAt = Date.now();

  state.bookmarksByUrl = currentRoomBookmarks.length
    ? buildSingleBucketObject(normalizedUrlKey, currentRoomBookmarks)
    : {};

  if (currentRoomBookmarks.length) {
    payload[bucketKey] = currentRoomBookmarks;
    nextIndex[urlHash] = buildBookmarkShardIndexEntry(normalizedUrlKey, currentRoomBookmarks);
  } else {
    delete nextIndex[urlHash];
    await storageRemove(bucketKey);
  }

  state.bookmarkShardIndexByUrlHash = nextIndex;
  payload[BOOKMARK_SHARD_INDEX_STORAGE_KEY] = nextIndex;
  await storageSet(payload);
}

export async function saveBookmark(anchor, label, options) {
  const nextOptions = options || {};
  const displaySnippet = normalizeText(anchor && anchor.selectionDisplayText || "");
  const colorIndex = Number.isInteger(nextOptions.colorIndex)
    ? normalizeColorIndex(nextOptions.colorIndex)
    : state.currentBookmarks.length % TAB_COLORS.length;
  const bookmark = {
    id: buildBookmarkId(),
    url: state.currentUrlKey,
    label: createLabel(label || anchor.selectionText || anchor.blockTextSnippet || DEFAULT_BOOKMARK_LABEL),
    snippet: truncateText(displaySnippet || anchor.selectionText || anchor.blockTextSnippet || "", 180),
    colorIndex: colorIndex,
    createdAt: Date.now(),
    anchor: anchor
  };

  const nextBookmarks = state.currentBookmarks
    .filter(function (item) {
      return item && item.id !== bookmark.id;
    })
    .concat(bookmark);

  state.bookmarksByUrl[state.currentUrlKey] = normalizeBookmarkList(nextBookmarks, state.currentUrlKey);
  await persistBookmarks();
  if (!nextOptions.skipHistory && _pushUndoBookmarkHistory && _buildBookmarkHistoryEntry) {
    _pushUndoBookmarkHistory(_buildBookmarkHistoryEntry("create", bookmark));
  }
  return bookmark;
}

export async function updateBookmarkLabel(bookmarkId, label, colorIndex) {
  if (_pushUndoBookmarkHistory && _buildStateChangeEntry) {
    _pushUndoBookmarkHistory(_buildStateChangeEntry("edit-label"));
  }
  const nextBookmarks = state.currentBookmarks.map(function (bookmark) {
    if (bookmark.id !== bookmarkId) {
      return bookmark;
    }

    return Object.assign({}, bookmark, {
      label: createLabel(label || bookmark.label || bookmark.snippet || DEFAULT_BOOKMARK_LABEL),
      colorIndex: Number.isInteger(colorIndex) ? normalizeColorIndex(colorIndex) : bookmark.colorIndex
    });
  });

  state.bookmarksByUrl[state.currentUrlKey] = normalizeBookmarkList(nextBookmarks, state.currentUrlKey);
  await persistBookmarks();

  return state.bookmarksByUrl[state.currentUrlKey].find(function (bookmark) {
    return bookmark.id === bookmarkId;
  }) || null;
}

export async function handleBookmarkRemove(bookmarkId, options) {
  const nextOptions = options || {};
  if (_releaseResizeLockedExpandedBookmarkForInteraction) {
    _releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId);
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item && item.id === bookmarkId;
  });
  if (!bookmark) {
    return;
  }

  if (!nextOptions.skipHistory && _pushUndoBookmarkHistory && _buildBookmarkHistoryEntry) {
    _pushUndoBookmarkHistory(_buildBookmarkHistoryEntry("delete", bookmark));
  }

  const nextBookmarks = state.currentBookmarks.filter(function (item) {
    return item.id !== bookmarkId;
  });
  const normalizedNextBookmarks = normalizeBookmarkList(nextBookmarks, state.currentUrlKey);
  if (_deletePopupLayout) _deletePopupLayout(bookmarkId);
  state.pinnedBookmarkIds = _sanitizeBookmarkInteractionIds
    ? _sanitizeBookmarkInteractionIds(state.pinnedBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      }))
    : state.pinnedBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      });
  state.expandedPinnedBookmarkIds = _sanitizeBookmarkInteractionIds
    ? _sanitizeBookmarkInteractionIds(state.expandedPinnedBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      }))
    : state.expandedPinnedBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      });
  state.expandedPopupContentBookmarkIds = _sanitizeBookmarkInteractionIds
    ? _sanitizeBookmarkInteractionIds(state.expandedPopupContentBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      }))
    : state.expandedPopupContentBookmarkIds.filter(function (id) {
        return id !== bookmarkId;
      });
  if (state.activeBookmarkId === bookmarkId) {
    window.clearTimeout(state.activeTimer);
    state.activeTimer = 0;
    state.activeBookmarkId = "";
  }
  state.manualOrderBookmarkIds = _normalizeManualOrderBookmarkIds
    ? _normalizeManualOrderBookmarkIds(
        normalizedNextBookmarks,
        _removeBookmarkInteractionId ? _removeBookmarkInteractionId(state.manualOrderBookmarkIds, bookmarkId) : state.manualOrderBookmarkIds.filter(function (id) { return id !== bookmarkId; })
      )
    : state.manualOrderBookmarkIds.filter(function (id) { return id !== bookmarkId; });
  state.bookmarksByUrl[state.currentUrlKey] = normalizedNextBookmarks;
  try {
    await persistBookmarks();
  } catch (error) {
    logWarn("handleBookmarkRemove: persist failed", error);
  }
  if (_persistBookmarkUiState) await _persistBookmarkUiState();
  if (_persistPopupLayouts) await _persistPopupLayouts();
  const usedIncrementalRemoveRefresh = _refreshCurrentBookmarksViewAfterIncrementalRemove
    ? _refreshCurrentBookmarksViewAfterIncrementalRemove(bookmarkId)
    : false;
  if (!usedIncrementalRemoveRefresh) {
    refreshCurrentBookmarksView();
  }
}

// ============================================================
// 뷰 갱신
// ============================================================

export function applyCurrentBookmarks() {
  state.currentBookmarks = normalizeBookmarkList(state.bookmarksByUrl[state.currentUrlKey] || [], state.currentUrlKey);
  if (_applyCurrentBookmarkUiState) _applyCurrentBookmarkUiState();
}

export function refreshCurrentBookmarksView() {
  applyCurrentBookmarks();
  if (_renderBookmarks) _renderBookmarks();
}
