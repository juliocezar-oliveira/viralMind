// ===============================
// POPUP.JS — CORRIGIDO (SUPORTE A FILA V20+)
// ===============================
document.addEventListener("DOMContentLoaded", () => {

    // 1) BOTÃO CONECTAR (AUTO-CONNECT)
    const btnAutoConnect = document.getElementById("auto-connect");

    if (btnAutoConnect) {
        btnAutoConnect.addEventListener("click", async () => {
            console.log("[VM] Botão CONECTAR clicado");

            // 1. Pega os valores dos inputs do HTML
            const msgElem = document.getElementById("custom-message");
            const limElem = document.getElementById("message-limit");
            
            const customMessage = msgElem ? msgElem.value : "";
            const limit = limElem ? (parseInt(limElem.value) || 50) : 50;

            // 2. Salva no Storage
            // Importante: Resetamos shouldStop para false para o bot rodar
            await chrome.storage.local.set({
                connectMessage: customMessage,
                sendLimit: limit,
                connectionsSent: 0,
                shouldStop: false, 
                tarefaAtual: { tipo: 'CONECTAR_AUTO' }
            });

            // 3. Injeta o Script
            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Injeta variável global primeiro (Backup para V1)
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (msg) => { window.__VM_NOTE = msg; },
                args: [customMessage]
            });

            // Agora injeta o COLETOR (Gerente)
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["content_connect_only.js"]
            });

            // Força o início (Caso o script já esteja carregado)
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    if (window.VM_START) {
                        console.log("[VM] Chamando VM_START manual...");
                        window.VM_START();
                    }
                }
            });

            // Feedback visual no botão
            const badge = document.getElementById("run-badge");
            if (badge) {
                badge.innerText = "Rodando...";
                badge.style.background = "rgba(43,210,117,.16)";
                badge.style.color = "#2bd275";
            }
        });
    }

    // 2) BOTÃO PARAR
    const btnStop = document.getElementById("stop-connections");

    if (btnStop) {
        btnStop.addEventListener("click", async () => {
            console.log("[VM] PARAR clicado");
            
            // Grava a ordem de parada imediatamente
            await chrome.storage.local.set({ shouldStop: true });

            let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            // Tenta avisar a aba ativa para parar visualmente
            if (tab) {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        if (window.VM_STOP) window.VM_STOP(); // Se houver função de parada exposta
                        window.__VM_COLLECTOR_RUNNING = false; // Para o coletor
                        window.__VM_WORKER_RUNNING = false;    // Para o operário
                        console.log("⛔ Execução parada via Popup!");
                        alert("ViralMind: Parada Solicitada."); // Feedback visual na tela
                    }
                });
            }
            
            // Atualiza badge
            const badge = document.getElementById("run-badge");
            if (badge) {
                badge.innerText = "Parado";
                badge.style.background = "rgba(229, 57, 53, 0.16)";
                badge.style.color = "#e53935";
            }
        });
    }

    // 3) BOTÃO LIMPAR HISTÓRICO (RESET COMPLETO)
    const btnReset = document.getElementById("btn-reset-memory");
    
    if (btnReset) {
        btnReset.addEventListener("click", async () => {
            if (confirm("⚠️ Tem certeza?\n\nIsso apagará:\n1. Histórico de quem já visitou\n2. A fila de perfis pendentes\n\nO robô começará do zero na página atual.")) {
                
                // Limpa cache de visitados E a fila (profileQueue)
                // Adicionei 'profileQueue' aqui para evitar conflito com a nova lógica
                await chrome.storage.local.remove(['visitedProfiles', 'tarefaAtual', 'profileQueue']);
                
                console.log("[VM] Memória e Fila limpas pelo usuário.");
                
                // Efeito visual no botão
                const originalText = btnReset.innerHTML;
                btnReset.innerText = "Memória Limpa!";
                btnReset.style.background = "#4caf50"; // Verde
                btnReset.style.borderColor = "#4caf50";
                
                setTimeout(() => {
                    btnReset.innerHTML = originalText;
                    btnReset.style.background = ""; // Volta ao normal
                    btnReset.style.borderColor = "";
                }, 2000);
            }
        });
    }

});