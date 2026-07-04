import type { SyncConfig, KeyMapping, PanelMessage, PanelResponse, SyncResult, ConfigWithCache, CacheEntry } from "../types";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";

// ===== 状态 =====
let configsWithCache: ConfigWithCache[] = [];
let editingId: string | null = null;
let syncingIds: Set<string> = new Set();
let statusMessages: Map<string, SyncResult> = new Map();

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
});

// pagehide — 通知 SW 面板已关闭
window.addEventListener("pagehide", () => {
  chrome.runtime.sendMessage({ action: "PANEL_CLOSED" } as PanelMessage);
});

async function loadAndRender() {
  const resp = await sendMessage({ action: "GET_CONFIGS" });
  if (resp.success && Array.isArray(resp.data)) {
    configsWithCache = resp.data as ConfigWithCache[];
  }
  render();
}

// 辅助：根据 configId 查找缓存
function getCacheForConfig(configId: string): CacheEntry | null {
  const item = configsWithCache.find((c) => c.config.id === configId);
  return item?.cache ?? null;
}

// ===== 渲染 =====
function render() {
  const main = document.querySelector(".app-main")!;

  if (editingId) {
    if (editingId === "__new__") {
      main.innerHTML = renderForm(createEmptyConfig());
    } else {
      const config = configsWithCache.find((c) => c.config.id === editingId)?.config;
      if (config) main.innerHTML = renderForm({ ...config });
      else { editingId = null; render(); return; }
    }
  } else {
    main.innerHTML = renderConfigList();
  }

  bindEvents();
}

function renderCacheTable(cache: CacheEntry | null, mappings: KeyMapping[], configId: string): string {
  if (!cache || Object.keys(cache.data).length === 0) {
    return `<div class="cache-none">暂无缓存</div>`;
  }

  const cacheData = cache.data;
  const rows = mappings
    .map((m) => {
      const value = cacheData[m.srcKey];
      const display = value !== undefined ? escapeHtml(value) : "—";
      const tooltip = value !== undefined ? ` data-tooltip="${attrEscape(value)}"` : "";
      return `
        <tr>
          <td data-tooltip="${attrEscape(m.srcKey)}">${escapeHtml(m.srcKey)}</td>
          <td data-tooltip="${attrEscape(m.tgtKey)}">${escapeHtml(m.tgtKey)}</td>
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
    </div>
    <div class="cache-time">⏱ 缓存更新于 ${timeStr}</div>`;
}

function formatCacheTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN");
}

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
            <div class="card-info">
              <div class="card-name">${escapeHtml(config.name)}</div>
              <div class="card-url">${escapeHtml(config.sourceUrl)}</div>
              <div class="card-meta">
                ${config.mappings.length} 个映射
                ${hasCache ? `<button class="toggle-table" data-action="toggle-table" data-id="${config.id}">展开 ▼</button>` : ""}
                ${status ? ` · ${status.message}` : ""}
              </div>
            </div>
            <div class="card-header-actions">
              <button class="btn icon-btn icon-btn-edit" data-action="edit" data-id="${config.id}" title="编辑">✎</button>
              <button class="btn icon-btn icon-btn-delete" data-action="delete" data-id="${config.id}" title="删除">✕</button>
            </div>
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

function renderForm(config: SyncConfig): string {
  const mappingRows = config.mappings
    .map(
      (m, i) => `
        <div class="mapping-inputs" data-index="${i}">
          <input type="text" value="${escapeHtml(m.srcKey)}" placeholder="源站 key" data-field="srcKey" data-index="${i}">
          <span class="arrow">→</span>
          <input type="text" value="${escapeHtml(m.tgtKey)}" placeholder="目标 key" data-field="tgtKey" data-index="${i}">
          <button class="btn btn-danger" data-action="remove-mapping" data-index="${i}">✕</button>
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

// ===== 事件绑定 (事件委托，避免重复绑定) =====
let _tooltipUnbind: (() => void) | null = null;

function bindEvents() {
  const appMain = document.querySelector(".app-main");
  if (!appMain) return;

  // 点击事件：所有 [data-action] 统一委托
  appMain.removeEventListener("click", _delegatedClick);
  appMain.addEventListener("click", _delegatedClick);

  // Tooltip: 统一委托
  if (_tooltipUnbind) _tooltipUnbind();
  appMain.addEventListener("mouseenter", _delegatedTooltipEnter, true);
  appMain.addEventListener("mouseleave", _delegatedTooltipLeave, true);
  _tooltipUnbind = () => {
    appMain.removeEventListener("mouseenter", _delegatedTooltipEnter, true);
    appMain.removeEventListener("mouseleave", _delegatedTooltipLeave, true);
  };

  // 滚动时隐藏 tooltip
  window.addEventListener("scroll", hideTooltip, { once: true });

  // 确保删除按钮 disabled 状态一致（初始渲染 + 每次重新绑定）
  updateRemoveButtons();
}

function _delegatedClick(e: Event) {
  const target = (e.target as HTMLElement).closest("[data-action]");
  if (!target) return;
  e.stopPropagation();
  const action = target.getAttribute("data-action")!;
  const id = target.getAttribute("data-id");
  handleAction(action, id, target);
}

function _delegatedTooltipEnter(e: Event) {
  const target = (e.target as HTMLElement).closest("[data-tooltip]");
  if (!target) return;
  const content = target.getAttribute("data-tooltip");
  if (content) showTooltip(target as HTMLElement, content);
}

function _delegatedTooltipLeave(e: Event) {
  const target = (e.target as HTMLElement).closest("[data-tooltip]");
  if (!target) return;
  hideTooltip();
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

    case "toggle-table":
      if (id) toggleTable(id, el);
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
    ? configsWithCache.find((c) => c.config.id === editingId)?.config
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
  updateRemoveButtons();
}

function removeMappingRow(el: Element) {
  const row = el.closest(".mapping-inputs");
  if (row) row.remove();
  updateRemoveButtons();
}

/** 重新检查：仅剩 1 行时禁用删除按钮 */
function updateRemoveButtons() {
  const container = document.getElementById("mapping-rows");
  if (!container) return;
  const rows = container.querySelectorAll(".mapping-inputs");
  const soleRow = rows.length <= 1;
  rows.forEach((row) => {
    const btn = row.querySelector("[data-action='remove-mapping']") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = soleRow;
    }
  });
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

  const config = configsWithCache.find((c) => c.config.id === configId)?.config;
  if (!config) return;

  const message: PanelMessage = forceRefresh
    ? { action: "FORCE_REFRESH", config }
    : { action: "SYNC_CACHE", configId };

  try {
    const resp = await sendMessage(message);
    if (resp.success && resp.data) {
      statusMessages.set(configId, resp.data as SyncResult);
    } else {
      const errMsg = !resp.success ? resp.error : "未知错误";
      statusMessages.set(configId, {
        status: "error",
        message: `❌ ${errMsg}`,
        syncedCount: 0,
        missingKeys: [],
        error: errMsg,
      });
    }
  } catch (err) {
    statusMessages.set(configId, {
      status: "error",
      message: `❌ 同步失败: ${String(err)}`,
      syncedCount: 0,
      missingKeys: [],
      error: String(err),
    });
  } finally {
    syncingIds.delete(configId);
    await loadAndRender();
  }
}

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

function attrEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
