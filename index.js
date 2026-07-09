const MODULE_NAME = "oc-wiki-worldbook";
const DEFAULT_SETTINGS = {
  enabled: true,
  baseUrl: "",
  bindings: []
};

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

function settings() {
  const store = extensionSettings();
  if (!store[MODULE_NAME]) {
    store[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
  }
  const current = store[MODULE_NAME];
  current.enabled = current.enabled !== false;
  current.baseUrl = String(current.baseUrl || "").trim();
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
  updateStatus(data.failures?.length ? `${data.entries?.length || 0} entries, ${data.failures.length} failed` : `${data.entries?.length || 0} entries ready`);
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
    list.innerHTML = '<div class="oc-wiki-empty">No OC Wiki entries bound yet.</div>';
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
      <button type="button" class="menu_button" data-action="remove">Remove</button>
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
    updateStatus(`Invalid share URL: ${error.message}`);
    return;
  }
  if (!parsed?.entryId || !parsed?.shareToken) {
    updateStatus("Share URL must include an entry id and share token.");
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
    updateStatus(`Bound ${entry.title || parsed.entryId}`);
  } catch (error) {
    updateStatus(`Could not bind entry: ${error.message}`);
  }
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
            Enabled
          </label>
          <label>
            OC Wiki base URL
            <input id="oc_wiki_worldbook_base_url" class="text_pole" type="url" placeholder="https://oc.example.com" value="${escapeHtml(current.baseUrl)}">
          </label>
          <label>
            Share link
            <textarea id="oc_wiki_worldbook_share_url" class="text_pole" rows="2" placeholder="Paste OC Wiki share link with ?share=...#entry=..."></textarea>
          </label>
          <div class="oc-wiki-actions">
            <button id="oc_wiki_worldbook_add" type="button" class="menu_button">Bind share link</button>
            <button id="oc_wiki_worldbook_test" type="button" class="menu_button">Test context</button>
          </div>
          <div id="oc_wiki_worldbook_status" class="oc-wiki-status">Idle</div>
          <div id="oc_wiki_worldbook_bindings" class="oc-wiki-bindings"></div>
        </div>
      </div>
    </div>
  `);

  document.querySelector("#oc_wiki_worldbook_enabled")?.addEventListener("change", (event) => {
    settings().enabled = Boolean(event.target.checked);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_base_url")?.addEventListener("input", (event) => {
    settings().baseUrl = normalizeBaseUrl(event.target.value);
    saveSettings();
  });
  document.querySelector("#oc_wiki_worldbook_add")?.addEventListener("click", addBindingFromInput);
  document.querySelector("#oc_wiki_worldbook_test")?.addEventListener("click", async () => {
    try {
      const prompt = await fetchContext();
      updateStatus(prompt ? `Context loaded: ${prompt.length} chars` : "No context loaded.");
    } catch (error) {
      updateStatus(`Context failed: ${error.message}`);
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
    }
    if (action === "toggle") {
      binding.enabled = Boolean(event.target.checked);
    }
    saveSettings();
    renderBindings();
  });
  renderBindings();
}

globalThis.ocWikiWorldbookGenerateInterceptor = async function ocWikiWorldbookGenerateInterceptor(chat) {
  try {
    const prompt = await fetchContext();
    if (!prompt) {
      return chat;
    }
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      if (chat[index]?.extra?.oc_wiki_worldbook) {
        chat.splice(index, 1);
      }
    }
    const note = {
      name: "OC Wiki",
      is_user: false,
      is_system: true,
      send_date: Date.now(),
      mes: prompt,
      extra: {
        type: "system",
        oc_wiki_worldbook: true
      }
    };
    chat.splice(Math.max(chat.length - 1, 0), 0, note);
    updateStatus(`Injected ${prompt.length} chars`);
  } catch (error) {
    updateStatus(`Injection skipped: ${error.message}`);
  }
  return chat;
};

jQuery(renderSettings);
