import type {
  SyncConfig, PanelMessage, SWMessage, PanelResponse, CheckMatchResponse,
  CSMessage, CSResponse, CacheEntry, ConfigWithCache
} from "../types";
import { loadConfigs, saveConfig, deleteConfig, getConfigById } from "./config-store";
import { getCache, saveCache, deleteCache } from "./cache-store";
import { validateSourceUrl, applyMappings, checkMissingKeys, buildSyncResult } from "./sync-engine";

console.log("[StorageSync SW] Service Worker 已启动");

// ===== 面板状态 =====
let isPanelOpen = false;

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener(
  (
    message: SWMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: PanelResponse | CheckMatchResponse) => void
  ) => {
    handleMessage(message).then(sendResponse);
    return true;
  }
);

async function handleMessage(msg: SWMessage): Promise<PanelResponse | CheckMatchResponse> {
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
    case "PANEL_CLOSED":
      return handlePanelClosed();
    case "CHECK_MATCH":
      return handleCheckMatch(msg.origin);
    case "AUTO_CACHE":
      return handleAutoCache(msg.configId, msg.data);
    default:
      return { success: false, error: "未知操作" };
  }
}

// ===== 处理器 =====

async function handlePanelClosed(): Promise<PanelResponse> {
  isPanelOpen = false;
  return { success: true };
}

async function handleCheckMatch(origin: string): Promise<CheckMatchResponse> {
  try {
    const configs = await loadConfigs();
    for (const config of configs) {
      try {
        const configOrigin = new URL(config.sourceUrl).origin;
        if (configOrigin === origin) {
          const srcKeys = config.mappings.map((m) => m.srcKey);
          return { success: true, data: { configId: config.id, srcKeys } };
        }
      } catch {
        // 配置 URL 无效，跳过
      }
    }
    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleAutoCache(
  configId: string,
  data: Record<string, string>
): Promise<PanelResponse> {
  try {
    // 空数据不更新
    if (Object.keys(data).length === 0) {
      return { success: true };
    }

    const existingCache = await getCache(configId);
    const mergedData = existingCache
      ? { ...existingCache.data, ...data }
      : data;

    const cacheEntry: CacheEntry = {
      configId,
      data: mergedData,
      url: existingCache?.url ?? "",
      fetchedAt: Date.now(),
    };
    await saveCache(cacheEntry);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleGetConfigs(): Promise<PanelResponse> {
  const configs = await loadConfigs();
  const result: ConfigWithCache[] = [];
  for (const config of configs) {
    const cache = await getCache(config.id);
    result.push({ config, cache });
  }
  return { success: true, data: result };
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
  let isNewTab = false;

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

    // 优先复用已打开的源站 Tab
    const sourceOrigin = new URL(config.sourceUrl).origin;
    const [existingTab] = await chrome.tabs.query({ url: `${sourceOrigin}/*` });

    if (existingTab?.id) {
      sourceTabId = existingTab.id;
    } else {
      const sourceTab = await chrome.tabs.create({
        url: config.sourceUrl,
        active: false,
      });
      if (!sourceTab.id) {
        return { success: false, error: "无法打开源站页面" };
      }
      sourceTabId = sourceTab.id;
      isNewTab = true;
    }

    // 等待源站加载完成（已加载的复用 Tab 跳过等待）
    const tab = await chrome.tabs.get(sourceTabId);
    if (!isNewTab && tab.status === "complete") {
      console.log(`[StorageSync SW] 复用已加载的 Tab: tabId=${sourceTabId}`);
    } else {
      await waitForTabLoad(sourceTabId, config.sourceUrl);
    }

    // 读取源站 localStorage
    const srcKeys = config.mappings.map((m) => m.srcKey);
    const readResult = await sendMessageToTab<CSMessage, CSResponse>(
      sourceTabId,
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

    // 仅新建的 Tab 才关闭
    if (isNewTab && sourceTabId !== null) {
      await chrome.tabs.remove(sourceTabId);
      sourceTabId = null;
    }

    // 写入当前页
    return await writeToCurrentTab(config, cacheEntry);

  } catch (err) {
    console.error(`[StorageSync SW] 强制刷新失败 — url=${config.sourceUrl}`, err);
    if (sourceTabId !== null && isNewTab) {
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
    const names = missingKeys.join("、");
    return { success: false, error: `源站数据中没有任何匹配的 key（缺失: ${names}）` };
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

function waitForTabLoad(tabId: number, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removeListener);
      console.error(`[StorageSync SW] 源站加载超时 — tabId=${tabId}, url=${url}`);
      reject(new Error(`源站加载超时 (${url})`));
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

function sendMessageToTab<M, R>(tabId: number, message: M, retries = 3): Promise<R> {
  return new Promise((resolve, reject) => {
    function attempt(n: number) {
      chrome.tabs.sendMessage(tabId, message, (response: R) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? "";
          if (n > 0 && msg.includes("Receiving end does not exist")) {
            console.debug(`[StorageSync SW] CS 未就绪，${500}ms 后重试 (剩余${n}次) tabId=${tabId}`);
            setTimeout(() => attempt(n - 1), 500);
          } else {
            reject(new Error(msg));
          }
        } else {
          resolve(response);
        }
      });
    }
    attempt(retries);
  });
}

// ===== Side Panel 开关 =====

// 阻止默认行为：点击图标不自动打开面板
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // setPanelBehavior 在某些 Chrome 版本不可用，静默忽略
});

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (isPanelOpen) {
      // 关闭面板
      await chrome.sidePanel.setOptions({ enabled: false });
      await chrome.sidePanel.setOptions({ enabled: true });
      isPanelOpen = false;
    } else {
      // 打开面板
      const windowId = tab.windowId;
      if (windowId) {
        await chrome.sidePanel.open({ windowId });
        isPanelOpen = true;
      }
    }
  } catch (err) {
    console.error("[StorageSync SW] toggle 面板失败:", err);
  }
  });
}
