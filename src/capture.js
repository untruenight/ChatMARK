// ============================================================
// anchor/capture.js — 북마크 앵커 캡처 (저장 시점의 위치 기록)
// ============================================================
// 비유: "보물 지도 그리기". 사용자가 선택한 텍스트의 위치를 다양한 좌표계로 기록합니다.

import state from './state.js';
import {
  MAX_CAPTURED_SELECTION_LENGTH,
  MAX_CAPTURED_SELECTION_RAW_LENGTH,
  POPUP_LIST_MARKER_ATTR,
  POPUP_LIST_LEAD_MARKER_ATTR
} from './constants.js';
import {
  normalizeText, truncateText, truncateRawText,
  fingerprintText, fingerprintRawText,
  uniqueElements, clamp
} from './text.js';
import {
  findAnchorBlock, collectAnchorBlocks,
  findMessageContainer, collectMessageContainers,
  getMessageRole, getElementText, getElementScrollRatio,
  isCodeBlockElement, findViewportBlock, getCurrentSiteProfile
} from './dom.js';

// ---- 콜백 슬롯 (selection.js 순환 의존 방지) ----
let _getSelectionElement = null;
let _isEditableTextSelectionTarget = null;

export function setCaptureSelectionCallbacks(callbacks) {
  _getSelectionElement = callbacks.getSelectionElement || null;
  _isEditableTextSelectionTarget = callbacks.isEditableTextSelectionTarget || null;
}

// ============================================================
// 핵심 캡처 함수
// ============================================================

function extractMessageStableId(messageElement, siteProfile) {
  if (!messageElement || !siteProfile || !siteProfile.messageIdAttr) {
    return "";
  }
  return messageElement.getAttribute(siteProfile.messageIdAttr) || "";
}

export function captureAnchor() {
  const selection = window.getSelection();
  const selectionText = selection && !selection.isCollapsed ? normalizeText(selection.toString()) : "";
  const selectionElement = _getSelectionElement ? _getSelectionElement(selection) : null;
  if (selection && !selection.isCollapsed && _isEditableTextSelectionTarget && _isEditableTextSelectionTarget(selectionElement)) {
    return null;
  }
  const block = findAnchorBlock(selectionElement) || findViewportBlock();

  if (!block) {
    return null;
  }

  const message = findMessageContainer(block);
  const messageStableId = extractMessageStableId(message, getCurrentSiteProfile());
  const allBlocks = collectAnchorBlocks();
  const blocksInMessage = message ? collectAnchorBlocks(message) : [];
  const blockText = getElementText(block);
  const selectionDetails = getSelectionAnchorDetails(block, selection, blockText);
  const selectionSpanDetails = getSelectionSpanDetails(selection);
  const selectionDisplayText = captureStructuredSelectionDisplayText(selection, {
    preserveWhitespace: Boolean(selectionDetails && selectionDetails.isCodeBlock)
  });
  const userExactDetails = getUserMessageExactSelectionDetails(message, selection);

  if (!blockText) {
    return null;
  }

  return {
    anchorId: block.id || "",
    blockTag: block.tagName.toLowerCase(),
    blockFingerprint: fingerprintText(blockText),
    messageFingerprint: message ? fingerprintText(getElementText(message)) : "",
    messageRole: message ? getMessageRole(message) : "",
    blockIndex: allBlocks.indexOf(block),
    blockIndexInMessage: blocksInMessage.indexOf(block),
    messageIndex: message ? collectMessageContainers().indexOf(message) : -1,
    scrollRatio: getElementScrollRatio(block),
    selectionText: truncateText(selectionText, MAX_CAPTURED_SELECTION_LENGTH),
    selectionDisplayText: selectionDisplayText,
    selectionTextRaw: selection && !selection.isCollapsed ? truncateRawText(selection.toString(), MAX_CAPTURED_SELECTION_RAW_LENGTH) : "",
    blockTextSnippet: truncateText(blockText, 220),
    selectionStart: selectionDetails ? selectionDetails.start : -1,
    selectionLength: selectionDetails ? selectionDetails.length : -1,
    selectionStartRatio: selectionDetails ? selectionDetails.startRatio : -1,
    selectionPrefix: selectionDetails ? selectionDetails.prefix : "",
    selectionSuffix: selectionDetails ? selectionDetails.suffix : "",
    selectionContextFingerprint: selectionDetails ? selectionDetails.contextFingerprint : "",
    selectionExactStart: userExactDetails ? userExactDetails.start : -1,
    selectionExactEnd: userExactDetails ? userExactDetails.end : -1,
    selectionRawPrefix: userExactDetails ? userExactDetails.prefix : "",
    selectionRawSuffix: userExactDetails ? userExactDetails.suffix : "",
    selectionCodeOffsetStart: selectionDetails ? selectionDetails.codeOffsetStart : -1,
    selectionCodeOffsetEnd: selectionDetails ? selectionDetails.codeOffsetEnd : -1,
    selectionCodeLine: selectionDetails ? selectionDetails.codeLine : -1,
    selectionCodeColumn: selectionDetails ? selectionDetails.codeColumn : -1,
    selectionCodeContextFingerprint: selectionDetails ? selectionDetails.codeContextFingerprint : "",
    selectionSpanStartFingerprint: selectionSpanDetails ? selectionSpanDetails.startBlockFingerprint : "",
    selectionSpanEndFingerprint: selectionSpanDetails ? selectionSpanDetails.endBlockFingerprint : "",
    selectionSpanBlockCount: selectionSpanDetails ? selectionSpanDetails.blockCount : -1,
    selectionSpanHead: selectionSpanDetails ? selectionSpanDetails.head : "",
    selectionSpanMiddle: selectionSpanDetails ? selectionSpanDetails.middle : "",
    selectionSpanTail: selectionSpanDetails ? selectionSpanDetails.tail : "",
    selectionSpanMarkerSignature: selectionSpanDetails ? selectionSpanDetails.markerSignature : "",
    messageStableId: messageStableId
  };
}

export function getSelectionAnchorDetails(block, selection, blockText) {
  if (!block || !selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentNode;

  if (!commonNode || !block.contains(commonNode)) {
    // Cross-block: partial capture if block contains selection start
    if (!block.contains(range.startContainer)) {
      return null;
    }
    try {
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(block);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefixText = normalizeText(prefixRange.toString());

      const clampedRange = document.createRange();
      clampedRange.selectNodeContents(block);
      clampedRange.setStart(range.startContainer, range.startOffset);
      const clampedText = normalizeText(clampedRange.toString());

      const fullSelectionText = normalizeText(range.toString());
      const normalizedBlockText = normalizeText(blockText);
      const start = prefixText.length;
      const codeBlock = isCodeBlockElement(block);

      return {
        start: start,
        length: clampedText.length,
        startRatio: normalizedBlockText
          ? clamp(start / Math.max(normalizedBlockText.length, 1), 0, 1)
          : -1,
        prefix: prefixText.slice(-64),
        suffix: clampedText.length > 64 ? clampedText.slice(-64) : clampedText,
        contextFingerprint: buildSelectionContextFingerprint(
          prefixText, fullSelectionText, clampedText.length > 64 ? clampedText.slice(-64) : clampedText
        ),
        isCodeBlock: codeBlock,
        codeOffsetStart: codeBlock ? prefixRange.toString().length : -1,
        codeOffsetEnd: -1,
        codeLine: codeBlock ? getCodeLinePosition(prefixRange.toString()).line : -1,
        codeColumn: codeBlock ? getCodeLinePosition(prefixRange.toString()).column : -1,
        codeContextFingerprint: ""
      };
    } catch (error) {
      return null;
    }
  }

  try {
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(block);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    const suffixRange = document.createRange();
    suffixRange.selectNodeContents(block);
    suffixRange.setStart(range.endContainer, range.endOffset);

    const prefixText = normalizeText(prefixRange.toString());
    const suffixText = normalizeText(suffixRange.toString());
    const selectedText = normalizeText(range.toString());
    const prefixRaw = prefixRange.toString();
    const suffixRaw = suffixRange.toString();
    const selectedRaw = range.toString();
    const start = prefixText.length;
    const normalizedBlockText = normalizeText(blockText);
    const codeBlock = isCodeBlockElement(block);
    const linePosition = codeBlock ? getCodeLinePosition(prefixRaw) : null;

    return {
      start: start,
      length: selectedText.length,
      startRatio: normalizedBlockText ? clamp(start / Math.max(normalizedBlockText.length, 1), 0, 1) : -1,
      prefix: prefixText.slice(-64),
      suffix: suffixText.slice(0, 64),
      contextFingerprint: buildSelectionContextFingerprint(prefixText, selectedText, suffixText),
      isCodeBlock: codeBlock,
      codeOffsetStart: codeBlock ? prefixRaw.length : -1,
      codeOffsetEnd: codeBlock ? prefixRaw.length + selectedRaw.length : -1,
      codeLine: linePosition ? linePosition.line : -1,
      codeColumn: linePosition ? linePosition.column : -1,
      codeContextFingerprint: codeBlock ? buildCodeSelectionContextFingerprint(prefixRaw, selectedRaw, suffixRaw) : ""
    };
  } catch (error) {
    return null;
  }
}

export function getSelectionSpanDetails(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const selectionText = normalizeText(range.toString());
  if (!selectionText || selectionText.length <= 36) {
    return null;
  }

  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer
    : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
    ? range.endContainer
    : range.endContainer.parentElement;
  const startBlock = findAnchorBlock(startElement);
  const endBlock = findAnchorBlock(endElement);

  if (!startBlock || !endBlock || startBlock === endBlock) {
    return null;
  }

  const startMessage = findMessageContainer(startBlock);
  const endMessage = findMessageContainer(endBlock);
  if (startMessage !== endMessage) {
    return null;
  }

  const blocks = collectIntersectingAnchorBlocks(range).filter(function (candidateBlock) {
    return candidateBlock && startMessage === findMessageContainer(candidateBlock);
  });
  if (blocks.length < 2) {
    return null;
  }

  return {
    startBlockFingerprint: fingerprintText(getElementText(startBlock)),
    endBlockFingerprint: fingerprintText(getElementText(endBlock)),
    blockCount: blocks.length,
    head: selectionText.slice(0, 32),
    middle: getSelectionSpanMiddleSnippet(selectionText, 32),
    tail: selectionText.slice(-32),
    markerSignature: buildSelectionSpanMarkerSignature(blocks)
  };
}

export function collectIntersectingAnchorBlocks(range) {
  if (!range) {
    return [];
  }

  const commonElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!commonElement) {
    return [];
  }

  const scope = findMessageContainer(commonElement) || commonElement;
  return collectAnchorBlocks(scope).filter(function (block) {
    try {
      return range.intersectsNode(block);
    } catch (error) {
      return false;
    }
  });
}

export function getSelectionSpanMiddleSnippet(text, length) {
  const normalizedText = normalizeText(text);
  const snippetLength = Math.max(0, Number(length) || 0);
  if (!normalizedText || normalizedText.length <= snippetLength || !snippetLength) {
    return normalizedText;
  }

  const startIndex = Math.max(0, Math.floor((normalizedText.length - snippetLength) / 2));
  return normalizedText.slice(startIndex, startIndex + snippetLength);
}

export function buildSelectionSpanMarkerSignature(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return "";
  }

  return blocks
    .map(getAnchorBlockMarker)
    .filter(Boolean)
    .slice(0, 6)
    .join("|");
}

export function getAnchorBlockMarker(block) {
  const listItem = block && block.matches && block.matches("li")
    ? block
    : getClosestListItem(block);
  if (!listItem) {
    return "";
  }

  return buildPopupListMarker(listItem);
}

export function getUserMessageExactSelectionDetails(message, selection) {
  if (!message || getMessageRole(message) !== "user" || !selection || selection.isCollapsed || selection.rangeCount < 1) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentNode;

  if (!commonNode || !message.contains(commonNode)) {
    return null;
  }

  try {
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(message);
    prefixRange.setEnd(range.startContainer, range.startOffset);

    const suffixRange = document.createRange();
    suffixRange.selectNodeContents(message);
    suffixRange.setStart(range.endContainer, range.endOffset);

    const prefixRaw = prefixRange.toString();
    const selectedRaw = range.toString();
    const suffixRaw = suffixRange.toString();
    if (!selectedRaw) {
      return null;
    }

    return {
      start: prefixRaw.length,
      end: prefixRaw.length + selectedRaw.length,
      prefix: prefixRaw.slice(-64),
      suffix: suffixRaw.slice(0, 64)
    };
  } catch (error) {
    return null;
  }
}

// ============================================================
// 핑거프린트 / 코드 위치 함수
// ============================================================

export function buildSelectionContextFingerprint(prefixText, selectionText, suffixText) {
  const prefix = normalizeText(prefixText).slice(-48);
  const selection = normalizeText(selectionText);
  const suffix = normalizeText(suffixText).slice(0, 48);

  if (!selection) {
    return "";
  }

  return fingerprintText(prefix + " | " + selection + " | " + suffix);
}

export function buildCodeSelectionContextFingerprint(prefixText, selectionText, suffixText) {
  const prefix = String(prefixText || "").slice(-64);
  const selection = String(selectionText || "");
  const suffix = String(suffixText || "").slice(0, 64);

  if (!selection) {
    return "";
  }

  return fingerprintRawText(prefix + "\n<sel>\n" + selection + "\n</sel>\n" + suffix);
}

export function getCodeLinePosition(prefixText) {
  const rawPrefix = String(prefixText || "");
  const lines = rawPrefix.split("\n");
  const lastLine = lines[lines.length - 1] || "";

  return {
    line: Math.max(0, lines.length - 1),
    column: lastLine.length
  };
}

export function isCodeAnchor(anchor) {
  return Boolean(
    anchor &&
    (
      anchor.blockTag === "pre" ||
      (Number.isInteger(anchor.selectionCodeOffsetStart) && anchor.selectionCodeOffsetStart >= 0) ||
      Boolean(anchor.selectionCodeContextFingerprint)
    )
  );
}

// ============================================================
// 구조화된 표시 텍스트 캡처 (display text)
// ============================================================

export function captureStructuredSelectionDisplayText(selection, options) {
  if (!selection || selection.isCollapsed || selection.rangeCount < 1) {
    return "";
  }

  try {
    return truncateRawText(
      extractStructuredPopupTextFromRange(selection.getRangeAt(0), options),
      MAX_CAPTURED_SELECTION_RAW_LENGTH
    );
  } catch (error) {
    return "";
  }
}

export function extractStructuredPopupTextFromRange(range, options) {
  if (!range) {
    return "";
  }

  const preserveWhitespace = Boolean(options && options.preserveWhitespace);
  if (preserveWhitespace) {
    return formatPopupDisplayText(range.toString(), true);
  }

  const markedListItems = annotatePopupListMarkers(range);
  let fragment = null;
  try {
    fragment = range.cloneContents();
  } finally {
    clearPopupListMarkers(markedListItems);
  }

  const parts = [];
  appendStructuredPopupText(fragment, parts);
  return formatPopupDisplayText(parts.join(""), false);
}

function appendStructuredPopupText(node, parts) {
  if (!node) {
    return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.nodeValue || "");
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }

  const tagName = node.nodeType === Node.ELEMENT_NODE && node.tagName ? node.tagName.toLowerCase() : "";
  if (tagName === "br") {
    pushPopupLineBreak(parts, 1);
    return;
  }

  const isParagraphBlock = /^(p|blockquote|pre|h1|h2|h3|h4|h5|h6)$/.test(tagName);
  const isListItem = tagName === "li";
  const blockBreakCount = isParagraphBlock ? getPopupParagraphBreakCount(tagName) : 1;
  const inlineLeadListBlock = isParagraphBlock && shouldInlineLeadListBlock(node);
  if ((isParagraphBlock || isListItem) && hasPopupTextContent(parts) && !inlineLeadListBlock) {
    pushPopupLineBreak(parts, isParagraphBlock ? blockBreakCount : 1);
  }

  const listMarker = isListItem ? getPopupListMarker(node) : "";
  const leadListMarker = !isListItem && !hasPopupMarkedListAncestor(node) ? getPopupLeadListMarker(node) : "";
  if (listMarker) {
    parts.push(listMarker);
  } else if (leadListMarker) {
    parts.push(leadListMarker);
  }

  Array.from(node.childNodes || []).forEach(function (childNode) {
    appendStructuredPopupText(childNode, parts);
  });

  if (isParagraphBlock && !inlineLeadListBlock) {
    pushPopupLineBreak(parts, blockBreakCount);
  } else if (isListItem) {
    pushPopupLineBreak(parts, 1);
  }
}

function getPopupParagraphBreakCount(tagName) {
  if (tagName === "p") {
    return 1;
  }

  return 2;
}

function shouldInlineLeadListBlock(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const listItem = getClosestListItem(node);
  if (!listItem) {
    return false;
  }

  return getPopupListLeadElement(listItem) === node;
}

function pushPopupLineBreak(parts, count) {
  const lineBreakCount = Math.max(1, count || 1);
  if (!parts.length) {
    return;
  }

  const lastPart = parts[parts.length - 1] || "";
  const trailingBreakMatch = lastPart.match(/\n+$/);
  const trailingBreaks = trailingBreakMatch ? trailingBreakMatch[0].length : 0;
  if (trailingBreaks >= lineBreakCount) {
    return;
  }

  parts.push("\n".repeat(lineBreakCount - trailingBreaks));
}

function hasPopupTextContent(parts) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (/\S/.test(parts[index] || "")) {
      return true;
    }
  }
  return false;
}

// ============================================================
// 리스트 마커 주석 처리 (popup display text용)
// ============================================================

function annotatePopupListMarkers(range) {
  const listItems = collectIntersectingListItems(range);
  const markedElements = [];
  const startListItem = getPopupRangeStartListItem(range);
  listItems.forEach(function (listItem) {
    if (!shouldAnnotatePopupListMarker(range, listItem, startListItem)) {
      return;
    }

    const marker = buildPopupListMarker(listItem);
    if (!marker) {
      return;
    }

    listItem.setAttribute(POPUP_LIST_MARKER_ATTR, marker);
    markedElements.push(listItem);

    const leadElement = getPopupListLeadElement(listItem);
    if (leadElement && leadElement !== listItem) {
      leadElement.setAttribute(POPUP_LIST_LEAD_MARKER_ATTR, marker);
      markedElements.push(leadElement);
    }
  });
  return uniqueElements(markedElements);
}

function clearPopupListMarkers(listItems) {
  if (!Array.isArray(listItems)) {
    return;
  }

  listItems.forEach(function (listItem) {
    if (listItem && listItem.removeAttribute) {
      listItem.removeAttribute(POPUP_LIST_MARKER_ATTR);
      listItem.removeAttribute(POPUP_LIST_LEAD_MARKER_ATTR);
    }
  });
}

function shouldAnnotatePopupListMarker(range, listItem, startListItem) {
  if (!listItem) {
    return false;
  }

  if (!startListItem || listItem !== startListItem) {
    return true;
  }

  return isPopupRangeAtOrBeforeListItemContentStart(range, listItem);
}

function getPopupRangeStartListItem(range) {
  if (!range) {
    return null;
  }

  return getClosestListItem(range.startContainer) || getBoundaryStartListItem(range.startContainer, range.startOffset);
}

function getBoundaryStartListItem(container, offset) {
  if (!container || container.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const childNodes = Array.from(container.childNodes || []);
  const nextNode = childNodes[offset] || null;
  const previousNode = offset > 0 ? childNodes[offset - 1] : null;

  return getClosestListItem(nextNode) || getClosestListItem(previousNode) || getClosestListItem(container);
}

function isPopupRangeAtOrBeforeListItemContentStart(range, listItem) {
  if (!range || !listItem) {
    return false;
  }

  const contentStart = getPopupListContentStart(listItem);
  if (!contentStart) {
    return true;
  }

  try {
    const startRange = (listItem.ownerDocument || document).createRange();
    startRange.setStart(range.startContainer, range.startOffset);
    startRange.collapse(true);

    const contentRange = (listItem.ownerDocument || document).createRange();
    contentRange.setStart(contentStart.node, contentStart.offset);
    contentRange.collapse(true);

    return startRange.compareBoundaryPoints(Range.START_TO_START, contentRange) <= 0;
  } catch (error) {
    return true;
  }
}

function getPopupListContentStart(listItem) {
  if (!listItem) {
    return null;
  }

  const documentRef = listItem.ownerDocument || document;
  const walker = documentRef.createTreeWalker(
    listItem,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        return /\S/.test(node && node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    }
  );

  const textNode = walker.nextNode();
  if (textNode) {
    const firstCharacterIndex = (textNode.nodeValue || "").search(/\S/);
    return {
      node: textNode,
      offset: firstCharacterIndex >= 0 ? firstCharacterIndex : 0
    };
  }

  const leadElement = getPopupListLeadElement(listItem);
  if (!leadElement) {
    return null;
  }

  return {
    node: leadElement,
    offset: 0
  };
}

function getPopupListLeadElement(listItem) {
  if (!listItem || !listItem.querySelectorAll) {
    return null;
  }

  const leadCandidates = Array.from(listItem.querySelectorAll("p, blockquote, pre, h1, h2, h3, h4, h5, h6"));
  for (let index = 0; index < leadCandidates.length; index += 1) {
    if (!hasMeaningfulPopupContentBeforeNode(listItem, leadCandidates[index])) {
      return leadCandidates[index];
    }
  }

  return null;
}

function hasMeaningfulPopupContentBeforeNode(root, target) {
  if (!root || !target) {
    return false;
  }

  const documentRef = root.ownerDocument || document;
  const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_ALL);
  let node = walker.nextNode();

  while (node) {
    if (node === target) {
      return false;
    }

    if (isMeaningfulPopupNode(node)) {
      return true;
    }

    node = walker.nextNode();
  }

  return false;
}

function isMeaningfulPopupNode(node) {
  if (!node) {
    return false;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return /\S/.test(node.nodeValue || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const element = node;
  if (element.hasAttribute && (element.hasAttribute(POPUP_LIST_MARKER_ATTR) || element.hasAttribute(POPUP_LIST_LEAD_MARKER_ATTR))) {
    return false;
  }

  const tagName = element.tagName ? element.tagName.toLowerCase() : "";
  if (/^(p|blockquote|pre|h1|h2|h3|h4|h5|h6)$/.test(tagName)) {
    return Boolean(formatPopupDisplayText(element.textContent || "", tagName === "pre"));
  }

  return false;
}

function collectIntersectingListItems(range) {
  if (!range) {
    return [];
  }

  const rootElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!rootElement) {
    return [];
  }

  const startListItem = getClosestListItem(range.startContainer);
  const endListItem = getClosestListItem(range.endContainer);
  const candidates = []
    .concat(startListItem || [])
    .concat(endListItem || [])
    .concat(Array.from(rootElement.querySelectorAll ? rootElement.querySelectorAll("li") : []));

  return uniqueElements(
    candidates.filter(function (listItem) {
      if (!listItem || !listItem.matches || !listItem.matches("li")) {
        return false;
      }
      try {
        return range.intersectsNode(listItem);
      } catch (error) {
        return false;
      }
    })
  );
}

// ============================================================
// 리스트 유틸리티
// ============================================================

function getClosestListItem(node) {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return node.matches && node.matches("li") ? node : node.closest ? node.closest("li") : null;
  }

  return node.parentElement && node.parentElement.closest ? node.parentElement.closest("li") : null;
}

function buildPopupListMarker(listItem) {
  if (!listItem || !listItem.parentElement) {
    return "";
  }

  const list = listItem.parentElement;
  const listTag = list.tagName ? list.tagName.toLowerCase() : "";
  if (listTag === "ul") {
    return "- ";
  }
  if (listTag !== "ol") {
    return "";
  }

  const orderedValue = getOrderedListMarkerValue(list, listItem);
  return orderedValue ? String(orderedValue) + ". " : "";
}

function getOrderedListMarkerValue(list, targetItem) {
  if (!list || !targetItem) {
    return 0;
  }

  const items = Array.from(list.children).filter(function (child) {
    return child && child.tagName && child.tagName.toLowerCase() === "li";
  });
  if (!items.length) {
    return 0;
  }

  const isReversed = list.hasAttribute("reversed");
  let counter = parseIntegerAttribute(list.getAttribute("start"));
  if (!Number.isFinite(counter)) {
    counter = isReversed ? items.length : 1;
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const explicitValue = parseIntegerAttribute(item.getAttribute("value"));
    if (Number.isFinite(explicitValue)) {
      counter = explicitValue;
    }
    if (item === targetItem) {
      return counter;
    }
    counter += isReversed ? -1 : 1;
  }

  return 0;
}

function parseIntegerAttribute(value) {
  if (value === null || value === undefined || value === "") {
    return NaN;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getPopupListMarker(node) {
  if (!node || !node.getAttribute) {
    return "";
  }

  return node.getAttribute(POPUP_LIST_MARKER_ATTR) || "";
}

function getPopupLeadListMarker(node) {
  if (!node || !node.getAttribute) {
    return "";
  }

  return node.getAttribute(POPUP_LIST_LEAD_MARKER_ATTR) || "";
}

function hasPopupMarkedListAncestor(node) {
  if (!node || !node.closest) {
    return false;
  }

  const listItem = node.closest("li");
  return Boolean(listItem && getPopupListMarker(listItem));
}

// ============================================================
// 리스트 마커 줄바꿈 정규화
// ============================================================

function normalizePopupListMarkerLineBreaks(value) {
  const normalizedValue = String(value || "");
  if (!normalizedValue) {
    return "";
  }

  return mergeSeparatedPopupMarkerLines(
    normalizedValue
    .split("\n")
    .reduce(function (lines, line) {
      return lines.concat(expandCollapsedPopupHeaderListLine(line));
    }, [])
    .map(splitInlinePopupListMarkers)
    .join("\n")
  )
    .replace(/\n{3,}/g, "\n\n");
}

function mergeSeparatedPopupMarkerLines(value) {
  const source = String(value || "");
  if (!source) {
    return "";
  }

  const lines = source.split("\n");
  const mergedLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] || "";
    if (!isPopupStandaloneMarkerLine(currentLine)) {
      mergedLines.push(currentLine);
      continue;
    }

    const nextLine = lines[index + 1] || "";
    if (!nextLine.trim() || isPopupStandaloneMarkerLine(nextLine)) {
      mergedLines.push(currentLine);
      continue;
    }

    mergedLines.push(joinSeparatedPopupMarkerLine(currentLine, nextLine));
    index += 1;
  }

  return mergedLines.join("\n");
}

function joinSeparatedPopupMarkerLine(markerLine, contentLine) {
  const normalizedMarkerLine = String(markerLine || "");
  const normalizedContentLine = String(contentLine || "").replace(/^[ \t]+/g, "");
  if (!normalizedContentLine) {
    return normalizedMarkerLine;
  }

  if (/\d\.\s*$/.test(normalizedMarkerLine)) {
    return normalizedMarkerLine + " " + normalizedContentLine;
  }

  return normalizedMarkerLine + normalizedContentLine;
}

function expandCollapsedPopupHeaderListLine(line) {
  const source = String(line || "");
  if (!source || /^\s*(?:\d{1,3}\.(?!\d)\s*|[-*•]\s+)/.test(source)) {
    return [source];
  }

  for (let index = 1; index < source.length; index += 1) {
    if (!isInlinePopupListMarkerStart(source, index)) {
      continue;
    }

    const prefix = source.slice(0, index);
    if (!/[:：]\s*$/.test(prefix)) {
      continue;
    }

    const markerCount = countPopupListMarkersInLine(source.slice(index));
    if (markerCount < 2) {
      continue;
    }

    return [
      prefix.replace(/[ \t]+$/g, ""),
      source.slice(index).replace(/^[ \t]+/g, "")
    ];
  }

  return [source];
}

function splitInlinePopupListMarkers(line) {
  const source = String(line || "");
  if (!source || !/^\s*(?:\d{1,3}\.(?!\d)\s*|[-*•]\s+)/.test(source)) {
    return source;
  }

  const breakpoints = [];
  let segmentStart = 0;
  const initialMarkerMatch = source.match(/^\s*(?:\d{1,3}\.(?!\d)\s*|[-*•]\s+)/);
  let index = initialMarkerMatch ? initialMarkerMatch[0].length : 0;

  while (index < source.length) {
    if (!isInlinePopupListMarkerStart(source, index)) {
      index += 1;
      continue;
    }

    const previousSegment = source.slice(segmentStart, index);
    const previousContent = previousSegment.replace(/^\s*(?:\d{1,3}\.(?!\d)\s*|[-*•]\s+)/, "").trim();
    if (!previousContent) {
      index += 1;
      continue;
    }

    breakpoints.push(index);
    segmentStart = index;
    index += 1;
  }

  if (!breakpoints.length) {
    return source;
  }

  const segments = [];
  let cursor = 0;
  breakpoints.forEach(function (breakpoint) {
    segments.push(source.slice(cursor, breakpoint).replace(/[ \t]+$/g, ""));
    cursor = breakpoint;
  });
  segments.push(source.slice(cursor));
  return segments.join("\n");
}

function countPopupListMarkersInLine(line) {
  const source = String(line || "");
  if (!source) {
    return 0;
  }

  const initialMarkerMatch = source.match(/^\s*(?:\d{1,3}\.(?!\d)\s*|[-*•]\s+)/);
  if (!initialMarkerMatch) {
    return 0;
  }

  let count = 1;
  let index = initialMarkerMatch[0].length;
  while (index < source.length) {
    if (isInlinePopupListMarkerStart(source, index)) {
      count += 1;
    }
    index += 1;
  }

  return count;
}

function isPopupStandaloneMarkerLine(line) {
  return /^(?:\s*[-*•]\s*|\s*\d{1,3}\.\s*)$/.test(String(line || ""));
}

function isInlinePopupListMarkerStart(text, index) {
  const source = String(text || "");
  if (!source || index <= 0 || index >= source.length) {
    return false;
  }

  if (/\d/.test(source.charAt(index - 1) || "")) {
    return false;
  }

  const character = source.charAt(index);
  if (character === "-" || character === "*" || character === "•") {
    return /\s/.test(source.charAt(index + 1) || "");
  }

  if (!/\d/.test(character)) {
    return false;
  }

  let cursor = index;
  while (cursor < source.length && /\d/.test(source.charAt(cursor))) {
    cursor += 1;
  }

  if (cursor === index || cursor - index > 3 || source.charAt(cursor) !== ".") {
    return false;
  }

  return !/\d/.test(source.charAt(cursor + 1) || "");
}

export function formatPopupDisplayText(value, preserveWhitespace) {
  const rawText = String(value || "").replace(/\r\n?/g, "\n");
  if (!rawText) {
    return "";
  }

  if (preserveWhitespace) {
    return normalizePopupListMarkerLineBreaks(rawText.trim());
  }

  return normalizePopupListMarkerLineBreaks(
    rawText
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+\n/g, "\n")
      .replace(/\n[ \t\f\v]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
