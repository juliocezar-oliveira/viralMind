// content_profile_connect.js — "O Trabalhador" (V16 - Limpo)
// CORREÇÃO: Pausas 'waitRandom' substituídas por 'smartWait'
// 			para que o botão "Parar" funcione instantaneamente.

(() => {
  // === Ritmizador global (pacer) ===
  (() => {
    if (window.__pacer) return;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

    const CFG = {
      ranges: {
        conectar: [18000, 33000],
        mensagens: [22000, 45000],
        primeira: [20000, 40000],
        followups: [12000, 28000]
      },
      longEvery: {
        conectar: [7, 11],
        mensagens: [5, 9],
        primeira: [6, 10],
        followups: [10, 15]
      },
      longPauseMs: {
        conectar: [120000, 240000],
        mensagens: [180000, 300000],
        primeira: [120000, 240000],
        followups: [90000, 180000]
      }
    };

    let stopFlag = false;
    try {
      chrome.storage?.local?.get?.(['shouldStop', 'pacerConfig'], (d) => {
        stopFlag = !!d?.shouldStop;
        if (d?.pacerConfig && typeof d.pacerConfig === 'object') applyConfig(d.pacerConfig);
      });
      chrome.storage?.onChanged?.addListener?.((changes, area) => {
        if (area !== 'local') return;
        if (changes?.shouldStop) stopFlag = !!changes.shouldStop.newValue;
        if (changes?.pacerConfig?.newValue) applyConfig(changes.pacerConfig.newValue);
      });
    } catch { }

    const counters = { conectar: 0, mensagens: 0, primeira: 0, followups: 0 };
    const nextLong = {};

    function applyConfig(conf) {
      const merge = (t, s) => { for (const k in s) { if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) merge(t[k] = t[k] || {}, s[k]); else t[k] = s[k]; } };
      merge(CFG, conf || {});
    }

    async function cancellableWait(ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (stopFlag) throw new Error('STOP_REQUESTED');
        await delay(Math.min(250, ms - (Date.now() - t0)));
      }
    }

  	function needLongPause(tipo) {
      counters[tipo] = (counters[tipo] || 0) + 1;
      const [a, b] = CFG.longEvery[tipo] || [999, 999];
      if (!nextLong[tipo]) nextLong[tipo] = rint(a, b);
      if (counters[tipo] >= nextLong[tipo]) {
        counters[tipo] = 0;
        nextLong[tipo] = rint(a, b);
        return true;
      }
      return false;
    }

    async function between(tipo) {
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
  // === Fim do Pacer ===


  window.__VM = window.__VM || {};
  if (window.__VM.profileConnectRunning) {
    console.log("[VM] content_profile_connect.js já em execução.");
    return;
  }
  window.__VM.profileConnectRunning = true;
  console.log("[VM] content_profile_connect.js INICIADO.");

  // ---------- Utils ----------
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  function randInt(min, max) { min = Math.ceil(min); max = Math.floor(max); return Math.floor(Math.random() * (max - min + 1)) + min; }

  async function shouldStop() {
    return new Promise((resolve) => {
      try {
        	chrome.storage.local.get("shouldStop", (d) => resolve(!!d.shouldStop));
      } catch (e) {
        	resolve(false);
      }
    });
  }

  // --- NOVA FUNÇÃO ---
  // Pausa "Inteligente" que pode ser interrompida pelo botão "Parar"
  async function smartWait(minMs, maxMs = null) {
    	let ms = maxMs ? randInt(minMs, maxMs) : minMs;
    	const t0 = Date.now();
    	while (Date.now() - t0 < ms) {
    		if (await shouldStop()) throw new Error('STOP_REQUESTED');
    		await delay(Math.min(250, ms - (Date.now() - t0)));
    	}
  }

  // ---------- Funções de Ação no Perfil ----------

  async function findMoreButton(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
    	if (await shouldStop()) throw new Error('STOP_REQUESTED');
      const btns = [...document.querySelectorAll('button')];
      const moreBtn = btns.find(b => {
        const txt = (b.innerText || "").trim().toLowerCase();
        const label = (b.getAttribute('aria-label') || "").toLowerCase();
        return b.offsetParent !== null && (txt === "mais" || txt === "more" || label.includes("mais") || label.includes("more"));
      });
      if (moreBtn && !moreBtn.disabled) return moreBtn;
      await delay(250);
    }
    return null;
  }

  async function findConnectButton(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
    	if (await shouldStop()) throw new Error('STOP_REQUESTED');
      const mainConnectBtn = [...document.querySelectorAll('button')].find(b => {
        const txt = (b.innerText || "").trim().toLowerCase();
        return (txt === "conectar" || txt === "connect") && b.offsetParent !== null;
      });
      if (mainConnectBtn && !mainConnectBtn.disabled) return mainConnectBtn;

      const dropdownOptions = [...document.querySelectorAll('[role="option"], [role="menuitem"], .artdeco-dropdown__item')];
      const dropdownConnectBtn = dropdownOptions.find(el => {
        const txt = (el.innerText || "").trim().toLowerCase();
        return (txt.includes("conectar") || txt.includes("connect")) && !txt.includes("desconectar"); 
      });

      if (dropdownConnectBtn && dropdownConnectBtn.offsetParent !== null) {
        return dropdownConnectBtn;
      }
      await delay(250);
    }
    return null;
  }

  async function findAddNoteButton(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
    	if (await shouldStop()) throw new Error('STOP_REQUESTED');
      const btns = [...document.querySelectorAll('button')];
      const addNoteBtn = btns.find(b => {
        const label = (b.getAttribute('aria-label') || b.innerText || "").trim().toLowerCase();
        return label.includes("adicionar nota") || label.includes("add a note");
      });
      if (addNoteBtn && !addNoteBtn.disabled) return addNoteBtn;
      await delay(150);
    }
    return null;
  }

  async function waitBtnEnviar(timeout = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
    	if (await shouldStop()) throw new Error('STOP_REQUESTED');
      const btn = [...document.querySelectorAll("button")].find(b => {
        const t = (b.innerText || "").trim().toLowerCase();
        return (t === "enviar" || t.includes("enviar convite") || t.includes("enviar agora") || t === "send" || t.includes("send invitation"));
      });
      if (btn && !btn.disabled) return btn;
      await delay(150);
    }
    return null;
  }

  function findNoteField() {
    return (
      document.querySelector('textarea[name="message"]') ||
      document.querySelector('textarea.connect-button-send-invite__custom-message') ||
      document.querySelector("textarea")
    );
  }

  function setText(el, text) {
    if (!el) return;
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function logEnvio({ nome }) {
    chrome.storage.local.get("logs", (r) => {
      const logs = r.logs || [];
      logs.push({
        nome,
        tipo: "Conexão (via Perfil)",
        data: new Date().toISOString(),
        profileUrl: window.location.href
      });
      chrome.storage.local.set({ logs });
    });
  }

  async function cleanupAndReturn(returnUrl) {
    console.log(`[VM] Limpando tarefa e voltando para: ${returnUrl}`);
  	await new Promise(r => chrome.storage.local.remove(['tarefaAtual'], r)); // Não limpa 'paginaDeOrigem'
  	await smartWait(1000, 2500); 
    window.location.href = returnUrl;
  }

  // ---------- MAIN (Lógica Principal) ----------
  (async () => {
  	let paginaDeOrigem; 
  	try {
    	const data = await new Promise(r =>
    		chrome.storage.local.get(['tarefaAtual', 'paginaDeOrigem', 'connectMessage', 'connectionsSent', 'sendLimit'], r)
    	);

    	let { tarefaAtual, connectMessage, connectionsSent } = data;
  		paginaDeOrigem = data.paginaDeOrigem; 

    	if (!tarefaAtual || !paginaDeOrigem || tarefaAtual.tipo !== 'VISITAR_PERFIL') {
    		console.log("[VM] Perfil carregado, mas não é uma visita de tarefa. Script inativo.");
    		window.__VM.profileConnectRunning = false;
    		return;
  	}

  	console.log(`[VM] Iniciando tarefa de conexão para: ${tarefaAtual.nome}`);

  	await smartWait(3000, 6000); 

  	// 2. Achar o botão "Conectar"
  	let connectBtn = await findConnectButton();

  	if (!connectBtn) {
  		const moreBtn = await findMoreButton();
  		if (moreBtn) {
  			console.log("[VM] Clicando em 'Mais...'");
  			moreBtn.click();
  			await smartWait(800, 1500); 
  			connectBtn = await findConnectButton();
  		}
  	}

  	if (!connectBtn) {
  		console.error("[VM] NÃO FOI POSSÍVEL achar o botão 'Conectar' no perfil. Abortando tarefa e voltando.");
  		await cleanupAndReturn(paginaDeOrigem);
  		return;
  	}

  	// 3. Clicar em "Conectar"
  	console.log("[VM] Botão 'Conectar' encontrado. Clicando.");
  	connectBtn.click();
  	await smartWait(1000, 2000); 

  	// 4. Clicar em "Adicionar Nota" (SE TIVER MENSAGEM)
  	const mensagem = (connectMessage || "").replace(/{nome}/g, tarefaAtual.nome.split(' ')[0]);
  	
  	if (mensagem.trim().length > 0) {
  		const addNoteBtn = await findAddNoteButton();
  		if (!addNoteBtn) {
  			console.error("[VM] NÃO FOI POSSÍVEL achar 'Adicionar nota' no modal. Abortando e voltando.");
  			const closeBtn = document.querySelector('button[aria-label="Fechar"]');
  			if (closeBtn) closeBtn.click();
  			await cleanupAndReturn(paginaDeOrigem);
  			return;
  		}

  		console.log("[VM] Clicando em 'Adicionar nota'.");
  		addNoteBtn.click();
  		await smartWait(500, 1000); 

  		// 5. Preencher a mensagem
  		const textArea = findNoteField();
  		if (!textArea) {
  			console.error("[VM] NÃO FOI POSSÍVEL achar o campo de texto. Abortando e voltando.");
  			const closeBtn = document.querySelector('button[aria-label*="Fechar"]');
  			if (closeBtn) closeBtn.click();
  			await cleanupAndReturn(paginaDeOrigem);
  			return;
  		}

  		console.log("[VM] Preenchendo mensagem.");
  		setText(textArea, mensagem);
  		await smartWait(400, 900); 
  	} else {
  		console.log("[VM] Nenhuma mensagem personalizada. Enviando convite sem nota.");
  	}

  	// 6. Clicar em "Enviar"
  	const sendBtn = await waitBtnEnviar();
  	if (!sendBtn) {
  		console.error("[VM] NÃO FOI POSSÍVEL achar o botão 'Enviar' final. Abortando e voltando.");
  		const closeBtn = document.querySelector('button[aria-label*="Fechar"]');
  		if (closeBtn) closeBtn.click();
  		await cleanupAndReturn(paginaDeOrigem);
  		return;
  	}

  	console.log("[VM] ✅ CONVITE ENVIADO. Preparando para voltar.");
  	sendBtn.click();

  	// 7. Atualizar contagem e Log
  	const newSentCount = (connectionsSent || 0) + 1;
  	await new Promise(r => chrome.storage.local.set({ connectionsSent: newSentCount }, r));
  	logEnvio(tarefaAtual);
  	
  	// +PACER (Conectar)
  	if (window.__pacer?.between) { 
  		console.log("[VM] Iniciando pausa do 'pacer' (18-33s)...");
  		await window.__pacer.between('conectar'); 
  	}
  	
  	// 8. Limpar e Voltar para a página de busca
  	await cleanupAndReturn(paginaDeOrigem);

   } catch (err) {
  	console.error("[VM] Erro no script de perfil:", err);
  	if (err.message === 'STOP_REQUESTED') {
  		console.log("[VM] Processo interrompido pelo usuário.");
  	}
  	if (paginaDeOrigem) {
  		await cleanupAndReturn(paginaDeOrigem);
  	} else {
  		window.__VM.profileConnectRunning = false;
  	}
   }
  })();
})();