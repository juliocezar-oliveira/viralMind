// content_send_with_note.js (que é o seu content_connect_manager.js)
// --- CORREÇÃO V5.1 ---
// Remove o 'to' perdido na linha 512 que causou o erro de sintaxe.
// A lógica do V5 (focada nos seletores do modal) está mantida.

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
  if (window.__VM.connectManagerRunning) { 
    console.log("[VM] content_connect_manager.js já em execução — abortando nova inicialização.");
    return;
  }
  window.__VM.connectManagerRunning = true;

  // ---------- Utils ----------
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const novasTarefas = tarefas.filter(t => t.url && !urlsNaFila.has(t.url)); 
    if (novasTarefas.length) {
      console.log(`[VM] Adicionando ${novasTarefas.length} novas tarefas à fila.`);
      await salvarFilaDoStorage([...fila, ...novasTarefas]);
    }
  }

  // ---------- DOM helpers ----------

  function getCardsNow() {
    const main = document.querySelector('main, [role="main"]');
    const searchRoot = main ? main.querySelector('ul, .search-results-container') : document.body;
  
    const candidates = [...(searchRoot || document.body).querySelectorAll('li')];
  
    const cards = candidates.filter(li => 
        li.offsetParent !== null && 
        li.querySelector('a[href*="/in/"]') && 
        (li.innerText || "").toLowerCase().includes('conectar') 
    );

    if (cards.length) return cards;

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

  async function waitForCards(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const cards = getCardsNow();
      if (cards.length) return cards;
      await delay(500);
    }
    return getCardsNow(); 
  }

  function getCardsSignature(cards) {
    if (!cards || !cards.length) return "EMPTY";
    const signature = cards.slice(0, 3).map(c => {
      const a = c.querySelector('a[href*="/in/"]');
      return a ? a.href : 'no-href';
    }).join('|');
    return signature;
  }


  function extractInfo(card) {
    const txt = (card?.innerText || "").replace(/\s+/g, " ").trim();
    const lines = (card?.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
    
    const a = card.querySelector('a[href*="/in/"]');
    const nomeFromLink = (a?.innerText || "").trim().split('\n')[0];
    const nome = nomeFromLink || lines[0] || "";

    let profileUrl = "";
    if (a) {
      let href = a.getAttribute("href") || a.href || "";
      try {
        const url = new URL(href, location.origin);
        profileUrl = url.origin + url.pathname;
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

    return { nome, cargo, localidade, grau, plain: txt, profileUrl };
  }

  function matchesText(info, roleKW, locKW) {
    const hay = norm([info.nome, info.cargo, info.localidade, info.plain].join(" • "));
    if (roleKW.length && !roleKW.some(kw => hay.includes(kw))) return false;
    if (locKW && !hay.includes(locKW)) return false;
    return true;
  }

  function disabled(btn) {
    return btn?.disabled || btn?.getAttribute("aria-disabled") === "true";
  }

  const getElementText = (el) => (el?.innerText || el?.textContent || "").trim().toLowerCase();

  function findBtnConnectBranco(card) {
    const candidates = [...card.querySelectorAll("button, span, div")]; 
    return candidates.find(b => {
      const txt = getElementText(b);
      const isConnect = txt === "conectar" || txt === "connect";
      return isConnect && b.querySelector('svg') && b.offsetParent !== null;
    }) || null;
  }

  function findBtnConnectPreto(card) {
    const candidates = [...card.querySelectorAll("button, span, div")]; 
    return candidates.find(b => {
      const txt = getElementText(b);
      const isConnect = txt === "conectar" || txt === "connect";
      return isConnect && !b.querySelector('svg') && b.offsetParent !== null;
    }) || null;
  }

  function findBtnMensagem(card) {
    const candidates = [...card.querySelectorAll("button, span, div")];
    return candidates.find(b => {
      const txt = getElementText(b);
      const isMessage = txt === "mensagem" || txt === "message";
      return isMessage && b.offsetParent !== null;
    }) || null;
  }

  function findBtnPendente(card) {
    const candidates = [...card.querySelectorAll("button, span, div")];
    return candidates.find(b => {
      const txt = getElementText(b);
      const isPending = txt === "pendente" || txt === "pending";
      return isPending && (disabled(b) || b.offsetParent !== null);
    }) || null;
  }

  // --- ⚠️ FUNÇÃO ATUALIZADA (executarConexaoComNota - V5) ---
  // Seletores do modal (pop-up) ficaram 100% robustos
  async function executarConexaoComNota(cfg, info, btn) {
    try {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      await waitRandom(320, 1100);
      btn.click();
      
      // Espera o modal (diálogo) aparecer
      let modal;
      const t0_modal = Date.now();
      while (Date.now() - t0_modal < 5000) {
        modal = document.querySelector('div[role="dialog"], .artdeco-modal');
        if (modal && modal.offsetParent !== null) break;
        await delay(100);
      }

      if (!modal) {
        console.warn(`[VM] Modal de conexão não abriu para ${info.nome}.`);
        return false;
      }
      
      await waitRandom(500, 1000); // Espera o conteúdo do modal renderizar

      // 1. Encontrar "Adicionar nota" (Robusto)
      const addNoteBtn = [...modal.querySelectorAll('button')].find(b => {
        const label = (b.getAttribute('aria-label') || b.innerText || "").toLowerCase();
        return label.includes("adicionar nota") || label.includes("add a note");
      });

      if (!addNoteBtn) {
        console.warn(`[VM] Modal sem 'Adicionar nota' para ${info.nome} — fechando e pulando.`);
        const close = modal.querySelector('button[aria-label*="Fechar"], button[aria-label*="Dismiss"]');
        if (close) close.click();
        await delay(250);
        return false; // Falhou
      }

      addNoteBtn.click();
      await waitRandom(500, 1200);

      // 2. Encontrar Campo de Texto (Robusto)
      const textArea = modal.querySelector('textarea, div[role="textbox"]');
      
      // 3. Encontrar Botão "Enviar" (Robusto)
      // Procura o botão "Enviar" (ou "Send") que esteja ativado
      const sendBtn = await (async () => {
        const t0_send = Date.now();
        while(Date.now() - t0_send < 3000) {
          const btn = [...modal.querySelectorAll('button')].find(b => {
            const txt = getElementText(b);
            return (txt.startsWith("enviar") || txt.startsWith("send")) && !disabled(b);
          });
          if (btn) return btn;
          await delay(100);
        }
        return null;
      })();

      if (!textArea || !sendBtn) {
        console.warn(`[VM] Não achou 'textArea' ou 'sendBtn' final para ${info.nome}. Fechando e pulando.`);
        const close = modal.querySelector('button[aria-label*="Fechar"], button[aria-label*="Dismiss"]');
        if (close) close.click();
        await delay(250);
        return false;
      }

      // 4. Preencher e Enviar
      const primeiroNome = info.nome.split(' ')[0];
      const mensagem = (cfg.connectMessage || "Olá {nome}, gostaria de me conectar.").replace(/{nome}/g, primeiroNome);

      // Simula digitação humana para habilitar o botão "Enviar"
      if (textArea.tagName === "TEXTAREA") {
        textArea.value = mensagem;
      } else {
        // para <div> contenteditable
        textArea.innerText = mensagem; 
      }
      // Dispara os eventos que o React escuta
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
      textArea.dispatchEvent(new Event('change', { bubbles: true }));

      await waitRandom(400, 900); // Pausa para o botão habilitar

      // Re-checa o botão "Enviar" caso ele estivesse desabilitado
      const finalSendBtn = disabled(sendBtn) ? 
          [...modal.querySelectorAll('button')].find(b => {
            const txt = getElementText(b);
            return (txt.startsWith("enviar") || txt.startsWith("send")) && !disabled(b);
          })
          : sendBtn;

      if (!finalSendBtn) {
        console.warn(`[VM] Botão 'Enviar' não habilitou para ${info.nome}. Fechando.`);
        const close = modal.querySelector('button[aria-label*="Fechar"], button[aria-label*="Dismiss"]');
        if (close) close.click();
        await delay(250);
        return false;
      }

      finalSendBtn.click();
      await waitRandom(900, 1800);
      return true; // Sucesso
    } catch (e) {
      console.error(`[VM] Erro ao tentar conectar com ${info.nome}: ${e.message}`);
      return false;
    }
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
        tipo: "Conexão com nota",
        data: new Date().toISOString(),
        profileUrl, 
        conta       
      });
      chrome.storage.local.set({ logs });
    });
  }  

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

  async function executarVisita(tarefa) {
      console.log(`[VM] Navegando para o perfil de: ${tarefa.nome}`);
      await chrome.storage.local.set({ 
          paginaDeOrigem: window.location.href,
          tarefaAtual: tarefa
      });
      
      await waitRandom(1000, 2000);
      window.location.href = tarefa.url;
  }

  // ---------- Loop de envio (O COLETOR) ----------
  async function enviarNaPagina(cfg, restante, roleKW, locKW, progressBase, cards) {
    console.log(`[VM] Processando ${cards.length} cards. Restante no limite: ${restante}`);
    let enviadosDireto = 0;
    let filaParaVisitar = [];

    for (const card of cards) {
      if (await shouldStop()) break;
      if (enviadosDireto >= restante) break;

      const info = extractInfo(card);
      if (!matchesText(info, roleKW, locKW)) continue;

      const btnBranco = findBtnConnectBranco(card);
      const btnPreto  = findBtnConnectPreto(card);
      const btnMsg    = findBtnMensagem(card);
      const btnPend   = findBtnPendente(card); 

      if (cfg.only2nd3rd && btnMsg) {
          console.log(`[VM] Pulando ${info.nome} (1º grau)`);
          continue;
      }
      
      if (btnPend || (cfg.skipIfSent && btnPreto && disabled(btnPreto))) {
            console.log(`[VM] Pulando ${info.nome} (Pendente ou já enviado).`);
            continue;
      }

      if (btnBranco) {
          console.log(`[VM] Processando ${info.nome} (Conexão Direta com nota)`);
          
          const sucesso = await executarConexaoComNota(cfg, info, btnBranco);
          
          if (sucesso) {
              enviadosDireto += 1;
              const totalEnviados = progressBase + enviadosDireto;
              setProgress({ sent: totalEnviados, total: cfg.sendLimit, note: `Conexão com nota para ${info.nome}` });
              logEnvio(info);
              console.log(`[VM] ✅ Conexão COM nota enviada: ${info.nome} (${totalEnviados}/${cfg.sendLimit})`);
              
              // --- O TYPO ESTAVA AQUI ---
              
              if (window.__pacer?.between) { try { await window.__pacer.between('conectar'); } catch(e) {} }
          }

      } else if (btnPreto || (!btnBranco && !btnMsg && !btnPend)) { 
          if (!info.profileUrl) {
              console.warn(`[VM] Pulando ${info.nome}, não foi possível extrair URL do perfil para a fila.`);
               continue;
          }
          
          console.log(`[VM] Adicionando ${info.nome} à Fila de Visita (Botão Preto/Ausente)`);
          filaParaVisitar.push({ 
              url: info.profileUrl, 
              nome: info.nome,
type: 'VISITAR_PERFIL'
          });
      }
    }

    if (filaParaVisitar.length > 0) {
      await adicionarTarefasNaFila(filaParaVisitar);
    }

    return { enviadosDireto };
  }

  // ---------- MAIN (O ORQUESTRADOR) ----------
  (async () => {
    await new Promise(r => chrome.storage.local.set({ shouldStop: false }, r));

    const cfg = await getCfg();
    const roleKW = parseKeywords(cfg.filterRole);
    const locKW  = norm(cfg.filterLocation);
    console.log("[VM] Config (Connect Manager):", cfg);

    const { connectionsSent: totalInicial } = await new Promise(r => chrome.storage.local.get('connectionsSent', r));
    let total = totalInicial || 0;

    setProgress({ sent: total, total: cfg.sendLimit, note: "Iniciando Connect Manager" });
  
    // "Memória" da página (para evitar o loop infinito)
    let processedSignatures = new Set();
  
    while (true) {
      if (await shouldStop()) {
        console.log("[VM] Parada solicitada pelo usuário.");
        break;
      }

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
          const tarefa = fila.shift(); 
          await salvarFilaDoStorage(fila); 

          console.log(`[VM] Iniciando tarefa de visita: ${tarefa.nome}. ${fila.length} tarefas restantes na fila.`);
          
          await executarVisita(tarefa); 
          break; // Navegação vai parar o script
      
      } else {
          // 2. FILA VAZIA. Processar a página de busca.
          console.log("[VM] Fila de visitas vazia. Processando página de busca...");
          
          const currentCards = await waitForCards(10000); 
          const currentSignature = getCardsSignature(currentCards);

          if (currentCards.length === 0) {
              console.log("[VM] Nenhum card encontrado na página. Encerrando.");
              break;
          }

          if (processedSignatures.has(currentSignature)) {
              console.warn(`[VM] PÁGINA REPETIDA DETECTADA (Assinatura: ${currentSignature}). A páginação falhou. Encerrando.`);
              break;
          }
          processedSignatures.add(currentSignature);
           console.log(`[VM] Processando página com assinatura: ${currentSignature}`);

          const { enviadosDireto } = await enviarNaPagina(cfg, restante, roleKW, locKW, total, currentCards); 
          total += enviadosDireto;

          if (await shouldStop()) break;

          if (enviadosDireto === 0 && currentCards.length > 0) {
              console.log("[VM] Nenhum envio direto (mas cards foram processados/enfileirados). Tentando avançar página...");
          }

          // 3. PAGINAÇÃO
          const next = nextPageButton();
          if (!next) {
              console.log("[VM] Fila vazia e sem próxima página. Encerrando.");
              break; // Fim
          }
          
          console.log("[VM] Avançando para próxima página...");
          next.scrollIntoView({ behavior: "smooth", block: "center" });
          await waitRandom(600, 1400);
          next.click();
        s   
          // 4. "ESPERA BURRA" (DUMB WAIT)
          console.log("[VM] Esperando 8 segundos para a próxima página carregar...");
          await waitRandom(7000, 9000); // Espera ~8 segundos
      }
    } // Fim do while(true)

    console.log(`[VM] Finalizado Connect Manager. Total final: ${total}.`);
    setProgress({ sent: total, total: cfg.sendLimit, note: "Fim Connect Manager" });
    window.__VM.connectManagerRunning = false;
  })();
})();