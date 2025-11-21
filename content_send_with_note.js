// content_send_with_note.js — V47 (Relatório Persistente)
// Adição: Imprime tabela de status a cada perfil visitado.

(() => {
    if (window.__VM_WORKER_RUNNING) return;
    window.__VM_WORKER_RUNNING = true;
    console.log("[VM] OPERÁRIO V47 Iniciado.");

    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const humanDelay = async (min, max) => await delay(randomInt(min, max));

    let ghostCursor = null;

    // --- VISUALIZAÇÃO DE STATUS (NOVO) ---
    async function printStatusTable() {
        const data = await new Promise(r => chrome.storage.local.get(['currentPageBatch', 'visitedProfiles', 'tarefaAtual'], r));
        const batch = data.currentPageBatch || [];
        const visited = data.visitedProfiles || [];
        const current = data.tarefaAtual || {};

        if (batch.length === 0) return;

        const report = batch.map(p => {
            let status = '⏳ Na Fila';
            
            // Se já foi visitado E não é o atual
            if (visited.includes(p.url) && p.url !== current.url) {
                status = '✅ Concluído';
            }
            // Se é o atual
            else if (p.url === current.url) {
                status = '🔄 PROCESSANDO...';
            }

            return {
                'Nome do Candidato': p.nome,
                'Status Atual': status
            };
        });

        console.clear(); // Limpa console antigo para focar no atual
        console.log(`%c📊 STATUS DA PÁGINA ATUAL`, "font-size: 14px; font-weight: bold; color: #0a66c2;");
        console.table(report);
    }

    // --- CURSOR ---
    async function initCursor() {
        while (!document.body) await delay(50);
        if (!document.getElementById('vm-ghost-cursor')) {
            ghostCursor = document.createElement('div');
            ghostCursor.id = 'vm-ghost-cursor';
            ghostCursor.style.cssText = "position:fixed;width:20px;height:20px;background:red;border:2px solid white;border-radius:50%;z-index:2147483647;pointer-events:none;display:none;transition:top 0.5s, left 0.5s;box-shadow:0 0 10px rgba(255,0,0,0.8);";
            document.body.appendChild(ghostCursor);
        } else {
            ghostCursor = document.getElementById('vm-ghost-cursor');
        }
    }

    async function moveAndClick(element, desc) {
        if (!element) return false;
        if (!ghostCursor) await initCursor();
        console.log(`[VM] 🖱️ Indo para: ${desc}`);
        const r = element.getBoundingClientRect();
        const x = r.left + r.width / 2; const y = r.top + r.height / 2;
        
        ghostCursor.style.display = 'block';
        ghostCursor.style.top = `${y}px`; ghostCursor.style.left = `${x}px`;
        await delay(800); 
        
        element.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
        element.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
        element.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
        element.click();
        
        ghostCursor.style.transform = 'scale(0.8)';
        await delay(150);
        ghostCursor.style.transform = 'scale(1)';
        await delay(500);
        ghostCursor.style.display = 'none';
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
                console.log(`[VM] ☕ Pausa...`);
                await humanDelay(5000, 10000);
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
                await chrome.storage.local.remove(['tarefaAtual', 'currentPageBatch']); // Limpa o batch ao voltar
                window.location.assign(data.paginaDeBuscaUrl || "https://www.linkedin.com/search/results/people/");
            }
        } catch (e) { if (e.message !== "STOP_REQUESTED") console.error(e); }
    }

    function isAlreadyConnected() {
        const topCard = document.querySelector('.pv-top-card') || document.querySelector('main');
        if (!topCard) return false;
        
        const badges = Array.from(topCard.querySelectorAll('.dist-value, span.aria-hidden'));
        if (badges.some(b => b.innerText.includes('1º') || b.innerText.includes('1st'))) return true;

        const buttons = Array.from(topCard.querySelectorAll('button, a.artdeco-button'));
        const hasMessage = buttons.some(b => b.innerText.toLowerCase().includes('mensagem'));
        const hasConnect = buttons.some(b => b.innerText.toLowerCase().includes('conectar'));

        if (hasMessage && !hasConnect) return true;
        return false;
    }

    async function findAndClickConnect() {
        await initCursor();
        const main = document.querySelector('main') || document.body;
        
        if (isAlreadyConnected()) return "ALREADY_CONNECTED";

        let target = Array.from(main.querySelectorAll('button, a')).find(el => {
            const t = el.innerText.trim().toLowerCase();
            const a = (el.getAttribute('aria-label') || "").toLowerCase();
            if (t.includes("mensagem") || t.includes("seguir")) return false;
            return t === 'conectar' || t === 'connect' || a === 'conectar';
        });

        if (target) {
            await moveAndClick(target, "Conectar Direto");
            return true;
        }

        const moreBtn = Array.from(main.querySelectorAll('button')).find(el => {
            const a = (el.getAttribute('aria-label') || "").toLowerCase();
            return a.includes('mais ações') || a.includes('more actions') || el.getAttribute('data-view-name') === 'profile-overflow-button';
        });

        if (moreBtn) {
            await moveAndClick(moreBtn, "Menu Mais");
            await delay(1500);
            const items = Array.from(document.querySelectorAll('.artdeco-dropdown__item, span'));
            target = items.find(el => {
                const t = el.innerText.trim().toLowerCase();
                return (t === 'conectar' || t === 'connect') && !t.includes("share");
            });
            if (target) {
                await moveAndClick(target, "Conectar no Menu");
                return true;
            }
        }
        return false;
    }

    async function handleNoteAndSend(message, firstName) {
        console.log("[VM] Gerenciando Nota (15s)...");
        let noteBtn = null;
        let elapsed = 0;

        while (elapsed < 15000) {
            const modals = document.querySelectorAll('.artdeco-modal');
            for (const m of modals) {
                if (m.innerText.includes("Enviar publicação") || m.innerText.includes("Share post")) {
                    console.log("[VM] Fechando intruso...");
                    const c = m.querySelector('button[aria-label="Fechar"], button[aria-label="Dismiss"]');
                    if (c) await moveAndClick(c, "Fechar Intruso");
                }
            }

            const spans = Array.from(document.querySelectorAll('span.artdeco-button__text'));
            const targetSpan = spans.find(s => s.innerText.trim() === "Adicionar nota");
            if (targetSpan && targetSpan.offsetParent) {
                noteBtn = targetSpan.closest('button');
                if (noteBtn) {
                    await moveAndClick(noteBtn, "Adicionar Nota");
                    break;
                }
            }
            await delay(500); elapsed += 500;
        }

        if (noteBtn) {
            console.log("[VM] Aguardando textarea...");
            let textArea = null;
            let tWait = 0;
            while (tWait < 6000) {
                textArea = document.querySelector('#custom-message');
                if (textArea) break;
                await delay(400); tWait += 400;
            }

            if (textArea) {
                await delay(500);
                let safeName = firstName || "";
                if (!safeName || safeName.length < 2) {
                    const h1 = document.querySelector('h1');
                    safeName = h1 ? h1.innerText.split(" ")[0] : "lá";
                }
                safeName = safeName.replace(/,/g, "").replace(/\./g, "");

                const regex = /\{\s*(nome|name)\s*\}/gi;
                const finalMsg = message.replace(regex, safeName);
                
                textArea.value = finalMsg;
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
                console.log(`[VM] Texto escrito.`);
                await delay(2000);
            }
        }

        const sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = b.innerText.trim().toLowerCase();
            return (t === 'enviar' || t === 'enviar agora') && !b.disabled;
        });
        if (sendBtn) {
            await moveAndClick(sendBtn, "Enviar Final");
            chrome.storage.local.get("connectionsSent", d => chrome.storage.local.set({ connectionsSent: (d.connectionsSent || 0) + 1 }));
            await delay(3000);
        }
    }

    // --- EXECUÇÃO ---
    (async () => {
        try {
            await initCursor();
            await printStatusTable(); // Imprime a tabela logo no início
            await checkStop();
            const data = await new Promise(r => chrome.storage.local.get(['tarefaAtual', 'connectMessage'], r));
            const { tarefaAtual, connectMessage } = data;

            if (!tarefaAtual) return;

            console.log(`[VM] 👤 Perfil: ${tarefaAtual.nome}`);
            await delay(4000);

            const status = await findAndClickConnect();
            
            if (status === "ALREADY_CONNECTED") {
                console.log(`[VM] ⚠️ Já conectado. Pulando...`);
                await goNext();
                return;
            }

            if (!status) {
                console.warn("[VM] Botão Conectar não achado.");
                await goNext();
                return;
            }

            if (connectMessage && connectMessage.length > 2) {
                // Extrai nome da tarefa, mas deixa o fallback do H1 agir se necessário dentro da função
                const nameFromTask = tarefaAtual.nome ? tarefaAtual.nome.split(" ")[0] : "";
                await handleNoteAndSend(connectMessage, nameFromTask);
            } else {
                await delay(2000);
                const sendBtn = document.querySelector('button[aria-label="Enviar agora"]');
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