// ============================================================
// rail-render.js — Rendering pipeline, incremental refresh, orchestrator facade
// ============================================================
// Extracted from rail.js during Phase C modularization.
// Contains GROUP 3 (Incremental refresh), GROUP 10 (Rendering),
// GROUP 11 (Tab operations).
// Interaction visuals, expansion/pinning, and active feedback live in
// rail-render-state.js (Phase F3).
// Layout and measurement helpers live in rail-render-layout.js (Phase F1).
// Incremental refresh is absorbed into this render cluster per v2 design.

import state from './state.js';
import {
  COLLAPSED_TAB_HEIGHT
} from './constants.js';
import {
  applyCurrentBookmarks
} from './bookmarks.js';
import {
  buildKnownBookmarkIdMap, sanitizeBookmarkInteractionId,
  sanitizeBookmarkInteractionIds, normalizeManualOrderBookmarkIds,
  persistBookmarkUiState, isAllPinned
} from './ui-state.js';
import {
  closeSavePopup, closeBookmarkColorPicker
} from './popup.js';
import {
  syncRailViewportOverflow, syncRailViewportWidth,
  getBookmarkTabTopLimit
} from './rail-viewport.js';
import {
  clearBookmarkDragSession,
  syncBookmarkDragSessionVisual
} from './rail-dnd.js';
import {
  createTabElement, resetExpandedBookmarkState
} from './rail-popup-tab.js';
import {
  getOrderedBookmarkTabs as _getOrderedBookmarkTabs,
  createRenderedBookmarkTab as _createRenderedBookmarkTab,
  syncRenderedBookmarkTabDomOrder as _syncRenderedBookmarkTabDomOrder,
  insertRenderedBookmarkTabAtDisplayIndex as _insertRenderedBookmarkTabAtDisplayIndex,
  syncRenderedBookmarkEdgeText as _syncRenderedBookmarkEdgeText,
  syncRenderedBookmarkTabContent as _syncRenderedBookmarkTabContent,
  initRenderTabs
} from './rail-render-tabs.js';
import {
  getFilteredCurrentBookmarks, getNormalizedBookmarkSearchQuery
} from './rail-search.js';
import { syncBookmarkHistoryControlsToCurrentRail } from './rail-controls.js';
import { scheduleSandboxCardTriggerRender } from './sandbox-card.js';
import {
  computeTabPositions as _computeTabPositions,
  measureRenderedTabLayout as _measureRenderedTabLayout,
  getRenderedTabHeight as _getRenderedTabHeight,
  getRenderedSurfaceHeight as _getRenderedSurfaceHeight,
  getRenderedPopupBottom as _getRenderedPopupBottom,
  buildRenderedTabLayoutSnapshot as _buildRenderedTabLayoutSnapshot,
  syncAnchoredRenderedBookmarkTailLayout as _syncAnchoredRenderedBookmarkTailLayout
} from './rail-render-layout.js';
import {
  initRenderState,
  syncRenderedBookmarkInteractionVisuals as _syncRenderedBookmarkInteractionVisuals,
  syncExpandedBookmarkState as _syncExpandedBookmarkState,
  getExpandedBookmarkId as _getExpandedBookmarkId,
  isBookmarkExpanded as _isBookmarkExpanded,
  syncRenderedPinActions as _syncRenderedPinActions,
  isPopupContentExpanded as _isPopupContentExpanded,
  setPopupContentExpanded as _setPopupContentExpanded,
  getBookmarkPopupText as _getBookmarkPopupText,
  pulseTab as _pulseTab,
  syncRenderedActiveBookmarkState as _syncRenderedActiveBookmarkState,
  pulseRenderedBookmarkTab as _pulseRenderedBookmarkTab,
  clearActiveState as _clearActiveState,
  showAddTabSuccess as _showAddTabSuccess,
  resetAddTabFeedback as _resetAddTabFeedback,
  syncRenderedPinnedPopups as _syncRenderedPinnedPopups,
  setHoveredBookmark as _setHoveredBookmark,
  clearHoveredBookmark as _clearHoveredBookmark,
  setFocusedBookmark as _setFocusedBookmark,
  clearFocusedBookmark as _clearFocusedBookmark,
  reconcileRenderedBookmarkInteractionState as _reconcileRenderedBookmarkInteractionState
} from './rail-render-state.js';

// ============================================================
// Re-export layout functions (preserved API surface)
// ============================================================

export {
  _computeTabPositions as computeTabPositions,
  _measureRenderedTabLayout as measureRenderedTabLayout,
  _getRenderedTabHeight as getRenderedTabHeight,
  _getRenderedSurfaceHeight as getRenderedSurfaceHeight,
  _getRenderedPopupBottom as getRenderedPopupBottom
};

// ============================================================
// Re-export render-state functions (preserved API surface, Phase F3)
// ============================================================

export {
  _syncRenderedBookmarkInteractionVisuals as syncRenderedBookmarkInteractionVisuals,
  _syncExpandedBookmarkState as syncExpandedBookmarkState,
  _getExpandedBookmarkId as getExpandedBookmarkId,
  _isBookmarkExpanded as isBookmarkExpanded,
  _syncRenderedPinActions as syncRenderedPinActions,
  _isPopupContentExpanded as isPopupContentExpanded,
  _setPopupContentExpanded as setPopupContentExpanded,
  _getBookmarkPopupText as getBookmarkPopupText,
  _pulseTab as pulseTab,
  _syncRenderedActiveBookmarkState as syncRenderedActiveBookmarkState,
  _pulseRenderedBookmarkTab as pulseRenderedBookmarkTab,
  _clearActiveState as clearActiveState,
  _showAddTabSuccess as showAddTabSuccess,
  _resetAddTabFeedback as resetAddTabFeedback
};

// ============================================================
// Layout deps — passed to layout helpers that need getOrderedBookmarkTabs
// ============================================================

function _layoutDeps() {
  return { getOrderedBookmarkTabs: getOrderedBookmarkTabs };
}

// ============================================================
// Callback registry (injected via initRender)
// ============================================================

var _callbacks = {
  handleBookmarkClick: null,
  handleBookmarkEdit: null,
  isInlineEditing: null,
  isInlineEditingBookmark: null,
  cancelInlineEdit: null
};

export function initRender(callbacks) {
  if (!callbacks || typeof callbacks !== "object") {
    return;
  }

  Object.keys(_callbacks).forEach(function (key) {
    if (typeof callbacks[key] === "function") {
      _callbacks[key] = callbacks[key];
    }
  });

  initRenderState({
    syncRenderedBookmarkRail: function (options) { syncRenderedBookmarkRail(options); },
    getOrderedBookmarkTabs: function () { return getOrderedBookmarkTabs(); }
  });

  initRenderTabs({
    callbacks: _callbacks,
    setHoveredBookmark: _setHoveredBookmark,
    clearHoveredBookmark: _clearHoveredBookmark,
    setFocusedBookmark: _setFocusedBookmark,
    clearFocusedBookmark: _clearFocusedBookmark,
    isBookmarkExpanded: _isBookmarkExpanded,
    getBookmarkPopupText: _getBookmarkPopupText
  });
}

// ============================================================
// GROUP 3 — Incremental refresh
// ============================================================

function canRefreshCurrentBookmarksViewAfterIncrementalRemove(bookmarkId) {
  if (!bookmarkId || !state.layer) {
    return false;
  }

  if (getNormalizedBookmarkSearchQuery(state.bookmarkSearchQuery)) {
    return false;
  }

  if (state.emptyTab || state.layer.querySelector(".cgptbm-tab--empty")) {
    return false;
  }

  if (
    bookmarkId === state.colorPickerBookmarkId ||
    bookmarkId === state.pendingBookmarkId ||
    bookmarkId === state.colorPickerLockedBookmarkId ||
    bookmarkId === state.editLockedBookmarkId ||
    bookmarkId === state.resizeLockedExpandedBookmarkId ||
    bookmarkId === state.createPopupPreservedExpandedBookmarkId
  ) {
    return false;
  }

  if (!state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]')) {
    return false;
  }

  return getOrderedBookmarkTabs().length > 1;
}

export function refreshCurrentBookmarksViewAfterIncrementalRemove(bookmarkId) {
  if (!canRefreshCurrentBookmarksViewAfterIncrementalRemove(bookmarkId)) {
    return false;
  }

  clearBookmarkDragSession({ skipLayoutReset: true });
  applyCurrentBookmarks();
  const visibleBookmarks = getFilteredCurrentBookmarks();
  if (!visibleBookmarks.length) {
    return false;
  }

  const removedTab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]');
  if (!removedTab) {
    return false;
  }
  const removedTabIndex = getOrderedBookmarkTabs().findIndex(function (tab) {
    return (tab.dataset.bookmarkId || "") === bookmarkId;
  });
  if (removedTabIndex < 0) {
    return false;
  }

  const knownBookmarkIds = buildKnownBookmarkIdMap(state.currentBookmarks);
  state.hoveredBookmarkId = sanitizeBookmarkInteractionId(state.hoveredBookmarkId, knownBookmarkIds);
  state.focusedBookmarkId = sanitizeBookmarkInteractionId(state.focusedBookmarkId, knownBookmarkIds);
  state.createPopupPreservedExpandedBookmarkId = sanitizeBookmarkInteractionId(state.createPopupPreservedExpandedBookmarkId, knownBookmarkIds);
  state.pinnedBookmarkIds = sanitizeBookmarkInteractionIds(state.pinnedBookmarkIds, knownBookmarkIds);
  state.expandedPinnedBookmarkIds = sanitizeBookmarkInteractionIds(state.expandedPinnedBookmarkIds, knownBookmarkIds);
  state.expandedPopupContentBookmarkIds = sanitizeBookmarkInteractionIds(state.expandedPopupContentBookmarkIds, knownBookmarkIds);
  state.manualOrderBookmarkIds = normalizeManualOrderBookmarkIds(state.currentBookmarks, state.manualOrderBookmarkIds);
  state.colorPickerLockedBookmarkId = sanitizeBookmarkInteractionId(state.colorPickerLockedBookmarkId, knownBookmarkIds);
  state.editLockedBookmarkId = sanitizeBookmarkInteractionId(state.editLockedBookmarkId, knownBookmarkIds);
  state.resizeLockedExpandedBookmarkId = sanitizeBookmarkInteractionId(state.resizeLockedExpandedBookmarkId, knownBookmarkIds);
  state.expandedBookmarkId = _getExpandedBookmarkId();

  removedTab.remove();
  state.emptyTab = null;
  const layoutByBookmarkId = buildRenderedTabLayoutSnapshot(visibleBookmarks);
  if (!layoutByBookmarkId) {
    return false;
  }
  if (!syncAnchoredRenderedBookmarkTailLayout(visibleBookmarks, layoutByBookmarkId, removedTabIndex, {
    expandedBookmarkId: state.expandedBookmarkId
  })) {
    return false;
  }
  _syncRenderedBookmarkInteractionVisuals();
  syncRenderedBookmarkEdgeText(visibleBookmarks);
  _syncRenderedPinActions();
  _syncRenderedActiveBookmarkState();
  syncBookmarkHistoryControlsToCurrentRail();
  syncRailViewportOverflow();
  syncRailViewportWidth();
  scheduleSandboxCardTriggerRender();
  return true;
}

function canRefreshCurrentBookmarksViewAfterIncrementalCreate() {
  if (!state.layer) {
    return false;
  }

  if (getNormalizedBookmarkSearchQuery(state.bookmarkSearchQuery)) {
    return false;
  }

  if (state.emptyTab || state.layer.querySelector(".cgptbm-tab--empty")) {
    return false;
  }

  return getOrderedBookmarkTabs().length > 0;
}

export function refreshCurrentBookmarksViewAfterIncrementalCreate(bookmarkId) {
  if (!bookmarkId || !canRefreshCurrentBookmarksViewAfterIncrementalCreate()) {
    return false;
  }

  // If tab-extend is toggled ON (all tabs pinned), auto-pin the new tab
  const shouldAutoPin = isAllPinned();

  applyCurrentBookmarks();

  if (shouldAutoPin) {
    const expanded = Array.isArray(state.expandedPinnedBookmarkIds) ? state.expandedPinnedBookmarkIds : [];
    if (expanded.indexOf(bookmarkId) < 0) {
      expanded.push(bookmarkId);
      state.expandedPinnedBookmarkIds = expanded;
    }
  }

  const visibleBookmarks = getFilteredCurrentBookmarks();
  const bookmarkIndex = visibleBookmarks.findIndex(function (bookmark) {
    return bookmark && bookmark.id === bookmarkId;
  });
  if (bookmarkIndex < 0) {
    return false;
  }

  const existingTab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]');
  if (existingTab) {
    return false;
  }

  const createdBookmark = visibleBookmarks[bookmarkIndex];
  if (!createdBookmark || createdBookmark.id !== bookmarkId) {
    return false;
  }

  beginBookmarkCreateInteractionGuard();
  let shouldSkipCreateInteractionReconcile = false;
  try {
    if (state.emptyTab && state.emptyTab.isConnected) {
      state.emptyTab.remove();
    }
    state.emptyTab = null;

    const tab = createRenderedBookmarkTab(createdBookmark, bookmarkIndex);
    insertRenderedBookmarkTabAtDisplayIndex(tab, visibleBookmarks, bookmarkIndex);
    const layoutByBookmarkId = buildRenderedTabLayoutSnapshot(visibleBookmarks);
    if (!layoutByBookmarkId) {
      return false;
    }
    state.expandedBookmarkId = _getExpandedBookmarkId();
    if (!syncAnchoredRenderedBookmarkTailLayout(visibleBookmarks, layoutByBookmarkId, bookmarkIndex, {
      expandedBookmarkId: state.expandedBookmarkId
    })) {
      return false;
    }
    _syncRenderedBookmarkInteractionVisuals();
    syncRenderedBookmarkEdgeText(visibleBookmarks);
    _syncRenderedActiveBookmarkState();
    syncBookmarkHistoryControlsToCurrentRail();
    syncRailViewportOverflow();
    syncRailViewportWidth();
    scheduleSandboxCardTriggerRender();
    if (shouldAutoPin) {
      persistBookmarkUiState();
    }
    shouldSkipCreateInteractionReconcile = true;
    return true;
  } finally {
    endBookmarkCreateInteractionGuard({ skipReconcile: shouldSkipCreateInteractionReconcile });
  }
}

function canRefreshCurrentBookmarksViewAfterIncrementalUpdate(bookmarkId) {
  if (!bookmarkId || !state.layer) {
    return false;
  }

  if (getNormalizedBookmarkSearchQuery(state.bookmarkSearchQuery)) {
    return false;
  }

  if (state.emptyTab || state.layer.querySelector(".cgptbm-tab--empty")) {
    return false;
  }

  return Boolean(state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]'));
}

export function refreshCurrentBookmarksViewAfterIncrementalUpdate(bookmarkId) {
  if (!canRefreshCurrentBookmarksViewAfterIncrementalUpdate(bookmarkId)) {
    return false;
  }

  clearBookmarkDragSession({ skipLayoutReset: true });
  applyCurrentBookmarks();
  const visibleBookmarks = getFilteredCurrentBookmarks();
  const bookmarkIndex = visibleBookmarks.findIndex(function (bookmark) {
    return bookmark && bookmark.id === bookmarkId;
  });
  if (bookmarkIndex < 0) {
    return false;
  }

  const updatedBookmark = visibleBookmarks[bookmarkIndex];
  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]');
  if (!updatedBookmark || !tab) {
    return false;
  }

  state.expandedBookmarkId = _getExpandedBookmarkId();
  syncRenderedBookmarkTabContent(tab, updatedBookmark);

  const layoutByBookmarkId = buildRenderedTabLayoutSnapshot(visibleBookmarks);
  if (!layoutByBookmarkId) {
    return false;
  }
  if (!syncAnchoredRenderedBookmarkTailLayout(visibleBookmarks, layoutByBookmarkId, bookmarkIndex, {
    expandedBookmarkId: state.expandedBookmarkId
  })) {
    return false;
  }

  _syncRenderedBookmarkInteractionVisuals();
  syncRenderedBookmarkEdgeText(visibleBookmarks);
  syncRailViewportOverflow();
  syncRailViewportWidth();
  return true;
}

// ============================================================
// GROUP 4 — Tab layout (delegated to rail-render-layout.js)
// ============================================================

function buildRenderedTabLayoutSnapshot(bookmarks, excludedBookmarkId) {
  return _buildRenderedTabLayoutSnapshot(bookmarks, excludedBookmarkId, _layoutDeps());
}

function syncAnchoredRenderedBookmarkTailLayout(bookmarks, layoutByBookmarkId, startIndex, options) {
  return _syncAnchoredRenderedBookmarkTailLayout(bookmarks, layoutByBookmarkId, startIndex, options, _layoutDeps());
}

function beginBookmarkCreateInteractionGuard() {
  state.bookmarkCreateInteractionGuardCount += 1;
}

function endBookmarkCreateInteractionGuard(options) {
  if (!state.bookmarkCreateInteractionGuardCount) {
    return;
  }

  state.bookmarkCreateInteractionGuardCount -= 1;
  if (state.bookmarkCreateInteractionGuardCount > 0) {
    return;
  }

  if (options && options.skipReconcile) {
    return;
  }

  _reconcileRenderedBookmarkInteractionState();
}

// GROUP 5 — Interaction reconciliation: moved to rail-render-state.js (Phase F3)

// ============================================================
// GROUP 10 — Rendering
// ============================================================

export function renderBookmarks() {
  if (!state.layer) {
    return;
  }

  clearBookmarkDragSession({ skipLayoutReset: true });
  const visibleBookmarks = getFilteredCurrentBookmarks();
  syncBookmarkHistoryControlsToCurrentRail();

  if (state.colorPicker && !visibleBookmarks.some(function (bookmark) {
    return bookmark && bookmark.id === state.colorPickerBookmarkId;
  })) {
    closeBookmarkColorPicker();
  }

  if (state.popup && state.pendingBookmarkId && !visibleBookmarks.some(function (bookmark) {
    return bookmark && bookmark.id === state.pendingBookmarkId;
  })) {
    closeSavePopup();
  }

  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id], .cgptbm-tab--empty")).forEach(function (node) {
    node.remove();
  });

  if (!state.currentBookmarks.length) {
    resetExpandedBookmarkState();
    const emptyTab = createTabElement({
      label: "Drag to select text",
      edgeText: "\u2022",
      accent: "#94a3b8",
      title: "Add a bookmark from your current selection or visible message."
    });
    emptyTab.classList.add("cgptbm-tab--empty");
    emptyTab.style.top = getBookmarkTabTopLimit() + "px";
    emptyTab.style.height = COLLAPSED_TAB_HEIGHT + "px";
    emptyTab.querySelector(".cgptbm-tab__button").setAttribute("aria-hidden", "true");
    emptyTab.querySelector(".cgptbm-tab__button").tabIndex = -1;
    state.layer.appendChild(emptyTab);
    state.emptyTab = emptyTab;
    syncRailViewportWidth();
    syncRailViewportOverflow();
    scheduleSandboxCardTriggerRender();
    return;
  }

  if (!visibleBookmarks.length) {
    const totalCount = state.currentBookmarks.length;
    const emptyTab = createTabElement({
      label: "No matches",
      edgeText: "?",
      accent: "#94a3b8",
      title: 'No bookmarks on this page match "' + state.bookmarkSearchQuery + '". ' +
        (totalCount === 1
          ? "1 bookmark is still saved on this page."
          : totalCount + " bookmarks are still saved on this page.")
    });
    emptyTab.classList.add("cgptbm-tab--empty");
    emptyTab.style.top = getBookmarkTabTopLimit() + "px";
    emptyTab.style.height = COLLAPSED_TAB_HEIGHT + "px";
    emptyTab.querySelector(".cgptbm-tab__button").setAttribute("aria-hidden", "true");
    emptyTab.querySelector(".cgptbm-tab__button").tabIndex = -1;
    state.layer.appendChild(emptyTab);
    state.emptyTab = emptyTab;
    syncRailViewportWidth();
    syncRailViewportOverflow();
    scheduleSandboxCardTriggerRender();
    return;
  }

  state.emptyTab = null;

  const positionedBookmarks = _computeTabPositions(visibleBookmarks);
  positionedBookmarks.forEach(function (entry, index) {
    const tab = createRenderedBookmarkTab(entry.bookmark, index);
    tab.style.top = entry.top + "px";
    tab.style.height = entry.height + "px";
    state.layer.appendChild(tab);
  });

  syncRenderedBookmarkRail();
  syncRailViewportWidth();
  scheduleSandboxCardTriggerRender();
}

export function createRenderedBookmarkTab(bookmark, index) {
  return _createRenderedBookmarkTab(bookmark, index);
}

// syncRenderedColorPickerEdges — moved to rail-render-state.js (Phase F3)

// computeTabPositions — re-exported from rail-render-layout.js

export function syncRenderedBookmarkRail(options) {
  if (!state.layer) {
    return;
  }

  const nextOptions = options || {};
  const isLightweight = Boolean(nextOptions.lightweight);

  const tabs = Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]"));
  if (!tabs.length) {
    if (!state.currentBookmarks.length) {
      resetExpandedBookmarkState();
    } else {
      state.hoveredBookmarkId = "";
      state.focusedBookmarkId = "";
      state.expandedBookmarkId = _getExpandedBookmarkId();
    }
    syncRailViewportOverflow();
    return;
  }

  const tabById = {};
  const knownBookmarkIds = {};
  state.currentBookmarks.forEach(function (bookmark) {
    if (bookmark && bookmark.id) {
      knownBookmarkIds[bookmark.id] = true;
    }
  });
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  state.hoveredBookmarkId = sanitizeBookmarkInteractionId(state.hoveredBookmarkId, knownBookmarkIds);
  state.focusedBookmarkId = sanitizeBookmarkInteractionId(state.focusedBookmarkId, knownBookmarkIds);
  state.createPopupPreservedExpandedBookmarkId = sanitizeBookmarkInteractionId(state.createPopupPreservedExpandedBookmarkId, knownBookmarkIds);
  state.pinnedBookmarkIds = sanitizeBookmarkInteractionIds(state.pinnedBookmarkIds, knownBookmarkIds);
  state.expandedPinnedBookmarkIds = sanitizeBookmarkInteractionIds(state.expandedPinnedBookmarkIds, knownBookmarkIds);
  state.expandedPopupContentBookmarkIds = sanitizeBookmarkInteractionIds(state.expandedPopupContentBookmarkIds, knownBookmarkIds);
  state.manualOrderBookmarkIds = normalizeManualOrderBookmarkIds(state.currentBookmarks, state.manualOrderBookmarkIds);
  state.colorPickerLockedBookmarkId = sanitizeBookmarkInteractionId(state.colorPickerLockedBookmarkId, knownBookmarkIds);
  state.editLockedBookmarkId = sanitizeBookmarkInteractionId(state.editLockedBookmarkId, knownBookmarkIds);
  state.resizeLockedExpandedBookmarkId = sanitizeBookmarkInteractionId(state.resizeLockedExpandedBookmarkId, knownBookmarkIds);
  state.expandedBookmarkId = _getExpandedBookmarkId();

  const bookmarkById = {};
  state.currentBookmarks.forEach(function (bookmark) {
    bookmarkById[bookmark.id] = bookmark;
  });

  _syncRenderedBookmarkInteractionVisuals(tabs);

  if (!isLightweight) {
    _syncRenderedPinnedPopups(tabById, bookmarkById);
  }

  const heightByBookmarkId = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId) {
      return;
    }

    const layout = _measureRenderedTabLayout(tab, { lightweight: isLightweight });
    heightByBookmarkId[bookmarkId] = layout.totalHeight;
    tab.style.setProperty("--cgptbm-surface-height", layout.surfaceHeight + "px");
  });

  const positionedBookmarks = _computeTabPositions(getFilteredCurrentBookmarks(), {
    expandedBookmarkId: state.expandedBookmarkId,
    heightByBookmarkId: heightByBookmarkId
  });

  positionedBookmarks.forEach(function (entry, index) {
    const tab = tabById[entry.bookmark.id];
    if (!tab) {
      return;
    }

    tab.style.top = entry.top + "px";
    tab.style.height = entry.height + "px";
    if (entry.bookmark.id === state.expandedBookmarkId) {
      tab.style.zIndex = String(tabs.length + 2);
    } else {
      tab.style.zIndex = String(Math.max(1, tabs.length - index));
    }
  });

  syncRailViewportOverflow();
  syncRailViewportWidth();
  if (!isLightweight) {
    _syncRenderedPinActions();
  }

  if (state.bookmarkDragSession && state.bookmarkDragSession.activated) {
    syncBookmarkDragSessionVisual(state.bookmarkDragSession);
  }
}

// measureRenderedTabLayout — re-exported from rail-render-layout.js

// ============================================================
// GROUP 11 — Tab operations
// ============================================================

export function getOrderedBookmarkTabs() {
  return _getOrderedBookmarkTabs();
}

export function syncRenderedBookmarkTabDomOrder(bookmarks) {
  _syncRenderedBookmarkTabDomOrder(bookmarks);
}

function insertRenderedBookmarkTabAtDisplayIndex(tab, bookmarks, insertIndex) {
  return _insertRenderedBookmarkTabAtDisplayIndex(tab, bookmarks, insertIndex);
}

export function syncRenderedBookmarkEdgeText(bookmarks) {
  _syncRenderedBookmarkEdgeText(bookmarks);
}

export function syncRenderedBookmarkTabContent(tab, bookmark) {
  _syncRenderedBookmarkTabContent(tab, bookmark);
}

// getRenderedTabHeight, getRenderedSurfaceHeight, getRenderedPopupBottom — re-exported from rail-render-layout.js

// GROUP 14 — Interaction visuals: moved to rail-render-state.js (Phase F3)
// GROUP 15 — Expansion/pinning: moved to rail-render-state.js (Phase F3)
// GROUP 20 — Active/pulse feedback: moved to rail-render-state.js (Phase F3)
