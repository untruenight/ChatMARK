// ============================================================
// rail-viewport.js — Rail viewport, scrollbar, and top-right UI protection
// ============================================================
// Extracted from rail.js during Phase A modularization.
// Contains GROUP 9 (Rail viewport) and GROUP 12 (Scrollbar).

import state from './state.js';
import { clamp } from './text.js';
import {
  ROOT_RIGHT_OFFSET, RAIL_VIEWPORT_DEFAULT_TOP,
  RAIL_VIEWPORT_WIDTH, COLLAPSED_TAB_VISIBLE_EDGE_WIDTH,
  TAB_STACK_GAP
} from './constants.js';
import { getCurrentSiteProfile } from './dom.js';

// ============================================================
// Local constants
// ============================================================

const RAIL_VIEWPORT_CONTROLS_GAP = 2;
const RAIL_VIEWPORT_LEFT_BUFFER = 18;
const EXPANDED_TAB_RIGHT_EXTENSION = 34;
const EXPANDED_TAB_LEFT_PADDING = 6;
const EXPANDED_POPUP_LEFT_PADDING = 34;
const RAIL_SCROLLBAR_MIN_THUMB_HEIGHT = 28;
const RAIL_BOTTOM_PADDING = 24;
const TOP_RIGHT_BLOCKER_SAFE_GAP = 12;
const SCROLLBAR_RIGHT_OVERHANG = 52;
const TOP_RIGHT_BLOCKER_MAX_TOP = 240;
const TOP_RIGHT_BLOCKER_MIN_WIDTH = 120;
const TOP_RIGHT_BLOCKER_MIN_HEIGHT = 72;
const TOP_RIGHT_BLOCKER_SELECTOR = [
  // 공통
  "dialog[open]",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
  "[aria-modal='true']",
  // ChatGPT (Radix)
  "[data-radix-popper-content-wrapper]",
  "[data-radix-dropdown-menu-content]",
  "[data-radix-popover-content]",
  // Gemini (Angular CDK)
  ".cdk-overlay-pane",
  // Google 계정 패널
  "iframe[name='account']"
].join(", ");
export const HISTORY_CONTROLS_DEFAULT_TOP = 60;

// ============================================================
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

export function getHistoryControlsTop() {
  var profile = getCurrentSiteProfile();
  return (profile && Number.isFinite(profile.historyControlsTop))
    ? profile.historyControlsTop
    : HISTORY_CONTROLS_DEFAULT_TOP;
}

// ============================================================
// GROUP 9 — Rail viewport
// ============================================================

export function getProfileRootRightOffset() {
  var profile = getCurrentSiteProfile();
  return (profile && Number.isFinite(profile.rootRightOffset))
    ? profile.rootRightOffset
    : ROOT_RIGHT_OFFSET;
}

export function getProfileViewportDefaultTop() {
  var profile = getCurrentSiteProfile();
  return (profile && Number.isFinite(profile.viewportDefaultTop))
    ? profile.viewportDefaultTop
    : RAIL_VIEWPORT_DEFAULT_TOP;
}

export function syncRailViewportTop() {
  if (!state.root) {
    return;
  }

  var defaultTop = getProfileViewportDefaultTop();
  const controls = state.root.querySelector(".cgptbm-history-controls");

  if (!(controls instanceof HTMLElement)) {
    state.root.style.setProperty("--cgptbm-rail-viewport-top", defaultTop + "px");
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

  var popupPadding = (widestVisiblePopup && widestVisiblePopup + RAIL_VIEWPORT_LEFT_BUFFER > RAIL_VIEWPORT_WIDTH)
    ? EXPANDED_POPUP_LEFT_PADDING : 0;

  const nextWidth = Math.max(
    COLLAPSED_TAB_VISIBLE_EDGE_WIDTH,
    widestExpandedTab ? widestExpandedTab + RAIL_VIEWPORT_LEFT_BUFFER + EXPANDED_TAB_LEFT_PADDING + EXPANDED_TAB_RIGHT_EXTENSION : 0,
    widestVisiblePopup ? widestVisiblePopup + RAIL_VIEWPORT_LEFT_BUFFER + popupPadding : 0
  );

  const rightExtension = widestExpandedTab ? EXPANDED_TAB_RIGHT_EXTENSION : 0;

  state.root.style.setProperty("--cgptbm-rail-viewport-width", nextWidth + "px");
  state.root.style.setProperty("--cgptbm-rail-scroll-hitbox-width", nextWidth + "px");
  state.root.style.setProperty("--cgptbm-rail-scroll-hitbox-right", -rightExtension + "px");
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

  const baseRightOffset = getProfileRootRightOffset();
  const blockerRect = getTopRightBlockerRect();
  const nextRightOffset = blockerRect
    ? Math.max(baseRightOffset, Math.ceil(window.innerWidth - blockerRect.left + TOP_RIGHT_BLOCKER_SAFE_GAP + SCROLLBAR_RIGHT_OVERHANG))
    : baseRightOffset;
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

    if (!["fixed", "absolute", "sticky"].includes(style.position)
        && !candidate.matches(".cdk-overlay-pane, iframe[name='account']")) {
      return;
    }

    const rect = candidate.getBoundingClientRect();
    if (
      rect.width < TOP_RIGHT_BLOCKER_MIN_WIDTH ||
      rect.height < TOP_RIGHT_BLOCKER_MIN_HEIGHT ||
      rect.top > TOP_RIGHT_BLOCKER_MAX_TOP ||
      rect.right < window.innerWidth - 64 ||
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

export function getRailViewportTop() {
  if (!state.root) {
    return RAIL_VIEWPORT_DEFAULT_TOP;
  }

  const value = Number.parseFloat(state.root.style.getPropertyValue("--cgptbm-rail-viewport-top"));
  return Number.isFinite(value) ? value : RAIL_VIEWPORT_DEFAULT_TOP;
}

export function getBookmarkTabTopLimit() {
  return 2;
}

// ============================================================
// Viewport overflow and scrollbar binding
// ============================================================

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
