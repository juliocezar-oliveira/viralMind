// send_new_contacts.js — inclui log "primeira_mensagem" no chrome.storage.local (ajustado para capturar nome/cargo/localidade/perfil de forma resiliente)
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

  if (window.__PUC_SEND_INCLUDED__) return;
  window.__PUC_SEND_INCLUDED__ = true;

  const CFG = {
    POPUP_FEATURES: "popup,width=900,height=800",
    SCAN_LIMIT: 60
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const visible = (el) => !!(el && el.offsetParent !== null);

  function cleanName(raw) {
    if (!raw) return null;
    let t = raw.replace(/\s+/g, " ").trim();
    t = t
      .replace(/^Mensagem\s+para\s+/i, "")
      .replace(/^Message\s+to\s+/i, "")
      .replace(/^Mensagem\s*/i, "")
      .replace(/^Message\s*/i, "")
      .replace(/^Ver perfil de\s+/i, "")
      .replace(/^View profile of\s+/i, "");
    if (!t || /^mensagem$/i.test(t) || /^message$/i.test(t)) return null;
    t = t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    return t || null;
  }
  function toFirstName(full) {
    if (!full) return null;
    const parts = full.split(/\s+/).filter(Boolean);
    return parts[0] || null;
  }

  function getNameFromAriaLabel(el) {
    const label = el.getAttribute?.("aria-label") || "";
    return cleanName(label);
  }
  function getNameFromCard(el) {
    const card = el.closest?.('li, .mn-connection-card, .artdeco-list__item, .entity-result, .reusable-search__result-container, .mn-contacts-list__item, .mn-pymk-list__card');
    if (!card) return null;
    const candSel = [
      '.mn-connection-card__name',
      'a[href*="/in/"] span[dir="ltr"]',
      'a[href*="/in/"]',
      '.entity-result__title-text span[dir="ltr"]',
      'span[dir="ltr"].t-16',
      'span[dir="ltr"]'
    ].join(',');
    const cand = card.querySelector(candSel);
    return cleanName(cand?.textContent || null);
  }

  // [NOVO] extrai infos resilientes do card de origem para fallback no log
  function extractFromCard(el){
    const card = el.closest?.('li, .mn-connection-card, .artdeco-list__item, .entity-result, .reusable-search__result-container, .mn-contacts-list__item, .mn-pymk-list__card');
    if (!card) return { profileUrl: "", cargo: "", localidade: "" };
    const profA = card.querySelector('a[href*="/in/"]');
    const profileUrl = profA?.href || "";
    const cargoEl = card.querySelector('.entity-result__primary-subtitle, .mn-connection-card__occupation, .artdeco-entity-lockup__subtitle, .t-12.t-black--light');
    const cargo = cargoEl?.textContent?.trim() || "";
    const locEl = card.querySelector('.entity-result__secondary-subtitle, .mn-connection-card__details li.t-12, .artdeco-entity-lockup__caption');
    const localidade = locEl?.textContent?.trim() || "";
    return { profileUrl, cargo, localidade };
  }

  function getComposeTargets(limit = CFG.SCAN_LIMIT) {
    const anchors = Array.from(document.querySelectorAll(
      'a[aria-label*="Mensagem"][href*="/messaging/compose/"], a[aria-label*="Message"][href*="/messaging/compose/"]'
    )).map(a => {
      const name = getNameFromAriaLabel(a) || getNameFromCard(a);
      const { profileUrl, cargo, localidade } = extractFromCard(a);
      return { name, url: a.href, cardEl: a, profileUrl, cargo, localidade };
    });

    const btns = Array.from(document.querySelectorAll(
      'button[aria-label*="Mensagem"], button[aria-label*="Message"]'
    )).map(b => {
      const a = b.closest('li,div,section')?.querySelector('a[href*="/messaging/compose/"]');
      if (!a) return null;
      const name = getNameFromAriaLabel(b) || getNameFromCard(b);
      const { profileUrl, cargo, localidade } = extractFromCard(b);
      return { name, url: a.href, cardEl: b, profileUrl, cargo, localidade };
    }).filter(Boolean);

    const all = [...anchors, ...btns].filter(t => !!t.url);
    const seen = new Set();
    const uniq = [];
    for (const t of all) { if (!seen.has(t.url)) { seen.add(t.url); uniq.push(t); } }
    return uniq.slice(0, limit);
  }

  async function waitWindowReady(w, timeoutMs = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        if (w.document && w.document.readyState === "complete") return true;
      } catch {}
      await sleep(100);
    }
    return false;
  }
  async function isExistingThread(w, observeMs = 12000) {
    const t0 = Date.now();
    while (Date.now() - t0 < observeMs) {
      try {
        if (w.location?.pathname.includes("/messaging/thread/")) return true;
      } catch {}
      await sleep(120);
    }
    try {
      const doc = w.document;
      const list = doc.querySelector('.msg-s-message-list, .msg-s-message-list-content, .msg-conversation-list__events');
      if (list && list.querySelectorAll('.msg-s-message-list__event, li, .msg-event').length > 0) return true;
    } catch {}
    return false;
  }
// === Preferência & histórico local (adição mínima) ===
async function getSkipIfSentPref(){
  try {
    const p = await new Promise(res => chrome.storage.local.get(["skipIfSent","skip-if-sent"], res));
    return !!( (p && (p.skipIfSent !== undefined ? p.skipIfSent : p["skip-if-sent"])) ?? true );
  } catch { return true; }
}

async function hasLocalHistory(profileUrl, name){
  try{
    const acc = ((profileUrl||"").match(/\/in\/([^\/?#]+)/i) || [])[1] || "";
    const p = await new Promise(res => chrome.storage.local.get(["logs"], res));
    const logs = Array.isArray(p?.logs) ? p.logs : [];
    const low = s => (s||"").toLowerCase();
    return logs.some(l => {
      const sameAcc  = acc && l?.conta && low(l.conta) === low(acc);
      const sameProf = profileUrl && l?.profileUrl && low(l.profileUrl) === low(profileUrl);
      const sameName = name && l?.nome && low(l.nome) === low(name);
      return sameAcc || sameProf || sameName;
    });
  } catch { return false; }
}


  function getNameFromComposeWindow(w) {
    const selList = [
      '.msg-connections-typeahead__added-recipients .artdeco-pill__text',
      '.msg-connections-typeahead__added-recipients [data-test-reusable-position-entity-name]',
      '.msg-connections-typeahead__added-recipients li span',
      '.msg-connections-typeahead__recipient span',
      '.msg-entity-lockup__entity-title',
      '.msg-entity-lockup__title',
      'header .msg-entity-lockup__title',
      'header h2.t-16.t-black.t-bold',
      // variações mais novas
      '.artdeco-pill--choice .artdeco-pill__text',
      'header .artdeco-entity-lockup__title',
    ];
    for (const s of selList) {
      try {
        const el = w.document.querySelector(s);
        const txt = cleanName(el?.textContent || "");
        if (txt) return txt;
      } catch {}
    }
    return null;
  }
  function getProfileFromCompose(w) {
    try {
      const a = w.document.querySelector('a[href*="/in/"]');
      if (a && a.href) return a.href;
      // às vezes vem num avatar/ancora no header
      const headerA = w.document.querySelector('header a[href*="/in/"]');
      return headerA ? headerA.href : "";
    } catch { return ""; }
  }
  function getCargoFromCompose(w) {
    try {
      const el = w.document.querySelector('.msg-entity-lockup__entity-subtitle, .msg-entity-lockup__subtitle, .artdeco-entity-lockup__subtitle');
      return el ? el.textContent.trim() : "";
    } catch { return ""; }
  }
  function getLocalidadeFromCompose(w) {
    try {
      const el = w.document.querySelector('.msg-entity-lockup__entity-badge, .artdeco-list__item span.t-12');
      return el ? el.textContent.trim() : "";
    } catch { return ""; }
  }

  async function typeInEditor(w, editor, text) {
    editor.focus();
    w.document.execCommand("selectAll", false, null);
    w.document.execCommand("delete", false, null);
    const ok = w.document.execCommand("insertText", false, text);
    if (!ok) {
      editor.textContent = text;
      editor.dispatchEvent(new w.InputEvent("input", { bubbles: true, data: text }));
      editor.dispatchEvent(new w.Event("change", { bubbles: true }));
    }
    await sleep(200);
  }

  function templateFromStorage(firstName, fallbackDefault) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["customMessage"], (res) => {
          const t = (res && res.customMessage) ? String(res.customMessage) : "";
          if (!t) return resolve(fallbackDefault);
          if (t.includes("{name}")) {
            resolve(t.replace(/\{name\}/g, firstName || ""));
          } else {
            resolve(t); // envia como está se não houver placeholder
          }
        });
      } catch {
        resolve(fallbackDefault);
      }
    });
  }

  async function sendViaCompose(target, limitObj) {
    const w = window.open(target.url, "_blank", CFG.POPUP_FEATURES);
    if (!w) return { sent: false, reason: "popup_blocked" };
    if (!(await waitWindowReady(w))) { try { w.close(); } catch {} return { sent: false, reason: "not_ready" }; }
    if (await isExistingThread(w)) { try { w.close(); } catch {} return { sent: false, reason: "existing_thread" }; }

    const q = (sel) => { try { return w.document.querySelector(sel); } catch { return null; } };
    const vis = (el) => el && el.offsetParent !== null;

    const composeName = cleanName(getNameFromComposeWindow(w));
    const finalFirstName = toFirstName(composeName || target.name);

    // [AJUSTE] fallback para origem quando o compose não expõe tudo
    const profileUrl = getProfileFromCompose(w) || target.profileUrl || "";
    const cargo = getCargoFromCompose(w) || target.cargo || "";
    const localidade = getLocalidadeFromCompose(w) || target.localidade || "";

    // encontra editor
    let editor = null, sendBtn = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      editor = q('div[contenteditable="true"][role="textbox"], div.msg-form__contenteditable[contenteditable="true"]');
      sendBtn = q('button.msg-form__send-button, button[aria-label="Enviar"], button[aria-label="Send"]');
      if (editor && vis(editor)) break;
      await sleep(100);
    }
    if (!editor) { try { w.close(); } catch {} return { sent: false, reason: "no_editor" }; }

    // monta mensagem (custom do popup > default com nome > default genérico)
    const DEFAULT_WITH_NAME = (fn) => `Olá ${fn}, espero que esteja bem. Sou o Presidente Regional da PUC angels Grande São Paulo.\n\nEstamos expandindo nossa rede de líderes e inovadores. Gostaria de te convidar para conhecer a Associação PUC angels e como podemos juntos fortalecer ainda mais esse ecossistema.`;
    const DEFAULT_GENERIC = `Olá, espero que esteja bem. Sou o Presidente Regional da PUC angels Grande São Paulo.\n\nEstamos expandindo nossa rede de líderes e inovadores. Gostaria de te convidar para conhecer a Associação PUC angels e como podemos juntos fortalecer ainda mais esse ecossistema.`;
    const fallback = finalFirstName ? DEFAULT_WITH_NAME(finalFirstName) : DEFAULT_GENERIC;
    const msg = await templateFromStorage(finalFirstName, fallback);

    await typeInEditor(w, editor, msg);

    if (sendBtn && vis(sendBtn)) sendBtn.click();
    else editor.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));

    // registra log "primeira_mensagem"
    try {
      const nomeCompleto = composeName || target.name || (profileUrl ? decodeURIComponent((/\/in\/([^\/?#]+)/.exec(profileUrl)||[])[1]||"").replace(/-/g,' ') : "");
      const nowISO = new Date().toISOString();
      chrome.storage.local.get(["logs"], (res) => {
        const logs = Array.isArray(res?.logs) ? res.logs.slice() : [];
        logs.push({
          tipo: "primeira_mensagem",
          nome: nomeCompleto || "",
          cargo: cargo || "",
          localidade: localidade || "",
          conta: ((profileUrl.match(/\/in\/([^\/?#]+)/i) || [])[1] || ""),
          profileUrl: profileUrl || "",
          threadUrl: "",
          data: nowISO
        });
        chrome.storage.local.set({ logs });
      });
    } catch(e) {
      console.warn("[PUC Angels] Falha ao registrar log:", e);
    }

    await sleep(800);
    try { w.close(); } catch {}
    limitObj.sent++;
    return { sent: true, usedName: finalFirstName || null };
  }

  // API pública
  window.puclangelsSendMessages = async function(){
    try {
      // define limite via storage (se existir) ou default 2
      const limitObj = { sent: 0, max: 2 };
      try {
        const p = await new Promise(res => chrome.storage.local.get(["sendLimit"], res));
        const lim = parseInt(p?.sendLimit || "2", 10);
        if (Number.isFinite(lim) && lim > 0) limitObj.max = lim;
      } catch {}

      // render básico
      window.scrollTo(0, 0);
      await sleep(200);
      for (let i = 0; i < 3; i++) { window.scrollBy(0, 1400); await sleep(250); }

      
      const SKIP_IF_SENT = await getSkipIfSentPref();
const targets = getComposeTargets(CFG.SCAN_LIMIT);
      if (!targets.length) {
        console.warn("[PUC Angels] Nenhum alvo /messaging/compose/ encontrado.");
        return { sent: 0, total: 0 };
      }

      for (const t of targets) {
        if (SKIP_IF_SENT) {
          const already = await hasLocalHistory(t.profileUrl || t.url, t.name);
          if (already) { 
            console.debug("[PUC Angels] Pulado por histórico local:", t.name || t.profileUrl || t.url);
            continue;
          }
        }

        if (limitObj.sent >= limitObj.max) break;
        const res = await sendViaCompose(t, limitObj);
        if (!res.sent && res.reason !== "existing_thread") {
          console.warn("[PUC Angels] Falha:", res.reason || "unknown");
        }
        await sleep(200);
        // +PACER (Mensagens diretas)
        if (window.__pacer?.between) { try { await window.__pacer.between('mensagens'); } catch(e) {} }
      }

      console.log(`[PUC Angels] Concluído. Enviadas: ${limitObj.sent}/${limitObj.max}.`);
      return { sent: limitObj.sent, total: limitObj.max };
    } catch (e) {
      console.error("[PUC Angels] Erro inesperado:", e);
      return { sent: 0, total: 0, error: String(e) };
    }
  };
})();
