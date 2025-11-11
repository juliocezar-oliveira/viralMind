// content_connect_manager.js — Conectar COM nota (Modelo de Fila)
// - Aguarda resultados (waitForCards)
// - Filtra por cargo/localidade
// - Processa conexões diretas (botão branco) COM nota
// - Enfileira conexões de perfil (botão preto / sem botão) para visita
// - Orquestra a fila e a paginação

(() => {
  // === Ritmizador global (pacer) ===
(() => {
  if (window.__pacer) return;
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const rint  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  const CFG = {
    ranges: {
      conectar:  [18000, 33000],
      mensagens: [22000, 45000],
      primeira:  [20000, 40000],
      followups: [12000, 28000]
    },
    longEvery: {
      conectar:  [7,11],
      mensagens: [5,9],
      primeira:  [6,10],
      followups: [10,15]
    },
    longPauseMs: {
      conectar:  [120000, 240000],
      mensagens: [180000, 300000],
      primeira:  [120000, 240000],
      followups: [90000,  180000]
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
  // --- ALTERADO --- (Nome da flag)
  if (window.__VM.connectManagerRunning) { 
    console.log("[VM] content_connect_manager.js já em execução — abortando nova inicialização.");
    return;
  }
  window.__VM.connectManagerRunning = true;

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
        // --- ALTERADO --- (adicionado "connectMessage")
        ["shouldStop","filterLocation","localidadeNome","filterRole","skipIfSent","only2nd3rd","filtroConexao","sendLimit", "connectMessage"],
        (d) => {
          const loc = (d.filterLocation || d.localidadeNome || "").toString();
          const parseOnly = (val="") => {
            const v = (val || "").toString().toLowerCase();
            const has23 = /(2|segundo).*(3|terceiro)|2\s*[-e/,]\s*3|2nd.*3rd/.test(v);
            const has1  = /\b1\b|primeir/.test(v);
            return has23 && !has1;
          };
          resolve({
            shouldStop: !!d.shouldStop,
            filterLocation: loc,
            filterRole: (d.filterRole || "").toString(),
            skipIfSent: !!d.skipIfSent,
            only2nd3rd: typeof d.only2nd3rd === "boolean" ? d.only2nd3rd : parseOnly(d.filtroConexao),
            sendLimit: Number(d.sendLimit) > 0 ? Number(d.sendLimit) : 9999,
            // --- NOVO --- (Mensagem padrão)
            connectMessage: d.connectMessage || "Olá {nome}, vi seu perfil e gostaria de me conectar." 
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

  // --- NOVO --- (Helpers da Fila de Tarefas)
  const VM_QUEUE_KEY = "vm_connect_queue";
  async function lerFilaDoStorage() {
    return new Promise(r => chrome.storage.local.get(VM_QUEUE_KEY, d => r(d[VM_QUEUE_KEY] || [])));
  }
  async function salvarFilaDoStorage(fila) {
    return new Promise(r => chrome.storage.local.set({ [VM_QUEUE_KEY]: fila }, r));
  }
  async function adicionarTarefasNaFila(tarefas) {
    const fila = await lerFilaDoStorage();
    const urlsNaFila = new Set(fila.map(t => t.url));
    // Adiciona apenas tarefas que não estejam na fila
    const novasTarefas = tarefas.filter(t => t.url && !urlsNaFila.has(t.url)); 
    if (novasTarefas.length) {
      console.log(`[VM] Adicionando ${novasTarefas.length} novas tarefas à fila.`);
      await salvarFilaDoStorage([...fila, ...novasTarefas]);
    }
  }
  // --- FIM NOVO ---

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

  // --- REMOVIDO --- (Antiga btnConnect)
  // function btnConnect(card) { ... }

  // --- NOVO --- (Funções de detecção de botão)
  /**
  * Encontra o botão "Conectar" Padrão (Branco, com ícone), 
  * que abre o modal para enviar com nota.
  */
  function findBtnConnectBranco(card) {
    const btns = [...card.querySelectorAll("button")];
    const label = (b) => (b.innerText || "").trim().toLowerCase();
    
    return btns.find(b => 
      /conectar|connect/i.test(label(b)) && // 1. Tem o texto "Conectar"
      b.querySelector('svg')                 // 2. E TEM um SVG (ícone)
    ) || null;
  }

  /**
  * Encontra o botão "Conectar" Preto (Pill, sem ícone),
  * que NÃO abre o modal de nota.
  */
  function findBtnConnectPreto(card) {
    const btns = [...card.querySelectorAll("button")];
    const label = (b) => (b.innerText || "").trim().toLowerCase();
    
    return btns.find(b => 
      /conectar|connect/i.test(label(b)) && // 1. Tem o texto "Conectar"
      !b.querySelector('svg')                // 2. E NÃO TEM um SVG
    ) || null;
  }

  /** Encontra o botão "Mensagem" (para pular 1º grau) */
  function findBtnMensagem(card) {
      const btns = [...card.querySelectorAll("button")];
      const label = (b) => (b.innerText || "").trim().toLowerCase();
      return btns.find(b => /mensagem|message/i.test(label(b))) || null;
  }

  /** Encontra o botão "Pendente" (para pular já enviado) */
  function findBtnPendente(card) {
      const btns = [...card.querySelectorAll("button")];
      const label = (b) => (b.innerText || "").trim().toLowerCase();
      // O botão "Pendente" é desabilitado
      return btns.find(b => /pendente|pending/i.test(label(b)) && disabled(b)) || null;
  }
  // --- FIM NOVO ---

  function disabled(btn) {
    return btn?.disabled || btn?.getAttribute("aria-disabled") === "true";
  }

  // --- REMOVIDO --- (Antiga waitBtnEnviarSemNota)
  // async function waitBtnEnviarSemNota() { ... }

  // --- NOVO --- (Função de Ação para Envio Direto com Nota)
  async function executarConexaoComNota(cfg, info, btn) {
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(320, 1100);
      btn.click();
      await waitRandom(800, 1600);

      // Tenta achar o botão "Adicionar nota"
      const addNoteBtn = await (async () => {
        for (let i = 0; i < 40; i++) {
          // Seletor pode precisar de ajuste
          const btn = document.querySelector('button[aria-label*="Adicionar nota"]');
          if (btn) return btn;
          await delay(150);
        }
        return null;
      })();

      if (!addNoteBtn) {
        console.warn(`[VM] Modal sem 'Adicionar nota' para ${info.nome} — fechando e pulando.`);
        const close = document.querySelector('button[aria-label="Fechar"]') || [...document.querySelectorAll("button")].find(b => (b.innerText || "").trim().toLowerCase() === "fechar");
        if (close) close.click();
        await delay(250);
        return false; // Falhou
      }

      // Achou! Clica para abrir a caixa de mensagem.
      addNoteBtn.click();
      await waitRandom(500, 1200);

      // Procura a caixa de texto e o botão final de Enviar
      // (Estes seletores são do LinkedIn, podem precisar de ajuste)
      const textArea = document.querySelector('textarea.connect-button-send-invite__custom-message'); 
      const sendBtn = document.querySelector('button[aria-label="Enviar convite"]'); 

      if (!textArea || !sendBtn) {
        console.warn(`[VM] Não achou 'textArea' ou 'sendBtn' final para ${info.nome}. Fechando e pulando.`);
        const close = document.querySelector('button[aria-label="Fechar"]');
        if (close) close.click();
        await delay(250);
        return false; // Falhou
      }

      // Preenche a mensagem
      const primeiroNome = info.nome.split(' ')[0]; // Pega só o primeiro nome
      const mensagem = (cfg.connectMessage || "Olá {nome}, gostaria de me conectar.").replace(/{nome}/g, primeiroNome);

      textArea.value = mensagem;
      textArea.dispatchEvent(new Event('input', { bubbles: true })); // Simula digitação
      await waitRandom(400, 900);

      // Envia!
      sendBtn.click();
      await waitRandom(900, 1800);
      return true; // Sucesso
    } catch (e) {
      console.error(`[VM] Erro ao tentar conectar com ${info.nome}: ${e.message}`);
      return false; // Falhou
    }
  }
  // --- FIM NOVO ---

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
        // --- ALTERADO --- (Tipo agora é sempre 'com nota')
        tipo: "Conexão com nota",
        data: new Date().toISOString(),
        profileUrl, 
        conta       
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

  // --- NOVO --- (Função de navegação para o perfil)
  async function executarVisita(tarefa) {
      console.log(`[VM] Navegando para o perfil de: ${tarefa.nome}`);
      // 1. Salva de onde viemos e a tarefa
      await chrome.storage.local.set({ 
          paginaDeOrigem: window.location.href,
          tarefaAtual: tarefa
      });
      
      // 2. Navega para o perfil
      await waitRandom(1000, 2000);
      window.location.href = tarefa.url;
      // O SCRIPT VAI PARAR AQUI
  }
  // --- FIM NOVO ---

  // ---------- Loop de envio (O COLETOR) ----------
  // --- ALTERADO --- (Função totalmente reescrita)
  async function enviarNaPagina(cfg, restante, roleKW, locKW, progressBase) {
    const cards = await waitForCards();
    console.log(`[VM] Cards visíveis: ${cards.length}. Restante: ${restante}`);
    let enviadosDireto = 0; // Envios feitos nesta página
    let filaParaVisitar = []; // Perfis para visitar depois

    for (const card of cards) {
      if (await shouldStop()) break;
      if (enviadosDireto >= restante) break; // Só conta envios diretos no 'restante' da página

      const info = extractInfo(card);
      if (!matchesText(info, roleKW, locKW)) continue;

      // --- Nova Lógica de Decisão ---
      const btnBranco = findBtnConnectBranco(card);
      const btnPreto  = findBtnConnectPreto(card);
      const btnMsg    = findBtnMensagem(card);
      const btnPend   = findBtnPendente(card); // Já checa 'disabled'

      // Heurística 2º/3º: Se pediu only2nd3rd e o botão for "Mensagem"
      if (cfg.only2nd3rd && btnMsg) {
          console.log(`[VM] Pulando ${info.nome} (1º grau)`);
          continue;
      }
      
      // Pular se já enviado (Pendente) ou se a config 'skipIfSent' estiver ativa
      // Checa se o 'btnPreto' está desabilitado (Pendente)
      if (btnPend || (cfg.skipIfSent && btnPreto && disabled(btnPreto))) {
            console.log(`[VM] Pulando ${info.nome} (Pendente ou já enviado).`);
            continue;
      }

      // --- Classificação de Ação ---
      if (btnBranco) {
          // CENÁRIO 1: Processamento Rápido (Botão Branco)
          console.log(`[VM] Processando ${info.nome} (Conexão Direta com nota)`);
          
          const sucesso = await executarConexaoComNota(cfg, info, btnBranco);
          
          if (sucesso) {
              enviadosDireto += 1;
              const totalEnviados = progressBase + enviadosDireto; // O 'total' só reflete envios diretos por enquanto
              setProgress({ sent: totalEnviados, total: cfg.sendLimit, note: `Conexão com nota para ${info.nome}` });
              logEnvio(info); // logEnvio agora sempre loga 'Conexão com nota'
              console.log(`[VM] ✅ Conexão COM nota enviada: ${info.nome} (${totalEnviados}/${cfg.sendLimit})`);
              
              // +PACER (Conectar)
              if (window.__pacer?.between) { try { await window.__pacer.between('conectar'); } catch(e) {} }
          }
          // Se 'sucesso' for false, a função executarConexaoComNota já tratou o erro e pulou.

      } else if (btnPreto || (!btnBranco && !btnMsg && !btnPend)) { 
          // CENÁRIO 2 e 3: Processamento em Fila 
          // (Botão Preto) OU (Sem botão Branco E Sem ser 1o grau E Sem ser pendente)
          if (!info.profileUrl) {
              console.warn(`[VM] Pulando ${info.nome}, não foi possível extrair URL do perfil para a fila.`);
              continue;
          }
          
          console.log(`[VM] Adicionando ${info.nome} à Fila de Visita (Botão Preto/Ausente)`);
          filaParaVisitar.push({ 
              url: info.profileUrl, 
              nome: info.nome,
              tipo: 'VISITAR_PERFIL'
          });
      }
    } // Fim do loop 'for...of cards'

    // Adiciona todos os perfis coletados para a fila de uma vez
    if (filaParaVisitar.length > 0) {
      await adicionarTarefasNaFila(filaParaVisitar);
    }

    return enviadosDireto; // Retorna apenas os envios feitos DIRETAMENTE nesta página
  }

  // ---------- MAIN (O ORQUESTRADOR) ----------
  // --- ALTERADO --- (Função totalmente reescrita)
  (async () => {
    // PATCH: sempre começar destravado
    await new Promise(r => chrome.storage.local.set({ shouldStop: false }, r));

    const cfg = await getCfg();
    const roleKW = parseKeywords(cfg.filterRole);
    const locKW  = norm(cfg.filterLocation);
    console.log("[VM] Config (Connect Manager):", cfg);

    // Nota: 'total' agora é lido do storage, pois o script de perfil também o incrementa
    const { connectionsSent: totalInicial } = await new Promise(r => chrome.storage.local.get('connectionsSent', r));
    let total = totalInicial || 0;

    setProgress({ sent: total, total: cfg.sendLimit, note: "Iniciando Connect Manager" });

    while (true) {
      if (await shouldStop()) {
        console.log("[VM] Parada solicitada pelo usuário.");
        break;
      }

      // Atualiza o total a cada loop, caso o script de perfil tenha rodado
      const { connectionsSent: totalAtualizado } = await new Promise(r => chrome.storage.local.get('connectionsSent', r));
      total = totalAtualizado || total;

      const restante = Math.max(0, cfg.sendLimit - total);
      if (restante === 0) {
        console.log("[VM] Limite de envios atingido.");
        break;
      }

      // 1. VERIFICAR A FILA PRIMEIRO
      const fila = await lerFilaDoStorage();

      if (fila.length > 0) {
          // TEMOS TAREFAS DE VISITA!
          const tarefa = fila.shift(); // Pega a primeira
          await salvarFilaDoStorage(fila); // Salva a fila sem ela

          console.log(`[VM] Iniciando tarefa de visita: ${tarefa.nome}. ${fila.length} tarefas restantes na fila.`);
          
          // Esta função NAVEGA e o script para.
          await executarVisita(tarefa); 
          
          // O script morre aqui, então o 'break' é para o loop do navegador
          break; 
      
      } else {
          // 2. FILA VAZIA. Processar a página de busca.
          console.log("[VM] Fila de visitas vazia. Processando página de busca...");
          // Passamos o 'total' atual para o progressBase
          const enviadosNaPagina = await enviarNaPagina(cfg, restante, roleKW, locKW, total); 
          total += enviadosNaPagina; // Atualiza o total com os envios diretos

          if (await shouldStop()) break;

          // Se não enviou nada e a fila continua vazia, tenta paginar
          if (enviadosNaPagina === 0) {
              console.log("[VM] Nenhum envio direto e fila vazia. Tentando avançar página...");
          }

          // 3. PAGINAÇÃO (Lógica antiga)
          const next = nextPageButton();
          if (!next) {
              // tenta carregar mais via scroll infinito
              const grew = await tryInfiniteScrollBatch();
              if (grew) {
                console.log("[VM] Carregados mais resultados via scroll — nova varredura.");
                continue; // reprocessa a página com novos cards
              }
              console.log("[VM] Fila vazia e sem próxima página. Encerrando.");
              break; // Fim
          }
          
          console.log("[VM] Avançando para próxima página...");
          next.scrollIntoView({ behavior: "smooth", block: "center" });
          await waitRandom(600, 1400);
          next.click();
          await waitRandom(3100, 5200);
      }
    } // Fim do loop 'while(true)'

    console.log(`[VM] Finalizado Connect Manager. Total final: ${total}.`);
    setProgress({ sent: total, total: cfg.sendLimit, note: "Fim Connect Manager" });
    window.__VM.connectManagerRunning = false;
  })();
})();