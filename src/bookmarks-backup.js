// ============================================================
// bookmarks-backup.js — Bookmark export/import
// ============================================================

import state from './state.js';
import { storageGet, storageSet } from './storage.js';
import {
  BOOKMARK_SHARD_INDEX_STORAGE_KEY,
  BOOKMARK_SHARD_BUCKET_PREFIX,
  APP_VERSION
} from './constants.js';
import {
  normalizeBookmarkShardIndexMap,
  normalizeBookmarkList,
  loadBookmarks,
  refreshCurrentBookmarksView
} from './bookmarks.js';
import { normalizeUrlKey } from './bookmarks-conversation.js';
import { logWarn } from './log.js';

// ============================================================
// Constants
// ============================================================

var MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5MB
var MAX_IMPORT_BOOKMARK_COUNT = 10000;
var DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];

// ============================================================
// Export
// ============================================================

export async function exportBookmarks() {
  try {
    var raw = await storageGet([BOOKMARK_SHARD_INDEX_STORAGE_KEY]);
    var index = normalizeBookmarkShardIndexMap(raw[BOOKMARK_SHARD_INDEX_STORAGE_KEY]);
    var urlHashes = Object.keys(index);

    if (!urlHashes.length) {
      logWarn("exportBookmarks: no bookmarks to export");
      return;
    }

    var bucketKeys = urlHashes.map(function (hash) {
      return BOOKMARK_SHARD_BUCKET_PREFIX + hash;
    });

    var buckets = await storageGet(bucketKeys);

    var exportData = {};
    exportData[BOOKMARK_SHARD_INDEX_STORAGE_KEY] = index;
    Object.keys(buckets).forEach(function (key) {
      if (buckets[key] && Array.isArray(buckets[key]) && buckets[key].length) {
        exportData[key] = buckets[key];
      }
    });

    var json = JSON.stringify(exportData, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);

    var now = new Date();
    var dateStr = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0") + "-" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    var filename = "chatmark-bookmarks-v" + APP_VERSION + "-" + dateStr + ".json";

    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    logWarn("exportBookmarks failed", error);
  }
}

// ============================================================
// Import
// ============================================================

export function importBookmarks() {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.style.display = "none";
  input.onchange = function () {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];

    if (file.size > MAX_IMPORT_FILE_SIZE) {
      logWarn("importBookmarks: file too large", file.size);
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      processImportedJson(reader.result);
    };
    reader.readAsText(file);
  };
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

async function processImportedJson(text) {
  try {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      logWarn("importBookmarks: invalid JSON structure");
      return;
    }

    // Key filtering: bookmark data only
    var safeData = {};
    var totalCount = 0;

    Object.keys(parsed).forEach(function (key) {
      if (DANGEROUS_KEYS.indexOf(key) >= 0) return;

      if (key === BOOKMARK_SHARD_INDEX_STORAGE_KEY) {
        safeData[key] = parsed[key];
      } else if (key.indexOf(BOOKMARK_SHARD_BUCKET_PREFIX) === 0) {
        var bucket = parsed[key];
        if (Array.isArray(bucket)) {
          totalCount += bucket.length;
          safeData[key] = bucket;
        }
      }
    });

    if (totalCount > MAX_IMPORT_BOOKMARK_COUNT) {
      logWarn("importBookmarks: too many bookmarks", totalCount);
      return;
    }

    if (!safeData[BOOKMARK_SHARD_INDEX_STORAGE_KEY]) {
      logWarn("importBookmarks: missing index");
      return;
    }

    // Normalize index
    safeData[BOOKMARK_SHARD_INDEX_STORAGE_KEY] =
      normalizeBookmarkShardIndexMap(safeData[BOOKMARK_SHARD_INDEX_STORAGE_KEY]);

    // Normalize each bucket, discard invalid ones
    Object.keys(safeData).forEach(function (key) {
      if (key.indexOf(BOOKMARK_SHARD_BUCKET_PREFIX) !== 0) return;

      var urlHash = key.slice(BOOKMARK_SHARD_BUCKET_PREFIX.length);
      var indexEntry = safeData[BOOKMARK_SHARD_INDEX_STORAGE_KEY][urlHash];
      var urlKey = indexEntry ? normalizeUrlKey(indexEntry.urlKey) : "";

      if (!urlKey) {
        delete safeData[key];
        delete safeData[BOOKMARK_SHARD_INDEX_STORAGE_KEY][urlHash];
        return;
      }

      safeData[key] = normalizeBookmarkList(safeData[key], urlKey);
    });

    // Suppress handleStorageChanged race
    state.bookmarkBucketReloadSuppressAt = Date.now();

    await storageSet(safeData);
    await loadBookmarks();
    refreshCurrentBookmarksView();
  } catch (error) {
    logWarn("importBookmarks: failed", error);
  }
}
