import type { SyncConfig, KeyMapping, SyncResult } from "../types";

/** 校验 URL 是否合法（仅允许 http/https） */
export function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/** 检查源站数据中缺失的 srcKey */
export function checkMissingKeys(
  config: SyncConfig,
  data: Record<string, string>
): string[] {
  return config.mappings
    .filter((m) => !(m.srcKey in data))
    .map((m) => m.srcKey);
}

/** 按 mappings 转换源站数据为目标站数据 */
export function applyMappings(
  mappings: KeyMapping[],
  sourceData: Record<string, string>
): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const m of mappings) {
    if (m.srcKey in sourceData) {
      entries[m.tgtKey] = sourceData[m.srcKey];
    }
  }
  return entries;
}

/** 构建同步结果消息 */
export function buildSyncResult(
  syncedCount: number,
  missingKeys: string[],
  writeError: string | null
): SyncResult {
  if (writeError) {
    return {
      status: "error",
      message: `❌ ${writeError}`,
      error: writeError,
      syncedCount: 0,
      missingKeys,
    };
  }

  if (missingKeys.length > 0) {
    const names = missingKeys.join(", ");
    return {
      status: "partial",
      message: `⚠️ 已同步 ${syncedCount} 个 key，源站缺少: ${names}`,
      syncedCount,
      missingKeys,
    };
  }

  return {
    status: "success",
    message: `✅ 已同步 ${syncedCount} 个 key`,
    syncedCount,
    missingKeys: [],
  };
}
