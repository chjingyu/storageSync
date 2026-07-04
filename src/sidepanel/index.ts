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
