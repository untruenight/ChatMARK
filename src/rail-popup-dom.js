// ============================================================
// rail-popup-dom.js — Popup DOM creation and synchronization
// ============================================================
// Extracted from rail-popup-tab.js during Phase E2 refinement.
// Contains popup element creation, DOM update/removal, and
// text highlight application inside popup DOM.

import state from './state.js';
import {
  getPopupContentMaxWidth, getViewportClampedPopupHeight,
  getPopupContentMaxHeight
} from './popup.js';

// Geometry sub-module (direct import per Phase E2 rules)
import {
  handlePopupContentExpand,
  handlePopupContentMinimize,
  beginPopupResizeSession,
  syncPopupOverflowIndicator,
  schedulePopupOverflowIndicatorSync,
  applyPopupLayoutToElement,
  getPopupLayout,
  setPopupLayout
} from './rail-popup-geometry.js';

// ============================================================
// Callback reference (shared from rail-popup-tab.js via _initPopupDom)
// ============================================================

var _callbacks = {};

export function _initPopupDom(callbacks) {
  _callbacks = callbacks;
}

// ============================================================
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
}

// ============================================================
// Popup element creation
// ============================================================

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
  var nqPopup = _callbacks.getNormalizedSearchQuery ? _callbacks.getNormalizedSearchQuery(state.bookmarkSearchQuery) : "";
  if (nqPopup && _callbacks.highlightMatchInElement) _callbacks.highlightMatchInElement(popupBody, nqPopup);
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

// ============================================================
// Popup DOM synchronization
// ============================================================

export function syncTabPopupElement(tab, options) {
  if (!tab) {
    return;
  }

  const existingPopup = tab.querySelector(".cgptbm-tab__popup");
  if (!options || !options.popupText) {
    if (existingPopup) {
      if (_callbacks.setPopupContentExpanded) {
        _callbacks.setPopupContentExpanded(tab.dataset.bookmarkId || "", false);
      }
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
    const newBookmarkId = options.popupBookmarkId || "";
    if (newBookmarkId) {
      if (!getPopupLayout(newBookmarkId)) {
        const maxW = getPopupContentMaxWidth(popup);
        const maxH = getViewportClampedPopupHeight(getPopupContentMaxHeight(popup, maxW));
        setPopupLayout(newBookmarkId, maxW, maxH, { popup: popup });
        if (_callbacks.setPopupContentExpanded) {
          _callbacks.setPopupContentExpanded(newBookmarkId, true);
        }
      }
      applyPopupLayoutToElement(popup, newBookmarkId);
    }
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
    var nqPopup = _callbacks.getNormalizedSearchQuery ? _callbacks.getNormalizedSearchQuery(state.bookmarkSearchQuery) : "";
    if (nqPopup && _callbacks.highlightMatchInElement) _callbacks.highlightMatchInElement(popupBody, nqPopup);
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
