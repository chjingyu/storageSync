/** Mock chrome.storage.local API */
import { vi } from "vitest";

export function mockChromeStorage() {
  const store = new Map<string, unknown>();

  const storageLocal = {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) {
        return Object.fromEntries(store);
      }
      const keyList = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyList) {
        if (store.has(k)) result[k] = store.get(k);
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        store.set(k, v);
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) store.delete(k);
    }),
    clear: vi.fn(async () => store.clear()),
  };

  // @ts-expect-error 部分 mock
  globalThis.chrome = {
    storage: { local: storageLocal },
  };

  return { store, storageLocal };
}
