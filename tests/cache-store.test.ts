import { describe, it, expect, beforeEach } from "vitest";
import { mockChromeStorage } from "./mocks/chrome";
import type { CacheEntry } from "../src/types";
import { cacheKey } from "../src/types";

import {
  getCache,
  saveCache,
  deleteCache,
} from "../src/service-worker/cache-store";

describe("Cache Store", () => {
  beforeEach(() => {
    mockChromeStorage();
  });

  const sampleCache: CacheEntry = {
    configId: "cfg-001",
    data: { token: "abc123", theme: "dark" },
    url: "https://example.com",
    fetchedAt: 1700000000000,
  };

  describe("getCache", () => {
    it("无缓存时返回 null", async () => {
      const result = await getCache("cfg-001");
      expect(result).toBeNull();
    });

    it("返回已存储的缓存快照", async () => {
      await chrome.storage.local.set({ [cacheKey("cfg-001")]: sampleCache });
      const result = await getCache("cfg-001");
      expect(result).not.toBeNull();
      expect(result!.data.token).toBe("abc123");
    });
  });

  describe("saveCache", () => {
    it("保存缓存快照", async () => {
      await saveCache(sampleCache);
      const stored = (await chrome.storage.local.get(cacheKey("cfg-001")))[
        cacheKey("cfg-001")
      ];
      expect(stored).toEqual(sampleCache);
    });
  });

  describe("deleteCache", () => {
    it("删除缓存快照", async () => {
      await chrome.storage.local.set({ [cacheKey("cfg-001")]: sampleCache });
      await deleteCache("cfg-001");
      const result = await getCache("cfg-001");
      expect(result).toBeNull();
    });
  });
});
