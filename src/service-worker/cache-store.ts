import type { CacheEntry } from "../types";
import { cacheKey } from "../types";

/** 获取缓存快照 */
export async function getCache(configId: string): Promise<CacheEntry | null> {
  const result = await chrome.storage.local.get(cacheKey(configId));
  return (result[cacheKey(configId)] as CacheEntry) ?? null;
}

/** 保存缓存快照 */
export async function saveCache(entry: CacheEntry): Promise<void> {
  await chrome.storage.local.set({ [cacheKey(entry.configId)]: entry });
}

/** 删除缓存快照 */
export async function deleteCache(configId: string): Promise<void> {
  await chrome.storage.local.remove(cacheKey(configId));
}
