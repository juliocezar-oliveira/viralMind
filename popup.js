// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);

  const filterRole = $("filter-role");
  const filterLocation = $("filter-location");
  const networkFilter = $("network-filter");
  const messageLimit = $("message-limit");
  const skipIfSent = $("skip-if-sent");
  const progressDisplay = $("progress-display");

  const applyFiltersBtn = $("apply-filters");
  const directMsgBtn = $("direct-message");
  const connectBtn = $("auto-connect");
  const stopBtn = $("stop-connections");
  const viewLogBtn = $("view-log");
  const readConvsBtn = $("read-conversations");
  const followupsBtn = $("send-followups-messaging");

  // ---------- helpers ----------
  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function updateProgress(progress = 0, sendLimit = 0) {
    if (!progressDisplay) return;
    progressDisplay.textContent =
      sendLimit > 0
        ? `Mensagens enviadas: ${progress} de ${sendLimit}`
        : `Mensagens enviadas: ${progress}`;
  }

  function isMessagingUrl(u = "") {
    return /^https:\/\/www\.linkedin\.com\/messaging\/?/.test(u);
  }
  function isPeopleSearchUrl(u = "") {
    return /^https:\/\/www\.linkedin\.com\/search\/results\/people\/?/.test(u);
  }

  function parseOnly2nd3rd(value = "") {
    const v = (value || "").toString().toLowerCase();
    const has23 = /(2|segundo).*(3|terceiro)|2\s*[-e/,]\s*3|2nd.*3rd/.test(v);
    const has1 = /\b1\b|primeir/.test(v);
    return has23 && !has1;
  }

  // ---------- espera de seletores na ABA ----------
  async function tabHasSelectors(tabId, selectors = []) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sels) => {
          const exists = (sel) => !!document.querySelector(sel);
          for (const s of sels) if (exists(s)) return true;
          const hasButtons = [...document.querySelectorAll("button")]
            .some(b => /conectar|adicionar nota|mensagem|connect|add note|message/i.test((b.innerText || "").trim()));
          return hasButtons;
        },
        args: [selectors]
      });
      return !!result;
    } catch {
      return false;
    }
  }

  async function waitForSelectorsInTab(tabId, selectors, timeoutMs = 25000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await tabHasSelectors(tabId, selectors);
      if (ok) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }

  // Aguarda a UI do /messaging carregar (lista/área de chat pronta)
  async function waitMessagingReady(tabId, timeoutMs = 25000, intervalMs = 500) {
    const READY_SELECTORS = [
      '.msg-conversations-container__conversations-list',
      '.msg-conversations-container__conversations-list-scroller',
      '[data-test-conversations-list]',
      '[data-test-recent-conversations-list]',
      'li.msg-conversation-listitem',
      'a.msg-conversation-listitem__link[href*="/messaging/thread/"]',
      'div.msg-s-message-list',
      'button.msg-form__send-button'
    ];
    return await waitForSelectorsInTab(tabId, READY_SELECTORS, timeoutMs, intervalMs);
  }

  function navigateAndRun(tab, targetUrl, urlMatchFn, readySelectors, onReady) {
    const runAfterReady = async (t) => {
      await new Promise(r => setTimeout(r, 700)); // buffer SPA
      await waitForSelectorsInTab(t.id, readySelectors, 25000, 500);
      onReady(t);
    };

    if (tab?.url && urlMatchFn(tab.url)) {
      runAfterReady(tab);
      return;
    }
    chrome.tabs.update(tab.id, { url: targetUrl }, () => {
      const listener = (updatedTabId, info, updatedTab) => {
        if (updatedTabId !== tab.id) return;
        if (info.status === "complete" && updatedTab?.url && urlMatchFn(updatedTab.url)) {
          chrome.tabs.onUpdated.removeListener(listener);
          runAfterReady(updatedTab);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  // ---------- restaurar estado ----------
  chrome.storage.local.get(
    ["progress", "sendLimit", "filterRole", "filterLocation", "localidadeNome", "filtroConexao", "skipIfSent"],
    (data) => {
      updateProgress(data.progress ?? 0, data.sendLimit ?? 0);
      if (filterRole) filterRole.value = data.filterRole || "";
      if (filterLocation) filterLocation.value = data.filterLocation || data.localidadeNome || "";
      if (networkFilter) networkFilter.value = data.filtroConexao || "";
      if (messageLimit) messageLimit.value = data.sendLimit || "";
      if (skipIfSent) skipIfSent.checked = !!data.skipIfSent;
    }
  );

  // Mantém o contador sincronizado
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.sendTotal) {
      chrome.storage.local.set({ sendLimit: changes.sendTotal.newValue ?? 0 });
    }
    const msg = changes.messagesSent?.newValue;
    const conn = changes.connectionsSent?.newValue;
    const progress = (typeof msg === "number") ? msg :
      (typeof conn === "number") ? conn : undefined;

    if (typeof progress === "number") {
      chrome.storage.local.set({ progress });
      chrome.storage.local.get(["sendLimit"], ({ sendLimit = 0 }) => {
        updateProgress(progress, sendLimit);
      });
    }
  });

  // ---------- aplicar filtros ----------
  if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener("click", async () => {
      const role = (filterRole?.value || "").trim();
      const location = (filterLocation?.value || "").trim();
      const conexao = (networkFilter?.value || "").trim();
      const limit = parseInt(messageLimit?.value || "0", 10) || 20;
      const skip = !!skipIfSent?.checked;

      await chrome.storage.local.set({
        filterRole: role,
        filterLocation: location,
        localidadeNome: location,
        filtroConexao: conexao,
        only2nd3rd: parseOnly2nd3rd(conexao),
        sendLimit: limit,
        skipIfSent: skip,
        progress: 0,
        shouldStop: false,
        scriptToInject: "content_aplicar_filtro.js"
      });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      navigateAndRun(
        tab,
        "https://www.linkedin.com/search/results/people/",
        isPeopleSearchUrl,
        [".reusable-search__entity-result-list", ".search-results-container", ".reusable-search__result-container", "main", "button"],
        (readyTab) => {
          chrome.scripting.executeScript({ target: { tabId: readyTab.id }, files: ["content_aplicar_filtro.js"] });
        }
      );
    });
  }

  // ---------- enviar mensagens com nota ----------
  if (directMsgBtn) {
    directMsgBtn.addEventListener("click", async () => {
      const role = (filterRole?.value || "").trim();
      const location = (filterLocation?.value || "").trim();
      const conexao = (networkFilter?.value || "").trim();
      const limit = parseInt(messageLimit?.value || "0", 10) || 20;
      const skip = !!skipIfSent?.checked;
      const customMessage = document.getElementById("custom-message")?.value || "";

      await chrome.storage.local.set({
        filterRole: role,
        filterLocation: location,
        localidadeNome: location,
        filtroConexao: conexao,
        only2nd3rd: parseOnly2nd3rd(conexao),
        sendLimit: limit,
        skipIfSent: skip,
        customMessage,
        connectMessage: customMessage,
        progress: 0,
        shouldStop: false
      });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      navigateAndRun(
        tab,
        "https://www.linkedin.com/search/results/people/",
        isPeopleSearchUrl,
        [".reusable-search__entity-result-list", ".search-results-container", ".reusable-search__result-container", "main", "button"],
        (readyTab) => {
          chrome.scripting.executeScript({ target: { tabId: readyTab.id }, files: ["content_connect_only.js"] });
        }
      );
    });
  }

  // ---------- conectar sem nota ----------
  if (connectBtn) {
    connectBtn.addEventListener("click", async () => {
      const role = (filterRole?.value || "").trim();
      const location = (filterLocation?.value || "").trim();
      const conexao = (networkFilter?.value || "").trim();
      const limit = parseInt(messageLimit?.value || "0", 10) || 20;
      const skip = !!skipIfSent?.checked;
      const customMessage = document.getElementById("custom-message")?.value || "";

      await chrome.storage.local.set({
        filterRole: role,
        filterLocation: location,
        localidadeNome: location,
        filtroConexao: conexao,
        only2nd3rd: parseOnly2nd3rd(conexao),
        sendLimit: limit,
        skipIfSent: skip,
        connectMessage: customMessage,
        progress: 0,
        shouldStop: false
      });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      navigateAndRun(
        tab,
        "https://www.linkedin.com/search/results/people/",
        isPeopleSearchUrl,
        [".reusable-search__entity-result-list", ".search-results-container", ".reusable-search__result-container", "main", "button"],
        (readyTab) => {
          chrome.scripting.executeScript({ target: { tabId: readyTab.id }, files: ["content_connect_only.js"] });
        }
      );
    });
  }

  // ---------- parar ----------
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      await chrome.storage.local.set({ shouldStop: true });
      console.log("🛑 shouldStop=true");
    });
  }

  // ---------- ver enviados ----------
  if (viewLogBtn) {
    viewLogBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("log.html") });
    });
  }

  // ---------- ler conversas ----------
  if (readConvsBtn) {
    readConvsBtn.addEventListener("click", async () => {
      const tab = await getCurrentTab();
      if (tab?.id != null) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content_read_conversations.js"] });
      }
    });
  }

  // ---------- follow-ups (mensagem) ----------
  if (followupsBtn) {
    followupsBtn.addEventListener("click", async () => {
      const limit = parseInt(messageLimit?.value || "0", 10) || 10;
      const customMessage = document.getElementById("custom-message")?.value || "";

      await chrome.storage.local.set({
        customMessage, sendLimit: limit, progress: 0, shouldStop: false, vmQuota: limit
      });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      // script injetado dentro da aba para clicar no 1º cartão
      document.getElementById("seu-botao-id").addEventListener("click", () => {
        if (typeof window.puclangelsSendMessages === "function") {
          window.puclangelsSendMessages();
        } else {
          console.warn("Função não encontrada: certifique-se de injetar send_new_contacts.js nesta página.");
        }
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }
  // ---------- enviar 1 mensagem (Conexões) ----------
  (function () {
    const oneMsgBtn = $("btn-1-mensagem");
    if (!oneMsgBtn) return;
    if (oneMsgBtn.dataset.inited === "1") return;
    oneMsgBtn.dataset.inited = "1";

    oneMsgBtn.addEventListener("click", async () => {
      const limit = parseInt(messageLimit?.value || "2", 10) || 2;
      await chrome.storage.local.set({ sendLimit: limit, shouldStop: false });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      const isConnectionsUrl = (u = "") => /^https:\/\/www\.linkedin\.com\/mynetwork\/invite-connect\/connections\/?/.test(u);

      navigateAndRun(
        tab,
        "https://www.linkedin.com/mynetwork/invite-connect/connections/",
        isConnectionsUrl,
        ["main", "a[aria-label*='Mensagem']", "button[aria-label*='Mensagem']"],
        async (readyTab) => {
          try {
            await chrome.scripting.executeScript({ target: { tabId: readyTab.id }, files: ["send_new_contacts.js"] });
            await chrome.scripting.executeScript({
              target: { tabId: readyTab.id },
              func: async () => {
                if (typeof window.puclangelsSendMessages === "function") {
                  await window.puclangelsSendMessages();
                } else {
                  console.warn("[PUC Angels] Função não encontrada (send_new_contacts.js não injetado).");
                }
                _
              }
            });
          } catch (e) {
            console.error("[PUC Angels] Falha ao executar envio:", e);
          }
        }
      );
    });
  })();

});