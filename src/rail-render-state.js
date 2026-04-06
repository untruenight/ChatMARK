// ============================================================
// rail-render-state.js — Render-side visuals, expansion/pin state, active feedback
// ============================================================
// Extracted from rail-render.js during Phase F3 refinement.
// Contains GROUP 5 (Interaction reconciliation), GROUP 14 (Interaction visuals),
// GROUP 15 (Expansion/pinning), GROUP 20 (Active/pulse feedback).

import state from './state.js';
import {
  ADD_TAB_DEFAULT_LABEL, ADD_TAB_SUCCESS_LABEL
} from './constants.js';
import {
  isBookmarkPopupPinned, isBookmarkExpansionPinned,
  togglePinnedBookmark
} from './ui-state.js';
import { formatPopupDisplayText, isCodeAnchor } from './capture.js';
import {
  canReorderBookmarkTabs
} from './rail-dnd.js';
import {
  renderTabActionButtonContent,
  syncTabPopupElement,
  extractResolvedSelectionText,
  releaseResizeLockedExpandedBookmarkForInteraction
} from './rail-popup-tab.js';
import {
  isBookmarkSearchMatched
} from './rail-search.js';
import {
  isBookmarkColorPickerEnabled
} from './popup.js';

// ============================================================
// Deps — injected from rail-render.js to avoid circular imports
// ============================================================

var _deps = {
  syncRenderedBookmarkRail: null,
  getOrderedBookmarkTabs: null
};

export function initRenderState(deps) {
  if (!deps || typeof deps !== "object") {
    return;
  }

  Object.keys(_deps).forEach(function (key) {
    if (typeof deps[key] === "function") {
      _deps[key] = deps[key];
    }
  });
}

// ============================================================
// GROUP 5 — Interaction reconciliation
// ============================================================

export function reconcileRenderedBookmarkInteractionState() {
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
    if (_deps.syncRenderedBookmarkRail) {
      _deps.syncRenderedBookmarkRail({ lightweight: true });
    }
  }
}

function getRenderedHoveredBookmarkId() {
  const tabs = _deps.getOrderedBookmarkTabs ? _deps.getOrderedBookmarkTabs() : [];
  for (let index = 0; index < tabs.length; index += 1) {
    const tab = tabs[index];
    if (tab && typeof tab.matches === "function" && tab.matches(":hover")) {
      return tab.dataset.bookmarkId || "";
    }
  }

  return "";
}

function getRenderedFocusedBookmarkId() {
  const tabs = _deps.getOrderedBookmarkTabs ? _deps.getOrderedBookmarkTabs() : [];
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
// GROUP 14 — Interaction visuals
// ============================================================

export function syncRenderedBookmarkInteractionVisuals(tabs) {
  if (!state.layer) {
    return;
  }

  const orderedTabs = Array.isArray(tabs) && tabs.length ? tabs : (_deps.getOrderedBookmarkTabs ? _deps.getOrderedBookmarkTabs() : []);
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

export function setHoveredBookmark(bookmarkId) {
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

export function clearHoveredBookmark(bookmarkId) {
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

export function setFocusedBookmark(bookmarkId) {
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

export function clearFocusedBookmark(bookmarkId) {
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
    if (_deps.syncRenderedBookmarkRail) {
      _deps.syncRenderedBookmarkRail(shouldRunFullSync ? null : { lightweight: true });
    }
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
      isBookmarkExpansionPinned(bookmarkId) ||
      isBookmarkSearchMatched(bookmarkId)
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

export function syncRenderedPinnedPopups(tabById, bookmarkById) {
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
// GROUP 20 — Active/pulse feedback
// ============================================================

export function pulseTab(bookmarkId) {
  state.activeBookmarkId = bookmarkId;
  if (_deps.syncRenderedBookmarkRail) {
    _deps.syncRenderedBookmarkRail();
  }
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
  if (_deps.syncRenderedBookmarkRail) {
    _deps.syncRenderedBookmarkRail();
  }
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
// Create interaction guard — shared with rail-render.js
// ============================================================

export function isBookmarkCreateInteractionGuardActive() {
  return state.bookmarkCreateInteractionGuardCount > 0;
}
