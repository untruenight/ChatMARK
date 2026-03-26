// ============================================================
// store/migration.js — 레거시 데이터 마이그레이션 (분리하여 추후 삭제 용이)
// ============================================================
// 비유: "이사 도우미". 오래된 형식의 데이터를 새 형식으로 옮깁니다.
// 모든 사용자가 v2 샤딩으로 전환되면 이 파일 전체를 삭제할 수 있습니다.

import state from './state.js';
import { storageGet, storageSet } from './storage.js';
import {
  PRIMARY_STORAGE_KEY,
  BOOKMARK_SHARD_INDEX_STORAGE_KEY,
  BOOKMARK_UI_STATE_STORAGE_KEY,
  POPUP_LAYOUT_STORAGE_KEY
} from './constants.js';
import {
  normalizeUrlKey,
  extractBookmarkBuckets,
  normalizeBookmarkList,
  getBookmarkShardBucketStorageKey,
  getBookmarkShardUrlHash,
  normalizeBookmarkShardIndexMap,
  buildBookmarkShardIndexEntry,
  getBookmarkUiStateShardStorageKey,
  getPopupLayoutShardStorageKey
} from './bookmarks.js';

// ---- 콜백 주입 (store/ui-state.js 순환 방지) ----
let _normalizeBookmarkUiStateMap = null;
let _normalizeBookmarkUiStateEntry = null;
let _hasMeaningfulBookmarkUiStateEntry = null;
let _normalizePopupLayoutMap = null;

export function setMigrationCallbacks(callbacks) {
  _normalizeBookmarkUiStateMap = callbacks.normalizeBookmarkUiStateMap || null;
  _normalizeBookmarkUiStateEntry = callbacks.normalizeBookmarkUiStateEntry || null;
  _hasMeaningfulBookmarkUiStateEntry = callbacks.hasMeaningfulBookmarkUiStateEntry || null;
  _normalizePopupLayoutMap = callbacks.normalizePopupLayoutMap || null;
}

export async function loadLegacyBookmarksForCurrentUrl(urlKey) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  if (!normalizedUrlKey) {
    return [];
  }

  const rawStorage = await storageGet([PRIMARY_STORAGE_KEY, "chatgptBookmarksByUrl", "bookmarks", normalizedUrlKey]);
  const buckets = extractBookmarkBuckets(rawStorage);
  return normalizeBookmarkList(buckets[normalizedUrlKey] || [], normalizedUrlKey);
}

export async function migrateLegacyBookmarksToBookmarkShard(urlKey, bookmarks) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  const bucketKey = getBookmarkShardBucketStorageKey(normalizedUrlKey);
  const urlHash = getBookmarkShardUrlHash(normalizedUrlKey);
  if (!normalizedUrlKey || !bucketKey || !urlHash) {
    return;
  }

  const nextIndex = Object.assign({}, normalizeBookmarkShardIndexMap(state.bookmarkShardIndexByUrlHash));
  const normalizedBookmarks = normalizeBookmarkList(bookmarks || [], normalizedUrlKey);
  const payload = {};
  payload[bucketKey] = normalizedBookmarks;
  payload[BOOKMARK_SHARD_INDEX_STORAGE_KEY] = Object.assign({}, nextIndex, {
    [urlHash]: buildBookmarkShardIndexEntry(normalizedUrlKey, normalizedBookmarks)
  });
  state.bookmarkShardIndexByUrlHash = payload[BOOKMARK_SHARD_INDEX_STORAGE_KEY];
  await storageSet(payload);
}

export async function loadLegacyBookmarkUiStateForCurrentUrl(urlKey) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  if (!normalizedUrlKey) {
    return null;
  }

  const rawStorage = await storageGet([BOOKMARK_UI_STATE_STORAGE_KEY]);
  const normalizedMap = _normalizeBookmarkUiStateMap ? _normalizeBookmarkUiStateMap(rawStorage[BOOKMARK_UI_STATE_STORAGE_KEY]) : {};
  const entry = _normalizeBookmarkUiStateEntry ? _normalizeBookmarkUiStateEntry(normalizedMap[normalizedUrlKey]) : normalizedMap[normalizedUrlKey] || {};
  return (_hasMeaningfulBookmarkUiStateEntry ? _hasMeaningfulBookmarkUiStateEntry(entry) : false) ? entry : null;
}

export async function migrateLegacyBookmarkUiStateToShard(urlKey, entry) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  const uiStateKey = getBookmarkUiStateShardStorageKey(normalizedUrlKey);
  const normalizedEntry = _normalizeBookmarkUiStateEntry ? _normalizeBookmarkUiStateEntry(entry) : entry;
  if (!normalizedUrlKey || !uiStateKey || !(_hasMeaningfulBookmarkUiStateEntry ? _hasMeaningfulBookmarkUiStateEntry(normalizedEntry) : false)) {
    return;
  }

  const payload = {};
  payload[uiStateKey] = normalizedEntry;
  await storageSet(payload);
}

export async function loadLegacyPopupLayoutsForCurrentUrl(urlKey, bookmarks) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  if (!normalizedUrlKey) {
    return {};
  }

  const knownBookmarkIds = new Set(
    (Array.isArray(bookmarks) ? bookmarks : []).map(function (bookmark) {
      return bookmark && bookmark.id ? bookmark.id : "";
    }).filter(Boolean)
  );
  if (!knownBookmarkIds.size) {
    return {};
  }

  const rawStorage = await storageGet([POPUP_LAYOUT_STORAGE_KEY]);
  const normalizedLayouts = _normalizePopupLayoutMap ? _normalizePopupLayoutMap(rawStorage[POPUP_LAYOUT_STORAGE_KEY]) : {};
  const nextLayouts = {};
  Object.keys(normalizedLayouts).forEach(function (bookmarkId) {
    if (!knownBookmarkIds.has(bookmarkId)) {
      return;
    }
    nextLayouts[bookmarkId] = normalizedLayouts[bookmarkId];
  });
  return nextLayouts;
}

export async function migrateLegacyPopupLayoutsToShard(urlKey, layouts) {
  const normalizedUrlKey = normalizeUrlKey(urlKey);
  const popupLayoutKey = getPopupLayoutShardStorageKey(normalizedUrlKey);
  const normalizedLayouts = _normalizePopupLayoutMap ? _normalizePopupLayoutMap(layouts) : layouts || {};
  if (!normalizedUrlKey || !popupLayoutKey || !Object.keys(normalizedLayouts).length) {
    return;
  }

  const payload = {};
  payload[popupLayoutKey] = normalizedLayouts;
  await storageSet(payload);
}
