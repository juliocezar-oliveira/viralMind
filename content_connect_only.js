// content_connect_only.js — Conectar SEM nota
// - Aguarda resultados (waitForCards)
// - Filtra por cargo/localidade
// - Respeita filtro "apenas 2º/3º" (heurística pelo botão "Conectar"; pula "Mensagem")
// - Paginação robusta + fallback de scroll infinito
// - Atualiza progresso (connectionsSent/sendTotal/lastAction) e logs unificados
// - Patch: zera shouldStop no início para não iniciar travado

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
  if (window.__VM.connectOnlyRunning) {
    console.log("[VM] content_connect_only.js já em execução — abortando nova inicialização.");
    return;
  }
  window.__VM.connectOnlyRunning = true;

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
        ["shouldStop","filterLocation","localidadeNome","filterRole","skipIfSent","only2nd3rd","filtroConexao","sendLimit"],
        (d) => {
          const loc = (d.filterLocation || d.localidadeNome || "").toString();
          const parseOnly = (val="") => {
            const v = (val || "").toString().toLowerCase();
            const has23 = /(2|segundo).*(3|terceiro)|2\s*[-e/,]\s*3|2nd.*3rd/.test(v);
            const has1  = /\b1\b|primeir/.test(v);
            return has23 && !has1;
          };
          resolve({
            shouldStop: !!d.shouldStop,
            filterLocation: loc,
            filterRole: (d.filterRole || "").toString(),
            skipIfSent: !!d.skipIfSent,
            only2nd3rd: typeof d.only2nd3rd === "boolean" ? d.only2nd3rd : parseOnly(d.filtroConexao),
            sendLimit: Number(d.sendLimit) > 0 ? Number(d.sendLimit) : 9999
          });
        }
      );
    });
  }

  async function shouldStop() {
    return new Promise((resolve) => {
      chrome.storage.local.get("shouldStop", (d) => resolve(!!d.shouldStop));
    });
  }

  function setProgress({ sent, total, note }) {
    chrome.storage.local.set({ connectionsSent: sent, sendTotal: total, lastAction: note, progress: sent });
  }

  // ---------- DOM helpers ----------
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

    const container =
      document.querySelector("div.search-results-container") ||
      document.querySelector("main") || document.body;

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
    cards = getCardsNow();
    return cards;
  }

  function extractInfo(card) {
    const txt = (card?.innerText || "").replace(/\s+/g, " ").trim();
    const lines = (card?.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
    const nome = lines[0] || "";

      // 🔽 NOVO: pegar link do perfil
  const a = card.querySelector('a[href*="/in/"]');
  let profileUrl = "";
  if (a) {
    let href = a.getAttribute("href") || a.href || "";
    try {
      const url = new URL(href, location.origin);
      profileUrl = url.origin + url.pathname; // remove query params
    } catch {
      profileUrl = href;
    }
  }

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

    return { nome, cargo, localidade, grau, plain: txt, profileUrl // 🔽 NOVO
  };
  }

  function matchesText(info, roleKW, locKW) {
    const hay = norm([info.nome, info.cargo, info.localidade, info.plain].join(" • "));
    if (roleKW.length && !roleKW.some(kw => hay.includes(kw))) return false;
    if (locKW && !hay.includes(locKW)) return false;
    return true;
  }

  function btnConnect(card) {
    const btns = [...card.querySelectorAll("button")];
    const label = (b) => (b.innerText || "").trim().toLowerCase();
    // Heurística: "Conectar" / variações
    return btns.find(b => /conectar|conectar-se|conex(ão|ao)|connect/i.test(label(b))) || null;
  }

  function disabled(btn) {
    return btn?.disabled || btn?.getAttribute("aria-disabled") === "true";
  }

  async function waitBtnEnviarSemNota() {
    for (let i = 0; i < 40; i++) {
      const btn = [...document.querySelectorAll("button")].find(b =>
        (b.innerText || "").trim().toLowerCase() === "enviar sem nota"
      );
      if (btn) return btn;
      await delay(150);
    }
    return null;
  }

  function logEnvio({ nome, cargo, localidade, profileUrl }) {
    const handleFromUrl = (url="") => {
      const m = String(url).match(/\/in\/([^/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    };
    const conta = handleFromUrl(profileUrl);
  
    chrome.storage.local.get("logs", (r) => {
      const logs = r.logs || [];
      logs.push({
        nome,
        cargo,
        localidade,
        tipo: /* mantenha conforme o arquivo */
          (typeof window !== "undefined" && window.__VM && window.__VM.sendWithNoteRunning)
            ? "Conexão com nota" : "Conexão sem nota",
        data: new Date().toISOString(),
        profileUrl, // 🔽 NOVO
        conta       // 🔽 NOVO
      });
      chrome.storage.local.set({ logs });
    });
  }  

  // Paginação e scroll
  function nextPageButton() {
    const aria = [
      'button[aria-label="Avançar"]',
      'button[aria-label="Próxima"]',
      'button[aria-label="Próxima página"]',
      'button[aria-label*="próxima"]',
      'button[aria-label*="Avan"]',
      'button[aria-label*="Next"]'
    ];
    for (const sel of aria) {
      const el = document.querySelector(sel);
      if (el && !el.disabled) return el;
    }
    const aNext = document.querySelector('a[rel="next"], a[href*="page="].artdeco-pagination__button--next');
    if (aNext) return aNext;
    const txt = [...document.querySelectorAll("button,a")].find(b =>
      /avançar|próxima|próximo|next|seguinte/i.test((b.innerText || "").trim())
    );
    return (txt && !txt.disabled) ? txt : null;
  }
  async function tryInfiniteScrollBatch() {
    const before = document.body.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    await waitRandom(1400, 2300);
    const after = document.body.scrollHeight;
    return after > before;
  }

  // ---------- Loop de envio ----------
  async function enviarNaPagina(cfg, restante, roleKW, locKW, progressBase) {
    const cards = await waitForCards();
    console.log(`[VM] Cards visíveis: ${cards.length}. Restante: ${restante}`);
    let enviados = 0;

    for (const card of cards) {
      if (await shouldStop()) break;
      if (enviados >= restante) break;

      const info = extractInfo(card);
      if (!matchesText(info, roleKW, locKW)) continue;

      const btn = btnConnect(card);
      if (!btn) continue;

      // Heurística 2º/3º: se pediu only2nd3rd e o botão indicar "Mensagem", é 1º grau => pular
      if (cfg.only2nd3rd) {
        const label = (btn.innerText || "").trim().toLowerCase();
        if (/mensagem|message/i.test(label)) continue; // 1º grau
      }

      if (cfg.skipIfSent && disabled(btn)) {
        console.log(`[VM] Pulando ${info.nome} — botão Conectar desabilitado.`);
        continue;
      }

      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(320, 1100);
      btn.click();
      await waitRandom(800, 1600);

      const semNota = await waitBtnEnviarSemNota();
      if (!semNota) {
        console.warn("[VM] Modal sem 'Enviar sem nota' — fechando e seguindo.");
        const close =
          document.querySelector('button[aria-label="Fechar"]') ||
          [...document.querySelectorAll("button")].find(b => (b.innerText || "").trim().toLowerCase() === "fechar");
        if (close) close.click();
        await delay(250);
        continue;
      }

      semNota.click();
      enviados += 1;
      const totalEnviados = progressBase + enviados;
      setProgress({ sent: totalEnviados, total: cfg.sendLimit, note: `Conexão sem nota para ${info.nome}` });
      logEnvio(info);
      console.log(`[VM] ✅ Conexão sem nota enviada: ${info.nome} (${totalEnviados}/${cfg.sendLimit})`);
      await waitRandom(900, 1800);
      // +PACER (Conectar)
if (window.__pacer?.between) { try { await window.__pacer.between('conectar'); } catch(e) {} }

    }

    return enviados;
  }

  // ---------- MAIN ----------
  (async () => {
    // PATCH: sempre começar destravado
    await new Promise(r => chrome.storage.local.set({ shouldStop: false }, r));

    const cfg = await getCfg();
    const roleKW = parseKeywords(cfg.filterRole);
    const locKW  = norm(cfg.filterLocation);
    console.log("[VM] Config (connect only):", cfg);
    setProgress({ sent: 0, total: cfg.sendLimit, note: "Iniciando Connect Only" });

    let total = 0;
    while (true) {
      if (await shouldStop()) break;
      const restante = Math.max(0, cfg.sendLimit - total);
      if (restante === 0) break;

      const enviados = await enviarNaPagina(cfg, restante, roleKW, locKW, total);
      total += enviados;

      if (await shouldStop() || total >= cfg.sendLimit) break;

      if (enviados === 0) console.log("[VM] Nenhum elegível nesta página — tentando avançar…");

      const next = nextPageButton();
      if (!next) {
        // tenta carregar mais via scroll infinito
        const grew = await tryInfiniteScrollBatch();
        if (grew) {
          console.log("[VM] Carregados mais resultados via scroll — nova varredura.");
          continue; // reprocessa a página com novos cards
        }
        console.log("[VM] Não há botão de próxima página — encerrando.");
        break;
      }
      next.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(600, 1400);
      next.click();
      await waitRandom(3100, 5200);
    }

    console.log(`[VM] Finalizado Connect Only. Total: ${total}.`);
    setProgress({ sent: total, total: cfg.sendLimit, note: "Fim Connect Only" });
    window.__VM.connectOnlyRunning = false;
  })();
})();
