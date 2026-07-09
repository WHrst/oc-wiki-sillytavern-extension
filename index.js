const LEGACY_MODULE_NAME = "oc-wiki-worldbook";
const MODULE_NAME = "external-lore-source";
const EXTENSION_VERSION = "0.3.0";
const PROMPT_KEY_SUFFIX = `_${MODULE_NAME}`;
const LEGACY_PROMPT_KEY_SUFFIX = `_${LEGACY_MODULE_NAME}`;

const DEFAULT_SETTINGS = {
  enabled: true,
  ocWikiBaseUrl: "",
  processorUrl: "",
  processorApiKey: "",
  processorLanguage: "zh-CN",
  maxTokens: 2000,
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

let lastContextNotice = "";

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

function cloneSettings(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `external-lore-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function normalizeProcessorUrl(value) {
  return String(value || "").trim();
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

function normalizeBinding(binding) {
  const sourceUrl = String(binding?.sourceUrl || binding?.url || "").trim();
  const sourceType = binding?.sourceType || binding?.type || (binding?.entryId || binding?.shareToken ? "oc_wiki" : "web");
  return {
    ...binding,
    id: String(binding?.id || makeId()),
    enabled: binding?.enabled !== false,
    sourceType: sourceType === "oc_wiki" ? "oc_wiki" : "web",
    sourceUrl,
    baseUrl: normalizeBaseUrl(binding?.baseUrl || ""),
    entryId: String(binding?.entryId || "").trim(),
    shareToken: String(binding?.shareToken || "").trim(),
    title: String(binding?.title || (sourceType === "oc_wiki" ? binding?.entryId || "OC Wiki 条目" : hostFromUrl(sourceUrl) || "外部网页")).trim(),
    category: String(binding?.category || "").trim(),
    updatedAt: String(binding?.updatedAt || "").trim()
  };
}

function migrateLegacySettings(store) {
  if (store[MODULE_NAME]) {
    return;
  }
  const migrated = cloneSettings(DEFAULT_SETTINGS);
  if (store[LEGACY_MODULE_NAME]) {
    Object.assign(migrated, cloneSettings(store[LEGACY_MODULE_NAME]));
    migrated.ocWikiBaseUrl = normalizeBaseUrl(migrated.ocWikiBaseUrl || migrated.baseUrl || "");
  }
  store[MODULE_NAME] = migrated;
}

function settings() {
  const store = extensionSettings();
  migrateLegacySettings(store);
  const current = store[MODULE_NAME];
  current.enabled = current.enabled !== false;
  current.ocWikiBaseUrl = normalizeBaseUrl(current.ocWikiBaseUrl || current.baseUrl || "");
  current.baseUrl = current.ocWikiBaseUrl;
  current.processorUrl = normalizeProcessorUrl(current.processorUrl);
  current.processorApiKey = String(current.processorApiKey || "");
  current.processorLanguage = String(current.processorLanguage || DEFAULT_SETTINGS.processorLanguage).trim() || DEFAULT_SETTINGS.processorLanguage;

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
  current.maxTokens = clampInteger(current.maxTokens, DEFAULT_SETTINGS.maxTokens, 100, 200000);
  current.includeInWorldInfoScan = Boolean(current.includeInWorldInfoScan);
  current.lastPromptKey = String(current.lastPromptKey || "");
  current.bindings = Array.isArray(current.bindings) ? current.bindings.map(normalizeBinding) : [];
  return current;
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

function parseExternalSourceUrl(value) {
  const input = String(value || "").trim();
  if (!input) {
    return null;
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只支持 http 或 https 链接。");
  }
  return url.toString();
}

function ocWikiBindingPayload(binding) {
  return {
    url: binding.sourceUrl || "",
    entryId: binding.entryId || "",
    shareToken: binding.shareToken || ""
  };
}

function externalSourcePayload(binding) {
  return {
    id: binding.id,
    type: "url",
    url: binding.sourceUrl,
    title: binding.title || hostFromUrl(binding.sourceUrl)
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

async function fetchOcWikiContext(current, bindings) {
  const groups = new Map();
  for (const binding of bindings) {
    const baseUrl = normalizeBaseUrl(current.ocWikiBaseUrl || binding.baseUrl);
    if (!baseUrl) {
      throw new Error("OC Wiki 来源缺少 OC Wiki 地址。");
    }
    if (!groups.has(baseUrl)) {
      groups.set(baseUrl, []);
    }
    groups.get(baseUrl).push(binding);
  }

  const prompts = [];
  let entryCount = 0;
  let failureCount = 0;
  for (const [baseUrl, group] of groups.entries()) {
    const response = await fetch(`${baseUrl}/api/tavern/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bindings: group.map(ocWikiBindingPayload) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `OC Wiki returned ${response.status}`);
    }
    const prompt = String(data.prompt || "").trim();
    if (prompt) {
      prompts.push(prompt);
    }
    entryCount += data.entries?.length || group.length;
    failureCount += data.failures?.length || 0;
  }

  return {
    prompt: prompts.join("\n\n"),
    entryCount,
    failureCount
  };
}

function promptFromProcessorData(data) {
  const direct = data?.prompt ?? data?.context ?? data?.content ?? data?.text;
  if (direct) {
    return String(direct).trim();
  }
  if (!Array.isArray(data?.entries)) {
    return "";
  }
  return data.entries
    .map((entry) => {
      const body = entry?.prompt ?? entry?.content ?? entry?.summary ?? entry?.text ?? "";
      if (!body) {
        return "";
      }
      return entry?.title ? `### ${entry.title}\n${body}` : String(body);
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function fetchExternalContext(current, bindings) {
  const processorUrl = normalizeProcessorUrl(current.processorUrl);
  if (!processorUrl) {
    throw new Error("有外部网页 / Wiki 来源，但还没有配置整理 API 地址。");
  }

  const headers = { "Content-Type": "application/json" };
  if (current.processorApiKey) {
    headers.Authorization = `Bearer ${current.processorApiKey}`;
  }

  const response = await fetch(processorUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sources: bindings.map(externalSourcePayload),
      options: {
        language: current.processorLanguage,
        format: "sillytavern_lore",
        maxTokens: current.maxTokens
      },
      client: {
        name: "External Lore Source",
        version: EXTENSION_VERSION
      }
    })
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { text };
  }
  if (!response.ok) {
    throw new Error(data.error || data.message || text || `整理 API returned ${response.status}`);
  }

  const prompt = promptFromProcessorData(data);
  if (!prompt) {
    throw new Error("整理 API 没有返回 prompt、context、content、text 或 entries 内容。");
  }
  return {
    prompt,
    entryCount: data.entries?.length || bindings.length,
    failureCount: data.failures?.length || 0
  };
}

async function fetchContext() {
  const current = settings();
  lastContextNotice = "";
  if (!current.enabled) {
    return "";
  }
  const enabledBindings = current.bindings.filter((binding) => binding.enabled !== false);
  if (!enabledBindings.length) {
    return "";
  }

  const ocWikiBindings = enabledBindings.filter((binding) => binding.sourceType === "oc_wiki");
  const webBindings = enabledBindings.filter((binding) => binding.sourceType === "web");
  const prompts = [];
  const summaries = [];
  const errors = [];

  if (ocWikiBindings.length) {
    try {
      const result = await fetchOcWikiContext(current, ocWikiBindings);
      if (result.prompt) {
        prompts.push(result.prompt);
      }
      summaries.push(`OC Wiki ${result.entryCount} 条`);
      if (result.failureCount) {
        summaries.push(`OC Wiki ${result.failureCount} 个失败`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (webBindings.length) {
    try {
      const result = await fetchExternalContext(current, webBindings);
      if (result.prompt) {
        prompts.push(result.prompt);
      }
      summaries.push(`外部来源 ${result.entryCount} 条`);
      if (result.failureCount) {
        summaries.push(`外部来源 ${result.failureCount} 个失败`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!prompts.length && errors.length) {
    throw new Error(errors.join("；"));
  }
  lastContextNotice = errors.length ? `；部分来源失败：${errors.join("；")}` : "";
  updateStatus(errors.length ? `部分来源失败：${errors.join("；")}` : `已准备 ${summaries.join("，")}`);
  return prompts.join("\n\n---\n\n").trim();
}

function updateStatus(text) {
  const node = document.querySelector("#external_lore_source_status");
  if (node) {
    node.textContent = text;
  }
}

function sourceTypeLabel(binding) {
  return binding.sourceType === "oc_wiki" ? "OC Wiki" : "网页 / Wiki";
}

function bindingDetail(binding) {
  if (binding.sourceType === "oc_wiki") {
    return binding.category || binding.entryId || binding.baseUrl || "";
  }
  return binding.sourceUrl || "";
}

function renderBindings() {
  const list = document.querySelector("#external_lore_source_bindings");
  if (!list) {
    return;
  }
  const current = settings();
  list.innerHTML = "";
  if (!current.bindings.length) {
    list.innerHTML = '<div class="external-lore-empty">还没有绑定来源。可以先加 OC Wiki 分享链接，或绑定一个外部网页 / Wiki 链接。</div>';
    return;
  }
  for (const binding of current.bindings) {
    const item = document.createElement("div");
    item.className = "external-lore-binding";
    item.dataset.bindingId = binding.id;
    item.innerHTML = `
      <label class="external-lore-binding-main">
        <input type="checkbox" data-action="toggle" ${binding.enabled === false ? "" : "checked"}>
        <span class="external-lore-binding-copy">
          <span class="external-lore-binding-title">
            <span class="external-lore-source-pill">${escapeHtml(sourceTypeLabel(binding))}</span>
            <strong>${escapeHtml(binding.title || "未命名来源")}</strong>
          </span>
          <small>${escapeHtml(bindingDetail(binding))}</small>
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

async function addOcWikiBindingFromInput() {
  const input = document.querySelector("#external_lore_source_oc_share_url");
  const raw = input?.value || "";
  let parsed;
  try {
    parsed = parseShareLink(raw);
  } catch (error) {
    updateStatus(`OC Wiki 分享链接无效：${error.message}`);
    return;
  }
  if (!parsed?.entryId || !parsed?.shareToken) {
    updateStatus("OC Wiki 分享链接里需要包含条目 ID 和 share token。");
    return;
  }

  const current = settings();
  const baseUrl = normalizeBaseUrl(current.ocWikiBaseUrl || parsed.baseUrl);
  if (!current.ocWikiBaseUrl && parsed.baseUrl) {
    current.ocWikiBaseUrl = parsed.baseUrl;
    current.baseUrl = parsed.baseUrl;
    const baseInput = document.querySelector("#external_lore_source_oc_base_url");
    if (baseInput) {
      baseInput.value = parsed.baseUrl;
    }
  }

  try {
    const resolved = await resolveBinding(baseUrl, parsed);
    const entry = resolved.entry || {};
    current.bindings.push({
      id: makeId(),
      enabled: true,
      sourceType: "oc_wiki",
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
    updateStatus(`已绑定 OC Wiki：${entry.title || parsed.entryId}`);
  } catch (error) {
    updateStatus(`OC Wiki 绑定失败：${error.message}`);
  }
}

function addExternalSourceFromInput() {
  const input = document.querySelector("#external_lore_source_url");
  const raw = input?.value || "";
  let sourceUrl;
  try {
    sourceUrl = parseExternalSourceUrl(raw);
  } catch (error) {
    updateStatus(`外部链接无效：${error.message}`);
    return;
  }
  if (!sourceUrl) {
    updateStatus("请先粘贴一个外部网页 / Wiki 链接。");
    return;
  }

  const current = settings();
  current.bindings.push({
    id: makeId(),
    enabled: true,
    sourceType: "web",
    sourceUrl,
    title: hostFromUrl(sourceUrl),
    category: "外部网页"
  });
  input.value = "";
  clearContextPrompt(current);
  saveSettings();
  renderBindings();
  updateStatus(current.processorUrl ? `已绑定网页：${hostFromUrl(sourceUrl)}` : "已绑定网页；生成前需要先配置整理 API 地址。");
}

function promptKey(current) {
  return `${String(current.injectionOrder).padStart(4, "0")}${PROMPT_KEY_SUFFIX}`;
}

function clearContextPrompt(current = settings()) {
  const context = stContext();
  if (context.extensionPrompts) {
    for (const key of Object.keys(context.extensionPrompts)) {
      if (
        key === MODULE_NAME ||
        key === LEGACY_MODULE_NAME ||
        key === current.lastPromptKey ||
        key.endsWith(PROMPT_KEY_SUFFIX) ||
        key.endsWith(LEGACY_PROMPT_KEY_SUFFIX)
      ) {
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
  if (!host || document.querySelector("#external_lore_source_panel")) {
    return;
  }
  const current = settings();
  host.insertAdjacentHTML("beforeend", `
    <div id="external_lore_source_panel" class="external-lore-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>External Lore Source</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label">
            <input id="external_lore_source_enabled" type="checkbox" ${current.enabled ? "checked" : ""}>
            启用
          </label>

          <div class="external-lore-section">
            <div class="external-lore-section-title">整理 API</div>
            <label>
              API 地址
              <input id="external_lore_source_processor_url" class="text_pole" type="url" placeholder="https://api.example.com/lore/context" value="${escapeHtml(current.processorUrl)}">
            </label>
            <div class="external-lore-setting-grid">
              <label>
                API Key（可选）
                <input id="external_lore_source_processor_key" class="text_pole" type="password" autocomplete="off" value="${escapeHtml(current.processorApiKey)}">
              </label>
              <label>
                语言
                <input id="external_lore_source_language" class="text_pole" type="text" value="${escapeHtml(current.processorLanguage)}">
              </label>
              <label>
                预算 token
                <input id="external_lore_source_max_tokens" class="text_pole" type="number" min="100" max="200000" step="100" value="${current.maxTokens}">
              </label>
            </div>
            <div class="external-lore-help">
              外部网页 / Wiki 会交给这个 API 抓取、清洗和整理；插件只负责把返回的 lore 文本注入 SillyTavern。
            </div>
          </div>

          <div class="external-lore-section">
            <div class="external-lore-section-title">绑定来源</div>
            <label>
              OC Wiki 地址
              <input id="external_lore_source_oc_base_url" class="text_pole" type="url" placeholder="https://oc.example.com" value="${escapeHtml(current.ocWikiBaseUrl)}">
            </label>
            <label>
              OC Wiki 分享链接
              <textarea id="external_lore_source_oc_share_url" class="text_pole" rows="2" placeholder="粘贴 OC Wiki 分享链接，例如 ?share=...#entry=..."></textarea>
            </label>
            <label>
              外部网页 / Wiki 链接
              <textarea id="external_lore_source_url" class="text_pole" rows="2" placeholder="粘贴网页、MediaWiki、百科页面或资料站链接"></textarea>
            </label>
            <div class="external-lore-actions">
              <button id="external_lore_source_add_oc" type="button" class="menu_button">绑定 OC Wiki</button>
              <button id="external_lore_source_add_web" type="button" class="menu_button">绑定网页</button>
            </div>
          </div>

          <div class="external-lore-section">
            <div class="external-lore-section-title">注入设置</div>
            <div class="external-lore-setting-grid">
              <label>
                注入位置
                <select id="external_lore_source_injection_position" class="text_pole">
                  <option value="in_prompt" ${current.injectionPosition === "in_prompt" ? "selected" : ""}>主提示词内 / In Prompt</option>
                  <option value="before_prompt" ${current.injectionPosition === "before_prompt" ? "selected" : ""}>主提示词前 / Before Prompt</option>
                  <option value="in_chat" ${current.injectionPosition === "in_chat" ? "selected" : ""}>聊天中 / In Chat</option>
                  <option value="none" ${current.injectionPosition === "none" ? "selected" : ""}>不注入 / None</option>
                </select>
              </label>
              <label>
                深度
                <input id="external_lore_source_injection_depth" class="text_pole" type="number" min="0" max="10000" step="1" value="${current.injectionDepth}">
              </label>
              <label>
                角色
                <select id="external_lore_source_injection_role" class="text_pole">
                  <option value="system" ${current.injectionRole === "system" ? "selected" : ""}>系统 / System</option>
                  <option value="user" ${current.injectionRole === "user" ? "selected" : ""}>用户 / User</option>
                  <option value="assistant" ${current.injectionRole === "assistant" ? "selected" : ""}>助手 / Assistant</option>
                </select>
              </label>
              <label>
                注入顺序
                <input id="external_lore_source_injection_order" class="text_pole" type="number" min="0" max="9999" step="1" value="${current.injectionOrder}">
              </label>
            </div>
            <label class="checkbox_label external-lore-scan-toggle">
              <input id="external_lore_source_include_wi_scan" type="checkbox" ${current.includeInWorldInfoScan ? "checked" : ""}>
              参与世界书扫描
            </label>
            <div class="external-lore-help">
              使用 SillyTavern 原生扩展提示词注入。位置、深度、角色与酒馆的 Author's Note / Memory 类扩展一致；顺序会写入 prompt key，数值越小越靠前。
            </div>
          </div>

          <div class="external-lore-actions">
            <button id="external_lore_source_test" type="button" class="menu_button">测试上下文</button>
          </div>
          <div id="external_lore_source_status" class="external-lore-status">待命 · v${EXTENSION_VERSION}</div>
          <div id="external_lore_source_bindings" class="external-lore-bindings"></div>
        </div>
      </div>
    </div>
  `);

  document.querySelector("#external_lore_source_enabled")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.enabled = Boolean(event.target.checked);
    if (!currentSettings.enabled) {
      clearContextPrompt(currentSettings);
    }
    saveSettings();
  });
  document.querySelector("#external_lore_source_oc_base_url")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.ocWikiBaseUrl = normalizeBaseUrl(event.target.value);
    currentSettings.baseUrl = currentSettings.ocWikiBaseUrl;
    saveSettings();
  });
  document.querySelector("#external_lore_source_processor_url")?.addEventListener("input", (event) => {
    settings().processorUrl = normalizeProcessorUrl(event.target.value);
    saveSettings();
  });
  document.querySelector("#external_lore_source_processor_key")?.addEventListener("input", (event) => {
    settings().processorApiKey = String(event.target.value || "");
    saveSettings();
  });
  document.querySelector("#external_lore_source_language")?.addEventListener("input", (event) => {
    settings().processorLanguage = String(event.target.value || DEFAULT_SETTINGS.processorLanguage).trim() || DEFAULT_SETTINGS.processorLanguage;
    saveSettings();
  });
  document.querySelector("#external_lore_source_max_tokens")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.maxTokens = clampInteger(event.target.value, DEFAULT_SETTINGS.maxTokens, 100, 200000);
    event.target.value = currentSettings.maxTokens;
    saveSettings();
  });
  document.querySelector("#external_lore_source_injection_position")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.injectionPosition = hasOwn(EXTENSION_PROMPT_TYPES, event.target.value) ? event.target.value : DEFAULT_SETTINGS.injectionPosition;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#external_lore_source_injection_depth")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.injectionDepth = clampInteger(event.target.value, DEFAULT_SETTINGS.injectionDepth, 0, 10000);
    event.target.value = currentSettings.injectionDepth;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#external_lore_source_injection_role")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.injectionRole = hasOwn(EXTENSION_PROMPT_ROLES, event.target.value) ? event.target.value : DEFAULT_SETTINGS.injectionRole;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#external_lore_source_injection_order")?.addEventListener("input", (event) => {
    const currentSettings = settings();
    currentSettings.injectionOrder = clampInteger(event.target.value, DEFAULT_SETTINGS.injectionOrder, 0, 9999);
    event.target.value = currentSettings.injectionOrder;
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#external_lore_source_include_wi_scan")?.addEventListener("change", (event) => {
    const currentSettings = settings();
    currentSettings.includeInWorldInfoScan = Boolean(event.target.checked);
    clearContextPrompt(currentSettings);
    saveSettings();
  });
  document.querySelector("#external_lore_source_add_oc")?.addEventListener("click", addOcWikiBindingFromInput);
  document.querySelector("#external_lore_source_add_web")?.addEventListener("click", addExternalSourceFromInput);
  document.querySelector("#external_lore_source_test")?.addEventListener("click", async () => {
    try {
      const prompt = await fetchContext();
      updateStatus(prompt ? `上下文已读取：${prompt.length} 字符` : "没有可注入的上下文。");
    } catch (error) {
      updateStatus(`上下文读取失败：${error.message}`);
    }
  });
  document.querySelector("#external_lore_source_bindings")?.addEventListener("click", (event) => {
    const row = event.target.closest(".external-lore-binding");
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

async function externalLoreSourceGenerateInterceptor(chat) {
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
    updateStatus(`已注册 ${prompt.length} 字符：${insertedAt}${lastContextNotice}`);
  } catch (error) {
    clearContextPrompt(current);
    updateStatus(`已跳过注入：${error.message}`);
  }
  return chat;
}

globalThis.externalLoreSourceGenerateInterceptor = externalLoreSourceGenerateInterceptor;
globalThis.ocWikiWorldbookGenerateInterceptor = externalLoreSourceGenerateInterceptor;

jQuery(renderSettings);
