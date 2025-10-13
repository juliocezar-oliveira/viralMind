// content_message_threads.js
// Follow-ups no LinkedIn Messaging (card por card):
// - Entra no thread e garante carregar o fim mais recente
// - Decide por timestamp (data heading + hora do grupo) qual é a ÚLTIMA mensagem
// - Elegível quando a última é SUA e tem >= 3 dias (sem resposta deles)
// - Não repete: valida contra sentThreads *dentro do thread* (limpa entradas antigas)
// - Preenche, garante que o botão "Enviar" habilite de forma humana e envia;
//   só contabiliza se a bolha realmente aparece

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

  'use strict';
  if (window.__vm_followups_running) return;
  window.__vm_followups_running = true;

  // ===== config / debug =====
  const DEBUG = true;                // logs no console
  const KEEP_DAYS = 60;              // dias para reter sentThreads
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  // Perfis de digitação humana (delays aleatórios)
  const TYPE_PROFILE = {
    charMin: 28,   // atraso base por caractere (ms) — letras/números
    charMax: 55,
    spaceMin: 110, // após espaço
    spaceMax: 190,
    punctMin: 150, // após vírgula/ponto/!
    punctMax: 260,
    sentenceMin: 360, // após fim de frase (.!? ou \n)
    sentenceMax: 640
  };

  // ===== util =====
  const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
  const jitter = (base = 220, spread = 220) => base + Math.floor(Math.random() * spread);
  const storage = chrome?.storage?.local || null;
  const log = (...args) => { if (DEBUG) console.log('[ViralMind][FU]', ...args); };

  const trim1 = (s='') => s.replace(/\s+/g,' ').trim();
  const norm  = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return el.offsetParent !== null && r.width > 0 && r.height > 0;
  };
  const shouldStop = async () =>
    new Promise(res => storage?.get('shouldStop', d => res(!!d?.shouldStop)) ?? res(false));

  const randBetween = (a,b) => a + Math.floor(Math.random()*(b-a+1));
  const isPunct = (ch) => /[.,;:!?]/.test(ch);

  function hudSet(text) {
    let hud = document.getElementById('VM_FU_HUD');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'VM_FU_HUD';
      hud.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483647;background:#0d1117;color:#e6edf3;border:1px solid #30363d;padding:8px 10px;border-radius:8px;font:12px/1.3 -apple-system,Segoe UI,Arial;box-shadow:0 4px 14px rgba(0,0,0,.4)';
      (document.body || document.documentElement).appendChild(hud);
    }
    hud.textContent = `ViralMind • ${text}`;
  }

  async function waitFor(selOrFn, timeout = 12000, step = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = (typeof selOrFn === 'function') ? selOrFn() : document.querySelector(selOrFn);
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  // ===== lista lateral (cards) =====
  function listRoot() {
    return document.querySelector(
      '.msg-conversations-container__conversations-list, .msg-conversations-container__conversations-list-scroller, [data-test-conversations-list], [data-test-recent-conversations-list]'
    ) || document.querySelector('aside') || document.body;
  }
  function getCardName(li) {
    const span = li.querySelector('.msg-conversation-card__title-row .truncate span.truncate');
    const h = li.querySelector('.msg-conversation-card__title-row h3');
    const txt = trim1((span?.innerText || h?.innerText || '').split('\n')[0]);
    return txt || '';
  }
  function collectCards(max = 800) {
    const root = listRoot();
    if (!root) return [];
    const items = [...root.querySelectorAll('li.msg-conversation-listitem, li[role="listitem"]')];
    const out = [];
    for (const li of items) {
      if (!visible(li)) continue;
      if (li.closest('.artdeco-dropdown, .overflow, .msg-conversation-listitem__menu')) continue;
      const link = li.querySelector('.msg-conversation-listitem__link');
      if (!link) continue;
      const name = getCardName(li);
      const imgAlt = li.querySelector('img[alt]')?.getAttribute('alt') || '';
      const key = `n:${name.toLowerCase()}|a:${(imgAlt||'').toLowerCase()}`;
      out.push({ key, li, link, name });
      if (out.length >= max) break;
    }
    try { out.sort((a,b) => (a.li?.offsetTop||0) - (b.li?.offsetTop||0)); } catch {}
    return out;
  }

  let CURRENT_CARD_NAME = '';

  async function openCardAndWaitActive(item) {
    const { li, link, name } = item;
    CURRENT_CARD_NAME = name || '';
    const root = listRoot();

    const isActiveNow = () =>
      li.getAttribute('aria-selected') === 'true' ||
      !!li.querySelector('.msg-conversations-container__convo-item-link--active') ||
      document.querySelector('.msg-conversation-listitem__active-text');

    if (li) {
      if (root && typeof root.scrollTop === 'number' && typeof li.offsetTop === 'number') {
        root.scrollTo({ top: Math.max(0, li.offsetTop - 100), behavior: 'smooth' });
        await sleep(300);
      } else {
        try { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
        await sleep(300);
      }
    }

    try { link.focus(); } catch {}
    try {
      link.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true }));
      link.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true }));
      link.dispatchEvent(new MouseEvent('click',     { bubbles:true, cancelable:true }));
    } catch { try { link.click(); } catch {} }
    try {
      link.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true }));
      link.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', bubbles:true }));
    } catch {}

    const ok = await waitFor(() => {
      if (isActiveNow()) return true;
      const headerName = getThreadTitleName();
      if (headerName && name && headerName.toLowerCase().includes(name.toLowerCase())) return true;
      return false;
    }, 9000, 150);
    if (!ok) return false;

    return !!(await waitFor('.msg-s-message-list, .msg-conversation__message-list, [data-test-conversation]', 10000, 200));
  }

  // ===== destinatário (para {name}) =====
  function getThreadTitleName() {
    const h = document.querySelector('.artdeco-entity-lockup__title, [data-test-conversation-title]');
    const t = trim1(h?.innerText || '');
    if (t) {
      const line = t.split('\n').map(trim1).find(Boolean);
      if (line) return line.replace(/^Ver perfil de\s+/i, '').replace(/\s+·.*$/, '');
    }
    const sel = document.querySelector('li.msg-conversation-listitem[aria-selected="true"]');
    const t2 = trim1(sel?.querySelector('.msg-conversation-card__title-row .truncate span.truncate')?.innerText || '');
    return t2 || '';
  }
  function safeFirstName(full) {
    const clean = trim1(full || '');
    if (!clean) return '';
    const first = clean.split(/\s+/)[0];
    if (!first || /^\d+$/.test(first)) return '';
    return first[0].toUpperCase() + first.slice(1).toLowerCase();
  }
  function receiverFirstName() {
    const t = getThreadTitleName() || CURRENT_CARD_NAME || '';
    return safeFirstName(t);
  }
  function personalize(baseText) {
    const first = receiverFirstName();
    const hasName = first.length > 0;

    if (!baseText) {
      return hasName
        ? `Olá ${first}, tudo bem? Passando para um follow-up rápido. Posso te enviar mais detalhes da PUC Angels e oportunidades do nosso ecossistema?`
        : `Olá, tudo bem? Passando para um follow-up rápido. Posso te enviar mais detalhes da PUC Angels e oportunidades do nosso ecossistema?`;
    }

    let txt = baseText.replaceAll('{name}', hasName ? first : '').replaceAll('{nome}', hasName ? first : '');
    txt = txt.replace(/\s+,/g, ',').replace(/Olá\s*,\s*,/i, 'Olá,').replace(/Olá\s*,\s*$/i, 'Olá');
    txt = txt.replace(/\s{2,}/g, ' ').trim();
    if (!hasName) txt = txt.replace(/^(ol[áa]|oi)\s*,\s*/i, (m)=>m.replace(',', '').trim() + ' ');
    return txt;
  }

  // ===== datas =====
  function parseTitlePtBr(title='') {
    const m = title.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2}):(\d{2})/);
    if (!m) return null;
    const [_, dd, mm, yyyy, HH, MM] = m;
    const d = new Date(+yyyy, +mm - 1, +dd, +HH, +MM, 0, 0);
    return isNaN(+d) ? null : +d;
  }
  const MES = {
    'jan':0,'fev':1,'mar':2,'abr':3,'mai':4,'jun':5,'jul':6,'ago':7,'set':8,'out':9,'nov':10,'dez':11,
    'janeiro':0,'fevereiro':1,'março':2,'marco':2,'abril':3,'maio':4,'junho':5,'julho':6,'agosto':7,'setembro':8,'outubro':9,'novembro':10,'dezembro':11,
  };
  const DOW = ['domingo','segunda-feira','terça-feira','terca-feira','quarta-feira','quinta-feira','sexta-feira','sábado','sabado'];
  function parseHeadingPtBrToDate(text) {
    const s = trim1((text||'').toLowerCase());
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (!s) return null;
    if (s.includes('hoje')) return +today;
    if (s.includes('ontem')) return +new Date(today.getFullYear(), today.getMonth(), today.getDate()-1);

    const idx = DOW.findIndex(dw => s.includes(dw));
    if (idx >= 0) {
      const targetDow = [0,1,2,3,4,5,6,6][idx];
      const currentDow = today.getDay();
      let delta = currentDow - targetDow;
      if (delta < 0) delta += 7;
      return +new Date(today.getFullYear(), today.getMonth(), today.getDate()-delta);
    }

    const m = s.match(/(\d{1,2})\s+de\s+([a-zç\.]+)/i);
    if (m) {
      const dd = parseInt(m[1],10);
      let mkey = m[2].replace('.', '');
      const mm = MES[mkey] ?? MES[mkey.normalize('NFD').replace(/[\u0300-\u036f]/g,'')];
      if (mm != null) {
        let year = today.getFullYear();
        const cand = new Date(year, mm, dd);
        if (+cand > +today) year -= 1;
        return +new Date(year, mm, dd);
      }
    }
    return null;
  }

  // ===== “meus” nomes (sem hardcode) =====
  const MY = { names: new Set() };
  function addMyName(nm) { if (!nm) return; MY.names.add(norm(nm)); }

  function getNameFromThreadIndicator(groupEl) {
    const a11y = groupEl?.querySelector('.msg-s-event-listitem--group-a11y-heading, .visually-hidden');
    const t = trim1(a11y?.innerText || a11y?.textContent || '');
    const m = t.match(/^(.+?)\s+enviou as seguintes mensagens/i);
    if (m && m[1]) return trim1(m[1]);
    return '';
  }
  function getNameFromGroupMeta(groupEl) {
    const nameEl = groupEl?.querySelector('.msg-s-message-group__name, .msg-s-message-group__profile-link');
    const altEl  = groupEl?.querySelector('img[alt]');
    return trim1(nameEl?.innerText || nameEl?.textContent || altEl?.getAttribute('alt') || '');
  }
  function learnMyNameFromThread() {
    const inds = [...document.querySelectorAll(
      '[data-test-msg-cross-pillar-message-sending-indicator-presenter__container], .msg-s-event-with-indicator__sending-indicator--sent'
    )];
    for (const ind of inds) {
      const group = ind.closest('.msg-s-message-group, .msg-s-event-listitem, .msg-conversation__row, li');
      const n1 = getNameFromThreadIndicator(group);
      if (n1) addMyName(n1);
      const n2 = getNameFromGroupMeta(group);
      if (n2) addMyName(n2);
    }
  }
  function learnMyNameFromGlobalNav() {
    const img = document.querySelector('img.global-nav__me-photo[alt], [data-test-global-nav-link="me"] img[alt]');
    const alt = trim1(img?.getAttribute('alt') || '');
    if (alt) {
      const m = alt.match(/(?:foto de|perfil de)\s+(.+)/i);
      addMyName(m ? m[1] : alt);
    }
  }
  async function loadSavedNames() {
    return new Promise(res => storage?.get(['myNameAutoSet'], d => {
      const arr = Array.isArray(d?.myNameAutoSet) ? d.myNameAutoSet : [];
      res(arr);
    }) ?? res([]));
  }
  async function saveNames() {
    try { storage?.set({ myNameAutoSet: Array.from(MY.names) }); } catch {}
  }

  // ===== thread + scroll =====
  function getThreadContainer() {
    return document.querySelector('.msg-s-message-list, .msg-conversation__message-list') || document.body;
  }
  function getThreadScroller() {
    return document.querySelector('.msg-s-message-list-container') ||
           document.querySelector('.msg-s-message-list')?.parentElement ||
           getThreadContainer();
  }
  function isColumnReversed() {
    const sc = getThreadScroller();
    return sc?.classList?.contains('msg-s-message-list-container--column-reversed') || false;
  }
  function absY(el, root) {
    try {
      const r1 = el.getBoundingClientRect();
      const r2 = root.getBoundingClientRect();
      const scrollY = root.scrollTop || window.scrollY || 0;
      return (r1.top - r2.top) + scrollY;
    } catch { return el.offsetTop || 0; }
  }

  async function ensureLatestLoaded() {
    const scroller = getThreadScroller();
    if (!scroller) return;

    const topSentinel = document.querySelector('.msg-s-message-list__top-of-list');
    const bottomSentinel = document.querySelector('.msg-s-message-list__bottom-of-list');
    const reversed = isColumnReversed();

    const signatureTail = () => {
      const rows = collectMessageRows();
      const tail = rows.slice(-3).map(r => (r.senderNameRaw||'') + '|' + (r.timeText||'') + '|' + (r.headingText||'') + '|' + (r.body||'')).join('||');
      return tail;
    };

    let stable = 0;
    let lastSig = '';
    for (let i = 0; i < 6; i++) {
      if (reversed) {
        if (topSentinel) { try { topSentinel.scrollIntoView({ behavior:'instant', block:'start' }); } catch {} }
        scroller.scrollTop = 0;
      } else {
        if (bottomSentinel) { try { bottomSentinel.scrollIntoView({ behavior:'instant', block:'end' }); } catch {} }
        scroller.scrollTop = scroller.scrollHeight;
      }
      await sleep(300);
      const sig = signatureTail();
      stable = (sig === lastSig) ? (stable + 1) : 0;
      lastSig = sig;
      if (stable >= 2) break;
    }
  }

  // ===== coleta de mensagens + cálculo de timestamp =====
  function collectMessageRows() {
    const root = getThreadContainer();
    let rows = [...document.querySelectorAll('li.msg-s-message-list__event, .msg-s-event-listitem, .msg-conversation__row, [data-event-urn]')];
    rows = rows.filter(el => el && el.offsetParent !== null && el.querySelector('.msg-s-event-listitem__message-bubble'));

    const heads = [...document.querySelectorAll('.msg-s-message-list__time-heading')].filter(visible);
    const headPos = heads.map(h => ({ el:h, y:absY(h, root), text: trim1(h.innerText || h.textContent || '') }))
                         .sort((a,b)=>a.y-b.y);

    return rows.map(el => {
      const bubble = el.querySelector('.msg-s-event-listitem__message-bubble');

      let indicator =
        bubble?.nextElementSibling?.matches?.('.msg-s-event-with-indicator__sending-indicator--sent, [data-test-msg-cross-pillar-message-sending-indicator-presenter__container]')
          ? bubble.nextElementSibling
          : null;
      if (!indicator) {
        indicator = el.querySelector('.msg-s-event-with-indicator__sending-indicator--sent, [data-test-msg-cross-pillar-message-sending-indicator-presenter__container]');
      }

      const nameFromMeta = getNameFromGroupMeta(el);
      const nameFromA11y = getNameFromThreadIndicator(el);
      const senderNameRaw  = nameFromMeta || nameFromA11y;
      const senderNameNorm = norm(senderNameRaw);

      let sentMs = null;
      if (indicator) {
        const t = indicator.getAttribute('title') || indicator.getAttribute('aria-label') || '';
        sentMs = parseTitlePtBr(t);
      }

      const timeText = trim1(el.querySelector('.msg-s-message-group__timestamp, time.msg-s-message-group__timestamp')?.innerText || '');
      const y = absY(bubble, root);

      let headingText = '';
      for (let i = headPos.length - 1; i >= 0; i--) {
        if (headPos[i].y <= y + 2) { headingText = headPos[i].text; break; }
      }

      const body = trim1(
        el.querySelector('.msg-s-event-listitem__body, .msg-s-event__content, p')?.innerText ||
        el.innerText || ''
      );

      let tsMillis = sentMs;
      if (tsMillis == null && headingText) {
        const dayMs = parseHeadingPtBrToDate(headingText);
        if (dayMs != null) {
          if (timeText) {
            const m = timeText.match(/(\d{1,2}):(\d{2})/);
            const d = new Date(dayMs);
            if (m) d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
            else   d.setHours(12,0,0,0);
            tsMillis = +d;
          } else {
            const d = new Date(dayMs); d.setHours(12,0,0,0); tsMillis = +d;
          }
        }
      }

      return { el, bubble, indicator, senderNameRaw, senderNameNorm, timeText, headingText, body, y, tsMillis };
    });
  }

  function collectMessageRowsOrdered() {
    const rows = collectMessageRows();
    const root = getThreadContainer();
    rows.forEach(r => r.y = absY(r.bubble, root));
    rows.sort((a,b)=>a.y - b.y);
    return rows;
  }

  function isRowMine(row) {
    if (!row) return false;
    if (row.indicator) return true;
    const myNames = Array.from(MY.names);
    return myNames.some(n => n && row.senderNameNorm === n);
  }

  function getMostRecentByTimestamp() {
    const rows = collectMessageRows();
    if (!rows.length) return { row:null, why:'sem_rows' };
    const withTs = rows.filter(r => typeof r.tsMillis === 'number' && !isNaN(r.tsMillis));
    if (withTs.length) {
      withTs.sort((a,b)=>a.tsMillis - b.tsMillis);
      return { row: withTs[withTs.length-1], why:'ts' };
    }
    const vis = collectMessageRowsOrdered();
    return { row: vis[vis.length-1] || rows[rows.length-1], why:'visual' };
  }

  // ===== confirmação de envio =====
  function countMyBubbles() {
    const rows = collectMessageRows();
    return rows.reduce((acc, r) => acc + (isRowMine(r) ? 1 : 0), 0);
  }
  const sanitize = (s='') => trim1(s).replace(/\s+/g,' ').slice(0, 280);

  async function confirmSent(expectedText, prevCount, timeoutMs = 12000) {
    const start = Date.now();
    const exp = sanitize(expectedText);
    while (Date.now() - start < timeoutMs) {
      const toastErr = document.querySelector('.artdeco-toast-item--error, .msg-form__error, [data-test-msg-error-toast]');
      if (toastErr && visible(toastErr)) return false;

      const nowCount = countMyBubbles();
      if (nowCount > prevCount) return true;

      const rows = collectMessageRowsOrdered();
      const last = rows[rows.length - 1];
      if (last && isRowMine(last)) {
        const body = sanitize(last.body || '');
        if (body && exp && (body.includes(exp) || exp.includes(body.slice(0, Math.min(body.length, 80))))) {
          return true;
        }
      }
      await sleep(220);
    }
    return false;
  }

  // ===== composer / envio (com digitação humana lenta) =====
  function dispatchKey(el, type, key, opt={}) {
    try {
      el.dispatchEvent(new KeyboardEvent(type, { key, code: key.length===1 ? `Key${key.toUpperCase()}` : key, bubbles:true, cancelable:true, ...opt }));
    } catch {}
  }
  function beforeInput(el, data, inputType='insertText') {
    try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles:true, cancelable:true, data, inputType })); } catch {}
  }
  function doInput(el, data, inputType='insertText') {
    try { el.dispatchEvent(new InputEvent('input', { bubbles:true, cancelable:true, data, inputType })); }
    catch { el.dispatchEvent(new Event('input', { bubbles:true, cancelable:true })); }
  }

  async function getComposerBox() {
    const sel = () => {
      const cand = [
        'form.msg-form textarea[name="message"]',
        'form.msg-form textarea.msg-form__textarea',
        'form.msg-form .msg-form__textarea',
        'form.msg-form div.msg-form__contenteditable[contenteditable="true"]',
        'form.msg-form div[contenteditable="true"][role="textbox"]',
        'div[aria-label^="Escreva"]',
        'div[aria-label^="Write"]',
      ];
      for (const s of cand) {
        const el = document.querySelector(s);
        if (el && visible(el)) return el;
      }
      const any = [...document.querySelectorAll('textarea, div[contenteditable="true"]')].find(el => visible(el) && el.closest('.msg-form'));
      return any || null;
    };
    return await waitFor(sel, 12000, 200);
  }
  async function ensureComposerReady(box) {
    try { box.scrollIntoView({ behavior:'smooth', block:'end' }); } catch {}
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const disabled = box.getAttribute('aria-disabled');
      if (!disabled || disabled === 'false') break;
      await sleep(120);
    }
    try { box.focus(); } catch {}
    await sleep(jitter(220, 160));
  }
  async function clearComposer(el) {
    try {
      // método cross: selectAll + delete para contenteditable/textarea
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      beforeInput(el, null, 'deleteByCut');
      document.execCommand?.('delete');
    } catch {}
    const isTa = el.tagName === 'TEXTAREA' || (el.matches && el.matches('textarea, .msg-form__textarea'));
    if (isTa) el.value = ''; else el.textContent = '';
    doInput(el, '', 'insertReplacementText');
    await sleep(1);
  }

  async function typeChar(el, ch) {
    dispatchKey(el, 'keydown', ch);
    beforeInput(el, ch, 'insertText');

    const isTa = el.tagName === 'TEXTAREA' || (el.matches && el.matches('textarea, .msg-form__textarea'));
    if (isTa) el.value += ch;
    else {
      // tenta comando do browser (melhor p/ contenteditable)
      try { document.execCommand('insertText', false, ch); }
      catch { el.textContent = (el.textContent || '') + ch; }
    }
    doInput(el, ch, 'insertText');
    dispatchKey(el, 'keyup', ch);

    // pausas humanas
    if (ch === ' ') {
      await sleep(randBetween(TYPE_PROFILE.spaceMin, TYPE_PROFILE.spaceMax));
    } else if (isPunct(ch)) {
      await sleep(randBetween(TYPE_PROFILE.punctMin, TYPE_PROFILE.punctMax));
    } else if (ch === '\n') {
      await sleep(randBetween(TYPE_PROFILE.sentenceMin, TYPE_PROFILE.sentenceMax));
    } else {
      await sleep(randBetween(TYPE_PROFILE.charMin, TYPE_PROFILE.charMax));
    }
  }

  async function humanType(el, text) {
    await clearComposer(el);

    // uma "respiração" antes de começar
    await sleep(randBetween(220, 420));

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      await typeChar(el, ch);
      // pausa extra no fim de frase
      if (/[.!?]/.test(ch) && (i+1 < text.length) && /\s/.test(text[i+1] || '')) {
        await sleep(randBetween(TYPE_PROFILE.sentenceMin, TYPE_PROFILE.sentenceMax));
      }
    }
    // blur/focus para alguns listeners reativos habilitarem botão
    try { el.blur(); } catch {}
    await sleep(randBetween(120, 220));
    try { el.focus(); } catch {}
    await sleep(randBetween(140, 240));
    return true;
  }

  async function findSendButton() {
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {
      let b = document.querySelector('form.msg-form .msg-form__send-button');
      if (b && visible(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;

      b = [...document.querySelectorAll('form.msg-form button')].find(btn => {
        if (!visible(btn)) return false;
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
        const txt  = (btn.innerText || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
        return (txt === 'enviar' || txt === 'send' || aria.includes('enviar') || aria.includes('send'));
      });
      if (b) return b;

      const dcn = document.querySelector('form.msg-form button[data-control-name="send"]');
      if (dcn && visible(dcn) && !dcn.disabled && dcn.getAttribute('aria-disabled') !== 'true') return dcn;

      const primary = document.querySelector('form.msg-form button.artdeco-button--primary');
      if (primary && visible(primary) && !primary.disabled && primary.getAttribute('aria-disabled') !== 'true') return primary;

      await sleep(120);
    }
    return null;
  }

  async function nudgeEnableSend(box, cycles = 5) {
    for (let i = 0; i < cycles; i++) {
      let btn = await findSendButton();
      if (btn) return true;

      // micro edição: espaço NBSP e apaga
      beforeInput(box, ' ', 'insertText');
      if (box.tagName === 'TEXTAREA' || (box.matches && box.matches('textarea, .msg-form__textarea'))) {
        box.value += ' ';
      } else {
        try { document.execCommand('insertText', false, ' '); }
        catch { box.textContent = (box.textContent || '') + ' '; }
      }
      doInput(box, ' ', 'insertText');
      await sleep(randBetween(90, 140));

      // apaga o espaço
      dispatchKey(box, 'keydown', 'Backspace');
      beforeInput(box, null, 'deleteContentBackward');
      if (box.tagName === 'TEXTAREA' || (box.matches && box.matches('textarea, .msg-form__textarea'))) {
        box.value = box.value.slice(0, -1);
      } else {
        try { document.execCommand('delete'); }
        catch { box.textContent = (box.textContent || '').slice(0, -1); }
      }
      doInput(box, null, 'deleteContentBackward');
      dispatchKey(box, 'keyup', 'Backspace');
      await sleep(randBetween(120, 200));

      // blur/focus alternado
      try { box.blur(); } catch {}
      await sleep(randBetween(120, 220));
      try { box.focus(); } catch {}
      await sleep(randBetween(140, 220));
    }
    return !!(await findSendButton());
  }

  async function fillComposer(text) {
    const box = await getComposerBox();
    if (!box) return false;
    await ensureComposerReady(box);

    await humanType(box, text);

    // tentativa forte de habilitar o botão
    const ok = await nudgeEnableSend(box, 6);
    if (!ok) {
      // último recurso: insere \n e remove
      beforeInput(box, '\n', 'insertParagraph');
      if (box.tagName === 'TEXTAREA' || (box.matches && box.matches('textarea, .msg-form__textarea'))) {
        box.value += '\n';
      } else {
        try { document.execCommand('insertParagraph'); }
        catch { box.textContent = (box.textContent || '') + '\n'; }
      }
      doInput(box, '\n', 'insertParagraph');
      await sleep(randBetween(140, 240));

      // remove a quebra
      dispatchKey(box, 'keydown', 'Backspace');
      beforeInput(box, null, 'deleteContentBackward');
      if (box.tagName === 'TEXTAREA' || (box.matches && box.matches('textarea, .msg-form__textarea'))) {
        box.value = box.value.replace(/\n+$/,'');
      } else {
        try { document.execCommand('delete'); }
        catch { box.textContent = (box.textContent || '').replace(/\n+$/,''); }
      }
      doInput(box, null, 'deleteContentBackward');
      dispatchKey(box, 'keyup', 'Backspace');
      await sleep(randBetween(120, 220));
    }

    return true;
  }

  async function trySendOnce() {
    let btn = await findSendButton();
    if (btn) {
      try {
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true }));
        btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles:true, cancelable:true }));
        await sleep(randBetween(60, 140));
        btn.click();
        return true;
      } catch {}
    }

    const form = document.querySelector('form.msg-form');
    if (form) {
      try { form.requestSubmit?.(); await sleep(150); btn = await findSendButton(); if (!btn) return true; } catch {}
    }

    const box = await getComposerBox();
    if (box) {
      // Enter
      dispatchKey(box, 'keydown', 'Enter');
      box.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true }));
      box.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', bubbles:true }));
      await sleep(jitter());
      btn = await findSendButton();
      if (!btn) return true;
      try { btn.click(); return true; } catch {}

      // Ctrl+Enter
      box.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true, ctrlKey:true }));
      box.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', bubbles:true, ctrlKey:true }));
      await sleep(jitter());
      btn = await findSendButton();
      if (!btn) return true;

      // Meta+Enter (mac)
      box.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true, metaKey:true }));
      box.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', code:'Enter', bubbles:true, metaKey:true }));
      await sleep(jitter());
      btn = await findSendButton();
      if (!btn) return true;
    }
    return false;
  }

  // ===== estado =====
  async function getState() {
    return new Promise(res => (storage || { get: (_k,cb)=>cb({}) })
      .get(['customMessage','sendLimit','sentThreads','progress','logs','myNameAutoSet'], res));
  }
  function pruneSentThreads(map) {
    const now = Date.now(), out = {};
    for (const [k, ts] of Object.entries(map || {})) {
      if (typeof ts === 'number' && now - ts < KEEP_DAYS*24*60*60*1000) out[k] = ts;
    }
    return out;
  }
  function threadStableKey() {
    const name = (getThreadTitleName() || '').toLowerCase();
    const primaryProfileHref = document.querySelector('.msg-s-profile-card-one-to-one a[href*="/in/"]')?.getAttribute('href') || '';
    return `t:${name}|h:${primaryProfileHref.toLowerCase()}`;
  }

  // valida uma entrada sentThreads no thread atual; retorna true para “confirmado (pode pular)”
  function confirmAlreadySentByMemory(memTs) {
    const rows = collectMessageRowsOrdered();
    if (!rows.length) return false;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (!isRowMine(r)) continue;
      if (typeof r.tsMillis === 'number' && !isNaN(r.tsMillis)) {
        if (r.tsMillis >= (memTs - 2*60*1000)) return true;
        return false;
      }
      return false;
    }
    return false;
  }

  // ===== loop principal =====
  async function run() {
    const state = await getState();
    const customMessage = state?.customMessage || '';
    const sendLimit     = (Number.isFinite(+state?.sendLimit) && +state.sendLimit > 0) ? +state.sendLimit : 5;
    let sentThreads     = pruneSentThreads(state?.sentThreads || {});
    let sent            = 0;
    let progress        = typeof state?.progress === 'number' ? state.progress : 0;

    (await loadSavedNames()).forEach(n => addMyName(n));
    learnMyNameFromGlobalNav();

    const root = listRoot();
    if (root && typeof root.scrollTop === 'number') {
      root.scrollTo({ top: 0, behavior: 'smooth' });
      await sleep(600);
    }

    const visited = new Set();
    let pass = 0;

    while (sent < sendLimit && !(await shouldStop()) && pass < 120) {
      pass++;
      const cards = collectCards(800);
      if (!cards.length) {
        hudSet('Nenhum card visível — rolando…');
        window.scrollBy({ top: 700, behavior: 'smooth' });
        await sleep(800);
        continue;
      }

      hudSet(`Varredura ${pass} • cards: ${cards.length} • enviados: ${sent}/${sendLimit}`);

      for (let idx = 0; idx < cards.length; idx++) {
        if (sent >= sendLimit || (await shouldStop())) break;
        const item = cards[idx];
        if (visited.has(item.key)) continue;

        // abre e aguarda
        const opened = await openCardAndWaitActive(item);
        if (!opened) { visited.add(item.key); hudSet(`Card ${idx+1}/${cards.length} não abriu → pular`); await sleep(jitter(320, 160)); continue; }

        await ensureLatestLoaded();
        learnMyNameFromThread();
        await saveNames();

        const tKey = threadStableKey();

        // memória: valida no thread; se não confirmar, limpa e segue
        const memTs = sentThreads[tKey];
        if (memTs) {
          const confirmed = confirmAlreadySentByMemory(memTs);
          if (confirmed) {
            visited.add(item.key);
            hudSet(`Card ${idx+1}: já enviado (confirmado no thread) → pular`);
            await sleep(jitter(220, 120));
            continue;
          } else {
            log('memória stale removida para', tKey, 'ts=', memTs);
            delete sentThreads[tKey];
            try { storage?.set({ sentThreads }); } catch {}
          }
        }

        await waitFor('.msg-s-message-list, .msg-conversation__message-list', 8000, 200);

        // decide última mensagem
        const { row:lastRow, why:pickWhy } = getMostRecentByTimestamp();
        if (!lastRow) { visited.add(item.key); hudSet(`Card ${idx+1}: sem mensagens → pular`); await sleep(jitter(200, 120)); continue; }

        const lastIsMine = isRowMine(lastRow);
        let ts = lastRow.tsMillis;

        if (ts == null) {
          const vis = collectMessageRowsOrdered();
          const fallback = vis[vis.length - 1];
          if (fallback) {
            const dayMs = parseHeadingPtBrToDate(fallback.headingText);
            if (dayMs != null) {
              const m = (fallback.timeText||'').match(/(\d{1,2}):(\d{2})/);
              const d = new Date(dayMs);
              if (m) d.setHours(parseInt(m[1],10), parseInt(m[2],10), 0, 0);
              else   d.setHours(12,0,0,0);
              ts = +d;
            }
          }
        }

        if (!lastIsMine) {
          visited.add(item.key);
          hudSet(`Card ${idx+1}: última não é sua (modo=${pickWhy}) → pular`);
          await sleep(jitter(220, 120));
          continue;
        }

        if (ts == null || (Date.now() - ts) < THREE_DAYS_MS) {
          visited.add(item.key);
          const dias = ts ? ((Date.now() - ts) / (24*60*60*1000)).toFixed(1) : 'NA';
          hudSet(`Card ${idx+1}: < 3 dias (${dias}) ou data indefinida → pular`);
          await sleep(jitter(220, 120));
          continue;
        }

        // preencher e enviar (digitação humana + garantia do botão)
        const text = personalize(customMessage);
        const filled = await fillComposer(text);
        if (!filled) { visited.add(item.key); hudSet(`Card ${idx+1}: composer não encontrado → pular`); await sleep(jitter(260, 120)); continue; }

        const preCount = countMyBubbles();

        let ok = await trySendOnce();
        let confirmed = ok && await confirmSent(text, preCount, 12000);

        if (!confirmed) {
          hudSet(`Card ${idx+1}: re-tentando envio…`);
          await sleep(randBetween(220, 380));
          ok = await trySendOnce();
          confirmed = ok && await confirmSent(text, preCount, 9000);
        }

        if (!confirmed) {
          visited.add(item.key);
          hudSet(`Card ${idx+1}: envio falhou → pular`);
          await sleep(jitter(280, 140));
          continue;
        }

        // sucesso
        sent++;
        visited.add(item.key);
        sentThreads[tKey] = Date.now(); // só grava após confirmação real
        progress = (typeof progress === 'number' ? progress : 0) + 1;

        const firstName = safeFirstName(getThreadTitleName() || CURRENT_CARD_NAME);
        hudSet(`Enviado ${sent}/${sendLimit} → ${firstName || '(sem nome)'}`);

        storage && storage.get(['logs'], (res) => {
          const logs = res?.logs || [];
          const threadUrl = location.href.includes('/messaging/thread/') ? location.href : '';
          logs.push({
            nome: firstName,
            tipo: 'mensagem_followup_thread',
            data: new Date().toISOString(),
            threadUrl
          });
          storage.set({ logs, progress, sentThreads, myNameAutoSet: Array.from(MY.names) });
        });

        await sleep(jitter(900, 400));
        // +PACER (Follow-ups)
        if (window.__pacer?.between) { try { await window.__pacer.between('followups'); } catch(e) {} }

      }

      if (root && typeof root.scrollTop === 'number') root.scrollTop += Math.floor((root.clientHeight || 600) * 0.85);
      else window.scrollBy({ top: 800, behavior: 'smooth' });
      await sleep(jitter(800, 300));
    }

    hudSet(`Concluído. Total enviados: ${sent}`);
  }

  run().catch(err => { console.error('[ViralMind][followups] erro:', err); hudSet('Erro — ver console'); });
})();
