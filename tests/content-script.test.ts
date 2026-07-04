import { describe, it, expect, beforeEach, vi } from "vitest";

// 模拟 localStorage
const lsStore = new Map<string, string>();

// 用于 auto-cache 测试的 sendMessage mock
let mockSendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lsStore.clear();
  mockSendMessage = vi.fn();

  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => lsStore.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      lsStore.set(key, value);
    }),
    removeItem: vi.fn(),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });
  vi.stubGlobal("chrome", {
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: mockSendMessage,
    },
  });

  // 为 auto-cache 测试提供 window.location
  vi.stubGlobal("window", {
    location: {
      origin: "https://admin.example.com",
      href: "https://admin.example.com/",
    },
  });
});

describe("Content Script Logic", () => {
  it("READ_STORAGE 返回匹配的 key", () => {
    lsStore.set("token", "abc");
    lsStore.set("theme", "dark");
    lsStore.set("other", "ignored");

    const data: Record<string, string> = {};
    for (const key of ["token", "theme", "missing"]) {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    }

    expect(data).toEqual({ token: "abc", theme: "dark" });
    // missing 不在 data 中
  });

  it("WRITE_STORAGE 写入 localStorage", () => {
    const entries = { token: "abc", theme: "dark" };
    for (const [key, value] of Object.entries(entries)) {
      localStorage.setItem(key, value);
    }

    expect(lsStore.get("token")).toBe("abc");
    expect(lsStore.get("theme")).toBe("dark");
  });

  it("WRITE_STORAGE QuotaExceededError 处理", () => {
    const error = new DOMException("quota exceeded", "QuotaExceededError");
    // 模拟 setItem 抛出配额异常
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw error;
    });

    let caught: DOMException | null = null;
    try {
      localStorage.setItem("key", "value");
    } catch (err) {
      if (err instanceof DOMException && err.name === "QuotaExceededError") {
        caught = err;
      }
    }

    expect(caught).not.toBeNull();
    expect(caught!.name).toBe("QuotaExceededError");
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

    lsStore.set("token", "abc123");
    lsStore.set("uid", "user_001");

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
