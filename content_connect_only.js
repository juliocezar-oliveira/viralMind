// content_connect_only.js — V47 (Coletor com Memória de Batch)
// Adição: Salva a lista original completa para gerar relatórios de progresso.

(() => {
    if (window.__VM_COLLECTOR_RUNNING) return;
    window.__VM_COLLECTOR_RUNNING = true;
    console.log("[VM] COLETOR V47 Iniciado.");

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    function scrapeProfiles() {
        let links = Array.from(document.querySelectorAll('a[data-view-name="search-result-lockup-title"]'));
        
        if (links.length === 0) {
            links = Array.from(document.querySelectorAll('.entity-result__title-text a'));
        }

        if (links.length === 0) {
            const candidates = Array.from(document.querySelectorAll('li a[href*="/in/"]'));
            links = candidates.filter(a => {
                const v = a.getAttribute('data-view-name') || "";
                return !v.includes("insight") && !v.includes("social") && a.innerText.trim().length > 3;
            });
        }

        return links.map(a => {
            const urlObj = new URL(a.href);
            return {
                nome: a.innerText.trim(),
                url: (urlObj.origin + urlObj.pathname).replace(/\/$/, "")
            };
        }).filter(p => !p.nome.includes("LinkedIn Member"));
    }

    async function startCollection() {
        await delay(3000);

        const storage = await new Promise(r => chrome.storage.local.get(['visitedProfiles', 'shouldStop'], r));
        
        if (storage.shouldStop) {
            console.log("[VM] Parada solicitada.");
            return;
        }

        const rawProfiles = scrapeProfiles();
        const visited = storage.visitedProfiles || [];
        
        // Filtra novos
        const newBatch = rawProfiles.filter(p => !visited.includes(p.url));

        // --- RELATÓRIO INICIAL ---
        console.group("📋 LISTA DETECTADA NA PÁGINA");
        console.table(rawProfiles.map(p => ({
            Nome: p.nome,
            Status: visited.includes(p.url) ? '❌ Já feito antes' : '🆕 Novo (Vai pra fila)'
        })));
        console.groupEnd();

        if (newBatch.length > 0) {
            const first = newBatch[0];
            const queue = newBatch.slice(1);

            visited.push(first.url);

            // SALVA TUDO (Incluindo a lista original para o relatório visual)
            await chrome.storage.local.set({
                currentPageBatch: newBatch, // Lista completa do lote atual para exibição
                profileQueue: queue,
                visitedProfiles: visited,
                tarefaAtual: first,
                paginaDeBuscaUrl: window.location.href
            });

            console.log(`[VM] ▶️ Iniciando: ${first.nome}`);
            window.location.assign(first.url);

        } else {
            console.log("[VM] Nenhum novo nesta página. Tentando próxima...");
            const nextBtn = document.querySelector('button[aria-label="Avançar"]') || 
                            document.querySelector('button[aria-label="Next"]') ||
                            document.querySelector('.artdeco-pagination__button--next');

            if (nextBtn && !nextBtn.disabled) {
                nextBtn.click();
            } else {
                alert("ViralMind: Fim da lista de busca!");
                await chrome.storage.local.set({ shouldStop: true });
            }
        }
    }

    chrome.storage.local.get(['shouldStop'], d => {
        if (!d.shouldStop) startCollection();
    });
    
    window.VM_START = startCollection;
})();