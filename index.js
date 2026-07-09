const MODULE_NAME = "oc-wiki-worldbook";
const EXTENSION_VERSION = "0.2.1";
const PROMPT_KEY_SUFFIX = `_${MODULE_NAME}`;
const DEFAULT_SETTINGS = {
  enabled: true,
  baseUrl: "",
  injectionPosition: "in_prompt",
  injectionDepth: 4,
  injectionRole: "system",
  injectionOrder: 5000,
  includeInWorldInfoScan: false,
  lastPromptKey: "",
  bindings: []
};

const EXTENSION_PROMPT_TYPES = Object.freeze({
  none: -1,
  in_prompt: 0,
  in_chat: 1,
  before_prompt: 2
});

const EXTENSION_PROMPT_ROLES = Object.freeze({
  system: 0,
  user: 1,
  assistant: 2
});

const LEGACY_POSITIONS = Object.freeze({
  before_last: "in_chat",
  top: "before_prompt",
  bottom: "in_prompt"
});

const POSITION_LABELS = Object.freeze({
  none: "不注入",
  in_prompt: "主提示词内",
  before_prompt: "主提示词前",
  in_chat: "聊天中"
});

const ROLE_LABELS = Object.freeze({
  system: "系统",
  user: "用户",
  assistant: "助手"
});

function stContext() {
  return globalThis.SillyTavern?.getContext?.() || {};
}

function extensionSettings() {
  const context = stContext();
  return context.extensionSettings || {};
}

function saveSettings() {
  stContext().saveSettingsDebounced?.();
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function settings() {
  const store = extensionSettings();
  if (!store[MODULE_NAME]) {
    store[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  const current = store[MODULE_NAME];
  current.enabled = current.enabled !== false;
  current.baseUrl = String(current.baseUrl || "").trim();

  if (hasOwn(LEGACY_POSITIONS, current.injectionPosition)) {
    if (current.injectionPosition === "before_last" && current.injectionDepth === undefined) {
      current.injectionDepth = 0;
    }
    current.injectionPosition = LEGACY_POSITIONS[current.injectionPosition];
  }

  if (!hasOwn(EXTENSION_PROMPT_TYPES, current.injectionPosition)) {
    current.injectionPosition = DEFAULT_SETTINGS.injectionPosition;
  }
  if (!hasOwn(EXTENSION_PROMPT_ROLES, current.injectionRole)) {
    current.injectionRole = DEFAULT_SETTINGS.injectionRole;
  }

  current.injectionDepth = clampInteger(current.injectionDepth, DEFAULT_SETTINGS.injectionDepth, 0, 10000);
  current.injectionOrder = clampInteger(current.injectionOrder, DEFAULT_SETTINGS.injectionOrder, 0, 9999);
  current.includeInWorldInfoScan = Boolean(current.includeInWorldInfoScan);
  current.lastPromptKey = String(current.lastPromptKey || "");
  current.bindings = Array.isArray(current.bindings) ? current.bindings : [];
  return current;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function parseShareLink(value) {
  const input = String(value || "").trim();
  if (!input) {
    return null;
  }
  const url = new URL(input, window.location.origin);
  const hash = decodeURIComponent(url.hash || "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hash.includes("=") ? hash : "");
  const entryId = url.searchParams.get("entry") || url.searchParams.get("id") || hashParams.get("entry") || hashParams.get("id") || "";
  const shareToken = url.searchParams.get("share") || url.searchParams.get("token") || hashParams.get("share") || hashParams.get("token") || "";
  return {
    sourceUrl: url.toString(),
    baseUrl: url.origin,
    entryId: entryId.trim(),
    shareToken: shareToken.trim()
  };
}

function bindingPayload(binding) {
  return {
    url: binding.sourceUrl || "",
    entryId: binding.entryId || "",
    shareToken: binding.shareToken || ""
  };
}

async function resolveBinding(baseUrl, binding) {
  const url = new URL("/api/tavern/resolve", baseUrl);
  if (binding.sourceUrl) {
    url.searchParams.set("url", binding.sourceUrl);
  } else {
    url.searchParams.set("entryId", binding.entryId || "");
    url.searchParams.set("share", binding.shareToken || "");
  }
  const response = await fetch(url.toString());
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `OC Wiki returned ${response.status}`);
  }
  return data;
}

async function fetchContext() {
  const current = settings();
  if (!current.enabled) {
    return "";
  }
  const enabledBindings = current.bindings.filter((binding) => binding.enabled !== false);
  if (!enabledBindings.length) {
    return "";
  }
  const firstUrl = enabledBindings.find((binding) => binding.baseUrl)?.baseUrl || "";
  const baseUrl = normalizeBaseUrl(current.baseUrl || firstUrl);
  if (!baseUrl) {
    return "";
  }
  const response = await fetch(`${baseUrl}/api/tavern/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: enabledBindings.map(bindingPayload) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `OC Wiki returned ${response.status}`);
  }
  updateStatus(data.failures?.length ? `已读取 ${data.entries?.length || 0} 个条目，${data.failures.length} 个失败` : `已准备 ${data.entries?.length || 0} 个条目`);
  return String(data.prompt || "").trim();
}

function updateStatus(text) {
  const node = document.querySelector("#oc_wiki_worldbook_status");
  if (node) {
    node.textContent = text;
  }
}

function renderBindings() {
  const list = document.querySelector("#oc_wiki_worldbook_bindings");
  if (!list) {
    return;
  }
  const current = settings();
  list.innerHTML = "";
  if (!current.bindings.length) {
    list.innerHTML = '<div class="oc-wiki-empty">还没有绑定 OC Wiki 条目。</div>';
    return;
  }
  for (const binding of current.bindings) {
    const item = document.createElement("div");
    item.className = "oc-wiki-binding";
    item.dataset.bindingId = binding.id;
    item.innerHTML = `
      <label class="oc-wiki-binding-main">
        <input type="checkbox" data-action="toggle" ${binding.enabled === false ? "" : "checked"}>
        <span>
          <strong>${escapeHtml(binding.title || binding.entryId || "Untitled entry")}</strong>
          <small>${escapeHtml(binding.category || binding.entryId || "")}</small>
        </span>
      </label>
      <button type="button" class="menu_button" data-action="remove">移除</button>
    `;
    list.append(item);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function addBindingFromInput() {
  const input = document.querySelector("#oc_wiki_worldbook_share_url");
  const raw = input?.value || "";
  let parsed;
  try {
    parsed = parseShareLink(raw);
  } catch (error) {
    updateStatus(`分享链接无效：${error.message}`);
    return;
  }
  if (!parsed?.entryId || !parsed?.shareToken) {
    updateStatus("分享链接里需要包含条目 ID 和 share token。");
    return;
  }
  const current = settings();
  const baseUrl = normalizeBaseUrl(current.baseUrl || parsed.baseUrl);
  if (!current.baseUrl && parsed.baseUrl) {
    current.baseUrl = parsed.baseUrl;
    const baseInput = document.querySelector("#oc_wiki_worldbook_base_url");
    if (baseInput) {
      baseInput.value = parsed.baseUrl;
    }
  }
  try {
    const resolved = await resolveBinding(baseUrl, parsed);
    const entry = resolved.entry || {};
    current.bindings.push({
      id: crypto.randomUUID(),
      enabled: true,
      sourceUrl: parsed.sourceUrl,
      baseUrl: parsed.baseUrl,
      entryId: parsed.entryId,
      shareToken: parsed.shareToken,
      title: entry.title || parsed.entryId,
      category: entry.category || "",
      updatedAt: entry.updatedAt || ""
    });
    input.value = "";
    saveSettings();
    renderBindings();
    updateStatus(`已绑定：${entry.title || parsed.entryId}`);
  } catch (error) {
    updateStatus(`绑定失败：${error.message}`);
  }
}

function promptKey(current) {
  return `${String(current.injectionOrder).padStart(4, "0")}${PROMPT_KEY_SUFFIX}`;
}

function clearContextPrompt(current = settings()) {
  const context = stContext();
  if (context.extensionPrompts) {
    for (const key of Object.keys(context.extensionPrompts)) {
      if (key === MODULE_NAME || key === current.lastPromptKey || key.endsWith(PROMPT_KEY_SUFFIX)) {
        delete context.extensionPrompts[key];
      }
    }
  }
  if (current.lastPromptKey) {
    current.lastPromptKey = "";
    saveSettings();
  }
}

function setContextPrompt(prompt, current) {
  const context = stContext();
  if (typeof context.setExtensionPrompt !== "function") {
    throw new Error("当前 SillyTavern 未暴露 setExtensionPrompt，无法使用原生注入。");
  }

  clearContextPrompt(current);
  if (!prompt || current.injectionPosition === "none") {
    return "未注入";
  }

  const key = promptKey(current);
  context.setExtensionPrompt(
    key,
    prompt,
    EXTENSION_PROMPT_TYPES[current.injectionPosition],
    current.injectionDepth,
    current.includeInWorldInfoScan,
    EXTENSION_PROMPT_ROLES[current.injectionRole]
  );
  current.lastPromptKey = key;
  saveSettings();

  const layer = POSITION_LABELS[current.injectionPosition] || current.injectionPosition;
  const role = ROLE_LABELS[current.injectionRole] || current.injectionRole;
  const scan = current.includeInWorldInfoScan ? "参与 WI 扫描" : "不参与 WI 扫描";
  return `${layer}，深度 ${current.injectionDepth}，${role}，顺序 ${current.injectionOrder}，${scan}`;
}

function renderSettings() {
  const host = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
  if (!host || document.querySelector("#oc_wiki_worldbook_panel")) {
    return;
  }
  const current = settings();
  host.insertAdjacentHTML("beforeend", `
    <div id="oc_wiki_worldbook_panel" class="oc-wiki-worldbook-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>OC Wiki Worldbook</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label">
            <input id="oc_wiki_worldbook_enabled" type="checkbox" ${current.enabled ? "checked" : ""}>
            启用
          </label>
          <label>
            OC Wiki 地址
            <input id="oc_wiki_worldbook_base_url" class="text_pole" type="url" placeholder="https://oc.example.com" value="${escapeHtml(current.baseUrl)}">
          </label>
          <label>
            分享链接
            <textarea id="oc_wiki_worldbook_share_url" class="text_pole" rows="2" placeholder="粘贴 OC Wiki 分享链接，例如 ?share=...#entry=..."></textarea>
          </label>
          <div class="oc-wiki-setting-grid">
            <label>
              注入位置
              <select id="oc_wiki_worldbook_injection_position" class="text_pole">
                <option value="in_prompt" ${current.injectionPosition === "in_prompt" ? "selected" : ""}>主提示词内 / In Prompt</option>
                <option value="before_prompt" ${current.injectionPosition === "before_prompt" ? "selected" : ""}>主提示词前 / Before Prompt</option>
                <option value="in_chat" ${current.injectionPosition === "in_chat" ? "selected" : ""}>聊天中 / In Chat</option>
                <option value="none" ${current.injectionPosition === "none" ? "selected" : ""}>不注入 / None</option>
              </select>
            </label>
            <label>
              深度
              <input id="oc_wiki_worldbook_injection_depth" class="text_pole" type="number" min="0" max="10000" step="1" value="${current.injectionDepth}">
            </label>
            <label>
              角色
              <select id="oc_wiki_worldbook_injection_role" class="text_pole">
                <option value="system" ${current.injectionRole === "system" ? "selected" : ""}>系统 / System</option>
                <option value="user" ${current.injectionRole === "user" ? "selected" : ""}>用户 / User</option>
                <option value="assistant" ${current.injectionRole === "assistant" ? "selected" : ""}>助手 / Assistant</option>
              </select>
            </label>
            <label>
              注入顺序
              <input id="oc_wiki_worldbook_injection_order" class="text_pole" type="number" min="0" max="9999" step="1" value="${current.injectionOrder}">
            </label>
          </div>
          <label class="checkbox_label oc-wiki-scan-toggle">
            <input id="oc_wiki_worldbook_include_wi_scan" type="checkbox" ${current.includeInWorldInfoScan ? "checked" : ""}>
            参与世界书扫描
          </label>
          <div class="oc-wiki-help">
            现在使用 SillyTavern 原生扩展提示词注入。位置、深度、角色与酒馆的 Author's Note / Memory 类扩展一致；顺序会写入 prompt key，数值越小越靠前。
          </div>
          <div class="oc-wiki-actions">
            <button id="oc_wiki_worldbook_add" type="button" class="menu_button">绑定分享链接</button>
            <button id="oc_wiki_worldbook_test" type="button" class="menu_button">测试上下文</button>
          </div>
          <div id="oc_wiki_worldbook_status" class="oc-wiki-status">待命 · v${EXTENSION_VERSION}</div>
          <div id="oc_wiki_worldbook_bindings" class="oc-wiki-bindings"></div>
        </div>
      </div>
    </div>
  `);

  document.querySelector("#oc_wiki_worldbook_enabled")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.enabled = Boolean(event.target.checked);
    if (!currentSettings.enabled) {
      clearContextPrompt(currentSettings);
    }
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_base_url")?.addEventListener("input", (event) => {
    settings().baseUrl = normalizeBaseUrl(event.target.value);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_injection_position")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.injectionPosition = hasOwn(EXTENSION_PROMPT_TYPES, event.target.value) ? event.target.value : DEFAULT_SETTINGS.injectionPosition;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_injection_depth")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.injectionDepth = clampInteger(event.target.value, DEFAULT_SETTINGS.injectionDepth, 0, 10000);
    event.target.value = currentSettings.injectionDepth;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_injection_role")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.injectionRole = hasOwn(EXTENSION_PROMPT_ROLES, event.target.value) ? event.target.value : DEFAULT_SETTINGS.injectionRole;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_injection_order")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.injectionOrder = clampInteger(event.target.value, DEFAULT_SETTINGS.injectionOrder, 0, 9999);
    event.target.value = currentSettings.injectionOrder;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_include_wi_scan")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.includeInWorldInfoScan = Boolean(event.target.checked);
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_add")?.addEventListener("click", addBindingFromInput);
  document.querySelector("#oc_wiki_worldbook_test")?.addEventListener("click", async () => {
    try {
      const prompt = await fetchContext();
      updateStatus(prompt ? `上下文已读取：${prompt.length} 字符` : "没有可注入的上下文。");
    } catch (error) {
      updateStatus(`上下文读取失败：${error.message}`);
    }
  });
  document.querySelector("#oc_wiki_worldbook_bindings")?.addEventListener("click", (event) => {
    const row = event.target.closest(".oc-wiki-binding");
    const action = event.target.dataset.action;
    if (!row || !action) {
      return;
    }
    const current = settings();
    const binding = current.bindings.find((item) => item.id === row.dataset.bindingId);
    if (!binding) {
      return;
    }
    if (action === "remove") {
      current.bindings = current.bindings.filter((item) => item.id !== binding.id);
      clearContextPrompt(current);
    }
    if (action === "toggle") {
      binding.enabled = Boolean(event.target.checked);
      clearContextPrompt(current);
    }
    saveSettings();
    renderBindings();
  });
  renderBindings();
}

globalThis.ocWikiWorldbookGenerateInterceptor = async function ocWikiWorldbookGenerateInterceptor(chat) {
  const current = settings();
  try {
    if (!current.enabled) {
      clearContextPrompt(current);
      return chat;
    }
    const prompt = await fetchContext();
    if (!prompt) {
      clearContextPrompt(current);
      return chat;
    }
    const insertedAt = setContextPrompt(prompt, current);
    updateStatus(`已注册 ${prompt.length} 字符：${insertedAt}`);
  } catch (error) {
    clearContextPrompt(current);
    updateStatus(`已跳过注入：${error.message}`);
  }
  return chat;
};

jQuery(renderSettings);
