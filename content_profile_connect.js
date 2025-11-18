// content_profile_connect.js — V16 (Raio-X / Prioridade Visual)
// Correção: Identifica o botão azul "Conectar" explícito antes de tentar menus.

(() => {
    // Evita múltiplas instâncias
    if (window.__VM_PROFILE_RUNNING) return;
    window.__VM_PROFILE_RUNNING = true;

    console.log("[VM] Profile Connect V16 (Raio-X) INICIADO.");

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // --- FUNÇÃO DE RETORNO (CRUCIAL PARA O LOOP) ---
    async function cleanupAndReturn(url) {
        console.log(`[VM] 🔙 Voltando para busca...`);
        // Remove a tarefa atual para liberar o Gerente
        await chrome.storage.local.remove(['tarefaAtual']);
        await delay(1000);
        
        // Se a URL de origem for válida, volta. Se não, volta para busca padrão.
        if (url && url.includes("linkedin.com")) {
            window.location.href = url;
        } else {
            window.location.href = "https://www.linkedin.com/search/results/people/";
        }
    }

    // --- CAÇADOR DE BOTÕES ---
    function findConnectButton() {
        // Coleta todos os botões visíveis na página
        const buttons = Array.from(document.querySelectorAll('button, a.artdeco-button, span.artdeco-button__text'));
        
        // 1. PRIORIDADE: Botão Azul Primário com texto "Conectar" (Caso da Paola)
        const primary = buttons.find(b => {
            const text = (b.innerText || "").trim().toLowerCase();
            const isConnect = text === 'conectar' || text === 'connect';
            // Verifica se é visível
            return isConnect && b.offsetParent !== null;
        });

        if (primary) {
            console.log("[VM] Botão Primário encontrado!");
            return primary;
        }

        // 2. PRIORIDADE: Botão Branco/Secundário ou Aria-Label
        const secondary = buttons.find(b => {
            const text = (b.innerText || "").trim().toLowerCase();
            const label = (b.getAttribute('aria-label') || "").toLowerCase();
            
            // Procura "Conectar" no texto ou "Convidar Fulano para se conectar" no label
            const isConnectText = text === 'conectar' || text === 'connect';
            const isConnectLabel = label.includes('conectar') || label.includes('invite') && label.includes('connect');
            
            // EXCLUI botões de mensagem/share
            const isWrong = text.includes('mensagem') || text.includes('message') || label.includes('message');

            return (isConnectText || isConnectLabel) && !isWrong && b.offsetParent !== null;
        });

        return secondary;
    }

    // --- EXECUÇÃO ---
    (async () => {
        // Variável para garantir que temos para onde voltar em caso de erro
        let returnUrl = "https://www.linkedin.com/search/results/people/";

        try {
            const data = await new Promise(r => chrome.storage.local.get(['tarefaAtual', 'paginaDeOrigem', 'connectMessage'], r));
            const { tarefaAtual, paginaDeOrigem, connectMessage } = data;
            
            if (paginaDeOrigem) returnUrl = paginaDeOrigem;

            // Validação de segurança
            if (!tarefaAtual || tarefaAtual.tipo !== 'VISITAR_PERFIL') {
                console.log("[VM] Sem tarefa de perfil. Ocioso.");
                return;
            }

            console.log(`[VM] 👤 Analisando perfil: ${tarefaAtual.nome}`);
            await delay(3000); // Espera renderizar bem

            // --- PASSO 1: CLICAR EM CONECTAR ---
            let btn = findConnectButton();

            // Se não achou na tela, vai para o menu "Mais"
            if (!btn) {
                console.log("[VM] Botão não visível. Abrindo menu 'Mais'...");
                const moreBtn = Array.from(document.querySelectorAll('button')).find(b => {
                    const label = (b.getAttribute('aria-label') || "").toLowerCase();
                    return label.includes('mais ações') || label.includes('more actions') || b.innerText.trim().toLowerCase() === 'mais';
                });

                if (moreBtn) {
                    moreBtn.click();
                    await delay(1000);
                    // Busca dentro do menu (geralmente divs ou spans com role button)
                    const menuItems = Array.from(document.querySelectorAll('.artdeco-dropdown__item, div[role="button"]'));
                    btn = menuItems.find(el => {
                        const t = el.innerText.trim().toLowerCase();
                        return t === 'conectar' || t === 'connect';
                    });
                }
            }

            if (!btn) {
                console.warn("[VM] ⚠️ Botão Conectar não encontrado (Pendente/Seguir/Bloqueado).");
                await cleanupAndReturn(returnUrl);
                return;
            }

            console.log("[VM] Clicando em Conectar...");
            btn.click();
            await delay(1500);

            // --- PASSO 2: CHECAGEM DE MODAL (Anti-Erro) ---
            // Se abriu "Enviar publicação" (o erro do seu print), fecha e sai
            const modalText = document.body.innerText;
            if (modalText.includes("Enviar publicação") || modalText.includes("Share post")) {
                console.error("[VM] 🚨 Modal errado (Share) aberto! Fechando...");
                const close = document.querySelector('button[aria-label="Fechar"], button[aria-label="Dismiss"]');
                if (close) close.click();
                await delay(1000);
                await cleanupAndReturn(returnUrl);
                return;
            }

            // --- PASSO 3: NOTA (Opcional) ---
            // Verifica se é o modal de conexão real
            if (connectMessage && connectMessage.length > 2) {
                const addNoteBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('adicionar nota'));
                if (addNoteBtn) {
                    addNoteBtn.click();
                    await delay(800);
                    const txt = document.querySelector('textarea');
                    if (txt) {
                        txt.value = connectMessage.replace("{nome}", tarefaAtual.nome.split(" ")[0]);
                        txt.dispatchEvent(new Event('input', { bubbles: true }));
                        await delay(500);
                    }
                }
            }

            // --- PASSO 4: ENVIAR FINAL ---
            const sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
                const t = b.innerText.trim().toLowerCase();
                return (t === 'enviar' || t === 'enviar agora' || t === 'send') && !b.disabled;
            });

            if (sendBtn) {
                console.log("[VM] ✅ Enviando...");
                sendBtn.click();
                
                // Conta +1
                chrome.storage.local.get("connectionsSent", d => {
                    chrome.storage.local.set({ connectionsSent: (d.connectionsSent || 0) + 1 });
                });
                
                await delay(2000);
            } else {
                console.log("[VM] Botão enviar final não achado (talvez já enviado?).");
            }

            // --- FIM: VOLTA PARA O LOOP ---
            await cleanupAndReturn(returnUrl);

        } catch (e) {
            console.error("[VM] Erro Crítico:", e);
            // Garante o retorno mesmo com erro para não travar a fila
            await cleanupAndReturn(returnUrl);
        }
    })();
})();