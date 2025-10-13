// background.js
chrome.runtime.onInstalled.addListener(() => {
  console.log("ViralMind Auto Connect instalado.");
});

function isLinkedInUrl(url = "") {
  return /^https?:\/\//i.test(url) && /(^|\.)linkedin\.com/i.test(url);
}

async function resolveTargetTab(optionalTabId) {
  // 1) Se veio tabId explícito, tenta usar (e validar URL)
  if (typeof optionalTabId === "number") {
    try {
      const tab = await chrome.tabs.get(optionalTabId);
      if (tab?.id && isLinkedInUrl(tab.url)) return tab;
    } catch { /* ignora e cai para os próximos passos */ }
  }

  // 2) Aba ativa da janela atual
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isLinkedInUrl(active.url)) return active;

  // 3) Se a ativa não serve, tenta qualquer aba do LinkedIn aberta
  const candidates = await chrome.tabs.query({ url: ["*://www.linkedin.com/*", "*://linkedin.com/*"] });
  if (candidates && candidates.length) {
    // pega a mais recente/última focada
    return candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  }

  return null;
}

function pickScriptFile(kind) {
  // suporta "connect", "send_with_note" e default (mensagem via content.js)
  if (kind === "connect") return "content_connect_only.js";
  if (kind === "send_with_note") return "content_send_with_note.js";
  return "content.js";
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Suportar duas formas:
  // A) { action: "runContentScript", script: "send_with_note", tabId? }
  // B) { startScript: "content_*.js" }  // legado, vindo do content_aplicar_filtro.js
  let action = request?.action;
  let scriptKind = request?.script;
  let explicitFile = request?.startScript; // legado
  let tabId = request?.tabId;

  // Mensagem legada (vinda do content_aplicar_filtro.js)
  if (!action && explicitFile) {
    action = "runContentScript";
  }

  if (action !== "runContentScript") return;

  (async () => {
    const tab = await resolveTargetTab(tabId);
    if (!tab?.id) {
      console.warn("⚠️ Nenhuma aba do LinkedIn encontrada para injetar o script.");
      return;
    }

    const file = explicitFile || pickScriptFile(scriptKind);
    if (!file) {
      console.warn("⚠️ Nenhum arquivo de script definido para injeção.");
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [file],
      });
      console.log(`✅ Script injetado: ${file} na aba ${tab.id}`);
    } catch (e) {
      console.error("❌ Erro ao injetar script:", e?.message || e);
    }
  })();
});
