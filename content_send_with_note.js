// content_send_with_note.js — V37 (Span Target / Text Clicker)
// Correção: Clica diretamente no SPAN de texto que você enviou e fecha modais intrusos.

(() => {
    if (window.__VM_WORKER_RUNNING) return;
    window.__VM_WORKER_RUNNING = true;
    console.log("[VM] OPERÁRIO V37 (Span Target) Iniciado.");

    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    
    const humanDelay = async (min, max) => {
        const ms = randomInt(min, max);
        console.log(`[VM] ⏳ Aguardando ${ms/1000}s...`);
        await delay(ms);
    };

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
                console.log("[VM] ☕ Pausa entre perfis...");
                await humanDelay(8000, 15000); 
                await checkStop();

                const nextProfile = queue.shift();
                const visited = data.visitedProfiles || [];
                visited.push(nextProfile.url);

                await chrome.storage.local.set({
                    profileQueue: queue,
                    visitedProfiles: visited,
                    tarefaAtual: nextProfile
                });

                window.location.assign(nextProfile.url);
            } else {
                console.log("[VM] Fila acabou. Voltando...");
                await chrome.storage.local.remove(['tarefaAtual']);
                window.location.assign(data.paginaDeBuscaUrl || "https://www.linkedin.com/search/results/people/");
            }
        } catch (e) { if (e.message !== "STOP_REQUESTED") console.error(e); }
    }

    function clickElement(el) {
        el.click();
        // Clica no pai também para garantir
        if (el.parentElement) el.parentElement.click();
    }

    // --- 1. CONECTAR (Top Card Only) ---
    async function findAndClickConnect() {
        const topCard = document.querySelector('.pv-top-card') || document.querySelector('main');
        if (!topCard) return false;

        // Botão Direto
        const directBtn = Array.from(topCard.querySelectorAll('button, a')).find(el => {
            const viewName = el.getAttribute('data-view-name') || "";
            if (viewName === 'edge-creation-connect-action') return true;
            const txt = el.innerText.trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || "").toLowerCase();
            
            if (txt.includes('seguir') || txt.includes('mensagem')) return false;
            return txt === 'conectar' || txt === 'connect' || aria === 'conectar';
        });

        if (directBtn) {
            console.log("[VM] Botão Conectar encontrado.");
            clickElement(directBtn);
            return true;
        }

        // Menu Mais
        const moreBtn = Array.from(topCard.querySelectorAll('button')).find(el => {
            const viewName = el.getAttribute('data-view-name') || "";
            const aria = (el.getAttribute('aria-label') || "").toLowerCase();
            return viewName === 'profile-overflow-button' || aria.includes('mais ações');
        });

        if (moreBtn) {
            moreBtn.click();
            await humanDelay(1000, 1500); 
            const menuItems = Array.from(document.querySelectorAll('.artdeco-dropdown__item, div[role="button"], span'));
            const connectItem = menuItems.find(el => {
                const t = el.innerText.trim().toLowerCase();
                if (t.includes("mensagem") || t.includes("share")) return false;
                return t === 'conectar' || t === 'connect';
            });
            if (connectItem) {
                clickElement(connectItem);
                return true;
            }
        }
        return false;
    }

    // --- 2. GERENCIADOR DE MODAL (Lógica V37) ---
    async function handleNoteAndSend(message, firstName) {
        console.log("[VM] Procurando 'Adicionar nota' (Loop de 15s)...");
        
        let noteSpanFound = null;
        let elapsed = 0;
        const maxWait = 15000;

        while (elapsed < maxWait) {
            
            // A. MATA O INTRUSO (Janela de Compartilhamento)
            const modals = document.querySelectorAll('div[role="dialog"], .artdeco-modal');
            for (const modal of modals) {
                const text = modal.innerText.toLowerCase();
                // Se for a janela errada
                if (text.includes("enviar publicação") || text.includes("share post")) {
                    console.log("[VM] 🚨 Janela errada detectada. Fechando...");
                    const closeBtn = modal.querySelector('button[aria-label="Fechar"], button[aria-label="Dismiss"]');
                    if (closeBtn) {
                        closeBtn.click();
                        await delay(1500); // Espera fechar
                    }
                }
            }

            // B. BUSCA O SPAN ESPECÍFICO DA NOTA
            // Baseado no HTML que você enviou: <span class="artdeco-button__text"> Adicionar nota </span>
            const spans = Array.from(document.querySelectorAll('span.artdeco-button__text'));
            
            noteSpanFound = spans.find(s => {
                // Verifica se o texto é exatamente "Adicionar nota" e se está visível
                return s.innerText.trim().toLowerCase() === "adicionar nota" && s.offsetParent !== null;
            });

            if (noteSpanFound) {
                console.log("[VM] ✅ Span 'Adicionar nota' encontrado! Clicando...");
                
                // Tenta clicar no SPAN
                noteSpanFound.click();
                
                // Tenta clicar no BOTÃO PAI também (garantia)
                const parentBtn = noteSpanFound.closest('button');
                if (parentBtn) parentBtn.click();

                break; // Sai do loop
            }

            await delay(500);
            elapsed += 500;
        }

        // C. ESCREVE A NOTA
        if (noteSpanFound) {
            console.log("[VM] Aguardando caixa de texto...");
            let textArea = null;
            let tWait = 0;
            
            while (tWait < 6000) {
                textArea = document.querySelector('#custom-message');
                if (textArea) break;
                await delay(400);
                tWait += 400;
            }
            
            if (textArea) {
                await delay(1000);
                const finalMsg = message.replace(/{nome}|{name}/yi, firstName);
                textArea.value = finalMsg;
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
                console.log("[VM] Texto preenchido.");
                await delay(2000);
            } else {
                console.error("[VM] ❌ TextArea não apareceu (Clique falhou?).");
            }
        } else {
            console.log("[VM] Timeout: Texto 'Adicionar nota' não encontrado na tela.");
        }

        // D. ENVIAR
        console.log("[VM] Procurando botão Enviar...");
        const sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = b.innerText.trim().toLowerCase();
            return (t === 'enviar' || t === 'enviar agora' || t === 'send') && !b.disabled;
        });

        if (sendBtn) {
            console.log("[VM] 🚀 Enviando...");
            sendBtn.click();
            chrome.storage.local.get("connectionsSent", d => {
                chrome.storage.local.set({ connectionsSent: (d.connectionsSent || 0) + 1 });
            });
            await delay(3000);
        }
    }

    // --- EXECUÇÃO ---
    (async () => {
        try {
            await checkStop();
            const data = await new Promise(r => chrome.storage.local.get(['tarefaAtual', 'connectMessage'], r));
            const { tarefaAtual, connectMessage } = data;

            if (!tarefaAtual) return;

            console.log(`[VM] 👤 Perfil: ${tarefaAtual.nome}`);
            await delay(5000);

            const clicked = await findAndClickConnect();
            if (!clicked) {
                console.warn("[VM] Botão Conectar não encontrado.");
                await goNext();
                return;
            }

            if (connectMessage && connectMessage.length > 2) {
                const firstName = tarefaAtual.nome.split(" ")[0];
                await handleNoteAndSend(connectMessage, firstName);
            } else {
                await delay(3000);
                const sendBtn = document.querySelector('button[aria-label="Enviar agora"]');
                if(sendBtn) sendBtn.click();
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