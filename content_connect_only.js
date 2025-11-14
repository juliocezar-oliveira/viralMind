(() => {
    if (window.__VM_RUNNING) return;
    window.__VM_RUNNING = true;

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    let queue = [];
    let currentIndex = 0;
    let running = false;

    const SELECTORS = {
        connectBtn: 'button[aria-label*="Conectar"], button[aria-label*="Connect"]',
        sendBtn: 'button[aria-label*="Enviar"], button[aria-label*="Send"]',
        addNoteBtn: 'button[aria-label*="Adicionar nota"], button[aria-label*="Add note"]',
        textarea: 'textarea[name="message"]',
        closeModal: 'button[aria-label="Fechar"], button[aria-label="Close"]'
    };

    // =========================================================
    // 1) COLETA OS PERFIS
    // =========================================================
    function collectProfiles() {
        let cards = [...document.querySelectorAll('a[href^="https://www.linkedin.com/in/"]')]
            .map(a => ({
                nome: a.innerText.trim(),
                url: a.href
            }));

        queue = cards.map(c => c.url);  // lista de URLs (strings)
        console.log(`🔍 Perfis encontrados:`, queue);
    }

    // =========================================================
    // 2) PROCESSA PERFIL
    // =========================================================
    async function processProfile(url) {
        console.log("➡️ Indo para:", url);
        window.location.assign(url);

        await delay(3000);

        let btn = document.querySelector(SELECTORS.connectBtn);
        if (!btn) {
            console.log("❌ Nenhum botão de conexão. Próximo.");
            return;
        }

        btn.click();
        await delay(1200);

        const addNote = document.querySelector(SELECTORS.addNoteBtn);
        if (addNote) {
            addNote.click();
            await delay(800);

            const textarea = document.querySelector(SELECTORS.textarea);
            if (textarea) {
                textarea.value = window.__VM_NOTE || "";
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            }

            await delay(600);

            let send = document.querySelector(SELECTORS.sendBtn);
            if (send) send.click();
        } else {
            let send = document.querySelector(SELECTORS.sendBtn);
            if (send) send.click();
        }

        await delay(2000);

        const close = document.querySelector(SELECTORS.closeModal);
        if (close) close.click();

        await delay(1000);
    }

    // =========================================================
    // 3) VOLTA PARA LISTA
    // =========================================================
    async function returnToList() {
        history.back();
        await delay(2500);
    }

    // =========================================================
    // 4) LOOP PRINCIPAL
    // =========================================================
    async function runQueue() {
        collectProfiles();
        running = true;

        while (running && currentIndex < queue.length) {
            const url = queue[currentIndex];
            console.log(`🔥 Processando ${currentIndex + 1}/${queue.length}`);

            await processProfile(url);
            await returnToList();

            currentIndex++;
            await delay(1500);
        }

        console.log("✅ Finalizado.");
        running = false;
        window.__VM_RUNNING = false;
    }

    // =========================================================
    // START & STOP
    // =========================================================
    window.VM_START = () => {
        console.log("▶️ INICIANDO...");
        runQueue();
    };

    window.VM_STOP = () => {
        console.log("⛔ PARANDO...");
        running = false;
    };
})();
