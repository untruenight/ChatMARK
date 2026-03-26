// ============================================================
// anchor/resolve.js — 저장된 앵커로부터 현재 DOM 타겟을 찾는 엔진
// ============================================================
// 비유: "보물 지도 해독". 저장해둔 좌표(앵커)로 현재 페이지에서 해당 위치를 다시 찾습니다.
// 점수 기반 매칭: 여러 후보에 점수를 매기고 가장 높은 점수의 블록을 선택합니다.

import state from './state.js';
import { MESSAGE_SELECTOR } from './constants.js';
import {
  normalizeText, fingerprintText, uniqueElements, clamp
} from './text.js';
import {
  getScopeRoot, findAnchorBlock, collectAnchorBlocks,
  findMessageContainer, collectMessageContainers,
  getMessageRole, getElementText, getElementRawText,
  getElementScrollRatio, isCodeBlockElement, isMeaningfulBlock,
  getCurrentSiteProfile
} from './dom.js';
import { isFrameRelayAnchor } from './bridge.js';
import {
  isSandboxCardAnchor, collectClaudeSandboxCardCandidates
} from './sandbox-card.js';
import {
  isCodeAnchor, getCodeLinePosition,
  buildSelectionContextFingerprint, buildCodeSelectionContextFingerprint,
  buildSelectionSpanMarkerSignature
} from './capture.js';

// ============================================================
// CSA (Conversation-Structural Anchoring) — bastion disambiguation
// ============================================================

function isResolveScoringAmbiguous(bestMatch, secondBestMatch, anchor) {
  if (!bestMatch || !secondBestMatch) {
    return false;
  }
  const scoreDelta = bestMatch.score - secondBestMatch.score;
  if (bestMatch.hasSelectionMatch && secondBestMatch.hasSelectionMatch && scoreDelta < 40) {
    return true;
  }
  if (scoreDelta < 20) {
    return true;
  }
  if (!bestMatch.hasSelectionMatch && bestMatch.score < 60) {
    return true;
  }
  return false;
}

function resolveMessageByCSA(anchor) {
  if (!anchor || !anchor.messageStableId) {
    return null;
  }
  const profile = getCurrentSiteProfile();
  if (!profile || !profile.messageIdAttr) {
    return null;
  }
  const selector = "[" + CSS.escape(profile.messageIdAttr) + '="' + CSS.escape(anchor.messageStableId) + '"]';
  const message = document.querySelector(selector);
  if (!message) {
    return null;
  }
  if (anchor.messageFingerprint) {
    const currentFingerprint = fingerprintText(getElementText(message));
    if (currentFingerprint !== anchor.messageFingerprint) {
      return null;
    }
  }
  return message;
}

function pickCandidateInCSAMessage(candidates, message) {
  if (!message || !Array.isArray(candidates)) {
    return null;
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i] && candidates[i].context && candidates[i].context.block
        && message.contains(candidates[i].context.block)) {
      return candidates[i];
    }
  }
  return null;
}

// ============================================================
// 핵심 resolve 함수
// ============================================================

export function resolveBookmarkTarget(bookmark) {
  if (!bookmark || !bookmark.anchor) {
    return null;
  }

  const anchor = bookmark.anchor;
  if (isFrameRelayAnchor(anchor)) {
    return null;
  }
  if (isSandboxCardAnchor(anchor)) {
    return resolveSandboxCardTarget(anchor);
  }
  const exactTarget = resolveUserExactTarget(bookmark);
  if (exactTarget) {
    return exactTarget.block;
  }

  const byId = resolveById(anchor);
  if (byId) {
    return byId;
  }

  const contexts = buildBlockContexts();
  if (!contexts.length) {
    return null;
  }

  const multiBlockTarget = resolveMultiBlockTarget(anchor, contexts);
  if (multiBlockTarget) {
    return multiBlockTarget;
  }

  const matches = contexts.map(function (context) {
    return scoreContext(anchor, bookmark, context);
  });
  const selectionChoice = pickSelectionContextMatch(matches, anchor);
  if (selectionChoice) {
    return selectionChoice.context.block;
  }

  let bestMatch = null;
  let secondBestMatch = null;

  matches.forEach(function (match) {
    if (!bestMatch || isBetterContextMatch(match, bestMatch, anchor)) {
      secondBestMatch = bestMatch;
      bestMatch = match;
      return;
    }

    if (!secondBestMatch || isBetterContextMatch(match, secondBestMatch, anchor)) {
      secondBestMatch = match;
    }
  });

  // CSA bastion: disambiguate when B₁ scoring is ambiguous
  if (isResolveScoringAmbiguous(bestMatch, secondBestMatch, anchor)) {
    try {
      const csaMessage = resolveMessageByCSA(anchor);
      if (csaMessage) {
        const csaConfirmed = pickCandidateInCSAMessage(
          [bestMatch, secondBestMatch], csaMessage
        );
        if (csaConfirmed) {
          return csaConfirmed.context.block;
        }
      }
    } catch (csaError) {
      // CSA failure — silent, proceed to existing logic
    }
  }

  if (bestMatch && shouldResolveFromContext(bestMatch, secondBestMatch, anchor)) {
    return bestMatch.context.block;
  }

  if (Number.isInteger(anchor.blockIndex) && anchor.blockIndex >= 0 && anchor.blockIndex < contexts.length) {
    return contexts[anchor.blockIndex].block;
  }

  return fallbackByScrollRatio(anchor.scrollRatio, contexts);
}

// ============================================================
// Sandbox card resolve
// ============================================================

export function resolveSandboxCardTarget(anchor) {
  const candidates = collectClaudeSandboxCardCandidates();
  if (!candidates.length) {
    return null;
  }

  let bestCandidate = null;
  let bestScore = -Infinity;

  candidates.forEach(function (candidate) {
    let score = 0;

    if (anchor.anchorId && candidate.anchorId && candidate.anchorId === anchor.anchorId) {
      score += 110;
    }
    if (anchor.sandboxCardKey && candidate.key === anchor.sandboxCardKey) {
      score += 140;
    }
    if (anchor.sandboxCardFingerprint && candidate.cardFingerprint === anchor.sandboxCardFingerprint) {
      score += 90;
    } else if (anchor.blockFingerprint && candidate.cardFingerprint === anchor.blockFingerprint) {
      score += 72;
    }
    if (anchor.sandboxCardFrameHref && candidate.frameHref === anchor.sandboxCardFrameHref) {
      score += 84;
    }
    if (anchor.sandboxCardFrameName && candidate.frameName === anchor.sandboxCardFrameName) {
      score += 24;
    }
    if (anchor.sandboxCardFrameSandbox && candidate.frameSandbox === anchor.sandboxCardFrameSandbox) {
      score += 18;
    }
    if (anchor.sandboxCardFrameFingerprint && candidate.frameFingerprint === anchor.sandboxCardFrameFingerprint) {
      score += 108;
    }
    if (anchor.sandboxCardFramePathFingerprint && candidate.framePathFingerprint === anchor.sandboxCardFramePathFingerprint) {
      score += 128;
    }
    if (anchor.sandboxCardContainerFingerprint && candidate.containerFingerprint === anchor.sandboxCardContainerFingerprint) {
      score += 132;
    }
    if (anchor.sandboxCardContainerPathFingerprint && candidate.containerPathFingerprint === anchor.sandboxCardContainerPathFingerprint) {
      score += 96;
    }
    if (anchor.sandboxCardPositionFingerprint && candidate.positionFingerprint === anchor.sandboxCardPositionFingerprint) {
      score += 72;
    }
    if (Number.isInteger(anchor.sandboxCardDomIndex) && anchor.sandboxCardDomIndex >= 0) {
      score += Math.max(0, 42 - (Math.abs(anchor.sandboxCardDomIndex - candidate.domIndex) * 12));
    }
    if (Number.isInteger(anchor.sandboxCardFrameSiblingIndex) && anchor.sandboxCardFrameSiblingIndex >= 0) {
      score += Math.max(0, 28 - (Math.abs(anchor.sandboxCardFrameSiblingIndex - candidate.sandboxSiblingIndex) * 10));
    }
    if (Number.isInteger(anchor.sandboxCardIndex) && anchor.sandboxCardIndex >= 0) {
      score += Math.max(0, 20 - (Math.abs(anchor.sandboxCardIndex - candidate.index) * 6));
    }
    if (Number.isFinite(anchor.scrollRatio)) {
      score += Math.max(0, 18 - Math.round(Math.abs(anchor.scrollRatio - candidate.scrollRatio) * 64));
    }

    if (!bestCandidate || score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  });

  return bestCandidate ? bestCandidate.frame : null;
}

// ============================================================
// User exact resolve
// ============================================================

export function resolveUserExactTarget(bookmark) {
  const anchor = bookmark && bookmark.anchor ? bookmark.anchor : null;
  if (!hasUserExactAnchor(anchor)) {
    return null;
  }

  const messages = collectUserMessagesForExactTarget();
  let bestCandidate = null;

  messages.forEach(function (message, index) {
    if (getMessageRole(message) !== "user") {
      return;
    }

    const candidate = findUserExactMatchInMessage(message, anchor);
    if (!candidate) {
      return;
    }

    candidate.score = scoreUserExactMessageCandidate(message, anchor, candidate.match);
    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  });

  return bestCandidate;
}

export function hasUserExactAnchor(anchor) {
  return Boolean(
    anchor &&
    anchor.messageRole === "user" &&
    Number.isInteger(anchor.selectionExactStart) &&
    Number.isInteger(anchor.selectionExactEnd) &&
    anchor.selectionExactStart >= 0 &&
    anchor.selectionExactEnd > anchor.selectionExactStart
  );
}

function collectUserMessagesForExactTarget() {
  const root = getScopeRoot();
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
      return getMessageRole(element) === "user" && getElementRawText(element).length > 0;
    })
  );
}

export function findUserExactMatchInMessage(message, anchor) {
  if (!message || getMessageRole(message) !== "user" || !hasUserExactAnchor(anchor)) {
    return null;
  }

  const textMap = buildTargetTextMap(message, {
    preserveWhitespace: true
  });
  if (!textMap || !textMap.rawText) {
    return null;
  }

  const match = findUserExactTextMatch(textMap, anchor);
  if (!match) {
    return null;
  }

  return {
    message: message,
    block: findExactMatchBlock(message, match),
    match: match
  };
}

function findUserExactTextMatch(textMap, anchor) {
  if (!textMap || !textMap.rawText || !hasUserExactAnchor(anchor)) {
    return null;
  }

  const exactStart = anchor.selectionExactStart;
  const exactEnd = anchor.selectionExactEnd;
  if (exactEnd > textMap.rawText.length) {
    return null;
  }

  const rawSelection = textMap.rawText.slice(exactStart, exactEnd);
  if (!rawSelection) {
    return null;
  }

  const prefixMatched = !anchor.selectionRawPrefix || textMap.rawText
    .slice(Math.max(0, exactStart - anchor.selectionRawPrefix.length), exactStart)
    .endsWith(anchor.selectionRawPrefix);
  const suffixMatched = !anchor.selectionRawSuffix || textMap.rawText
    .slice(exactEnd, exactEnd + anchor.selectionRawSuffix.length)
    .startsWith(anchor.selectionRawSuffix);
  const normalizedSelection = normalizeText(rawSelection);
  const expectedSelection = normalizeText(anchor.selectionText || "");

  if ((anchor.selectionRawPrefix && !prefixMatched) || (anchor.selectionRawSuffix && !suffixMatched)) {
    return null;
  }
  if (expectedSelection && normalizedSelection !== expectedSelection) {
    return null;
  }

  const match = buildRawOffsetMatch(textMap, exactStart, exactEnd, {
    isCodeMatch: false,
    isStrongTextMatch: true
  });
  if (!match) {
    return null;
  }

  match.isUserExactMatch = true;
  match.prefixMatched = prefixMatched;
  match.suffixMatched = suffixMatched;
  return match;
}

function scoreUserExactMessageCandidate(message, anchor, match) {
  let score = 0;
  const messageIndex = collectMessageContainers().indexOf(message);

  if (anchor.messageFingerprint && fingerprintText(getElementText(message)) === anchor.messageFingerprint) {
    score += 120;
  }
  if (Number.isInteger(anchor.messageIndex) && anchor.messageIndex >= 0 && messageIndex >= 0) {
    score += Math.max(0, 48 - Math.abs(anchor.messageIndex - messageIndex) * 12);
  }
  if (match && match.prefixMatched) {
    score += 18;
  }
  if (match && match.suffixMatched) {
    score += 18;
  }

  return score;
}

function findExactMatchBlock(message, match) {
  if (!message || !match || !match.startNode || !match.endNode) {
    return message || null;
  }

  const startElement = match.startNode.nodeType === Node.TEXT_NODE ? match.startNode.parentElement : match.startNode;
  const endElement = match.endNode.nodeType === Node.TEXT_NODE ? match.endNode.parentElement : match.endNode;
  const candidateBlocks = collectAnchorBlocks(message).filter(function (block) {
    return block.contains(startElement) && block.contains(endElement);
  });

  if (candidateBlocks.length) {
    candidateBlocks.sort(function (left, right) {
      return getElementText(left).length - getElementText(right).length;
    });
    return candidateBlocks[0];
  }

  return findAnchorBlock(startElement) || message;
}

// ============================================================
// 블록 컨텍스트 & 점수 계산
// ============================================================

function resolveById(anchor) {
  if (!anchor.anchorId) {
    return null;
  }

  const candidate = document.getElementById(anchor.anchorId);
  if (!candidate) {
    return null;
  }

  const block = findAnchorBlock(candidate);
  const resolved = block || (isMeaningfulBlock(candidate) ? candidate : null);
  if (!resolved) {
    return null;
  }

  // Content verification: ID match is necessary but not sufficient
  if (anchor.blockFingerprint) {
    const currentFingerprint = fingerprintText(getElementText(resolved));
    if (currentFingerprint !== anchor.blockFingerprint) {
      return null;   // ID exists but content changed → escalate to B₁
    }
  }
  return resolved;
}

function buildBlockContexts() {
  const allBlocks = collectAnchorBlocks();
  const messages = collectMessageContainers();
  const blocksByMessage = new Map();

  return allBlocks.map(function (block, index) {
    const message = findMessageContainer(block);
    let messageBlocks = [];
    if (message) {
      messageBlocks = blocksByMessage.get(message) || collectAnchorBlocks(message);
      blocksByMessage.set(message, messageBlocks);
    }

    const text = getElementText(block);
    const messageText = message ? getElementText(message) : "";

    return {
      block: block,
      index: index,
      text: text,
      rawText: isCodeBlockElement(block) ? getElementRawText(block) : "",
      isCodeBlock: isCodeBlockElement(block),
      fingerprint: fingerprintText(text),
      tag: block.tagName.toLowerCase(),
      messageRole: message ? getMessageRole(message) : "",
      messageIndex: message ? messages.indexOf(message) : -1,
      blockIndexInMessage: message ? messageBlocks.indexOf(block) : -1,
      messageFingerprint: message ? fingerprintText(messageText) : "",
      scrollRatio: getElementScrollRatio(block)
    };
  });
}

function scoreContext(anchor, bookmark, context) {
  if (!context.text) {
    return {
      context: context,
      score: -Infinity,
      selectionStrength: -Infinity,
      hasSelectionMatch: false,
      occurrenceDistance: Number.MAX_SAFE_INTEGER
    };
  }

  let score = 0;
  const codeAnchor = isCodeAnchor(anchor);
  const snippet = normalizeText(anchor.selectionText || bookmark.snippet || "");
  const isShortSelection = snippet.length > 0 && snippet.length <= 36;
  const blockSnippet = normalizeText(anchor.blockTextSnippet || "");
  const normalizedText = context.text.toLowerCase();
  const codeSelectionMatch = codeAnchor && context.isCodeBlock ? findBestCodeOccurrence(context.rawText, anchor) : null;
  const selectionMatch = codeAnchor
    ? (context.isCodeBlock ? (codeSelectionMatch || (snippet ? findBestTextOccurrence(context.text, snippet, anchor) : null)) : null)
    : (snippet ? findBestTextOccurrence(context.text, snippet, anchor) : null);
  const blockMatch = codeAnchor ? null : (blockSnippet ? findBestTextOccurrence(context.text, blockSnippet.slice(0, 120), anchor) : null);
  const hasSelectionHints = hasSelectionContextHints(anchor);
  const selectionStrength = selectionMatch ? selectionMatch.score : -Infinity;

  if (anchor.anchorId && context.block.id === anchor.anchorId) {
    score += 120;
  }
  if (anchor.blockFingerprint && context.fingerprint === anchor.blockFingerprint) {
    score += 100;
  }
  if (anchor.messageFingerprint && context.messageFingerprint === anchor.messageFingerprint) {
    score += 56;
  }
  if (anchor.messageRole && context.messageRole === anchor.messageRole) {
    score += isShortSelection ? 22 : 10;
  } else if (anchor.messageRole && context.messageRole) {
    score -= isShortSelection ? 18 : 6;
  }
  if (codeAnchor && !context.isCodeBlock) {
    score -= 72;
  }
  if (selectionMatch) {
    score += (codeAnchor ? 126 : 96) + selectionMatch.score;
    if (selectionMatch.count === 1) {
      score += 8;
    }
    if (selectionMatch.prefixScore > 0 && selectionMatch.suffixScore > 0) {
      score += 22;
    }
    if (selectionMatch.positionScore > 0) {
      score += isShortSelection ? 24 : 14;
    }
    if (selectionMatch.lineScore > 0) {
      score += 12;
    }
    if (isShortSelection) {
      score += Math.min(28, selectionMatch.prefixScore + selectionMatch.suffixScore);
    }
  } else if (snippet) {
    score -= codeAnchor ? 58 : (hasSelectionHints ? 46 : 26);
  }
  if (blockMatch) {
    score += 18 + Math.min(blockMatch.score, 20);
  } else if (blockSnippet && normalizedText.indexOf(blockSnippet.toLowerCase().slice(0, 90)) !== -1) {
    score += 12;
  }
  if (anchor.blockTag && context.tag === anchor.blockTag) {
    score += 10;
  }
  if (Number.isInteger(anchor.messageIndex) && anchor.messageIndex === context.messageIndex) {
    score += 18;
  }
  if (Number.isInteger(anchor.blockIndexInMessage) && anchor.blockIndexInMessage >= 0 && context.blockIndexInMessage >= 0) {
    score += Math.max(0, 14 - Math.abs(anchor.blockIndexInMessage - context.blockIndexInMessage) * 4);
  }
  if (Number.isInteger(anchor.blockIndex) && anchor.blockIndex >= 0) {
    score += Math.max(0, 12 - Math.abs(anchor.blockIndex - context.index));
  }
  if (Number.isFinite(anchor.scrollRatio)) {
    score += Math.max(0, 12 - Math.round(Math.abs(anchor.scrollRatio - context.scrollRatio) * 48));
  }

  return {
    context: context,
    score: score,
    selectionStrength: selectionStrength,
    hasSelectionMatch: Boolean(selectionMatch),
    occurrenceDistance: selectionMatch ? selectionMatch.distance : Number.MAX_SAFE_INTEGER,
    selectionContextFingerprintMatch: Boolean(selectionMatch && selectionMatch.contextFingerprintMatch),
    isShortSelection: isShortSelection,
    roleMatch: Boolean(anchor.messageRole && context.messageRole && anchor.messageRole === context.messageRole)
  };
}

function pickSelectionContextMatch(matches, anchor) {
  if (!anchor || !(anchor.selectionText || anchor.selectionTextRaw)) {
    return null;
  }

  const ranked = matches
    .filter(function (match) {
      return match && match.hasSelectionMatch;
    })
    .sort(function (left, right) {
      return compareSelectionContextMatches(left, right);
    });

  if (!ranked.length) {
    return null;
  }

  const bestMatch = ranked[0];
  const secondBestMatch = ranked[1] || null;
  const gap = secondBestMatch ? bestMatch.selectionStrength - secondBestMatch.selectionStrength : bestMatch.selectionStrength;

  if (bestMatch.selectionContextFingerprintMatch && bestMatch.selectionStrength >= 120) {
    return bestMatch;
  }

  if (bestMatch.selectionStrength >= 140) {
    return bestMatch;
  }

  if (bestMatch.selectionStrength >= 92 && gap >= 18) {
    return bestMatch;
  }

  return null;
}

function compareSelectionContextMatches(left, right) {
  if (left.roleMatch !== right.roleMatch && (left.isShortSelection || right.isShortSelection)) {
    return left.roleMatch ? -1 : 1;
  }

  if (left.selectionContextFingerprintMatch !== right.selectionContextFingerprintMatch) {
    return left.selectionContextFingerprintMatch ? -1 : 1;
  }

  if (left.selectionStrength !== right.selectionStrength) {
    return right.selectionStrength - left.selectionStrength;
  }

  if (left.occurrenceDistance !== right.occurrenceDistance) {
    return left.occurrenceDistance - right.occurrenceDistance;
  }

  return right.score - left.score;
}

function isBetterContextMatch(candidate, currentBest, anchor) {
  if (candidate.roleMatch !== currentBest.roleMatch && anchor.messageRole && candidate.isShortSelection) {
    return candidate.roleMatch;
  }

  if (candidate.hasSelectionMatch !== currentBest.hasSelectionMatch && anchor.selectionText) {
    return candidate.hasSelectionMatch;
  }

  if (candidate.selectionContextFingerprintMatch !== currentBest.selectionContextFingerprintMatch) {
    return candidate.selectionContextFingerprintMatch;
  }

  if (candidate.selectionStrength !== currentBest.selectionStrength) {
    return candidate.selectionStrength > currentBest.selectionStrength;
  }

  if (candidate.occurrenceDistance !== currentBest.occurrenceDistance) {
    return candidate.occurrenceDistance < currentBest.occurrenceDistance;
  }

  return candidate.score > currentBest.score;
}

function shouldResolveFromContext(bestMatch, secondBestMatch, anchor) {
  const hasContentSignal = bestMatch.hasSelectionMatch
    || (anchor.blockFingerprint && bestMatch.context.fingerprint === anchor.blockFingerprint);
  const minimumScore = anchor.selectionText ? 42
    : hasContentSignal ? 24
    : 48;
  if (bestMatch.score >= minimumScore) {
    return true;
  }

  if (!anchor.selectionText || !bestMatch.hasSelectionMatch) {
    return false;
  }

  const selectionGap = secondBestMatch && secondBestMatch.hasSelectionMatch
    ? bestMatch.selectionStrength - secondBestMatch.selectionStrength
    : bestMatch.selectionStrength;

  return bestMatch.selectionStrength >= 110 || selectionGap >= 26;
}

function fallbackByScrollRatio(ratio, contexts) {
  if (!contexts.length) {
    return null;
  }

  const targetRatio = Number.isFinite(ratio) ? ratio : 0.5;
  let bestContext = contexts[0];
  let bestDelta = Math.abs(bestContext.scrollRatio - targetRatio);

  contexts.forEach(function (context) {
    const delta = Math.abs(context.scrollRatio - targetRatio);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestContext = context;
    }
  });

  return bestContext.block;
}

// ============================================================
// 멀티블록 span resolve
// ============================================================

function resolveMultiBlockTarget(anchor, contexts) {
  if (!hasMultiBlockSelectionSpan(anchor) || !Array.isArray(contexts) || contexts.length < 2) {
    return null;
  }

  let bestCandidate = null;
  let secondBestCandidate = null;

  contexts.forEach(function (context, startIndex) {
    if (!isPlausibleMultiBlockSpanStart(anchor, context)) {
      return;
    }

    const maxEndIndex = Math.min(
      contexts.length - 1,
      startIndex + Math.max(6, Math.max(2, anchor.selectionSpanBlockCount) + 3)
    );

    for (let endIndex = startIndex + 1; endIndex <= maxEndIndex; endIndex += 1) {
      const spanContexts = contexts.slice(startIndex, endIndex + 1);
      if (!isPlausibleMultiBlockSpan(anchor, spanContexts)) {
        continue;
      }

      const candidate = scoreMultiBlockSpanCandidate(anchor, spanContexts);
      if (!candidate) {
        continue;
      }

      if (!bestCandidate || isBetterMultiBlockSpanCandidate(candidate, bestCandidate)) {
        secondBestCandidate = bestCandidate;
        bestCandidate = candidate;
        continue;
      }

      if (!secondBestCandidate || isBetterMultiBlockSpanCandidate(candidate, secondBestCandidate)) {
        secondBestCandidate = candidate;
      }
    }
  });

  if (!bestCandidate || !shouldResolveFromMultiBlockSpan(bestCandidate, secondBestCandidate)) {
    return null;
  }

  return bestCandidate.contexts[0].block;
}

function hasMultiBlockSelectionSpan(anchor) {
  return Boolean(
    anchor &&
    Number.isInteger(anchor.selectionSpanBlockCount) &&
    anchor.selectionSpanBlockCount > 1 &&
    (
      anchor.selectionSpanStartFingerprint ||
      anchor.selectionSpanEndFingerprint
    ) &&
    (
      anchor.selectionSpanHead ||
      anchor.selectionSpanMiddle ||
      anchor.selectionSpanTail
    )
  );
}

function isPlausibleMultiBlockSpanStart(anchor, context) {
  if (!anchor || !context || !context.block) {
    return false;
  }

  if (anchor.selectionSpanStartFingerprint && context.fingerprint === anchor.selectionSpanStartFingerprint) {
    return true;
  }

  const head = normalizeText(anchor.selectionSpanHead);
  return Boolean(head && context.text && context.text.toLowerCase().indexOf(head.toLowerCase()) !== -1);
}

function isPlausibleMultiBlockSpan(anchor, spanContexts) {
  if (!anchor || !Array.isArray(spanContexts) || spanContexts.length < 2) {
    return false;
  }

  const startContext = spanContexts[0];
  const endContext = spanContexts[spanContexts.length - 1];
  if (!startContext || !endContext) {
    return false;
  }

  if (anchor.messageFingerprint) {
    if (startContext.messageFingerprint !== anchor.messageFingerprint || endContext.messageFingerprint !== anchor.messageFingerprint) {
      return false;
    }
  }

  if (startContext.messageFingerprint !== endContext.messageFingerprint) {
    return false;
  }

  return true;
}

function scoreMultiBlockSpanCandidate(anchor, spanContexts) {
  if (!anchor || !Array.isArray(spanContexts) || spanContexts.length < 2) {
    return null;
  }

  const startContext = spanContexts[0];
  const endContext = spanContexts[spanContexts.length - 1];
  const combinedText = normalizeText(
    spanContexts
      .map(function (context) {
        return context.text || "";
      })
      .join(" ")
  );
  if (!combinedText) {
    return null;
  }

  const joinedMarkers = buildSelectionSpanMarkerSignature(spanContexts.map(function (context) {
    return context.block;
  }));
  const headMatched = matchesSpanFragment(combinedText, anchor.selectionSpanHead);
  const middleMatched = matchesSpanFragment(combinedText, anchor.selectionSpanMiddle);
  const tailMatched = matchesSpanFragment(combinedText, anchor.selectionSpanTail);
  const fragmentMatchCount = [headMatched, middleMatched, tailMatched].filter(Boolean).length;
  const startMatched = Boolean(anchor.selectionSpanStartFingerprint && startContext.fingerprint === anchor.selectionSpanStartFingerprint);
  const endMatched = Boolean(anchor.selectionSpanEndFingerprint && endContext.fingerprint === anchor.selectionSpanEndFingerprint);

  if (fragmentMatchCount < 2) {
    return null;
  }

  let score = 0;
  if (startMatched) {
    score += 72;
  }
  if (endMatched) {
    score += 72;
  }
  score += fragmentMatchCount * 34;
  if (anchor.messageFingerprint && startContext.messageFingerprint === anchor.messageFingerprint) {
    score += 20;
  }
  if (anchor.messageRole && startContext.messageRole === anchor.messageRole) {
    score += 10;
  }
  if (Number.isInteger(anchor.selectionSpanBlockCount) && anchor.selectionSpanBlockCount > 1) {
    score += Math.max(0, 24 - Math.abs(anchor.selectionSpanBlockCount - spanContexts.length) * 8);
  }
  if (Number.isFinite(anchor.scrollRatio)) {
    score += Math.max(0, 10 - Math.round(Math.abs(anchor.scrollRatio - startContext.scrollRatio) * 40));
  }
  score += scoreSelectionSpanMarkers(anchor.selectionSpanMarkerSignature, joinedMarkers);

  return {
    contexts: spanContexts,
    score: score,
    fragmentMatchCount: fragmentMatchCount,
    startMatched: startMatched,
    endMatched: endMatched
  };
}

function matchesSpanFragment(text, fragment) {
  const normalizedText = normalizeText(text).toLowerCase();
  const normalizedFragment = normalizeText(fragment).toLowerCase();
  if (!normalizedText || !normalizedFragment) {
    return false;
  }

  return normalizedText.indexOf(normalizedFragment) !== -1;
}

function scoreSelectionSpanMarkers(expectedSignature, actualSignature) {
  if (!expectedSignature || !actualSignature) {
    return 0;
  }

  const expectedMarkers = String(expectedSignature).split("|").filter(Boolean);
  const actualMarkers = String(actualSignature).split("|").filter(Boolean);
  if (!expectedMarkers.length || !actualMarkers.length) {
    return 0;
  }

  let matches = 0;
  expectedMarkers.forEach(function (marker, index) {
    if (actualMarkers[index] && actualMarkers[index] === marker) {
      matches += 1;
    }
  });

  return Math.min(8, matches * 2);
}

function isBetterMultiBlockSpanCandidate(candidate, currentBest) {
  if (candidate.startMatched !== currentBest.startMatched) {
    return candidate.startMatched;
  }
  if (candidate.endMatched !== currentBest.endMatched) {
    return candidate.endMatched;
  }
  if (candidate.fragmentMatchCount !== currentBest.fragmentMatchCount) {
    return candidate.fragmentMatchCount > currentBest.fragmentMatchCount;
  }

  return candidate.score > currentBest.score;
}

function shouldResolveFromMultiBlockSpan(bestCandidate, secondBestCandidate) {
  if (!bestCandidate) {
    return false;
  }

  const gap = secondBestCandidate
    ? bestCandidate.score - secondBestCandidate.score
    : bestCandidate.score;

  if (bestCandidate.startMatched && bestCandidate.endMatched && bestCandidate.fragmentMatchCount >= 2 && bestCandidate.score >= 170) {
    return true;
  }

  return bestCandidate.fragmentMatchCount === 3 && bestCandidate.score >= 150 && gap >= 16;
}

// ============================================================
// 텍스트 occurrence 검색 & 점수
// ============================================================

export function findBestCodeOccurrence(rawText, anchor) {
  const haystack = String(rawText || "");
  const needle = String(anchor && (anchor.selectionTextRaw || anchor.selectionText) || "");
  if (!haystack || !needle) {
    return null;
  }

  let best = null;
  let count = 0;
  let searchIndex = 0;

  while (searchIndex <= haystack.length - needle.length) {
    const matchIndex = haystack.indexOf(needle, searchIndex);
    if (matchIndex === -1) {
      break;
    }

    count += 1;
    const occurrenceScore = scoreCodeOccurrenceContext(haystack, matchIndex, needle.length, anchor);
    const candidate = {
      index: matchIndex,
      end: matchIndex + needle.length,
      score: occurrenceScore.total,
      prefixScore: 0,
      suffixScore: 0,
      positionScore: occurrenceScore.offsetScore,
      lineScore: occurrenceScore.lineScore,
      contextFingerprintMatch: occurrenceScore.contextFingerprintMatch,
      distance: occurrenceScore.distance
    };

    if (!best || isBetterOccurrence(candidate, best, getExpectedCodeOffset(anchor, haystack.length))) {
      best = candidate;
    }

    searchIndex = matchIndex + 1;
  }

  if (!best) {
    return null;
  }

  best.count = count;
  return best;
}

export function findBestTextOccurrence(text, needle, anchor) {
  const haystack = normalizeText(text);
  const normalizedNeedle = normalizeText(needle);
  if (!haystack || !normalizedNeedle) {
    return null;
  }

  const haystackLower = haystack.toLowerCase();
  const needleLower = normalizedNeedle.toLowerCase();
  const expectedStart = getExpectedSelectionStart(anchor, haystack.length);
  let best = null;
  let count = 0;
  let searchIndex = 0;

  while (searchIndex <= haystackLower.length - needleLower.length) {
    const matchIndex = haystackLower.indexOf(needleLower, searchIndex);
    if (matchIndex === -1) {
      break;
    }

    count += 1;
    const occurrenceScore = scoreOccurrenceContext(haystack, matchIndex, normalizedNeedle.length, anchor);
    const candidate = {
      index: matchIndex,
      end: matchIndex + normalizedNeedle.length,
      score: occurrenceScore.total,
      prefixScore: occurrenceScore.prefixScore,
      suffixScore: occurrenceScore.suffixScore,
      positionScore: occurrenceScore.positionScore,
      lineScore: 0,
      contextFingerprintMatch: occurrenceScore.contextFingerprintMatch,
      distance: occurrenceScore.distance
    };

    if (!best || isBetterOccurrence(candidate, best, expectedStart)) {
      best = candidate;
    }

    searchIndex = matchIndex + 1;
  }

  if (!best) {
    return null;
  }

  best.count = count;
  return best;
}

function scoreCodeOccurrenceContext(text, startIndex, matchLength, anchor) {
  const prefixText = text.slice(0, startIndex);
  const suffixText = text.slice(startIndex + matchLength);
  const selectedText = text.slice(startIndex, startIndex + matchLength);
  const expectedOffset = getExpectedCodeOffset(anchor, text.length);
  const linePosition = getCodeLinePosition(prefixText);
  const offsetScore = expectedOffset >= 0
    ? Math.max(0, 80 - Math.round(Math.abs(startIndex - expectedOffset) / 2))
    : 0;
  const lineScore = Number.isInteger(anchor && anchor.selectionCodeLine) && anchor.selectionCodeLine >= 0
    ? Math.max(0, 34 - (Math.abs(linePosition.line - anchor.selectionCodeLine) * 8) - Math.abs(linePosition.column - Math.max(0, anchor.selectionCodeColumn)) * 2)
    : 0;
  const contextFingerprintMatch = matchesCodeSelectionContextFingerprint(anchor, prefixText, selectedText, suffixText);

  return {
    total: offsetScore + lineScore + (contextFingerprintMatch ? 96 : 0),
    offsetScore: offsetScore,
    lineScore: lineScore,
    contextFingerprintMatch: contextFingerprintMatch,
    distance: expectedOffset >= 0 ? Math.abs(startIndex - expectedOffset) : Number.MAX_SAFE_INTEGER
  };
}

function scoreOccurrenceContext(text, startIndex, matchLength, anchor) {
  const expectedStart = getExpectedSelectionStart(anchor, text.length);
  const prefixText = text.slice(0, startIndex);
  const suffixText = text.slice(startIndex + matchLength);
  const prefixScore = scoreOccurrenceEdge(anchor && anchor.selectionPrefix, prefixText, true);
  const suffixScore = scoreOccurrenceEdge(anchor && anchor.selectionSuffix, suffixText, false);
  const selectedText = text.slice(startIndex, startIndex + matchLength);
  const contextFingerprintMatch = matchesSelectionContextFingerprint(anchor, prefixText, selectedText, suffixText);
  const contextFingerprintScore = contextFingerprintMatch ? 84 : 0;
  const positionScore = expectedStart >= 0
    ? Math.max(0, 30 - Math.round(Math.abs(startIndex - expectedStart) / 2))
    : 0;
  const distance = expectedStart >= 0 ? Math.abs(startIndex - expectedStart) : Number.MAX_SAFE_INTEGER;

  return {
    total: prefixScore + suffixScore + contextFingerprintScore + positionScore,
    prefixScore: prefixScore,
    suffixScore: suffixScore,
    positionScore: positionScore,
    contextFingerprintMatch: contextFingerprintMatch,
    distance: distance
  };
}

export function scoreOccurrenceEdge(expectedText, surroundingText, fromEnd) {
  const normalizedExpected = normalizeText(expectedText);
  if (!normalizedExpected) {
    return 0;
  }

  const surrounding = normalizeText(surroundingText).toLowerCase();
  const expected = normalizedExpected.toLowerCase();
  if (!surrounding) {
    return 0;
  }

  if (fromEnd ? surrounding.endsWith(expected) : surrounding.startsWith(expected)) {
    return 48;
  }

  // Graduated scoring: try progressively shorter matches
  const longLength = Math.min(expected.length, 48);
  if (longLength >= 32) {
    const longSnippet = fromEnd ? expected.slice(-longLength) : expected.slice(0, longLength);
    if (fromEnd ? surrounding.endsWith(longSnippet) : surrounding.startsWith(longSnippet)) {
      return 36;
    }
  }

  const midLength = Math.min(expected.length, 24);
  if (midLength >= 12) {
    const midSnippet = fromEnd ? expected.slice(-midLength) : expected.slice(0, midLength);
    if (fromEnd ? surrounding.endsWith(midSnippet) : surrounding.startsWith(midSnippet)) {
      return 20;
    }
  }

  const shortLength = Math.min(expected.length, 16);
  if (shortLength >= 6) {
    const shortened = fromEnd ? expected.slice(-shortLength) : expected.slice(0, shortLength);
    if (fromEnd ? surrounding.endsWith(shortened) : surrounding.startsWith(shortened)) {
      return 10;
    }
  }

  return 0;
}

function isBetterOccurrence(candidate, currentBest, expectedStart) {
  if (candidate.score !== currentBest.score) {
    return candidate.score > currentBest.score;
  }

  if (expectedStart >= 0) {
    const candidateDistance = Math.abs(candidate.index - expectedStart);
    const bestDistance = Math.abs(currentBest.index - expectedStart);
    if (candidateDistance !== bestDistance) {
      return candidateDistance < bestDistance;
    }
  }

  return candidate.index < currentBest.index;
}

function getExpectedSelectionStart(anchor, textLength) {
  if (anchor && Number.isInteger(anchor.selectionStart) && anchor.selectionStart >= 0) {
    return Math.min(anchor.selectionStart, Math.max(0, textLength));
  }

  const ratio = anchor ? normalizeRatio(anchor.selectionStartRatio) : null;
  if (Number.isFinite(ratio)) {
    return Math.round(textLength * ratio);
  }

  return -1;
}

function getExpectedCodeOffset(anchor, textLength) {
  if (anchor && Number.isInteger(anchor.selectionCodeOffsetStart) && anchor.selectionCodeOffsetStart >= 0) {
    return Math.min(anchor.selectionCodeOffsetStart, Math.max(0, textLength));
  }

  return -1;
}

function hasSelectionContextHints(anchor) {
  return Boolean(
    anchor &&
    (
      (Number.isInteger(anchor.selectionStart) && anchor.selectionStart >= 0) ||
      Number.isFinite(normalizeRatio(anchor.selectionStartRatio)) ||
      normalizeText(anchor.selectionPrefix).length >= 4 ||
      normalizeText(anchor.selectionSuffix).length >= 4 ||
      Boolean(anchor.selectionContextFingerprint) ||
      normalizeText(anchor.selectionTextRaw).length > 0 ||
      (Number.isInteger(anchor.selectionCodeOffsetStart) && anchor.selectionCodeOffsetStart >= 0) ||
      Boolean(anchor.selectionCodeContextFingerprint)
    )
  );
}

// ============================================================
// 핑거프린트 매칭 (capture.js의 build 함수 사용)
// ============================================================

export function matchesSelectionContextFingerprint(anchor, prefixText, selectionText, suffixText) {
  if (!anchor || !anchor.selectionContextFingerprint) {
    return false;
  }

  return buildSelectionContextFingerprint(prefixText, selectionText, suffixText) === anchor.selectionContextFingerprint;
}

export function matchesCodeSelectionContextFingerprint(anchor, prefixText, selectionText, suffixText) {
  if (!anchor || !anchor.selectionCodeContextFingerprint) {
    return false;
  }

  return buildCodeSelectionContextFingerprint(prefixText, selectionText, suffixText) === anchor.selectionCodeContextFingerprint;
}

// ============================================================
// 공유 텍스트 매핑 유틸리티 (highlight.js에서도 import)
// ============================================================

export function normalizeRatio(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return clamp(value, 0, 1);
}

export function buildTargetTextMap(target, options) {
  const nextOptions = options || {};
  const preserveWhitespace = Boolean(nextOptions.preserveWhitespace) || isCodeBlockElement(target);
  const walker = document.createTreeWalker(
    target,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function (node) {
        if (!node || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        if (preserveWhitespace) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (!normalizeText(node.nodeValue)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const segments = [];
  let rawText = "";
  let rawOffset = 0;
  let previousTextNode = null;
  let node = walker.nextNode();

  while (node) {
    const value = node.nodeValue || "";
    if (value) {
      // Insert separator when a block-level element or <br> sits between text nodes
      if (previousTextNode && !preserveWhitespace) {
        var needsSeparator = false;
        var current = previousTextNode;
        while (current && current !== node) {
          var next = current.nextSibling;
          if (!next) {
            current = current.parentNode;
            continue;
          }
          if (next.nodeType === Node.ELEMENT_NODE) {
            var tagName = (next.tagName || "").toLowerCase();
            if (tagName === "br" || tagName === "hr" || tagName === "p" ||
                tagName === "div" || tagName === "li" || tagName === "tr" ||
                tagName === "blockquote" || tagName === "h1" || tagName === "h2" ||
                tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
              needsSeparator = true;
              break;
            }
            if (next.contains(node)) {
              current = next.firstChild || next;
              continue;
            }
          }
          if (next === node || (next.contains && next.contains(node))) {
            break;
          }
          current = next;
        }
        if (needsSeparator && rawText.length > 0 && !/\s$/.test(rawText)) {
          rawText += " ";
          rawOffset += 1;
        }
      }
      segments.push({
        node: node,
        start: rawOffset,
        end: rawOffset + value.length
      });
      rawText += value;
      rawOffset += value.length;
      previousTextNode = node;
    }
    node = walker.nextNode();
  }

  if (!rawText || !segments.length) {
    return null;
  }

  const normalized = buildNormalizedTextMapping(rawText);
  return {
    rawText: rawText,
    normalizedText: normalized.text,
    ranges: normalized.ranges,
    segments: segments
  };
}

export function buildRawOffsetMatch(textMap, startOffset, endOffset, options) {
  const nextOptions = options || {};
  const startPosition = rawOffsetToDomPosition(textMap.segments, startOffset, false);
  const endPosition = rawOffsetToDomPosition(textMap.segments, endOffset, true);
  if (!startPosition || !endPosition) {
    return null;
  }

  return {
    startNode: startPosition.node,
    startOffset: startPosition.offset,
    endNode: endPosition.node,
    endOffset: endPosition.offset,
    isCodeMatch: Boolean(nextOptions.isCodeMatch),
    isStrongCodeMatch: Boolean(nextOptions.isStrongCodeMatch),
    isStrongTextMatch: Boolean(nextOptions.isStrongTextMatch)
  };
}

export function rawOffsetToDomPosition(segments, rawOffset, isEnd) {
  if (!Array.isArray(segments) || !segments.length) {
    return null;
  }

  const clampedOffset = clamp(rawOffset, 0, segments[segments.length - 1].end);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (clampedOffset < segment.end) {
      return {
        node: segment.node,
        offset: clampedOffset - segment.start
      };
    }

    if (clampedOffset === segment.end) {
      if (isEnd || index === segments.length - 1) {
        return {
          node: segment.node,
          offset: segment.node.nodeValue.length
        };
      }

      return {
        node: segments[index + 1].node,
        offset: 0
      };
    }
  }

  const lastSegment = segments[segments.length - 1];
  return {
    node: lastSegment.node,
    offset: lastSegment.node.nodeValue.length
  };
}

export function buildNormalizedTextMapping(rawText) {
  let text = "";
  const ranges = [];
  let pendingWhitespace = false;
  let whitespaceStart = -1;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];
    if (/\s/.test(character)) {
      if (!text) {
        continue;
      }
      if (!pendingWhitespace) {
        pendingWhitespace = true;
        whitespaceStart = index;
      }
      continue;
    }

    if (pendingWhitespace) {
      text += " ";
      ranges.push({
        start: whitespaceStart,
        end: index
      });
      pendingWhitespace = false;
      whitespaceStart = -1;
    }

    text += character;
    ranges.push({
      start: index,
      end: index + 1
    });
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    ranges.pop();
  }

  return {
    text: text,
    ranges: ranges
  };
}
