// ============================================================
// ui/popup.js — 북마크 저장/편집 팝업 + 색상 피커 + 팝업 레이아웃
// ============================================================
// 비유: "메모 붙이기 창". 사용자가 북마크 이름을 입력하고 저장하는 팝업,
//       색상 선택 피커, 팝업 크기 측정/클램핑을 담당합니다.

import state from './state.js';
import { logWarn } from './log.js';
import {
  TAB_COLORS,
  DEFAULT_BOOKMARK_LABEL,
  POPUP_MIN_WIDTH,
  POPUP_MAX_WIDTH,
  POPUP_MIN_HEIGHT,
  POPUP_MAX_HEIGHT
} from './constants.js';
import { normalizeText, createLabel, clamp } from './text.js';
import { createSvgElement } from './dom.js';
import {
  normalizeColorIndex,
  saveBookmark,
  updateBookmarkLabel,
  refreshCurrentBookmarksView
} from './bookmarks.js';
import { isSandboxCardAnchor } from './sandbox-card.js';
import { closeBackupDropdown } from './rail-controls.js';

// ---- 콜백 주입 (순환 의존 방지) ----
// rail.js (UI layer)
let _syncExpandedBookmarkState = null;
let _releaseResizeLockedExpandedBookmarkForInteraction = null;
let _refreshCurrentBookmarksViewAfterIncrementalUpdate = null;
let _refreshCurrentBookmarksViewAfterIncrementalCreate = null;
let _showAddTabSuccess = null;
let _pulseRenderedBookmarkTab = null;
let _pulseTab = null;
let _resetAddTabFeedback = null;
let _isBookmarkExpanded = null;

// selection.js
let _hideSelectionTrigger = null;

export function setPopupCallbacks(callbacks) {
  _syncExpandedBookmarkState = callbacks.syncExpandedBookmarkState || null;
  _releaseResizeLockedExpandedBookmarkForInteraction = callbacks.releaseResizeLockedExpandedBookmarkForInteraction || null;
  _refreshCurrentBookmarksViewAfterIncrementalUpdate = callbacks.refreshCurrentBookmarksViewAfterIncrementalUpdate || null;
  _refreshCurrentBookmarksViewAfterIncrementalCreate = callbacks.refreshCurrentBookmarksViewAfterIncrementalCreate || null;
  _showAddTabSuccess = callbacks.showAddTabSuccess || null;
  _pulseRenderedBookmarkTab = callbacks.pulseRenderedBookmarkTab || null;
  _pulseTab = callbacks.pulseTab || null;
  _resetAddTabFeedback = callbacks.resetAddTabFeedback || null;
  _isBookmarkExpanded = callbacks.isBookmarkExpanded || null;
  _hideSelectionTrigger = callbacks.hideSelectionTrigger || null;
}

// ============================================================
// 팝업 레이아웃 측정 / 클램핑
// ============================================================

function getCanvasFontShorthand(style) {
  if (!style) {
    return "500 11px 'Inter', Arial, sans-serif";
  }

  if (style.font) {
    return style.font;
  }

  return [
    style.fontStyle || "normal",
    style.fontVariant || "normal",
    style.fontWeight || "400",
    style.fontSize || "11px",
    style.fontFamily || "'Inter', Arial, sans-serif"
  ].join(" ");
}

function measureTextBlockMaxWidth(text, style) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  if (!lines.length) {
    return 0;
  }

  const canvas = measureTextBlockMaxWidth.canvas || (measureTextBlockMaxWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  if (!context) {
    return 0;
  }

  context.font = getCanvasFontShorthand(style);
  let maxWidth = 0;
  lines.forEach(function (line) {
    const measuredWidth = context.measureText(line || " ").width;
    if (measuredWidth > maxWidth) {
      maxWidth = measuredWidth;
    }
  });
  return maxWidth;
}

function getHorizontalBoxSize(style) {
  if (!style) {
    return 0;
  }

  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  return paddingLeft + paddingRight + borderLeft + borderRight;
}

export function getPopupViewportMaxWidth() {
  return Math.max(POPUP_MIN_WIDTH, Math.min(POPUP_MAX_WIDTH, window.innerWidth - 24));
}

function getPopupViewportMaxHeight() {
  return Math.max(POPUP_MIN_HEIGHT, Math.min(POPUP_MAX_HEIGHT, window.innerHeight - 112));
}

export function getPopupContentMaxWidth(popup) {
  if (!popup) {
    return getPopupViewportMaxWidth();
  }

  if (Number.isFinite(popup.__cgptbmContentMaxWidth)) {
    return popup.__cgptbmContentMaxWidth;
  }

  const popupStyle = window.getComputedStyle(popup);
  const popupTitle = popup.querySelector(".cgptbm-tab__popup-title");
  const popupBody = popup.querySelector(".cgptbm-tab__popup-body");
  const horizontalInset = getHorizontalBoxSize(popupStyle);
  const titleWidth = popupTitle
    ? measureTextBlockMaxWidth(popupTitle.textContent || "", window.getComputedStyle(popupTitle))
    : 0;
  const bodyWidth = popupBody
    ? measureTextBlockMaxWidth(popupBody.textContent || "", window.getComputedStyle(popupBody))
    : 0;
  const contentWidth = Math.max(titleWidth, bodyWidth);
  const maxWidth = Math.max(
    POPUP_MIN_WIDTH,
    Math.min(getPopupViewportMaxWidth(), Math.ceil(contentWidth + horizontalInset + 12))
  );

  popup.__cgptbmContentMaxWidth = maxWidth;
  return maxWidth;
}

export function getClampedPopupWidth(width, popup) {
  const viewportMaxWidth = getPopupViewportMaxWidth();
  const contentMaxWidth = popup ? getPopupContentMaxWidth(popup) : viewportMaxWidth;
  const maxWidth = Math.max(POPUP_MIN_WIDTH, Math.min(viewportMaxWidth, contentMaxWidth));
  return Math.round(clamp(Number(width) || POPUP_MIN_WIDTH, POPUP_MIN_WIDTH, maxWidth));
}

export function getViewportClampedPopupHeight(height) {
  const viewportMaxHeight = getPopupViewportMaxHeight();
  return Math.round(clamp(Number(height) || POPUP_MIN_HEIGHT, POPUP_MIN_HEIGHT, viewportMaxHeight));
}

export function getPopupContentMaxHeight(popup, width) {
  if (!popup) {
    return getPopupViewportMaxHeight();
  }

  const popupBody = popup.querySelector(".cgptbm-tab__popup-body");
  const previousWidth = popup.style.width;
  const previousHeight = popup.style.height;
  const previousBodyMaxHeight = popupBody ? popupBody.style.maxHeight : "";
  const previousBodyFlex = popupBody ? popupBody.style.flex : "";

  popup.style.width = getClampedPopupWidth(width, popup) + "px";
  popup.style.height = "";
  if (popupBody) {
    popupBody.style.maxHeight = "none";
    popupBody.style.flex = "0 0 auto";
  }

  const naturalHeight = Math.max(POPUP_MIN_HEIGHT, Math.ceil(popup.getBoundingClientRect().height));

  popup.style.width = previousWidth;
  popup.style.height = previousHeight;
  if (popupBody) {
    popupBody.style.maxHeight = previousBodyMaxHeight;
    popupBody.style.flex = previousBodyFlex;
  }

  return naturalHeight;
}

export function getClampedPopupHeight(height, popup, width) {
  const viewportMaxHeight = getPopupViewportMaxHeight();
  const contentMaxHeight = getPopupContentMaxHeight(popup, width);
  const maxHeight = Math.max(POPUP_MIN_HEIGHT, Math.min(viewportMaxHeight, contentMaxHeight));
  return Math.round(clamp(getViewportClampedPopupHeight(height), POPUP_MIN_HEIGHT, maxHeight));
}

export function normalizePopupLayout(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: getClampedPopupWidth(width),
    height: getClampedPopupHeight(height)
  };
}

// ============================================================
// 라벨 생성 유틸
// ============================================================

function createMinimalSuggestedTitle(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "";
  }

  return words.slice(0, 2).join(" ");
}

function createSuggestedLabel(anchor) {
  if (!anchor) {
    return "";
  }
  if (isSandboxCardAnchor(anchor)) {
    return createLabel(anchor.blockTextSnippet || "Claude widget");
  }
  return createLabel(createMinimalSuggestedTitle(anchor.selectionText || anchor.blockTextSnippet || ""));
}

export function getDefaultPopupLabel(anchor) {
  return createSuggestedLabel(anchor) || DEFAULT_BOOKMARK_LABEL;
}

function normalizePopupLabel(value, anchor) {
  return createLabel(value) || createSuggestedLabel(anchor) || DEFAULT_BOOKMARK_LABEL;
}

// ============================================================
// 팝업 내부 유틸
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

function getColorPickerPositionForRect(rect) {
  const popupWidth = 138;
  const popupHeight = 56;
  const gap = 8;
  const viewportGap = 8;

  if (!rect) {
    return null;
  }

  const top = clamp(
    rect.top + Math.round((rect.height - popupHeight) / 2),
    viewportGap,
    window.innerHeight - popupHeight - viewportGap
  );
  const left = clamp(
    rect.left - popupWidth - gap,
    viewportGap,
    window.innerWidth - popupWidth - viewportGap
  );

  return {
    top: Math.round(top),
    left: Math.round(left)
  };
}

// ============================================================
// 색상 버튼 / 팔레트
// ============================================================

function createPopupPaletteIcon() {
  const svg = createSvgElement("svg", {
    viewBox: "0 0 16 16",
    "aria-hidden": "true",
    class: "cgptbm-popup__color-toggle-icon"
  });

  svg.appendChild(createSvgElement("path", {
    d: "M8 1.4C4.05 1.4 1.15 4.15 1.15 7.8C1.15 11.52 3.95 14.55 7.35 14.55H8.9C9.85 14.55 10.5 13.87 10.5 12.95C10.5 12.47 10.3 12.08 10.08 11.73C9.82 11.36 9.58 11.03 9.58 10.63C9.58 9.78 10.25 9.15 11.15 9.15H11.85C13.85 9.15 14.85 7.93 14.85 6.15C14.85 3.45 12.17 1.4 8 1.4Z",
    fill: "currentColor"
  }));
  svg.appendChild(createSvgElement("circle", {
    cx: "4.8",
    cy: "7.15",
    r: "0.92",
    fill: "#ffffff"
  }));
  svg.appendChild(createSvgElement("circle", {
    cx: "6.95",
    cy: "4.75",
    r: "0.92",
    fill: "#ffffff"
  }));
  svg.appendChild(createSvgElement("circle", {
    cx: "9.82",
    cy: "5.02",
    r: "0.92",
    fill: "#ffffff"
  }));
  svg.appendChild(createSvgElement("circle", {
    cx: "6.65",
    cy: "10.08",
    r: "1.06",
    fill: "#0f172a"
  }));
  return svg;
}

function renderPopupColorToggleButtonContent(button) {
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  button.textContent = "";
  button.classList.add("cgptbm-popup__color-toggle--has-icon");
  button.appendChild(createPopupPaletteIcon());
}

function syncColorSelectionButtons(container, selectedColorIndex) {
  if (!container) {
    return;
  }

  Array.from(container.querySelectorAll(".cgptbm-popup__color")).forEach(function (button) {
    const colorIndex = Number.parseInt(button.dataset.colorIndex || "", 10);
    const isSelected = Number.isInteger(colorIndex) && colorIndex === normalizeColorIndex(selectedColorIndex);
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });
}

function syncPopupColorSelection() {
  syncColorSelectionButtons(state.popup, state.popupColorIndex);
}

function createColorButtons(selectedColorIndex, onSelect) {
  const colors = document.createElement("div");
  colors.className = "cgptbm-popup__colors";

  TAB_COLORS.forEach(function (color, index) {
    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "cgptbm-popup__color";
    colorButton.dataset.colorIndex = String(index);
    colorButton.title = "Select bookmark color";
    colorButton.setAttribute("aria-label", "Select bookmark color " + (index + 1));
    colorButton.style.setProperty("--cgptbm-popup-color", color);
    colorButton.onmousedown = preventFocusSteal;
    colorButton.onclick = function (event) {
      onSelect(index, event);
    };
    colors.appendChild(colorButton);
  });

  syncColorSelectionButtons(colors, selectedColorIndex);
  return colors;
}

function setPopupColorPaletteOpen(popup, isOpen) {
  if (!popup) {
    return;
  }

  const colorsWrap = popup.querySelector(".cgptbm-popup__colors-wrap");
  const toggleButton = popup.querySelector(".cgptbm-popup__color-toggle");
  const nextIsOpen = Boolean(isOpen);
  if (colorsWrap) {
    colorsWrap.hidden = !nextIsOpen;
  }
  if (toggleButton) {
    toggleButton.classList.toggle("is-open", nextIsOpen);
    toggleButton.setAttribute("aria-expanded", nextIsOpen ? "true" : "false");
    toggleButton.title = nextIsOpen ? "Hide bookmark colors" : "Show bookmark colors";
    toggleButton.setAttribute("aria-label", nextIsOpen ? "Hide bookmark colors" : "Show bookmark colors");
  }
}

function handlePopupColorSelect(colorIndex, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  state.popupColorIndex = normalizeColorIndex(colorIndex);
  syncPopupColorSelection();
}

// ============================================================
// 저장 팝업 열기 / 닫기
// ============================================================

async function handlePopupSave(event) {
  if (event) {
    event.preventDefault();
  }

  if (!state.pendingAnchor) {
    return;
  }

  const anchor = state.pendingAnchor;
  const pendingBookmarkId = state.pendingBookmarkId;
  const label = normalizePopupLabel(state.popupInput ? state.popupInput.value : "", anchor);
  const colorIndex = normalizeColorIndex(state.popupColorIndex);
  var bookmark;
  try {
    bookmark = pendingBookmarkId
      ? await updateBookmarkLabel(pendingBookmarkId, label, colorIndex)
      : await saveBookmark(anchor, label, { colorIndex: colorIndex });
  } catch (error) {
    logWarn("handlePopupSave: save failed", error);
    closeSavePopup();
    refreshCurrentBookmarksView();
    return;
  }
  if (!bookmark) {
    closeSavePopup();
    refreshCurrentBookmarksView();
    return;
  }
  closeSavePopup({
    preserveCreateExpandedLock: !pendingBookmarkId,
    suppressExpandedSync: true
  });
  const usedIncrementalUpdateRefresh = Boolean(pendingBookmarkId) &&
    (_refreshCurrentBookmarksViewAfterIncrementalUpdate ? _refreshCurrentBookmarksViewAfterIncrementalUpdate(bookmark.id) : false);
  const usedIncrementalCreateRefresh = !pendingBookmarkId &&
    (_refreshCurrentBookmarksViewAfterIncrementalCreate ? _refreshCurrentBookmarksViewAfterIncrementalCreate(bookmark.id) : false);
  if (!usedIncrementalCreateRefresh && !usedIncrementalUpdateRefresh) {
    refreshCurrentBookmarksView();
  }
  if (!pendingBookmarkId) {
    if (_showAddTabSuccess) _showAddTabSuccess();
  }
  if (!pendingBookmarkId && usedIncrementalCreateRefresh) {
    if (_pulseRenderedBookmarkTab) _pulseRenderedBookmarkTab(bookmark.id);
  } else if (pendingBookmarkId && usedIncrementalUpdateRefresh) {
    if (_pulseRenderedBookmarkTab) _pulseRenderedBookmarkTab(bookmark.id);
  } else {
    if (_pulseTab) _pulseTab(bookmark.id);
  }
}

export function openSavePopup(anchor, popupPosition, options) {
  const nextOptions = options || {};
  closeSavePopup();
  closeBookmarkColorPicker();
  closeBackupDropdown();
  if (_resetAddTabFeedback) _resetAddTabFeedback();
  if (_hideSelectionTrigger) _hideSelectionTrigger();

  const popup = document.createElement("div");
  popup.className = "cgptbm-popup";
  if (nextOptions.bookmarkId) {
    popup.classList.add("cgptbm-popup--edit");
  }
  if (popupPosition) {
    popup.classList.add("cgptbm-popup--anchored");
    popup.style.top = popupPosition.top + "px";
    popup.style.left = popupPosition.left + "px";
    popup.style.right = "auto";
  }

  const form = document.createElement("form");
  form.className = "cgptbm-popup__form";
  form.addEventListener("submit", handlePopupSave);

  const row = document.createElement("div");
  row.className = "cgptbm-popup__row";

  const colorToggleButton = document.createElement("button");
  colorToggleButton.type = "button";
  colorToggleButton.className = "cgptbm-popup__color-toggle";
  renderPopupColorToggleButtonContent(colorToggleButton);
  colorToggleButton.onmousedown = preventFocusSteal;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cgptbm-popup__input";
  input.value = typeof nextOptions.initialValue === "string" ? nextOptions.initialValue : getDefaultPopupLabel(anchor);
  input.maxLength = 80;
  input.setAttribute("aria-label", "Bookmark name");

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "cgptbm-popup__save";
  saveButton.textContent = "Save";

  row.appendChild(colorToggleButton);
  row.appendChild(input);
  row.appendChild(saveButton);
  form.appendChild(row);

  const colors = document.createElement("div");
  const popupColors = createColorButtons(
    Number.isInteger(nextOptions.colorIndex)
      ? normalizeColorIndex(nextOptions.colorIndex)
      : state.currentBookmarks.length % TAB_COLORS.length,
    handlePopupColorSelect
  );
  colors.className = "cgptbm-popup__colors-wrap";
  colors.appendChild(popupColors);
  form.appendChild(colors);

  popup.appendChild(form);
  state.root.appendChild(popup);

  state.popup = popup;
  state.popupForm = form;
  state.popupInput = input;
  state.popupColorIndex = Number.isInteger(nextOptions.colorIndex)
    ? normalizeColorIndex(nextOptions.colorIndex)
    : state.currentBookmarks.length % TAB_COLORS.length;
  state.pendingAnchor = anchor;
  state.pendingBookmarkId = nextOptions.bookmarkId || "";
  state.editLockedBookmarkId = nextOptions.bookmarkId || "";
  state.createPopupPreservedExpandedBookmarkId = nextOptions.bookmarkId ? "" : (state.expandedBookmarkId || "");
  syncPopupColorSelection();
  setPopupColorPaletteOpen(popup, false);
  colorToggleButton.onclick = function (event) {
    event.preventDefault();
    event.stopPropagation();
    setPopupColorPaletteOpen(popup, colors.hidden);
  };

  window.requestAnimationFrame(function () {
    input.focus();
    input.select();
  });
}

export function closeSavePopup(options) {
  const nextOptions = options || {};
  const hadLock = Boolean(state.editLockedBookmarkId);
  const hadCreatePreservedExpandedLock = Boolean(state.createPopupPreservedExpandedBookmarkId);
  const shouldPreserveCreateExpandedLock = Boolean(nextOptions.preserveCreateExpandedLock);
  const shouldSuppressExpandedSync = Boolean(nextOptions.suppressExpandedSync);
  if (state.popup) {
    state.popup.remove();
  }

  state.popup = null;
  state.popupForm = null;
  state.popupInput = null;
  state.popupColorIndex = 0;
  state.pendingAnchor = null;
  state.pendingBookmarkId = "";
  state.editLockedBookmarkId = "";
  if (!shouldPreserveCreateExpandedLock) {
    state.createPopupPreservedExpandedBookmarkId = "";
  }
  if (!shouldSuppressExpandedSync && (hadLock || (hadCreatePreservedExpandedLock && !shouldPreserveCreateExpandedLock))) {
    if (_syncExpandedBookmarkState) _syncExpandedBookmarkState();
  }
}

// ============================================================
// 북마크 색상 피커
// ============================================================

export function isBookmarkColorPickerEnabled(bookmarkId) {
  return Boolean(bookmarkId && (_isBookmarkExpanded ? _isBookmarkExpanded(bookmarkId) : false));
}

export function closeBookmarkColorPicker(options) {
  const nextOptions = options || {};
  const hadLock = Boolean(state.colorPickerLockedBookmarkId);
  if (state.colorPicker) {
    state.colorPicker.remove();
  }
  state.colorPicker = null;
  state.colorPickerBookmarkId = "";
  state.colorPickerLockedBookmarkId = "";
  if (hadLock && !nextOptions.suppressExpandedSync) {
    if (_syncExpandedBookmarkState) _syncExpandedBookmarkState();
  }
}

async function handleBookmarkColorChange(bookmarkId, colorIndex, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });
  closeBookmarkColorPicker({ suppressExpandedSync: true });
  if (!bookmark) {
    return;
  }

  const nextColorIndex = normalizeColorIndex(colorIndex);
  if (nextColorIndex === normalizeColorIndex(bookmark.colorIndex)) {
    return;
  }

  await updateBookmarkLabel(bookmarkId, bookmark.label, nextColorIndex);
  if (!(_refreshCurrentBookmarksViewAfterIncrementalUpdate ? _refreshCurrentBookmarksViewAfterIncrementalUpdate(bookmarkId) : false)) {
    refreshCurrentBookmarksView();
  }
}

export function handleBookmarkColorPickerOpen(bookmarkId, event) {
  if (_releaseResizeLockedExpandedBookmarkForInteraction) {
    if (_releaseResizeLockedExpandedBookmarkForInteraction(bookmarkId)) {
      if (_syncExpandedBookmarkState) _syncExpandedBookmarkState();
    }
  }

  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const bookmark = state.currentBookmarks.find(function (item) {
    return item.id === bookmarkId;
  });
  if (!bookmark) {
    closeBookmarkColorPicker();
    return;
  }

  if (!isBookmarkColorPickerEnabled(bookmarkId)) {
    closeBookmarkColorPicker();
    return;
  }

  if (state.colorPicker && state.colorPickerBookmarkId === bookmarkId) {
    closeBookmarkColorPicker();
    return;
  }

  const popupPosition = event && event.currentTarget
    ? getColorPickerPositionForRect(event.currentTarget.getBoundingClientRect())
    : null;

  closeSavePopup();
  closeBookmarkColorPicker({ suppressExpandedSync: true });
  closeBackupDropdown();
  state.colorPickerLockedBookmarkId = bookmarkId;
  if (_syncExpandedBookmarkState) _syncExpandedBookmarkState();

  if (!popupPosition) {
    closeBookmarkColorPicker();
    return;
  }

  const popup = document.createElement("div");
  popup.className = "cgptbm-popup cgptbm-popup--anchored cgptbm-popup--color-picker";
  popup.style.top = popupPosition.top + "px";
  popup.style.left = popupPosition.left + "px";
  popup.style.right = "auto";
  popup.setAttribute("aria-label", "Bookmark color picker");

  const colors = createColorButtons(bookmark.colorIndex, function (colorIndex, colorEvent) {
    handleBookmarkColorChange(bookmarkId, colorIndex, colorEvent);
  });
  popup.appendChild(colors);
  state.root.appendChild(popup);

  state.colorPicker = popup;
  state.colorPickerBookmarkId = bookmarkId;
}
