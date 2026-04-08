// ============================================================
// rail-search.js — Bookmark search/filter and display ordering
// ============================================================
// Extracted from rail.js during Phase C modularization.
// Contains GROUP 6 (Search/filter) and GROUP 7 (Search UI).

import state from './state.js';
import { normalizeText } from './text.js';
import { MAX_BOOKMARKS_PER_PAGE, msg } from './constants.js';
import { closeBookmarkColorPicker, closeSavePopup } from './popup.js';

// ============================================================
// Local constants
// ============================================================

const BOOKMARK_SEARCH_PLACEHOLDER = "Search in bookmark";

// ============================================================
// Local state
// ============================================================

let _searchMatchedIds = new Set();
let _searchDebounceTimer = 0;

// ============================================================
// Callback registry (injected via initSearch)
// ============================================================

var _callbacks = {
  onRender: null,
  getExpandedBookmarkId: null
};

export function initSearch(callbacks) {
  if (!callbacks || typeof callbacks !== "object") {
    return;
  }

  Object.keys(_callbacks).forEach(function (key) {
    if (typeof callbacks[key] === "function") {
      _callbacks[key] = callbacks[key];
    }
  });
}

// ============================================================
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

export function getDisplayOrderedBookmarks(bookmarks, manualOrderBookmarkIds) {
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

// ============================================================
// GROUP 6 — Search/filter
// ============================================================

export function getFilteredCurrentBookmarks() {
  const normalizedQuery = getNormalizedBookmarkSearchQuery(state.bookmarkSearchQuery);
  const displayOrderedBookmarks = getDisplayOrderedBookmarks(state.currentBookmarks, state.manualOrderBookmarkIds);
  if (!normalizedQuery) {
    return displayOrderedBookmarks;
  }

  return displayOrderedBookmarks.filter(function (bookmark) {
    return bookmarkMatchesSearchQuery(bookmark, normalizedQuery);
  });
}

function bookmarkMatchesSearchQuery(bookmark, normalizedQuery) {
  if (!bookmark || !normalizedQuery) {
    return !normalizedQuery;
  }

  return getBookmarkSearchText(bookmark).indexOf(normalizedQuery) >= 0;
}

function getBookmarkSearchText(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  return [
    bookmark && bookmark.label,
    bookmark && bookmark.snippet,
    anchor && anchor.selectionDisplayText,
    anchor && anchor.selectionTextRaw,
    anchor && anchor.selectionText,
    anchor && anchor.blockTextSnippet
  ]
    .map(function (value) {
      return getNormalizedBookmarkSearchQuery(value);
    })
    .filter(Boolean)
    .join(" ");
}

export function getNormalizedBookmarkSearchQuery(value) {
  return normalizeText(value).toLowerCase();
}

export function highlightMatchInElement(el, query) {
  var text = el.textContent;
  var lower = text.toLowerCase();
  var idx = lower.indexOf(query);
  if (idx < 0) return;
  var before = document.createTextNode(text.slice(0, idx));
  var mark = document.createElement("mark");
  mark.className = "cgptbm-search-match";
  mark.textContent = text.slice(idx, idx + query.length);
  var after = document.createTextNode(text.slice(idx + query.length));
  el.textContent = "";
  el.appendChild(before);
  el.appendChild(mark);
  el.appendChild(after);
}

export function isBookmarkSearchMatched(bookmarkId) {
  return _searchMatchedIds.has(bookmarkId);
}

// ============================================================
// GROUP 7 — Search UI
// ============================================================

export function setBookmarkSearchQuery(value) {
  const nextQuery = normalizeText(value);
  if (state.bookmarkSearchQuery === nextQuery) {
    syncBookmarkSearchControls();
    return;
  }

  state.bookmarkSearchQuery = nextQuery;
  var normalizedQuery = getNormalizedBookmarkSearchQuery(nextQuery);
  _searchMatchedIds = new Set();
  if (normalizedQuery) {
    state.currentBookmarks.forEach(function (bm) {
      if (bookmarkMatchesSearchQuery(bm, normalizedQuery)) {
        _searchMatchedIds.add(bm.id);
      }
    });
  }
  closeBookmarkColorPicker();
  closeSavePopup();
  state.hoveredBookmarkId = "";
  state.focusedBookmarkId = "";
  state.expandedBookmarkId = _callbacks.getExpandedBookmarkId ? _callbacks.getExpandedBookmarkId() : "";
  if (_callbacks.onRender) {
    _callbacks.onRender();
  }
}

function handleBookmarkSearchInput(event) {
  var target = event && event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(function () {
    setBookmarkSearchQuery(target.value);
  }, 120);
}

function handleBookmarkSearchClear(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  clearTimeout(_searchDebounceTimer);

  setBookmarkSearchQuery("");
  if (state.searchInput) {
    state.searchInput.focus();
  }
}

export function createBookmarkSearchRow() {
  const searchRow = document.createElement("div");
  searchRow.className = "cgptbm-history-controls__search-row";

  const searchWrap = document.createElement("div");
  searchWrap.className = "cgptbm-history-controls__search-wrap";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cgptbm-history-controls__search-input";
  input.placeholder = BOOKMARK_SEARCH_PLACEHOLDER;
  input.value = state.bookmarkSearchQuery;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", msg("searchPlaceholder"));
  input.addEventListener("input", handleBookmarkSearchInput);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "cgptbm-history-controls__search-clear";
  clearButton.textContent = "x";
  clearButton.title = msg("clearSearch");
  clearButton.setAttribute("aria-label", msg("clearSearch"));
  clearButton.onmousedown = preventFocusSteal;
  clearButton.onclick = handleBookmarkSearchClear;

  const status = document.createElement("span");
  status.className = "cgptbm-history-controls__search-status";
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.hidden = true;

  searchWrap.appendChild(input);
  searchWrap.appendChild(clearButton);
  searchRow.appendChild(searchWrap);

  state.searchInput = input;
  state.searchClearButton = clearButton;
  state.searchStatus = status;

  return searchRow;
}

export function ensureBookmarkSearchControls(controls) {
  if (!(controls instanceof HTMLElement)) {
    return;
  }

  let searchRow = controls.querySelector(".cgptbm-history-controls__search-row");
  if (!searchRow) {
    searchRow = createBookmarkSearchRow();
    controls.appendChild(searchRow);
  }

  state.searchInput = controls.querySelector(".cgptbm-history-controls__search-input");
  state.searchClearButton = controls.querySelector(".cgptbm-history-controls__search-clear");
  state.searchStatus = controls.querySelector(".cgptbm-history-controls__search-status");
  syncBookmarkSearchControls();
}

export function syncBookmarkSearchControls() {
  const searchInput = state.searchInput;
  const clearButton = state.searchClearButton;
  const searchStatus = state.searchStatus;
  const hasBookmarks = state.currentBookmarks.length > 0;
  const hasQuery = Boolean(state.bookmarkSearchQuery);
  const filteredCount = hasBookmarks || hasQuery
    ? getFilteredCurrentBookmarks().length
    : 0;

  if (searchInput) {
    if (searchInput.value !== state.bookmarkSearchQuery) {
      searchInput.value = state.bookmarkSearchQuery;
    }
    searchInput.disabled = !state.railEnabled || (!hasBookmarks && !hasQuery);
    searchInput.placeholder = hasBookmarks || hasQuery
      ? (state.currentBookmarks.length === 1 ? msg("searchTab") : msg("searchTabs"))
      : msg("dragToSelect");
  }

  if (clearButton) {
    clearButton.hidden = !hasQuery;
    clearButton.disabled = !hasQuery;
  }

}

function getBookmarkSearchStatusText(options) {
  const totalCount = Number(options && options.totalCount) || 0;
  const filteredCount = Number(options && options.filteredCount) || 0;
  const hasQuery = Boolean(options && options.hasQuery);

  if (!totalCount) {
    return "";
  }

  if (!hasQuery) {
    if (totalCount >= MAX_BOOKMARKS_PER_PAGE) {
      return "All used";
    }
    return totalCount + "/" + MAX_BOOKMARKS_PER_PAGE + " bookmarks";
  }

  return filteredCount + "/" + totalCount + " shown";
}

function getBookmarkSearchStatusTitle(options) {
  const totalCount = Number(options && options.totalCount) || 0;
  const filteredCount = Number(options && options.filteredCount) || 0;
  const hasQuery = Boolean(options && options.hasQuery);

  if (!totalCount) {
    return "";
  }

  if (!hasQuery) {
    return totalCount === 1
      ? "1 bookmark is saved on this page. (1 of " + MAX_BOOKMARKS_PER_PAGE + ")"
      : totalCount + " bookmarks are saved on this page. (" + totalCount + " of " + MAX_BOOKMARKS_PER_PAGE + ")";
  }

  return filteredCount === 1
    ? "1 of " + totalCount + " saved bookmarks matches this search."
    : filteredCount + " of " + totalCount + " saved bookmarks match this search.";
}
