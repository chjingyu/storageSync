// src/content/index.ts — 占位文件
console.log("[StorageSync CS] Content Script 已注入:", window.location.href);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[StorageSync CS] 收到消息:", message);
  sendResponse({ success: false, error: "功能尚未实现" });
  return true;
});
