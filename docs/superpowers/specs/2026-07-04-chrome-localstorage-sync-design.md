# Chrome LocalStorage 跨站同步扩展 · 设计文档

> 日期：2026-07-04 | 状态：设计确认

## 1. 功能目标

开发一个 Chrome 浏览器扩展，使用 Side Panel 作为交互界面，支持用户配置多份源站（URL + Key 映射列表），手动选择任意一份配置将源站的 localStorage 数据同步到当前网站。

核心工作模式为**混合模式**：默认使用缓存在扩展存储中的快照执行同步（快速）；需要最新数据时可触发"强制刷新"，扩展在后台静默打开源站页面，注入 Content Script 抓取最新 localStorage 数据，更新缓存后再同步到当前页面。

## 2. 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   Chrome 扩展                        │
│                                                      │
│  ┌──────────────────┐   ┌─────────────────────────┐ │
│  │   Side Panel      │   │   Service Worker        │ │
│  │   (配置管理+同步)  │◄──│   (同步引擎+缓存管理)    │ │
│  │                   │   │                         │ │
│  │  - 配置列表 CRUD  │   │  - 监听 Side Panel 消息  │ │
│  │  - 每配置独立同步   │   │  - 静默打开源站 Tab      │ │
│  │  - 显示同步状态    │   │  - 协调 Content Script   │ │
│  └──────────────────┘   │  - 管理 chrome.storage   │ │
│                          └───────┬─────────────────┘ │
│                                  │                    │
│  ┌──────────────────────────────┴─────────────────┐ │
│  │   Content Script (注入源站 & 当前站)             │ │
│  │                                                 │ │
│  │  - 读取源站 localStorage → 返回给 SW            │ │
│  │  - 写入当前站 localStorage                      │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

| 组件 | 职责 |
|------|------|
| **Side Panel** | 用户界面：配置列表的增删改查、每份配置独立触发同步、查看同步状态 |
| **Service Worker** | 后台逻辑：接收 Side Panel 指令、管理静默 Tab 的生命周期、数据抓取/缓存/写入编排 |
| **Content Script** | 仅负责读写页面的 `localStorage`，通过 `chrome.runtime.sendMessage` 与 SW 通信 |
| **chrome.storage.local** | 存储：① 配置数据 ② 缓存快照（源站的 localStorage 副本） |

## 3. 数据模型

### 3.1 配置数据结构

```typescript
interface SyncConfig {
  id: string;                    // 唯一标识，UUID v4
  name: string;                  // 用户自定义名称
  sourceUrl: string;             // 源站 URL
  mappings: KeyMapping[];        // key 映射列表
  createdAt: number;             // 创建时间戳
  updatedAt: number;             // 最后修改时间戳
}

interface KeyMapping {
  srcKey: string;                // 源站 localStorage 的 key
  tgtKey: string;                // 目标站写入的 key（可与 srcKey 相同）
}
```

### 3.2 缓存数据结构

```typescript
interface CacheEntry {
  configId: string;              // 关联的配置 ID
  data: Record<string, string>;  // { srcKey: value, ... }
  url: string;                   // 抓取时的源站 URL
  fetchedAt: number;             // 抓取时间戳
}
```

### 3.3 存储布局

```
chrome.storage.local:
  ├── "configs"      → SyncConfig[]     // 所有配置
  └── "cache:{id}"   → CacheEntry       // 每份配置的缓存快照
```

## 4. Side Panel UI 布局

```
┌─────────────────────────────────┐
│  🔄 LocalStorage Sync           │
├─────────────────────────────────┤
│  📋 源站配置                     │
│  ┌─────────────────────────────┐│
│  │ 测试站Token                 ││
│  │ admin.example.com           ││
│  │ 3 个映射                    ││
│  │ [🔄 同步缓存] [⚡ 强制刷新]  ││
│  │ ⏱ 上次: 07-04 14:30 ✅      ││
│  ├─────────────────────────────┤│
│  │ 正式站账号                   ││
│  │ app.prod.com                ││
│  │ 2 个映射                    ││
│  │ [🔄 同步缓存] [⚡ 强制刷新]  ││
│  │ ⏱ 上次: 07-04 12:10 ✅      ││
│  └─────────────────────────────┘│
│  [+ 新增配置]                    │
└─────────────────────────────────┘
```

**交互说明：**
- 每份配置卡片自带 `同步缓存` 和 `强制刷新` 按钮，点击直接执行，无需选中步骤
- 点击卡片本体展开/折叠，显示映射详情和编辑功能
- 状态和时间戳跟各自配置绑定
- 新增/编辑配置在同一面板内展开内层表单（name、sourceUrl、mappings 动态行）

## 5. 同步执行流程

```
用户点击同步按钮 (Side Panel)
  │
  ├─ "同步缓存" 模式
  │    ├─ 读取 chrome.storage.local 中的 CacheEntry
  │    ├─ 若无缓存 → 提示 "请先执行强制刷新获取源站数据"
  │    ├─ 通过 Content Script 将 data 按 mappings 写入当前页
  │    └─ 显示结果: "✅ 已同步 N 个 key"
  │
  └─ "强制刷新" 模式
       ├─ SW 通过 chrome.tabs.create({ active: false }) 打开源站
       ├─ 等待页面加载完成 (document_idle)
       ├─ Content Script 读取 localStorage 中匹配的 srcKey
       ├─ 数据传回 SW → 存入 chrome.storage.local 更新缓存
       ├─ SW 关闭源站 Tab
       ├─ 再执行"同步缓存"的写入逻辑
       └─ 显示结果: "✅ 已从源站刷新并同步 N 个 key"
```

## 6. 消息协议

Side Panel 与 Service Worker 之间通过 `chrome.runtime.sendMessage` 通信：

```typescript
// Side Panel → SW
type PanelMessage =
  | { action: "GET_CONFIGS" }
  | { action: "SAVE_CONFIG"; config: SyncConfig }
  | { action: "DELETE_CONFIG"; id: string }
  | { action: "SYNC_CACHE"; configId: string; tabId: number }
  | { action: "FORCE_REFRESH"; config: SyncConfig; tabId: number };

// SW → Content Script
type CSMessage =
  | { action: "READ_STORAGE"; keys: string[] }
  | { action: "WRITE_STORAGE"; entries: Record<string, string> };
```

## 7. 错误处理

| 场景 | 处理方式 |
|------|----------|
| **源站 URL 不可达** (404/超时/网络错误) | Tab 加载失败后返回错误，显示 "❌ 源站无法访问: {原因}"，不清除旧缓存 |
| **源站缺少指定 srcKey** | 跳过该 key，标注 "⚠️ 源站缺少: auth_token"，其他 key 正常同步 |
| **当前站写入失败** (QuotaExceededError) | 捕获异常，显示 "❌ 写入失败: 存储空间不足"，已写入不回滚 |
| **静默 Tab 被用户手动关闭** | SW 检测到 Tab 被移除，中断流程，显示 "⚠️ 同步被中断" |
| **源站页面未完全加载** | Content Script 在 `document_idle` 时机注入，确保 localStorage 就绪 |
| **当前页不是网页** (chrome:// 等) | 禁用同步按钮，提示 "当前页面不支持 localStorage 写入" |
| **配置中 sourceUrl 格式错误** | 保存时前端校验 URL 格式，拒绝非法输入 |
| **缓存为空时点击"同步缓存"** | 提示 "暂无缓存数据，请先执行强制刷新" |

## 8. 权限设计

```json
{
  "permissions": ["storage", "sidePanel"],
  "host_permissions": ["<all_urls>"]
}
```

> 注：Manifest 中额外配置 `"side_panel": { "default_path": "sidepanel.html" }` 指定 Side Panel 入口页面。

## 9. 安全约束

- Content Script 只暴露 `readLocalStorage` 和 `writeLocalStorage` 两个操作
- Side Panel 与 SW 仅通过 `chrome.runtime.sendMessage` 通信，不对外暴露
- `chrome.storage.local` 中的数据不加密（与 localStorage 安全级别一致），如需加密可后续加 AES 层
- 不记录日志到外部，敏感数据不出扩展

## 10. 不做的功能（YAGNI）

- 不支持自动定时同步
- 不支持批量执行多份配置
- 不支持值转换/格式化函数
- 不支持数据加密
- 不提供独立设置页面（全部在 Side Panel 完成）
- 不支持 Key 前缀匹配/正则过滤
- 不做导出/导入配置功能

## 11. 技术选型

| 项 | 选择 | 理由 |
|----|------|------|
| UI 框架 | 原生 HTML/CSS/JS 或 Preact (轻量) | 扩展体积限制，无需重型框架 |
| 构建工具 | Vite + @crxjs/vite-plugin 或手动 manifest | 快速 HMR 开发体验 |
| 语言 | TypeScript | 类型安全 |
| 样式 | CSS Modules 或原生 CSS | 无额外依赖 |
