// src/service-worker/index.ts — 占位文件，后续任务填充
console.log("[StorageSync SW] Service Worker 已启动");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[StorageSync SW] 收到消息:", message);
  sendResponse({ success: false, error: "功能尚未实现" });
  return true;
});
