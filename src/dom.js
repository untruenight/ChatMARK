// ============================================================
// utils/dom.js — DOM 탐색 유틸리티
// ============================================================
// 비유: "건물 안내도". DOM 트리 안에서 특정 요소를 찾아주는 함수들입니다.
//
// 향후 개선: MutationObserver 기반 캐시를 여기에 추가하면
// collectAnchorBlocks() 등의 반복 DOM 순회를 크게 줄일 수 있습니다.

import state from './state.js';
import {
  BLOCK_SELECTOR,
  MESSAGE_SELECTOR,
  SITE_PROFILES,
  DEFAULT_SCOPE_ROOT_SELECTORS
} from './constants.js';
import { normalizeText, uniqueElements, clamp } from './text.js';

// ---- Internal helpers (not exported) ----

function isUsableScopeRoot(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getScopeRootSelectors() {
  const profile = getCurrentSiteProfile();
  const selectors = DEFAULT_SCOPE_ROOT_SELECTORS.slice();

  if (profile && Array.isArray(profile.scopeSelectors)) {
    profile.scopeSelectors.forEach(function (selector) {
      if (selector && selectors.indexOf(selector) < 0) {
        selectors.unshift(selector);
      }
    });
  }

  return selectors;
}

function detectMessageRoleFromSignals(value) {
  const signals = String(value || "").toLowerCase();
  if (!signals) {
    return "";
  }
  if (/(^|[^a-z])(user|human|prompt)([^a-z]|$)/.test(signals)) {
    return "user";
  }
  if (/(^|[^a-z])(assistant|model|response|claude|gemini|codex|chatgpt)([^a-z]|$)/.test(signals)) {
    return "assistant";
  }
  return "";
}

function hasExplicitRoleAttribute(element) {
  if (!element || !element.getAttribute) {
    return false;
  }
  return Boolean(
    element.getAttribute("data-message-author-role") ||
    element.getAttribute("data-author-role") ||
    element.getAttribute("data-role")
  );
}

function isLikelyMessageContainer(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  if (state.root && state.root.contains(element)) {
    return false;
  }
  if (element.matches && element.matches("nav, aside, header, footer, form")) {
    return false;
  }
  if (element.closest && element.closest("nav, aside, header, footer")) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed" || style.position === "sticky") {
    return false;
  }

  // Elements with explicit role attributes are always accepted (even short user messages)
  if (hasExplicitRoleAttribute(element)) {
    return true;
  }

  const text = getElementText(element);
  if (text.length < 12) {
    return false;
  }

  if (element.matches && element.matches(BLOCK_SELECTOR)) {
    return true;
  }

  const blockCount = Array.from(element.querySelectorAll(BLOCK_SELECTOR)).filter(function (candidate) {
    return isMeaningfulBlock(candidate);
  }).length;

  return blockCount > 0 || text.length >= 80;
}

function isMeaningfulInlineAnchor(element, message) {
  if (!element || element === message || !(element instanceof Element)) {
    return false;
  }
  if (element.matches && element.matches(BLOCK_SELECTOR)) {
    return false;
  }
  if (state.root && state.root.contains(element)) {
    return false;
  }

  const text = getElementText(element);
  if (text.length < 2 || text.length > 180) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }

  return !Array.from(element.children).some(function (child) {
    return getElementText(child).length >= text.length;
  });
}

function findUserMessageLeafBlock(message, startElement) {
  if (!message || getMessageRole(message) !== "user") {
    return null;
  }

  let current = startElement;
  while (current && current !== message) {
    if (isMeaningfulInlineAnchor(current, message)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

// ---- Exported functions (template 8개) ----

export function getScopeRoot(scope) {
  if (scope && scope.nodeType === Node.ELEMENT_NODE) {
    return scope;
  }

  const selectors = getScopeRootSelectors();
  for (let index = 0; index < selectors.length; index += 1) {
    const candidate = document.querySelector(selectors[index]);
    if (isUsableScopeRoot(candidate)) {
      return candidate;
    }
  }

  return document.body;
}

export function findAnchorBlock(startElement) {
  if (!startElement) {
    return null;
  }

  let current = startElement;
  while (current && current !== document.body) {
    if (current.matches && current.matches(BLOCK_SELECTOR) && isVisibleBlock(current)) {
      return current;
    }
    current = current.parentElement;
  }

  const message = findMessageContainer(startElement);
  if (message) {
    const userLeaf = findUserMessageLeafBlock(message, startElement);
    if (userLeaf) {
      return userLeaf;
    }

    const messageBlocks = collectAnchorBlocks(message);
    const contained = messageBlocks.find(function (block) {
      return block.contains(startElement);
    });
    return contained || messageBlocks[0] || message;
  }

  return null;
}

export function collectAnchorBlocks(scope) {
  const root = getScopeRoot(scope);
  if (!root) {
    return [];
  }

  const candidates = [];
  if (root.matches && root.matches(BLOCK_SELECTOR)) {
    candidates.push(root);
  }
  candidates.push.apply(candidates, Array.from(root.querySelectorAll(BLOCK_SELECTOR)));

  const filtered = candidates.filter(function (element) {
    return isMeaningfulBlock(element);
  });

  if (filtered.length) {
    return uniqueElements(filtered);
  }

  const fallbacks = collectMessageContainers(root).filter(function (element) {
    return isMeaningfulBlock(element);
  });
  return uniqueElements(fallbacks);
}

export function findMessageContainer(element) {
  if (!element || !element.closest) {
    return null;
  }

  const candidate = element.closest(MESSAGE_SELECTOR);
  return isLikelyMessageContainer(candidate) ? candidate : null;
}

export function collectMessageContainers(scope) {
  const root = getScopeRoot(scope);
  if (!root) {
    return [];
  }

  const candidates = [];
  if (root.matches && root.matches(MESSAGE_SELECTOR)) {
    candidates.push(root);
  }
  candidates.push.apply(candidates, Array.from(root.querySelectorAll(MESSAGE_SELECTOR)));

  return uniqueElements(
    candidates.filter(function (element) {
      return isLikelyMessageContainer(element);
    })
  );
}

export function getMessageRole(element) {
  if (!element || !element.getAttribute) {
    return "";
  }

  return detectMessageRoleFromSignals([
    element.getAttribute("data-message-author-role"),
    element.getAttribute("data-author-role"),
    element.getAttribute("data-role"),
    element.getAttribute("data-testid"),
    element.getAttribute("aria-label"),
    element.id,
    typeof element.className === "string" ? element.className : ""
  ].join(" "));
}

export function findUserMessageTextContainer(message) {
  if (!message || getMessageRole(message) !== "user") {
    return null;
  }

  // Site-profile-aware selector (Solution D)
  var profile = getCurrentSiteProfile();
  if (profile && profile.userTextSelector) {
    var candidates = message.querySelectorAll(profile.userTextSelector);
    for (var j = 0; j < candidates.length; j += 1) {
      var candidate = candidates[j];
      if (isVisibleBlock(candidate) && getElementText(candidate).length >= 2) {
        return candidate;
      }
    }
  }

  // Fallback: div with direct text content (e.g., ChatGPT's whitespace-pre-wrap div)
  var divs = message.querySelectorAll("div");
  for (var i = 0; i < divs.length; i += 1) {
    var div = divs[i];
    var hasDirectText = Array.from(div.childNodes).some(function (child) {
      return child.nodeType === Node.TEXT_NODE && child.nodeValue.trim().length >= 2;
    });
    if (hasDirectText && !div.querySelector(BLOCK_SELECTOR) && isVisibleBlock(div)) {
      return div;
    }
  }

  return null;
}

export function getElementText(element) {
  if (!element) {
    return "";
  }

  const rawText = typeof element.innerText === "string" ? element.innerText : element.textContent;
  return normalizeText(rawText || "");
}

export function getElementScrollRatio(element) {
  const top = window.scrollY + element.getBoundingClientRect().top;
  const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  return clamp(top / max, 0, 1);
}

// ---- Additional exports (다른 모듈에서 필요) ----

export function getCurrentSiteProfile(input) {
  try {
    const url = input instanceof URL
      ? input
      : new URL(String(input || window.location.href), window.location.origin);
    const hostname = String(url.hostname || "").toLowerCase();

    return SITE_PROFILES.find(function (profile) {
      return profile.hosts.some(function (host) {
        return hostname === host || hostname.endsWith("." + host);
      });
    }) || null;
  } catch (error) {
    return null;
  }
}

export function isMeaningfulBlock(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  if (state.root && state.root.contains(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  return getElementText(element).length >= 8;
}

export function isVisibleBlock(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  if (state.root && state.root.contains(element)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  return true;
}

export function getElementRawText(element) {
  if (!element) {
    return "";
  }

  return String(typeof element.textContent === "string" ? element.textContent : "");
}

export function canElementContainText(element, candidates, anchor) {
  if (!element) {
    return false;
  }

  // Offset-based anchors: always allow (cannot pre-check by substring)
  if (anchor &&
      Number.isInteger(anchor.selectionStart) && anchor.selectionStart >= 0 &&
      Number.isInteger(anchor.selectionLength) && anchor.selectionLength > 0) {
    return true;
  }

  // Code anchors: always allow (raw text matching needs full text map)
  if (anchor && (
    anchor.blockTag === "pre" ||
    (Number.isInteger(anchor.selectionCodeOffsetStart) && anchor.selectionCodeOffsetStart >= 0) ||
    Boolean(anchor.selectionCodeContextFingerprint)
  )) {
    return true;
  }

  var rawText = String(element.textContent || "");

  // Small elements: skip pre-check (overhead > savings)
  if (rawText.length < 5000) {
    return true;
  }

  // Large elements: cheap substring check
  var textLower = normalizeText(rawText).toLowerCase();
  if (!textLower) {
    return false;
  }

  for (var i = 0; i < candidates.length; i += 1) {
    var needle = normalizeText(candidates[i]).toLowerCase();
    if (needle && textLower.indexOf(needle) !== -1) {
      return true;
    }
  }

  return false;
}

export function isCodeBlockElement(element) {
  if (!element || !(element instanceof Element)) {
    return false;
  }
  if (element.matches && element.matches("pre")) {
    return true;
  }
  if (element.closest("pre")) {
    return true;
  }
  if (element.querySelector("pre") || element.querySelector("pre > code")) {
    return true;
  }
  return false;
}

export function findViewportBlock() {
  const blocks = collectAnchorBlocks();
  if (!blocks.length) {
    return null;
  }

  const viewportCenter = window.innerHeight * 0.36;
  const visible = blocks
    .map(function (block) {
      const rect = block.getBoundingClientRect();
      return {
        block: block,
        rect: rect,
        distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter)
      };
    })
    .filter(function (entry) {
      return entry.rect.height > 0 && entry.rect.bottom > 72 && entry.rect.top < window.innerHeight - 32;
    })
    .sort(function (left, right) {
      return left.distance - right.distance;
    });

  const userVisible = visible.find(function (entry) {
    const message = findMessageContainer(entry.block);
    return getMessageRole(message) === "user";
  });
  if (userVisible && userVisible.distance <= 72) {
    return userVisible.block;
  }

  return visible[0] ? visible[0].block : blocks[0];
}

export function createSvgElement(tagName, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  const nextAttributes = attributes || {};
  Object.keys(nextAttributes).forEach(function (name) {
    element.setAttribute(name, nextAttributes[name]);
  });
  return element;
}
