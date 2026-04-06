// ============================================================
// rail-tab-dom.js — Tab DOM creation and action buttons
// ============================================================
// Extracted from rail-popup-tab.js during Phase E3 refinement.
// Contains tab root DOM creation, action button DOM creation,
// and action icon creation.

import state from './state.js';
import { createSvgElement } from './dom.js';
import { COLLAPSED_TAB_HEIGHT } from './constants.js';

// Popup DOM sub-module (direct import per Phase E3 rules)
import { createTabPopupElement } from './rail-popup-dom.js';

// ============================================================
// Local constants
// ============================================================

const COLLAPSED_TAB_LEFT_HOVER_ZONE_WIDTH = 40;

// ============================================================
// Callback reference (shared from rail-popup-tab.js via _initTabDom)
// ============================================================

var _callbacks = {};

export function _initTabDom(callbacks) {
  _callbacks = callbacks;
}

// ============================================================
// Internal helpers
// ============================================================

function preventFocusSteal(event) {
  event.preventDefault();
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
  var nq = _callbacks.getNormalizedSearchQuery ? _callbacks.getNormalizedSearchQuery(state.bookmarkSearchQuery) : "";
  if (nq && _callbacks.highlightMatchInElement) _callbacks.highlightMatchInElement(label, nq);

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
      if (action.className === "cgptbm-tab__action--expand-pin" || action.className === "cgptbm-tab__action--pin" || action.className === "cgptbm-tab__action--edit") {
        if (action.className !== "cgptbm-tab__action--edit") {
          actionButton.dataset.preClick = actionButton.classList.contains("is-selected") ? "pinned" : "unpinned";
        }
        actionButton.style.boxShadow = "inset 0 2px 3px rgba(148, 163, 184, 0.5), inset 0 -1px 2px rgba(15, 23, 42, 0.15)";
      }
      action.onClick(event);
    });
    if (action.className === "cgptbm-tab__action--expand-pin" || action.className === "cgptbm-tab__action--pin" || action.className === "cgptbm-tab__action--edit") {
      actionButton.addEventListener("mouseleave", function () {
        delete actionButton.dataset.preClick;
        actionButton.style.boxShadow = "";
      });
    }
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
      d: "M10.33 1L10.83 1L15 5.17Q15.27 5.93 14.5 5.67Q14.07 6.43 12.5 6L12 6.5L10.67 8.5Q11.3 11.63 9.83 12.67L3.33 6.5L3.83 5.67Q5 4.83 7.5 5.33L10 3.5Q9.8 1.7 10.33 1Z",
      fill: "currentColor",
      class: "cgptbm-tab__pin-body"
    }));
    svg.appendChild(createSvgElement("path", {
      d: "M5.17 10L6 10.5L2.17 14.67Q0.93 15.1 1.33 13.83L5.17 10Z",
      fill: "currentColor",
      class: "cgptbm-tab__pin-needle"
    }));
    return svg;
  }

  if (iconType === "edit") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.appendChild(createSvgElement("path", {
      d: "M 17.5 2.5 L 21.5 6.5 L 8.5 19.5 L 3 21 L 4.5 15.5 Z"
    }));
    svg.appendChild(createSvgElement("line", {
      x1: "15", y1: "5", x2: "19", y2: "9"
    }));
    return svg;
  }

  return null;
}
