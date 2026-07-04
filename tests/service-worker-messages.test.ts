import { describe, it, expect, beforeEach, vi } from "vitest";

// ===== Mock chrome APIs — 使用 vi.hoisted() 确保设置在 import 之前执行 =====
vi.hoisted(() => {
  // @ts-expect-error partial mock
  globalThis.chrome = {
    sidePanel: {
      open: vi.fn(() => Promise.resolve()),
      setOptions: vi.fn(() => Promise.resolve()),
      setPanelBehavior: vi.fn(() => Promise.resolve()),
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
      query: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      remove: vi.fn(() => Promise.resolve()),
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
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
        remove: vi.fn(() => Promise.resolve()),
      },
    },
  };
});

import type { SyncConfig, CacheEntry, ConfigWithCache } from "../src/types";
import { STORAGE_KEY_CONFIGS, cacheKey } from "../src/types";

// 引入 SW 模块使其注册监听器（此时 chrome mock 已就绪）
import "../src/service-worker/index";

// 在模块加载后捕获 listener handler 引用
const mockChrome = globalThis.chrome as any;
const listenerHandler = mockChrome.runtime.onMessage.addListener.mock.calls[0]?.[0];

/** 等待微任务队列清空，使 .then(sendResponse) 执行完毕 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Service Worker — Messages", () => {
  beforeEach(() => {
    // 手动重置 storage mock 状态
    mockChrome.storage.local.get.mockClear().mockResolvedValue({});
    mockChrome.storage.local.set.mockClear().mockResolvedValue();
    mockChrome.storage.local.remove.mockClear().mockResolvedValue();
  });

  describe("PANEL_CLOSED handler", () => {
    it("收到 PANEL_CLOSED 后将 isPanelOpen 置为 false", async () => {
      expect(listenerHandler).toBeDefined();

      const sendResponse = vi.fn();
      listenerHandler({ action: "PANEL_CLOSED" }, {}, sendResponse);
      await flushMicrotasks();

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

      const sendResponse = vi.fn();
      listenerHandler({ action: "CHECK_MATCH", origin: "https://admin.example.com" }, {}, sendResponse);
      await flushMicrotasks();

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

      const sendResponse = vi.fn();
      listenerHandler({ action: "CHECK_MATCH", origin: "https://other.example.com" }, {}, sendResponse);
      await flushMicrotasks();

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

      const sendResponse = vi.fn();
      listenerHandler({
        action: "AUTO_CACHE",
        configId: "cfg-1",
        data: { token: "new_value" },
      }, {}, sendResponse);
      await flushMicrotasks();

      expect(mockChrome.storage.local.set).toHaveBeenCalled();
      const setArg = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, CacheEntry>;
      const savedEntry = setArg[cacheKey("cfg-1")];
      expect(savedEntry.data.token).toBe("new_value");
      expect(savedEntry.data.uid).toBe("old_uid");
      expect(savedEntry.configId).toBe("cfg-1");
    });

    it("无已有缓存时新建缓存条目", async () => {
      mockChrome.storage.local.get.mockResolvedValueOnce({});

      const sendResponse = vi.fn();
      listenerHandler({
        action: "AUTO_CACHE",
        configId: "cfg-2",
        data: { token: "abc123" },
      }, {}, sendResponse);
      await flushMicrotasks();

      const setArg = mockChrome.storage.local.set.mock.calls[0]?.[0] as Record<string, CacheEntry>;
      const savedEntry = setArg[cacheKey("cfg-2")];
      expect(savedEntry.data.token).toBe("abc123");
      expect(savedEntry.url).toBe("");
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it("data 为空对象时不更新缓存", async () => {
      const sendResponse = vi.fn();
      listenerHandler({
        action: "AUTO_CACHE",
        configId: "cfg-3",
        data: {},
      }, {}, sendResponse);
      await flushMicrotasks();

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

      const sendResponse = vi.fn();
      listenerHandler({ action: "GET_CONFIGS" }, {}, sendResponse);
      await flushMicrotasks();

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

      const sendResponse = vi.fn();
      listenerHandler({ action: "GET_CONFIGS" }, {}, sendResponse);
      await flushMicrotasks();

      const callArg = sendResponse.mock.calls[0]?.[0];
      const data = callArg.data as ConfigWithCache[];
      expect(data[0].cache).toBeNull();
    });
  });
});
