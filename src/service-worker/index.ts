import type { SyncConfig, PanelMessage, PanelResponse, CSMessage, CSResponse, CacheEntry } from "../types";
import { loadConfigs, saveConfig, deleteConfig, getConfigById } from "./config-store";
import { getCache, saveCache, deleteCache } from "./cache-store";
import { validateSourceUrl, applyMappings, checkMissingKeys, buildSyncResult } from "./sync-engine";

console.log("[StorageSync SW] Service Worker 已启动");

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener(
  (
    message: PanelMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: PanelResponse) => void
  ) => {
    handleMessage(message).then(sendResponse);
    return true;
  }
);

async function handleMessage(msg: PanelMessage): Promise<PanelResponse> {
  switch (msg.action) {
    case "GET_CONFIGS":
      return handleGetConfigs();
    case "SAVE_CONFIG":
      return handleSaveConfig(msg.config);
    case "DELETE_CONFIG":
      return handleDeleteConfig(msg.id);
    case "SYNC_CACHE":
      return handleSyncCache(msg.configId);
    case "FORCE_REFRESH":
      return handleForceRefresh(msg.config);
    default:
      return { success: false, error: "未知操作" };
  }
}

// ===== 处理器 =====

async function handleGetConfigs(): Promise<PanelResponse> {
  const configs = await loadConfigs();
  return { success: true, data: configs };
}

async function handleSaveConfig(config: SyncConfig): Promise<PanelResponse> {
  try {
    await saveConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleDeleteConfig(id: string): Promise<PanelResponse> {
  await deleteConfig(id);
  await deleteCache(id);
  return { success: true };
}

async function handleSyncCache(configId: string): Promise<PanelResponse> {
  try {
    const config = await getConfigById(configId);
    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    const cache = await getCache(configId);
    if (!cache) {
      return { success: false, error: "暂无缓存数据，请先执行强制刷新" };
    }

    return await writeToCurrentTab(config, cache);
  } catch (err) {
    return { success: false, error: `同步缓存失败: ${String(err)}` };
  }
}

async function handleForceRefresh(config: SyncConfig): Promise<PanelResponse> {
  let sourceTabId: number | null = null;

  try {
    if (!validateSourceUrl(config.sourceUrl)) {
      return { success: false, error: "源站 URL 无效" };
    }

    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab?.id) {
      return { success: false, error: "无法获取当前页面" };
    }

    if (!currentTab.url || !validateSourceUrl(currentTab.url)) {
      return { success: false, error: "当前页面不支持 localStorage 写入" };
    }

    // 静默打开源站
    const sourceTab = await chrome.tabs.create({
      url: config.sourceUrl,
      active: false,
    });
    if (!sourceTab.id) {
      return { success: false, error: "无法打开源站页面" };
    }
    sourceTabId = sourceTab.id;

    // 等待源站加载完成
    await waitForTabLoad(sourceTab.id);

    // 读取源站 localStorage
    const srcKeys = config.mappings.map((m) => m.srcKey);
    const readResult = await sendMessageToTab<CSMessage, CSResponse>(
      sourceTab.id,
      { action: "READ_STORAGE", keys: srcKeys }
    );

    if (!readResult.success) {
      return { success: false, error: `读取源站失败: ${readResult.error}` };
    }

    // 过滤 null 值，确保类型为 Record<string, string>
    const rawData = readResult.data ?? {};
    const sourceData: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (v !== null && v !== undefined) {
        sourceData[k] = v;
      }
    }

    // 保存缓存
    const cacheEntry: CacheEntry = {
      configId: config.id,
      data: sourceData,
      url: config.sourceUrl,
      fetchedAt: Date.now(),
    };
    await saveCache(cacheEntry);

    // 关闭源站 Tab
    await chrome.tabs.remove(sourceTab.id);
    sourceTabId = null;

    // 写入当前页
    return await writeToCurrentTab(config, cacheEntry);

  } catch (err) {
    if (sourceTabId !== null) {
      try { await chrome.tabs.remove(sourceTabId); } catch { /* ignore */ }
    }
    return { success: false, error: `强制刷新失败: ${String(err)}` };
  }
}

// ===== 辅助函数 =====

async function writeToCurrentTab(
  config: { mappings: { srcKey: string; tgtKey: string }[] },
  cache: { data: Record<string, string> }
): Promise<PanelResponse> {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab?.id) {
    return { success: false, error: "无法获取当前页面" };
  }

  const entries = applyMappings(config.mappings, cache.data);
  const syncConfig = { mappings: config.mappings, id: "", name: "", sourceUrl: "", createdAt: 0, updatedAt: 0 };
  const missingKeys = checkMissingKeys(syncConfig, cache.data);

  if (Object.keys(entries).length === 0) {
    return { success: false, error: "源站数据中没有任何匹配的 key" };
  }

  const writeResult = await sendMessageToTab<CSMessage, CSResponse>(
    currentTab.id,
    { action: "WRITE_STORAGE", entries }
  );

  if (!writeResult.success) {
    return {
      success: false,
      error: buildSyncResult(0, missingKeys, writeResult.error).message,
    };
  }

  const result = buildSyncResult(Object.keys(entries).length, missingKeys, null);
  return { success: true, data: result };
}

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removeListener);
      reject(new Error("源站加载超时"));
    }, 15000);

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(removeListener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    const removeListener = (removedTabId: number) => {
      if (removedTabId === tabId) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(removeListener);
        reject(new Error("同步被中断"));
      }
    };
    chrome.tabs.onRemoved.addListener(removeListener);
  });
}

function sendMessageToTab<M, R>(tabId: number, message: M): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: R) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
