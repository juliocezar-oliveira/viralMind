
// followups_runner.js — inclusão sem alterar popup.js
(() => {
  if (window.__FOLLOWUPS_RUNNER_INCLUDED__) return;
  window.__FOLLOWUPS_RUNNER_INCLUDED__ = true;

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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const visible = (el) => !!(el && el.offsetParent !== null);
  const isMessagingUrl = (u = "") => /^https:\/\/www\.linkedin\.com\/messaging\/?/.test(u);

  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function tabHasSelectors(tabId, selectors = []) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sels) => {
          const exists = (sel) => !!document.querySelector(sel);
          for (const s of sels) if (exists(s)) return true;
          return false;
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
      await sleep(intervalMs);
    }
    return false;
  }

  async function waitMessagingReady(tabId, timeoutMs = 25000, intervalMs = 500) {
    return await waitForSelectorsInTab(tabId, READY_SELECTORS, timeoutMs, intervalMs);
  }

  function clickFirstMessagingCard() {
    (async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const visible = (el) => !!(el && el.offsetParent !== null);
      // tenta achar o primeiro card visível da lista de conversas
      const roots = [
        document.querySelector('[data-test-conversations-list]'),
        document.querySelector('[data-test-recent-conversations-list]'),
        document.querySelector('.msg-conversations-container__conversations-list'),
        document
      ];
      for (let tries = 0; tries < 25; tries++) {
        const raw = [
          ...document.querySelectorAll('a.msg-conversation-listitem__link[href*="/messaging/thread/"]'),
          ...document.querySelectorAll('li.msg-conversation-listitem a[href*="/messaging/thread/"]'),
          ...document.querySelectorAll('[data-conversation-id] a[href*="/messaging/thread/"]')
        ];
        let target = raw.find(a => visible(a.closest('li') || a));
        if (target) { target.click(); break; }
        await sleep(200);
      }
    })();
  }

  async function injectRunner(tabId) {
    await waitMessagingReady(tabId, 25000, 400);
    // clica no primeiro cartão
    await chrome.scripting.executeScript({ target: { tabId }, func: clickFirstMessagingCard });
    // injeta o content que processa os threads (arquivo já existente na extensão)
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content_message_threads.js"] });
    } catch (e) {
      console.warn("[Followups Runner] Falha ao injetar content_message_threads.js:", e);
    }
  }

  function init() {
    const btn = document.getElementById("send-followups-messaging");
    if (!btn || btn.__followupsRunnerInited) return;
    btn.__followupsRunnerInited = true;

    btn.addEventListener("click", async () => {
      // manter compat com estados do popup
      const messageLimitEl = document.getElementById("message-limit");
      const customMessageEl = document.getElementById("custom-message");
      const limit = parseInt(messageLimitEl?.value || "0", 10) || 10;
      const customMessage = customMessageEl?.value || "";
      await chrome.storage.local.set({
        customMessage, sendLimit: limit, progress: 0, shouldStop: false, vmQuota: limit
      });

      const tab = await getCurrentTab();
      if (!tab?.id) return;

      if (tab.url && isMessagingUrl(tab.url)) {
        await injectRunner(tab.id);
        return;
      }
      chrome.tabs.update(tab.id, { url: "https://www.linkedin.com/messaging/" }, () => {
        const listener = async (updatedTabId, info, updatedTab) => {
          if (updatedTabId !== tab.id) return;
          if (info.status === "complete" && updatedTab?.url && isMessagingUrl(updatedTab.url)) {
            chrome.tabs.onUpdated.removeListener(listener);
            await injectRunner(updatedTab.id);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
