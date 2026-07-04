import type { SyncConfig } from "../types";
import { STORAGE_KEY_CONFIGS } from "../types";

/** 加载全部配置 */
export async function loadConfigs(): Promise<SyncConfig[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY_CONFIGS);
  return (result[STORAGE_KEY_CONFIGS] as SyncConfig[]) ?? [];
}

/** 按 ID 查找单一配置 */
export async function getConfigById(id: string): Promise<SyncConfig | null> {
  const configs = await loadConfigs();
  return configs.find((c) => c.id === id) ?? null;
}

/** 保存配置（新增或更新） */
export async function saveConfig(config: SyncConfig): Promise<void> {
  // 校验
  validateConfig(config);

  const configs = await loadConfigs();
  const index = configs.findIndex((c) => c.id === config.id);

  if (index >= 0) {
    configs[index] = config;
  } else {
    configs.push(config);
  }

  await chrome.storage.local.set({ [STORAGE_KEY_CONFIGS]: configs });
}

/** 删除配置 */
export async function deleteConfig(id: string): Promise<void> {
  const configs = await loadConfigs();
  const filtered = configs.filter((c) => c.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY_CONFIGS]: filtered });
}

// ===== 校验函数 =====

function validateConfig(config: SyncConfig): void {
  if (!config.mappings || config.mappings.length === 0) {
    throw new Error("至少需要一个 key 映射");
  }

  try {
    const url = new URL(config.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("请输入有效的 URL");
    }
  } catch {
    throw new Error("请输入有效的 URL");
  }

  if (!config.name.trim()) {
    throw new Error("配置名称不能为空");
  }

  for (const m of config.mappings) {
    if (!m.srcKey.trim() || !m.tgtKey.trim()) {
      throw new Error("映射的 srcKey 和 tgtKey 不能为空");
    }
  }
}
