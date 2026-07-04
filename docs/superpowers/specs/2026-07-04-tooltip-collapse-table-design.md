# Floating UI Tooltip + 表格展开收起 · 设计文档

> 日期：2026-07-04 | 状态：设计确认 | 补充原设计

## 1. 功能目标

| # | 功能 | 目标 |
|---|------|------|
| ① | Floating UI Tooltip | 替换原生 `title` 属性，用 @floating-ui/dom 实现即时、可定位的 tooltip |
| ② | 表格默认收起 | 卡片默认隐藏缓存表格，"N 个映射"行右侧显示 [展开 ▼]，点击切换 |

## 2. 功能①：Floating UI Tooltip

### 2.1 机制

- 依赖：`@floating-ui/dom` (~2KB)
- 缓存值 `<td>` 的 `title` 属性 → `data-tooltip` 属性
- 全局 tooltip 元素：`<div class="tooltip-popup">` 挂载到 `document.body`
- 事件：`mouseenter` → 创建/显示 tooltip → `mouseleave` → 隐藏 tooltip
- 事件委托在 `.cache-table` 或 `.config-card` 父容器上

### 2.2 Tooltip 函数签名

```typescript
let tooltipEl: HTMLDivElement | null = null;

function showTooltip(target: HTMLElement, content: string): void {
  // 创建或复用 tooltipEl
  // 设置 textContent = content
  // computePosition(target, tooltipEl, {
  //   placement: "top",
  //   middleware: [offset(6), flip(), shift({ padding: 8 })]
  // }).then(({ x, y }) => { tooltipEl.style.left = x + 'px'; tooltipEl.style.top = y + 'px'; })
}

function hideTooltip(): void {
  // tooltipEl 移除或 display: none
}
```

### 2.3 边界

- **跨行快速移动**：先 hide 再 show，不产生残影
- **窗口边界**：`flip()` 自动翻转到可用空间，`shift()` 保持在视口内
- **内容为空**：`<td>` 无 `data-tooltip` 属性时不触发
- **滚轮/页面滚动**：tooltip 即刻隐藏（防止浮空）

## 3. 功能②：表格默认收起

### 3.1 卡片结构

```
默认收起:
┌──────────────────────────────────────┐
│ 测试站Token                 [✕ 删除] │
│ admin.example.com                    │
│ 3 个映射 [展开 ▼]                    │
│ [🔄 同步缓存] [⚡ 立即更新]            │
└──────────────────────────────────────┘

展开后:
┌──────────────────────────────────────┐
│ 测试站Token                 [✕ 删除] │
│ admin.example.com                    │
│ 3 个映射 [收起 ▲]                    │
│ ┌──────────┬──────────┬────────────┐ │
│ │ 源站 Key │ 目标 Key │ 缓存值      │ │
│ │ ...                               │ │
│ └──────────┴──────────┴────────────┘ │
│ ⏱ 缓存更新于 ...                     │
│ [🔄 同步缓存] [⚡ 立即更新]            │
└──────────────────────────────────────┘
```

### 3.2 交互规格

| 场景 | 行为 |
|------|------|
| 默认状态 | 表格隐藏，"N 个映射 [展开 ▼]" |
| 点击展开 | 表格显示，文案变为 "[收起 ▲]" |
| 点击收起 | 表格隐藏，文案变为 "[展开 ▼]" |
| 无缓存 | 显示"暂无缓存"，不展示展开/收起按钮 |
| 刷新数据后 | 表格状态保持（不自动收起） |

### 3.3 实现要点

- `data-action="toggle-table"` + `data-id` 委托事件处理
- 表格容器初始样式 `display: none`，展开时移除
- 纯 JS 切换，无额外框架状态

## 4. 样式规格

### 4.1 Tooltip

```css
.tooltip-popup {
  position: absolute;
  z-index: 9999;
  background: #1f2937;
  color: #fff;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 6px;
  max-width: 320px;
  word-break: break-all;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  /* hidden by default */
  opacity: 0;
  transition: opacity 0.1s;
}
.tooltip-popup.visible { opacity: 1; }
```

### 4.2 展开/收起按钮

```css
.toggle-table {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 11px;
  cursor: pointer;
  padding: 0 4px;
}
.toggle-table:hover { text-decoration: underline; }
```

## 5. 改动文件清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `package.json` | +`@floating-ui/dom` | 安装依赖 |
| `src/sidepanel/index.ts` | 修改 | +tooltip 函数、+toggle 事件处理、renderConfigList/渲染调整 |
| `src/sidepanel/styles.css` | 修改 | +`.tooltip-popup`、+`.toggle-table`、表格默认隐藏 |

## 6. 测试策略

| 层级 | 测试内容 |
|------|----------|
| 单元测试 | `showTooltip` / `hideTooltip` 函数（DOM 创建/移除） |
| 单元测试 | toggle 按钮状态切换（展开/收起文案） |
| 构建验证 | `npm run build` 成功，依赖正确打包 |

## 7. 不在范围内（YAGNI）

- 不做多行 tooltip（只展示单 key 对应值）
- 不做 tooltip 箭头（保持轻量）
- 不记住展开/收起状态（不持久化到 storage）
- 不做表格动画过渡
