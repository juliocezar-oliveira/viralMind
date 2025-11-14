// content_send_with_note.js
(() => {
    console.log("[VM] Send-With-Note: iniciado.");

    // Evita duplicação
    if (window.__sendWithNoteRunning) {
        console.log("[VM] Já em execução — abortando.");
        return;
    }
    window.__sendWithNoteRunning = true;

    const delay = ms => new Promise(r => setTimeout(r, ms));

    function norm(s=""){ 
        return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
    }

    async function shouldStop() {
        return new Promise(r => {
            try {
                chrome.storage.local.get("shouldStop", d => r(!!d.shouldStop));
            } catch(e){ r(false); }
        });
    }

    async function smartWait(min, max = null) {
        let ms = max ? Math.floor(Math.random()*(max-min+1))+min : min;
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (await shouldStop()) throw new Error("STOP_REQUESTED");
            await delay(200);
        }
    }

    // ⬇️ Seletores reais usados pelo LinkedIn em 2024/2025
    function findConnectButton() {
        const all = [...document.querySelectorAll("button, div[role=button]")];
        return all.find(b => {
            const t = norm(b.innerText || "");
            return (t === "conectar" || t === "connect") && b.offsetParent;
        }) || null;
    }

    function findAddNoteButton() {
        const all = [...document.querySelectorAll("button, span, div")];
        return all.find(b => {
            const t = norm(b.innerText || "");
            return (t.includes("adicionar nota") || t.includes("add a note")) && b.offsetParent;
        });
    }

    function findSendButton() {
        const all = [...document.querySelectorAll("button")];
        return all.find(b => {
            const t = norm(b.innerText || "");
            return (t === "enviar" || t === "send") && b.offsetParent;
        });
    }

    function findMessageBox() {
        return document.querySelector("textarea[name='message']") ||
               document.querySelector("textarea[id*='custom-message']") ||
               document.querySelector("textarea");
    }

    async function executarEnvio(tarefa, mensagemTemplate, origemURL) {

        console.log("[VM] Executando envio para:", tarefa.nome);

        // Esperar carregamento real do perfil
        await smartWait(800, 1500);

        // 1. Botão Conectar
        let btnConnect = findConnectButton();
        if (!btnConnect) {
            console.warn("[VM] NÃO encontrou botão Conectar. Pulando.");
            return finalizar(origemURL, false);
        }

        btnConnect.click();
        await smartWait(1000, 1500);

        // 2. Botão Adicionar Nota
        let btnAddNote = findAddNoteButton();
        if (!btnAddNote) {
            console.warn("[VM] Não encontrou 'Adicionar nota'. Enviando mesmo assim.");
        } else {
            btnAddNote.click();
            await smartWait(700, 1200);
        }

        // 3. Mensagem
        let caixa = findMessageBox();
        if (!caixa) {
            console.warn("[VM] Caixa de mensagem não encontrada!");
        } else {
            const msg = mensagemTemplate.replace("{nome}", tarefa.nome);
            caixa.value = msg;
            caixa.dispatchEvent(new Event("input", { bubbles: true }));
            await smartWait(400, 800);
        }

        // 4. Enviar
        let btnEnviar = findSendButton();
        if (!btnEnviar) {
            console.warn("[VM] Botão enviar não encontrado.");
        } else {
            btnEnviar.click();
            await smartWait(800, 1500);
        }

        // 5. Atualizar contador
        const { connectionsSent } = await new Promise(r => chrome.storage.local.get("connectionsSent", r));
        await chrome.storage.local.set({ connectionsSent: (connectionsSent || 0) + 1 });

        // 6. Finalizar
        await finalizar(origemURL, true);
    }

    async function finalizar(origem, sucesso) {
        console.log("[VM] Finalizando. Sucesso?", sucesso);

        await chrome.storage.local.set({
            tarefaAtual: null
        });

        await smartWait(600, 1200);
        window.location.href = origem;
    }

    // === INÍCIO REAL DO SCRIPT ===
    (async () => {
        try {
            const d = await new Promise(r => chrome.storage.local.get(
                ["tarefaAtual", "paginaDeOrigem", "connectMessage"],
                r
            ));

            const tarefa = d.tarefaAtual;
            if (!tarefa || !tarefa.url) {
                console.log("[VM] Nenhuma tarefaAtual. Saindo.");
                return;
            }

            const origem = d.paginaDeOrigem || "https://www.linkedin.com/search/results/people/";
            const mensagem = d.connectMessage || "Olá {nome}, vi seu perfil e gostaria de me conectar.";

            console.log("[VM] tarefaAtual detectada:", tarefa);

            await executarEnvio(tarefa, mensagem, origem);

        } catch (err) {
            console.error("[VM] Erro no send-with-note:", err);
            await chrome.storage.local.set({ tarefaAtual: null });

            // Tentar voltar de qualquer jeito
            const d = await new Promise(r => chrome.storage.local.get("paginaDeOrigem", r));
            if (d.paginaDeOrigem) window.location.href = d.paginaDeOrigem;
        }
    })();

})();
