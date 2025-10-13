// 1 por vez: abre o primeiro card, avalia, envia (se vazio) e fecha. Sem sair da página.
(() => {
  // === Ritmizador global (pacer) — inclusão não intrusiva ===
(() => {
  if (window.__pacer) return;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const rint  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  const CFG = {
    ranges: {
      conectar:  [18000, 33000],
      mensagens: [22000, 45000],
      primeira:  [20000, 40000],
      followups: [12000, 28000]
    },
    longEvery: {
      conectar:  [7,11],
      mensagens: [5,9],
      primeira:  [6,10],
      followups: [10,15]
    },
    longPauseMs: {
      conectar:  [120000, 240000],
      mensagens: [180000, 300000],
      primeira:  [120000, 240000],
      followups: [90000,  180000]
    }
  };

  let stopFlag = false;
  try {
    chrome.storage?.local?.get?.(['shouldStop','pacerConfig'], (d) => {
      stopFlag = !!d?.shouldStop;
      if (d?.pacerConfig && typeof d.pacerConfig === 'object') applyConfig(d.pacerConfig);
    });
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== 'local') return;
      if (changes?.shouldStop) stopFlag = !!changes.shouldStop.newValue;
      if (changes?.pacerConfig?.newValue) applyConfig(changes.pacerConfig.newValue);
    });
  } catch {}

  const counters = { conectar:0, mensagens:0, primeira:0, followups:0 };
  const nextLong = {};

  function applyConfig(conf){
    const merge = (t, s) => { for (const k in s) {
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) merge(t[k] = t[k] || {}, s[k]);
      else t[k] = s[k];
    }};
    merge(CFG, conf || {});
  }

  async function cancellableWait(ms){
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (stopFlag) throw new Error('STOP_REQUESTED');
      await delay(Math.min(500, ms - (Date.now() - t0)));
    }
  }

  function needLongPause(tipo){
    counters[tipo] = (counters[tipo] || 0) + 1;
    const [a,b] = CFG.longEvery[tipo] || [999,999];
    if (!nextLong[tipo]) nextLong[tipo] = rint(a,b);
    if (counters[tipo] >= nextLong[tipo]) {
      counters[tipo] = 0;
      nextLong[tipo] = rint(a,b);
      return true;
    }
    return false;
  }

  async function between(tipo){
    const [minB, maxB] = CFG.ranges[tipo] || [15000, 30000];
    const base = rint(minB, maxB) + rint(120, 800);
    await cancellableWait(base);
    if (needLongPause(tipo)) {
      const [minL, maxL] = CFG.longPauseMs[tipo] || [60000, 120000];
      await cancellableWait(rint(minL, maxL));
    }
  }

  window.__pacer = { between, configure: applyConfig, _cfg: CFG };
})();

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const waitFor = async (fn, { timeout=10000, interval=120 } = {}) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const v = fn();
        if (v) return v;
        await sleep(interval);
      }
      return null;
    };
    const visible = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
  
    // ========= Mensagem =========
    const DEFAULT_MSG = `Olá {name}, espero que esteja bem. Sou o Presidente Regional da PUC angels Grande São Paulo.
  
  Estamos expandindo nossa rede de líderes e inovadores. Gostaria de te convidar para conhecer a Associação PUC angels e como podemos juntos fortalecer ainda mais esse ecossistema.`;
    async function getTpl() {
      return new Promise(res => {
        try {
          chrome.storage?.local?.get?.(["customMessage"], d => res(d?.customMessage || DEFAULT_MSG));
        } catch { res(DEFAULT_MSG); }
      });
    }
  
    // ========= Seletores =========
    const cardsSel = '[data-view-name="connections-list"] div[componentkey^="auto-component-"]';
    const messageLinkSel = '[data-view-name="message-button"] a[href^="/messaging/compose/"]';
    const overlaysSel = '.msg-overlay-conversation-bubble';
    const overlayListSel = '.msg-overlay-list-bubble'; // container pai
  
    function firstCard() {
      const cards = Array.from(document.querySelectorAll(cardsSel))
        .filter(c => visible(c) && !c.dataset.__li_msg_done);
      return cards[0] || null;
    }
    function getName(card) {
      const a = card.querySelector('a[href*="/in/"]');
      return (a?.textContent || "").trim() || "amigo(a)";
    }
    function getSlug(card) {
      const a = card.querySelector('a[href*="/in/"]');
      if (!a) return null;
      try {
        const u = new URL(a.href, location.origin);
        const parts = u.pathname.split('/').filter(Boolean);
        const i = parts.indexOf('in');
        return (i>=0 && parts[i+1]) ? parts[i+1].toLowerCase() : null;
      } catch { return null; }
    }
  
    // ========= Abrir overlay sem navegar / sem expandir card =========
    async function openOverlayFromLink(link) {
      // Evita expandir o card: bloqueia a propagação para ancestrais
      const stopBubble = (e) => { e.stopPropagation(); };
      link.addEventListener('click', stopBubble, { capture: true, once: true });
  
      // Hack principal: remove href TEMPORARIAMENTE para impedir navegação,
      // preservando o onClick do React que abre o overlay.
      const href = link.getAttribute('href');
      link.removeAttribute('href');
  
      // Clica “de verdade” no elemento, sem sintetizar mousedown/mouseup.
      link.click();
  
      // Restaura o href depois de um *tick*
      setTimeout(() => { if (href && !link.getAttribute('href')) link.setAttribute('href', href); }, 0);
    }
  
    // ========= Overlay utils =========
    const overlays = () => Array.from(document.querySelectorAll(overlaysSel)).filter(visible);
  
    function newestOverlay(beforeCount) {
      // Heurística: depois do clique, geralmente nasce 1 novo overlay.
      const all = overlays();
      if (all.length <= beforeCount) return null;
      // pegue o último no DOM
      return all[all.length - 1];
    }
  
    function overlayMatches(ov, { slug, name }) {
      if (!ov) return false;
      // tenta casar por link /in/ do header
      const ah = ov.querySelector('.msg-overlay-bubble-header__details a[href*="/in/"]');
      if (ah) {
        try {
          const u = new URL(ah.href, location.origin);
          const parts = u.pathname.split('/').filter(Boolean);
          const i = parts.indexOf('in');
          const got = (i>=0 && parts[i+1]) ? parts[i+1].toLowerCase() : '';
          if (slug && got.includes(slug)) return true;
        } catch {}
      }
      // fallback: por texto do header
      const headerTxt = (ov.querySelector('.msg-overlay-bubble-header__details')?.textContent || "").toLowerCase();
      if (name && headerTxt.includes(name.toLowerCase())) return true;
  
      return false;
    }
  
    function ensureOverlayForTarget(target, { timeout=6000 } = {}) {
      const startCount = overlays().length;
      return waitFor(() => {
        const ov = newestOverlay(startCount);
        if (ov && overlayMatches(ov, target)) return ov;
        // também serve se só houver 1 overlay aberto
        const all = overlays();
        if (all.length === 1 && overlayMatches(all[0], target)) return all[0];
        return null;
      }, { timeout, interval: 120 });
    }
  
    function hasHistory(ov) {
      // elementos típicos de timeline
      if (ov.querySelector('.msg-s-event-listitem__body')) return true;
      if (ov.querySelector('.msg-s-message-list__event')) return true;
      if (ov.querySelector('.msg-conversation-listitem')) return true;
      if (ov.querySelector('.msg-s-message-list-content div[role="listitem"]')) return true;
      return false;
    }
  
    function getComposer(ov) {
      const editor = ov.querySelector('.msg-form__contenteditable[contenteditable="true"][role="textbox"]')
        || ov.querySelector('[contenteditable="true"][role="textbox"]');
      const sendBtn = ov.querySelector('button.msg-form__send-btn')
        || Array.from(ov.querySelectorAll('button')).find(b => /enviar|send/i.test((b.textContent||"").trim()));
      const closeBtn = (ov.querySelector('button svg use[href="#close-small"]')?.closest('button'))
        || Array.from(ov.querySelectorAll('button[aria-label]')).find(b => /fechar|close/i.test(b.getAttribute('aria-label')||""));
      return { editor, sendBtn, closeBtn };
    }
  
    const isEditorEmpty = (ed) => {
      const html = (ed?.innerHTML || "").trim();
      const txt  = (ed?.innerText || "").trim();
      return !txt || /^<p><br><\/p>$/i.test(html);
    };
    const clearEditor = (ed) => {
      try {
        ed.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(ed);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete");
      } catch {}
    };
    const humanType = async (ed, text) => {
      ed.focus();
      for (const ch of text) {
        try { document.execCommand("insertText", false, ch); } catch {}
        ed.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
        await sleep(12 + Math.floor(Math.random()*25));
      }
      ed.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const click = (el) => el?.dispatchEvent(new MouseEvent("click", {bubbles:true,cancelable:true}));
    const closeOverlay = (ov) => click(getComposer(ov).closeBtn);
  
    // ========= Loop 1-a-1 =========
    let RUNNING = false;
    async function processOne() {
      if (RUNNING) return;
      RUNNING = true;
      try {
        const card = firstCard();
        if (!card) return; // acabou visível
  
        const name = getName(card);
        const slug = getSlug(card);
        const link = card.querySelector(messageLinkSel);
  
        // marca card para não reprocessar
        card.dataset.__li_msg_done = "1";
  
        if (!link) {
          // sem botão Mensagem, segue pro próximo
          setTimeout(processOne, 300);
          return;
        }
  
        // abre overlay sem navegar / sem expandir o card
        await openOverlayFromLink(link);
  
        // espera o overlay dessa pessoa aparecer
        const ov = await ensureOverlayForTarget({ slug, name }, { timeout: 8000 });
        if (!ov) {
          // não abriu? segue adiante
          setTimeout(processOne, 300);
          return;
        }
  
        // espera o conteúdo do overlay carregar minimamente (composer ou lista)
        await waitFor(() => {
          const { editor } = getComposer(ov);
          return editor || ov.querySelector('.msg-s-message-list-content') ? true : false;
        }, { timeout: 6000, interval: 120 });
  
        // avaliou histórico?
        if (hasHistory(ov)) {
          closeOverlay(ov);
          await sleep(200);
          setTimeout(processOne, 300);
          return;
        }
  
        // sem histórico → escrever e enviar
        const { editor, sendBtn } = getComposer(ov);
        if (!editor || !sendBtn) {
          closeOverlay(ov);
          await sleep(200);
          setTimeout(processOne, 300);
          return;
        }
  
        if (isEditorEmpty(editor)) {
          const tpl = await getTpl();
          const msg = tpl.replaceAll('{name}', name);
          clearEditor(editor);
          await humanType(editor, msg);
  
          // força reavaliação do disabled
          let tries = 50;
          while (tries-- > 0 && sendBtn.disabled) {
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: " ", inputType: "insertText" }));
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: null, inputType: "deleteContentBackward" }));
            await sleep(80);
          }
  
          if (!sendBtn.disabled) click(sendBtn);
          else {
            // fallback: Enter (se preferências do LI permitirem)
            editor.focus();
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
            editor.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
          }
  
          await sleep(700);
        }
  
        closeOverlay(ov);
        await sleep(200);
        // +PACER (Primeira Mensagem)
      if (window.__pacer?.between) { try { await window.__pacer.between('primeira'); } catch(e) {} }
        setTimeout(processOne, 300);
      } finally {
        RUNNING = false;
      }
    }
  
    // start
    processOne();
  })();
  