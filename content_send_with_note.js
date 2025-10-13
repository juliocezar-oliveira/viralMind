// content_send_with_note.js — Enviar convite COM nota (versão adaptada)
// Mantidas todas as funcionalidades originais: filtros, logs, paginação, progresso.
// Patch adicionado: detecção mais robusta para botões “Adicionar nota” e “Enviar” (inclui variações PT/EN).

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

  window.__VM = window.__VM || {};
  if (window.__VM.sendWithNoteRunning) {
    console.log("[VM] content_send_with_note.js já em execução — abortando nova inicialização.");
    return;
  }
  window.__VM.sendWithNoteRunning = true;

  // ---------- Utils ----------
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  

  // [INCLUSÃO] Humanização de ritmo / aleatoriedade
  function randInt(min, max){ min = Math.ceil(min); max = Math.floor(max); return Math.floor(Math.random()*(max-min+1))+min; }
  const waitRandom = async (minMs, maxMs) => { const ms = randInt(minMs, maxMs); return delay(ms); };
function norm(s = "") {
    return s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
  function parseKeywords(str = "") {
    const raw = str.replace(/\s*[,;|/]\s*/g, ",");
    return raw.split(",").map(t => t.trim()).filter(Boolean).map(norm);
  }
  async function getCfg() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ["shouldStop","filterLocation","filterRole","skipIfSent","only2nd3rd","sendLimit","customMessage"],
        (d) => resolve({
          shouldStop: !!d.shouldStop,
          filterLocation: (d.filterLocation || "").toString(),
          filterRole: (d.filterRole || "").toString(),
          skipIfSent: !!d.skipIfSent,
          only2nd3rd: !!d.only2nd3rd,
          sendLimit: Number(d.sendLimit) > 0 ? Number(d.sendLimit) : 9999,
          customMessage: (d.customMessage || "Olá {name}, espero que esteja bem. Sou o Presidente Regional da PUC angels Grande São Paulo.\n\nEstamos expandindo nossa rede de líderes e inovadores. Gostaria de te convidar para conhecer a Associação PUC angels e como podemos juntos fortalecer ainda mais esse ecossistema.").toString()
        })
      );
    });
  }
  async function shouldStop() {
    return new Promise((resolve) => {
      chrome.storage.local.get("shouldStop", (d) => resolve(!!d.shouldStop));
    });
  }
  function setProgress({ sent, total, note }) {
    chrome.storage.local.set({ messagesSent: sent, sendTotal: total, lastAction: note });
  }

  // ---------- DOM ----------
  function getCardsNow() {
    const sels = [
      "li.reusable-search__result-container",
      "ul.reusable-search__entity-result-list li",
      "div.search-results-container li",
      "div.entity-result"
    ];
    for (const sel of sels) {
      const list = [...document.querySelectorAll(sel)].filter(n => n.offsetParent !== null);
      if (list.length) return list;
    }
    return [];
  }
  async function waitForCards(timeoutMs = 7000) {
    const start = Date.now();
    let cards = getCardsNow();
    if (cards.length) return cards;
    const container = document.querySelector("div.search-results-container") || document.querySelector("main") || document.body;
    if (!container) {
      await delay(500);
      return getCardsNow();
    }
    let resolved = false;
    const obs = new MutationObserver(() => {
      if (resolved) return;
      const found = getCardsNow();
      if (found.length) {
        resolved = true;
        obs.disconnect();
      }
    });
    obs.observe(container, { childList: true, subtree: true });
    while (!resolved && Date.now() - start < timeoutMs) await delay(200);
    obs.disconnect();
    return getCardsNow();
  }

  function extractInfo(card) {
    const txt = (card?.innerText || "").replace(/\s+/g, " ").trim();
    const lines = (card?.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
    const nome = lines[0] || "";
    let cargo = "";
    const idxConn = lines.findIndex(l => /conex(ão|ao)|conectar/i.test(l));
    if (idxConn >= 0) cargo = lines[idxConn + 1] || "";
    if (!cargo) cargo = lines.find(l => /engenheir|analist|gerent|lead|diretor|coordenador|specialist|cientista|consultor/i.test(l)) || "";
    let localidade = "";
    if (idxConn >= 0) localidade = lines[idxConn + 2] || "";
    if (!localidade) {
      localidade = lines.find(l =>
        /brasil|brazil|rio|são paulo|sao paulo|porto alegre|curitiba|belo horizonte|fortaleza|recife|lisboa|london|madrid|porto|miami|new york/i.test(l)
      ) || "";
    }
    const grauMatch = txt.match(/\b([123])º\b/);
    const grau = grauMatch ? Number(grauMatch[1]) : null;
    return { nome, cargo, localidade, grau, plain: txt };
  }

  function matches(info, cfg, roleKW, locKW) {
    const hay = norm([info.nome, info.cargo, info.localidade, info.plain].join(" • "));
    if (cfg.only2nd3rd && !(info.grau === 2 || info.grau === 3)) return false;
    if (roleKW.length && !roleKW.some(kw => hay.includes(kw))) return false;
    if (locKW && !hay.includes(locKW)) return false;
    return true;
  }

  function btnConnect(card) {
    const btns = [...card.querySelectorAll("button")];
    const variants = ["conectar","conectar-se","conexão","conexao","connect"];
    return btns.find(b => variants.includes((b.innerText || "").trim().toLowerCase())) || null;
  }

  function disabled(btn) {
    return btn?.disabled || btn?.getAttribute("aria-disabled") === "true";
  }

  // PATCH: mais robusto (variações PT/EN)
  async function waitBtnAdicionarNota() {
    for (let i = 0; i < 40; i++) {
      const btn = [...document.querySelectorAll("button")].find(b => {
        const t = (b.innerText || "").trim().toLowerCase();
        return t === "adicionar nota" || t.includes("add a note");
      });
      if (btn) return btn;
      await delay(150);
    }
    return null;
  }

  async function waitBtnEnviar() {
    for (let i = 0; i < 40; i++) {
      const btn = [...document.querySelectorAll("button")].find(b => {
        const t = (b.innerText || "").trim().toLowerCase();
        return t === "enviar" || t.includes("enviar convite") || t === "send" || t.includes("send invitation");
      });
      if (btn && !disabled(btn)) return btn;
      await delay(150);
    }
    return null;
  }

  function findNoteField() {
    return (
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('textarea[name="message"]') ||
      document.querySelector("textarea") ||
      document.querySelector('[role="textbox"]')
    );
  }

  function setText(el, text) {
    if (!el) return;
    if (el.getAttribute && el.getAttribute("contenteditable") === "true") {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    if ("value" in el) {
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderMsg(tpl, info) {
    return tpl
      .replace(/\{name\}/gi, info.nome || "")
      .replace(/\{role\}/gi, info.cargo || "")
      .replace(/\{location\}/gi, info.localidade || "");
  }

  function logEnvio({ nome, cargo, localidade }) {
    chrome.storage.local.get("logs", (r) => {
      const logs = r.logs || [];
      logs.push({ nome, cargo, localidade, tipo: "Conexão com nota", data: new Date().toISOString() });
      chrome.storage.local.set({ logs });
    });
  }

  function nextPageButton() {
    const tries = [
      'button[aria-label="Avançar"]',
      'button[aria-label="Próxima"]',
      'button[aria-label="Next"]'
    ];
    for (const sel of tries) {
      const el = document.querySelector(sel);
      if (el && !el.disabled) return el;
    }
    const txtBtn = [...document.querySelectorAll("button,a")].find(b =>
      ["avançar","próxima","next"].includes((b.innerText || "").trim().toLowerCase())
    );
    return (txtBtn && !txtBtn.disabled) ? txtBtn : null;
  }

  // ---------- Loop ----------
  async function enviarNaPagina(cfg, restante, roleKW, locKW, progressBase) {
    const cards = await waitForCards();
    console.log(`[VM] Cards visíveis: ${cards.length}. Restante: ${restante}`);
    let enviados = 0;

    for (const card of cards) {
      if (await shouldStop()) break;
      if (enviados >= restante) break;

      const info = extractInfo(card);
      if (!matches(info, cfg, roleKW, locKW)) continue;

      const btn = btnConnect(card);
      if (!btn) continue;
      if (cfg.skipIfSent && disabled(btn)) {
        console.log(`[VM] Pulando ${info.nome} — botão Conectar desabilitado.`);
        continue;
      }

      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(320, 1100);
      btn.click();
      await waitRandom(800, 1600);

      const addNote = await waitBtnAdicionarNota();
      if (!addNote) {
        console.warn("[VM] Modal sem 'Adicionar nota' — fechando e seguindo.");
        const close =
          document.querySelector('button[aria-label="Fechar"]') ||
          [...document.querySelectorAll("button")].find(b => (b.innerText || "").trim().toLowerCase() === "fechar");
        if (close) close.click();
        await delay(250);
        continue;
      }

      addNote.click();
      await waitRandom(420, 1000);

      const field = findNoteField();
      if (!field) {
        console.warn("[VM] Campo de nota não encontrado — fechando e seguindo.");
        const close =
          document.querySelector('button[aria-label="Fechar"]') ||
          [...document.querySelectorAll("button")].find(b => (b.innerText || "").trim().toLowerCase() === "fechar");
        if (close) close.click();
        await delay(250);
        continue;
      }

      const msg = renderMsg(cfg.customMessage, info);
      setText(field, msg);
      await waitRandom(260, 900);

      const enviar = await waitBtnEnviar();
      if (!enviar) {
        console.warn("[VM] Botão 'Enviar' não encontrado — fechando e seguindo.");
        const close =
          document.querySelector('button[aria-label="Fechar"]') ||
          [...document.querySelectorAll("button")].find(b => (b.innerText || "").trim().toLowerCase() === "fechar");
        if (close) close.click();
        await delay(250);
        continue;
      }

      enviar.click();
      enviados += 1;
      const totalEnviados = progressBase + enviados;
      setProgress({ sent: totalEnviados, total: cfg.sendLimit, note: `Conexão com nota para ${info.nome}` });
      logEnvio(info);
      console.log(`[VM] ✅ Conexão com nota enviada: ${info.nome} (${totalEnviados}/${cfg.sendLimit})`);
      await waitRandom(900, 1800);
      // +PACER (Conectar)
    if (window.__pacer?.between) { try { await window.__pacer.between('conectar'); } catch(e) {} }

    }

    return enviados;
  }

  // ---------- MAIN ----------
  (async () => {
    await new Promise(r => chrome.storage.local.set({ shouldStop: false }, r)); // zera estado

    const cfg = await getCfg();
    const roleKW = parseKeywords(cfg.filterRole);
    const locKW  = norm(cfg.filterLocation);
    console.log("[VM] Config (send with note):", cfg);
    setProgress({ sent: 0, total: cfg.sendLimit, note: "Iniciando Send With Note" });

    let total = 0;
    while (true) {
      if (await shouldStop()) break;
      const restante = Math.max(0, cfg.sendLimit - total);
      if (restante === 0) break;

      const enviados = await enviarNaPagina(cfg, restante, roleKW, locKW, total);
      total += enviados;

      if (await shouldStop() || total >= cfg.sendLimit) break;

      if (enviados === 0) {
        console.log("[VM] Nenhum elegível nesta página — tentando avançar…");
      }
      const next = nextPageButton();
      if (!next) {
        console.log("[VM] Não há botão de próxima página — encerrando.");
        break;
      }
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(600, 1400);
      next.click();
      await waitRandom(3100, 5200);
    }

    console.log(`[VM] Finalizado Send With Note. Total: ${total}.`);
    setProgress({ sent: total, total: cfg.sendLimit, note: "Fim Send With Note" });
    window.__VM.sendWithNoteRunning = false;
  })();
})();
