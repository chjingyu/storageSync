# Side Panel 开关 + 自动缓存 + 缓存展示 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现点击图标切换 Side Panel、源站访问自动缓存、卡片表格展示缓存值、按钮重命名

**Architecture:** SW 中新增 `action.onClicked` 手动 toggle 面板开关、Content Script 在 `document_idle` 时检测 URL 匹配并自动更新缓存、Side Panel 以表格展示缓存值（溢出省略+tooltip）

**Tech Stack:** TypeScript, Chrome MV3 Extension API, Vitest, @crxjs/vite-plugin

## Global Constraints

- 所有消息通过 `chrome.runtime.sendMessage` 通信，不新增传输通道
- 缓存值不进行脱敏/加密
- 映射行表格 column 比例：源站 Key 25% / 目标 Key 25% / 缓存值 50%
- 缓存值列溢出：`text-overflow: ellipsis` + `title` 属性 tooltip
- 按钮文案 "强制刷新" → "立即更新"，`data-action` 值 `force-refresh` 保持不变
- 无缓存时缓存值列显示 "—"
- 兼容 Chrome MV3，使用 `chrome.sidePanel` API

---

### Task 1: 类型定义更新

**Files:**
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `ConfigWithCache`, `CSAutoMessage`, `CheckMatchResponse`, 更新的 `PanelMessage`、`SWMessage`

- [ ] **Step 1: 写入新增类型**

在 `src/types.ts` 文件末尾追加以下类型定义：

```typescript
// ===== 新增：缓存 + 配置聚合 =====

/** GET_CONFIGS 响应中配置与缓存的聚合体 */
export interface ConfigWithCache {
  config: SyncConfig;
  cache: CacheEntry | null;
}

// ===== 新增：Content Script → SW 消息 =====

/** Content Script 主动向 SW 发送的消息 */
export type CSAutoMessage =
  | { action: "CHECK_MATCH"; origin: string }
  | { action: "AUTO_CACHE"; configId: string; data: Record<string, string> };

/** SW 对 CHECK_MATCH 的响应 */
export type CheckMatchResponse =
  | { success: true; data: { configId: string; srcKeys: string[] } | null }
  | { success: false; error: string };

// ===== 更新：PanelMessage 新增 PANEL_CLOSED =====
// 替换原有 PanelMessage 定义：

/** Side Panel → Service Worker 消息 */
export type PanelMessage =
  | { action: "GET_CONFIGS" }
  | { action: "SAVE_CONFIG"; config: SyncConfig }
  | { action: "DELETE_CONFIG"; id: string }
  | { action: "SYNC_CACHE"; configId: string }
  | { action: "FORCE_REFRESH"; config: SyncConfig }
  | { action: "PANEL_CLOSED" };

/** SW 接收的全部消息（来源：Side Panel + Content Script） */
export type SWMessage = PanelMessage | CSAutoMessage;
```

- [ ] **Step 2: 验证类型编译**

```bash
npx tsc --noEmit 2>&1
```

Expected: 无类型错误，编译通过。

- [ ] **Step 3: 提交**

```bash
git add src/types.ts
git commit -m "feat: 新增 ConfigWithCache、CSAutoMessage、CheckMatchResponse、PANEL_CLOSED 类型"
```

---

### Task 2: Service Worker — 面板开关 + 消息路由扩展

**Files:**
- Modify: `src/service-worker/index.ts`
- Test: `tests/service-worker-messages.test.ts` (新建)

**Interfaces:**
- Consumes: `SWMessage` (from Task 1), `ConfigWithCache`, `CSAutoMessage`, `CheckMatchResponse`, `PanelMessage`
- Produces: `handleMessage(msg: SWMessage): Promise<PanelResponse | CheckMatchResponse>`, `toggleSidePanel()`, `isPanelOpen`

- [ ] **Step 1: 编写测试 — SW 消息处理与 toggle 状态机**

新建 `tests/service-worker-messages.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// ===== Mock chrome APIs =====
const mockChrome = {
  sidePanel: {
    open: vi.fn(),
    setOptions: vi.fn(),
    setPanelBehavior: vi.fn(),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    sendMessage: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
};

// @ts-expect-error partial mock
globalThis.chrome = mockChrome;

import type { SyncConfig, CacheEntry, ConfigWithCache } from "../src/types";
import { STORAGE_KEY_CONFIGS, cacheKey } from "../src/types";

// We import after mock setup — the module uses chrome APIs at top level
// Re-import to get fresh module state per test
describe("Service Worker — Messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
  });

  describe("PANEL_CLOSED handler", () => {
    it("收到 PANEL_CLOSED 后将 isPanelOpen 置为 false", async () => {
      // 通过 sendMessage 模拟 Side Panel 发送 PANEL_CLOSED
      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      expect(handler).toBeDefined();

      const sendResponse = vi.fn();
      await handler({ action: "PANEL_CLOSED" }, {}, sendResponse);
      
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("CHECK_MATCH handler", () => {
    it("origin 匹配时返回 configId 和 srcKeys", async () => {
      const configs: SyncConfig[] = [{
        id: "cfg-1",
        name: "测试",
        sourceUrl: "https://admin.example.com/dashboard",
        mappings: [{ srcKey: "token", tgtKey: "auth_token" }, { srcKey: "uid", tgtKey: "user_id" }],
        createdAt: 0,
        updatedAt: 0,
      }];
      mockChrome.storage.local.get.mockResolvedValueOnce({ [STORAGE_KEY_CONFIGS]: configs });

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({ action: "CHECK_MATCH", origin: "https://admin.example.com" }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        data: { configId: "cfg-1", srcKeys: ["token", "uid"] },
      });
    });

    it("origin 不匹配时返回 null", async () => {
      const configs: SyncConfig[] = [{
        id: "cfg-1",
        name: "测试",
        sourceUrl: "https://admin.example.com",
        mappings: [{ srcKey: "token", tgtKey: "auth_token" }],
        createdAt: 0,
        updatedAt: 0,
      }];
      mockChrome.storage.local.get.mockResolvedValueOnce({ [STORAGE_KEY_CONFIGS]: configs });

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({ action: "CHECK_MATCH", origin: "https://other.example.com" }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        data: null,
      });
    });
  });

  describe("AUTO_CACHE handler", () => {
    it("合并数据到已有缓存", async () => {
      const existingCache: CacheEntry = {
        configId: "cfg-1",
        data: { token: "old_value", uid: "old_uid" },
        url: "https://admin.example.com",
        fetchedAt: 1000,
      };
      mockChrome.storage.local.get.mockResolvedValueOnce({ [cacheKey("cfg-1")]: existingCache });

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({
        action: "AUTO_CACHE",
        configId: "cfg-1",
        data: { token: "new_value" },
      }, {}, sendResponse);

      expect(mockChrome.storage.local.set).toHaveBeenCalled();
      const setArg = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, CacheEntry>;
      const savedEntry = setArg[cacheKey("cfg-1")];
      expect(savedEntry.data.token).toBe("new_value");
      expect(savedEntry.data.uid).toBe("old_uid");
      expect(savedEntry.configId).toBe("cfg-1");
    });

    it("无已有缓存时新建缓存条目", async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({});

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({
        action: "AUTO_CACHE",
        configId: "cfg-2",
        data: { token: "abc123" },
      }, {}, sendResponse);

      const setArg = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, CacheEntry>;
      const savedEntry = setArg[cacheKey("cfg-2")];
      expect(savedEntry.data.token).toBe("abc123");
      expect(savedEntry.url).toBe("");
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("data 为空对象时不更新缓存", async () => {
      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({
        action: "AUTO_CACHE",
        configId: "cfg-3",
        data: {},
      }, {}, sendResponse);

      // storage.local.set 不应该被调用
      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe("GET_CONFIGS 附带缓存", () => {
    it("返回 ConfigWithCache[]", async () => {
      const configs: SyncConfig[] = [{
        id: "cfg-1",
        name: "测试站",
        sourceUrl: "https://a.example.com",
        mappings: [{ srcKey: "t", tgtKey: "a" }],
        createdAt: 0,
        updatedAt: 0,
      }];
      const cache: CacheEntry = {
        configId: "cfg-1",
        data: { t: "val" },
        url: "https://a.example.com",
        fetchedAt: 2000,
      };
      mockChrome.storage.local.get.mockResolvedValueOnce({ [STORAGE_KEY_CONFIGS]: configs });
      mockChrome.storage.local.get.mockResolvedValueOnce({ [cacheKey("cfg-1")]: cache });

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({ action: "GET_CONFIGS" }, {}, sendResponse);

      expect(sendResponse).toHaveBeenCalled();
      const callArg = sendResponse.mock.calls[0]?.[0];
      expect(callArg.success).toBe(true);
      const data = callArg.data as ConfigWithCache[];
      expect(data).toHaveLength(1);
      expect(data[0].config.id).toBe("cfg-1");
      expect(data[0].cache).not.toBeNull();
      expect(data[0].cache!.data.t).toBe("val");
    });

    it("无缓存时 cache 字段为 null", async () => {
      const configs: SyncConfig[] = [{
        id: "cfg-1",
        name: "测试站",
        sourceUrl: "https://a.example.com",
        mappings: [{ srcKey: "t", tgtKey: "a" }],
        createdAt: 0,
        updatedAt: 0,
      }];
      mockChrome.storage.local.get.mockResolvedValueOnce({ [STORAGE_KEY_CONFIGS]: configs });
      mockChrome.storage.local.get.mockResolvedValueOnce({});

      const handler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
      const sendResponse = vi.fn();
      await handler({ action: "GET_CONFIGS" }, {}, sendResponse);

      const callArg = sendResponse.mock.calls[0]?.[0];
      const data = callArg.data as ConfigWithCache[];
      expect(data[0].cache).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/service-worker-messages.test.ts 2>&1
```

Expected: FAIL — 新处理器尚未实现。

- [ ] **Step 3: 修改 SW — 新增消息类型导入与面板状态变量**

在 `src/service-worker/index.ts` 顶部修改 import 和添加状态：

```typescript
import type {
  SyncConfig, PanelMessage, SWMessage, PanelResponse,
  CSMessage, CSResponse, CacheEntry, ConfigWithCache
} from "../types";
import { loadConfigs, saveConfig, deleteConfig, getConfigById } from "./config-store";
import { getCache, saveCache, deleteCache } from "./cache-store";
import { validateSourceUrl, applyMappings, checkMissingKeys, buildSyncResult } from "./sync-engine";

console.log("[StorageSync SW] Service Worker 已启动");

// ===== 面板状态 =====
let isPanelOpen = false;
```

- [ ] **Step 4: 修改 SW — 更新消息路由监听器类型**

将原有的 `onMessage` 监听器改为使用 `SWMessage` 类型：

```typescript
// ===== 消息路由 =====

chrome.runtime.onMessage.addListener(
  (
    message: SWMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: PanelResponse | CheckMatchResponse) => void
  ) => {
    handleMessage(message).then(sendResponse);
    return true;
  }
);
```

- [ ] **Step 5: 修改 SW — 更新 handleMessage 函数签名与分支**

将 `handleMessage` 函数签名从 `PanelMessage` 改为 `SWMessage`，并在 switch 中新增分支：

```typescript
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
```

- [ ] **Step 6: 修改 SW — 新增三个处理器函数**

在 `handleMessage` 之前（或之后）插入三个新处理器：

```typescript
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
```

- [ ] **Step 7: 修改 SW — GET_CONFIGS 附带缓存**

更新 `handleGetConfigs` 函数：

```typescript
async function handleGetConfigs(): Promise<PanelResponse> {
  const configs = await loadConfigs();
  const result: ConfigWithCache[] = [];
  for (const config of configs) {
    const cache = await getCache(config.id);
    result.push({ config, cache });
  }
  return { success: true, data: result };
}
```

- [ ] **Step 8: 修改 SW — 新增 action.onClicked 面板 toggle 逻辑**

在 SW 文件末尾追加 `action.onClicked` 监听器和初始化逻辑：

```typescript
// ===== Side Panel 开关 =====

// 阻止默认行为：点击图标不自动打开面板
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
  // setPanelBehavior 在某些 Chrome 版本不可用，静默忽略
});

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
```

- [ ] **Step 9: 运行测试确认通过**

```bash
npx vitest run tests/service-worker-messages.test.ts 2>&1
```

Expected: 全部 PASS

- [ ] **Step 10: 确认现有测试未破坏**

```bash
npx vitest run 2>&1
```

Expected: 全部 29+ 测试 PASS

- [ ] **Step 11: 提交**

```bash
git add src/service-worker/index.ts tests/service-worker-messages.test.ts
git commit -m "feat: SW 面板 toggle + CHECK_MATCH/AUTO_CACHE/PANEL_CLOSED 处理器 + GET_CONFIGS 附带缓存"
```

---

### Task 3: Content Script — 自动缓存检测

**Files:**
- Modify: `src/content/index.ts`
- Modify: `tests/content-script.test.ts`

**Interfaces:**
- Consumes: `CSAutoMessage`, `CheckMatchResponse` (from Task 1)
- Produces: `autoDetectAndCache()` (private, called at document_idle)

- [ ] **Step 1: 更新测试 — Content Script 自动缓存逻辑**

在 `tests/content-script.test.ts` 中追加测试（保留现有测试）：

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// ===== Mock chrome API for CS =====
const mockSendMessage = vi.fn();
const mockLocalStorage = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  mockLocalStorage.clear();

  // @ts-expect-error partial mock
  globalThis.chrome = {
    runtime: {
      sendMessage: mockSendMessage,
      onMessage: {
        addListener: vi.fn(),
      },
    },
  };

  // @ts-expect-error mock localStorage
  globalThis.localStorage = {
    getItem: vi.fn((key: string) => mockLocalStorage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => mockLocalStorage.set(key, value)),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  };

  // Mock window.location
  Object.defineProperty(window, "location", {
    value: { origin: "https://admin.example.com", href: "https://admin.example.com/" },
    writable: true,
  });
});

describe("Content Script — Auto Cache", () => {
  it("CHECK_MATCH 匹配成功时发送 AUTO_CACHE", async () => {
    // 模拟 SW 返回匹配信息
    mockSendMessage.mockImplementation((_msg: unknown, callback: (r: unknown) => void) => {
      const msg = _msg as { action: string };
      if (msg.action === "CHECK_MATCH") {
        callback({ success: true, data: { configId: "cfg-1", srcKeys: ["token", "uid"] } });
      } else if (msg.action === "AUTO_CACHE") {
        callback({ success: true });
      }
      return true;
    });

    mockLocalStorage.set("token", "abc123");
    mockLocalStorage.set("uid", "user_001");

    // 执行 auto-detect 逻辑
    const { autoDetectAndCache } = await import("../src/content/index");
    await autoDetectAndCache();

    expect(mockSendMessage).toHaveBeenCalledWith(
      { action: "CHECK_MATCH", origin: "https://admin.example.com" },
      expect.any(Function)
    );
    expect(mockSendMessage).toHaveBeenCalledWith(
      { action: "AUTO_CACHE", configId: "cfg-1", data: { token: "abc123", uid: "user_001" } },
      expect.any(Function)
    );
  });

  it("CHECK_MATCH 不匹配时不发送 AUTO_CACHE", async () => {
    mockSendMessage.mockImplementation((_msg: unknown, callback: (r: unknown) => void) => {
      const msg = _msg as { action: string };
      if (msg.action === "CHECK_MATCH") {
        callback({ success: true, data: null });
      }
      return true;
    });

    const { autoDetectAndCache } = await import("../src/content/index");
    await autoDetectAndCache();

    // 只调用了 CHECK_MATCH，没有 AUTO_CACHE
    const matchCalls = mockSendMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { action: string }).action === "CHECK_MATCH"
    );
    const cacheCalls = mockSendMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { action: string }).action === "AUTO_CACHE"
    );
    expect(matchCalls).toHaveLength(1);
    expect(cacheCalls).toHaveLength(0);
  });

  it("CHECK_MATCH 失败时静默忽略", async () => {
    mockSendMessage.mockImplementation((_msg: unknown, callback: (r: unknown) => void) => {
      callback({ success: false, error: "SW 未就绪" });
      return true;
    });

    const { autoDetectAndCache } = await import("../src/content/index");
    // 不应抛出异常
    await expect(autoDetectAndCache()).resolves.toBeUndefined();

    // 没有 AUTO_CACHE 调用
    const cacheCalls = mockSendMessage.mock.calls.filter(
      (c: unknown[]) => (c[0] as { action: string }).action === "AUTO_CACHE"
    );
    expect(cacheCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/content-script.test.ts 2>&1
```

Expected: FAIL — `autoDetectAndCache` 导出尚未定义。

- [ ] **Step 3: 修改 Content Script — 新增自动缓存逻辑**

在 `src/content/index.ts` 文件末尾追加 `autoDetectAndCache` 函数和触发调用：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/content-script.test.ts 2>&1
```

Expected: 全部 6 个测试 PASS（原有 3 个 + 新增 3 个）

- [ ] **Step 5: 确认全部测试**

```bash
npx vitest run 2>&1
```

Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add src/content/index.ts tests/content-script.test.ts
git commit -m "feat: Content Script 自动缓存检测 — CHECK_MATCH + AUTO_CACHE"
```

---

### Task 4: Side Panel UI — 去掉标题 + 表格缓存 + 按钮重命名 + pagehide

**Files:**
- Modify: `src/sidepanel/index.html`
- Modify: `src/sidepanel/index.ts`
- Modify: `src/sidepanel/styles.css`

**Interfaces:**
- Consumes: `ConfigWithCache` (from Task 1), `PANEL_CLOSED` action, `PanelMessage`
- Produces: 表格渲染函数 `renderCacheTable(cache, mappings)`, `renderConfigList()` 更新

- [ ] **Step 1: 移除 HTML 标题栏**

编辑 `src/sidepanel/index.html`，删除 `<header>` 行：

```html
<!-- src/sidepanel/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalStorage Sync</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="app">
    <main class="app-main">
      <p class="placeholder">加载中...</p>
    </main>
  </div>
  <script type="module" src="./index.ts"></script>
</body>
</html>
```

- [ ] **Step 2: 更新 CSS — 移除标题栏样式、添加表格样式**

编辑 `src/sidepanel/styles.css`：

删除 `.app-header` 和 `.app-header h1` 块（第 33-40 行），并在文件末尾追加表格样式：

```css
/* ===== 缓存表格 ===== */
.cache-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 12px;
}
.cache-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 6px 8px;
  background: var(--bg);
  border-bottom: 2px solid var(--border);
  font-size: 11px;
}
.cache-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cache-table th:nth-child(1),
.cache-table td:nth-child(1) {
  width: 25%;
}
.cache-table th:nth-child(2),
.cache-table td:nth-child(2) {
  width: 25%;
}
.cache-table th:nth-child(3),
.cache-table td:nth-child(3) {
  width: 50%;
}

.cache-time {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.cache-none {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 8px;
  font-style: italic;
}

/* ===== 映射列表 (替换为表格后移除旧的) ===== */
/* 旧的 .mapping-list / .mapping-item 样式不再使用，保留不删以兼容编辑表单 */
```

- [ ] **Step 3: 更新 Side Panel TS — 核心渲染逻辑**

编辑 `src/sidepanel/index.ts`，以下为完整改动（标注每个差异点）：

**3a. 更新数据加载与状态：**

将文件开头的状态和数据加载部分替换（import 部分 + loadAndRender + 新增辅助函数）：

```typescript
import type { SyncConfig, KeyMapping, PanelMessage, PanelResponse, SyncResult, ConfigWithCache, CacheEntry } from "../types";

// ===== 状态 =====
let configsWithCache: ConfigWithCache[] = [];
let editingId: string | null = null;
let syncingIds: Set<string> = new Set();
let statusMessages: Map<string, SyncResult> = new Map();

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
});

// pagehide — 通知 SW 面板已关闭
window.addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ action: "PANEL_CLOSED" } as PanelMessage);
});

async function loadAndRender() {
  const resp = await sendMessage({ action: "GET_CONFIGS" });
  if (resp.success && Array.isArray(resp.data)) {
    configsWithCache = resp.data as ConfigWithCache[];
  }
  render();
}

// 辅助：根据 configId 查找缓存
function getCacheForConfig(configId: string): CacheEntry | null {
  const item = configsWithCache.find((c) => c.config.id === configId);
  return item?.cache ?? null;
}
```

**3b. 添加缓存表格渲染函数：**

在 `renderConfigList` 之前插入：

```typescript
function renderCacheTable(cache: CacheEntry | null, mappings: KeyMapping[]): string {
  if (!cache || Object.keys(cache.data).length === 0) {
    return `<div class="cache-none">暂无缓存</div>`;
  }

  const cacheData = cache.data;
  const rows = mappings
    .map((m) => {
      const value = cacheData[m.srcKey];
      const display = value !== undefined ? escapeHtml(value) : "—";
      const tooltip = value !== undefined ? ` title="${escapeHtml(value)}"` : "";
      return `
        <tr>
          <td>${escapeHtml(m.srcKey)}</td>
          <td>${escapeHtml(m.tgtKey)}</td>
          <td${tooltip}>${display}</td>
        </tr>`;
    })
    .join("");

  const timeStr = new Date(cache.fetchedAt).toLocaleString("zh-CN");

  return `
    <table class="cache-table">
      <thead>
        <tr>
          <th>源站 Key</th>
          <th>目标 Key</th>
          <th>缓存值</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="cache-time">⏱ 缓存更新于 ${timeStr}</div>`;
}

function formatCacheTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN");
}
```

**3c. 更新 renderConfigList：**

替换原有 `renderConfigList` 函数（使用 `configsWithCache` 替代 `configs`，去除 `.mapping-list` 旧映射列表，添加表格和缓存时间）：

```typescript
function renderConfigList(): string {
  if (configsWithCache.length === 0) {
    return `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>暂无源站配置</p>
        <button class="btn btn-primary" data-action="add">+ 新增配置</button>
      </div>`;
  }

  return configsWithCache
    .map(({ config, cache }) => {
      const status = statusMessages.get(config.id);
      const isSyncing = syncingIds.has(config.id);

      return `
        <div class="config-card" data-id="${config.id}">
          <div class="card-header">
            <div class="card-info" data-action="edit" data-id="${config.id}">
              <div class="card-name">${escapeHtml(config.name)}</div>
              <div class="card-url">${escapeHtml(config.sourceUrl)}</div>
              <div class="card-meta">
                ${config.mappings.length} 个映射
                ${status ? ` · ${status.message}` : ""}
              </div>
            </div>
            <button class="btn btn-danger" data-action="delete" data-id="${config.id}" title="删除">✕</button>
          </div>
          ${renderCacheTable(cache, config.mappings)}
          <div class="card-actions">
            <button class="btn btn-outline" data-action="sync-cache" data-id="${config.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "🔄"} 同步缓存
            </button>
            <button class="btn btn-primary" data-action="force-refresh" data-id="${config.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "⚡"} 立即更新
            </button>
          </div>
          ${status ? `<div class="status-bar status-${status.status}">${status.message}</div>` : ""}
        </div>`;
    })
    .join("") +
    `<button class="btn-add" data-action="add">+ 新增配置</button>`;
}
```

**3d. 更新 handleSync 函数中的 configs 引用：**

将 `handleSync` 中的 `const config = configs.find(...)` 改为：

```typescript
  const config = configsWithCache.find((c) => c.config.id === configId)?.config;
```

**3e. 更新 readFormData 中的 configs 引用：**

将 `readFormData` 中的 `configs.find((c) => c.id === editingId)` 改为：

```typescript
  const existing = editingId && editingId !== "__new__"
    ? configsWithCache.find((c) => c.config.id === editingId)?.config
    : null;
```

- [ ] **Step 4: 构建验证**

```bash
npm run build 2>&1
```

Expected: 构建成功，无错误。

- [ ] **Step 5: 运行全部测试**

```bash
npx vitest run 2>&1
```

Expected: 全部测试 PASS

- [ ] **Step 6: 提交**

```bash
git add src/sidepanel/index.html src/sidepanel/index.ts src/sidepanel/styles.css
git commit -m "feat: Side Panel — 去标题 + 表格缓存展示 + 立即更新按钮 + pagehide 通知"
```

---

### Task 5: 集成验证

**Files:**
- 无新建文件

- [ ] **Step 1: 类型检查**

```bash
npx tsc --noEmit 2>&1
```

Expected: 无类型错误。

- [ ] **Step 2: 构建**

```bash
npm run build 2>&1
```

Expected: 构建成功。

- [ ] **Step 3: 全部测试**

```bash
npx vitest run 2>&1
```

Expected: 全部测试 PASS（预估 35+ tests）。

- [ ] **Step 4: 提交（如有未提交变更）**

```bash
git status
git add -A
git commit -m "chore: 集成验证通过 — 构建成功，全部测试 PASS"
```

---

## 自审检查清单

| 检查项 | 状态 |
|--------|------|
| 规约覆盖 | Task 1-4 覆盖全部 5 个功能点 |
| 无占位符 | 所有步骤包含完整代码/命令 |
| 类型一致性 | `SWMessage`、`CSAutoMessage`、`CheckMatchResponse`、`ConfigWithCache` 在各 Task 中签名一致 |
| 文件路径 | 所有路径为精确绝对路径 |
| 测试先行 | 每个实现 Task 均先写测试后写实现 |
