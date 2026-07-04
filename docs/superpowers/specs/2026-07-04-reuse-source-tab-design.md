# 复用已打开源站 Tab · 设计文档

> 日期：2026-07-04 | 状态：设计确认

## 1. 问题描述

`handleForceRefresh`（立即更新）每次都用 `chrome.tabs.create({ active: false })` 新建静默 Tab。若用户已正常打开着源站页面，重复创建 Tab 浪费资源，且不必要。

## 2. 修复方案

### 2.1 流程变更

```
当前:  校验 → 获取当前Tab → 新建源站Tab → 等待加载 → 读取 → 关闭Tab → 写入

改为:  校验 → 获取当前Tab →
       chrome.tabs.query({ url: origin/* }) 查找已有Tab
         ├─ 找到 → 复用
         └─ 未找到 → 新建（原逻辑）
       → 等待加载 → 读取 → 仅新建Tab才关闭 → 写入
```

### 2.2 实现

在 `handleForceRefresh` 中，将 `chrome.tabs.create` 替换为查询 + 条件创建：

```typescript
// 查找已打开的源站 Tab（仅匹配 origin 下的任意路径）
const sourceOrigin = new URL(config.sourceUrl).origin;
const [existingTab] = await chrome.tabs.query({ url: `${sourceOrigin}/*` });

let sourceTabId: number | null = null;
let isNewTab = false;

if (existingTab?.id) {
  sourceTabId = existingTab.id;
} else {
  const sourceTab = await chrome.tabs.create({
    url: config.sourceUrl,
    active: false,
  });
  if (!sourceTab.id) return { success: false, error: "无法打开源站页面" };
  sourceTabId = sourceTab.id;
  isNewTab = true;
}

// ... 等待加载 + 读取 + 缓存（不变）...

// 仅新建的 Tab 才关闭
if (isNewTab && sourceTabId !== null) {
  await chrome.tabs.remove(sourceTabId);
  sourceTabId = null;
}
```

### 2.3 边界情况

| 场景 | 处理 |
|------|------|
| 用户打开了多个源站 Tab | `chrome.tabs.query` 返回的第一个 |
| 匹配到的 Tab 正在加载中 | `waitForTabLoad` 等待其 `status === "complete"` |
| Content Script 未注入 | `<all_urls>` + `document_idle` 保证注入，`sendMessage` 正常触发 |
| 没有匹配 Tab | 回退到 `chrome.tabs.create` 新建 |
| 用户关闭了复用的 Tab | 读取操作已完成，不受影响 |

## 3. 改动范围

| 文件 | 改动 |
|------|------|
| `src/service-worker/index.ts` | `handleForceRefresh` 函数中约 15 行修改 |

## 4. 测试策略

- 单元测试：mock `chrome.tabs.query` 返回已有 Tab / 空数组 两种场景
- 构建 + 全量测试验证
