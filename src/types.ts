// ===== 数据模型 =====

/** 一份同步配置 */
export interface SyncConfig {
  id: string;                    // 唯一标识，crypto.randomUUID() 生成
  name: string;                  // 用户自定义名称，如 "测试站Token"
  sourceUrl: string;             // 源站 URL，如 "https://admin.example.com"
  mappings: KeyMapping[];        // key 映射列表，至少 1 条
  createdAt: number;             // 创建时间戳 (Date.now())
  updatedAt: number;             // 最后修改时间戳
}

/** 单条 key 映射 */
export interface KeyMapping {
  srcKey: string;                // 源站 localStorage 的 key
  tgtKey: string;                // 目标站写入的 key
}

/** 缓存快照 */
export interface CacheEntry {
  configId: string;              // 关联的配置 ID
  data: Record<string, string>;  // { srcKey: value, ... }
  url: string;                   // 抓取时的源站 URL
  fetchedAt: number;             // 抓取时间戳
}

// ===== 消息协议 =====

/** Side Panel → Service Worker 消息 */
export type PanelMessage =
  | { action: "GET_CONFIGS" }
  | { action: "SAVE_CONFIG"; config: SyncConfig }
  | { action: "DELETE_CONFIG"; id: string }
  | { action: "SYNC_CACHE"; configId: string }
  | { action: "FORCE_REFRESH"; config: SyncConfig };

/** SW → Side Panel 响应 */
export type PanelResponse =
  | { success: true; data?: unknown }
  | { success: false; error: string };

/** Service Worker → Content Script 消息 */
export type CSMessage =
  | { action: "READ_STORAGE"; keys: string[] }
  | { action: "WRITE_STORAGE"; entries: Record<string, string> };

/** Content Script → SW 响应 */
export type CSResponse =
  | { success: true; data?: Record<string, string | null> }
  | { success: false; error: string };

/** 同步结果（展示给用户） */
export interface SyncResult {
  status: "success" | "partial" | "error";
  message: string;
  error?: string;
  syncedCount: number;
  missingKeys: string[];
}

// ===== 存储 key 常量 =====

export const STORAGE_KEY_CONFIGS = "configs";
export const CACHE_KEY_PREFIX = "cache:";
export function cacheKey(configId: string): string {
  return `${CACHE_KEY_PREFIX}${configId}`;
}
