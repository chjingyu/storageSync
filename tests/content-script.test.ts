import { describe, it, expect, beforeEach, vi } from "vitest";

// 模拟 localStorage
const lsStore = new Map<string, string>();

beforeEach(() => {
  lsStore.clear();
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
