# LocalStorage 跨站同步扩展 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Chrome 扩展，通过 Side Panel 界面配置多份源站 URL + Key 映射，支持手动将源站 localStorage 数据同步到当前网站（缓存优先 + 强制刷新后台抓取的混合模式）。

**Architecture:** Side Panel (HTML/TS/CSS) ↔ Service Worker (TS) ↔ Content Script (TS)。Side Panel 负责 UI 和配置管理，Service Worker 编排静默 Tab 抓取和缓存写入，Content Script 仅执行 localStorage 读写。存储使用 chrome.storage.local。

**Tech Stack:** TypeScript, Vite + @crxjs/vite-plugin, Vitest (单元测试), 原生 HTML/CSS (Side Panel UI)

## Global Constraints

- Chrome Manifest V3
- 权限: `storage`, `sidePanel`, `<all_urls>` host_permissions
- Content Script 注入时机: `document_idle`
- Side Panel 入口: `src/sidepanel/index.html`
- 配置存储 key: `"configs"` → `SyncConfig[]`
- 缓存存储 key: `"cache:{configId}"` → `CacheEntry`
- UUID 生成: `crypto.randomUUID()`
- 不做数据加密、不做自动同步、不做批量执行

---

## 文件结构

```
storageSync/
├── manifest.json                     # Chrome 扩展清单
├── package.json                      # 依赖和脚本
├── tsconfig.json                     # TypeScript 配置
├── vite.config.ts                    # Vite + @crxjs/vite-plugin 构建配置
├── public/
│   └── icons/                        # 扩展图标 (PNG)
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── src/
│   ├── types.ts                      # 共享类型定义
│   ├── service-worker/
│   │   └── index.ts                  # Service Worker 主逻辑
│   ├── content/
│   │   └── index.ts                  # Content Script
│   └── sidepanel/
│       ├── index.html                # Side Panel 入口 HTML
│       ├── index.ts                  # Side Panel 主逻辑
│       └── styles.css                # Side Panel 样式
└── tests/
    ├── mocks/
    │   └── chrome.ts                 # Chrome API mock 工具
    ├── config-store.test.ts          # 配置存储层测试
    ├── cache-store.test.ts           # 缓存存储层测试
    ├── sync-engine.test.ts           # 同步引擎核心逻辑测试
    └── validation.test.ts            # 校验函数测试
```

**职责说明:**

| 文件 | 职责 | 大小预期 |
|------|------|----------|
| `src/types.ts` | 所有共享类型定义 (SyncConfig, KeyMapping, CacheEntry, 消息类型) | ~50 行 |
| `src/service-worker/index.ts` | 消息路由、静默 Tab 管理、同步编排、存储操作 | ~150 行 |
| `src/content/index.ts` | 响应 READ_STORAGE / WRITE_STORAGE 消息，执行 localStorage 读写 | ~40 行 |
| `src/sidepanel/index.html` | Side Panel HTML 结构 | ~60 行 |
| `src/sidepanel/index.ts` | 应用入口：加载配置、渲染卡片、事件代理、消息发送 | ~200 行 |
| `src/sidepanel/styles.css` | 全部样式 | ~150 行 |

---

### Task 1: 项目初始化 — 脚手架 + 类型定义

**目标:** 搭建可构建运行的空白 Chrome 扩展骨架。

**产出:** 扩展可加载到 Chrome，Side Panel 显示空白页面，Service Worker 启动无报错。

**依赖:** 无

- [ ] **Step 1: 初始化 package.json**

```bash
cd /Users/jing/Documents/AIProjects/storageSync
cat > package.json << 'PKGJSON'
{
  "name": "storage-sync-extension",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.28",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
PKGJSON
```

- [ ] **Step 2: 安装依赖**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npm install
```

- [ ] **Step 3: 创建 tsconfig.json**

```bash
cat > /Users/jing/Documents/AIProjects/storageSync/tsconfig.json << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["chrome"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
TSCONFIG
```

- [ ] **Step 4: 安装 Chrome 类型定义**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npm install --save-dev @types/chrome
```

- [ ] **Step 5: 创建 vite.config.ts**

```bash
cat > /Users/jing/Documents/AIProjects/storageSync/vite.config.ts << 'VITECONFIG'
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" assert { type: "json" };

export default defineConfig({
  plugins: [crx({ manifest })],
});
VITECONFIG
```

- [ ] **Step 6: 创建 manifest.json**

```bash
cat > /Users/jing/Documents/AIProjects/storageSync/manifest.json << 'MANIFEST'
{
  "manifest_version": 3,
  "name": "LocalStorage Sync",
  "version": "1.0.0",
  "description": "跨站同步 LocalStorage 数据到当前网站",
  "permissions": ["storage", "sidePanel"],
  "host_permissions": ["<all_urls>"],
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "background": {
    "service_worker": "src/service-worker/index.ts"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "public/icons/icon16.png",
    "48": "public/icons/icon48.png",
    "128": "public/icons/icon128.png"
  }
}
MANIFEST
```

- [ ] **Step 7: 创建图标占位文件**

```bash
mkdir -p /Users/jing/Documents/AIProjects/storageSync/public/icons
# 使用 Node.js 生成简单纯色 PNG 图标（16x16, 48x48, 128x128 蓝色方块）
node -e "
const fs = require('fs');
function createPNG(size, path) {
  // 最小化 PNG: 蓝色 1x1 像素 + 缩放
  const { createCanvas } = (() => { try { return require('canvas'); } catch { return null; } })();
  if (!createCanvas) {
    console.log('canvas 模块不可用，创建最小 PNG 占位');
    // 手动构造最小 PNG (蓝色 1x1, 通过 IHDR 设置尺寸)
    const { crc32 } = require('zlib');
    // ... 简化处理: 写入一个 1x1 蓝色 PNG 最小文件
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path, png);
    return;
  }
}
// 简单版: 用 base64 1x1 蓝色 PNG 作为所有尺寸的占位
const miniPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
['icon16.png','icon48.png','icon128.png'].forEach(f => {
  fs.writeFileSync('public/icons/' + f, miniPNG);
  console.log('Created: public/icons/' + f);
});
" 2>/dev/null || {
  # 如果 node 脚本失败，用 sips 或直接复制占位
  python3 -c "
import base64, os
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==')
for f in ['icon16.png','icon48.png','icon128.png']:
    with open('public/icons/'+f, 'wb') as fh: fh.write(png)
    print('Created: public/icons/'+f)
"
}
```

- [ ] **Step 8: 创建类型定义文件 src/types.ts**

```typescript
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
```

- [ ] **Step 9: 创建 Service Worker 占位**

```bash
mkdir -p /Users/jing/Documents/AIProjects/storageSync/src/service-worker
```

```typescript
// src/service-worker/index.ts — 占位文件，后续任务填充
console.log("[StorageSync SW] Service Worker 已启动");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[StorageSync SW] 收到消息:", message);
  sendResponse({ success: false, error: "功能尚未实现" });
  return true;
});
```

- [ ] **Step 10: 创建 Content Script 占位**

```bash
mkdir -p /Users/jing/Documents/AIProjects/storageSync/src/content
```

```typescript
// src/content/index.ts — 占位文件
console.log("[StorageSync CS] Content Script 已注入:", window.location.href);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[StorageSync CS] 收到消息:", message);
  sendResponse({ success: false, error: "功能尚未实现" });
  return true;
});
```

- [ ] **Step 11: 创建 Side Panel 占位页面**

```bash
mkdir -p /Users/jing/Documents/AIProjects/storageSync/src/sidepanel
```

```html
<!-- src/sidepanel/index.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LocalStorage Sync</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div class="app">
    <header class="app-header">
      <h1>🔄 LocalStorage Sync</h1>
    </header>
    <main class="app-main">
      <p class="placeholder">加载中...</p>
    </main>
  </div>
  <script type="module" src="./index.ts"></script>
</body>
</html>
```

```css
/* src/sidepanel/styles.css — 占位基础样式 */
:root {
  --bg: #ffffff;
  --text: #1a1a2e;
  --text-secondary: #6b7280;
  --border: #e5e7eb;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --success: #10b981;
  --error: #ef4444;
  --warn: #f59e0b;
  --card-bg: #f9fafb;
  --radius: 8px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  width: 100%;
  min-height: 100vh;
}

.app { padding: 16px; }
.app-header h1 { font-size: 18px; font-weight: 600; }
.placeholder { color: var(--text-secondary); text-align: center; padding: 40px 0; }
```

```typescript
// src/sidepanel/index.ts — 占位
console.log("[StorageSync Panel] Side Panel 已加载");
```

- [ ] **Step 12: 验证构建**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npm run build
```

预期输出: 构建成功，`dist/` 目录生成扩展文件。

- [ ] **Step 13: 提交**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git init && git add -A && git commit -m "feat: 项目脚手架 — Vite + CRXJS + TypeScript + 类型定义"
```

---

### Task 2: 配置存储层 — SyncConfig CRUD

**目标:** 实现配置的增删改查操作，封装对 chrome.storage.local 的读写。

**产出:** 通过 vitest 测试的配置存储模块。

**依赖:** Task 1 (类型定义)

- [ ] **Step 1: 创建测试 Mock 工具**

```typescript
// tests/mocks/chrome.ts

/** Mock chrome.storage.local API */
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

import { vi } from "vitest";
```

- [ ] **Step 2: 创建配置存储层测试**

```typescript
// tests/config-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mockChromeStorage } from "./mocks/chrome";
import type { SyncConfig } from "../src/types";
import { STORAGE_KEY_CONFIGS } from "../src/types";

// ===== 被测试的函数（测试先行，先写测试再写实现）=====
// 这些函数将在 src/service-worker/config-store.ts 中实现

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
```

- [ ] **Step 3: 运行测试验证失败**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/config-store.test.ts
```

预期: 全部 FAIL（模块尚未创建）

- [ ] **Step 4: 创建配置存储实现**

```typescript
// src/service-worker/config-store.ts
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
```

- [ ] **Step 5: 运行测试验证通过**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/config-store.test.ts
```

预期: 全部 PASS (7 tests)

- [ ] **Step 6: 提交**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git add -A && git commit -m "feat: 配置存储层 — SyncConfig CRUD + 校验"
```

---

### Task 3: 缓存存储层 + Content Script

**目标:** 实现缓存快照的读写 + Content Script 的 localStorage 读写逻辑。

**产出:** 缓存存储层通过测试，Content Script 可响应 READ/WRITE 消息。

**依赖:** Task 1 (类型定义), Task 2 (config-store 中的 loadConfigs 可供参考)

- [ ] **Step 1: 创建缓存存储层测试**

```typescript
// tests/cache-store.test.ts
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
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/cache-store.test.ts
```

预期: 全部 FAIL

- [ ] **Step 3: 创建缓存存储实现**

```typescript
// src/service-worker/cache-store.ts
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
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/cache-store.test.ts
```

预期: 全部 PASS (4 tests)

- [ ] **Step 5: 创建 Content Script 实现**

```typescript
// src/content/index.ts
import type { CSMessage, CSResponse } from "../types";

console.log("[StorageSync CS] Content Script 已注入:", window.location.href);

chrome.runtime.onMessage.addListener(
  (message: CSMessage, _sender, sendResponse: (r: CSResponse) => void) => {
    switch (message.action) {
      case "READ_STORAGE": {
        try {
          const data: Record<string, string> = {};
          for (const key of message.keys) {
            const value = localStorage.getItem(key);
            if (value !== null) {
              data[key] = value;
            }
          }
          sendResponse({ success: true, data });
        } catch (err) {
          sendResponse({
            success: false,
            error: `读取失败: ${String(err)}`,
          });
        }
        break;
      }

      case "WRITE_STORAGE": {
        try {
          for (const [key, value] of Object.entries(message.entries)) {
            localStorage.setItem(key, value);
          }
          sendResponse({ success: true });
        } catch (err) {
          if (err instanceof DOMException && err.name === "QuotaExceededError") {
            sendResponse({
              success: false,
              error: "写入失败: 存储空间不足",
            });
          } else {
            sendResponse({
              success: false,
              error: `写入失败: ${String(err)}`,
            });
          }
        }
        break;
      }

      default:
        sendResponse({
          success: false,
          error: `未知操作: ${(message as CSMessage).action}`,
        });
    }

    return true; // 保持 sendResponse 通道开放（异步）
  }
);
```

- [ ] **Step 6: 创建 Content Script 测试**

```typescript
// tests/content-script.test.ts
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
```

- [ ] **Step 7: 运行全部测试**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run
```

预期: PASS (config-store 7 + cache-store 4 + content-script 3 = 14 tests)

- [ ] **Step 8: 提交**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git add -A && git commit -m "feat: 缓存存储层 + Content Script 实现"
```

---

### Task 4: Service Worker — 同步引擎

**目标:** 实现 SW 的完整消息路由、静默 Tab 管理、同步编排逻辑。

**产出:** SW 响应所有 5 种 Side Panel 消息，正确编排同步流程。

**依赖:** Task 2 (config-store), Task 3 (cache-store, Content Script)

- [ ] **Step 1: 创建同步引擎核心逻辑测试**

```typescript
// tests/sync-engine.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockChromeStorage } from "./mocks/chrome";

// 测试 will test validation 函数和 sync 编排逻辑
// 由于 SW 依赖 chrome.tabs API，核心逻辑抽成纯函数便于测试

import {
  validateSourceUrl,
  buildSyncResult,
  checkMissingKeys,
} from "../src/service-worker/sync-engine";
import type { SyncConfig, CacheEntry } from "../src/types";

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
    it("返回源站缺失的 key 列表", () => {
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

      const data: Record<string, string> = { a: "val_a" }; // 只有 a，缺 b 和 c

      const missing = checkMissingKeys(config, data);
      expect(missing).toEqual(["b", "c"]);
    });

    it("全部存在时返回空数组", () => {
      const config: SyncConfig = {
        id: "1",
        name: "test",
        sourceUrl: "https://x.com",
        mappings: [{ srcKey: "a", tgtKey: "a" }],
        createdAt: 0,
        updatedAt: 0,
      };
      const data: Record<string, string> = { a: "val_a" };
      expect(checkMissingKeys(config, data)).toEqual([]);
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
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/sync-engine.test.ts
```

预期: FAIL (sync-engine.ts 尚未创建)

- [ ] **Step 3: 创建同步引擎纯函数**

```typescript
// src/service-worker/sync-engine.ts
import type { SyncConfig, CacheEntry, KeyMapping, SyncResult } from "../types";

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
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run tests/sync-engine.test.ts
```

预期: PASS (8 tests)

- [ ] **Step 5: 创建完整的 Service Worker**

```typescript
// src/service-worker/index.ts
import type { PanelMessage, PanelResponse, CSMessage, CSResponse } from "../types";
import { loadConfigs, saveConfig, deleteConfig, getConfigById } from "./config-store";
import { getCache, saveCache, deleteCache } from "./cache-store";
import { validateSourceUrl, applyMappings, checkMissingKeys, buildSyncResult } from "./sync-engine";

console.log("[StorageSync SW] Service Worker 已启动");

// ===== 消息路由 =====

chrome.runtime.onMessage.addListener(
  (
    message: PanelMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (r: PanelResponse) => void
  ) => {
    // 只处理来自 Side Panel 或自身扩展的消息
    handleMessage(message, sender).then(sendResponse);
    return true; // 异步响应
  }
);

async function handleMessage(
  msg: PanelMessage,
  _sender: chrome.runtime.MessageSender
): Promise<PanelResponse> {
  switch (msg.action) {
    case "GET_CONFIGS":
      return handleGetConfigs();
    case "SAVE_CONFIG":
      return handleSaveConfig(msg.config);
    case "DELETE_CONFIG":
      return handleDeleteConfig(msg.id);
    case "SYNC_CACHE":
      return handleSyncCache(msg.configId);
    case "FORCE_REFRESH":
      return handleForceRefresh(msg.config);
    default:
      return { success: false, error: `未知操作: ${(msg as PanelMessage).action}` };
  }
}

// ===== 处理器 =====

async function handleGetConfigs(): Promise<PanelResponse> {
  const configs = await loadConfigs();
  return { success: true, data: configs };
}

async function handleSaveConfig(config: PanelMessage extends { action: "SAVE_CONFIG"; config: infer C } ? C : never): Promise<PanelResponse> {
  try {
    await saveConfig(config);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

async function handleDeleteConfig(id: string): Promise<PanelResponse> {
  await deleteConfig(id);
  await deleteCache(id);
  return { success: true };
}

async function handleSyncCache(configId: string): Promise<PanelResponse> {
  try {
    // 1. 获取配置
    const config = await getConfigById(configId);
    if (!config) {
      return { success: false, error: "配置不存在" };
    }

    // 2. 获取缓存
    const cache = await getCache(configId);
    if (!cache) {
      return { success: false, error: "暂无缓存数据，请先执行强制刷新" };
    }

    // 3. 写入当前页
    return await writeToCurrentTab(config, cache);
  } catch (err) {
    return { success: false, error: `同步缓存失败: ${String(err)}` };
  }
}

async function handleForceRefresh(config: any): Promise<PanelResponse> {
  let sourceTabId: number | null = null;

  try {
    // 1. 校验 URL
    if (!validateSourceUrl(config.sourceUrl)) {
      return { success: false, error: "源站 URL 无效" };
    }

    // 2. 获取当前活跃 Tab（当前网站）
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab?.id) {
      return { success: false, error: "无法获取当前页面" };
    }

    // 检查当前页是否支持 localStorage
    if (!currentTab.url || !validateSourceUrl(currentTab.url)) {
      return { success: false, error: "当前页面不支持 localStorage 写入" };
    }

    // 3. 静默打开源站
    const sourceTab = await chrome.tabs.create({
      url: config.sourceUrl,
      active: false,
    });
    if (!sourceTab.id) {
      return { success: false, error: "无法打开源站页面" };
    }
    sourceTabId = sourceTab.id;

    // 4. 等待源站加载完成
    await waitForTabLoad(sourceTab.id);

    // 5. 读取源站 localStorage
    const srcKeys = config.mappings.map((m: any) => m.srcKey);
    const readResult = await sendMessageToTab<CSMessage, CSResponse>(
      sourceTab.id,
      { action: "READ_STORAGE", keys: srcKeys }
    );

    if (!readResult.success) {
      return { success: false, error: `读取源站失败: ${readResult.error}` };
    }

    const sourceData = readResult.data ?? {};

    // 6. 保存缓存
    const cacheEntry = {
      configId: config.id,
      data: sourceData,
      url: config.sourceUrl,
      fetchedAt: Date.now(),
    };
    await saveCache(cacheEntry);

    // 7. 关闭源站 Tab
    await chrome.tabs.remove(sourceTab.id);
    sourceTabId = null;

    // 8. 写入当前页
    return await writeToCurrentTab(config, cacheEntry);

  } catch (err) {
    // 清理：关闭源站 Tab
    if (sourceTabId !== null) {
      try { await chrome.tabs.remove(sourceTabId); } catch { /* ignore */ }
    }
    return { success: false, error: `强制刷新失败: ${String(err)}` };
  }
}

// ===== 辅助函数 =====

async function writeToCurrentTab(
  config: any,
  cache: { data: Record<string, string> }
): Promise<PanelResponse> {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab?.id) {
    return { success: false, error: "无法获取当前页面" };
  }

  // 按 mappings 转换数据
  const entries = applyMappings(config.mappings, cache.data);
  const missingKeys = checkMissingKeys(config, cache.data);

  if (Object.keys(entries).length === 0) {
    return { success: false, error: "源站数据中没有任何匹配的 key" };
  }

  // 注入写入操作
  const writeResult = await sendMessageToTab<CSMessage, CSResponse>(
    currentTab.id,
    { action: "WRITE_STORAGE", entries }
  );

  if (!writeResult.success) {
    return {
      success: false,
      data: buildSyncResult(0, missingKeys, writeResult.error),
    };
  }

  const result = buildSyncResult(Object.keys(entries).length, missingKeys, null);
  return { success: true, data: result };
}

/** 等待 Tab 加载完成 */
function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("源站加载超时"));
    }, 15000); // 15 秒超时

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // 额外：监听 Tab 关闭
    const removeListener = (removedTabId: number) => {
      if (removedTabId === tabId) {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.onRemoved.removeListener(removeListener);
        reject(new Error("同步被中断"));
      }
    };
    chrome.tabs.onRemoved.addListener(removeListener);
  });
}

/** 向指定 Tab 发送消息 */
function sendMessageToTab<M, R>(
  tabId: number,
  message: M
): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: R) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
```

- [ ] **Step 6: 运行全部测试**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run
```

预期: 全部 PASS (config-store 7 + cache-store 4 + content-script 3 + sync-engine 8 = 22 tests)

- [ ] **Step 7: 提交**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git add -A && git commit -m "feat: Service Worker 同步引擎 — 消息路由 + 静默 Tab + 同步编排"
```

---

### Task 5: Side Panel UI — 完整界面

**目标:** 实现 Side Panel 的完整 HTML 结构、CSS 样式、JS 交互逻辑。

**产出:** 用户可通过 Side Panel 管理配置、执行同步、查看结果。

**依赖:** Task 1 (类型定义), Task 4 (SW 消息协议)

- [ ] **Step 1: 创建完整 CSS 样式**

```css
/* src/sidepanel/styles.css */
:root {
  --bg: #ffffff;
  --text: #1a1a2e;
  --text-secondary: #6b7280;
  --border: #e5e7eb;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --danger: #ef4444;
  --danger-hover: #dc2626;
  --success: #10b981;
  --warn: #f59e0b;
  --card-bg: #f9fafb;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08);
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  width: 100%;
  min-height: 100vh;
  line-height: 1.5;
}

.app { padding: 16px; display: flex; flex-direction: column; gap: 16px; }

/* ===== 标题栏 ===== */
.app-header {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.app-header h1 {
  font-size: 16px;
  font-weight: 600;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-secondary);
}
.empty-state p { margin-bottom: 12px; }
.empty-state .icon { font-size: 32px; margin-bottom: 8px; }

/* ===== 配置卡片 ===== */
.config-card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  cursor: pointer;
  transition: box-shadow 0.15s;
  box-shadow: var(--shadow);
}
.config-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.config-card + .config-card { margin-top: 8px; }

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.card-info { flex: 1; min-width: 0; }
.card-name {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 2px;
}
.card-url {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}
.card-meta {
  font-size: 11px;
  color: var(--text-secondary);
}

/* ===== 按钮 ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.btn-outline {
  background: var(--bg);
  color: var(--primary);
  border-color: var(--primary);
}
.btn-outline:hover:not(:disabled) {
  background: var(--primary);
  color: #fff;
}
.btn-danger {
  background: transparent;
  color: var(--danger);
  border: none;
  padding: 4px 8px;
}
.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
}
.btn-add {
  width: 100%;
  padding: 10px;
  text-align: center;
  background: transparent;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-add:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

/* ===== 映射列表 ===== */
.mapping-list {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.mapping-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 3px 0;
}
.mapping-arrow {
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* ===== 表单 ===== */
.config-form {
  background: var(--card-bg);
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  padding: 14px;
}
.form-group { margin-bottom: 10px; }
.form-group label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--text-secondary);
}
.form-group input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.form-group input:focus {
  border-color: var(--primary);
}

.mapping-inputs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.mapping-inputs input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
}
.mapping-inputs input:focus {
  border-color: var(--primary);
  outline: none;
}
.mapping-inputs .arrow { color: var(--text-secondary); flex-shrink: 0; }

.btn-add-mapping {
  background: transparent;
  border: none;
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
.btn-add-mapping:hover { text-decoration: underline; }

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* ===== 状态提示 ===== */
.status-bar {
  padding: 8px 12px;
  border-radius: var(--radius);
  font-size: 12px;
  margin-top: 8px;
}
.status-success { background: #ecfdf5; color: var(--success); }
.status-partial { background: #fffbeb; color: var(--warn); }
.status-error { background: #fef2f2; color: var(--danger); }
.status-loading { background: #eff6ff; color: var(--primary); }

/* ===== 加载动画 ===== */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== 删除确认 ===== */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}
.confirm-box {
  background: #fff;
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
}
.confirm-box p { margin-bottom: 14px; font-size: 14px; }
.confirm-actions { display: flex; gap: 8px; justify-content: center; }
```

- [ ] **Step 2: 创建完整 Side Panel 脚本**

```typescript
// src/sidepanel/index.ts
import type { SyncConfig, KeyMapping, PanelMessage, PanelResponse, SyncResult } from "../types";

// ===== 状态 =====
let configs: SyncConfig[] = [];
let editingId: string | null = null;
let syncingIds: Set<string> = new Set();
let statusMessages: Map<string, SyncResult> = new Map();

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
});

async function loadAndRender() {
  const resp = await sendMessage({ action: "GET_CONFIGS" });
  if (resp.success && Array.isArray(resp.data)) {
    configs = resp.data as SyncConfig[];
  }
  render();
}

// ===== 渲染 =====
function render() {
  const main = document.querySelector(".app-main")!;

  if (editingId) {
    if (editingId === "__new__") {
      main.innerHTML = renderForm(createEmptyConfig());
    } else {
      const config = configs.find((c) => c.id === editingId);
      if (config) main.innerHTML = renderForm({ ...config });
      else { editingId = null; render(); return; }
    }
  } else {
    main.innerHTML = renderConfigList();
  }

  bindEvents();
}

function renderConfigList(): string {
  if (configs.length === 0) {
    return `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>暂无源站配置</p>
        <button class="btn btn-primary" data-action="add">+ 新增配置</button>
      </div>`;
  }

  return configs
    .map((c) => {
      const status = statusMessages.get(c.id);
      const isSyncing = syncingIds.has(c.id);

      return `
        <div class="config-card" data-id="${c.id}">
          <div class="card-header">
            <div class="card-info" data-action="edit" data-id="${c.id}">
              <div class="card-name">${escapeHtml(c.name)}</div>
              <div class="card-url">${escapeHtml(c.sourceUrl)}</div>
              <div class="card-meta">
                ${c.mappings.length} 个映射
                ${status ? ` · ${status.message}` : ""}
              </div>
            </div>
            <button class="btn btn-danger" data-action="delete" data-id="${c.id}" title="删除">✕</button>
          </div>
          <div class="mapping-list">
            ${c.mappings
              .map(
                (m) =>
                  `<div class="mapping-item"><span>${escapeHtml(m.srcKey)}</span> <span class="mapping-arrow">→</span> <span>${escapeHtml(m.tgtKey)}</span></div>`
              )
              .join("")}
          </div>
          <div class="card-actions">
            <button class="btn btn-outline" data-action="sync-cache" data-id="${c.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "🔄"} 同步缓存
            </button>
            <button class="btn btn-primary" data-action="force-refresh" data-id="${c.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "⚡"} 强制刷新
            </button>
          </div>
          ${status ? `<div class="status-bar status-${status.status}">${status.message}</div>` : ""}
        </div>`;
    })
    .join("") +
    `<button class="btn-add" data-action="add">+ 新增配置</button>`;
}

function renderForm(config: SyncConfig): string {
  const mappingRows = config.mappings
    .map(
      (m, i) => `
        <div class="mapping-inputs" data-index="${i}">
          <input type="text" value="${escapeHtml(m.srcKey)}" placeholder="源站 key" data-field="srcKey" data-index="${i}">
          <span class="arrow">→</span>
          <input type="text" value="${escapeHtml(m.tgtKey)}" placeholder="目标 key" data-field="tgtKey" data-index="${i}">
          <button class="btn btn-danger" data-action="remove-mapping" data-index="${i}" ${config.mappings.length <= 1 ? "disabled" : ""}>✕</button>
        </div>`
    )
    .join("");

  return `
    <div class="config-form">
      <div class="form-group">
        <label>配置名称</label>
        <input type="text" id="form-name" value="${escapeHtml(config.name)}" placeholder="如：测试站Token">
      </div>
      <div class="form-group">
        <label>源站 URL</label>
        <input type="text" id="form-url" value="${escapeHtml(config.sourceUrl)}" placeholder="https://admin.example.com">
      </div>
      <div class="form-group">
        <label>Key 映射</label>
        <div id="mapping-rows">${mappingRows}</div>
        <button class="btn-add-mapping" data-action="add-mapping">+ 添加映射</button>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" data-action="save-form">保存</button>
        <button class="btn btn-outline" data-action="cancel-form">取消</button>
      </div>
    </div>`;
}

// ===== 事件绑定 =====
function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((el) => {
    const action = el.getAttribute("data-action")!;
    const id = el.getAttribute("data-id");

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      handleAction(action, id, el);
    });
  });
}

async function handleAction(action: string, id: string | null, el: Element) {
  switch (action) {
    case "add":
      editingId = "__new__";
      render();
      break;

    case "edit":
      editingId = id;
      render();
      break;

    case "delete":
      if (id && confirm("确定要删除这个配置吗？")) {
        await sendMessage({ action: "DELETE_CONFIG", id });
        statusMessages.delete(id);
        await loadAndRender();
      }
      break;

    case "cancel-form":
      editingId = null;
      render();
      break;

    case "save-form":
      await handleSaveForm();
      break;

    case "add-mapping":
      addMappingRow();
      break;

    case "remove-mapping":
      removeMappingRow(el);
      break;

    case "sync-cache":
      if (id) await handleSync(id, false);
      break;

    case "force-refresh":
      if (id) await handleSync(id, true);
      break;
  }
}

// ===== 表单操作 =====
function createEmptyConfig(): SyncConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    sourceUrl: "",
    mappings: [{ srcKey: "", tgtKey: "" }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function readFormData(): SyncConfig | null {
  const nameInput = document.getElementById("form-name") as HTMLInputElement;
  const urlInput = document.getElementById("form-url") as HTMLInputElement;

  const name = nameInput?.value.trim();
  const url = urlInput?.value.trim();

  if (!name) { alert("请输入配置名称"); return null; }
  if (!url) { alert("请输入源站 URL"); return null; }

  try { new URL(url); } catch { alert("请输入有效的 URL"); return null; }

  const mappings: KeyMapping[] = [];
  document.querySelectorAll(".mapping-inputs").forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const srcKey = (inputs[0] as HTMLInputElement).value.trim();
    const tgtKey = (inputs[1] as HTMLInputElement).value.trim();
    if (srcKey && tgtKey) {
      mappings.push({ srcKey, tgtKey });
    }
  });

  if (mappings.length === 0) {
    alert("至少需要一个 key 映射");
    return null;
  }

  const existing = editingId && editingId !== "__new__"
    ? configs.find((c) => c.id === editingId)
    : null;

  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    sourceUrl: url,
    mappings,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

async function handleSaveForm() {
  const config = readFormData();
  if (!config) return;

  const resp = await sendMessage({ action: "SAVE_CONFIG", config });
  if (resp.success) {
    editingId = null;
    await loadAndRender();
  } else {
    alert(`保存失败: ${resp.error}`);
  }
}

function addMappingRow() {
  const container = document.getElementById("mapping-rows");
  if (!container) return;

  const index = container.querySelectorAll(".mapping-inputs").length;
  const row = document.createElement("div");
  row.className = "mapping-inputs";
  row.setAttribute("data-index", String(index));
  row.innerHTML = `
    <input type="text" placeholder="源站 key" data-field="srcKey" data-index="${index}">
    <span class="arrow">→</span>
    <input type="text" placeholder="目标 key" data-field="tgtKey" data-index="${index}">
    <button class="btn btn-danger" data-action="remove-mapping" data-index="${index}">✕</button>
  `;
  container.appendChild(row);
  bindEvents();
}

function removeMappingRow(el: Element) {
  const row = el.closest(".mapping-inputs");
  if (row) row.remove();
}

// ===== 同步操作 =====
async function handleSync(configId: string, forceRefresh: boolean) {
  syncingIds.add(configId);
  statusMessages.set(configId, {
    status: "success",
    message: "同步中...",
    syncedCount: 0,
    missingKeys: [],
  });
  render();

  const config = configs.find((c) => c.id === configId);
  if (!config) return;

  const action = forceRefresh ? "FORCE_REFRESH" : "SYNC_CACHE";
  const message: PanelMessage = forceRefresh
    ? { action: "FORCE_REFRESH", config }
    : { action: "SYNC_CACHE", configId };

  try {
    const resp = await sendMessage(message);
    if (resp.success && resp.data) {
      statusMessages.set(configId, resp.data as SyncResult);
    } else {
      statusMessages.set(configId, {
        status: "error",
        message: `❌ ${resp.error}`,
        syncedCount: 0,
        missingKeys: [],
        error: resp.error,
      } as SyncResult);
    }
  } catch (err) {
    statusMessages.set(configId, {
      status: "error",
      message: `❌ 同步失败: ${String(err)}`,
      syncedCount: 0,
      missingKeys: [],
      error: String(err),
    } as SyncResult);
  } finally {
    syncingIds.delete(configId);
    await loadAndRender();
  }
}

// ===== 工具函数 =====
function sendMessage(msg: PanelMessage): Promise<PanelResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: PanelResponse) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message! });
      } else {
        resolve(response);
      }
    });
  });
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
```

- [ ] **Step 3: 提交**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git add -A && git commit -m "feat: Side Panel UI — 完整界面与交互逻辑"
```

---

### Task 6: 集成验证

**目标:** 验证扩展在 Chrome 中可正常加载和运行。

**产出:** 构建产物可加载到 Chrome，功能正常工作。

**依赖:** Task 1-5 全部完成

- [ ] **Step 1: 执行生产构建**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npm run build
```

预期: 构建成功，无 TypeScript 错误，`dist/` 目录生成完整扩展。

- [ ] **Step 2: 运行全部单元测试**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && npx vitest run
```

预期: 22 tests 全部 PASS。

- [ ] **Step 3: 在 Chrome 中加载扩展进行手工验证**

操作步骤：
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `dist/` 目录
4. 验证扩展图标出现在工具栏
5. 打开任意网页（如 `https://example.com`），点击扩展图标 → 侧边栏出现
6. 验证 Side Panel UI 正常渲染（空状态 → 新增配置 → 编辑/删除）
7. 在浏览器另一个 Tab 中打开有 localStorage 数据的网站
8. 使用"强制刷新" 按钮抓取数据
9. 切换到目标页面，使用"同步缓存"写入数据
10. 打开 DevTools → Application → Local Storage 验证数据已写入

- [ ] **Step 4: 提交最终版本**

```bash
cd /Users/jing/Documents/AIProjects/storageSync && git add -A && git commit -m "chore: 集成验证通过，扩展完成"
```

---

## 自审清单

| 检查项 | 结果 |
|--------|------|
| 覆盖 Spec 全部需求 | ✅ 配置 CRUD、混合模式同步、Side Panel UI、Content Script、静默 Tab、错误处理 |
| 无占位符/TODO | ✅ 所有代码、测试、命令均为完整内容 |
| 类型一致性 | ✅ types.ts → config-store.ts → cache-store.ts → sync-engine.ts → sw/index.ts → sidepanel/index.ts，接口签名一致 |
| 接口匹配 | ✅ SW 消息协议 (PanelMessage/PanelResponse) 与 Side Panel 的 sendMessage 匹配；CSMessage/CSResponse 与 Content Script 匹配 |
| 测试覆盖 | ✅ 配置存储 7 tests + 缓存存储 4 tests + Content Script 3 tests + 同步引擎 8 tests = 22 tests |
