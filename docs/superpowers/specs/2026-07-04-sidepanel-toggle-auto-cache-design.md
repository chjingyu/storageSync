# Side Panel 开关 + 自动缓存 + 缓存展示 · 设计文档

> 日期：2026-07-04 | 状态：设计确认 | 补充原设计 `2026-07-04-chrome-localstorage-sync-design.md`

## 1. 功能目标

在现有扩展基础上新增以下能力：

| # | 功能 | 目标 |
|---|------|------|
| ① | 点击图标切换 Side Panel | 点击扩展图标打开/关闭面板，SW 手动控制 toggle |
| ② | 去掉标题栏 | 移除 `<header>` 节省面板垂直空间 |
| ③ | 源站访问自动缓存 | 用户正常访问源站页面时，Content Script 自动抓取 localStorage 并更新扩展缓存，零感知 |
| ④ | 卡片表格展示缓存 | 配置卡片内以表格展示映射关系与缓存值，溢出省略 + hover tooltip |
| ⑤ | 按钮重命名 | "强制刷新" → "立即更新" |

## 2. 功能①：点击图标切换 Side Panel

### 2.1 机制

阻止 Chrome 默认的 `action.onClicked` + side panel 绑定行为，改为手动控制：

| 操作 | 实现 |
|------|------|
| 阻止默认 | `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })` |
| 打开面板 | `chrome.sidePanel.open({ windowId })` |
| 关闭面板 | `chrome.sidePanel.setOptions({ enabled: false })` → 立即 `setOptions({ enabled: true })` 恢复 |
| 状态追踪 | SW 内存变量 `isPanelOpen: boolean` |
| 状态同步 | Side Panel 在 `pagehide` 事件时发送 `PANEL_CLOSED` 消息给 SW |

### 2.2 涉及边界

- **首次安装 / SW 启动**：`isPanelOpen = false`，状态从零开始
- **用户通过其他方式关闭面板**（右键关闭、快捷键关闭）：`pagehide` 事件仍会触发，消息正常发送
- **SW 重启**（空闲回收）：`isPanelOpen` 重置为 false，但面板如果仍处于打开状态（极少情况），下次用户点击会执行 open（面板已打开不会重复）
- **多个窗口**：仅追踪当前窗口面板状态；其他窗口的面板独立处理，SW 不做复杂多窗口协调

## 3. 功能②：去掉标题栏

移除 `src/sidepanel/index.html` 中的 `<header class="app-header"><h1>🔄 LocalStorage Sync</h1></header>` 元素。

对应 CSS 中 `.app-header` 样式一并清理。

## 4. 功能③：源站访问自动缓存

### 4.1 触发流程

```
用户正常访问源站 (如 admin.example.com)
  │
  └─ Content Script 注入 (<all_urls>, document_idle)
       │
       ├─ 获取当前 window.location.origin
       ├─ 向 SW 查询匹配的配置: { action: "CHECK_MATCH", origin }
       │   └─ SW 返回匹配的 { configId, srcKeys } 或 null
       ├─ 无匹配 → 终止
       ├─ 有匹配 → 读取 localStorage 中匹配的 srcKey
       └─ 发送 AUTO_CACHE 给 SW: { action: "AUTO_CACHE", configId, data }
            │
            └─ SW: merge 到现有缓存，更新 fetchedAt
```

### 4.2 设计要点

| 项 | 方案 |
|----|------|
| 触发时机 | Content Script `document_idle` 时触发检测（确保 localStorage 就绪） |
| 匹配方式 | origin 精确匹配（`new URL(config.sourceUrl).origin === window.location.origin`） |
| 查询方式 | CS 向 SW 发送 `CHECK_MATCH` 请求，而非预先推送映射（避免 SW 每次启动都广播） |
| 防抖 | 同一页面仅触发一次（`document_idle` 自然保证；SPA 路由切换不做额外处理） |
| 去重 merge | SW 收到 `AUTO_CACHE` 后浅合并到现有缓存（新覆盖旧），保留其他 key 不变 |
| 错误处理 | 读取失败静默忽略，不影响用户正常浏览 |
| 用户感知 | 零感知——无通知、无状态栏变更、纯后台 |

### 4.3 边界情况

- **iframe / 子页面**：Content Script 在 `<all_urls>` 下注入所有页面，iframe 内也会触发检测，但原页面和 iframe 各自独立检测，重复更新同一缓存无副作用（merge 覆盖）
- **用户同时打开多个源站 Tab**：各自独立触发 AUTO_CACHE，后到的覆盖先到的
- **源站修改 localStorage 后**：Content Script 仅在 `document_idle` 时执行一次检测，不会监听后续 localStorage 变更

## 5. 功能④：卡片表格展示缓存

### 5.1 UI 规格

每张配置卡片内，使用 `<table>` 展示三列：

```
┌─────────────────────────────────────────────────────────┐
│ 测试站Token                                    [✕ 删除] │
│ admin.example.com                                       │
│                                                         │
│ ┌──────────┬──────────────┬───────────────────────────┐ │
│ │ 源站 Key  │ 目标 Key     │ 缓存值                     │ │
│ ├──────────┼──────────────┼───────────────────────────┤ │
│ │ token    │ auth_token   │ eyJhbGciOiJSUzI1NiIsIn... │ │
│ │ uid      │ user_id      │ 12345                     │ │
│ │ role     │ user_role    │ admin                     │ │
│ └──────────┴──────────────┴───────────────────────────┘ │
│ ⏱ 缓存更新于 07-04 14:30                                │
│                                                         │
│ [🔄 同步缓存] [⚡ 立即更新]                                │
│ ⏱ 上次同步: 07-04 14:30 ✅                              │
└─────────────────────────────────────────────────────────┘
```

### 5.2 样式规格

| 元素 | 规格 |
|------|------|
| 表格布局 | `table-layout: fixed; width: 100%` |
| 列宽比例 | 源站 Key 25% / 目标 Key 25% / 缓存值 50% |
| 缓存值溢出 | `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 0`（配合 `width: 100%` 实现自适应缩略） |
| Tooltip | `<td>` 的 `title` 属性设为完整缓存值 |
| 无缓存时 | 缓存值列显示 "—" |
| 缓存时间行 | 表格下方独立一行，灰色小字 |

### 5.3 数据来源

`GET_CONFIGS` 响应扩展，SW 同时返回配置和缓存：

```typescript
interface ConfigWithCache {
  config: SyncConfig;
  cache: CacheEntry | null;
}
```

Side Panel 加载时一次性获取所有 `ConfigWithCache[]`，渲染到卡片内。

## 6. 功能⑤：按钮重命名

Side Panel 卡片操作按钮文案变更：

| 原文案 | 新文案 |
|--------|--------|
| "⚡ 强制刷新" | "⚡ 立即更新" |

代码中 `data-action` 值 `force-refresh` 保持不变（兼容性），仅修改展示文案。

## 7. 消息协议变更

### 7.1 新增消息

```typescript
// Content Script → SW: 查询当前页面是否匹配某配置
{ action: "CHECK_MATCH"; origin: string }

// SW → CS: 返回匹配信息
{ success: true; data: { configId: string; srcKeys: string[] } | null }
| { success: false; error: string }

// Content Script → SW: 自动缓存
{ action: "AUTO_CACHE"; configId: string; data: Record<string, string> }

// Side Panel → SW: 面板已关闭
{ action: "PANEL_CLOSED" }
```

### 7.2 变更消息

`GET_CONFIGS` 响应 data 从 `SyncConfig[]` 扩展为 `ConfigWithCache[]`。

## 8. 数据模型新增

```typescript
interface ConfigWithCache {
  config: SyncConfig;
  cache: CacheEntry | null;
}
```

现有 `SyncConfig`、`CacheEntry`、`KeyMapping` 不变。

## 9. 错误处理

| 场景 | 处理方式 |
|------|----------|
| `action.onClicked` 无法获取 windowId | 静默忽略，不打开面板 |
| `pagehide` 消息未到达 SW（SW 已销毁） | `isPanelOpen` 保持 false，下次点击正常打开 |
| `AUTO_CACHE` 数据为空 | 不更新缓存，保持旧数据 |
| `CHECK_MATCH` 请求失败 | CS 静默终止，不影响用户浏览 |
| 缓存值过长（tooltip 可能超出屏幕） | 不截断 tooltip 内容，原生 title 属性由浏览器处理 |

## 10. 测试策略

| 层级 | 测试内容 |
|------|----------|
| 单元测试 | SW toggle 状态机（open/close 逻辑）、`CHECK_MATCH` 匹配逻辑、`AUTO_CACHE` merge 逻辑 |
| 单元测试 | CS 消息发送逻辑、URL 匹配 |
| 单元测试 | 类型协议完整性 |
| 集成测试 | `GET_CONFIGS` 返回 `ConfigWithCache[]`、按钮文案变更 |
| 手工验证 | 点击图标打开/关闭面板、源站访问自动缓存、表格 tooltip |

## 11. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/types.ts` | 修改 | +`ConfigWithCache`、+`CHECK_MATCH`、+`AUTO_CACHE`、+`PANEL_CLOSED` |
| `src/service-worker/index.ts` | 修改 | +`action.onClicked` toggle、+`CHECK_MATCH`/`AUTO_CACHE`/`PANEL_CLOSED` 处理器、`GET_CONFIGS` 附带缓存 |
| `src/sidepanel/index.ts` | 修改 | +`pagehide` 发送 `PANEL_CLOSED`、表格渲染逻辑、按钮文案修改 |
| `src/sidepanel/index.html` | 修改 | 移除 `<header>` |
| `src/sidepanel/styles.css` | 修改 | +表格样式、溢出省略样式、tooltip 样式 |
| `src/content/index.ts` | 修改 | +`CHECK_MATCH` 查询、+`AUTO_CACHE` 发送 |
| `tests/` | 新增/修改 | 对应单元测试和集成测试更新 |

## 12. 不在范围内（YAGNI）

- 不修改现有 `handleForceRefresh` 底层逻辑（仅改按钮文案）
- 不做多窗口 Side Panel 状态协调
- 不监听 SPA 路由切换重新触发 AUTO_CACHE
- 不做缓存值搜索/过滤
- 缓存表格不做排序/分页
- 不做缓存数据脱敏/加密
