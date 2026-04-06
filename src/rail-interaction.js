// ============================================================
// rail-interaction.js — Document interaction handlers (Phase D)
// ============================================================
// GROUP 1: bookmark click, inline edit, document pointer/focus/wheel handlers.
// Extracted from rail.js; receives cross-module deps via initInteraction().

import state from './state.js';
import { normalizeText, fingerprintText } from './text.js';
import { getScopeRoot, collectAnchorBlocks, getElementText, findMessageContainer } from './dom.js';
import { formatPopupDisplayText, isCodeAnchor } from './capture.js';
import { closeSavePopup, closeBookmarkColorPicker } from './popup.js';
import { hideSelectionTrigger, isEditableTextSelectionTarget } from './selection.js';
import { isFrameRelayAnchor, requestFrameBookmarkReveal } from './bridge.js';
import {
  isSandboxCardAnchor, rememberClaudeSandboxCardCandidateFromElement,
  isClaudeSandboxCardContext, getClaudeSandboxCardCandidateAtPoint,
  scheduleSandboxCardTriggerRender
} from './sandbox-card.js';
import { resolveBookmarkTarget } from './resolve.js';
import {
  scheduleTargetHighlight, scrollResolvedMatchIntoView,
  isTargetComfortablyVisible, resolvePreferredHighlightMatch
} from './highlight.js';
import {
  beginHiddenScrollTransaction, finishHiddenScrollTransaction,
  getOutputScrollBehavior
} from './scroll.js';
import { updateBookmarkLabel } from './bookmarks.js';

// ============================================================
// Callback slots (injected via initInteraction)
// ============================================================

var _cb = {
  syncExpandedBookmarkState: null,
  pulseTab: null,
  releaseResizeLockedExpandedBookmarkForInteraction: null,
  maybeReleaseResizeLockedExpandedBookmark: null,
  handleRailViewportWheel: null,
  clearBookmarkDragSession: null,
  handleBookmarkDragPointerMove: null
};

export function initInteraction(callbacks) {
  _cb.syncExpandedBookmarkState = callbacks.syncExpandedBookmarkState;
  _cb.pulseTab = callbacks.pulseTab;
  _cb.releaseResizeLockedExpandedBookmarkForInteraction = callbacks.releaseResizeLockedExpandedBookmarkForInteraction;
  _cb.maybeReleaseResizeLockedExpandedBookmark = callbacks.maybeReleaseResizeLockedExpandedBookmark;
  _cb.handleRailViewportWheel = callbacks.handleRailViewportWheel;
  _cb.clearBookmarkDragSession = callbacks.clearBookmarkDragSession;
  _cb.handleBookmarkDragPointerMove = callbacks.handleBookmarkDragPointerMove;
}

// ============================================================
// Helpers
// ============================================================

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
// Bookmark click
// ============================================================

export async function handleBookmarkClick(bookmarkId) {
  if (_cb.releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId)) {
    _cb.syncExpandedBookmarkState();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });

  if (!bookmark) {
    return;
  }

  await beginHiddenScrollTransaction();

  if (isFrameRelayAnchor(bookmark.anchor)) {
    _cb.pulseTab(bookmarkId);
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
    _cb.pulseTab(bookmarkId);
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
  _cb.pulseTab(bookmarkId);
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

// ============================================================
// Inline label edit
// ============================================================

var _inlineEditCommitting = false;
var _inlineEditBookmarkId = "";

function enterInlineEdit(tab, bookmarkId, currentLabel) {
  if (_inlineEditBookmarkId) {
    commitInlineEdit();
  }
  _inlineEditBookmarkId = bookmarkId;

  const main = tab.querySelector(".cgptbm-tab__main");
  const label = tab.querySelector(".cgptbm-tab__label");
  if (!main || !label) return;

  label.style.visibility = "hidden";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cgptbm-tab__inline-edit";
  input.value = currentLabel;
  input.dataset.bookmarkId = bookmarkId;
  input.dataset.originalValue = currentLabel;

  input.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitInlineEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineEdit();
    }
  });
  input.addEventListener("mousedown", function (e) { e.stopPropagation(); });
  input.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  input.addEventListener("click", function (e) { e.stopPropagation(); });
  // blur = cancel (not save)
  input.addEventListener("blur", function () {
    if (!_inlineEditCommitting) {
      cancelInlineEdit();
    }
  });

  const hint = document.createElement("span");
  hint.className = "cgptbm-tab__inline-edit-hint";
  hint.textContent = "Enter: save \u00B7 Esc: cancel";

  main.appendChild(input);
  main.appendChild(hint);
  input.focus();
  input.select();
}

function commitInlineEdit() {
  _inlineEditCommitting = true;
  const input = state.layer ? state.layer.querySelector(".cgptbm-tab__inline-edit") : null;
  if (input) {
    const bookmarkId = input.dataset.bookmarkId || "";
    const newLabel = input.value.trim();
    const tab = input.closest(".cgptbm-tab");
    const label = tab ? tab.querySelector(".cgptbm-tab__label") : null;
    cleanupInlineEdit(input);
    const bookmark = state.currentBookmarks.find(function (b) { return b.id === bookmarkId; });
    if (bookmark && newLabel) {
      // Update label text immediately so sync doesn't overwrite with old value
      if (label) label.textContent = newLabel;
      updateBookmarkLabel(bookmarkId, newLabel, bookmark.colorIndex);
    }
  }
  _inlineEditBookmarkId = "";
  _inlineEditCommitting = false;
}

export function cancelInlineEdit() {
  _inlineEditCommitting = true;
  const input = state.layer ? state.layer.querySelector(".cgptbm-tab__inline-edit") : null;
  if (input) {
    cleanupInlineEdit(input);
  }
  _inlineEditBookmarkId = "";
  _inlineEditCommitting = false;
}

function cleanupInlineEdit(input) {
  const tab = input.closest(".cgptbm-tab");
  if (tab) {
    const label = tab.querySelector(".cgptbm-tab__label");
    if (label) label.style.visibility = "";
    const hint = tab.querySelector(".cgptbm-tab__inline-edit-hint");
    if (hint) hint.remove();
  }
  input.remove();
}

export function handleBookmarkEdit(bookmarkId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  // Toggle: if already editing this bookmark, commit and exit
  if (_inlineEditBookmarkId === bookmarkId) {
    commitInlineEdit();
    return;
  }

  if (_cb.releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId)) {
    _cb.syncExpandedBookmarkState();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });
  if (!bookmark) {
    return;
  }

  const tab = event && event.currentTarget
    ? (event.currentTarget.closest ? event.currentTarget.closest(".cgptbm-tab") : null)
    : null;
  if (!tab) return;

  const labelText = bookmark.label || bookmark.snippet || "Bookmark";
  enterInlineEdit(tab, bookmarkId, labelText);
}

// ============================================================
// Document-level handlers
// ============================================================

export function handleDocumentPointerDown(event) {
  if (state.bookmarkDragSession && event && event.pointerId !== state.bookmarkDragSession.pointerId) {
    _cb.clearBookmarkDragSession();
  }

  rememberClaudeSandboxCardCandidateFromElement(event ? event.target : null);
  _cb.maybeReleaseResizeLockedExpandedBookmark(event ? event.target : null);

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
  if (_cb.handleBookmarkDragPointerMove(event)) {
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

  _cb.handleRailViewportWheel(event);
}

// ============================================================
// Utility exports for callback wiring
// ============================================================

export function isInlineEditing() {
  return Boolean(_inlineEditBookmarkId);
}

export function isInlineEditingBookmark(bookmarkId) {
  return _inlineEditBookmarkId === bookmarkId;
}
