import type { CSMessage, CSResponse } from "../types";

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
