import { describe, it, expect, beforeEach } from "vitest";
import { mockChromeStorage } from "./mocks/chrome";
import type { SyncConfig } from "../src/types";
import { STORAGE_KEY_CONFIGS } from "../src/types";

// ===== 被测试的函数 =====
import {
  loadConfigs,
  saveConfig,
  deleteConfig,
  getConfigById,
} from "../src/service-worker/config-store";

describe("Config Store", () => {
  let store: Map<string, unknown>;

  beforeEach(() => {
    const m = mockChromeStorage();
    store = m.store;
  });

  const sampleConfig: SyncConfig = {
    id: "test-id-001",
    name: "测试站",
    sourceUrl: "https://example.com",
    mappings: [{ srcKey: "token", tgtKey: "accessToken" }],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  describe("loadConfigs", () => {
    it("无配置时返回空数组", async () => {
      const configs = await loadConfigs();
      expect(configs).toEqual([]);
    });

    it("返回已存储的全部配置", async () => {
      store.set(STORAGE_KEY_CONFIGS, [sampleConfig]);
      const configs = await loadConfigs();
      expect(configs).toHaveLength(1);
      expect(configs[0].id).toBe("test-id-001");
    });
  });

  describe("saveConfig", () => {
    it("保存新配置", async () => {
      await saveConfig(sampleConfig);
      const stored = store.get(STORAGE_KEY_CONFIGS) as SyncConfig[];
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe("测试站");
    });

    it("更新已有配置（按 id 匹配）", async () => {
      store.set(STORAGE_KEY_CONFIGS, [sampleConfig]);
      const updated: SyncConfig = {
        ...sampleConfig,
        name: "改名后的站",
        updatedAt: 1700000001000,
      };
      await saveConfig(updated);
      const stored = store.get(STORAGE_KEY_CONFIGS) as SyncConfig[];
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe("改名后的站");
    });

    it("mappings 为空时抛出错误", async () => {
      const invalid: SyncConfig = {
        ...sampleConfig,
        mappings: [],
      };
      await expect(saveConfig(invalid)).rejects.toThrow(
        "至少需要一个 key 映射"
      );
    });

    it("sourceUrl 格式无效时抛出错误", async () => {
      const invalid: SyncConfig = {
        ...sampleConfig,
        sourceUrl: "not-a-valid-url",
      };
      await expect(saveConfig(invalid)).rejects.toThrow(
        "请输入有效的 URL"
      );
    });
  });

  describe("deleteConfig", () => {
    it("删除存在的配置", async () => {
      store.set(STORAGE_KEY_CONFIGS, [sampleConfig]);
      await deleteConfig("test-id-001");
      const stored = store.get(STORAGE_KEY_CONFIGS) as SyncConfig[];
      expect(stored).toHaveLength(0);
    });

    it("删除不存在的配置不报错", async () => {
      await deleteConfig("nonexistent");
      // 不抛异常即为通过
    });
  });

  describe("getConfigById", () => {
    it("找到配置返回它", async () => {
      store.set(STORAGE_KEY_CONFIGS, [sampleConfig]);
      const config = await getConfigById("test-id-001");
      expect(config).not.toBeNull();
      expect(config!.name).toBe("测试站");
    });

    it("找不到配置返回 null", async () => {
      const config = await getConfigById("nonexistent");
      expect(config).toBeNull();
    });
  });
});
