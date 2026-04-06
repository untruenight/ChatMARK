// ============================================================
// rail-popup-geometry.js — Popup geometry, sizing, resize, overflow
// ============================================================
// Extracted from rail-popup-tab.js during Phase E1 refinement.
// Contains popup positioning, resize session, layout persistence,
// overflow indicator, expand/minimize, and resize-lock helpers.

import state from './state.js';
import { clamp } from './text.js';
import {
  COLLAPSED_TAB_HEIGHT, TAB_STACK_GAP,
  POPUP_MIN_WIDTH, POPUP_MIN_HEIGHT
} from './constants.js';
import {
  normalizePopupLayout, getPopupViewportMaxWidth, getPopupContentMaxWidth,
  getClampedPopupWidth, getViewportClampedPopupHeight, getPopupContentMaxHeight,
  getClampedPopupHeight
} from './popup.js';
import { persistBookmarkUiState, persistPopupLayouts } from './ui-state.js';
import { syncRailViewportOverflow, syncRailViewportWidth } from './rail-viewport.js';

// ============================================================
// Callback reference (shared from rail-popup-tab.js via _initPopupGeometry)
// ============================================================

var _callbacks = {};

export function _initPopupGeometry(callbacks) {
  _callbacks = callbacks;
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
    const popup = state.layer.querySelector('.cgptbm-tab__popup[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]');
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

  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(bookmarkId) + '"]');
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

  const tab = state.layer.querySelector('.cgptbm-tab[data-bookmark-id="' + CSS.escape(state.resizeSettlingBookmarkId) + '"]');
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
  if (_callbacks.onSyncExpandedBookmarkState) {
    _callbacks.onSyncExpandedBookmarkState();
  }
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
// GROUP 11 (partial) — Popup resize local layout
// ============================================================

export function applyPopupResizeLocalLayout(bookmarkId) {
  if (!bookmarkId) {
    if (_callbacks.onSyncRail) {
      _callbacks.onSyncRail();
    }
    return;
  }

  const tabs = _callbacks.getOrderedBookmarkTabs ? _callbacks.getOrderedBookmarkTabs() : [];
  if (!tabs.length) {
    return;
  }

  const anchorIndex = tabs.findIndex(function (tab) {
    return (tab.dataset.bookmarkId || "") === bookmarkId;
  });
  if (anchorIndex < 0) {
    if (_callbacks.onSyncRail) {
      _callbacks.onSyncRail();
    }
    return;
  }

  const anchorTab = tabs[anchorIndex];
  const anchorTop = Number.parseFloat(anchorTab.style.top);
  const nextAnchorTop = Number.isFinite(anchorTop) ? anchorTop : 70;
  const anchorSurfaceHeight = _callbacks.getRenderedSurfaceHeight ? _callbacks.getRenderedSurfaceHeight(anchorTab) : COLLAPSED_TAB_HEIGHT;
  const anchorTotalHeight = _callbacks.getRenderedPopupBottom ? _callbacks.getRenderedPopupBottom(anchorTab) : COLLAPSED_TAB_HEIGHT;

  anchorTab.style.setProperty("--cgptbm-surface-height", Math.max(COLLAPSED_TAB_HEIGHT, anchorSurfaceHeight) + "px");
  anchorTab.style.height = Math.max(COLLAPSED_TAB_HEIGHT, anchorTotalHeight) + "px";

  let cursorTop = nextAnchorTop + Math.max(COLLAPSED_TAB_HEIGHT, anchorTotalHeight) + TAB_STACK_GAP;
  for (let index = anchorIndex + 1; index < tabs.length; index += 1) {
    const tab = tabs[index];
    const currentHeight = _callbacks.getRenderedTabHeight ? _callbacks.getRenderedTabHeight(tab) : COLLAPSED_TAB_HEIGHT;
    tab.style.top = Math.round(cursorTop) + "px";
    cursorTop += currentHeight + TAB_STACK_GAP;
  }

  syncRailViewportOverflow();
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
  const isExpanded = _callbacks.isPopupContentExpanded ? _callbacks.isPopupContentExpanded(bookmarkId) : false;
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
    const isResized = !isExpanded && isLargerThanMinimum;
    popupMoreButton.hidden = !hasOverflow && !isResized;
    popupMoreButton.textContent = "max";
    popupMoreButton.title = "Maximize note";
    popupMoreButton.setAttribute("aria-label", "Maximize note");
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
  const expandedHeight = getViewportClampedPopupHeight(getPopupContentMaxHeight(popup, expandedWidth));
  if (_callbacks.setPopupContentExpanded) {
    _callbacks.setPopupContentExpanded(bookmarkId, true);
  }
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

  if (_callbacks.setPopupContentExpanded) {
    _callbacks.setPopupContentExpanded(bookmarkId, false);
  }
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
