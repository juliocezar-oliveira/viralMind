// content_connect_only.js — V20 (Coletor de Fila)
// Função: Raspa URLs -> Cria Fila -> Inicia o 1º da Fila -> Gerencia Paginação

(() => {
    console.log("[VM] COLETOR V20 Iniciado na Busca.");

    // Previne múltiplas execuções na mesma página
    if (window.__VM_COLLECTOR_RUNNING) return;
    window.__VM_COLLECTOR_RUNNING = true;

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // --- 1. SELETOR DE PERFIS (O mais seguro) ---
    function scrapeProfiles() {
        // Busca links pelo atributo data-view-name (método validado na V10)
        let links = Array.from(document.querySelectorAll('a[data-view-name="search-result-lockup-title"]'));
        
        // Fallback se o LinkedIn mudar o atributo
        if (links.length === 0) {
            links = Array.from(document.querySelectorAll('.entity-result__title-text a'));
        }

        // Fallback final (li genérico)
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
        }).filter(p => !p.nome.includes("LinkedIn Member")); // Filtra anônimos
    }

    // --- 2. PAGINAÇÃO ---
    async function goToNextPage() {
        console.log("[VM] Fila vazia. Tentando mudar de página...");
        const nextBtn = document.querySelector('button[aria-label="Avançar"]') || 
                        document.querySelector('button[aria-label="Next"]') ||
                        document.querySelector('.artdeco-pagination__button--next');

        if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
            return true;
        }
        return false;
    }

    // --- 3. LÓGICA PRINCIPAL ---
    async function startCollection() {
        const storage = await new Promise(r => chrome.storage.local.get(['visitedProfiles', 'shouldStop', 'profileQueue'], r));
        
        if (storage.shouldStop) {
            console.log("[VM] Parada solicitada.");
            return;
        }

        // Se já existe uma fila ativa (ex: voltamos de um erro), não faz nada, deixa o Operário consumir
        // Mas como estamos na busca, assumimos que a fila acabou ou precisa ser criada.
        
        const rawProfiles = scrapeProfiles();
        const visited = storage.visitedProfiles || [];
        
        // Filtra quem já visitamos no passado
        const newBatch = rawProfiles.filter(p => !visited.includes(p.url));

        console.log(`[VM] Encontrados: ${rawProfiles.length} | Novos: ${newBatch.length}`);

        if (newBatch.length > 0) {
            // TEM GENTE NOVA: Cria a fila e inicia o primeiro
            console.log("[VM] Salvando fila e iniciando o primeiro...");
            
            // Salva a fila (excluindo o primeiro que já vamos visitar agora)
            const queue = newBatch.slice(1); // Do 2º em diante
            const first = newBatch[0];

            // Adiciona o primeiro aos visitados
            visited.push(first.url);

            await chrome.storage.local.set({
                profileQueue: queue,       // Fila restante
                visitedProfiles: visited,  // Histórico atualizado
                tarefaAtual: first,        // O que o operário vai fazer agora
                paginaDeBuscaUrl: window.location.href // Ponto de retorno
            });

            // Navega para o primeiro perfil
            window.location.assign(first.url);

        } else {
            // NINGUÉM NOVO: Muda de página
            console.log("[VM] Todos desta página já visitados.");
            const changed = await goToNextPage();
            
            if (!changed) {
                alert("ViralMind: Fim da lista de busca! (Ou não achei botão próxima)");
                await chrome.storage.local.set({ shouldStop: true });
            }
        }
    }

    // Auto-start (chamado pelo popup ou pelo reload da página)
    window.VM_START = startCollection;
    
    // Inicia automaticamente se a flag estiver ativa (lógica de loop)
    chrome.storage.local.get(['shouldStop'], d => {
        if (!d.shouldStop) startCollection();
    });

})();