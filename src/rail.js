// ============================================================
// ui/rail.js — Bookmark tab rail facade (right sidebar)
// ============================================================
// Canonical facade for the rail modularization.
// Delegates all groups to extracted sub-modules.

import state from './state.js';

// ============================================================
// Extracted sub-modules (Phase A)
// ============================================================

import {
  syncRailViewportTop,
  syncRailViewportWidth,
  bindTopRightUiProtectionObserver,
  scheduleTopRightUiProtectionRefresh,
  getRailViewportTop,
  getBookmarkTabTopLimit,
  syncRailViewportOverflow,
  syncRailOverlayScroll,
  bindRailScrollbar,
  handleRailViewportWheel,
  handleRailScrollbarPointerMove,
  handleRailScrollbarPointerEnd,
  HISTORY_CONTROLS_DEFAULT_TOP
} from './rail-viewport.js';

import {
  initDnd,
  clearBookmarkDragSession,
  handleBookmarkDragPointerEnd,
  handleBookmarkDragPointerMove,
  handleBookmarkTabPointerDown,
  consumeBookmarkDragSuppressedClick,
  canReorderBookmarkTabs,
  syncBookmarkDragSessionVisual
} from './rail-dnd.js';

// ============================================================
// Extracted sub-modules (Phase B)
// ============================================================

import {
  initPopupTab,
  getPopupPositionForRect,
  getEditPopupPositionForTab,
  extractResolvedSelectionText,
  handlePopupResizePointerMove,
  handlePopupResizePointerEnd,
  beginPopupResizeSession,
  endPopupResizeSession,
  releaseResizeLockedExpandedBookmarkForInteraction,
  maybeReleaseResizeLockedExpandedBookmark,
  getPopupLayout,
  setPopupLayout,
  applyPopupResizeLocalLayout,
  applyPopupLayoutToElement,
  schedulePopupOverflowIndicatorSync,
  syncPopupOverflowIndicator,
  handlePopupContentExpand,
  handlePopupContentMinimize,
  resetExpandedBookmarkState,
  createTabElement,
  renderTabActionButtonContent,
  buildTabActionIcon,
  createTabPopupElement,
  syncTabPopupElement
} from './rail-popup-tab.js';

// ============================================================
// Extracted sub-modules (Phase C)
// ============================================================

import {
  initSearch,
  getFilteredCurrentBookmarks,
  getNormalizedBookmarkSearchQuery,
  setBookmarkSearchQuery,
  getDisplayOrderedBookmarks,
  highlightMatchInElement
} from './rail-search.js';

import {
  initControls,
  syncBookmarkHistoryControlsToCurrentRail,
  applyRailOpacity,
  deactivateRailUiInteractions,
  preCollapseGuard
} from './rail-controls.js';

import {
  initRender,
  renderBookmarks,
  createRenderedBookmarkTab,
  computeTabPositions,
  syncRenderedBookmarkRail,
  getOrderedBookmarkTabs,
  syncRenderedBookmarkEdgeText,
  syncRenderedBookmarkTabContent,
  syncRenderedBookmarkInteractionVisuals,
  syncExpandedBookmarkState,
  getExpandedBookmarkId,
  isBookmarkExpanded,
  syncRenderedPinActions,
  isPopupContentExpanded,
  setPopupContentExpanded,
  pulseTab,
  syncRenderedActiveBookmarkState,
  pulseRenderedBookmarkTab,
  clearActiveState,
  showAddTabSuccess,
  resetAddTabFeedback,
  refreshCurrentBookmarksViewAfterIncrementalRemove,
  refreshCurrentBookmarksViewAfterIncrementalCreate,
  refreshCurrentBookmarksViewAfterIncrementalUpdate,
  measureRenderedTabLayout,
  syncRenderedBookmarkTabDomOrder,
  getRenderedTabHeight,
  getRenderedSurfaceHeight,
  getRenderedPopupBottom
} from './rail-render.js';

// ============================================================
// Extracted sub-modules (Phase D)
// ============================================================

import {
  initInteraction,
  handleBookmarkClick,
  handleBookmarkEdit,
  handleDocumentPointerDown,
  handleDocumentPointerMove,
  handleDocumentFocusIn,
  handleDocumentWheel,
  isInlineEditing,
  isInlineEditingBookmark,
  cancelInlineEdit
} from './rail-interaction.js';

// ============================================================
// DnD callback wiring (Phase A)
// ============================================================

initDnd({
  onSyncRail: function (options) { syncRenderedBookmarkRail(options); },
  getFilteredCurrentBookmarks: function () { return getFilteredCurrentBookmarks(); },
  computeTabPositions: function (bookmarks, options) { return computeTabPositions(bookmarks, options); },
  measureRenderedTabLayout: function (tab, options) { return measureRenderedTabLayout(tab, options); },
  syncRenderedBookmarkTabDomOrder: function (bookmarks) { syncRenderedBookmarkTabDomOrder(bookmarks); },
  getDisplayOrderedBookmarks: function (bookmarks, manualOrderBookmarkIds) { return getDisplayOrderedBookmarks(bookmarks, manualOrderBookmarkIds); },
  isInlineEditing: function () { return isInlineEditing(); }
});

// ============================================================
// Popup-tab callback wiring (Phase B)
// ============================================================

initPopupTab({
  onSyncRail: function (options) { syncRenderedBookmarkRail(options); },
  onSyncExpandedBookmarkState: function (options) { syncExpandedBookmarkState(options); },
  getOrderedBookmarkTabs: function () { return getOrderedBookmarkTabs(); },
  getRenderedTabHeight: function (tab) { return getRenderedTabHeight(tab); },
  getRenderedSurfaceHeight: function (tab) { return getRenderedSurfaceHeight(tab); },
  getRenderedPopupBottom: function (tab) { return getRenderedPopupBottom(tab); },
  isPopupContentExpanded: function (bookmarkId) { return isPopupContentExpanded(bookmarkId); },
  setPopupContentExpanded: function (bookmarkId, isExpanded) { setPopupContentExpanded(bookmarkId, isExpanded); },
  getNormalizedSearchQuery: function (value) { return getNormalizedBookmarkSearchQuery(value); },
  highlightMatchInElement: function (el, query) { highlightMatchInElement(el, query); }
});

// ============================================================
// Search callback wiring (Phase C)
// ============================================================

initSearch({
  onRender: function () { renderBookmarks(); },
  getExpandedBookmarkId: function () { return getExpandedBookmarkId(); }
});

// ============================================================
// Render callback wiring (Phase C)
// ============================================================

initRender({
  handleBookmarkClick: function (bookmarkId) { handleBookmarkClick(bookmarkId); },
  handleBookmarkEdit: function (bookmarkId, event) { handleBookmarkEdit(bookmarkId, event); },
  isInlineEditing: function () { return isInlineEditing(); },
  isInlineEditingBookmark: function (bookmarkId) { return isInlineEditingBookmark(bookmarkId); },
  cancelInlineEdit: function () { cancelInlineEdit(); }
});

// ============================================================
// Controls callback wiring (Phase C)
// ============================================================

initControls({
  resetAddTabFeedback: function () { resetAddTabFeedback(); }
});

// ============================================================
// Interaction callback wiring (Phase D)
// ============================================================

initInteraction({
  syncExpandedBookmarkState: function (options) { syncExpandedBookmarkState(options); },
  pulseTab: function (bookmarkId) { pulseTab(bookmarkId); },
  releaseResizeLockedExpandedBookmarkForInteraction: function (bookmarkId) { return releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId); },
  maybeReleaseResizeLockedExpandedBookmark: function (target) { maybeReleaseResizeLockedExpandedBookmark(target); },
  handleRailViewportWheel: function (event) { handleRailViewportWheel(event); },
  clearBookmarkDragSession: function () { clearBookmarkDragSession(); },
  handleBookmarkDragPointerMove: function (event) { return handleBookmarkDragPointerMove(event); }
});

// ============================================================
// Re-export for external consumers
// ============================================================

export { getDisplayOrderedBookmarks };
export { handleBookmarkClick };
export { handleBookmarkEdit };

// Re-exports from rail-viewport.js (Phase A)
export {
  syncRailViewportWidth,
  bindTopRightUiProtectionObserver,
  scheduleTopRightUiProtectionRefresh,
  getRailViewportTop,
  getBookmarkTabTopLimit,
  syncRailViewportOverflow,
  syncRailOverlayScroll,
  bindRailScrollbar,
  handleRailViewportWheel,
  handleRailScrollbarPointerMove,
  handleRailScrollbarPointerEnd
};

// Re-exports from rail-dnd.js (Phase A)
export {
  clearBookmarkDragSession,
  handleBookmarkDragPointerEnd
};

// Re-exports from rail-popup-tab.js (Phase B)
export {
  getPopupPositionForRect,
  getEditPopupPositionForTab,
  applyPopupResizeLocalLayout,
  extractResolvedSelectionText,
  handlePopupResizePointerMove,
  handlePopupResizePointerEnd,
  beginPopupResizeSession,
  endPopupResizeSession,
  releaseResizeLockedExpandedBookmarkForInteraction,
  maybeReleaseResizeLockedExpandedBookmark,
  getPopupLayout,
  setPopupLayout,
  applyPopupLayoutToElement,
  schedulePopupOverflowIndicatorSync,
  syncPopupOverflowIndicator,
  handlePopupContentExpand,
  handlePopupContentMinimize,
  resetExpandedBookmarkState,
  createTabElement,
  renderTabActionButtonContent,
  buildTabActionIcon,
  createTabPopupElement,
  syncTabPopupElement
};

// Re-exports from rail-search.js (Phase C)
export {
  getFilteredCurrentBookmarks,
  getNormalizedBookmarkSearchQuery,
  setBookmarkSearchQuery
};

// Re-exports from rail-controls.js (Phase C)
export {
  syncBookmarkHistoryControlsToCurrentRail,
  applyRailOpacity,
  deactivateRailUiInteractions,
  preCollapseGuard
};

// Re-exports from rail-render.js (Phase C)
export {
  renderBookmarks,
  createRenderedBookmarkTab,
  computeTabPositions,
  syncRenderedBookmarkRail,
  getOrderedBookmarkTabs,
  syncRenderedBookmarkEdgeText,
  syncRenderedBookmarkTabContent,
  syncRenderedBookmarkInteractionVisuals,
  syncExpandedBookmarkState,
  getExpandedBookmarkId,
  isBookmarkExpanded,
  syncRenderedPinActions,
  isPopupContentExpanded,
  setPopupContentExpanded,
  pulseTab,
  syncRenderedActiveBookmarkState,
  pulseRenderedBookmarkTab,
  clearActiveState,
  showAddTabSuccess,
  resetAddTabFeedback,
  refreshCurrentBookmarksViewAfterIncrementalRemove,
  refreshCurrentBookmarksViewAfterIncrementalCreate,
  refreshCurrentBookmarksViewAfterIncrementalUpdate
};

// Re-exports from rail-interaction.js (Phase D)
export {
  handleDocumentPointerDown,
  handleDocumentPointerMove,
  handleDocumentFocusIn,
  handleDocumentWheel
};
