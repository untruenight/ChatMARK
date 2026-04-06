// ============================================================
// rail-dnd.js — Bookmark drag-and-drop reorder
// ============================================================
// Extracted from rail.js during Phase A modularization.
// Contains GROUP 13 (Drag reorder).

import state from './state.js';
import { clamp } from './text.js';
import { COLLAPSED_TAB_HEIGHT, TAB_STACK_GAP } from './constants.js';
import { normalizeManualOrderBookmarkIds, persistBookmarkUiState } from './ui-state.js';
import { pushUndoBookmarkHistory, buildStateChangeEntry } from './history.js';
import { getBookmarkTabTopLimit } from './rail-viewport.js';

// ============================================================
// Callback registry (injected via initDnd)
// ============================================================

var _callbacks = {
  onSyncRail: null,
  getFilteredCurrentBookmarks: null,
  computeTabPositions: null,
  measureRenderedTabLayout: null,
  syncRenderedBookmarkTabDomOrder: null,
  getDisplayOrderedBookmarks: null,
  isInlineEditing: null
};

export function initDnd(callbacks) {
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
// Internal helpers (moved from rail.js)
// ============================================================

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
// GROUP 13 — Drag reorder
// ============================================================

export function canReorderBookmarkTabs() {
  return Boolean(
    state.railEnabled &&
    !state.bookmarkSearchQuery &&
    !state.popup &&
    !state.colorPicker &&
    !(_callbacks.isInlineEditing && _callbacks.isInlineEditing()) &&
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

export function consumeBookmarkDragSuppressedClick(bookmarkId) {
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

  if (_callbacks.onSyncRail) {
    _callbacks.onSyncRail({ lightweight: true });
  }
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

    const layout = _callbacks.measureRenderedTabLayout
      ? _callbacks.measureRenderedTabLayout(tab, { lightweight: true })
      : { totalHeight: Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(tab.getBoundingClientRect().height || 0)) };
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

  const visibleBookmarks = _callbacks.getFilteredCurrentBookmarks
    ? _callbacks.getFilteredCurrentBookmarks().filter(function (bookmark) {
      return bookmark && bookmark.id !== session.bookmarkId;
    })
    : [];
  const previewIndex = previewState && Number.isInteger(previewState.index)
    ? clamp(previewState.index, 0, visibleBookmarks.length)
    : 0;
  const previewGapHeight = Math.max(
    COLLAPSED_TAB_HEIGHT,
    Math.ceil(heightByBookmarkId[session.bookmarkId] || COLLAPSED_TAB_HEIGHT)
  );
  const positionedBookmarks = _callbacks.computeTabPositions
    ? _callbacks.computeTabPositions(visibleBookmarks, {
      expandedBookmarkId: state.expandedBookmarkId === session.bookmarkId ? "" : state.expandedBookmarkId,
      heightByBookmarkId: heightByBookmarkId,
      previewGapIndex: previewIndex,
      previewGapHeight: previewGapHeight
    })
    : [];

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

export function handleBookmarkTabPointerDown(bookmarkId, event) {
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

export function handleBookmarkDragPointerMove(event) {
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

export function syncBookmarkDragSessionVisual(session) {
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
  const getDisplayOrderedBookmarks = _callbacks.getDisplayOrderedBookmarks;
  if (!getDisplayOrderedBookmarks) {
    return;
  }

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

  pushUndoBookmarkHistory(buildStateChangeEntry("drag-reorder"));
  state.manualOrderBookmarkIds = normalizeManualOrderBookmarkIds(state.currentBookmarks, nextOrderedBookmarkIds);

  if (_callbacks.syncRenderedBookmarkTabDomOrder && _callbacks.getFilteredCurrentBookmarks) {
    _callbacks.syncRenderedBookmarkTabDomOrder(_callbacks.getFilteredCurrentBookmarks());
  }
  if (_callbacks.onSyncRail) {
    _callbacks.onSyncRail({ lightweight: true });
  }
  await persistBookmarkUiState();
}
