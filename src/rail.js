// ============================================================
// ui/rail.js — Bookmark tab rail rendering (right sidebar)
// ============================================================
// This is the largest UI module (~3200 lines), handling tab creation,
// layout, scrollbar, drag-and-drop reorder, popup resize, search,
// settings, and all document-level interaction routing for the rail.
//
// Extracted from content.js as the 18th and final module.

import state from './state.js';
import { normalizeText, normalizeInteger, clamp, fingerprintRawText, fingerprintText } from './text.js';
import { storageGet, storageSet, storageRemove } from './storage.js';
import { logWarn } from './log.js';
import { createSvgElement, getScopeRoot, collectAnchorBlocks, getElementText, findMessageContainer } from './dom.js';
import {
  ROOT_ID, TAB_COLORS, COLLAPSED_TAB_HEIGHT, EXPANDED_TAB_SURFACE_HEIGHT,
  COLLAPSED_TAB_VISIBLE_EDGE_WIDTH, ROOT_RIGHT_OFFSET, RAIL_VIEWPORT_DEFAULT_TOP,
  RAIL_VIEWPORT_WIDTH, RAIL_LAYER_LEFT_BLEED, RAIL_LAYER_RIGHT_BLEED,
  TAB_STACK_GAP, TAB_POPUP_OFFSET,
  POPUP_MIN_WIDTH, POPUP_MAX_WIDTH, POPUP_MIN_HEIGHT, POPUP_MAX_HEIGHT,
  RAIL_OPACITY_STORAGE_KEY, RAIL_ENABLED_STORAGE_KEY,
  ADD_TAB_DEFAULT_LABEL, ADD_TAB_SUCCESS_LABEL,
  DEFAULT_RAIL_OPACITY, MIN_RAIL_OPACITY, MAX_RAIL_OPACITY,
  HIGHLIGHT_CLASS, SELECTION_TRIGGER_LABEL
} from './constants.js';
import {
  normalizeUrlKey, normalizeBookmarkList, normalizeColorIndex,
  normalizeBookmarkShardIndexMap, getBookmarkShardUrlHash,
  getBookmarkShardBucketStorageKey, getBookmarkUiStateShardStorageKey,
  getPopupLayoutShardStorageKey, buildBookmarkShardIndexEntry,
  persistBookmarks, refreshCurrentBookmarksView, applyCurrentBookmarks,
  updateBookmarkLabel, handleBookmarkRemove, saveBookmark,
  getCurrentUrlKey, loadBookmarks
} from './bookmarks.js';
import {
  buildKnownBookmarkIdMap, sanitizeBookmarkInteractionId,
  sanitizeBookmarkInteractionIds, normalizeManualOrderBookmarkIds,
  normalizeBookmarkUiStateEntry, normalizeBookmarkUiStateMap,
  hasMeaningfulBookmarkUiStateEntry, buildSingleBookmarkUiStateObject,
  applyCurrentBookmarkUiState, persistBookmarkUiState,
  togglePinnedBookmark, toggleExpandedPinnedBookmark,
  isBookmarkPopupPinned, isBookmarkExpansionPinned,
  deletePopupLayout, normalizePopupLayoutMap, persistPopupLayouts
} from './ui-state.js';
import {
  normalizePopupLayout, getPopupViewportMaxWidth, getPopupContentMaxWidth,
  getClampedPopupWidth, getViewportClampedPopupHeight, getPopupContentMaxHeight,
  getClampedPopupHeight, openSavePopup, closeSavePopup,
  closeBookmarkColorPicker, handleBookmarkColorPickerOpen,
  getDefaultPopupLabel, isBookmarkColorPickerEnabled
} from './popup.js';
import {
  hideSelectionTrigger, scheduleSelectionUiUpdate, startBookmarkFlow,
  handleSelectionTriggerClick, getSelectionElement, isEditableTextSelectionTarget
} from './selection.js';
import {
  isFrameRelayAnchor, requestFrameBookmarkReveal, syncFrameRelayDebugState
} from './bridge.js';
import {
  isClaudeSandboxCardContext, isSandboxCardAnchor,
  rememberClaudeSandboxCardCandidateFromElement,
  collectClaudeSandboxCardCandidates, getClaudeSandboxCardCandidateAtPoint,
  scheduleSandboxCardTriggerRender, renderSandboxCardTriggers,
  isRenderableSandboxCardCandidate, computeSandboxCardTriggerPosition,
  buildClaudeSandboxCardAnchor, captureClaudeSandboxCardAnchor,
  showSandboxCardHighlight, hideSandboxCardHighlight,
  updateSandboxCardHighlightRect, getSandboxCardHighlightElement
} from './sandbox-card.js';
import { resolveBookmarkTarget, buildTargetTextMap, scoreOccurrenceEdge, matchesSelectionContextFingerprint } from './resolve.js';
import {
  scheduleTargetHighlight, clearHighlightState,
  highlightInlineText, scrollResolvedMatchIntoView,
  isTargetComfortablyVisible, resolvePreferredHighlightMatch
} from './highlight.js';
import {
  beginHiddenScrollTransaction, finishHiddenScrollTransaction, forceHideScrollTransaction,
  advanceScrollProgress, getOutputScrollBehavior, waitForNextPaint
} from './scroll.js';
import {
  pushUndoBookmarkHistory, buildBookmarkHistoryEntry,
  canUndoBookmarkHistory, canRedoBookmarkHistory,
  handleUndoBookmarkHistory, handleRedoBookmarkHistory
} from './history.js';
import { formatPopupDisplayText, isCodeAnchor, extractStructuredPopupTextFromRange } from './capture.js';

// ============================================================
// Local constants (rail-specific, not shared via constants.js)
// ============================================================

const COLLAPSED_TAB_LEFT_HOVER_ZONE_WIDTH = 40;
const RAIL_VIEWPORT_CONTROLS_GAP = 8;
const RAIL_VIEWPORT_BOOKMARK_INSET = -28;
const RAIL_VIEWPORT_LEFT_BUFFER = 18;
const RAIL_SCROLLBAR_MIN_THUMB_HEIGHT = 28;
const RAIL_BOTTOM_PADDING = 24;
const TOP_RIGHT_BLOCKER_SAFE_GAP = 12;
const TOP_RIGHT_BLOCKER_MAX_TOP = 240;
const TOP_RIGHT_BLOCKER_MIN_WIDTH = 120;
const TOP_RIGHT_BLOCKER_MIN_HEIGHT = 72;
const TOP_RIGHT_BLOCKER_SELECTOR = [
  "dialog[open]",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[aria-modal='true']",
  "[data-radix-popper-content-wrapper]",
  "[data-radix-dropdown-menu-content]",
  "[data-radix-popover-content]"
].join(", ");
const TAB_POPUP_CLEARANCE = 16;
const HISTORY_CONTROLS_DEFAULT_TOP = 48;
const DISABLED_RAIL_OPACITY = 0;
const BOOKMARK_SEARCH_PLACEHOLDER = "Search this page";

// ============================================================
// Internal helpers (not exported)
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

function normalizeRailOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_RAIL_OPACITY;
  }

  return clamp(numeric, MIN_RAIL_OPACITY, MAX_RAIL_OPACITY);
}

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

function shouldPreferBlockHighlight(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (isSandboxCardAnchor(anchor)) {
    return true;
  }
  if (!anchor || isCodeAnchor(anchor)) {
    return false;
  }

  const structuredDisplayText = formatPopupDisplayText(anchor.selectionDisplayText || "", false);
  if (!structuredDisplayText || structuredDisplayText.indexOf("\n") === -1) {
    return false;
  }

  const normalizedDisplayText = normalizeText(structuredDisplayText);
  const normalizedSelectionText = normalizeText(anchor.selectionText || "");
  if (!normalizedDisplayText) {
    return false;
  }

  return !normalizedSelectionText || normalizedDisplayText === normalizedSelectionText;
}

// ============================================================
// GROUP 1 — Document interaction handlers
// ============================================================

function isResolveFallbackResult(target, bookmark) {
  if (!target || !bookmark || !bookmark.anchor) {
    return false;
  }
  const anchor = bookmark.anchor;
  if (anchor.blockFingerprint) {
    const targetFingerprint = fingerprintText(getElementText(target));
    if (targetFingerprint !== anchor.blockFingerprint) {
      return true;
    }
  }
  return false;
}

function estimateResolveConfidence(target, bookmark) {
  if (!target || !bookmark || !bookmark.anchor) {
    return 0;
  }
  const anchor = bookmark.anchor;
  let score = 0;
  const text = getElementText(target);
  if (anchor.blockFingerprint && fingerprintText(text) === anchor.blockFingerprint) {
    score += 50;
  }
  const selectionText = normalizeText(anchor.selectionText || "");
  if (selectionText && normalizeText(text).toLowerCase().indexOf(selectionText.toLowerCase()) !== -1) {
    score += 40;
  }
  const message = findMessageContainer(target);
  if (message && anchor.messageFingerprint && fingerprintText(getElementText(message)) === anchor.messageFingerprint) {
    score += 20;
  }
  return score;
}

function waitForDomStable(sessionId) {
  return new Promise(function (resolve) {
    const scopeRoot = getScopeRoot();
    if (!scopeRoot) {
      resolve();
      return;
    }

    let debounceTimer = 0;
    let pollTimer = 0;
    let previousBlockCount = collectAnchorBlocks().length;
    let stablePolls = 0;
    const MAX_WAIT = 2000;
    const DEBOUNCE = 150;
    const POLL_INTERVAL = 100;

    function cleanup() {
      if (state.domStableObserver) {
        state.domStableObserver.disconnect();
        state.domStableObserver = null;
      }
      window.clearTimeout(debounceTimer);
      window.clearInterval(pollTimer);
    }

    function settled() {
      cleanup();
      resolve();
    }

    const maxTimer = window.setTimeout(settled, MAX_WAIT);

    const observer = new MutationObserver(function () {
      if (state.navigateSessionId !== sessionId) {
        cleanup();
        window.clearTimeout(maxTimer);
        resolve();
        return;
      }
      window.clearTimeout(debounceTimer);
      stablePolls = 0;
      debounceTimer = window.setTimeout(function () {
        window.clearTimeout(maxTimer);
        settled();
      }, DEBOUNCE);
    });

    observer.observe(scopeRoot, { childList: true, subtree: true });
    state.domStableObserver = observer;

    pollTimer = window.setInterval(function () {
      if (state.navigateSessionId !== sessionId) {
        cleanup();
        window.clearTimeout(maxTimer);
        resolve();
        return;
      }
      const currentCount = collectAnchorBlocks().length;
      if (currentCount === previousBlockCount) {
        stablePolls += 1;
        if (stablePolls >= 2) {
          window.clearTimeout(maxTimer);
          settled();
        }
      } else {
        stablePolls = 0;
        previousBlockCount = currentCount;
      }
    }, POLL_INTERVAL);

    debounceTimer = window.setTimeout(function () {
      window.clearTimeout(maxTimer);
      settled();
    }, DEBOUNCE);
  });
}

async function handleBookmarkClick(bookmarkId) {
  if (releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId)) {
    syncExpandedBookmarkState();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });

  if (!bookmark) {
    return;
  }

  await beginHiddenScrollTransaction();

  if (isFrameRelayAnchor(bookmark.anchor)) {
    pulseTab(bookmarkId);
    if (requestFrameBookmarkReveal(bookmark.anchor)) {
      window.setTimeout(finishHiddenScrollTransaction, 180);
    } else {
      finishHiddenScrollTransaction();
    }
    return;
  }

  const sessionId = ++state.navigateSessionId;

  let target = resolveBookmarkTarget(bookmark);
  const preferBlockHighlight = shouldPreferBlockHighlight(bookmark);
  if (!target) {
    pulseTab(bookmarkId);
    finishHiddenScrollTransaction();
    return;
  }

  // 2-pass: if resolve used fallback, attempt re-resolve after DOM stabilization
  const isFallbackResult = isResolveFallbackResult(target, bookmark);
  if (isFallbackResult) {
    const fallbackTarget = target;
    target.scrollIntoView({
      behavior: getOutputScrollBehavior("auto"),
      block: "center",
      inline: "nearest"
    });
    await waitForDomStable(sessionId);
    if (state.navigateSessionId !== sessionId) return;

    const reResolvedTarget = resolveBookmarkTarget(bookmark);
    if (reResolvedTarget && reResolvedTarget !== fallbackTarget) {
      const reResolvedScore = estimateResolveConfidence(reResolvedTarget, bookmark);
      if (reResolvedScore >= 80) {
        target = reResolvedTarget;
      }
    }
  }

  if (state.navigateSessionId !== sessionId) return;

  const preferredMatch = preferBlockHighlight ? null : resolvePreferredHighlightMatch(target, bookmark);
  pulseTab(bookmarkId);
  if (preferredMatch) {
    const preferredScroll = scrollResolvedMatchIntoView(preferredMatch);
    if (preferredScroll.didScroll) {
      scheduleTargetHighlight(target, bookmark, {
        precomputedMatch: preferredMatch,
        preferBlockHighlight: preferBlockHighlight
      });
      return;
    }

    target.scrollIntoView({
      behavior: getOutputScrollBehavior("smooth"),
      block: "center",
      inline: "nearest"
    });
    scheduleTargetHighlight(target, bookmark, {
      precomputedMatch: preferredMatch,
      preferBlockHighlight: preferBlockHighlight
    });
    return;
  }

  if (isTargetComfortablyVisible(target)) {
    scheduleTargetHighlight(target, bookmark, {
      immediate: true,
      preferBlockHighlight: preferBlockHighlight
    });
    return;
  }

  target.scrollIntoView({
    behavior: getOutputScrollBehavior("smooth"),
    block: "center",
    inline: "nearest"
  });
  scheduleTargetHighlight(target, bookmark, {
    preferBlockHighlight: preferBlockHighlight
  });
}

function handleBookmarkEdit(bookmarkId, event) {
  if (releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId)) {
    syncExpandedBookmarkState();
  }

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });
  if (!bookmark) {
    return;
  }

  const popupPosition = event && event.currentTarget
    ? getEditPopupPositionForTab(
      event.currentTarget.closest ? event.currentTarget.closest(".cgptbm-tab") : null
    )
    : null;

  openSavePopup(bookmark.anchor, popupPosition, {
    bookmarkId: bookmark.id,
    initialValue: bookmark.label || bookmark.snippet || getDefaultPopupLabel(bookmark.anchor),
    colorIndex: bookmark.colorIndex
  });
}

export function handleDocumentPointerDown(event) {
  if (state.bookmarkDragSession && event && event.pointerId !== state.bookmarkDragSession.pointerId) {
    clearBookmarkDragSession();
  }

  rememberClaudeSandboxCardCandidateFromElement(event ? event.target : null);
  maybeReleaseResizeLockedExpandedBookmark(event ? event.target : null);

  const target = event.target;

  if (state.colorPicker) {
    const ownerTab = state.colorPickerBookmarkId && state.layer
      ? state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + state.colorPickerBookmarkId + '"]')
      : null;
    const insideColorPicker = Boolean(target && state.colorPicker.contains(target));
    const insideOwnerTab = Boolean(target && ownerTab && ownerTab.contains(target));
    if (!insideColorPicker && !insideOwnerTab) {
      closeBookmarkColorPicker();
    }
  }

  if (state.popup) {
    if (state.popup.contains(target)) {
      return;
    }
    if (state.addTab && state.addTab.contains(target)) {
      return;
    }

    closeSavePopup();
  }
}

export function handleDocumentPointerMove(event) {
  if (handleBookmarkDragPointerMove(event)) {
    return;
  }

  if (!isClaudeSandboxCardContext()) {
    return;
  }

  const target = event ? event.target : null;
  if (target && state.root && state.root.contains(target)) {
    return;
  }

  const candidate = getClaudeSandboxCardCandidateAtPoint(
    event ? event.clientX : NaN,
    event ? event.clientY : NaN
  );
  const nextKey = candidate ? candidate.key : "";
  if (nextKey === state.hoveredSandboxCardKey) {
    return;
  }

  state.hoveredSandboxCardKey = nextKey;
  scheduleSandboxCardTriggerRender();
}

export function handleDocumentFocusIn(event) {
  const target = event ? event.target : null;
  rememberClaudeSandboxCardCandidateFromElement(target);
  if (isEditableTextSelectionTarget(target)) {
    hideSelectionTrigger();
  }
}

export function handleDocumentWheel(event) {
  if (!state.railEnabled || !state.railViewport) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target && (
    target.closest(".cgptbm-history-controls") ||
    target.closest(".cgptbm-popup") ||
    target.closest(".cgptbm-tab__popup-body") ||
    target.closest(".cgptbm-selection-trigger") ||
    target.closest(".cgptbm-sandbox-card-trigger")
  )) {
    return;
  }

  if (!isPointInsideRailViewport(event.clientX, event.clientY)) {
    return;
  }

  handleRailViewportWheel(event);
}

function isPointInsideRailViewport(clientX, clientY) {
  if (!state.railViewport) {
    return false;
  }

  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return false;
  }

  const rect = state.railViewport.getBoundingClientRect();
  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

// ============================================================
// GROUP 2 — Popup positioning
// ============================================================

export function getPopupPositionForRect(rect) {
  const popupWidth = 228;
  const popupHeight = 56;
  const gap = 8;
  const viewportGap = 8;

  if (!rect) {
    return null;
  }

  const top = clamp(rect.top, viewportGap, window.innerHeight - popupHeight - viewportGap);
  const left = clamp(rect.left - popupWidth - gap, viewportGap, window.innerWidth - popupWidth - viewportGap);

  return {
    top: Math.round(top),
    left: Math.round(left)
  };
}

export function getEditPopupPositionForTab(tab) {
  const popupWidth = 169;
  const popupHeight = 46;
  const gap = 8;
  const viewportGap = 8;

  if (!(tab instanceof HTMLElement)) {
    return null;
  }

  const tabRect = tab.getBoundingClientRect();
  const edge = tab.querySelector(".cgptbm-tab__edge");
  const edgeRect = edge ? edge.getBoundingClientRect() : tabRect;
  const top = clamp(
    tabRect.top + Math.round((tabRect.height - popupHeight) / 2),
    viewportGap,
    window.innerHeight - popupHeight - viewportGap
  );
  const left = clamp(
    edgeRect.left - popupWidth - gap,
    viewportGap,
    window.innerWidth - popupWidth - viewportGap
  );

  return {
    top: Math.round(top),
    left: Math.round(left)
  };
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

  if (!state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]')) {
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

  const removedTab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]');
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
  state.expandedBookmarkId = getExpandedBookmarkId();

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
  syncRenderedBookmarkInteractionVisuals();
  syncRenderedBookmarkEdgeText(visibleBookmarks);
  syncRenderedPinActions();
  syncRenderedActiveBookmarkState();
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

  applyCurrentBookmarks();
  const visibleBookmarks = getFilteredCurrentBookmarks();
  const bookmarkIndex = visibleBookmarks.findIndex(function (bookmark) {
    return bookmark && bookmark.id === bookmarkId;
  });
  if (bookmarkIndex < 0) {
    return false;
  }

  const existingTab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]');
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
    state.expandedBookmarkId = getExpandedBookmarkId();
    if (!syncAnchoredRenderedBookmarkTailLayout(visibleBookmarks, layoutByBookmarkId, bookmarkIndex, {
      expandedBookmarkId: state.expandedBookmarkId
    })) {
      return false;
    }
    syncRenderedBookmarkInteractionVisuals();
    syncRenderedBookmarkEdgeText(visibleBookmarks);
    syncRenderedActiveBookmarkState();
    syncBookmarkHistoryControlsToCurrentRail();
    syncRailViewportOverflow();
    syncRailViewportWidth();
    scheduleSandboxCardTriggerRender();
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

  return Boolean(state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]'));
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
  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]');
  if (!updatedBookmark || !tab) {
    return false;
  }

  state.expandedBookmarkId = getExpandedBookmarkId();
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

  syncRenderedBookmarkInteractionVisuals();
  syncRenderedBookmarkEdgeText(visibleBookmarks);
  syncRailViewportOverflow();
  syncRailViewportWidth();
  return true;
}

// ============================================================
// GROUP 4 — Tab layout
// ============================================================

function buildRenderedTabLayoutSnapshot(bookmarks, excludedBookmarkId) {
  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const tabs = getOrderedBookmarkTabs();
  if (!orderedBookmarks.length || !tabs.length) {
    return null;
  }

  const tabById = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  const layoutByBookmarkId = {};
  for (let index = 0; index < orderedBookmarks.length; index += 1) {
    const bookmark = orderedBookmarks[index];
    const bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    if (!bookmarkId || bookmarkId === excludedBookmarkId) {
      continue;
    }

    const tab = tabById[bookmarkId];
    if (!tab) {
      return null;
    }

    layoutByBookmarkId[bookmarkId] = measureRenderedTabLayout(tab);
  }

  return layoutByBookmarkId;
}

function syncPositionedRenderedBookmarkTabs(positionedBookmarks, layoutByBookmarkId, expandedBookmarkId) {
  if (!state.layer) {
    return;
  }

  const entries = Array.isArray(positionedBookmarks) ? positionedBookmarks : [];
  const layoutMap = layoutByBookmarkId && typeof layoutByBookmarkId === "object" ? layoutByBookmarkId : {};
  const tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return;
  }

  const tabById = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  entries.forEach(function (entry, index) {
    const bookmarkId = entry && entry.bookmark && entry.bookmark.id ? entry.bookmark.id : "";
    const tab = bookmarkId ? tabById[bookmarkId] : null;
    const layout = bookmarkId ? layoutMap[bookmarkId] : null;
    if (!tab || !layout) {
      return;
    }

    applyMeasuredTabLayout(tab, entry.top, layout);
    if (bookmarkId === expandedBookmarkId) {
      tab.style.zIndex = String(tabs.length + 2);
    } else {
      tab.style.zIndex = String(Math.max(1, tabs.length - index));
    }
  });
}

function syncRenderedBookmarkTabStackOrder(bookmarks, expandedBookmarkId) {
  if (!state.layer) {
    return;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return;
  }

  const tabById = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  orderedBookmarks.forEach(function (bookmark, index) {
    const bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    const tab = bookmarkId ? tabById[bookmarkId] : null;
    if (!tab) {
      return;
    }

    if (bookmarkId === expandedBookmarkId) {
      tab.style.zIndex = String(tabs.length + 2);
    } else {
      tab.style.zIndex = String(Math.max(1, tabs.length - index));
    }
  });
}

function syncAnchoredRenderedBookmarkTailLayout(bookmarks, layoutByBookmarkId, startIndex, options) {
  if (!state.layer) {
    return false;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const layoutMap = layoutByBookmarkId && typeof layoutByBookmarkId === "object" ? layoutByBookmarkId : {};
  if (!orderedBookmarks.length) {
    return false;
  }

  const tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return false;
  }

  const boundedStartIndex = clamp(
    Number.isInteger(startIndex) ? startIndex : 0,
    0,
    orderedBookmarks.length
  );
  const expandedBookmarkId = options && options.expandedBookmarkId ? options.expandedBookmarkId : "";
  const tabById = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  let cursorTop = getBookmarkTabTopLimit();
  if (boundedStartIndex > 0) {
    const predecessor = orderedBookmarks[boundedStartIndex - 1];
    const predecessorBookmarkId = predecessor && predecessor.id ? predecessor.id : "";
    const predecessorTab = predecessorBookmarkId ? tabById[predecessorBookmarkId] : null;
    const predecessorLayout = predecessorBookmarkId ? layoutMap[predecessorBookmarkId] : null;
    if (!predecessorTab || !predecessorLayout) {
      return false;
    }

    const predecessorTop = Number.parseFloat(predecessorTab.style.top);
    const nextPredecessorTop = Number.isFinite(predecessorTop) ? predecessorTop : getBookmarkTabTopLimit();
    applyMeasuredTabLayout(predecessorTab, nextPredecessorTop, predecessorLayout);
    cursorTop = nextPredecessorTop + predecessorLayout.totalHeight + TAB_STACK_GAP;
  }

  for (let index = boundedStartIndex; index < orderedBookmarks.length; index += 1) {
    const bookmark = orderedBookmarks[index];
    const bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    const tab = bookmarkId ? tabById[bookmarkId] : null;
    const layout = bookmarkId ? layoutMap[bookmarkId] : null;
    if (!tab || !layout) {
      return false;
    }

    applyMeasuredTabLayout(tab, cursorTop, layout);
    cursorTop += layout.totalHeight + TAB_STACK_GAP;
  }

  syncRenderedBookmarkTabStackOrder(orderedBookmarks, expandedBookmarkId);
  return true;
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

  reconcileRenderedBookmarkInteractionState();
}

function isBookmarkCreateInteractionGuardActive() {
  return state.bookmarkCreateInteractionGuardCount > 0;
}

// ============================================================
// GROUP 5 — Interaction reconciliation
// ============================================================

function reconcileRenderedBookmarkInteractionState() {
  if (!state.layer) {
    return;
  }

  const nextHoveredBookmarkId = getRenderedHoveredBookmarkId();
  const nextFocusedBookmarkId = getRenderedFocusedBookmarkId();
  const nextExpandedBookmarkId =
    state.colorPickerLockedBookmarkId ||
    state.editLockedBookmarkId ||
    state.resizeLockedExpandedBookmarkId ||
    nextFocusedBookmarkId ||
    nextHoveredBookmarkId ||
    "";

  const hasChanged =
    state.hoveredBookmarkId !== nextHoveredBookmarkId ||
    state.focusedBookmarkId !== nextFocusedBookmarkId ||
    state.expandedBookmarkId !== nextExpandedBookmarkId;

  state.hoveredBookmarkId = nextHoveredBookmarkId;
  state.focusedBookmarkId = nextFocusedBookmarkId;
  state.expandedBookmarkId = nextExpandedBookmarkId;

  if (hasChanged) {
    syncRenderedBookmarkRail({ lightweight: true });
  }
}

function getRenderedHoveredBookmarkId() {
  const tabs = getOrderedBookmarkTabs();
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (tab && typeof tab.matches === "function" && tab.matches(":hover")) {
      return tab.dataset.bookmarkId || "";
    }
  }

  return "";
}

function getRenderedFocusedBookmarkId() {
  const tabs = getOrderedBookmarkTabs();
  const activeElement = document.activeElement;
  if (!activeElement) {
    return "";
  }

  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (tab && tab.contains(activeElement)) {
      return tab.dataset.bookmarkId || "";
    }
  }

  return "";
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

// ============================================================
// GROUP 7 — Search UI
// ============================================================

function createBookmarkHistoryIcon(direction) {
  const icon = document.createElement("span");
  icon.className = "cgptbm-history-controls__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = direction === "redo" ? "\u21BB" : "\u21BA";
  return icon;
}

function createBookmarkSearchRow() {
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
  input.setAttribute("aria-label", "Search current page bookmarks");
  input.addEventListener("input", handleBookmarkSearchInput);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "cgptbm-history-controls__search-clear";
  clearButton.textContent = "x";
  clearButton.title = "Clear bookmark search";
  clearButton.setAttribute("aria-label", "Clear bookmark search");
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
  searchRow.appendChild(status);

  state.searchInput = input;
  state.searchClearButton = clearButton;
  state.searchStatus = status;

  return searchRow;
}

function ensureBookmarkSearchControls(controls) {
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

function syncBookmarkSearchControls() {
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
      ? BOOKMARK_SEARCH_PLACEHOLDER
      : "No bookmarks yet";
  }

  if (clearButton) {
    clearButton.hidden = !hasQuery;
    clearButton.disabled = !hasQuery;
  }

  if (searchStatus) {
    const statusText = getBookmarkSearchStatusText({
      hasBookmarks: hasBookmarks,
      hasQuery: hasQuery,
      filteredCount: filteredCount,
      totalCount: state.currentBookmarks.length
    });
    searchStatus.textContent = statusText;
    searchStatus.hidden = !statusText;
    searchStatus.title = statusText
      ? getBookmarkSearchStatusTitle({
        hasQuery: hasQuery,
        filteredCount: filteredCount,
        totalCount: state.currentBookmarks.length
      })
      : "";
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
    return totalCount === 1 ? "1 saved" : totalCount + " saved";
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
      ? "1 bookmark is saved on this page."
      : totalCount + " bookmarks are saved on this page.";
  }

  return filteredCount === 1
    ? "1 of " + totalCount + " saved bookmarks matches this search."
    : filteredCount + " of " + totalCount + " saved bookmarks match this search.";
}

export function setBookmarkSearchQuery(value) {
  const nextQuery = normalizeText(value);
  if (state.bookmarkSearchQuery === nextQuery) {
    syncBookmarkSearchControls();
    return;
  }

  state.bookmarkSearchQuery = nextQuery;
  closeBookmarkColorPicker();
  closeSavePopup();
  state.hoveredBookmarkId = "";
  state.focusedBookmarkId = "";
  state.expandedBookmarkId = getExpandedBookmarkId();
  renderBookmarks();
}

function handleBookmarkSearchInput(event) {
  const target = event && event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  setBookmarkSearchQuery(target.value);
}

function handleBookmarkSearchClear(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  setBookmarkSearchQuery("");
  if (state.searchInput) {
    state.searchInput.focus();
  }
}

function createBookmarkHistoryControls() {
  const controls = document.createElement("div");
  controls.className = "cgptbm-history-controls";

  const topRow = document.createElement("div");
  topRow.className = "cgptbm-history-controls__row";

  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "cgptbm-history-controls__button";
  undoButton.dataset.historyAction = "undo";
  undoButton.title = "Undo bookmark add or remove";
  undoButton.setAttribute("aria-label", "Undo bookmark add or remove");
  undoButton.onmousedown = preventFocusSteal;
  undoButton.onclick = handleUndoBookmarkHistory;
  undoButton.appendChild(createBookmarkHistoryIcon("undo"));

  const redoButton = document.createElement("button");
  redoButton.type = "button";
  redoButton.className = "cgptbm-history-controls__button";
  redoButton.dataset.historyAction = "redo";
  redoButton.title = "Redo bookmark add or remove";
  redoButton.setAttribute("aria-label", "Redo bookmark add or remove");
  redoButton.onmousedown = preventFocusSteal;
  redoButton.onclick = handleRedoBookmarkHistory;
  redoButton.appendChild(createBookmarkHistoryIcon("redo"));

  const sliderRow = document.createElement("div");
  sliderRow.className = "cgptbm-history-controls__slider-row";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "cgptbm-history-controls__toggle";
  toggleButton.title = "Disable bookmark rail";
  toggleButton.setAttribute("aria-label", "Disable bookmark rail");
  toggleButton.onmousedown = preventFocusSteal;
  toggleButton.onclick = handleRailEnabledToggle;
  const toggleIcon = document.createElement("span");
  toggleIcon.className = "cgptbm-history-controls__toggle-icon";
  toggleIcon.setAttribute("aria-hidden", "true");
  toggleIcon.textContent = "\u23FB";
  toggleButton.appendChild(toggleIcon);
  sliderRow.appendChild(toggleButton);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "cgptbm-history-controls__slider";
  slider.min = String(Math.round(MIN_RAIL_OPACITY * 100));
  slider.max = String(Math.round(MAX_RAIL_OPACITY * 100));
  slider.step = "5";
  slider.value = String(Math.round(normalizeRailOpacity(state.railOpacity) * 100));
  slider.title = "Adjust bookmark rail opacity";
  slider.setAttribute("aria-label", "Adjust bookmark rail opacity");
  slider.oninput = handleRailOpacitySliderInput;
  slider.onchange = handleRailOpacitySliderCommit;
  sliderRow.appendChild(slider);
  controls.appendChild(sliderRow);

  topRow.appendChild(undoButton);
  topRow.appendChild(redoButton);
  controls.appendChild(topRow);
  controls.appendChild(createBookmarkSearchRow());

  return controls;
}

function syncBookmarkHistoryControls(top) {
  if (!state.root) {
    return;
  }

  let controls = state.root.querySelector(".cgptbm-history-controls");
  if (!controls) {
    controls = createBookmarkHistoryControls();
    state.root.appendChild(controls);
  }
  ensureBookmarkSearchControls(controls);

  const nextTop = Number.isFinite(top)
    ? Math.max(18, Math.round(top))
    : HISTORY_CONTROLS_DEFAULT_TOP;
  controls.style.top = nextTop + "px";
  controls.style.right = COLLAPSED_TAB_VISIBLE_EDGE_WIDTH + "px";
  syncRailViewportTop();

  const undoButton = controls.querySelector('[data-history-action="undo"]');
  const redoButton = controls.querySelector('[data-history-action="redo"]');
  const slider = controls.querySelector(".cgptbm-history-controls__slider");
  const toggleButton = controls.querySelector(".cgptbm-history-controls__toggle");
  const canUndo = state.railEnabled && canUndoBookmarkHistory();
  const canRedo = state.railEnabled && canRedoBookmarkHistory();

  if (undoButton) {
    undoButton.disabled = !canUndo;
    undoButton.classList.toggle("is-enabled", canUndo);
  }
  if (redoButton) {
    redoButton.disabled = !canRedo;
    redoButton.classList.toggle("is-enabled", canRedo);
  }
  if (slider) {
    slider.disabled = !state.railEnabled;
    slider.value = String(Math.round(normalizeRailOpacity(state.railOpacity) * 100));
    syncRailOpacitySliderVisual(slider);
  }
  if (toggleButton) {
    toggleButton.classList.toggle("is-enabled", state.railEnabled);
    toggleButton.title = state.railEnabled ? "Disable bookmark rail" : "Enable bookmark rail";
    toggleButton.setAttribute("aria-label", state.railEnabled ? "Disable bookmark rail" : "Enable bookmark rail");
  }
  syncBookmarkSearchControls();
}

// ============================================================
// GROUP 8 — Rail settings
// ============================================================

function handleRailOpacitySliderInput(event) {
  const target = event && event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  syncRailOpacitySliderVisual(target);
  state.railOpacity = normalizeRailOpacity(Number(target.value) / 100);
  applyRailOpacity();
}

async function handleRailOpacitySliderCommit(event) {
  const target = event && event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  syncRailOpacitySliderVisual(target);
  const nextOpacity = normalizeRailOpacity(Number(target.value) / 100);
  state.railOpacity = nextOpacity;
  applyRailOpacity();
  const payload = {};
  payload[RAIL_OPACITY_STORAGE_KEY] = nextOpacity;
  await storageSet(payload);
}

async function handleRailEnabledToggle(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  state.railEnabled = !state.railEnabled;
  applyRailOpacity();
  syncBookmarkHistoryControlsToCurrentRail();
  if (state.railEnabled) {
    scheduleSelectionUiUpdate();
  } else {
    hideSelectionTrigger();
  }
  const payload = {};
  payload[RAIL_ENABLED_STORAGE_KEY] = state.railEnabled;
  await storageSet(payload);
}

function syncRailOpacitySliderVisual(slider) {
  if (!(slider instanceof HTMLInputElement)) {
    return;
  }

  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const value = Number(slider.value || min);
  const range = Math.max(1, max - min);
  const progress = clamp(((value - min) / range) * 100, 0, 100);
  slider.style.setProperty("--cgptbm-slider-progress", progress.toFixed(3) + "%");
}

export function applyRailOpacity() {
  if (!state.root) {
    return;
  }

  const nextOpacity = state.railEnabled
    ? normalizeRailOpacity(state.railOpacity)
    : DISABLED_RAIL_OPACITY;
  state.root.style.setProperty("--cgptbm-rail-opacity", String(nextOpacity));
  state.root.classList.toggle("is-rail-disabled", !state.railEnabled);
  if (!state.railEnabled) {
    deactivateRailUiInteractions();
  }
}

export function deactivateRailUiInteractions() {
  clearBookmarkDragSession();
  forceHideScrollTransaction();
  endPopupResizeSession();
  hideSelectionTrigger();
  closeSavePopup();
  closeBookmarkColorPicker();
  resetAddTabFeedback();
  state.hoveredSandboxCardKey = "";
  hideSandboxCardHighlight({ immediate: true });
  scheduleSandboxCardTriggerRender();
}

// ============================================================
// GROUP 9 — Rail viewport
// ============================================================

function syncRailViewportTop() {
  if (!state.root) {
    return;
  }

  const controls = state.root.querySelector(".cgptbm-history-controls");

  if (!(controls instanceof HTMLElement)) {
    state.root.style.setProperty("--cgptbm-rail-viewport-top", RAIL_VIEWPORT_DEFAULT_TOP + "px");
    return;
  }

  const controlsTop = Number.parseFloat(controls.style.top);
  const controlsBottom = (Number.isFinite(controlsTop) ? controlsTop : getHistoryControlsTop()) + controls.offsetHeight;
  const nextViewportTop = Math.max(0, Math.ceil(controlsBottom + RAIL_VIEWPORT_CONTROLS_GAP));
  state.root.style.setProperty("--cgptbm-rail-viewport-top", nextViewportTop + "px");
}

export function syncRailViewportWidth(options) {
  if (!state.root || !state.layer) {
    return;
  }

  const nextOptions = options || {};
  if (state.popupResizeSession && !nextOptions.force) {
    return;
  }

  const widestVisiblePopup = Array.from(state.layer.querySelectorAll(".cgptbm-tab__popup")).reduce(function (maxWidth, popup) {
    return Math.max(maxWidth, Math.ceil(popup.offsetWidth || 0));
  }, 0);

  const widestExpandedTab = Array.from(state.layer.querySelectorAll(".cgptbm-tab.is-expanded .cgptbm-tab__surface-clip")).reduce(function (maxWidth, clip) {
    return Math.max(maxWidth, Math.ceil(clip.getBoundingClientRect().width || 0));
  }, 0);

  const nextWidth = Math.max(
    COLLAPSED_TAB_VISIBLE_EDGE_WIDTH,
    widestExpandedTab ? widestExpandedTab + RAIL_VIEWPORT_LEFT_BUFFER : 0,
    widestVisiblePopup ? widestVisiblePopup + RAIL_VIEWPORT_LEFT_BUFFER : 0
  );

  state.root.style.setProperty("--cgptbm-rail-viewport-width", nextWidth + "px");
  state.root.style.setProperty("--cgptbm-rail-scroll-hitbox-width", nextWidth + "px");
}

export function bindTopRightUiProtectionObserver() {
  if (state.topRightUiObserver || !document.body) {
    return;
  }

  const observer = new MutationObserver(function () {
    scheduleTopRightUiProtectionRefresh();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "open", "aria-hidden", "aria-expanded", "data-state"]
  });
  state.topRightUiObserver = observer;
}

export function scheduleTopRightUiProtectionRefresh() {
  if (state.topRightUiRefreshFrame) {
    return;
  }

  state.topRightUiRefreshFrame = window.requestAnimationFrame(function () {
    state.topRightUiRefreshFrame = 0;
    syncTopRightUiProtection();
  });
}

function syncTopRightUiProtection() {
  if (!state.root) {
    return;
  }

  const blockerRect = getTopRightBlockerRect();
  const nextRightOffset = blockerRect
    ? Math.max(ROOT_RIGHT_OFFSET, Math.ceil(window.innerWidth - blockerRect.left + TOP_RIGHT_BLOCKER_SAFE_GAP))
    : ROOT_RIGHT_OFFSET;
  state.root.style.setProperty("--cgptbm-root-right", nextRightOffset + "px");
}

function getTopRightBlockerRect() {
  const candidates = Array.from(document.querySelectorAll(TOP_RIGHT_BLOCKER_SELECTOR));
  let bestRect = null;
  let bestArea = 0;

  candidates.forEach(function (candidate) {
    if (!(candidate instanceof HTMLElement)) {
      return;
    }
    if (state.root && state.root.contains(candidate)) {
      return;
    }

    const style = window.getComputedStyle(candidate);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0.01
    ) {
      return;
    }

    if (!["fixed", "absolute", "sticky"].includes(style.position)) {
      return;
    }

    const rect = candidate.getBoundingClientRect();
    if (
      rect.width < TOP_RIGHT_BLOCKER_MIN_WIDTH ||
      rect.height < TOP_RIGHT_BLOCKER_MIN_HEIGHT ||
      rect.top > TOP_RIGHT_BLOCKER_MAX_TOP ||
      rect.right < window.innerWidth - 24 ||
      rect.bottom <= 0
    ) {
      return;
    }

    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      bestRect = rect;
    }
  });

  return bestRect;
}

export function syncBookmarkHistoryControlsToCurrentRail() {
  syncBookmarkHistoryControls(getHistoryControlsTop());
}

function getHistoryControlsTop() {
  return HISTORY_CONTROLS_DEFAULT_TOP;
}

export function getRailViewportTop() {
  if (!state.root) {
    return RAIL_VIEWPORT_DEFAULT_TOP;
  }

  const value = Number.parseFloat(state.root.style.getPropertyValue("--cgptbm-rail-viewport-top"));
  return Number.isFinite(value) ? value : RAIL_VIEWPORT_DEFAULT_TOP;
}

export function getBookmarkTabTopLimit() {
  return Math.max(0, Math.ceil(getRailViewportTop() + RAIL_VIEWPORT_BOOKMARK_INSET));
}

// ============================================================
// GROUP 10 — Rendering
// ============================================================

export function renderBookmarks() {
  if (!state.layer) {
    return;
  }

  clearBookmarkDragSession({ skipLayoutReset: true });
  const visibleBookmarks = getFilteredCurrentBookmarks();
  syncBookmarkHistoryControls(getHistoryControlsTop());

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
      label: "No bookmarks yet",
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

  const positionedBookmarks = computeTabPositions(visibleBookmarks);
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
  const color = TAB_COLORS[bookmark.colorIndex % TAB_COLORS.length];
  const hasPinnedPopup = isBookmarkPopupPinned(bookmark.id);
  const hasPinnedExpansion = isBookmarkExpansionPinned(bookmark.id);
  const tab = createTabElement({
    label: bookmark.label || "Bookmark",
    popupText: hasPinnedPopup ? getBookmarkPopupText(bookmark) : "",
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
          handleBookmarkEdit(bookmark.id, event);
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

  const button = tab.querySelector(".cgptbm-tab__button");
  const collapsedHoverZone = tab.querySelector(".cgptbm-tab__collapsed-hover-zone");
  const surface = tab.querySelector(".cgptbm-tab__surface");
  const edge = tab.querySelector(".cgptbm-tab__edge");
  button.addEventListener("mousedown", preventFocusSteal);
  button.addEventListener("click", function (event) {
    if (consumeBookmarkDragSuppressedClick(bookmark.id)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handleBookmarkClick(bookmark.id);
  });
  button.addEventListener("contextmenu", function (event) {
    event.preventDefault();
    handleBookmarkRemove(bookmark.id);
  });
  if (surface) {
    surface.addEventListener("pointerdown", function (event) {
      handleBookmarkTabPointerDown(bookmark.id, event);
    });
    surface.addEventListener("pointerenter", function () {
      setHoveredBookmark(bookmark.id);
    });
    surface.addEventListener("pointerleave", function (event) {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget && tab.contains(relatedTarget)) {
        return;
      }
      clearHoveredBookmark(bookmark.id);
    });
  }
  if (collapsedHoverZone) {
    collapsedHoverZone.addEventListener("pointerenter", function () {
      if (isBookmarkExpanded(bookmark.id)) {
        return;
      }
      setHoveredBookmark(bookmark.id);
    });
  }
  const rightActionDock = tab.querySelector(".cgptbm-tab__actions--right");
  if (rightActionDock) {
    rightActionDock.addEventListener("pointerenter", function () {
      if (!isBookmarkExpanded(bookmark.id)) {
        return;
      }
      setHoveredBookmark(bookmark.id);
    });
  }
  tab.addEventListener("pointerenter", function () {
    if (!isBookmarkExpanded(bookmark.id)) {
      return;
    }
    setHoveredBookmark(bookmark.id);
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
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && tab.contains(relatedTarget)) {
      return;
    }
    clearHoveredBookmark(bookmark.id);
  });
  tab.addEventListener("focusin", function () {
    setFocusedBookmark(bookmark.id);
  });
  tab.addEventListener("focusout", function (event) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && tab.contains(relatedTarget)) {
      return;
    }
    clearFocusedBookmark(bookmark.id);
  });

  return tab;
}

function syncRenderedColorPickerEdges() {
  if (!state.layer) {
    return;
  }

  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    const edge = tab.querySelector(".cgptbm-tab__edge");
    if (!edge) {
      return;
    }

    const isEnabled = isBookmarkColorPickerEnabled(bookmarkId);
    edge.classList.toggle("is-color-picker-enabled", isEnabled);
    edge.classList.toggle("is-color-picker-disabled", !isEnabled);
    edge.tabIndex = isEnabled ? 0 : -1;
    edge.title = isEnabled ? "Change bookmark color" : "";
    edge.setAttribute("aria-disabled", isEnabled ? "false" : "true");
  });
}

export function computeTabPositions(bookmarks, options) {
  const nextOptions = options || {};
  const topLimit = getBookmarkTabTopLimit();
  const expandedBookmarkId = nextOptions.expandedBookmarkId || "";
  const heightByBookmarkId = nextOptions.heightByBookmarkId && typeof nextOptions.heightByBookmarkId === "object"
    ? nextOptions.heightByBookmarkId
    : null;
  const expandedHeight = Number.isFinite(nextOptions.expandedHeight)
    ? Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(nextOptions.expandedHeight))
    : COLLAPSED_TAB_HEIGHT;
  const previewGapIndex = Number.isInteger(nextOptions.previewGapIndex)
    ? clamp(nextOptions.previewGapIndex, 0, Array.isArray(bookmarks) ? bookmarks.length : 0)
    : -1;
  const previewGapHeight = Number.isFinite(nextOptions.previewGapHeight)
    ? Math.max(0, Math.ceil(nextOptions.previewGapHeight))
    : 0;
  const sorted = bookmarks.map(function (bookmark) {
    return {
      bookmark: bookmark
    };
  });

  const positioned = sorted.map(function (entry) {
    const measuredHeight = heightByBookmarkId ? heightByBookmarkId[entry.bookmark.id] : NaN;
    const height = Number.isFinite(measuredHeight)
      ? Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(measuredHeight))
      : entry.bookmark.id === expandedBookmarkId
        ? expandedHeight
        : COLLAPSED_TAB_HEIGHT;
    return {
      bookmark: entry.bookmark,
      height: height,
      top: topLimit
    };
  });
  let cursorTop = topLimit;
  positioned.forEach(function (entry, index) {
    if (previewGapIndex === index) {
      cursorTop += previewGapHeight;
    }
    entry.top = cursorTop;
    cursorTop += entry.height + TAB_STACK_GAP;
  });

  return positioned.map(function (entry) {
    return {
      bookmark: entry.bookmark,
      top: Math.round(entry.top),
      height: Math.round(entry.height)
    };
  });
}

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
      state.expandedBookmarkId = getExpandedBookmarkId();
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
  state.expandedBookmarkId = getExpandedBookmarkId();

  const bookmarkById = {};
  state.currentBookmarks.forEach(function (bookmark) {
    bookmarkById[bookmark.id] = bookmark;
  });

  syncRenderedBookmarkInteractionVisuals(tabs);

  if (!isLightweight) {
    syncRenderedPinnedPopups(tabById, bookmarkById);
  }

  const heightByBookmarkId = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId) {
      return;
    }

    const layout = measureRenderedTabLayout(tab, { lightweight: isLightweight });
    heightByBookmarkId[bookmarkId] = layout.totalHeight;
    tab.style.setProperty("--cgptbm-surface-height", layout.surfaceHeight + "px");
  });

  const positionedBookmarks = computeTabPositions(getFilteredCurrentBookmarks(), {
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
    syncRenderedPinActions();
  }

  if (state.bookmarkDragSession && state.bookmarkDragSession.activated) {
    syncBookmarkDragSessionVisual(state.bookmarkDragSession);
  }
}

function measureRenderedTabLayout(tab, options) {
  if (!tab) {
    return {
      surfaceHeight: COLLAPSED_TAB_HEIGHT,
      popupHeight: 0,
      totalHeight: COLLAPSED_TAB_HEIGHT
    };
  }

  const nextOptions = options || {};
  const button = tab.querySelector(".cgptbm-tab__button");
  const content = tab.querySelector(".cgptbm-tab__content");
  const actionGroups = Array.from(tab.querySelectorAll(".cgptbm-tab__actions"));
  const isExpanded = tab.classList.contains("is-expanded");
  const popup = tab.querySelector(".cgptbm-tab__popup");
  const popupHeight = popup ? Math.max(0, Math.ceil(popup.offsetHeight)) : 0;
  if (nextOptions.lightweight) {
    const surfaceHeight = isExpanded ? EXPANDED_TAB_SURFACE_HEIGHT : COLLAPSED_TAB_HEIGHT;
    return {
      surfaceHeight: surfaceHeight,
      popupHeight: popupHeight,
      totalHeight: Math.max(
        COLLAPSED_TAB_HEIGHT,
        surfaceHeight + (
          popupHeight
            ? TAB_POPUP_OFFSET + popupHeight + Math.max(0, TAB_POPUP_CLEARANCE - TAB_STACK_GAP)
            : 0
        )
      )
    };
  }

  if (!isExpanded) {
    return {
      surfaceHeight: COLLAPSED_TAB_HEIGHT,
      popupHeight: popupHeight,
      totalHeight: Math.max(
        COLLAPSED_TAB_HEIGHT,
        COLLAPSED_TAB_HEIGHT + (
          popupHeight
            ? TAB_POPUP_OFFSET + popupHeight + Math.max(0, TAB_POPUP_CLEARANCE - TAB_STACK_GAP)
            : 0
        )
      )
    };
  }

  const buttonHeight = Math.max(
    button ? Math.ceil(button.scrollHeight) : 0,
    content ? Math.ceil(content.scrollHeight) : 0
  );
  const actionsHeight = actionGroups.reduce(function (maxHeight, actions) {
    if (!actions || window.getComputedStyle(actions).display === "none") {
      return maxHeight;
    }
    return Math.max(maxHeight, Math.ceil(actions.scrollHeight));
  }, 0);
  const headerHeight = Math.max(
    COLLAPSED_TAB_HEIGHT,
    isExpanded ? EXPANDED_TAB_SURFACE_HEIGHT : 0,
    buttonHeight,
    actionsHeight
  );

  return {
    surfaceHeight: Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(headerHeight)),
    popupHeight: popupHeight,
    totalHeight: Math.max(
      COLLAPSED_TAB_HEIGHT,
      Math.ceil(headerHeight) + (
        popupHeight
          ? TAB_POPUP_OFFSET + popupHeight + Math.max(0, TAB_POPUP_CLEARANCE - TAB_STACK_GAP)
          : 0
      )
    )
  };
}

// ============================================================
// GROUP 11 — Tab operations
// ============================================================

export function getOrderedBookmarkTabs() {
  if (!state.layer) {
    return [];
  }

  return Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]"));
}

function syncRenderedBookmarkTabDomOrder(bookmarks) {
  if (!state.layer) {
    return;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  if (!orderedBookmarks.length) {
    return;
  }

  const tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return;
  }

  const tabById = {};
  const placedBookmarkIds = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  orderedBookmarks.forEach(function (bookmark) {
    const bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    const tab = bookmarkId ? tabById[bookmarkId] : null;
    if (!tab || placedBookmarkIds[bookmarkId]) {
      return;
    }

    placedBookmarkIds[bookmarkId] = true;
    state.layer.appendChild(tab);
  });

  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId || placedBookmarkIds[bookmarkId]) {
      return;
    }

    state.layer.appendChild(tab);
  });
}

function insertRenderedBookmarkTabAtDisplayIndex(tab, bookmarks, insertIndex) {
  if (!state.layer || !(tab instanceof HTMLElement)) {
    return false;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const bookmarkId = tab.dataset.bookmarkId || "";
  const tabById = {};
  getOrderedBookmarkTabs().forEach(function (existingTab) {
    const existingBookmarkId = existingTab.dataset.bookmarkId || "";
    if (existingBookmarkId) {
      tabById[existingBookmarkId] = existingTab;
    }
  });

  const boundedInsertIndex = clamp(
    Number.isInteger(insertIndex) ? insertIndex : orderedBookmarks.findIndex(function (bookmark) {
      return bookmark && bookmark.id === bookmarkId;
    }),
    0,
    orderedBookmarks.length
  );

  for (let index = boundedInsertIndex + 1; index < orderedBookmarks.length; index += 1) {
    const nextBookmark = orderedBookmarks[index];
    const nextBookmarkId = nextBookmark && nextBookmark.id ? nextBookmark.id : "";
    if (!nextBookmarkId || nextBookmarkId === bookmarkId) {
      continue;
    }

    const nextTab = tabById[nextBookmarkId];
    if (!nextTab) {
      continue;
    }

    state.layer.insertBefore(tab, nextTab);
    return true;
  }

  state.layer.appendChild(tab);
  return true;
}

export function syncRenderedBookmarkEdgeText(bookmarks) {
  if (!state.layer) {
    return;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  if (!orderedBookmarks.length) {
    return;
  }

  const tabById = {};
  getOrderedBookmarkTabs().forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (bookmarkId) {
      tabById[bookmarkId] = tab;
    }
  });

  orderedBookmarks.forEach(function (bookmark, index) {
    const bookmarkId = bookmark && bookmark.id ? bookmark.id : "";
    const tab = bookmarkId ? tabById[bookmarkId] : null;
    const edge = tab ? tab.querySelector(".cgptbm-tab__edge") : null;
    if (!edge) {
      return;
    }

    edge.textContent = String(index + 1);
  });
}

export function syncRenderedBookmarkTabContent(tab, bookmark) {
  if (!tab || !bookmark) {
    return;
  }

  const accent = TAB_COLORS[normalizeColorIndex(bookmark.colorIndex) % TAB_COLORS.length];
  const labelText = bookmark.label || "Bookmark";
  const button = tab.querySelector(".cgptbm-tab__button");
  const label = tab.querySelector(".cgptbm-tab__label");

  tab.style.setProperty("--cgptbm-accent", accent);
  if (button) {
    button.title = labelText;
    button.setAttribute("aria-label", labelText);
  }
  if (label) {
    label.textContent = labelText;
  }

  syncTabPopupElement(tab, {
    popupText: isBookmarkPopupPinned(bookmark.id) ? getBookmarkPopupText(bookmark) : "",
    popupBookmarkId: bookmark.id,
    popupTitle: labelText,
    label: labelText
  });
}

function getRenderedTabHeight(tab) {
  if (!tab) {
    return COLLAPSED_TAB_HEIGHT;
  }

  return Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(tab.getBoundingClientRect().height || 0));
}

function getRenderedSurfaceHeight(tab) {
  if (!tab) {
    return COLLAPSED_TAB_HEIGHT;
  }

  const surface = tab.querySelector(".cgptbm-tab__surface");
  return Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(surface ? surface.getBoundingClientRect().height || 0 : 0));
}

function getRenderedPopupBottom(tab) {
  if (!tab) {
    return COLLAPSED_TAB_HEIGHT;
  }

  const popup = tab.querySelector(".cgptbm-tab__popup");
  if (!popup) {
    return getRenderedSurfaceHeight(tab);
  }

  return Math.max(
    COLLAPSED_TAB_HEIGHT,
    Math.ceil(
      (popup.offsetTop || 0) +
      (popup.offsetHeight || 0) +
      Math.max(0, TAB_POPUP_CLEARANCE - TAB_STACK_GAP)
    )
  );
}

function applyMeasuredTabLayout(tab, top, layout) {
  if (!tab || !layout) {
    return;
  }

  tab.style.setProperty("--cgptbm-surface-height", Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(layout.surfaceHeight)) + "px");
  tab.style.top = Math.round(top) + "px";
  tab.style.height = Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(layout.totalHeight)) + "px";
}

export function applyPopupResizeLocalLayout(bookmarkId) {
  if (!bookmarkId) {
    syncRenderedBookmarkRail();
    return;
  }

  const tabs = getOrderedBookmarkTabs();
  if (!tabs.length) {
    return;
  }

  const anchorIndex = tabs.findIndex(function (tab) {
    return (tab.dataset.bookmarkId || "") === bookmarkId;
  });
  if (anchorIndex < 0) {
    syncRenderedBookmarkRail();
    return;
  }

  const anchorTab = tabs[anchorIndex];
  const anchorTop = Number.parseFloat(anchorTab.style.top);
  const nextAnchorTop = Number.isFinite(anchorTop) ? anchorTop : 70;
  const anchorSurfaceHeight = getRenderedSurfaceHeight(anchorTab);
  const anchorTotalHeight = getRenderedPopupBottom(anchorTab);

  anchorTab.style.setProperty("--cgptbm-surface-height", Math.max(COLLAPSED_TAB_HEIGHT, anchorSurfaceHeight) + "px");
  anchorTab.style.height = Math.max(COLLAPSED_TAB_HEIGHT, anchorTotalHeight) + "px";

  let cursorTop = nextAnchorTop + Math.max(COLLAPSED_TAB_HEIGHT, anchorTotalHeight) + TAB_STACK_GAP;
  for (let index = anchorIndex + 1; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const currentHeight = getRenderedTabHeight(tab);
    tab.style.top = Math.round(cursorTop) + "px";
    cursorTop += currentHeight + TAB_STACK_GAP;
  }

  syncRailViewportOverflow();
}

export function syncRailViewportOverflow() {
  if (!state.layer || !state.railViewport || !state.railScrollSpacer) {
    return;
  }

  const railNodes = Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id], .cgptbm-tab--empty"));
  const viewportHeight = Math.max(1, state.railViewport.clientHeight || window.innerHeight);
  const contentBottom = railNodes.reduce(function (maxBottom, node) {
    const top = Number.parseFloat(node.style.top);
    const height = Number.parseFloat(node.style.height);
    if (!Number.isFinite(top) || !Number.isFinite(height)) {
      return maxBottom;
    }
    return Math.max(maxBottom, top + height);
  }, getBookmarkTabTopLimit());

  const nextLayerHeight = Math.max(viewportHeight, Math.ceil(contentBottom + TAB_STACK_GAP + RAIL_BOTTOM_PADDING));
  state.railScrollSpacer.style.height = nextLayerHeight + "px";

  const maxScrollTop = Math.max(0, state.railViewport.scrollHeight - state.railViewport.clientHeight);
  if (state.railViewport.scrollTop > maxScrollTop) {
    state.railViewport.scrollTop = maxScrollTop;
  }
  if (maxScrollTop <= 1 && state.railViewport.scrollTop !== 0) {
    state.railViewport.scrollTop = 0;
  }

  state.railViewport.classList.toggle("has-overflow", maxScrollTop > 1);
  if (state.railScrollbar) {
    state.railScrollbar.hidden = maxScrollTop <= 1;
  }
  syncRailScrollbar();
  syncRailOverlayScroll();
}

export function syncRailOverlayScroll() {
  if (!state.layer || !state.railViewport) {
    return;
  }

  state.layer.style.setProperty("--cgptbm-rail-scroll-top", Math.round(state.railViewport.scrollTop) + "px");
  syncRailScrollbar();
}

export function bindRailScrollbar(scrollbar, track, thumb) {
  if (!scrollbar || !track || !thumb) {
    return;
  }

  thumb.onmousedown = preventFocusSteal;
  thumb.onpointerdown = handleRailScrollbarThumbPointerDown;
  track.onmousedown = preventFocusSteal;
  track.onpointerdown = handleRailScrollbarTrackPointerDown;
}

// ============================================================
// GROUP 12 — Scrollbar
// ============================================================

export function handleRailViewportWheel(event) {
  if (!state.railViewport) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target && (target.closest(".cgptbm-tab__popup-body") || target.closest(".cgptbm-popup"))) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const deltaY = Number(event.deltaY) || 0;
  if (!deltaY) {
    return;
  }

  const maxScrollTop = Math.max(0, state.railViewport.scrollHeight - state.railViewport.clientHeight);
  if (maxScrollTop <= 1) {
    state.railViewport.scrollTop = 0;
    syncRailScrollbar();
    syncRailOverlayScroll();
    return;
  }

  state.railViewport.scrollTop = clamp(state.railViewport.scrollTop + deltaY, 0, maxScrollTop);
  syncRailScrollbar();
  syncRailOverlayScroll();
}

function syncRailScrollbar() {
  if (!state.railViewport || !state.railScrollbarTrack || !state.railScrollbarThumb) {
    return;
  }

  const track = state.railScrollbarTrack;
  const thumb = state.railScrollbarThumb;
  const container = state.railViewport;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const trackHeight = Math.max(0, track.clientHeight);

  if (maxScrollTop <= 1 || trackHeight <= 0) {
    thumb.style.height = "0px";
    thumb.style.transform = "translateY(0)";
    return;
  }

  const thumbHeight = clamp(
    Math.round((container.clientHeight / Math.max(container.scrollHeight, 1)) * trackHeight),
    RAIL_SCROLLBAR_MIN_THUMB_HEIGHT,
    trackHeight
  );
  const travel = Math.max(0, trackHeight - thumbHeight);
  const ratio = clamp(container.scrollTop / maxScrollTop, 0, 1);
  const thumbTop = Math.round(travel * ratio);

  thumb.style.height = thumbHeight + "px";
  thumb.style.transform = "translateY(" + thumbTop + "px)";
}

function handleRailScrollbarTrackPointerDown(event) {
  if (!state.railViewport || !state.railScrollbarTrack || !state.railScrollbarThumb) {
    return;
  }

  if (event.target === state.railScrollbarThumb) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const trackRect = state.railScrollbarTrack.getBoundingClientRect();
  const thumbHeight = Math.max(0, state.railScrollbarThumb.getBoundingClientRect().height);
  const nextThumbTop = clamp(event.clientY - trackRect.top - (thumbHeight / 2), 0, Math.max(0, trackRect.height - thumbHeight));
  const maxScrollTop = Math.max(0, state.railViewport.scrollHeight - state.railViewport.clientHeight);
  const travel = Math.max(1, trackRect.height - thumbHeight);
  const ratio = clamp(nextThumbTop / travel, 0, 1);
  state.railViewport.scrollTop = ratio * maxScrollTop;
  syncRailScrollbar();
  syncRailOverlayScroll();
}

function handleRailScrollbarThumbPointerDown(event) {
  if (!state.railViewport || !state.railScrollbarTrack || !state.railScrollbarThumb) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  state.railScrollbarDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startScrollTop: state.railViewport.scrollTop
  };

  if (typeof state.railScrollbarThumb.setPointerCapture === "function") {
    try {
      state.railScrollbarThumb.setPointerCapture(event.pointerId);
    } catch (error) {
      // Ignore capture failures and keep the drag session active.
    }
  }
}

export function handleRailScrollbarPointerMove(event) {
  if (!state.railScrollbarDrag || !state.railViewport || !state.railScrollbarTrack || !state.railScrollbarThumb) {
    return;
  }

  if (event.pointerId !== state.railScrollbarDrag.pointerId) {
    return;
  }

  event.preventDefault();

  const deltaY = event.clientY - state.railScrollbarDrag.startY;
  const maxScrollTop = Math.max(0, state.railViewport.scrollHeight - state.railViewport.clientHeight);
  const trackHeight = Math.max(0, state.railScrollbarTrack.clientHeight);
  const thumbHeight = Math.max(0, state.railScrollbarThumb.getBoundingClientRect().height);
  const travel = Math.max(1, trackHeight - thumbHeight);
  const scrollDelta = (deltaY / travel) * maxScrollTop;
  state.railViewport.scrollTop = clamp(state.railScrollbarDrag.startScrollTop + scrollDelta, 0, maxScrollTop);
  syncRailScrollbar();
  syncRailOverlayScroll();
}

export function handleRailScrollbarPointerEnd(event) {
  if (!state.railScrollbarDrag) {
    return;
  }

  if (event.pointerId !== state.railScrollbarDrag.pointerId) {
    return;
  }

  state.railScrollbarDrag = null;
}

// ============================================================
// GROUP 13 — Drag reorder
// ============================================================

function canReorderBookmarkTabs() {
  return Boolean(
    state.railEnabled &&
    !state.bookmarkSearchQuery &&
    !state.popup &&
    !state.colorPicker &&
    !state.popupResizeSession &&
    Array.isArray(state.currentBookmarks) &&
    state.currentBookmarks.length > 1
  );
}

function clearBookmarkDragSuppressClick() {
  if (state.bookmarkDragSuppressClickTimer) {
    window.clearTimeout(state.bookmarkDragSuppressClickTimer);
    state.bookmarkDragSuppressClickTimer = 0;
  }

  state.bookmarkDragSuppressClickBookmarkId = "";
}

function suppressBookmarkDragClick(bookmarkId) {
  clearBookmarkDragSuppressClick();
  if (!bookmarkId) {
    return;
  }

  state.bookmarkDragSuppressClickBookmarkId = bookmarkId;
  state.bookmarkDragSuppressClickTimer = window.setTimeout(function () {
    state.bookmarkDragSuppressClickTimer = 0;
    state.bookmarkDragSuppressClickBookmarkId = "";
  }, 240);
}

function consumeBookmarkDragSuppressedClick(bookmarkId) {
  if (!bookmarkId || state.bookmarkDragSuppressClickBookmarkId !== bookmarkId) {
    return false;
  }

  clearBookmarkDragSuppressClick();
  return true;
}

function ensureBookmarkDragIndicator() {
  if (state.bookmarkDragIndicator || !state.layer) {
    return state.bookmarkDragIndicator;
  }

  const indicator = document.createElement("div");
  indicator.className = "cgptbm-tab-drop-indicator";
  state.layer.appendChild(indicator);
  state.bookmarkDragIndicator = indicator;
  return indicator;
}

function hideBookmarkDragIndicator() {
  if (!state.bookmarkDragIndicator) {
    return;
  }

  state.bookmarkDragIndicator.classList.remove("is-visible");
  state.bookmarkDragIndicator.style.removeProperty("top");
}

function clearBookmarkDragPreviewClasses() {
  if (!state.layer) {
    return;
  }

  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).forEach(function (tab) {
    tab.classList.remove("is-drag-preview-adjacent", "is-drag-preview-before", "is-drag-preview-after");
  });
}

function resetBookmarkDragPreviewLayout() {
  clearBookmarkDragPreviewClasses();
  hideBookmarkDragIndicator();

  if (!state.layer) {
    return;
  }

  syncRenderedBookmarkRail({ lightweight: true });
}

function buildBookmarkDragHeightSnapshot() {
  if (!state.layer) {
    return {};
  }

  const heightByBookmarkId = {};
  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId) {
      return;
    }

    const layout = measureRenderedTabLayout(tab, { lightweight: true });
    heightByBookmarkId[bookmarkId] = layout.totalHeight;
  });
  return heightByBookmarkId;
}

function applyBookmarkDragPreviewLayout(session, previewState) {
  if (!session || !state.layer) {
    hideBookmarkDragIndicator();
    return;
  }

  clearBookmarkDragPreviewClasses();

  const tabs = Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]"));
  if (!tabs.length) {
    hideBookmarkDragIndicator();
    return;
  }

  const tabById = {};
  tabs.forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    if (!bookmarkId) {
      return;
    }

    tabById[bookmarkId] = tab;
  });
  const heightByBookmarkId = session.heightByBookmarkId && typeof session.heightByBookmarkId === "object"
    ? session.heightByBookmarkId
    : buildBookmarkDragHeightSnapshot();

  const visibleBookmarks = getFilteredCurrentBookmarks().filter(function (bookmark) {
    return bookmark && bookmark.id !== session.bookmarkId;
  });
  const previewIndex = previewState && Number.isInteger(previewState.index)
    ? clamp(previewState.index, 0, visibleBookmarks.length)
    : 0;
  const previewGapHeight = Math.max(
    COLLAPSED_TAB_HEIGHT,
    Math.ceil(heightByBookmarkId[session.bookmarkId] || COLLAPSED_TAB_HEIGHT)
  );
  const positionedBookmarks = computeTabPositions(visibleBookmarks, {
    expandedBookmarkId: state.expandedBookmarkId === session.bookmarkId ? "" : state.expandedBookmarkId,
    heightByBookmarkId: heightByBookmarkId,
    previewGapIndex: previewIndex,
    previewGapHeight: previewGapHeight
  });

  positionedBookmarks.forEach(function (entry, index) {
    const tab = tabById[entry.bookmark.id];
    if (!tab) {
      return;
    }

    tab.style.top = entry.top + "px";
    tab.style.height = entry.height + "px";
    if (index === previewIndex - 1) {
      tab.classList.add("is-drag-preview-adjacent", "is-drag-preview-before");
    }
    if (index === previewIndex) {
      tab.classList.add("is-drag-preview-adjacent", "is-drag-preview-after");
    }
  });

  const indicator = ensureBookmarkDragIndicator();
  if (!indicator) {
    return;
  }

  let indicatorTop = getBookmarkTabTopLimit() + Math.round(previewGapHeight / 2);
  if (previewIndex > 0 && positionedBookmarks[previewIndex - 1]) {
    indicatorTop = positionedBookmarks[previewIndex - 1].top +
      positionedBookmarks[previewIndex - 1].height +
      Math.round(previewGapHeight / 2);
  }

  indicator.style.top = indicatorTop + "px";
  indicator.classList.add("is-visible");
}

function handleBookmarkTabPointerDown(bookmarkId, event) {
  if (!bookmarkId || !event || event.button !== 0 || !canReorderBookmarkTabs()) {
    return;
  }

  if (shouldIgnoreBookmarkDragStartTarget(event.target)) {
    return;
  }

  const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const tab = handle && handle.closest ? handle.closest(".cgptbm-tab[data-bookmark-id]") : null;
  if (!(tab instanceof HTMLElement)) {
    return;
  }

  clearBookmarkDragSession();
  clearBookmarkDragSuppressClick();
  state.bookmarkDragSession = {
    bookmarkId: bookmarkId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    currentClientX: event.clientX,
    currentClientY: event.clientY,
    tab: tab,
    heightByBookmarkId: null,
    activated: false,
    previewIndex: -1
  };
}

function shouldIgnoreBookmarkDragStartTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) {
    return false;
  }

  return Boolean(
    element.closest(".cgptbm-tab__action, .cgptbm-tab__delete-orb, .cgptbm-tab__delete-zone, .cgptbm-tab__edge")
  );
}

function handleBookmarkDragPointerMove(event) {
  const session = state.bookmarkDragSession;
  if (!session || !event || event.pointerId !== session.pointerId) {
    return false;
  }

  session.currentClientX = event.clientX;
  session.currentClientY = event.clientY;

  if (!session.activated) {
    const deltaX = event.clientX - session.startClientX;
    const deltaY = event.clientY - session.startClientY;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 7) {
      return false;
    }

    session.activated = true;
    session.heightByBookmarkId = buildBookmarkDragHeightSnapshot();
    if (session.tab && session.tab.isConnected) {
      session.tab.classList.add("is-dragging");
    }
    if (state.layer) {
      state.layer.classList.add("is-bookmark-reordering");
    }
  }

  event.preventDefault();
  syncBookmarkDragSessionVisual(session);
  return true;
}

export async function handleBookmarkDragPointerEnd(event) {
  const session = state.bookmarkDragSession;
  if (!session || !event || event.pointerId !== session.pointerId) {
    return;
  }

  if (event.type === "pointercancel") {
    clearBookmarkDragSession();
    return;
  }

  const finalizedSession = clearBookmarkDragSession({
    suppressClick: Boolean(session.activated),
    skipLayoutReset: true
  });
  if (!finalizedSession || !finalizedSession.activated) {
    return;
  }

  await commitBookmarkDragSession(finalizedSession);
}

export function clearBookmarkDragSession(options) {
  const session = state.bookmarkDragSession;
  const nextOptions = options || {};
  if (state.layer) {
    state.layer.classList.remove("is-bookmark-reordering");
  }
  if (!session) {
    if (!nextOptions.skipLayoutReset) {
      resetBookmarkDragPreviewLayout();
    } else {
      clearBookmarkDragPreviewClasses();
      hideBookmarkDragIndicator();
    }
    return null;
  }

  if (session.tab && session.tab.isConnected) {
    session.tab.classList.remove("is-dragging");
    session.tab.style.removeProperty("--cgptbm-tab-drag-translate-y");
    session.tab.style.removeProperty("z-index");
  }

  state.bookmarkDragSession = null;

  if (!nextOptions.skipLayoutReset) {
    resetBookmarkDragPreviewLayout();
  } else {
    clearBookmarkDragPreviewClasses();
    hideBookmarkDragIndicator();
  }

  if (nextOptions.suppressClick && session.activated) {
    suppressBookmarkDragClick(session.bookmarkId);
  }

  return session;
}

function syncBookmarkDragSessionVisual(session) {
  if (!session || !session.tab || !session.tab.isConnected) {
    clearBookmarkDragSession();
    return;
  }

  const translateY = Math.round(session.currentClientY - session.startClientY);
  session.tab.style.setProperty("--cgptbm-tab-drag-translate-y", translateY + "px");
  session.tab.style.zIndex = String(Math.max(24, state.currentBookmarks.length + 4));

  const previewState = getBookmarkDragPreviewState(session);
  session.previewIndex = previewState.index;
  applyBookmarkDragPreviewLayout(session, previewState);
}

function getBookmarkDragPreviewState(session) {
  const topLimit = getBookmarkTabTopLimit();
  const remainingTabs = state.layer
    ? Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).filter(function (tab) {
      return (tab.dataset.bookmarkId || "") !== session.bookmarkId;
    })
    : [];

  if (!remainingTabs.length) {
    return {
      index: 0,
      top: topLimit
    };
  }

  const entries = remainingTabs
    .map(function (tab) {
      const rect = tab.getBoundingClientRect();
      const top = Number.parseFloat(tab.style.top);
      const height = Number.parseFloat(tab.style.height);
      return {
        top: Number.isFinite(top) ? top : 0,
        height: Number.isFinite(height) ? height : Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(rect.height || 0)),
        midpoint: rect.top + (rect.height / 2)
      };
    })
    .sort(function (left, right) {
      return left.top - right.top;
    });

  let index = 0;
  while (index < entries.length && session.currentClientY >= entries[index].midpoint) {
    index += 1;
  }

  let top = topLimit;
  if (index > 0) {
    top = entries[index - 1].top + entries[index - 1].height + Math.floor(TAB_STACK_GAP / 2);
  }

  return {
    index: index,
    top: Math.max(topLimit, Math.round(top))
  };
}

async function commitBookmarkDragSession(session) {
  const displayOrderedBookmarks = getDisplayOrderedBookmarks(state.currentBookmarks, state.manualOrderBookmarkIds);
  const currentOrderedBookmarkIds = getBookmarkIdList(displayOrderedBookmarks);
  if (!currentOrderedBookmarkIds.length || currentOrderedBookmarkIds.indexOf(session.bookmarkId) < 0) {
    return;
  }

  const bookmarkIdsWithoutDragged = currentOrderedBookmarkIds.filter(function (bookmarkId) {
    return bookmarkId !== session.bookmarkId;
  });
  const nextIndex = clamp(
    Number.isInteger(session.previewIndex) ? session.previewIndex : 0,
    0,
    bookmarkIdsWithoutDragged.length
  );
  const nextOrderedBookmarkIds = bookmarkIdsWithoutDragged.slice(0, nextIndex)
    .concat(session.bookmarkId, bookmarkIdsWithoutDragged.slice(nextIndex));

  if (areBookmarkIdListsEqual(currentOrderedBookmarkIds, nextOrderedBookmarkIds)) {
    resetBookmarkDragPreviewLayout();
    return;
  }

  state.manualOrderBookmarkIds = normalizeManualOrderBookmarkIds(state.currentBookmarks, nextOrderedBookmarkIds);
  syncRenderedBookmarkTabDomOrder(getFilteredCurrentBookmarks());
  syncRenderedBookmarkRail({ lightweight: true });
  await persistBookmarkUiState();
}

// ============================================================
// GROUP 14 — Interaction visuals
// ============================================================

export function syncRenderedBookmarkInteractionVisuals(tabs) {
  if (!state.layer) {
    return;
  }

  const orderedTabs = Array.isArray(tabs) && tabs.length ? tabs : getOrderedBookmarkTabs();
  if (!orderedTabs.length) {
    return;
  }

  orderedTabs.forEach(function (tab, index) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    const isExpanded = isBookmarkExpanded(bookmarkId);
    const isHovered = bookmarkId === state.hoveredBookmarkId;
    const isEditing = bookmarkId === state.editLockedBookmarkId;
    const deleteOrb = tab.querySelector(".cgptbm-tab__delete-orb");
    tab.classList.toggle("is-active", bookmarkId === state.activeBookmarkId);
    tab.classList.toggle("is-pinned", isBookmarkPopupPinned(bookmarkId));
    tab.classList.toggle("is-expanded", isExpanded);
    tab.classList.toggle("is-hovered", isHovered);
    tab.classList.toggle("is-editing", isEditing);
    tab.classList.toggle("is-reorder-ready", canReorderBookmarkTabs());
    if (deleteOrb) {
      const isDeleteEnabled = isExpanded && isHovered && !isEditing;
      deleteOrb.disabled = !isDeleteEnabled;
      deleteOrb.tabIndex = isDeleteEnabled ? 0 : -1;
      deleteOrb.setAttribute("aria-hidden", isDeleteEnabled ? "false" : "true");
    }
    if (bookmarkId === state.expandedBookmarkId) {
      tab.style.zIndex = String(orderedTabs.length + 2);
    } else {
      tab.style.zIndex = String(Math.max(1, orderedTabs.length - index));
    }
  });

  syncRenderedColorPickerEdges();
}

function setHoveredBookmark(bookmarkId) {
  if ((state.bookmarkDragSession && state.bookmarkDragSession.activated) || isBookmarkCreateInteractionGuardActive()) {
    return;
  }

  if (!state.popup && state.createPopupPreservedExpandedBookmarkId) {
    state.createPopupPreservedExpandedBookmarkId = "";
  }

  const nextBookmarkId = bookmarkId || "";
  releaseResizeLockedExpandedBookmarkForInteraction(nextBookmarkId);
  if (state.hoveredBookmarkId === nextBookmarkId) {
    return;
  }

  state.hoveredBookmarkId = nextBookmarkId;
  syncExpandedBookmarkState();
}

function clearHoveredBookmark(bookmarkId) {
  if ((state.bookmarkDragSession && state.bookmarkDragSession.activated) || isBookmarkCreateInteractionGuardActive()) {
    return;
  }

  if (!state.popup && state.createPopupPreservedExpandedBookmarkId) {
    state.createPopupPreservedExpandedBookmarkId = "";
  }

  if (!state.hoveredBookmarkId) {
    return;
  }

  if (bookmarkId && state.hoveredBookmarkId !== bookmarkId) {
    return;
  }

  state.hoveredBookmarkId = "";
  syncExpandedBookmarkState();
}

function setFocusedBookmark(bookmarkId) {
  if ((state.bookmarkDragSession && state.bookmarkDragSession.activated) || isBookmarkCreateInteractionGuardActive()) {
    return;
  }

  if (!state.popup && state.createPopupPreservedExpandedBookmarkId) {
    state.createPopupPreservedExpandedBookmarkId = "";
  }

  const nextBookmarkId = bookmarkId || "";
  releaseResizeLockedExpandedBookmarkForInteraction(nextBookmarkId);
  if (state.focusedBookmarkId === nextBookmarkId) {
    return;
  }

  state.focusedBookmarkId = nextBookmarkId;
  syncExpandedBookmarkState();
}

function clearFocusedBookmark(bookmarkId) {
  if ((state.bookmarkDragSession && state.bookmarkDragSession.activated) || isBookmarkCreateInteractionGuardActive()) {
    return;
  }

  if (!state.popup && state.createPopupPreservedExpandedBookmarkId) {
    state.createPopupPreservedExpandedBookmarkId = "";
  }

  if (!state.focusedBookmarkId) {
    return;
  }

  if (bookmarkId && state.focusedBookmarkId !== bookmarkId) {
    return;
  }

  state.focusedBookmarkId = "";
  syncExpandedBookmarkState();
}

// ============================================================
// GROUP 15 — Expansion/pinning
// ============================================================

export function syncExpandedBookmarkState(options) {
  const nextOptions = options || {};
  const nextBookmarkId = getExpandedBookmarkId();
  const shouldRunFullSync = Boolean(nextOptions.full);
  const hasExpandedChanged = state.expandedBookmarkId !== nextBookmarkId;
  state.expandedBookmarkId = nextBookmarkId;
  if (shouldRunFullSync || hasExpandedChanged) {
    syncRenderedBookmarkRail(shouldRunFullSync ? null : { lightweight: true });
    return;
  }

  syncRenderedBookmarkInteractionVisuals();
}

export function getExpandedBookmarkId() {
  return state.colorPickerLockedBookmarkId || state.editLockedBookmarkId || state.resizeLockedExpandedBookmarkId || state.createPopupPreservedExpandedBookmarkId || state.focusedBookmarkId || state.hoveredBookmarkId || "";
}

export function isBookmarkExpanded(bookmarkId) {
  return Boolean(
    bookmarkId &&
    (
      bookmarkId === state.expandedBookmarkId ||
      isBookmarkPopupPinned(bookmarkId) ||
      isBookmarkExpansionPinned(bookmarkId)
    )
  );
}

export function syncRenderedPinActions() {
  if (!state.layer) {
    return;
  }

  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    const pinButton = tab.querySelector('[data-action-key="pin-toggle"]');
    const expandPinButton = tab.querySelector('[data-action-key="expand-pin-toggle"]');
    const isPinned = isBookmarkPopupPinned(bookmarkId);
    const isExpansionPinned = isBookmarkExpansionPinned(bookmarkId);
    if (!pinButton) {
      return;
    }

    pinButton.textContent = isPinned ? "-" : "+";
    pinButton.title = isPinned ? "Hide saved text popup" : "Show saved text popup";
    pinButton.setAttribute("aria-label", isPinned ? "Hide saved text popup" : "Show saved text popup");
    pinButton.classList.toggle("is-selected", isPinned);
    if (expandPinButton) {
      renderTabActionButtonContent(expandPinButton, {
        label: "P",
        icon: "expand-pin"
      });
      expandPinButton.title = isExpansionPinned ? "Release expanded bookmark" : "Keep bookmark expanded";
      expandPinButton.setAttribute("aria-label", isExpansionPinned ? "Release expanded bookmark" : "Keep bookmark expanded");
      expandPinButton.classList.toggle("is-selected", isExpansionPinned);
    }
  });
}

export function isPopupContentExpanded(bookmarkId) {
  return Boolean(
    bookmarkId &&
    Array.isArray(state.expandedPopupContentBookmarkIds) &&
    state.expandedPopupContentBookmarkIds.indexOf(bookmarkId) >= 0
  );
}

export function setPopupContentExpanded(bookmarkId, isExpanded) {
  if (!bookmarkId) {
    return;
  }

  const expandedIds = Array.isArray(state.expandedPopupContentBookmarkIds)
    ? state.expandedPopupContentBookmarkIds.slice()
    : [];
  const currentIndex = expandedIds.indexOf(bookmarkId);
  if (isExpanded) {
    if (currentIndex < 0) {
      expandedIds.push(bookmarkId);
    }
  } else if (currentIndex >= 0) {
    expandedIds.splice(currentIndex, 1);
  }
  state.expandedPopupContentBookmarkIds = expandedIds;
}

function syncRenderedPinnedPopups(tabById, bookmarkById) {
  Object.keys(tabById).forEach(function (bookmarkId) {
    const tab = tabById[bookmarkId];
    const bookmark = bookmarkById[bookmarkId];
    if (!tab) {
      return;
    }

    syncTabPopupElement(
      tab,
      bookmark && isBookmarkPopupPinned(bookmarkId)
        ? {
          popupText: getBookmarkPopupText(bookmark),
          popupBookmarkId: bookmarkId,
          popupTitle: bookmark.label || "Bookmark",
          popupOnClose: function (event) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            togglePinnedBookmark(bookmarkId);
          }
        }
        : null
    );
  });
}

export function getBookmarkPopupText(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  const storedDisplayText = formatPopupDisplayText(anchor && anchor.selectionDisplayText, isCodeAnchor(anchor));
  const liveSelectionText = extractResolvedSelectionText(bookmark);
  const storedRawSelectionText = formatPopupDisplayText(anchor && anchor.selectionTextRaw, isCodeAnchor(anchor));
  const storedSelectionText = formatPopupDisplayText(anchor && anchor.selectionText);
  const fallbackText = formatPopupDisplayText(
    (bookmark && bookmark.snippet) ||
    (anchor && anchor.blockTextSnippet) ||
    ""
  );

  return storedDisplayText || liveSelectionText || storedRawSelectionText || storedSelectionText || fallbackText;
}

// ============================================================
// GROUP 16 — Text extraction
// ============================================================

export function extractResolvedSelectionText(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (!anchor) {
    return "";
  }
  if (isFrameRelayAnchor(anchor) || isSandboxCardAnchor(anchor)) {
    return "";
  }

  const target = resolveBookmarkTarget(bookmark);
  if (!target) {
    return "";
  }

  const preferredMatch = resolvePreferredHighlightMatch(target, bookmark);
  if (preferredMatch && preferredMatch.match) {
    const preferredText = extractTextFromMatch(preferredMatch.match, {
      preserveWhitespace: preferredMatch.mode === "code"
    });
    if (preferredText) {
      return preferredText;
    }
  }

  const startIndex = normalizeInteger(anchor.selectionStart);
  const selectionLength = normalizeInteger(anchor.selectionLength);
  if (startIndex < 0 || selectionLength <= 0) {
    return "";
  }

  const textMap = buildTargetTextMap(target);
  if (!textMap || !textMap.normalizedText) {
    return "";
  }

  const clampedStart = Math.min(startIndex, textMap.normalizedText.length);
  const clampedEnd = Math.min(textMap.normalizedText.length, clampedStart + selectionLength);
  if (clampedEnd <= clampedStart) {
    return "";
  }

  const selectedText = textMap.normalizedText.slice(clampedStart, clampedEnd);
  const prefixText = textMap.normalizedText.slice(0, clampedStart);
  const suffixText = textMap.normalizedText.slice(clampedEnd);
  const prefixScore = scoreOccurrenceEdge(anchor.selectionPrefix, prefixText, true);
  const suffixScore = scoreOccurrenceEdge(anchor.selectionSuffix, suffixText, false);
  const contextFingerprintMatch = matchesSelectionContextFingerprint(anchor, prefixText, selectedText, suffixText);
  const storedSelection = normalizeText(anchor.selectionText || "");
  const selectionCompatible = !storedSelection ||
    selectedText === storedSelection ||
    selectedText.indexOf(storedSelection) === 0 ||
    storedSelection.indexOf(selectedText) === 0;

  if (!selectionCompatible && !contextFingerprintMatch && !prefixScore && !suffixScore) {
    return "";
  }

  return formatPopupDisplayText(selectedText);
}

function extractTextFromMatch(match, options) {
  if (!match || !match.startNode || !match.endNode) {
    return "";
  }

  const range = document.createRange();
  try {
    range.setStart(match.startNode, match.startOffset);
    range.setEnd(match.endNode, match.endOffset);
  } catch (error) {
    return "";
  }

  return extractStructuredPopupTextFromRange(range, options);
}

// ============================================================
// GROUP 17 — Popup resize
// ============================================================

export function handlePopupResizePointerMove(event) {
  if (!state.popupResizeSession) {
    maybeReleaseResizeLockedExpandedBookmark(event ? event.target : null);
    return;
  }

  event.preventDefault();

  const session = state.popupResizeSession;
  const maxWidth = Math.max(POPUP_MIN_WIDTH, Math.min(getPopupViewportMaxWidth(), session.maxWidth || getPopupViewportMaxWidth()));
  const nextWidth = Math.round(clamp(session.startWidth - (event.clientX - session.startX), POPUP_MIN_WIDTH, maxWidth));
  const nextHeight = getViewportClampedPopupHeight(session.startHeight + (event.clientY - session.startY));
  session.pendingWidth = nextWidth;
  session.pendingHeight = nextHeight;
  schedulePopupResizeFrame(session);
}

export async function handlePopupResizePointerEnd() {
  if (!state.popupResizeSession) {
    return;
  }

  const session = state.popupResizeSession;
  flushPopupResizeFrame(session);
  finalizePopupResizeLayout(session.bookmarkId, session.popup, session);
  const bookmarkId = session.bookmarkId;
  endPopupResizeSession();
  markResizeSettlingBookmark(bookmarkId);
  applyPopupResizeLocalLayout(bookmarkId);
  syncRailViewportWidth({ force: true });
  await persistPopupLayouts();
}

export function beginPopupResizeSession(bookmarkId, popup, event) {
  if (!bookmarkId || !popup || !event) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const rect = popup.getBoundingClientRect();
  const maxWidth = getPopupContentMaxWidth(popup);
  const width = Math.round(clamp(rect.width, POPUP_MIN_WIDTH, Math.max(POPUP_MIN_WIDTH, Math.min(getPopupViewportMaxWidth(), maxWidth))));
  const height = getViewportClampedPopupHeight(rect.height);
  lockResizeExpandedBookmark();
  applyPopupResizeSessionLayout(popup, width, height);
  popup.classList.add("is-resizing");
  state.popupResizeSession = {
    bookmarkId: bookmarkId,
    popup: popup,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: width,
    startHeight: height,
    pendingWidth: width,
    pendingHeight: height,
    maxWidth: maxWidth,
    frameId: 0
  };
}

export function endPopupResizeSession() {
  if (!state.popupResizeSession) {
    return;
  }

  if (state.popupResizeSession.frameId) {
    window.cancelAnimationFrame(state.popupResizeSession.frameId);
    state.popupResizeSession.frameId = 0;
  }
  const bookmarkId = state.popupResizeSession.bookmarkId;
  state.popupResizeSession = null;

  if (state.layer) {
    const popup = state.layer.querySelector('.cgptbm-tab__popup[data-bookmark-id="' + bookmarkId + '"]');
    if (popup) {
      popup.classList.remove("is-resizing");
    }
  }
}

function markResizeSettlingBookmark(bookmarkId) {
  clearResizeSettlingBookmark(true);

  if (!bookmarkId || !state.layer) {
    return;
  }

  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + bookmarkId + '"]');
  if (!tab) {
    return;
  }

  state.resizeSettlingBookmarkId = bookmarkId;
  tab.classList.add("is-resize-settling");
  state.resizeSettleTimer = window.setTimeout(function () {
    clearResizeSettlingBookmark();
  }, 220);
}

function clearResizeSettlingBookmark(skipRailSync) {
  window.clearTimeout(state.resizeSettleTimer);
  state.resizeSettleTimer = 0;

  if (!state.resizeSettlingBookmarkId || !state.layer) {
    state.resizeSettlingBookmarkId = "";
    return;
  }

  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + state.resizeSettlingBookmarkId + '"]');
  if (tab) {
    tab.classList.remove("is-resize-settling");
  }

  state.resizeSettlingBookmarkId = "";
}

function lockResizeExpandedBookmark() {
  const bookmarkId = state.focusedBookmarkId || state.hoveredBookmarkId || "";
  state.resizeLockedExpandedBookmarkId = bookmarkId || "";
}

export function releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId) {
  if (!state.resizeLockedExpandedBookmarkId) {
    return false;
  }

  if (bookmarkId && bookmarkId === state.resizeLockedExpandedBookmarkId) {
    return false;
  }

  state.resizeLockedExpandedBookmarkId = "";
  return true;
}

export function maybeReleaseResizeLockedExpandedBookmark(target, options) {
  if (!state.resizeLockedExpandedBookmarkId || state.popupResizeSession || !state.root) {
    return false;
  }

  const nextOptions = options || {};
  if (!nextOptions.force && target && state.root.contains(target)) {
    return false;
  }

  state.resizeLockedExpandedBookmarkId = "";
  syncExpandedBookmarkState();
  return true;
}

export function getPopupLayout(bookmarkId) {
  if (!bookmarkId || !state.popupLayoutByBookmarkId || typeof state.popupLayoutByBookmarkId !== "object") {
    return null;
  }

  return normalizePopupLayout(state.popupLayoutByBookmarkId[bookmarkId]);
}

function schedulePopupResizeFrame(session) {
  if (!session || session.frameId) {
    return;
  }

  session.frameId = window.requestAnimationFrame(function () {
    session.frameId = 0;
    if (state.popupResizeSession !== session) {
      return;
    }

    applyPopupResizeSessionLayout(session.popup, session.pendingWidth, session.pendingHeight);
  });
}

function flushPopupResizeFrame(session) {
  if (!session) {
    return;
  }

  if (session.frameId) {
    window.cancelAnimationFrame(session.frameId);
    session.frameId = 0;
  }

  applyPopupResizeSessionLayout(session.popup, session.pendingWidth, session.pendingHeight);
}

function applyPopupResizeSessionLayout(popup, width, height) {
  if (!popup) {
    return;
  }

  popup.classList.add("has-custom-size");
  popup.style.width = Math.round(width) + "px";
  popup.style.height = Math.round(height) + "px";
  schedulePopupOverflowIndicatorSync(popup);
}

function finalizePopupResizeLayout(bookmarkId, popup, session) {
  if (!bookmarkId || !popup) {
    return;
  }

  const rawWidth = session && Number.isFinite(session.pendingWidth)
    ? session.pendingWidth
    : popup.getBoundingClientRect().width;
  const rawHeight = session && Number.isFinite(session.pendingHeight)
    ? session.pendingHeight
    : popup.getBoundingClientRect().height;
  const width = getClampedPopupWidth(rawWidth, popup);
  const height = getClampedPopupHeight(rawHeight, popup, width);
  setPopupLayout(bookmarkId, width, height, {
    popup: popup
  });
  applyPopupLayoutToElement(popup, bookmarkId);
}

export function setPopupLayout(bookmarkId, width, height, options) {
  if (!bookmarkId) {
    return false;
  }

  const nextOptions = options || {};
  const clampedWidth = getClampedPopupWidth(width, nextOptions.popup || null);
  const nextLayout = {
    width: clampedWidth,
    height: nextOptions.viewportOnly
      ? getViewportClampedPopupHeight(height)
      : getClampedPopupHeight(height, nextOptions.popup || null, clampedWidth)
  };
  const currentLayout = getPopupLayout(bookmarkId);
  if (currentLayout && currentLayout.width === nextLayout.width && currentLayout.height === nextLayout.height) {
    return false;
  }

  state.popupLayoutByBookmarkId = Object.assign({}, state.popupLayoutByBookmarkId, {
    [bookmarkId]: nextLayout
  });
  return true;
}

// ============================================================
// GROUP 18 — Popup layout/overflow
// ============================================================

export function applyPopupLayoutToElement(popup, bookmarkId, options) {
  if (!popup) {
    return;
  }

  const nextOptions = options || {};
  const layout = getPopupLayout(bookmarkId);
  const width = layout ? getClampedPopupWidth(layout.width, popup) : null;
  const height = layout
    ? (
      nextOptions.viewportOnly
        ? getViewportClampedPopupHeight(layout.height)
        : getClampedPopupHeight(layout.height, popup, width)
    )
    : null;
  popup.dataset.bookmarkId = bookmarkId || "";
  popup.classList.toggle("has-custom-size", Boolean(layout));
  popup.style.width = layout ? width + "px" : "";
  popup.style.height = layout ? height + "px" : "";
  syncRailViewportWidth();
  schedulePopupOverflowIndicatorSync(popup);
}

export function schedulePopupOverflowIndicatorSync(popup) {
  if (!popup || popup.__cgptbmOverflowFrame) {
    return;
  }

  popup.__cgptbmOverflowFrame = window.requestAnimationFrame(function () {
    popup.__cgptbmOverflowFrame = 0;
    syncPopupOverflowIndicator(popup);
  });
}

export function syncPopupOverflowIndicator(popup) {
  if (!popup) {
    return;
  }

  const bookmarkId = popup.dataset.bookmarkId || "";
  const popupMoreButton = popup.querySelector('[data-popup-action="more"]');
  const popupMinButton = popup.querySelector('[data-popup-action="min"]');
  const popupBody = popup.querySelector(".cgptbm-tab__popup-body");
  if (!popupBody) {
    popup.classList.remove("has-hidden-overflow", "is-content-expanded");
    if (popupMoreButton) {
      popupMoreButton.hidden = true;
    }
    if (popupMinButton) {
      popupMinButton.hidden = true;
    }
    return;
  }

  const hasOverflow = popupBody.scrollHeight > popupBody.clientHeight + 1;
  const isExpanded = isPopupContentExpanded(bookmarkId);
  const layout = getPopupLayout(bookmarkId);
  const isLargerThanMinimum = Boolean(
    layout &&
    (
      layout.width > POPUP_MIN_WIDTH + 1 ||
      layout.height > POPUP_MIN_HEIGHT + 1
    )
  );
  const showMin = isExpanded || isLargerThanMinimum;
  popup.classList.toggle("has-hidden-overflow", hasOverflow);
  popup.classList.toggle("is-content-expanded", isExpanded);

  if (popupMoreButton) {
    popupMoreButton.hidden = !hasOverflow;
    popupMoreButton.textContent = "more...";
    popupMoreButton.title = "Expand note";
    popupMoreButton.setAttribute("aria-label", "Expand note");
  }
  if (popupMinButton) {
    popupMinButton.hidden = !showMin;
    popupMinButton.textContent = "min";
    popupMinButton.title = "Collapse note";
    popupMinButton.setAttribute("aria-label", "Collapse note");
  }
}

export async function handlePopupContentExpand(bookmarkId, popup, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!bookmarkId || !popup) {
    return;
  }

  const expandedWidth = getPopupContentMaxWidth(popup);
  const expandedHeight = getClampedPopupHeight(getPopupContentMaxHeight(popup, expandedWidth), popup, expandedWidth);
  setPopupContentExpanded(bookmarkId, true);
  setPopupLayout(bookmarkId, expandedWidth, expandedHeight, {
    popup: popup
  });
  applyPopupLayoutToElement(popup, bookmarkId);

  applyPopupResizeLocalLayout(bookmarkId);
  syncRailViewportWidth();
  schedulePopupOverflowIndicatorSync(popup);
  await persistBookmarkUiState();
  await persistPopupLayouts();
}

export async function handlePopupContentMinimize(bookmarkId, popup, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!bookmarkId || !popup) {
    return;
  }

  setPopupContentExpanded(bookmarkId, false);
  setPopupLayout(bookmarkId, POPUP_MIN_WIDTH, POPUP_MIN_HEIGHT, {
    popup: popup
  });
  applyPopupLayoutToElement(popup, bookmarkId);
  applyPopupResizeLocalLayout(bookmarkId);
  syncRailViewportWidth();
  schedulePopupOverflowIndicatorSync(popup);
  await persistBookmarkUiState();
  await persistPopupLayouts();
}

export function resetExpandedBookmarkState() {
  state.hoveredBookmarkId = "";
  state.focusedBookmarkId = "";
  state.createPopupPreservedExpandedBookmarkId = "";
  state.pinnedBookmarkIds = [];
  state.expandedPinnedBookmarkIds = [];
  state.expandedBookmarkId = "";
  state.resizeLockedExpandedBookmarkId = "";
}

// ============================================================
// GROUP 19 — Tab element creation
// ============================================================

export function createTabElement(options) {
  const tab = document.createElement("div");
  tab.className = "cgptbm-tab";
  tab.style.setProperty("--cgptbm-accent", options.accent);
  tab.style.setProperty("--cgptbm-surface-height", COLLAPSED_TAB_HEIGHT + "px");
  tab.style.setProperty("--cgptbm-collapsed-left-hover-zone-width", COLLAPSED_TAB_LEFT_HOVER_ZONE_WIDTH + "px");

  const surfaceClip = document.createElement("span");
  surfaceClip.className = "cgptbm-tab__surface-clip";

  const surface = document.createElement("span");
  surface.className = "cgptbm-tab__surface";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cgptbm-tab__button";
  if (options.title) {
    button.title = options.title;
  }
  button.setAttribute("aria-label", options.label || "Bookmark");

  const edge = document.createElement("span");
  edge.className = "cgptbm-tab__edge";
  edge.textContent = options.edgeText;

  const main = document.createElement("span");
  main.className = "cgptbm-tab__main";

  const leftActions = document.createElement("span");
  leftActions.className = "cgptbm-tab__actions cgptbm-tab__actions--left";

  const content = document.createElement("span");
  content.className = "cgptbm-tab__content";

  const label = document.createElement("span");
  label.className = "cgptbm-tab__label";
  label.textContent = options.label;

  content.appendChild(label);

  button.appendChild(content);
  const rightActions = document.createElement("span");
  rightActions.className = "cgptbm-tab__actions cgptbm-tab__actions--right";
  surface.appendChild(edge);

  function buildActionButton(action) {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "cgptbm-tab__action";
    if (action.className) {
      actionButton.classList.add(action.className);
    }
    if (action.isSelected) {
      actionButton.classList.add("is-selected");
    }
    if (action.key) {
      actionButton.dataset.actionKey = action.key;
    }
    actionButton.title = action.title || action.label;
    actionButton.setAttribute("aria-label", action.title || action.label);
    renderTabActionButtonContent(actionButton, action);
    actionButton.addEventListener("mousedown", function (event) {
      preventFocusSteal(event);
      event.stopPropagation();
    });
    actionButton.addEventListener("click", function (event) {
      event.stopPropagation();
      action.onClick(event);
    });
    return actionButton;
  }

  if (Array.isArray(options.actions) && options.actions.length) {
    options.actions.forEach(function (action) {
      const actionButton = buildActionButton(action);
      if (action.className === "cgptbm-tab__action--delete") {
        actionButton.classList.add("cgptbm-tab__delete-orb");
        const deleteZone = document.createElement("span");
        deleteZone.className = "cgptbm-tab__delete-zone";
        deleteZone.appendChild(actionButton);
        tab.appendChild(deleteZone);
        return;
      }
      if (action.className === "cgptbm-tab__action--edit") {
        leftActions.appendChild(actionButton);
        return;
      }
      rightActions.appendChild(actionButton);
    });
  }

  if (leftActions.children.length) {
    main.appendChild(leftActions);
  }
  main.appendChild(button);
  surface.appendChild(main);

  const collapsedHoverZone = document.createElement("span");
  collapsedHoverZone.className = "cgptbm-tab__collapsed-hover-zone";
  tab.appendChild(collapsedHoverZone);
  surfaceClip.appendChild(surface);
  tab.appendChild(surfaceClip);
  if (rightActions.children.length) {
    tab.appendChild(rightActions);
  }

  if (options.popupText) {
    const popup = createTabPopupElement(options);
    if (popup) {
      tab.appendChild(popup);
    }
  }

  return tab;
}

export function renderTabActionButtonContent(button, action) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const nextAction = action || {};
  const label = typeof nextAction.label === "string" ? nextAction.label : "";
  const icon = typeof nextAction.icon === "string" ? nextAction.icon : "";

  button.textContent = "";
  button.classList.toggle("cgptbm-tab__action--has-icon", Boolean(icon));

  if (!icon) {
    button.textContent = label;
    return;
  }

  const iconElement = buildTabActionIcon(icon);
  if (!iconElement) {
    button.textContent = label;
    button.classList.remove("cgptbm-tab__action--has-icon");
    return;
  }

  button.appendChild(iconElement);
}

export function buildTabActionIcon(icon) {
  const iconType = String(icon || "");
  if (!iconType) {
    return null;
  }

  const svg = createSvgElement("svg", {
    viewBox: "0 0 16 16",
    "aria-hidden": "true",
    class: "cgptbm-tab__action-icon cgptbm-tab__action-icon--" + iconType
  });

  if (iconType === "expand-pin") {
    svg.appendChild(createSvgElement("path", {
      d: "M8 1.6C10.08 1.6 11.45 2.7 11.45 4.04C11.45 4.67 11.15 5.24 10.6 5.64L10.32 7.72L11.95 8.98C12.26 9.22 12.09 9.72 11.7 9.72H8.82V13.08C8.82 13.44 8.46 13.72 8 13.72C7.54 13.72 7.18 13.44 7.18 13.08V9.72H4.3C3.91 9.72 3.74 9.22 4.05 8.98L5.68 7.72L5.4 5.64C4.85 5.24 4.55 4.67 4.55 4.04C4.55 2.7 5.92 1.6 8 1.6Z",
      fill: "currentColor"
    }));
    svg.appendChild(createSvgElement("ellipse", {
      cx: "8",
      cy: "4.02",
      rx: "2.25",
      ry: "1.14",
      fill: "rgba(255,255,255,0.28)"
    }));
    return svg;
  }

  if (iconType === "edit") {
    svg.appendChild(createSvgElement("path", {
      d: "M11.62 2.18C12.11 1.69 12.9 1.69 13.39 2.18L13.82 2.61C14.31 3.1 14.31 3.89 13.82 4.38L7.02 11.18L4.23 11.77L4.82 8.98L11.62 2.18Z",
      fill: "currentColor"
    }));
    svg.appendChild(createSvgElement("path", {
      d: "M10.85 2.95L13.05 5.15L12.36 5.84L10.16 3.64L10.85 2.95Z",
      fill: "rgba(255,255,255,0.34)"
    }));
    svg.appendChild(createSvgElement("path", {
      d: "M4.23 11.77L5.76 11.44L4.56 10.24L4.23 11.77Z",
      fill: "#f8fafc"
    }));
    return svg;
  }

  return null;
}

export function createTabPopupElement(options) {
  if (!options || !options.popupText) {
    return null;
  }

  const popup = document.createElement("div");
  popup.className = "cgptbm-tab__popup";

  const popupHeader = document.createElement("div");
  popupHeader.className = "cgptbm-tab__popup-header";

  const popupTitle = document.createElement("div");
  popupTitle.className = "cgptbm-tab__popup-title";
  popupTitle.textContent = options.popupTitle || options.label || "Bookmark";
  popupHeader.appendChild(popupTitle);

  const popupActions = document.createElement("div");
  popupActions.className = "cgptbm-tab__popup-actions";

  const popupMoreButton = document.createElement("button");
  popupMoreButton.type = "button";
  popupMoreButton.className = "cgptbm-tab__popup-action";
  popupMoreButton.dataset.popupAction = "more";
  popupMoreButton.hidden = true;
  popupMoreButton.onmousedown = function (event) {
    preventFocusSteal(event);
    event.stopPropagation();
  };
  popupMoreButton.onclick = function (event) {
    handlePopupContentExpand(options.popupBookmarkId || "", popup, event);
  };
  popupActions.appendChild(popupMoreButton);

  const popupMinButton = document.createElement("button");
  popupMinButton.type = "button";
  popupMinButton.className = "cgptbm-tab__popup-action";
  popupMinButton.dataset.popupAction = "min";
  popupMinButton.hidden = true;
  popupMinButton.onmousedown = function (event) {
    preventFocusSteal(event);
    event.stopPropagation();
  };
  popupMinButton.onclick = function (event) {
    handlePopupContentMinimize(options.popupBookmarkId || "", popup, event);
  };
  popupActions.appendChild(popupMinButton);

  popupHeader.appendChild(popupActions);

  const popupBody = document.createElement("div");
  popupBody.className = "cgptbm-tab__popup-body";
  popupBody.textContent = options.popupText;
  popupBody.addEventListener("scroll", function () {
    syncPopupOverflowIndicator(popup);
  }, { passive: true });

  const popupResize = document.createElement("button");
  popupResize.type = "button";
  popupResize.className = "cgptbm-tab__popup-resize";
  popupResize.title = "Resize note";
  popupResize.setAttribute("aria-label", "Resize note");
  popupResize.onmousedown = preventFocusSteal;
  popupResize.onpointerdown = function (event) {
    beginPopupResizeSession(options.popupBookmarkId || "", popup, event);
  };

  popup.appendChild(popupHeader);
  popup.appendChild(popupBody);
  popup.appendChild(popupResize);
  applyPopupLayoutToElement(popup, options.popupBookmarkId || "");
  schedulePopupOverflowIndicatorSync(popup);
  return popup;
}

export function syncTabPopupElement(tab, options) {
  if (!tab) {
    return;
  }

  const existingPopup = tab.querySelector(".cgptbm-tab__popup");
  if (!options || !options.popupText) {
    if (existingPopup) {
      setPopupContentExpanded(tab.dataset.bookmarkId || "", false);
      existingPopup.remove();
    }
    return;
  }

  const popup = existingPopup || createTabPopupElement(options);
  if (!popup) {
    return;
  }

  if (!existingPopup) {
    tab.appendChild(popup);
    return;
  }

  const popupTitle = popup.querySelector(".cgptbm-tab__popup-title");
  const popupBody = popup.querySelector(".cgptbm-tab__popup-body");
  let popupActions = popup.querySelector(".cgptbm-tab__popup-actions");
  let popupMoreButton = popup.querySelector('[data-popup-action="more"]');
  let popupMinButton = popup.querySelector('[data-popup-action="min"]');
  if (popupTitle) {
    popupTitle.textContent = options.popupTitle || options.label || "Bookmark";
  }
  if (popupBody) {
    popupBody.textContent = options.popupText;
  }
  delete popup.__cgptbmContentMaxWidth;
  applyPopupLayoutToElement(popup, options.popupBookmarkId || "");
  let popupResize = popup.querySelector(".cgptbm-tab__popup-resize");

  if (!popupResize) {
    popupResize = document.createElement("button");
    popupResize.type = "button";
    popupResize.className = "cgptbm-tab__popup-resize";
    popupResize.title = "Resize note";
    popupResize.setAttribute("aria-label", "Resize note");
    popup.appendChild(popupResize);
  }
  if (!popupActions) {
    popupActions = document.createElement("div");
    popupActions.className = "cgptbm-tab__popup-actions";
    const popupHeader = popup.querySelector(".cgptbm-tab__popup-header");
    if (popupHeader) {
      popupHeader.appendChild(popupActions);
    } else {
      popup.appendChild(popupActions);
    }
  }
  if (!popupMoreButton) {
    popupMoreButton = document.createElement("button");
    popupMoreButton.type = "button";
    popupMoreButton.className = "cgptbm-tab__popup-action";
    popupMoreButton.dataset.popupAction = "more";
    popupMoreButton.hidden = true;
    popupMoreButton.onmousedown = function (event) {
      preventFocusSteal(event);
      event.stopPropagation();
    };
    popupActions.appendChild(popupMoreButton);
  }
  if (!popupMinButton) {
    popupMinButton = document.createElement("button");
    popupMinButton.type = "button";
    popupMinButton.className = "cgptbm-tab__popup-action";
    popupMinButton.dataset.popupAction = "min";
    popupMinButton.hidden = true;
    popupMinButton.onmousedown = function (event) {
      preventFocusSteal(event);
      event.stopPropagation();
    };
    popupActions.appendChild(popupMinButton);
  }
  popupMoreButton.onclick = function (event) {
    handlePopupContentExpand(options.popupBookmarkId || "", popup, event);
  };
  popupMinButton.onclick = function (event) {
    handlePopupContentMinimize(options.popupBookmarkId || "", popup, event);
  };
  if (popupResize) {
    popupResize.onmousedown = preventFocusSteal;
    popupResize.onpointerdown = function (event) {
      beginPopupResizeSession(options.popupBookmarkId || "", popup, event);
    };
  }
  schedulePopupOverflowIndicatorSync(popup);
}

// ============================================================
// GROUP 20 — Active/pulse feedback
// ============================================================

export function pulseTab(bookmarkId) {
  state.activeBookmarkId = bookmarkId;
  syncRenderedBookmarkRail();
  window.clearTimeout(state.activeTimer);
  state.activeTimer = window.setTimeout(clearActiveState, 1400);
}

export function syncRenderedActiveBookmarkState() {
  if (!state.layer) {
    return;
  }

  Array.from(state.layer.querySelectorAll(".cgptbm-tab[data-bookmark-id]")).forEach(function (tab) {
    const bookmarkId = tab.dataset.bookmarkId || "";
    tab.classList.toggle("is-active", bookmarkId === state.activeBookmarkId);
  });
}

export function pulseRenderedBookmarkTab(bookmarkId) {
  state.activeBookmarkId = bookmarkId;
  syncRenderedActiveBookmarkState();
  window.clearTimeout(state.activeTimer);
  state.activeTimer = window.setTimeout(clearRenderedActiveState, 1400);
}

function clearRenderedActiveState() {
  if (!state.activeBookmarkId) {
    return;
  }
  state.activeBookmarkId = "";
  syncRenderedActiveBookmarkState();
}

export function clearActiveState() {
  if (!state.activeBookmarkId) {
    return;
  }
  state.activeBookmarkId = "";
  syncRenderedBookmarkRail();
}

export function showAddTabSuccess() {
  if (!state.addTab) {
    return;
  }

  const edge = state.addTab.querySelector(".cgptbm-tab__edge");
  const label = state.addTab.querySelector(".cgptbm-tab__label");
  if (!edge || !label) {
    return;
  }

  window.clearTimeout(state.addTabFeedbackTimer);
  state.addTab.classList.add("is-success", "is-active");
  edge.textContent = "\u2713";
  label.textContent = ADD_TAB_SUCCESS_LABEL;
  state.addTabFeedbackTimer = window.setTimeout(resetAddTabFeedback, 1400);
}

export function resetAddTabFeedback() {
  if (!state.addTab) {
    return;
  }

  const edge = state.addTab.querySelector(".cgptbm-tab__edge");
  const label = state.addTab.querySelector(".cgptbm-tab__label");
  if (edge) {
    edge.textContent = "+";
  }
  if (label) {
    label.textContent = ADD_TAB_DEFAULT_LABEL;
  }
  state.addTab.classList.remove("is-success", "is-active");
  window.clearTimeout(state.addTabFeedbackTimer);
  state.addTabFeedbackTimer = 0;
}

// ============================================================
// Re-export for external consumers
// ============================================================

export { getDisplayOrderedBookmarks };
export { handleBookmarkClick };
export { handleBookmarkEdit };
