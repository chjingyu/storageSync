import { describe, it, expect } from "vitest";
import type { SyncConfig } from "../src/types";

import {
  validateSourceUrl,
  checkMissingKeys,
  buildSyncResult,
  applyMappings,
} from "../src/service-worker/sync-engine";

describe("Sync Engine", () => {
  describe("validateSourceUrl", () => {
    it("有效的 https URL 返回 true", () => {
      expect(validateSourceUrl("https://example.com")).toBe(true);
    });

    it("有效的 http URL 返回 true", () => {
      expect(validateSourceUrl("http://localhost:3000")).toBe(true);
    });

    it("chrome:// 页面返回 false", () => {
      expect(validateSourceUrl("chrome://extensions")).toBe(false);
    });

    it("无效 URL 返回 false", () => {
      expect(validateSourceUrl("not-a-url")).toBe(false);
    });

    it("缺少协议的 URL 返回 false", () => {
      expect(validateSourceUrl("example.com/path")).toBe(false);
    });
  });

  describe("checkMissingKeys", () => {
    const config: SyncConfig = {
      id: "1",
      name: "test",
      sourceUrl: "https://x.com",
      mappings: [
        { srcKey: "a", tgtKey: "a" },
        { srcKey: "b", tgtKey: "b" },
        { srcKey: "c", tgtKey: "c" },
      ],
      createdAt: 0,
      updatedAt: 0,
    };

    it("返回源站缺失的 key 列表", () => {
      const data: Record<string, string> = { a: "val_a" };
      const missing = checkMissingKeys(config, data);
      expect(missing).toEqual(["b", "c"]);
    });

    it("全部存在时返回空数组", () => {
      const data: Record<string, string> = { a: "val_a", b: "val_b", c: "val_c" };
      expect(checkMissingKeys(config, data)).toEqual([]);
    });
  });

  describe("applyMappings", () => {
    it("按 mappings 转换数据", () => {
      const sourceData = { src_token: "abc", src_name: "test" };
      const entries = applyMappings(
        [
          { srcKey: "src_token", tgtKey: "accessToken" },
          { srcKey: "src_name", tgtKey: "userName" },
        ],
        sourceData
      );
      expect(entries).toEqual({ accessToken: "abc", userName: "test" });
    });

    it("跳过源站缺失的 key", () => {
      const sourceData = { src_token: "abc" };
      const entries = applyMappings(
        [
          { srcKey: "src_token", tgtKey: "accessToken" },
          { srcKey: "missing", tgtKey: "shouldNotAppear" },
        ],
        sourceData
      );
      expect(entries).toEqual({ accessToken: "abc" });
    });
  });

  describe("buildSyncResult", () => {
    it("全部成功", () => {
      const result = buildSyncResult(3, [], null);
      expect(result.status).toBe("success");
      expect(result.message).toContain("已同步 3 个 key");
    });

    it("部分缺失 key", () => {
      const result = buildSyncResult(2, ["b"], null);
      expect(result.status).toBe("partial");
      expect(result.message).toContain("源站缺少: b");
    });

    it("写入失败", () => {
      const result = buildSyncResult(0, [], "写入失败: 存储空间不足");
      expect(result.status).toBe("error");
      expect(result.error).toContain("写入失败");
    });
  });
});
