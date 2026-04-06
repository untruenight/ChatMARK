// ============================================================
// rail-controls.js — History controls, rail settings, collapse/expand toggles
// ============================================================
// Extracted from rail.js during Phase C modularization.
// Contains GROUP 7b (Collapse/Expand-all), GROUP 8 (Rail settings),
// and history controls UI creation/sync.

import state from './state.js';
import { clamp } from './text.js';
import {
  RAIL_OPACITY_STORAGE_KEY, RAIL_ENABLED_STORAGE_KEY,
  DEFAULT_RAIL_OPACITY, MIN_RAIL_OPACITY, MAX_RAIL_OPACITY
} from './constants.js';
import { storageSet } from './storage.js';
import { closeSavePopup, closeBookmarkColorPicker } from './popup.js';
import { hideSelectionTrigger, scheduleSelectionUiUpdate } from './selection.js';
import { forceHideScrollTransaction } from './scroll.js';
import {
  collapseAllBookmarks, expandAllBookmarks, expandAllPostits,
  hasExpandedPinnedState, canExpandAllTabs, isAllPinned,
  canExpandAllPostits, isAllPostits
} from './ui-state.js';
import {
  canUndoBookmarkHistory, canRedoBookmarkHistory,
  handleUndoBookmarkHistory, handleRedoBookmarkHistory
} from './history.js';
import { syncRailViewportTop, HISTORY_CONTROLS_DEFAULT_TOP } from './rail-viewport.js';
import { clearBookmarkDragSession } from './rail-dnd.js';
import { endPopupResizeSession } from './rail-popup-tab.js';
import { hideSandboxCardHighlight, scheduleSandboxCardTriggerRender } from './sandbox-card.js';
import {
  ensureBookmarkSearchControls, syncBookmarkSearchControls,
  createBookmarkSearchRow
} from './rail-search.js';
import { exportBookmarks, importBookmarks } from './bookmarks-backup.js';

// ============================================================
// Local constants
// ============================================================

const HISTORY_CONTROLS_RIGHT_OFFSET = 0;
const DISABLED_RAIL_OPACITY = 0;

// ============================================================
// Callback registry (injected via initControls)
// ============================================================

var _callbacks = {
  resetAddTabFeedback: null
};

export function initControls(callbacks) {
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
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

// ---- Backup dropdown ----

export function closeBackupDropdown() {
  if (!state.root) return;
  var dropdown = state.root.querySelector(".cgptbm-backup-dropdown");
  if (dropdown) dropdown.remove();
}

function handleBackupButtonClick(event) {
  event.stopPropagation();
  var existing = state.root ? state.root.querySelector(".cgptbm-backup-dropdown") : null;
  if (existing) {
    existing.remove();
    return;
  }

  var dropdown = document.createElement("div");
  dropdown.className = "cgptbm-backup-dropdown";

  var saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "cgptbm-backup-dropdown__item";
  saveBtn.textContent = "Save bookmarks to file";
  saveBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    e.stopPropagation();
  });
  saveBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeBackupDropdown();
    exportBookmarks();
  });

  var restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "cgptbm-backup-dropdown__item";
  restoreBtn.textContent = "Restore bookmarks from file";
  restoreBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    e.stopPropagation();
  });
  restoreBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    closeBackupDropdown();
    importBookmarks();
  });

  var warning = document.createElement("div");
  warning.className = "cgptbm-backup-dropdown__warning";
  warning.textContent = "\u26A0 Uninstalling ChatMARK without backup will permanently delete all bookmarks.";

  dropdown.appendChild(saveBtn);
  dropdown.appendChild(restoreBtn);
  dropdown.appendChild(warning);

  var backupBtn = state.root ? state.root.querySelector(".cgptbm-history-controls__backup") : null;
  if (backupBtn) {
    backupBtn.appendChild(dropdown);
  }
}

function normalizeRailOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_RAIL_OPACITY;
  }

  return clamp(numeric, MIN_RAIL_OPACITY, MAX_RAIL_OPACITY);
}

// ============================================================
// History controls UI — icon helpers
// ============================================================

function createBookmarkHistoryIcon(direction) {
  const icon = document.createElement("span");
  icon.className = "cgptbm-history-controls__icon";
  icon.setAttribute("aria-hidden", "true");
  if (direction === "redo") {
    icon.textContent = "\u21BB";
  } else if (direction === "collapse") {
    icon.textContent = "\u229F";
  } else if (direction === "expand") {
    icon.textContent = "\u229E";
  } else if (direction === "restore") {
    icon.textContent = "\u229E";
  } else {
    icon.textContent = "\u21BA";
  }
  return icon;
}

function createButtonSvgIcon(type) {
  const icon = document.createElement("span");
  icon.className = "cgptbm-history-controls__icon cgptbm-history-controls__icon--svg";
  icon.setAttribute("aria-hidden", "true");
  if (type === "tab-collapse") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2.5" y1="6" x2="9.5" y2="6"/></svg>';
  } else if (type === "tab-extend") {
    icon.innerHTML = '<svg viewBox="-5 5 48 48" width="11" height="11" fill="currentColor" stroke="none"><path d="M31 3L32.5 3L45 15.5Q45.8 17.8 43.5 17Q42.2 19.3 37.5 18L36 19.5L32 25.5Q33.9 34.9 29.5 38L10 19.5L11.5 17Q15 14.5 22.5 16L30 10.5Q29.4 5.1 31 3Z"/><path d="M15.5 30L18 31.5L6.5 44Q2.8 45.3 4 41.5L15.5 30Z"/></svg>';
  } else if (type === "tab-extend-hover") {
    icon.innerHTML = '<svg viewBox="-5 5 48 48" width="11" height="11" fill="currentColor" stroke="none"><path d="M31 3L32.5 3L45 15.5Q45.8 17.8 43.5 17Q42.2 19.3 37.5 18L36 19.5L32 25.5Q33.9 34.9 29.5 38L10 19.5L11.5 17Q15 14.5 22.5 16L30 10.5Q29.4 5.1 31 3Z"/></svg>';
  } else if (type === "tab-extend-disabled") {
    icon.innerHTML = '<svg viewBox="-5 5 48 48" width="11" height="11" fill="currentColor" stroke="none"><path d="M31 3L32.5 3L45 15.5Q45.8 17.8 43.5 17Q42.2 19.3 37.5 18L36 19.5L32 25.5Q33.9 34.9 29.5 38L10 19.5L11.5 17Q15 14.5 22.5 16L30 10.5Q29.4 5.1 31 3Z"/></svg>';
  } else if (type === "postit-extend") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none"><path d="M4 3L10 3L10 9Q9.5 3.5 4 3"/><path d="M8 9L2 9L2 3Q2.5 8.5 8 9"/></svg>';
  } else if (type === "postit-extend-phase2") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none" style="overflow:visible"><rect x="1.5" y="5.5" width="9" height="7" rx="1" fill="#888"/><g transform="translate(1.6,0) scale(0.66)"><path d="M8 1.6C10.08 1.6 11.45 2.7 11.45 4.04C11.45 4.67 11.15 5.24 10.6 5.64L10.32 7.72L11.95 8.98C12.26 9.22 12.09 9.72 11.7 9.72H8.82V13.08C8.82 13.44 8.46 13.72 8 13.72C7.54 13.72 7.18 13.44 7.18 13.08V9.72H4.3C3.91 9.72 3.74 9.22 4.05 8.98L5.68 7.72L5.4 5.64C4.85 5.24 4.55 4.67 4.55 4.04C4.55 2.7 5.92 1.6 8 1.6Z"/><ellipse cx="8" cy="4.02" rx="2.25" ry="1.14" fill="rgba(255,255,255,0.28)"/></g></svg>';
  } else if (type === "postit-extend-outward") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none" style="overflow:visible"><path d="M8 -1L8 5L14 5Q8.5 4.5 8 -1"/><path d="M4 13L4 7L-2 7Q3.5 7.5 4 13"/></svg>';
  } else if (type === "postit-close-hover") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none"><path d="M6 1L6 7L12 7Q6.5 6.5 6 1"/><path d="M6 11L6 5L0 5Q5.5 5.5 6 11"/></svg>';
  } else if (type === "postit-open-hover") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none" style="overflow:visible"><path d="M6 1L12 1L12 7Q11.5 1.5 6 1"/><path d="M6 11L0 11L0 5Q0.5 10.5 6 11"/></svg>';
  } else if (type === "postit-extend-inward") {
    icon.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor" stroke="none"><path d="M4 3L10 3L10 9Q9.5 3.5 4 3"/><path d="M8 9L2 9L2 3Q2.5 8.5 8 9"/></svg>';
  }
  return icon;
}

// ============================================================
// History controls UI — creation and sync
// ============================================================

function createBookmarkHistoryControls() {
  const controls = document.createElement("div");
  controls.className = "cgptbm-history-controls";

  const topRow = document.createElement("div");
  topRow.className = "cgptbm-history-controls__row";

  const undoRedoCapsule = document.createElement("div");
  undoRedoCapsule.className = "cgptbm-history-controls__capsule";

  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "cgptbm-history-controls__capsule-button";
  undoButton.dataset.historyAction = "undo";
  undoButton.title = "Undo bookmark add or remove";
  undoButton.setAttribute("aria-label", "Undo bookmark add or remove");
  undoButton.onmousedown = preventFocusSteal;
  undoButton.onclick = handleUndoBookmarkHistory;
  undoButton.appendChild(createBookmarkHistoryIcon("undo"));

  const redoButton = document.createElement("button");
  redoButton.type = "button";
  redoButton.className = "cgptbm-history-controls__capsule-button";
  redoButton.dataset.historyAction = "redo";
  redoButton.title = "Redo bookmark add or remove";
  redoButton.setAttribute("aria-label", "Redo bookmark add or remove");
  redoButton.onmousedown = preventFocusSteal;
  redoButton.onclick = handleRedoBookmarkHistory;
  redoButton.appendChild(createBookmarkHistoryIcon("redo"));

  undoRedoCapsule.appendChild(undoButton);
  undoRedoCapsule.appendChild(redoButton);

  const sliderRow = document.createElement("div");
  sliderRow.className = "cgptbm-history-controls__slider-row";

  const backupButton = document.createElement("button");
  backupButton.type = "button";
  backupButton.className = "cgptbm-history-controls__backup";
  backupButton.title = "Save or restore bookmarks";
  backupButton.setAttribute("aria-label", "Save or restore bookmarks");
  backupButton.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    e.stopPropagation();
    handleBackupButtonClick(e);
  });
  const backupIcon = document.createElement("span");
  backupIcon.className = "cgptbm-history-controls__backup-icon";
  backupIcon.setAttribute("aria-hidden", "true");
  backupIcon.textContent = "\uD83D\uDCBE";
  backupButton.appendChild(backupIcon);
  sliderRow.appendChild(backupButton);

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

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "cgptbm-history-controls__button";
  collapseButton.dataset.historyAction = "collapse-all";
  collapseButton.title = "Collapse all bookmarks";
  collapseButton.setAttribute("aria-label", "Collapse all bookmarks");
  collapseButton.onmousedown = preventFocusSteal;
  collapseButton.onclick = handleCollapseAllToggle;
  collapseButton.appendChild(createButtonSvgIcon("tab-collapse"));

  const tabExtendButton = document.createElement("button");
  tabExtendButton.type = "button";
  tabExtendButton.className = "cgptbm-history-controls__button";
  tabExtendButton.dataset.historyAction = "tab-extend";
  tabExtendButton.title = "Extend all tabs";
  tabExtendButton.setAttribute("aria-label", "Extend all tabs");
  tabExtendButton.onmousedown = preventFocusSteal;
  tabExtendButton.onclick = handleTabExtend;
  tabExtendButton.appendChild(createButtonSvgIcon("tab-extend"));
  tabExtendButton.addEventListener("mouseenter", function () {
    if (tabExtendButton.disabled) return;
    var ap = tabExtendButton.dataset.allPinned === "1";
    var oldIcon = tabExtendButton.querySelector(".cgptbm-history-controls__icon");
    var newIcon = createButtonSvgIcon(ap ? "tab-extend" : "tab-extend-hover");
    if (oldIcon) tabExtendButton.replaceChild(newIcon, oldIcon);
  });
  tabExtendButton.addEventListener("mouseleave", function () {
    if (tabExtendButton.disabled) return;
    var iconSvg = tabExtendButton.querySelector(".cgptbm-history-controls__icon--svg");
    if (iconSvg) iconSvg.style.transform = "";
    tabExtendButton.style.boxShadow = "";
    var ap = tabExtendButton.dataset.allPinned === "1";
    var oldIcon = tabExtendButton.querySelector(".cgptbm-history-controls__icon");
    var newIcon = createButtonSvgIcon(ap ? "tab-extend-hover" : "tab-extend");
    if (oldIcon) tabExtendButton.replaceChild(newIcon, oldIcon);
  });

  const postitExtendButton = document.createElement("button");
  postitExtendButton.type = "button";
  postitExtendButton.className = "cgptbm-history-controls__button";
  postitExtendButton.dataset.historyAction = "postit-extend";
  postitExtendButton.title = "Extend all post-its";
  postitExtendButton.setAttribute("aria-label", "Extend all post-its");
  postitExtendButton.onmousedown = preventFocusSteal;
  postitExtendButton.onclick = handlePostitExtend;
  postitExtendButton.appendChild(createButtonSvgIcon("postit-extend"));
  postitExtendButton.addEventListener("mouseenter", function () {
    if (postitExtendButton.disabled) return;
    var ap = postitExtendButton.dataset.allPostits === "1";
    var oldIcon = postitExtendButton.querySelector(".cgptbm-history-controls__icon");
    var newIcon = createButtonSvgIcon(ap ? "postit-close-hover" : "postit-open-hover");
    if (oldIcon) postitExtendButton.replaceChild(newIcon, oldIcon);
  });
  postitExtendButton.addEventListener("mouseleave", function () {
    if (postitExtendButton.disabled) return;
    postitExtendButton.style.boxShadow = "";
    delete postitExtendButton.dataset.preClickPostit;
    var ap = postitExtendButton.dataset.allPostits === "1";
    var oldIcon = postitExtendButton.querySelector(".cgptbm-history-controls__icon");
    var newIcon = createButtonSvgIcon(ap ? "postit-extend-outward" : "postit-extend-inward");
    if (oldIcon) postitExtendButton.replaceChild(newIcon, oldIcon);
  });

  topRow.appendChild(undoRedoCapsule);
  topRow.appendChild(collapseButton);
  topRow.appendChild(tabExtendButton);
  topRow.appendChild(postitExtendButton);
  controls.appendChild(createBookmarkSearchRow());
  controls.appendChild(topRow);

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
  controls.style.right = HISTORY_CONTROLS_RIGHT_OFFSET + "px";
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

  // ---- Tab Collapse ----
  const collapseButton = controls.querySelector('[data-history-action="collapse-all"]');
  if (collapseButton) {
    const canCollapse = state.railEnabled && hasExpandedPinnedState();
    collapseButton.disabled = !canCollapse;
    collapseButton.classList.toggle("is-enabled", canCollapse);
  }

  // ---- Tab Extension ----
  const tabExtendButton = controls.querySelector('[data-history-action="tab-extend"]');
  if (tabExtendButton) {
    const canTabExtend = state.railEnabled && canExpandAllTabs();
    const allPinned = isAllPinned();
    tabExtendButton.disabled = !canTabExtend;
    tabExtendButton.classList.toggle("is-enabled", canTabExtend);
    const tabExtIconType = !canTabExtend ? "tab-extend-disabled"
      : allPinned ? "tab-extend-hover"
      : "tab-extend";
    const prevTabExtIcon = tabExtendButton.dataset.iconType || "";
    if (prevTabExtIcon !== tabExtIconType) {
      const oldIcon = tabExtendButton.querySelector(".cgptbm-history-controls__icon");
      const newIcon = createButtonSvgIcon(tabExtIconType);
      if (oldIcon) {
        tabExtendButton.replaceChild(newIcon, oldIcon);
      }
      tabExtendButton.dataset.iconType = tabExtIconType;
    }
    tabExtendButton.dataset.allPinned = allPinned ? "1" : "0";
  }

  // ---- Post-it Extension (on/off 토글) ----
  const postitExtendButton = controls.querySelector('[data-history-action="postit-extend"]');
  if (postitExtendButton) {
    const canPostitExtend = state.railEnabled && canExpandAllPostits();
    const allPostits = isAllPostits();
    postitExtendButton.disabled = !canPostitExtend;
    postitExtendButton.classList.toggle("is-enabled", canPostitExtend);
    const postitIconType = !canPostitExtend ? "postit-extend"
      : allPostits ? "postit-extend-outward"
      : "postit-extend";
    const prevPostitIcon = postitExtendButton.dataset.iconType || "";
    if (prevPostitIcon !== postitIconType) {
      const oldIcon = postitExtendButton.querySelector(".cgptbm-history-controls__icon");
      const newIcon = createButtonSvgIcon(postitIconType);
      if (oldIcon) {
        postitExtendButton.replaceChild(newIcon, oldIcon);
      }
      postitExtendButton.dataset.iconType = postitIconType;
    }
    postitExtendButton.dataset.allPostits = allPostits ? "1" : "0";
  }

  syncBookmarkSearchControls();
}

export function syncBookmarkHistoryControlsToCurrentRail() {
  syncBookmarkHistoryControls(HISTORY_CONTROLS_DEFAULT_TOP);
}

// ============================================================
// GROUP 7b — Collapse/Expand-all toggle (상호 배타)
// ============================================================

let _bulkTogglePending = false;

async function handleCollapseAllToggle(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (_bulkTogglePending) {
    return;
  }

  _bulkTogglePending = true;
  try {
    await collapseAllBookmarks();
    syncBookmarkHistoryControlsToCurrentRail();
  } finally {
    _bulkTogglePending = false;
  }
}

async function handleExpandAllToggle(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (_bulkTogglePending) {
    return;
  }

  _bulkTogglePending = true;
  try {
    await expandAllBookmarks();
    syncBookmarkHistoryControlsToCurrentRail();
  } finally {
    _bulkTogglePending = false;
  }
}

async function handleTabExtend(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (_bulkTogglePending) return;
  _bulkTogglePending = true;
  var button = event ? event.currentTarget : null;
  var wasAllPinned = button ? button.dataset.allPinned === "1" : false;
  try {
    await expandAllBookmarks();
    syncBookmarkHistoryControlsToCurrentRail();
    if (button && button.matches(":hover")) {
      var hoverIconType = wasAllPinned ? "tab-extend" : "tab-extend-hover";
      var oldIcon = button.querySelector(".cgptbm-history-controls__icon");
      var newIcon = createButtonSvgIcon(hoverIconType);
      if (oldIcon) button.replaceChild(newIcon, oldIcon);
      var iconSvg = button.querySelector(".cgptbm-history-controls__icon--svg");
      if (iconSvg) {
        iconSvg.style.transform = wasAllPinned ? "none" : "translate(-2.2px, 2.2px)";
      }
      button.style.boxShadow = "inset 0 2px 3px hsla(133, 30%, 40%, 0.5), inset 0 -1px 2px hsla(133, 14%, 10%, 0.3)";
    }
  } finally {
    _bulkTogglePending = false;
  }
}

async function handlePostitExtend(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  if (_bulkTogglePending) return;
  _bulkTogglePending = true;
  var button = event ? event.currentTarget : null;
  var wasAllPostits = button ? button.dataset.allPostits === "1" : false;
  try {
    await expandAllPostits();
    syncBookmarkHistoryControlsToCurrentRail();
    if (button && button.matches(":hover")) {
      var hoverIconType = wasAllPostits ? "postit-open-hover" : "postit-close-hover";
      var oldIcon = button.querySelector(".cgptbm-history-controls__icon");
      var newIcon = createButtonSvgIcon(hoverIconType);
      if (oldIcon) button.replaceChild(newIcon, oldIcon);
      button.style.boxShadow = "inset 0 2px 3px hsla(230, 30%, 40%, 0.5), inset 0 -1px 2px hsla(230, 27%, 8%, 0.3)";
      button.dataset.preClickPostit = wasAllPostits ? "1" : "0";
    }
  } finally {
    _bulkTogglePending = false;
  }
}

export function preCollapseGuard() {
  endPopupResizeSession();
  closeBookmarkColorPicker();
  closeSavePopup();
  clearBookmarkDragSession();
  state.editLockedBookmarkId = "";
  state.colorPickerLockedBookmarkId = "";
  state.resizeLockedExpandedBookmarkId = "";
  state.createPopupPreservedExpandedBookmarkId = "";
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
  if (_callbacks.resetAddTabFeedback) {
    _callbacks.resetAddTabFeedback();
  }
  state.hoveredSandboxCardKey = "";
  hideSandboxCardHighlight({ immediate: true });
  scheduleSandboxCardTriggerRender();
}
