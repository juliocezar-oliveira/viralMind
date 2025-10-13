// popup_like.js — orquestra curtidas em sequência (sem tocar no popup.js principal)
(function () {
    const $ = (id) => document.getElementById(id);
    const urlsInput = $('like-urls');
    const btn = $('btn-like');
    const logBox = $('log');
    const progress = $('progress');
    const closeAfter = $('close-after');
  
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
    function log(line, cls = '') {
      const div = document.createElement('div');
      div.textContent = line;
      if (cls) div.className = cls;
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
    }
  
    function parseUrls(raw) {
      const parts = (raw || '')
        .split(/[\s,]+/g)
        .map(s => s.trim())
        .filter(Boolean);
      // normaliza e filtra linkedin
      const onlyLinkedin = parts
        .map(u => u.replace(/^<?(https?:\/\/)?/i, 'https://')) // garante https
        .map(u => u.replace(/[)>]+$/, '')) // limpa colchetes/parenteses eventuais
        .filter(u => /https:\/\/(www\.)?linkedin\.com\//i.test(u));
      // remove duplicados exatos
      const uniq = Array.from(new Set(onlyLinkedin));
      return uniq;
    }
  
    async function waitTabComplete(tabId, timeoutMs = 30000) {
      const start = Date.now();
      return new Promise((resolve) => {
        function done(ok) {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(ok);
        }
        function listener(updatedTabId, info) {
          if (updatedTabId !== tabId) return;
          if (info.status === 'complete') {
            // dá um fôlego para LinkedIn montar o DOM
            setTimeout(() => done(true), 700);
          }
        }
        chrome.tabs.onUpdated.addListener(listener);
        // timeout
        const timer = setInterval(async () => {
          if (Date.now() - start > timeoutMs) {
            clearInterval(timer);
            done(false);
          }
        }, 500);
      });
    }
  
    async function ensureContentScript(tabId) {
      // injeta o arquivo específico deste módulo (não interfere nos demais)
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content_like_publications.js']
        });
        return true;
      } catch (e) {
        return false;
      }
    }
  
    async function sendLike(tabId, opts) {
      // tenta algumas vezes até o listener estar pronto
      for (let i = 0; i < 5; i++) {
        try {
          const resp = await chrome.tabs.sendMessage(tabId, { type: 'LIKE_PUBLICATION', ...opts });
          if (resp) return resp;
        } catch (e) {
          // a content script ainda pode não estar pronto
        }
        await sleep(400);
      }
      return { ok: false, reason: 'no-listener' };
    }
  
    async function processOne(url, idx, total, shouldClose) {
      log(`#${idx}/${total} abrindo: ${url}`);
      const tab = await new Promise((res) => chrome.tabs.create({ url, active: false }, res));
      if (!tab?.id) {
        log(`#${idx} erro: não foi possível abrir a aba`, 'err');
        return false;
      }
  
      const loaded = await waitTabComplete(tab.id, 35000);
      if (!loaded) log(`#${idx} aviso: timeout de carregamento, tentando mesmo assim…`, 'warn');
  
      await ensureContentScript(tab.id);
      const resp = await sendLike(tab.id, { closeAfter: false }); // fechar a aba por aqui
      if (resp?.ok) {
        log(`#${idx} ok: ${resp.status || 'curtido'}`, 'ok');
      } else {
        log(`#${idx} falhou: ${resp?.reason || 'desconhecido'}`, 'err');
      }
  
      if (shouldClose) {
        try { await chrome.tabs.remove(tab.id); } catch {}
      }
      return !!resp?.ok;
    }
  
    btn.addEventListener('click', async () => {
      const urls = parseUrls(urlsInput.value);
      if (!urls.length) {
        log('Nenhum link do LinkedIn encontrado. Cole as URLs acima.', 'warn');
        return;
      }
      btn.disabled = true;
      progress.textContent = `0/${urls.length}`;
      let okCount = 0;
  
      for (let i = 0; i < urls.length; i++) {
        const ok = await processOne(urls[i], i + 1, urls.length, !!closeAfter.checked);
        if (ok) okCount++;
        progress.textContent = `${i + 1}/${urls.length}`;
        await sleep(400); // respiro entre abas
      }
  
      log(`Concluído: ${okCount}/${urls.length} curtidas com sucesso.`, okCount ? 'ok' : 'err');
      btn.disabled = false;
    });
  })();
  