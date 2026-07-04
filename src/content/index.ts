import type { CSMessage, CSResponse, CSAutoMessage, CheckMatchResponse } from "../types";

console.log("[StorageSync CS] Content Script 已注入:", window.location.href);

chrome.runtime.onMessage.addListener(
  (message: CSMessage, _sender, sendResponse: (r: CSResponse) => void) => {
    switch (message.action) {
      case "READ_STORAGE": {
        try {
          const data: Record<string, string> = {};
          for (const key of message.keys) {
            const value = localStorage.getItem(key);
            if (value !== null) {
              data[key] = value;
            }
          }
          sendResponse({ success: true, data });
        } catch (err) {
          sendResponse({
            success: false,
            error: `读取失败: ${String(err)}`,
          });
        }
        break;
      }

      case "WRITE_STORAGE": {
        try {
          for (const [key, value] of Object.entries(message.entries)) {
            localStorage.setItem(key, value);
          }
          sendResponse({ success: true });
        } catch (err) {
          if (err instanceof DOMException && err.name === "QuotaExceededError") {
            sendResponse({
              success: false,
              error: "写入失败: 存储空间不足",
            });
          } else {
            sendResponse({
              success: false,
              error: `写入失败: ${String(err)}`,
            });
          }
        }
        break;
      }

      default:
        sendResponse({
          success: false,
          error: `未知操作: ${(message as CSMessage).action}`,
        });
    }

    return true; // 保持 sendResponse 通道开放（异步）
  }
);

// ===== 自动缓存检测 =====

/**
 * 检测当前页面 origin 是否匹配某条配置的 sourceUrl，
 * 若匹配则自动读取 localStorage 并更新扩展缓存。
 * 在 document_idle 时由脚本顶层调用。
 */
export async function autoDetectAndCache(): Promise<void> {
  try {
    const origin = window.location.origin;

    // 查询 SW 是否有匹配的配置
    const matchResult = await new Promise<CheckMatchResponse>((resolve) => {
      chrome.runtime.sendMessage(
        { action: "CHECK_MATCH", origin } as CSAutoMessage,
        (response: CheckMatchResponse) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message! });
          } else {
            resolve(response);
          }
        }
      );
    });

    if (!matchResult.success || !matchResult.data) {
      return; // 无匹配或查询失败，静默终止
    }

    const { configId, srcKeys } = matchResult.data;

    // 读取 localStorage 中匹配的 key
    const data: Record<string, string> = {};
    for (const key of srcKeys) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        data[key] = value;
      }
    }

    // 无数据可缓存，终止
    if (Object.keys(data).length === 0) {
      return;
    }

    // 发送 AUTO_CACHE
    chrome.runtime.sendMessage(
      { action: "AUTO_CACHE", configId, data } as CSAutoMessage,
      () => {
        // 静默忽略回调（chrome.runtime.lastError 仅记录日志）
        if (chrome.runtime.lastError) {
          console.debug("[StorageSync CS] AUTO_CACHE 发送失败:", chrome.runtime.lastError.message);
        }
      }
    );
  } catch {
    // 静默忽略所有异常
  }
}

// 在 document_idle 时自动触发（Content Script 运行时机即 document_idle）
autoDetectAndCache();
