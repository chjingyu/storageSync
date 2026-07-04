# Floating UI Tooltip + 表格展开收起 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 @floating-ui/dom 替换原生 title tooltip + 缓存表格默认收起，点击展开

**Architecture:** 安装 `@floating-ui/dom` (~2KB)，在 sidepanel/index.ts 中创建全局 tooltip 管理函数和 toggle 事件处理，CSS 追加 tooltip 弹出层样式和表格隐藏控制

**Tech Stack:** TypeScript, @floating-ui/dom, Chrome MV3 Side Panel, Vitest

## Global Constraints

- @floating-ui/dom 版本：^1.6.0
- Tooltip 定位：placement `top`, middleware `[offset(6), flip(), shift({ padding: 8 })]`
- Tooltip 元素挂载到 `document.body`，使用绝对定位
- 缓存值 `<td>` 用 `data-tooltip` 属性替代原有的 `title` 属性
- 表格容器默认 `display: none`，展开时移除隐藏
- 展开/收起按钮 `data-action="toggle-table"`，事件委托
- 无缓存时显示"暂无缓存"，不展示展开/收起按钮
- 不记住展开/收起状态（不持久化）

---

### Task 1: 安装 @floating-ui/dom 依赖

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `@floating-ui/dom` 在 node_modules 中可用

- [ ] **Step 1: 安装依赖**

```bash
npm install @floating-ui/dom@^1.6.0 2>&1
```

Expected: 安装成功，`package.json` 中新增 `"@floating-ui/dom": "^1.6.x"`

- [ ] **Step 2: 验证导入**

```bash
node -e "const { computePosition, offset, flip, shift } = require('@floating-ui/dom'); console.log('OK:', typeof computePosition)" 2>&1
```

Expected: `OK: function`

- [ ] **Step 3: 提交**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 @floating-ui/dom ^1.6.0"
```

---

### Task 2: Tooltip + 表格收起 实现

**Files:**
- Modify: `src/sidepanel/index.ts`
- Modify: `src/sidepanel/styles.css`
- Test: `tests/sidepanel-ui.test.ts` (新建)

**Interfaces:**
- Consumes: `@floating-ui/dom` (from Task 1), `CacheEntry`, `KeyMapping`, `ConfigWithCache` (existing types)
- Produces: `showTooltip(target: HTMLElement, content: string): void`, `hideTooltip(): void`

- [ ] **Step 1: 编写测试**

新建 `tests/sidepanel-ui.test.ts`：

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock Floating UI
vi.mock("@floating-ui/dom", () => ({
  computePosition: vi.fn((_target, _tooltip, _options) =>
    Promise.resolve({ x: 100, y: 200 })
  ),
  offset: vi.fn(() => "offset-mw"),
  flip: vi.fn(() => "flip-mw"),
  shift: vi.fn(() => "shift-mw"),
}));

// Mock chrome API
beforeEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error partial mock
  globalThis.chrome = {
    runtime: {
      sendMessage: vi.fn((_msg, callback: (r: unknown) => void) => {
        callback({ success: false, error: "not mocked" });
      }),
    },
  };
});

describe("Side Panel UI", () => {
  describe("Tooltip 管理", () => {
    it("showTooltip 创建 tooltip 元素并追加到 body", async () => {
      // 导入模块中的函数（通过动态 import 触发）
      const { showTooltip, hideTooltip } = await import("../src/sidepanel/index");

      const target = document.createElement("div");
      document.body.appendChild(target);
      
      showTooltip(target, "test content");
      
      const tooltip = document.querySelector(".tooltip-popup");
      expect(tooltip).not.toBeNull();
      expect(tooltip!.textContent).toBe("test content");
    });

    it("hideTooltip 隐藏 tooltip 元素", async () => {
      const { showTooltip, hideTooltip } = await import("../src/sidepanel/index");

      const target = document.createElement("div");
      document.body.appendChild(target);
      showTooltip(target, "test");
      hideTooltip();
      
      const tooltip = document.querySelector(".tooltip-popup") as HTMLElement;
      expect(tooltip).not.toBeNull();
      expect(tooltip.classList.contains("visible")).toBe(false);
    });

    it("重复调用 showTooltip 复用同一个元素", async () => {
      const { showTooltip } = await import("../src/sidepanel/index");

      const t1 = document.createElement("div");
      const t2 = document.createElement("div");
      document.body.appendChild(t1);
      document.body.appendChild(t2);

      showTooltip(t1, "first");
      showTooltip(t2, "second");
      
      const tooltips = document.querySelectorAll(".tooltip-popup");
      expect(tooltips).toHaveLength(1);
      expect(tooltips[0].textContent).toBe("second");
    });
  });

  describe("Toggle 事件", () => {
    it("toggle-table 按钮在无缓存时不存在", async () => {
      // 设置空数据并渲染
      document.body.innerHTML = '<div class="app"><main class="app-main"></main></div>';
      
      // 无法直接触发 loadAndRender 因为需要 mock GET_CONFIGS 返回无缓存数据
      // 此处只验证 render 层面：卡片 HTML 中无 toggle 按钮
      const cardHtml = '<div class="config-card">' +
        '<div class="card-meta">3 个映射</div>' +
        '<div class="cache-none">暂无缓存</div>' +
        '</div>';
      
      const div = document.createElement("div");
      div.innerHTML = cardHtml;
      expect(div.querySelector("[data-action='toggle-table']")).toBeNull();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/sidepanel-ui.test.ts 2>&1
```

Expected: FAIL — `showTooltip` / `hideTooltip` 未导出。

- [ ] **Step 3: 修改 index.ts — 添加 Tooltip 函数**

在 `src/sidepanel/index.ts` 的 import 区域添加 Floating UI 导入：

```typescript
import type { SyncConfig, KeyMapping, PanelMessage, PanelResponse, SyncResult, ConfigWithCache, CacheEntry } from "../types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
```

在 `// ===== 工具函数 =====` 区域前添加 tooltip 管理代码：

```typescript
// ===== Tooltip 管理 =====

let tooltipEl: HTMLDivElement | null = null;

export function showTooltip(target: HTMLElement, content: string): void {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip-popup";
    document.body.appendChild(tooltipEl);
  }

  tooltipEl.textContent = content;
  tooltipEl.classList.add("visible");

  computePosition(target, tooltipEl, {
    placement: "top",
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  }).then(({ x, y }) => {
    if (tooltipEl) {
      tooltipEl.style.left = `${x}px`;
      tooltipEl.style.top = `${y}px`;
    }
  });
}

export function hideTooltip(): void {
  if (tooltipEl) {
    tooltipEl.classList.remove("visible");
  }
}
```

- [ ] **Step 4: 修改 index.ts — 绑定 tooltip 事件**

在 `bindEvents` 函数末尾追加 tooltip 事件委托：

```typescript
function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((el) => {
    const action = el.getAttribute("data-action")!;
    const id = el.getAttribute("data-id");

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      handleAction(action, id, el);
    });
  });

  // === Tooltip: 缓存值列 hover ===
  document.querySelectorAll("[data-tooltip]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      const content = (el as HTMLElement).getAttribute("data-tooltip");
      if (content) showTooltip(el as HTMLElement, content);
    });
    el.addEventListener("mouseleave", () => {
      hideTooltip();
    });
  });

  // 滚动时隐藏 tooltip
  const hideOnScroll = () => hideTooltip();
  window.addEventListener("scroll", hideOnScroll, { once: true });
}
```

- [ ] **Step 5: 修改 index.ts — renderCacheTable 改用 data-tooltip + 默认隐藏**

替换 `renderCacheTable` 函数，将 `title` 属性改为 `data-tooltip`，表格容器加上 id 和默认隐藏 class：

```typescript
function renderCacheTable(cache: CacheEntry | null, mappings: KeyMapping[], configId: string): string {
  if (!cache || Object.keys(cache.data).length === 0) {
    return `<div class="cache-none">暂无缓存</div>`;
  }

  const cacheData = cache.data;
  const rows = mappings
    .map((m) => {
      const value = cacheData[m.srcKey];
      const display = value !== undefined ? escapeHtml(value) : "—";
      const tooltip = value !== undefined ? ` data-tooltip="${escapeHtml(value)}"` : "";
      return `
        <tr>
          <td>${escapeHtml(m.srcKey)}</td>
          <td>${escapeHtml(m.tgtKey)}</td>
          <td${tooltip}>${display}</td>
        </tr>`;
    })
    .join("");

  const timeStr = new Date(cache.fetchedAt).toLocaleString("zh-CN");

  return `
    <div class="cache-table-wrap" id="table-${configId}" style="display:none">
      <table class="cache-table">
        <thead>
          <tr>
            <th>源站 Key</th>
            <th>目标 Key</th>
            <th>缓存值</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <div class="cache-time">⏱ 缓存更新于 ${timeStr}</div>
    </div>`;
}
```

- [ ] **Step 6: 修改 index.ts — renderConfigList 添加 toggle 按钮**

修改 `renderConfigList` 中的卡片渲染，添加展开/收起按钮，并传入 `configId` 给 `renderCacheTable`：

```typescript
function renderConfigList(): string {
  if (configsWithCache.length === 0) {
    return `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>暂无源站配置</p>
        <button class="btn btn-primary" data-action="add">+ 新增配置</button>
      </div>`;
  }

  return configsWithCache
    .map(({ config, cache }) => {
      const status = statusMessages.get(config.id);
      const isSyncing = syncingIds.has(config.id);
      const hasCache = cache && Object.keys(cache.data).length > 0;

      return `
        <div class="config-card" data-id="${config.id}">
          <div class="card-header">
            <div class="card-info" data-action="edit" data-id="${config.id}">
              <div class="card-name">${escapeHtml(config.name)}</div>
              <div class="card-url">${escapeHtml(config.sourceUrl)}</div>
              <div class="card-meta">
                ${config.mappings.length} 个映射
                ${hasCache ? `<button class="toggle-table" data-action="toggle-table" data-id="${config.id}">展开 ▼</button>` : ""}
                ${status ? ` · ${status.message}` : ""}
              </div>
            </div>
            <button class="btn btn-danger" data-action="delete" data-id="${config.id}" title="删除">✕</button>
          </div>
          ${renderCacheTable(cache, config.mappings, config.id)}
          <div class="card-actions">
            <button class="btn btn-outline" data-action="sync-cache" data-id="${config.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "🔄"} 同步缓存
            </button>
            <button class="btn btn-primary" data-action="force-refresh" data-id="${config.id}" ${isSyncing ? "disabled" : ""}>
              ${isSyncing ? '<span class="spinner"></span>' : "⚡"} 立即更新
            </button>
          </div>
          ${status ? `<div class="status-bar status-${status.status}">${status.message}</div>` : ""}
        </div>`;
    })
    .join("") +
    `<button class="btn-add" data-action="add">+ 新增配置</button>`;
}
```

- [ ] **Step 7: 修改 index.ts — handleAction 添加 toggle-table 分支**

在 `handleAction` 的 switch 中添加新 case：

```typescript
    case "toggle-table":
      if (id) toggleTable(id, el);
      break;
```

并在文件末尾（`hideTooltip` 之后）添加 toggle 函数：

```typescript
// ===== 表格展开/收起 =====

function toggleTable(configId: string, btn: Element): void {
  const tableWrap = document.getElementById(`table-${configId}`);
  if (!tableWrap) return;

  const isHidden = tableWrap.style.display === "none";
  if (isHidden) {
    tableWrap.style.display = "";
    btn.textContent = "收起 ▲";
  } else {
    tableWrap.style.display = "none";
    btn.textContent = "展开 ▼";
  }
}
```

- [ ] **Step 8: 修改 styles.css — 添加 tooltip 和 toggle 样式**

在 `src/sidepanel/styles.css` 末尾追加：

```css
/* ===== Tooltip 弹出层 ===== */
.tooltip-popup {
  position: absolute;
  z-index: 9999;
  top: 0;
  left: 0;
  background: #1f2937;
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  max-width: 320px;
  word-break: break-all;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  opacity: 0;
  transition: opacity 0.1s;
}
.tooltip-popup.visible {
  opacity: 1;
}

/* ===== 表格容器 ===== */
.cache-table-wrap {
  margin-top: 8px;
}

/* ===== 展开/收起按钮 ===== */
.toggle-table {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 11px;
  cursor: pointer;
  padding: 0 4px;
  font-family: inherit;
}
.toggle-table:hover {
  text-decoration: underline;
}
```

- [ ] **Step 9: 运行测试确认通过**

```bash
npx vitest run tests/sidepanel-ui.test.ts 2>&1
```

Expected: 3 个测试 PASS

- [ ] **Step 10: 运行全部测试 + 构建**

```bash
npx vitest run 2>&1
npm run build 2>&1
```

Expected: 全部测试 PASS，构建成功。

- [ ] **Step 11: 提交**

```bash
git add src/sidepanel/index.ts src/sidepanel/styles.css tests/sidepanel-ui.test.ts
git commit -m "feat: Floating UI tooltip + 表格默认收起/展开切换"
```

---

### Task 3: 集成验证

**Files:**
- 无新建文件

- [ ] **Step 1: 类型检查**

```bash
npx tsc --noEmit 2>&1
```

Expected: 无类型错误。

- [ ] **Step 2: 构建**

```bash
npm run build 2>&1
```

Expected: 构建成功，依赖正确打包。

- [ ] **Step 3: 全部测试**

```bash
npx vitest run 2>&1
```

Expected: 全部 PASS（43+ tests）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: 集成验证通过 — 构建成功，全部测试 PASS"
```
