# Tooltip 全列覆盖 + JSON 引号转义修复 · 设计文档

> 日期：2026-07-04 | 状态：设计确认

## 1. 问题描述

| # | 问题 | 根因 |
|---|------|------|
| ① | 仅缓存值列有 tooltip，源站 Key 和目标 Key 列溢出时无 tooltip | 渲染时只有第三列加了 `data-tooltip` |
| ② | JSON 字符串在 tooltip 中展示不全 | `escapeHtml()` 不转义 `"`，JSON 中的双引号导致 HTML 属性值提前截断 |

## 2. 修复方案

### 2.1 新增属性安全转义函数

```typescript
function attrEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

`escapeHtml` 用于 HTML 标签内容（`<td>内容</td>`），`attrEscape` 用于 HTML 属性值（`data-tooltip="值"`）。`getAttribute("data-tooltip")` 读取时浏览器自动将 `&quot;` 解码回 `"`。

### 2.2 三列全加 tooltip

`renderCacheTable` 中每行改为：

```html
<tr>
  <td data-tooltip="源站Key值">源站Key值</td>
  <td data-tooltip="目标Key值">目标Key值</td>
  <td data-tooltip="缓存值">缓存值</td>
</tr>
```

- 所有值使用 `attrEscape()` 填入 `data-tooltip` 属性
- 所有值使用 `escapeHtml()` 填入 `<td>` 内容

### 2.3 边界

- `srcKey` / `tgtKey` 通常较短不会溢出，但加 tooltip 提供一致性体验
- 无缓存时显示 "暂无缓存"，无表格行，不受影响
- `"null"` / `"undefined"` 等字符串保留为 JS 显示值 `"—"`，tooltip 仍展示原始值

## 3. 改动范围

| 文件 | 改动 | 说明 |
|------|------|------|
| `src/sidepanel/index.ts` | 修改 | +`attrEscape` 函数、`renderCacheTable` 三列 tooltip 统一使用 `attrEscape` |
| `tests/sidepanel-ui.test.ts` | 新增/修改（可选） | 验证 `attrEscape` 转义正确性 |

## 4. 测试策略

| 层级 | 内容 |
|------|------|
| 单元测试 | `attrEscape` 转义 `"` → `&quot;`，`&` → `&amp;` |
| 构建验证 | `npm run build` + `npx vitest run` |
