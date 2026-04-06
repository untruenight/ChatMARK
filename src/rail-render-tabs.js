// ============================================================
// rail-render-tabs.js — Rendered tab DOM operations
// ============================================================
// Extracted from rail-render.js during Phase F2 refinement.
// Contains rendered tab factory, DOM order sync, edge text sync,
// and tab content sync.

import state from './state.js';
import { clamp } from './text.js';
import {
  TAB_COLORS, COLLAPSED_TAB_HEIGHT
} from './constants.js';
import {
  normalizeColorIndex
} from './bookmarks.js';
import {
  isBookmarkPopupPinned, isBookmarkExpansionPinned,
  togglePinnedBookmark, toggleExpandedPinnedBookmark,
  persistBookmarkUiState
} from './ui-state.js';
import {
  handleBookmarkColorPickerOpen, isBookmarkColorPickerEnabled
} from './popup.js';
import { formatPopupDisplayText, isCodeAnchor } from './capture.js';
import {
  canReorderBookmarkTabs,
  consumeBookmarkDragSuppressedClick, handleBookmarkTabPointerDown
} from './rail-dnd.js';
import {
  createTabElement, renderTabActionButtonContent,
  syncTabPopupElement,
  extractResolvedSelectionText
} from './rail-popup-tab.js';
import {
  getNormalizedBookmarkSearchQuery,
  highlightMatchInElement, isBookmarkSearchMatched
} from './rail-search.js';
import { handleBookmarkRemove } from './bookmarks.js';

// ============================================================
// Deps — injected from rail-render.js to avoid circular imports
// ============================================================

var _deps = {
  callbacks: null,
  setHoveredBookmark: null,
  clearHoveredBookmark: null,
  setFocusedBookmark: null,
  clearFocusedBookmark: null,
  isBookmarkExpanded: null,
  getBookmarkPopupText: null
};

export function initRenderTabs(deps) {
  if (!deps || typeof deps !== "object") {
    return;
  }

  Object.keys(_deps).forEach(function (key) {
    if (deps[key] !== undefined) {
      _deps[key] = deps[key];
    }
  });
}

// ============================================================
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

function _getCallbacks() {
  return _deps.callbacks || {};
}

// ============================================================
// Ordered tab access
// ============================================================

export function getOrderedBookmarkTabs() {
  if (!state.layer) {
    return [];
  }

  return Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]"));
}

// ============================================================
// Rendered tab factory
// ============================================================

export function createRenderedBookmarkTab(bookmark, index) {
  var callbacks = _getCallbacks();
  var color = TAB_COLORS[bookmark.colorIndex % TAB_COLORS.length];
  var hasPinnedPopup = isBookmarkPopupPinned(bookmark.id);
  var hasPinnedExpansion = isBookmarkExpansionPinned(bookmark.id);
  var getPopupText = _deps.getBookmarkPopupText;
  var tab = createTabElement({
    label: bookmark.label || "Bookmark",
    popupText: hasPinnedPopup ? (getPopupText ? getPopupText(bookmark) : "") : "",
    popupBookmarkId: bookmark.id,
    popupTitle: bookmark.label || "Bookmark",
    popupOnClose: hasPinnedPopup
      ? function (event) {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
        togglePinnedBookmark(bookmark.id);
      }
      : null,
    edgeText: String(index + 1),
    accent: color,
    title: bookmark.label || "Bookmark",
    actions: [
      {
        key: "expand-pin-toggle",
        label: "P",
        icon: "expand-pin",
        title: hasPinnedExpansion ? "Release expanded bookmark" : "Keep bookmark expanded",
        className: "cgptbm-tab__action--expand-pin",
        isSelected: hasPinnedExpansion,
        onClick: function () {
          toggleExpandedPinnedBookmark(bookmark.id);
        }
      },
      {
        label: "E",
        icon: "edit",
        title: "Edit bookmark",
        className: "cgptbm-tab__action--edit",
        onClick: function (event) {
          if (callbacks.handleBookmarkEdit) {
            callbacks.handleBookmarkEdit(bookmark.id, event);
          }
        }
      },
      {
        key: "pin-toggle",
        label: hasPinnedPopup ? "-" : "+",
        title: hasPinnedPopup ? "Hide saved text popup" : "Show saved text popup",
        className: "cgptbm-tab__action--pin",
        isSelected: hasPinnedPopup,
        onClick: function () {
          togglePinnedBookmark(bookmark.id);
        }
      },
      {
        label: "X",
        title: "Delete bookmark",
        className: "cgptbm-tab__action--delete",
        onClick: function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (callbacks.isInlineEditing && callbacks.isInlineEditing()) {
            if (callbacks.cancelInlineEdit) callbacks.cancelInlineEdit();
          }
          handleBookmarkRemove(bookmark.id);
        }
      }
    ]
  });

  tab.dataset.bookmarkId = bookmark.id;
  tab.classList.toggle("is-reorder-ready", canReorderBookmarkTabs());

  if (state.activeBookmarkId === bookmark.id) {
    tab.classList.add("is-active");
  }

  var button = tab.querySelector(".cgptbm-tab__button");
  var collapsedHoverZone = tab.querySelector(".cgptbm-tab__collapsed-hover-zone");
  var surface = tab.querySelector(".cgptbm-tab__surface");
  var edge = tab.querySelector(".cgptbm-tab__edge");
  button.addEventListener("mousedown", preventFocusSteal);
  button.addEventListener("click", function (event) {
    if (consumeBookmarkDragSuppressedClick(bookmark.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (callbacks.isInlineEditing && callbacks.isInlineEditing()) {
      if (callbacks.cancelInlineEdit) callbacks.cancelInlineEdit();
    }
    if (callbacks.handleBookmarkClick) {
      callbacks.handleBookmarkClick(bookmark.id);
    }
  });
  button.addEventListener("contextmenu", function (event) {
    event.preventDefault();
    if (callbacks.isInlineEditing && callbacks.isInlineEditing()) {
      if (callbacks.cancelInlineEdit) callbacks.cancelInlineEdit();
    }
    handleBookmarkRemove(bookmark.id);
  });
  if (surface) {
    surface.addEventListener("pointerdown", function (event) {
      handleBookmarkTabPointerDown(bookmark.id, event);
    });
    surface.addEventListener("pointerenter", function () {
      if (_deps.setHoveredBookmark) _deps.setHoveredBookmark(bookmark.id);
    });
    surface.addEventListener("pointerleave", function (event) {
      var relatedTarget = event.relatedTarget;
      if (relatedTarget && tab.contains(relatedTarget)) {
        return;
      }
      if (_deps.clearHoveredBookmark) _deps.clearHoveredBookmark(bookmark.id);
    });
  }
  if (collapsedHoverZone) {
    collapsedHoverZone.addEventListener("pointerenter", function () {
      if (_deps.isBookmarkExpanded && _deps.isBookmarkExpanded(bookmark.id)) {
        return;
      }
      if (_deps.setHoveredBookmark) _deps.setHoveredBookmark(bookmark.id);
    });
  }
  var rightActionDock = tab.querySelector(".cgptbm-tab__actions--right");
  if (rightActionDock) {
    rightActionDock.addEventListener("pointerenter", function () {
      if (!_deps.isBookmarkExpanded || !_deps.isBookmarkExpanded(bookmark.id)) {
        return;
      }
      if (_deps.setHoveredBookmark) _deps.setHoveredBookmark(bookmark.id);
    });
  }
  tab.addEventListener("pointerenter", function () {
    if (!_deps.isBookmarkExpanded || !_deps.isBookmarkExpanded(bookmark.id)) {
      return;
    }
    if (_deps.setHoveredBookmark) _deps.setHoveredBookmark(bookmark.id);
  });
  if (edge) {
    edge.tabIndex = -1;
    edge.setAttribute("role", "button");
    edge.setAttribute("aria-label", "Change bookmark color");
    edge.addEventListener("mousedown", function (event) {
      preventFocusSteal(event);
      event.stopPropagation();
    });
    edge.addEventListener("click", function (event) {
      handleBookmarkColorPickerOpen(bookmark.id, event);
    });
    edge.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      handleBookmarkColorPickerOpen(bookmark.id, event);
    });
  }
  tab.addEventListener("pointerleave", function (event) {
    var relatedTarget = event.relatedTarget;
    if (relatedTarget && tab.contains(relatedTarget)) {
      return;
    }
    if (_deps.clearHoveredBookmark) _deps.clearHoveredBookmark(bookmark.id);
  });
  tab.addEventListener("focusin", function () {
    if (_deps.setFocusedBookmark) _deps.setFocusedBookmark(bookmark.id);
  });
  tab.addEventListener("focusout", function (event) {
    var relatedTarget = event.relatedTarget;
    if (relatedTarget && tab.contains(relatedTarget)) {
      return;
    }
    if (_deps.clearFocusedBookmark) _deps.clearFocusedBookmark(bookmark.id);
  });

  return tab;
}

// ============================================================
// DOM order synchronization
// ============================================================

export function syncRenderedBookmarkTabDomOrder(bookmarks) {
  if (!state.layer) {
    return;
  }

  var orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  if (!orderedBookmarks.length) {
    return;
  }

  var tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return;
  }

  var tabById = {};
  var placedBookmarkIds = {};
  tabs.forEach(function (tab) {
    var bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  orderedBookmarks.forEach(function (bookmark) {
    var bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    var tab = bookmarkId ? tabById[bookmarkId] : null;
    if (!tab || placedBookmarkIds[bookmarkId]) {
      return;
    }

    placedBookmarkIds[bookmarkId] = true;
    state.layer.appendChild(tab);
  });

  tabs.forEach(function (tab) {
    var bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId || placedBookmarkIds[bookmarkId]) {
      return;
    }

    state.layer.appendChild(tab);
  });
}

export function insertRenderedBookmarkTabAtDisplayIndex(tab, bookmarks, insertIndex) {
  if (!state.layer || !(tab instanceof HTMLElement)) {
    return false;
  }

  var orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  var bookmarkId = tab.dataset.bookmarkId || "";
  var tabById = {};
  getOrderedBookmarkTabs().forEach(function (existingTab) {
    var existingBookmarkId = existingTab.dataset.bookmarkId || "";
    if (existingBookmarkId) {
      tabById[existingBookmarkId] = existingTab;
    }
  });

  var boundedInsertIndex = clamp(
    Number.isInteger(insertIndex) ? insertIndex : orderedBookmarks.findIndex(function (bookmark) {
      return bookmark && bookmark.id === bookmarkId;
    }),
    0,
    orderedBookmarks.length
  );

  for (var index = boundedInsertIndex + 1; index < orderedBookmarks.length; index += 1) {
    var nextBookmark = orderedBookmarks[index];
    var nextBookmarkId = nextBookmark && nextBookmark.id ? nextBookmark.id : "";
    if (!nextBookmarkId || nextBookmarkId === bookmarkId) {
      continue;
    }

    var nextTab = tabById[nextBookmarkId];
    if (!nextTab) {
      continue;
    }

    state.layer.insertBefore(tab, nextTab);
    return true;
  }

  state.layer.appendChild(tab);
  return true;
}

// ============================================================
// Edge text synchronization
// ============================================================

export function syncRenderedBookmarkEdgeText(bookmarks) {
  if (!state.layer) {
    return;
  }

  var orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  if (!orderedBookmarks.length) {
    return;
  }

  var tabById = {};
  getOrderedBookmarkTabs().forEach(function (tab) {
    var bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  orderedBookmarks.forEach(function (bookmark, index) {
    var bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    var tab = bookmarkId ? tabById[bookmarkId] : null;
    var edge = tab ? tab.querySelector(".cgptbm-tab__edge") : null;
    if (!edge) {
      return;
    }

    edge.textContent = String(index + 1);
  });
}

// ============================================================
// Tab content synchronization
// ============================================================

export function syncRenderedBookmarkTabContent(tab, bookmark) {
  if (!tab || !bookmark) {
    return;
  }

  var callbacks = _getCallbacks();
  var accent = TAB_COLORS[normalizeColorIndex(bookmark.colorIndex) % TAB_COLORS.length];
  var labelText = bookmark.label || "Bookmark";
  var button = tab.querySelector(".cgptbm-tab__button");
  var label = tab.querySelector(".cgptbm-tab__label");

  tab.style.setProperty("--cgptbm-accent", accent);
  if (button) {
    button.title = labelText;
    button.setAttribute("aria-label", labelText);
  }
  var isEditing = callbacks.isInlineEditingBookmark
    ? callbacks.isInlineEditingBookmark(bookmark.id)
    : false;
  if (label && !isEditing) {
    label.textContent = labelText;
    var nq = getNormalizedBookmarkSearchQuery(state.bookmarkSearchQuery);
    if (nq) highlightMatchInElement(label, nq);
  }

  var getPopupText = _deps.getBookmarkPopupText;
  syncTabPopupElement(tab, {
    popupText: isBookmarkPopupPinned(bookmark.id) ? (getPopupText ? getPopupText(bookmark) : "") : "",
    popupBookmarkId: bookmark.id,
    popupTitle: labelText,
    label: labelText
  });
}
