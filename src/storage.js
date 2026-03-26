// ============================================================
// utils/storage.js — chrome.storage.local 래퍼
// ============================================================
// 비유: "금고 관리인". 데이터를 금고(storage)에 넣고 빼는 작업을 담당합니다.
// 에러가 나면 무시하지 않고 logWarn으로 기록합니다.

import { logWarn } from './log.js';

/**
 * 여러 키를 한번에 읽습니다.
 * @param {string[]} keys - 읽을 키 목록
 * @returns {Promise<Object>} - { key: value, ... }
 */
export function storageGet(keys) {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.get(keys, function (items) {
      const error = chrome.runtime.lastError;
      if (error) {
        logWarn("storageGet failed", error);
        reject(error);
        return;
      }
      resolve(items || {});
    });
  });
}

/**
 * 여러 키-값 쌍을 한번에 저장합니다.
 * @param {Object} items - { key: value, ... }
 */
export function storageSet(items) {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.set(items, function () {
      const error = chrome.runtime.lastError;
      if (error) {
        logWarn("storageSet failed", error);
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * 키를 삭제합니다.
 * @param {string|string[]} keys
 */
export function storageRemove(keys) {
  return new Promise(function (resolve, reject) {
    chrome.storage.local.remove(keys, function () {
      const error = chrome.runtime.lastError;
      if (error) {
        logWarn("storageRemove failed", error);
        reject(error);
        return;
      }
      resolve();
    });
  });
}
