const LEGACY_MODULE_NAME = "oc-wiki-worldbook";
const MODULE_NAME = "external-lore-source";
const EXTENSION_VERSION = "0.4.5";
const PROMPT_KEY_SUFFIX = `_${MODULE_NAME}`;
const LEGACY_PROMPT_KEY_SUFFIX = `_${LEGACY_MODULE_NAME}`;

const DEFAULT_SETTINGS = {
  enabled: true,
  ocWikiBaseUrl: "",
  processorMode: "external",
  processorUrl: "",
  processorApiKey: "",
  processorModelsUrl: "",
  processorModel: "",
  processorLanguage: "zh-CN",
  maxTokens: 2000,
  availableModels: [],
  lastProcessorStatus: "",
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

const PROCESSOR_MODES = Object.freeze({
  external: "第三方整理 API",
  tavern: "酒馆主 API"
});

let lastContextNotice = "";
let worldbookLauncherObserver = null;
let settingsModalKeydownBound = false;

function stContext() {
  return globalThis.SillyTavern?.getContext?.() || {};
}

function tavernHelperGenerateRaw() {
  return globalThis.TavernHelper?.generateRaw;
}

function hasTavernMainGeneration() {
  return typeof tavernHelperGenerateRaw() === "function" || typeof stContext().generateRaw === "function";
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
  current.processorMode = hasOwn(PROCESSOR_MODES, current.processorMode) ? current.processorMode : DEFAULT_SETTINGS.processorMode;
  current.processorUrl = normalizeProcessorUrl(current.processorUrl);
  current.processorApiKey = String(current.processorApiKey || "");
  current.processorModelsUrl = normalizeProcessorUrl(current.processorModelsUrl);
  current.processorModel = String(current.processorModel || "").trim();
  current.processorLanguage = String(current.processorLanguage || DEFAULT_SETTINGS.processorLanguage).trim() || DEFAULT_SETTINGS.processorLanguage;
  current.availableModels = Array.isArray(current.availableModels)
    ? [...new Set(current.availableModels.map((model) => String(model || "").trim()).filter(Boolean))]
    : [];
  current.lastProcessorStatus = String(current.lastProcessorStatus || "");

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

function rawTextFromProcessorData(data) {
  const direct = data?.raw ?? data?.rawText ?? data?.sourceText ?? data?.markdown ?? data?.html ?? data?.content ?? data?.text;
  if (direct) {
    return String(direct).trim();
  }
  if (!Array.isArray(data?.entries)) {
    return "";
  }
  return data.entries
    .map((entry) => {
      const body = entry?.raw ?? entry?.rawText ?? entry?.sourceText ?? entry?.content ?? entry?.summary ?? entry?.text ?? "";
      if (!body) {
        return "";
      }
      return entry?.title ? `### ${entry.title}\n${body}` : String(body);
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function processorHeaders(current) {
  const headers = { "Content-Type": "application/json" };
  if (current.processorApiKey) {
    headers.Authorization = `Bearer ${current.processorApiKey}`;
  }
  return headers;
}

function tavernModelInfo() {
  const context = stContext();
  const mainApi = String(context.mainApi || "unknown");
  let model = "";
  try {
    model = String(context.getChatCompletionModel?.() || "");
  } catch {
    model = "";
  }
  if (!model) {
    const chatSettings = context.chatCompletionSettings || {};
    model = String(
      chatSettings.model ||
      chatSettings.openai_model ||
      chatSettings.chat_completion_model ||
      chatSettings.custom_model ||
      chatSettings.reverse_proxy_model ||
      ""
    );
  }
  return {
    mainApi,
    model: model || (mainApi === "openai" ? "当前聊天补全模型" : "当前主 API 模型")
  };
}

function processorPayload(current, bindings, extraOptions = {}) {
  const tavern = tavernModelInfo();
  const options = {
    language: current.processorLanguage,
    format: "sillytavern_lore",
    maxTokens: current.maxTokens,
    mode: current.processorMode,
    modelProvider: current.processorMode === "tavern" ? "sillytavern" : "external",
    task: current.processorMode === "tavern" ? "extract" : "summarize",
    ...extraOptions
  };
  if (current.processorMode === "external" && current.processorModel) {
    options.model = current.processorModel;
  }
  if (current.processorMode === "tavern") {
    options.tavern = {
      mainApi: tavern.mainApi,
      model: tavern.model
    };
  }
  return {
    sources: bindings.map(externalSourcePayload),
    options,
    client: {
      name: "External Lore Source",
      version: EXTENSION_VERSION
    }
  };
}

function suggestedModelsUrl(processorUrl) {
  try {
    const url = new URL(processorUrl, window.location.origin);
    return `${url.origin}/v1/models`;
  } catch {
    return "";
  }
}

function normalizeModelList(data) {
  const candidates = Array.isArray(data)
    ? data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.data)
        ? data.data
        : [];
  return [...new Set(candidates
    .map((item) => String(item?.id || item?.name || item?.model || item || "").trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

async function fetchExternalModels(current = settings()) {
  const modelsUrl = normalizeProcessorUrl(current.processorModelsUrl) || suggestedModelsUrl(current.processorUrl);
  if (!modelsUrl) {
    throw new Error("请先填写模型列表 API，或填写可推导 /v1/models 的整理 API 地址。");
  }
  const response = await fetch(modelsUrl, {
    method: "GET",
    headers: processorHeaders(current)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `模型列表 API returned ${response.status}`);
  }
  const models = normalizeModelList(data);
  if (!models.length) {
    throw new Error("模型列表为空，返回值需要是数组、{ models: [...] } 或 OpenAI 风格 { data: [{ id }] }。");
  }
  return models;
}

async function testProcessorConnection(current = settings()) {
  if (current.processorMode === "tavern") {
    if (!hasTavernMainGeneration()) {
      throw new Error("当前 SillyTavern 未暴露 TavernHelper.generateRaw 或 generateRaw，无法使用酒馆主 API 整理。");
    }
    const processorUrl = normalizeProcessorUrl(current.processorUrl);
    if (!processorUrl) {
      throw new Error("请先填写抓取 API 地址；酒馆主 API 负责整理，网页抓取仍需要外部服务。");
    }
    const response = await fetch(processorUrl, {
      method: "POST",
      headers: processorHeaders(current),
      body: JSON.stringify(processorPayload(current, [], { test: true, dryRun: true }))
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { text };
    }
    if (!response.ok) {
      throw new Error(data.error || data.message || text || `抓取 API returned ${response.status}`);
    }
    const tavern = tavernModelInfo();
    return `酒馆主 API 可用：${tavern.mainApi} / ${tavern.model}；抓取服务连接正常。`;
  }

  const processorUrl = normalizeProcessorUrl(current.processorUrl);
  if (!processorUrl) {
    throw new Error("请先填写第三方整理 API 地址。");
  }
  const response = await fetch(processorUrl, {
    method: "POST",
    headers: processorHeaders(current),
    body: JSON.stringify(processorPayload(current, [], { test: true, dryRun: true }))
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
  return data.message || data.status || "第三方整理 API 连接正常。";
}

async function generateWithTavernMainApi(systemPrompt, prompt, responseLength) {
  const maxTokens = Math.min(Number(responseLength) || DEFAULT_SETTINGS.maxTokens, 12000);
  const helperGenerateRaw = tavernHelperGenerateRaw();
  if (typeof helperGenerateRaw === "function") {
    return String(await helperGenerateRaw.call(globalThis.TavernHelper, {
      user_input: "",
      ordered_prompts: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      overrides: {
        world_info_before: "",
        world_info_after: "",
        persona_description: "",
        char_description: "",
        char_personality: "",
        scenario: "",
        dialogue_examples: "",
        chat_history: { prompts: [], with_depth_entries: false, author_note: "" }
      },
      injects: [],
      max_chat_history: 0,
      should_stream: true
    })).trim();
  }

  const context = stContext();
  if (typeof context.generateRaw === "function") {
    return String(await context.generateRaw({
      prompt: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      responseLength: maxTokens
    })).trim();
  }

  throw new Error("当前 SillyTavern 未暴露 TavernHelper.generateRaw 或 generateRaw，无法使用酒馆主 API 整理。");
}

async function summarizeWithTavernMainApi(current, data, bindings) {
  if (!hasTavernMainGeneration()) {
    throw new Error("当前 SillyTavern 未暴露 TavernHelper.generateRaw 或 generateRaw，无法使用酒馆主 API 整理。");
  }
  const rawText = rawTextFromProcessorData(data);
  if (!rawText) {
    const readyPrompt = promptFromProcessorData(data);
    if (readyPrompt) {
      return readyPrompt;
    }
    throw new Error("抓取 API 没有返回可交给酒馆主 API 整理的 raw、rawText、sourceText、content、text 或 entries 内容。");
  }
  const sourceList = bindings
    .map((binding) => `- ${binding.title || hostFromUrl(binding.sourceUrl)}：${binding.sourceUrl}`)
    .join("\n");
  const systemPrompt = [
    "你是 SillyTavern 外置世界书整理器。",
    "请把用户提供的外部资料压缩为可直接注入对话的 lore 上下文。",
    "保留实体、关系、设定、规则、地点、时间线和重要专有名词；删除网页导航、广告、重复段落和无关说明。",
    "输出中文，使用清晰短段落；不要写分析过程。"
  ].join("\n");
  const prompt = [
    `语言：${current.processorLanguage}`,
    `来源：\n${sourceList}`,
    "原文：",
    rawText
  ].join("\n\n");
  return generateWithTavernMainApi(systemPrompt, prompt, current.maxTokens);
}

async function fetchExternalContext(current, bindings) {
  const processorUrl = normalizeProcessorUrl(current.processorUrl);
  if (!processorUrl) {
    throw new Error("有外部网页 / Wiki 来源，但还没有配置整理 API 地址。");
  }

  const response = await fetch(processorUrl, {
    method: "POST",
    headers: processorHeaders(current),
    body: JSON.stringify(processorPayload(current, bindings))
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

  const prompt = current.processorMode === "tavern"
    ? await summarizeWithTavernMainApi(current, data, bindings)
    : promptFromProcessorData(data);
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
  const baseInput = document.querySelector("#external_lore_source_oc_base_url");
  if (baseInput) {
    current.ocWikiBaseUrl = normalizeBaseUrl(baseInput.value);
    current.baseUrl = current.ocWikiBaseUrl;
  }
  const baseUrl = normalizeBaseUrl(current.ocWikiBaseUrl || parsed.baseUrl);
  if (!current.ocWikiBaseUrl && parsed.baseUrl) {
    current.ocWikiBaseUrl = parsed.baseUrl;
    current.baseUrl = parsed.baseUrl;
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
    renderPanelSummary();
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
  renderPanelSummary();
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

function processorModeLabel(current = settings()) {
  return PROCESSOR_MODES[current.processorMode] || PROCESSOR_MODES.external;
}

function processorModelLabel(current = settings()) {
  if (current.processorMode === "tavern") {
    const tavern = tavernModelInfo();
    return `${tavern.mainApi} / ${tavern.model}`;
  }
  return current.processorModel || "未选择模型";
}

function processorEndpointLabel(current = settings()) {
  if (current.processorMode === "tavern") {
    return current.processorUrl ? `抓取服务：${hostFromUrl(current.processorUrl)}` : "需要抓取服务返回网页原文";
  }
  return current.processorUrl ? hostFromUrl(current.processorUrl) : "未配置 API 地址";
}

function renderPanelSummary() {
  const current = settings();
  const summary = document.querySelector("#external_lore_source_panel_summary");
  if (summary) {
    const enabledCount = current.bindings.filter((binding) => binding.enabled !== false).length;
    summary.textContent = `${processorModeLabel(current)} · ${enabledCount} 个启用来源 · ${injectionSummary(current)}`;
  }
}

function setModalStatus(text, type = "neutral") {
  const node = document.querySelector("#external_lore_source_api_modal_status");
  if (!node) {
    return;
  }
  node.textContent = text;
  node.dataset.type = type;
}

function setSettingsModalOpen(open) {
  const modal = open ? ensureSettingsModal() : document.querySelector("#external_lore_source_api_modal");
  if (!modal) {
    return;
  }
  modal.classList.toggle("is-open", open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    populateSettingsModal();
    document.querySelector("#external_lore_source_processor_mode_external")?.focus();
  }
}

function worldbookLauncherHost() {
  const toolbarButton = document.querySelector("#world_popup_new, #world_refresh");
  if (toolbarButton?.parentElement) {
    return toolbarButton.parentElement;
  }

  const editorSelect = document.querySelector("#world_editor_select");
  if (editorSelect?.parentElement) {
    return editorSelect.parentElement;
  }

  const worldPanel = document.querySelector("#WorldInfo");
  const titledHeader = [...document.querySelectorAll("#WorldInfo .inline-drawer-header, #WorldInfo .drawer-header, #WorldInfo h3, #WorldInfo h4")]
    .find((node) => /世界书|World Info|Lorebook/i.test(node.textContent || ""));
  if (titledHeader) {
    return titledHeader;
  }

  const drawerIcon = document.querySelector("#WIDrawerIcon");
  const header = drawerIcon?.closest(".inline-drawer-header, .inline-drawer-toggle, .drawer-header, .flex-container");
  if (header && (!worldPanel || worldPanel.contains(header) || header.contains(drawerIcon))) {
    return header;
  }

  return null;
}

function installWorldbookLauncher() {
  const existing = document.querySelector("#external_lore_source_worldbook_button");
  const host = worldbookLauncherHost();
  if (!host) {
    return;
  }
  if (existing?.dataset.version === EXTENSION_VERSION) {
    if (existing.parentElement !== host) {
      host.append(existing);
    }
    return;
  }
  existing?.remove();

  const button = document.createElement("button");
  button.id = "external_lore_source_worldbook_button";
  button.type = "button";
  button.className = "menu_button external-lore-worldbook-button";
  button.dataset.version = EXTENSION_VERSION;
  button.title = "打开 External Lore Source 设置";
  button.setAttribute("aria-label", "打开 External Lore Source 设置");
  button.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i><span>外置 Lore</span>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSettingsModalOpen(true);
  });
  host.append(button);
}

function startWorldbookLauncherObserver() {
  installWorldbookLauncher();
  if (worldbookLauncherObserver || !document.body) {
    return;
  }
  worldbookLauncherObserver = new MutationObserver(() => installWorldbookLauncher());
  worldbookLauncherObserver.observe(document.body, { childList: true, subtree: true });
}

function renderExternalModelList(models, selected) {
  const list = document.querySelector("#external_lore_source_model_list");
  const input = document.querySelector("#external_lore_source_processor_model");
  if (!list || !input) {
    return;
  }
  const normalized = [...new Set([selected, ...models].map((model) => String(model || "").trim()).filter(Boolean))];
  list.innerHTML = normalized.map((model) => `<option value="${escapeHtml(model)}"></option>`).join("");
  input.value = selected || "";
}

function populateSettingsModal() {
  const current = settings();
  const externalRadio = document.querySelector("#external_lore_source_processor_mode_external");
  const tavernRadio = document.querySelector("#external_lore_source_processor_mode_tavern");
  if (externalRadio) {
    externalRadio.checked = current.processorMode === "external";
  }
  if (tavernRadio) {
    tavernRadio.checked = current.processorMode === "tavern";
  }
  const fields = {
    "#external_lore_source_processor_url": current.processorUrl,
    "#external_lore_source_processor_key": current.processorApiKey,
    "#external_lore_source_processor_models_url": current.processorModelsUrl,
    "#external_lore_source_language": current.processorLanguage,
    "#external_lore_source_max_tokens": current.maxTokens,
    "#external_lore_source_oc_base_url": current.ocWikiBaseUrl,
    "#external_lore_source_injection_depth": current.injectionDepth,
    "#external_lore_source_injection_order": current.injectionOrder
  };
  for (const [selector, value] of Object.entries(fields)) {
    const node = document.querySelector(selector);
    if (node) {
      node.value = value;
    }
  }
  const injectionPosition = document.querySelector("#external_lore_source_injection_position");
  const injectionRole = document.querySelector("#external_lore_source_injection_role");
  const includeWiScan = document.querySelector("#external_lore_source_include_wi_scan");
  if (injectionPosition) {
    injectionPosition.value = current.injectionPosition;
  }
  if (injectionRole) {
    injectionRole.value = current.injectionRole;
  }
  if (includeWiScan) {
    includeWiScan.checked = current.includeInWorldInfoScan;
  }
  renderExternalModelList(current.availableModels, current.processorModel);
  const tavern = tavernModelInfo();
  const tavernMainApi = document.querySelector("#external_lore_source_tavern_main_api");
  const tavernModel = document.querySelector("#external_lore_source_tavern_model");
  if (tavernMainApi) {
    tavernMainApi.value = tavern.mainApi;
  }
  if (tavernModel) {
    tavernModel.value = tavern.model;
  }
  renderBindings();
  updateProcessorModePanels();
  setModalStatus(current.lastProcessorStatus || "配置后点击保存，测试连接不会自动保存草稿。");
}

function updateProcessorModePanels() {
  const mode = document.querySelector("#external_lore_source_processor_mode_tavern")?.checked ? "tavern" : "external";
  for (const panel of document.querySelectorAll("[data-processor-panel]")) {
    panel.hidden = panel.dataset.processorPanel !== mode;
  }
}

function saveSettingsModal() {
  const current = settings();
  const previousInjection = {
    position: current.injectionPosition,
    depth: current.injectionDepth,
    role: current.injectionRole,
    order: current.injectionOrder,
    includeInWorldInfoScan: current.includeInWorldInfoScan
  };
  current.processorMode = document.querySelector("#external_lore_source_processor_mode_tavern")?.checked ? "tavern" : "external";
  current.processorUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_url")?.value);
  current.processorApiKey = String(document.querySelector("#external_lore_source_processor_key")?.value || "");
  current.processorModelsUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_models_url")?.value);
  current.processorModel = String(document.querySelector("#external_lore_source_processor_model")?.value || "").trim();
  current.processorLanguage = String(document.querySelector("#external_lore_source_language")?.value || DEFAULT_SETTINGS.processorLanguage).trim() || DEFAULT_SETTINGS.processorLanguage;
  current.maxTokens = clampInteger(document.querySelector("#external_lore_source_max_tokens")?.value, DEFAULT_SETTINGS.maxTokens, 100, 200000);
  current.ocWikiBaseUrl = normalizeBaseUrl(document.querySelector("#external_lore_source_oc_base_url")?.value);
  current.baseUrl = current.ocWikiBaseUrl;
  const injectionPosition = document.querySelector("#external_lore_source_injection_position")?.value;
  const injectionRole = document.querySelector("#external_lore_source_injection_role")?.value;
  current.injectionPosition = hasOwn(EXTENSION_PROMPT_TYPES, injectionPosition) ? injectionPosition : DEFAULT_SETTINGS.injectionPosition;
  current.injectionDepth = clampInteger(document.querySelector("#external_lore_source_injection_depth")?.value, DEFAULT_SETTINGS.injectionDepth, 0, 10000);
  current.injectionRole = hasOwn(EXTENSION_PROMPT_ROLES, injectionRole) ? injectionRole : DEFAULT_SETTINGS.injectionRole;
  current.injectionOrder = clampInteger(document.querySelector("#external_lore_source_injection_order")?.value, DEFAULT_SETTINGS.injectionOrder, 0, 9999);
  current.includeInWorldInfoScan = Boolean(document.querySelector("#external_lore_source_include_wi_scan")?.checked);
  if (
    previousInjection.position !== current.injectionPosition ||
    previousInjection.depth !== current.injectionDepth ||
    previousInjection.role !== current.injectionRole ||
    previousInjection.order !== current.injectionOrder ||
    previousInjection.includeInWorldInfoScan !== current.includeInWorldInfoScan
  ) {
    clearContextPrompt(current);
  }
  const models = normalizeModelList(current.availableModels);
  if (current.processorModel && !models.includes(current.processorModel)) {
    models.unshift(current.processorModel);
  }
  current.availableModels = models;
  saveSettings();
  renderPanelSummary();
  setSettingsModalOpen(false);
  updateStatus("External Lore Source 设置已保存。");
}

async function handleFetchModels() {
  const current = settings();
  current.processorUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_url")?.value);
  current.processorApiKey = String(document.querySelector("#external_lore_source_processor_key")?.value || "");
  current.processorModelsUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_models_url")?.value);
  setModalStatus("正在获取模型列表...");
  try {
    const models = await fetchExternalModels(current);
    current.availableModels = models;
    if (!current.processorModel && models.length) {
      current.processorModel = models[0];
    }
    renderExternalModelList(models, current.processorModel);
    saveSettings();
    setModalStatus(`已获取 ${models.length} 个模型。`, "success");
    renderPanelSummary();
  } catch (error) {
    setModalStatus(`获取失败：${error.message}`, "error");
  }
}

async function handleTestProcessor() {
  const current = settings();
  current.processorMode = document.querySelector("#external_lore_source_processor_mode_tavern")?.checked ? "tavern" : "external";
  current.processorUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_url")?.value);
  current.processorApiKey = String(document.querySelector("#external_lore_source_processor_key")?.value || "");
  current.processorModelsUrl = normalizeProcessorUrl(document.querySelector("#external_lore_source_processor_models_url")?.value);
  current.processorModel = String(document.querySelector("#external_lore_source_processor_model")?.value || "").trim();
  current.processorLanguage = String(document.querySelector("#external_lore_source_language")?.value || DEFAULT_SETTINGS.processorLanguage).trim() || DEFAULT_SETTINGS.processorLanguage;
  current.maxTokens = clampInteger(document.querySelector("#external_lore_source_max_tokens")?.value, DEFAULT_SETTINGS.maxTokens, 100, 200000);
  setModalStatus("正在测试连接...");
  try {
    const message = await testProcessorConnection(current);
    current.lastProcessorStatus = `${message}`;
    saveSettings();
    setModalStatus(current.lastProcessorStatus, "success");
    renderPanelSummary();
  } catch (error) {
    current.lastProcessorStatus = `测试失败：${error.message}`;
    saveSettings();
    setModalStatus(current.lastProcessorStatus, "error");
    renderPanelSummary();
  }
}

function settingsModalMarkup() {
  return `
    <div id="external_lore_source_api_modal" class="external-lore-modal" aria-hidden="true">
      <div class="external-lore-modal-backdrop" data-modal-close></div>
      <div class="external-lore-dialog" role="dialog" aria-modal="true" aria-labelledby="external_lore_source_api_modal_title">
        <div class="external-lore-dialog-header">
          <div>
            <div id="external_lore_source_api_modal_title" class="external-lore-dialog-title">External Lore Source 设置</div>
            <div class="external-lore-dialog-subtitle">管理来源绑定、整理 API 和注入顺序。</div>
          </div>
          <button type="button" class="menu_button external-lore-icon-button" data-modal-close aria-label="关闭">×</button>
        </div>

        <div class="external-lore-modal-body">
          <div class="external-lore-modal-section">
            <div class="external-lore-section-title">来源绑定</div>
            <div class="external-lore-form-grid">
              <label>
                OC Wiki 地址
                <input id="external_lore_source_oc_base_url" class="text_pole" type="url" placeholder="https://oc.example.com">
              </label>
              <label>
                OC Wiki 分享链接
                <textarea id="external_lore_source_oc_share_url" class="text_pole" rows="2" placeholder="粘贴 OC Wiki 分享链接，例如 ?share=...#entry=..."></textarea>
              </label>
              <label class="external-lore-full-row">
                外部网页 / Wiki 链接
                <textarea id="external_lore_source_url" class="text_pole" rows="2" placeholder="粘贴网页、MediaWiki、百科页面或资料站链接"></textarea>
              </label>
            </div>
            <div class="external-lore-actions">
              <button id="external_lore_source_add_oc" type="button" class="menu_button">绑定 OC Wiki</button>
              <button id="external_lore_source_add_web" type="button" class="menu_button">绑定网页</button>
            </div>
            <div id="external_lore_source_bindings" class="external-lore-bindings"></div>
          </div>

          <div class="external-lore-modal-section">
            <div class="external-lore-section-title">整理 API</div>
            <div class="external-lore-mode-switch" role="radiogroup" aria-label="整理方式">
              <label class="checkbox_label">
                <input id="external_lore_source_processor_mode_external" type="radio" name="external_lore_source_processor_mode" value="external">
                第三方整理 API
              </label>
              <label class="checkbox_label">
                <input id="external_lore_source_processor_mode_tavern" type="radio" name="external_lore_source_processor_mode" value="tavern">
                酒馆主 API
              </label>
            </div>
            <div class="external-lore-form-grid">
              <label>
                整理 / 抓取 API 地址
                <input id="external_lore_source_processor_url" class="text_pole" type="url" placeholder="https://api.example.com/lore/context">
              </label>
              <label>
                API Key（可选）
                <input id="external_lore_source_processor_key" class="text_pole" type="password" autocomplete="off">
              </label>
              <label>
                语言
                <input id="external_lore_source_language" class="text_pole" type="text" placeholder="zh-CN">
              </label>
              <label>
                预算 token
                <input id="external_lore_source_max_tokens" class="text_pole" type="number" min="100" max="200000" step="100">
              </label>
            </div>

            <div data-processor-panel="external" class="external-lore-processor-panel">
              <div class="external-lore-form-grid">
                <label>
                  模型列表 API（可选）
                  <input id="external_lore_source_processor_models_url" class="text_pole" type="url" placeholder="留空时尝试 /v1/models">
                </label>
                <label>
                  使用模型
                  <input id="external_lore_source_processor_model" class="text_pole" type="text" list="external_lore_source_model_list" placeholder="手动输入或获取模型">
                  <datalist id="external_lore_source_model_list"></datalist>
                </label>
              </div>
            </div>

            <div data-processor-panel="tavern" class="external-lore-processor-panel" hidden>
              <div class="external-lore-form-grid">
                <label>
                  当前 API
                  <input id="external_lore_source_tavern_main_api" class="text_pole" type="text" readonly>
                </label>
                <label>
                  当前模型
                  <input id="external_lore_source_tavern_model" class="text_pole" type="text" readonly>
                </label>
              </div>
              <div class="external-lore-help">这个模式仍需要上面的抓取 API 返回网页原文；插件再调用 SillyTavern 的 <code>generateRaw</code> 整理成 lore。</div>
            </div>
          </div>

          <div class="external-lore-modal-section">
            <div class="external-lore-section-title">注入设置</div>
            <div class="external-lore-form-grid">
              <label>
                注入位置
                <select id="external_lore_source_injection_position" class="text_pole">
                  <option value="in_prompt">主提示词内 / In Prompt</option>
                  <option value="before_prompt">主提示词前 / Before Prompt</option>
                  <option value="in_chat">聊天中 / In Chat</option>
                  <option value="none">不注入 / None</option>
                </select>
              </label>
              <label>
                深度
                <input id="external_lore_source_injection_depth" class="text_pole" type="number" min="0" max="10000" step="1">
              </label>
              <label>
                角色
                <select id="external_lore_source_injection_role" class="text_pole">
                  <option value="system">系统 / System</option>
                  <option value="user">用户 / User</option>
                  <option value="assistant">助手 / Assistant</option>
                </select>
              </label>
              <label>
                注入顺序
                <input id="external_lore_source_injection_order" class="text_pole" type="number" min="0" max="9999" step="1">
              </label>
            </div>
            <label class="checkbox_label external-lore-scan-toggle">
              <input id="external_lore_source_include_wi_scan" type="checkbox">
              参与世界书扫描
            </label>
            <div class="external-lore-help">使用 SillyTavern 原生扩展提示词注入。位置、深度、角色与酒馆的 Author's Note / Memory 类扩展一致；顺序会写入 prompt key，数值越小越靠前。</div>
          </div>
        </div>

        <div id="external_lore_source_api_modal_status" class="external-lore-modal-status" data-type="neutral">配置后点击保存。</div>

        <div class="external-lore-dialog-actions">
          <div class="external-lore-dialog-action-group">
            <button id="external_lore_source_test" type="button" class="menu_button">测试上下文</button>
            <button id="external_lore_source_fetch_models" type="button" class="menu_button">获取模型</button>
            <button id="external_lore_source_test_api" type="button" class="menu_button">测试连接</button>
          </div>
          <div class="external-lore-dialog-action-group external-lore-dialog-action-group-primary">
            <button type="button" class="menu_button" data-modal-close>取消</button>
            <button id="external_lore_source_save_settings" type="button" class="menu_button">保存设置</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindSettingsModalEvents(modal) {
  if (!modal || modal.dataset.boundVersion === EXTENSION_VERSION) {
    return;
  }
  modal.dataset.boundVersion = EXTENSION_VERSION;
  modal.querySelector("#external_lore_source_add_oc")?.addEventListener("click", addOcWikiBindingFromInput);
  modal.querySelector("#external_lore_source_add_web")?.addEventListener("click", addExternalSourceFromInput);
  modal.querySelector("#external_lore_source_save_settings")?.addEventListener("click", saveSettingsModal);
  modal.querySelector("#external_lore_source_fetch_models")?.addEventListener("click", handleFetchModels);
  modal.querySelector("#external_lore_source_test_api")?.addEventListener("click", handleTestProcessor);
  modal.querySelectorAll("[name='external_lore_source_processor_mode']").forEach((node) => {
    node.addEventListener("change", updateProcessorModePanels);
  });
  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      setSettingsModalOpen(false);
    }
  });
  modal.querySelector("#external_lore_source_test")?.addEventListener("click", async () => {
    try {
      const prompt = await fetchContext();
      updateStatus(prompt ? `上下文已读取：${prompt.length} 字符` : "没有可注入的上下文。");
    } catch (error) {
      updateStatus(`上下文读取失败：${error.message}`);
    }
  });
  modal.querySelector("#external_lore_source_bindings")?.addEventListener("click", (event) => {
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
    renderPanelSummary();
  });
  if (!settingsModalKeydownBound) {
    settingsModalKeydownBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.querySelector("#external_lore_source_api_modal")?.classList.contains("is-open")) {
        setSettingsModalOpen(false);
      }
    });
  }
}

function ensureSettingsModal() {
  const modals = [...document.querySelectorAll("#external_lore_source_api_modal")];
  let modal = modals.find((node) => node.dataset.version === EXTENSION_VERSION) || null;
  for (const node of modals) {
    if (node !== modal) {
      node.remove();
    }
  }
  if (!modal) {
    document.body?.insertAdjacentHTML("beforeend", settingsModalMarkup());
    modal = document.querySelector("#external_lore_source_api_modal");
    if (modal) {
      modal.dataset.version = EXTENSION_VERSION;
    }
  }
  bindSettingsModalEvents(modal);
  return modal;
}

function renderSettings() {
  ensureSettingsModal();
  startWorldbookLauncherObserver();
  const host = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
  if (!host) {
    return;
  }
  const existingPanel = document.querySelector("#external_lore_source_panel");
  if (existingPanel?.dataset.version === EXTENSION_VERSION) {
    startWorldbookLauncherObserver();
    return;
  }
  existingPanel?.remove();
  const current = settings();
  host.insertAdjacentHTML("beforeend", `
    <div id="external_lore_source_panel" class="external-lore-panel" data-version="${EXTENSION_VERSION}">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>External Lore Source</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div class="external-lore-panel-row">
            <label class="checkbox_label external-lore-enabled">
              <input id="external_lore_source_enabled" type="checkbox" ${current.enabled ? "checked" : ""}>
              启用
            </label>
            <button id="external_lore_source_open_settings" type="button" class="menu_button">打开设置</button>
          </div>
          <div id="external_lore_source_panel_summary" class="external-lore-panel-summary">
            ${escapeHtml(`${processorModeLabel(current)} · ${current.bindings.filter((binding) => binding.enabled !== false).length} 个启用来源 · ${injectionSummary(current)}`)}
          </div>
          <div id="external_lore_source_status" class="external-lore-status">待命 · v${EXTENSION_VERSION}</div>
        </div>
      </div>

      <div id="external_lore_source_api_modal" class="external-lore-modal" aria-hidden="true">
        <div class="external-lore-modal-backdrop" data-modal-close></div>
        <div class="external-lore-dialog" role="dialog" aria-modal="true" aria-labelledby="external_lore_source_api_modal_title">
          <div class="external-lore-dialog-header">
            <div>
              <div id="external_lore_source_api_modal_title" class="external-lore-dialog-title">External Lore Source 设置</div>
              <div class="external-lore-dialog-subtitle">管理来源绑定、整理 API 和注入顺序。</div>
            </div>
            <button type="button" class="menu_button external-lore-icon-button" data-modal-close aria-label="关闭">×</button>
          </div>

          <div class="external-lore-modal-body">
            <div class="external-lore-modal-section">
              <div class="external-lore-section-title">来源绑定</div>
              <div class="external-lore-form-grid">
                <label>
                  OC Wiki 地址
                  <input id="external_lore_source_oc_base_url" class="text_pole" type="url" placeholder="https://oc.example.com">
                </label>
                <label>
                  OC Wiki 分享链接
                  <textarea id="external_lore_source_oc_share_url" class="text_pole" rows="2" placeholder="粘贴 OC Wiki 分享链接，例如 ?share=...#entry=..."></textarea>
                </label>
                <label class="external-lore-full-row">
                  外部网页 / Wiki 链接
                  <textarea id="external_lore_source_url" class="text_pole" rows="2" placeholder="粘贴网页、MediaWiki、百科页面或资料站链接"></textarea>
                </label>
              </div>
              <div class="external-lore-actions">
                <button id="external_lore_source_add_oc" type="button" class="menu_button">绑定 OC Wiki</button>
                <button id="external_lore_source_add_web" type="button" class="menu_button">绑定网页</button>
              </div>
              <div id="external_lore_source_bindings" class="external-lore-bindings"></div>
            </div>

            <div class="external-lore-modal-section">
              <div class="external-lore-section-title">整理 API</div>
              <div class="external-lore-mode-switch" role="radiogroup" aria-label="整理方式">
                <label class="checkbox_label">
                  <input id="external_lore_source_processor_mode_external" type="radio" name="external_lore_source_processor_mode" value="external">
                  第三方整理 API
                </label>
                <label class="checkbox_label">
                  <input id="external_lore_source_processor_mode_tavern" type="radio" name="external_lore_source_processor_mode" value="tavern">
                  酒馆主 API
                </label>
              </div>
              <div class="external-lore-form-grid">
                <label>
                  整理 / 抓取 API 地址
                  <input id="external_lore_source_processor_url" class="text_pole" type="url" placeholder="https://api.example.com/lore/context">
                </label>
                <label>
                  API Key（可选）
                  <input id="external_lore_source_processor_key" class="text_pole" type="password" autocomplete="off">
                </label>
                <label>
                  语言
                  <input id="external_lore_source_language" class="text_pole" type="text" placeholder="zh-CN">
                </label>
                <label>
                  预算 token
                  <input id="external_lore_source_max_tokens" class="text_pole" type="number" min="100" max="200000" step="100">
                </label>
              </div>

              <div data-processor-panel="external" class="external-lore-processor-panel">
                <div class="external-lore-form-grid">
                  <label>
                    模型列表 API（可选）
                    <input id="external_lore_source_processor_models_url" class="text_pole" type="url" placeholder="留空时尝试 /v1/models">
                  </label>
                  <label>
                    使用模型
                    <input id="external_lore_source_processor_model" class="text_pole" type="text" list="external_lore_source_model_list" placeholder="手动输入或获取模型">
                    <datalist id="external_lore_source_model_list"></datalist>
                  </label>
                </div>
              </div>

              <div data-processor-panel="tavern" class="external-lore-processor-panel" hidden>
                <div class="external-lore-form-grid">
                  <label>
                    当前 API
                    <input id="external_lore_source_tavern_main_api" class="text_pole" type="text" readonly>
                  </label>
                  <label>
                    当前模型
                    <input id="external_lore_source_tavern_model" class="text_pole" type="text" readonly>
                  </label>
                </div>
                <div class="external-lore-help">这个模式仍需要上面的抓取 API 返回网页原文；插件再调用 SillyTavern 的 <code>generateRaw</code> 整理为 lore。</div>
              </div>
            </div>

            <div class="external-lore-modal-section">
              <div class="external-lore-section-title">注入设置</div>
              <div class="external-lore-form-grid">
                <label>
                  注入位置
                  <select id="external_lore_source_injection_position" class="text_pole">
                    <option value="in_prompt">主提示词内 / In Prompt</option>
                    <option value="before_prompt">主提示词前 / Before Prompt</option>
                    <option value="in_chat">聊天中 / In Chat</option>
                    <option value="none">不注入 / None</option>
                  </select>
                </label>
                <label>
                  深度
                  <input id="external_lore_source_injection_depth" class="text_pole" type="number" min="0" max="10000" step="1">
                </label>
                <label>
                  角色
                  <select id="external_lore_source_injection_role" class="text_pole">
                    <option value="system">系统 / System</option>
                    <option value="user">用户 / User</option>
                    <option value="assistant">助手 / Assistant</option>
                  </select>
                </label>
                <label>
                  注入顺序
                  <input id="external_lore_source_injection_order" class="text_pole" type="number" min="0" max="9999" step="1">
                </label>
              </div>
              <label class="checkbox_label external-lore-scan-toggle">
                <input id="external_lore_source_include_wi_scan" type="checkbox">
                参与世界书扫描
              </label>
              <div class="external-lore-help">使用 SillyTavern 原生扩展提示词注入。位置、深度、角色与酒馆的 Author's Note / Memory 类扩展一致；顺序会写入 prompt key，数值越小越靠前。</div>
            </div>
          </div>

          <div id="external_lore_source_api_modal_status" class="external-lore-modal-status" data-type="neutral">配置后点击保存。</div>

          <div class="external-lore-dialog-actions">
            <div class="external-lore-dialog-action-group">
              <button id="external_lore_source_test" type="button" class="menu_button">测试上下文</button>
              <button id="external_lore_source_fetch_models" type="button" class="menu_button">获取模型</button>
              <button id="external_lore_source_test_api" type="button" class="menu_button">测试连接</button>
            </div>
            <div class="external-lore-dialog-action-group external-lore-dialog-action-group-primary">
              <button type="button" class="menu_button" data-modal-close>取消</button>
              <button id="external_lore_source_save_settings" type="button" class="menu_button">保存设置</button>
            </div>
          </div>
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
  document.querySelector("#external_lore_source_add_oc")?.addEventListener("click", addOcWikiBindingFromInput);
  document.querySelector("#external_lore_source_add_web")?.addEventListener("click", addExternalSourceFromInput);
  document.querySelector("#external_lore_source_open_settings")?.addEventListener("click", () => setSettingsModalOpen(true));
  document.querySelector("#external_lore_source_save_settings")?.addEventListener("click", saveSettingsModal);
  document.querySelector("#external_lore_source_fetch_models")?.addEventListener("click", handleFetchModels);
  document.querySelector("#external_lore_source_test_api")?.addEventListener("click", handleTestProcessor);
  document.querySelectorAll("[name='external_lore_source_processor_mode']").forEach((node) => {
    node.addEventListener("change", updateProcessorModePanels);
  });
  document.querySelector("#external_lore_source_api_modal")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-modal-close]")) {
      setSettingsModalOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.querySelector("#external_lore_source_api_modal")?.classList.contains("is-open")) {
      setSettingsModalOpen(false);
    }
  });
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
    renderPanelSummary();
  });
  ensureSettingsModal();
  renderPanelSummary();
  renderBindings();
  startWorldbookLauncherObserver();
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
