// content_send_with_note.js — V56 (Fantasma Humanizado / VM Fixed)
// Lógica: Espera 10s iniciais, usa Mouse Fantasma, busca profunda no menu 'Mais'.

(() => {
    // Proteção contra perda de contexto
    try { if (!chrome.runtime?.id) return; } catch (e) { return; }

    if (window.__VM_WORKER_RUNNING) return;
    window.__VM_WORKER_RUNNING = true;
    console.log("[VM] OPERÁRIO V56 (Humano) Iniciado.");

    // --- UTILITÁRIOS DE TEMPO ---
    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const humanDelay = async (min, max) => await delay(randomInt(min, max));

    let ghostCursor = null;

    // --- MOUSE FANTASMA (VISUAL) ---
    async function initCursor() {
        while (!document.body) await delay(50);
        if (!document.getElementById('vm-ghost-cursor')) {
            ghostCursor = document.createElement('div');
            ghostCursor.id = 'vm-ghost-cursor';
            // Bolinha vermelha bem visível
            ghostCursor.style.cssText = "position:fixed;width:20px;height:20px;background:rgba(255, 0, 0, 0.8);border:2px solid white;border-radius:50%;z-index:2147483647;pointer-events:none;display:none;transition:top 0.8s cubic-bezier(0.25, 1, 0.5, 1), left 0.8s cubic-bezier(0.25, 1, 0.5, 1);box-shadow:0 4px 8px rgba(0,0,0,0.3);";
            document.body.appendChild(ghostCursor);
        } else {
            ghostCursor = document.getElementById('vm-ghost-cursor');
        }
    }

    async function moveAndClick(element, desc) {
        if (!element) return false;
        if (!ghostCursor) await initCursor();
        
        console.log(`[VM] 🖱️ Mouse indo para: ${desc}`);
        
        // 1. Calcula Posição (Centro do Elemento)
        const rect = element.getBoundingClientRect();
        const x = rect.left + (rect.width / 2);
        const y = rect.top + (rect.height / 2);

        // 2. Move o cursor
        ghostCursor.style.display = 'block';
        ghostCursor.style.top = `${y}px`;
        ghostCursor.style.left = `${x}px`;

        // Tempo de movimento do mouse (0.8s a 1.2s)
        await delay(800 + Math.random() * 400); 
        
        // 3. Efeito de Clique
        ghostCursor.style.transform = 'scale(0.8)';
        ghostCursor.style.background = 'yellow'; // Pisca amarelo no clique
        
        // 4. Dispara Eventos Reais
        element.focus();
        element.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
        element.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
        element.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
        element.click();
        
        await delay(150);
        ghostCursor.style.transform = 'scale(1)';
        ghostCursor.style.background = 'rgba(255, 0, 0, 0.8)'; // Volta a vermelho
        
        console.log(`[VM] 💥 CLICADO: ${desc}`);
        await delay(1000); // Pausa pós-clique
        return true;
    }

    async function checkStop() {
        const data = await new Promise(r => chrome.storage.local.get('shouldStop', r));
        if (data.shouldStop) throw new Error("STOP_REQUESTED");
    }

    async function goNext() {
        try {
            await checkStop();
            const data = await new Promise(r => chrome.storage.local.get(['profileQueue', 'visitedProfiles', 'paginaDeBuscaUrl'], r));
            let queue = data.profileQueue || [];

            if (queue.length > 0) {
                console.log(`[VM] ⏳ Pausa antes de sair...`);
                await delay(3000); 
                await checkStop();

                const nextProfile = queue.shift();
                const visited = data.visitedProfiles || [];
                visited.push(nextProfile.url);

                await chrome.storage.local.set({
                    profileQueue: queue,
                    visitedProfiles: visited,
                    tarefaAtual: nextProfile
                });

                console.log(`[VM] ⏭️ Indo para: ${nextProfile.nome}`);
                window.location.assign(nextProfile.url);
            } else {
                console.log("[VM] Fila acabou. Voltando...");
                await chrome.storage.local.remove(['tarefaAtual']);
                window.location.assign(data.paginaDeBuscaUrl || "https://www.linkedin.com/search/results/people/");
            }
        } catch (e) { if (e.message !== "STOP_REQUESTED") console.error(e); }
    }

    // --- 1. LÓGICA DE CONEXÃO (A Mais Robusta Possível) ---
    async function findAndClickConnect() {
        await initCursor();
        
        // Limita busca ao Main para evitar sidebar (Pessoas também viram)
        const main = document.querySelector('main') || document.body;

        // --- A. TENTA BOTÃO DIRETO ---
        // Procura botões visíveis que contenham texto "Conectar" ou Aria Label correto
        const allButtons = Array.from(main.querySelectorAll('button, a.artdeco-button'));
        
        const directBtn = allButtons.find(b => {
            // Ignora botões invisíveis ou desabilitados
            if (b.offsetParent === null || b.disabled) return false;

            const text = b.innerText.trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || "").toLowerCase();

            // Filtros Negativos (O que NÃO queremos)
            if (text.includes("mensagem") || text.includes("seguir") || text.includes("salvar")) return false;
            if (aria.includes("mensagem") || aria.includes("seguir")) return false;

            // Filtros Positivos (O que queremos)
            // 1. Texto exato "Conectar"
            // 2. Aria Label tipo "Convidar Fulano para se conectar"
            return text === "conectar" || text === "connect" || (aria.includes("convidar") && aria.includes("conectar"));
        });

        if (directBtn) {
            await moveAndClick(directBtn, "Botão Conectar Direto");
            return true;
        }

        // --- B. TENTA BOTÃO MAIS (...) ---
        console.log("[VM] Botão direto não achado. Buscando 'Mais'...");
        
        const moreBtn = allButtons.find(b => {
            if (b.offsetParent === null) return false;
            const aria = (b.getAttribute('aria-label') || "").toLowerCase();
            const text = b.innerText.trim().toLowerCase();
            // Baseado no seu HTML: aria-label="Mais ações" ou texto "Mais"
            return aria === "mais ações" || text === "mais" || aria.includes("more actions");
        });

        if (moreBtn) {
            await moveAndClick(moreBtn, "Botão Mais (...)");
            console.log("[VM] Esperando menu abrir...");
            await delay(2000); // Espera menu aparecer

            // --- C. BUSCA DENTRO DO MENU ---
            // O menu cria um container novo no final do body, então buscamos no document todo
            // Procuramos itens que tenham o texto "Conectar"
            const menuItems = Array.from(document.querySelectorAll('.artdeco-dropdown__item'));
            
            const connectItem = menuItems.find(item => {
                const t = item.innerText.trim().toLowerCase();
                // Tem "conectar" E NÃO tem "enviar/share"
                return t.includes("conectar") && !t.includes("enviar") && !t.includes("share");
            });

            if (connectItem) {
                // Clica no div clicável dentro do item
                const clickable = connectItem.querySelector('div[role="button"], span') || connectItem;
                await moveAndClick(clickable, "Opção Conectar (Menu)");
                return true;
            } else {
                console.warn("[VM] Opção Conectar não encontrada no menu.");
            }
        }

        return false;
    }

    // --- 2. NOTA E ENVIO ---
    async function handleNoteAndSend(message, firstName) {
        console.log("[VM] Gerenciando Nota (Aguardando 15s)...");
        let noteBtn = null;
        let elapsed = 0;
        const maxWait = 15000; // 15 segundos

        while (elapsed < maxWait) {
            // 1. Mata Intruso (Janela errada)
            const modals = document.querySelectorAll('.artdeco-modal');
            for (const m of modals) {
                if (m.innerText.includes("Enviar publicação") || m.innerText.includes("Share post")) {
                    console.log("[VM] 🚨 Intruso detectado. Movendo para fechar...");
                    const c = m.querySelector('button[aria-label="Fechar"], button[aria-label="Dismiss"]');
                    if (c) await moveAndClick(c, "Fechar Intruso");
                }
            }

            // 2. Busca botão "Adicionar nota"
            // Baseado no seu HTML: <button aria-label="Adicionar nota">
            noteBtn = document.querySelector('button[aria-label="Adicionar nota"]');
            
            if (noteBtn && noteBtn.offsetParent !== null) {
                console.log("[VM] Botão Adicionar Nota encontrado!");
                await moveAndClick(noteBtn, "Botão Adicionar Nota");
                break;
            }
            await delay(500); elapsed += 500;
        }

        // 3. Escreve
        if (noteBtn) {
            console.log("[VM] Aguardando caixa de texto...");
            let textArea = null;
            let tWait = 0;
            while (tWait < 6000) {
                textArea = document.querySelector('#custom-message');
                if (textArea) break;
                await delay(400); tWait += 400;
            }

            if (textArea) {
                await delay(1000);
                
                let safeName = firstName || "lá";
                if (safeName.length < 2) {
                    const h1 = document.querySelector('h1');
                    safeName = h1 ? h1.innerText.split(" ")[0] : "lá";
                }
                safeName = safeName.replace(/,/g, "").replace(/\./g, "");

                const regex = /\{\s*(nome|name)\s*\}/gi;
                const finalMsg = message.replace(regex, safeName);
                
                console.log("[VM] Digitando mensagem...");
                textArea.focus();
                textArea.value = finalMsg;
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
                await delay(2000);
            }
        }

        // 4. Enviar
        const sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = b.innerText.trim().toLowerCase();
            // Aceita "Enviar", "Enviar agora", "Enviar convite"
            return (t === "enviar" || t === "enviar agora" || t === "enviar convite") && !b.disabled;
        });

        if (sendBtn) {
            await moveAndClick(sendBtn, "Botão Enviar");
            chrome.storage.local.get("connectionsSent", d => chrome.storage.local.set({ connectionsSent: (d.connectionsSent || 0) + 1 }));
            await delay(3000);
        }
    }

    // --- EXECUÇÃO ---
    (async () => {
        try {
            await initCursor();
            await checkStop();
            const data = await new Promise(r => chrome.storage.local.get(['tarefaAtual', 'connectMessage'], r));
            const { tarefaAtual, connectMessage } = data;

            if (!tarefaAtual) return;

            console.log(`[VM] 👤 Perfil: ${tarefaAtual.nome}`);
            
            // --- PASSO 1: ESPERA HUMANIZADA INICIAL (10s) ---
            console.log("[VM] ⏳ Simulando leitura do perfil (10s)...");
            await delay(10000);

            // Check se já é conexão
            const main = document.querySelector('main') || document.body;
            const badges = Array.from(main.querySelectorAll('.dist-value, span.aria-hidden'));
            if (badges.some(b => b.innerText.includes('1º'))) {
                console.log("[VM] Já conectado. Pulando.");
                await goNext();
                return;
            }

            const success = await findAndClickConnect();
            
            if (!success) {
                console.warn("[VM] Botão Conectar não encontrado (Pendente/Seguir). Pulando.");
                await goNext();
                return;
            }

            // Pausa dramática antes da nota
            await delay(3000);

            if (connectMessage && connectMessage.length > 2) {
                const name = tarefaAtual.nome ? tarefaAtual.nome.split(" ")[0] : "";
                await handleNoteAndSend(connectMessage, name);
            } else {
                // Envio sem nota
                await delay(2000);
                const sendBtn = document.querySelector('button[aria-label="Enviar agora"], button[aria-label="Enviar sem nota"]');
                if(sendBtn) await moveAndClick(sendBtn, "Enviar Direto");
            }

            await goNext();

        } catch (e) {
            if (e.message !== "STOP_REQUESTED") {
                console.error("[VM] Erro:", e);
                await goNext();
            }
        }
    })();
})();