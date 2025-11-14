// ===============================
// POPUP.JS — CORRIGIDO
// ===============================
document.addEventListener("DOMContentLoaded", () => {

    // 1) BOTÃO CONECTAR (AUTO-CONNECT)
    const btnAutoConnect = document.getElementById("auto-connect");

    btnAutoConnect.addEventListener("click", async () => {
        console.log("[VM] Botão CONECTAR clicado");

        // obtém aba ativa
        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // injeta o script REAL que executa o processo
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content_connect_only.js"]
        });
    });

    // 2) BOTÃO PARAR
    const btnStop = document.getElementById("stop-connections");

    btnStop.addEventListener("click", async () => {
        console.log("[VM] PARAR clicado");

        let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
                if (window.VM_STOP) {
                    window.VM_STOP();
                    console.log("⛔ Execução parada!");
                }
            }
        });
    });

});
