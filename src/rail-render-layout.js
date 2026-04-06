// ============================================================
// rail-render-layout.js — Layout and measurement helpers for rendered tabs
// ============================================================
// Extracted from rail-render.js during Phase F1 refinement.
// Contains positioned tab calculations, layout measurement helpers,
// rendered height and popup-bottom helpers.

import state from './state.js';
import { clamp } from './text.js';
import {
  COLLAPSED_TAB_HEIGHT,
  TAB_STACK_GAP, TAB_POPUP_OFFSET
} from './constants.js';
import {
  getBookmarkTabTopLimit
} from './rail-viewport.js';

// ============================================================
// Local constants
// ============================================================

const TAB_POPUP_CLEARANCE = 16;

// ============================================================
// Layout snapshot
// ============================================================

export function buildRenderedTabLayoutSnapshot(bookmarks, excludedBookmarkId, deps) {
  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const getOrderedBookmarkTabs = deps && deps.getOrderedBookmarkTabs;
  const tabs = getOrderedBookmarkTabs ? getOrderedBookmarkTabs() : [];
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

// ============================================================
// Positioned tab sync
// ============================================================

export function syncPositionedRenderedBookmarkTabs(positionedBookmarks, layoutByBookmarkId, expandedBookmarkId, deps) {
  if (!state.layer) {
    return;
  }

  const entries = Array.isArray(positionedBookmarks) ? positionedBookmarks : [];
  const layoutMap = layoutByBookmarkId && typeof layoutByBookmarkId === "object" ? layoutByBookmarkId : {};
  const getOrderedBookmarkTabs = deps && deps.getOrderedBookmarkTabs;
  const tabs = getOrderedBookmarkTabs ? getOrderedBookmarkTabs() : [];
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

// ============================================================
// Stack order
// ============================================================

export function syncRenderedBookmarkTabStackOrder(bookmarks, expandedBookmarkId, deps) {
  if (!state.layer) {
    return;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const getOrderedBookmarkTabs = deps && deps.getOrderedBookmarkTabs;
  const tabs = getOrderedBookmarkTabs ? getOrderedBookmarkTabs() : [];
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

// ============================================================
// Anchored tail layout
// ============================================================

export function syncAnchoredRenderedBookmarkTailLayout(bookmarks, layoutByBookmarkId, startIndex, options, deps) {
  if (!state.layer) {
    return false;
  }

  const orderedBookmarks = Array.isArray(bookmarks) ? bookmarks : [];
  const layoutMap = layoutByBookmarkId && typeof layoutByBookmarkId === "object" ? layoutByBookmarkId : {};
  if (!orderedBookmarks.length) {
    return false;
  }

  const getOrderedBookmarkTabs = deps && deps.getOrderedBookmarkTabs;
  const tabs = getOrderedBookmarkTabs ? getOrderedBookmarkTabs() : [];
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

  syncRenderedBookmarkTabStackOrder(orderedBookmarks, expandedBookmarkId, deps);
  return true;
}

// ============================================================
// Tab position computation
// ============================================================

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

// ============================================================
// Tab measurement
// ============================================================

export function measureRenderedTabLayout(tab, options) {
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
    const surfaceHeight = COLLAPSED_TAB_HEIGHT;
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
// Height / popup-bottom helpers
// ============================================================

export function getRenderedTabHeight(tab) {
  if (!tab) {
    return COLLAPSED_TAB_HEIGHT;
  }

  return Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(tab.getBoundingClientRect().height || 0));
}

export function getRenderedSurfaceHeight(tab) {
  if (!tab) {
    return COLLAPSED_TAB_HEIGHT;
  }

  const surface = tab.querySelector(".cgptbm-tab__surface");
  return Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(surface ? surface.getBoundingClientRect().height || 0 : 0));
}

export function getRenderedPopupBottom(tab) {
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

// ============================================================
// Apply measured layout to a tab element
// ============================================================

export function applyMeasuredTabLayout(tab, top, layout) {
  if (!tab || !layout) {
    return;
  }

  tab.style.setProperty("--cgptbm-surface-height", Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(layout.surfaceHeight)) + "px");
  tab.style.top = Math.round(top) + "px";
  tab.style.height = Math.max(COLLAPSED_TAB_HEIGHT, Math.ceil(layout.totalHeight)) + "px";
}
