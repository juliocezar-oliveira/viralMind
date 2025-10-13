// content_aplicar_filtro.js (PT-BR)
(async function aplicarFiltrosLinkedIn() {
  // ---------- utils ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const visibleText = (el) => (el?.innerText || el?.textContent || "")
    .replace(/\s+/g, " ").trim();

  const isVisible = (el) => el && el.offsetParent !== null;

  const key = (el, k, code, kc) => {
    const ev = { key: k, code, keyCode: kc, which: kc, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", ev));
    el.dispatchEvent(new KeyboardEvent("keyup", ev));
  };

  // ---------- carrega config ----------
  const {
    localidadeNome,
    filtroConexao,
    scriptToInject,
    customMessage,
    sendLimit,
    filterRole,
    skipIfSent
  } = await chrome.storage.local.get([
    "localidadeNome",
    "filtroConexao",
    "scriptToInject",
    "customMessage",
    "sendLimit",
    "filterRole",
    "skipIfSent"
  ]);

  // mapeia valores do select para rótulos EXATOS (mantido)
  const conexaoMap = { "F": "1º", "S": "2º", "O": "3º e +" };
  let desejadas = [];
  try {
    const arr = JSON.parse(filtroConexao || "[]"); // ex: '["S","O"]'
    desejadas = arr.map(x => conexaoMap[x] || x).filter(Boolean);
  } catch { desejadas = []; }

  console.log("🎯 Conexões desejadas (modal):", desejadas);

  // ---------- 1) abrir "Todos os filtros" (robusto, PT-BR) ----------
  function findAllFiltersButtonOnce() {
    // a) botão “pílula” padrão do LinkedIn
    let btn = document.querySelector('button.search-reusables__all-filters-pill-button');
    if (btn && isVisible(btn)) return btn;

    // b) trigger oficial (muito comum)
    btn = document.querySelector('[data-test-reusables-filters-modal-trigger="true"], button[data-test-reusables-filters-modal-trigger]');
    if (btn && isVisible(btn)) return btn;

    // c) por texto/aria-label “Todos os filtros” / “Filtros”
    btn = [...document.querySelectorAll('button, a[role="button"]')].find(b => {
      if (!isVisible(b)) return false;
      const t = (b.getAttribute('aria-label') || b.innerText || "").toLowerCase().trim();
      return t.includes("todos os filtros") || t === "filtros" || t.includes("abrir todos os filtros");
    });
    if (btn) return btn;

    // d) barra de filtros: pegar último botão visível
    const bar = document.querySelector('.search-reusables__filters-bar, [class*="search-reusables__filters-bar"]');
    if (bar) {
      const candidates = [...bar.querySelectorAll('button, a[role="button"]')].filter(isVisible);
      // tenta um que mencione "filtros"
      const byText = candidates.find(el => /filtro/i.test(visibleText(el)));
      if (byText) return byText;
      if (candidates.length) return candidates[candidates.length - 1];
    }
    return null;
  }

  async function findAllFiltersButton() {
    // espera render e tenta algumas vezes com pequenos scrolls
    for (let i = 0; i < 8; i++) {
      const btn = findAllFiltersButtonOnce();
      if (btn) return btn;
      // tenta trazer a barra para o viewport
      window.scrollBy({ top: i % 2 === 0 ? -200 : 200, behavior: "smooth" });
      await sleep(300);
    }
    return null;
  }

  const abrir = await findAllFiltersButton();
  if (!abrir) {
    console.warn("❌ 'Todos os filtros' não encontrado");
    return;
  }

  abrir.scrollIntoView({ behavior: "smooth", block: "center" });
  abrir.click();
  await sleep(2500);

  // ---------- 2) aguardar modal ----------
  const modal = await (async () => {
    for (let i = 0; i < 12; i++) {
      const m = document.querySelector('div[role="dialog"], .artdeco-modal');
      if (isVisible(m)) return m;
      await sleep(300);
    }
    return null;
  })();
  if (!modal) { console.warn("❌ Modal não apareceu"); return; }

  // ---------- 3) marcar CONEXÕES (ANTES de localidade) ----------
  function findConexaoContainer() {
    const candidates = [...modal.querySelectorAll("section, fieldset, div")].filter(isVisible);
    for (const c of candidates) {
      const btns = [...c.querySelectorAll("button")].filter(isVisible);
      const labels = btns.map(visibleText);
      const temAlgum = labels.some(t => t === "1º" || t === "2º" || t === "3º e +");
      if (temAlgum) return c;
    }
    return null;
  }

  const conexoesContainer = findConexaoContainer();
  if (!conexoesContainer) {
    console.warn("⚠️ Container de Conexões (1º/2º/3º e +) não localizado no modal.");
  } else {
    // desmarcar não desejados
    const todos = ["1º", "2º", "3º e +"];
    for (const rotulo of todos) {
      if (!desejadas.includes(rotulo)) {
        const btn = [...conexoesContainer.querySelectorAll("button")]
          .find(b => isVisible(b) && visibleText(b) === rotulo);
        if (btn) {
          const selected = btn.classList?.contains("artdeco-button--selected") || btn.getAttribute("aria-pressed") === "true";
          if (selected) { btn.click(); await sleep(600); }
        }
      }
    }
    // marcar desejados
    for (const rotulo of desejadas) {
      const btn = [...conexoesContainer.querySelectorAll("button")]
        .find(b => isVisible(b) && visibleText(b) === rotulo);
      if (!btn) { console.warn(`⚠️ Botão '${rotulo}' não encontrado no modal.`); continue; }
      const selected = btn.classList?.contains("artdeco-button--selected") || btn.getAttribute("aria-pressed") === "true";
      if (!selected) { btn.scrollIntoView({ behavior: "smooth", block: "center" }); btn.click(); console.log(`✅ Marcado: ${rotulo}`); await sleep(900); }
    }
  }

  // ---------- 4) LOCALIDADE ----------
  if (localidadeNome) {
    const addLocBtn = [...modal.querySelectorAll("button, div, span")]
      .find(el => isVisible(el) && visibleText(el).toLowerCase() === "adicionar localidade");
    if (!addLocBtn) {
      console.warn("⚠️ Botão 'Adicionar localidade' não encontrado no modal");
    } else {
      addLocBtn.scrollIntoView({ behavior: "smooth", block: "center" });
      addLocBtn.click();
      await sleep(1200);

      const input = [...modal.querySelectorAll("input")]
        .find(i => isVisible(i) && (i.placeholder || "").toLowerCase().includes("adicionar localidade"));
      if (!input) {
        console.warn("⚠️ Campo de localidade não encontrado");
      } else {
        input.focus();
        input.value = "";
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        await sleep(300);

        input.value = localidadeNome;
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        console.log("⌨️ Localidade digitada:", localidadeNome);
        await sleep(1400);

        key(input, "ArrowDown", "ArrowDown", 40);
        await sleep(400);
        key(input, "Enter", "Enter", 13);
        await sleep(1200);
      }
    }
  }

  // ---------- 5) Exibir resultados (no modal) ----------
  const exibir = [...modal.querySelectorAll("button")]
    .find(b => isVisible(b) && /exibir resultados|mostrar resultados|aplicar/i.test(visibleText(b)));
  if (!exibir) { console.warn("❌ Botão 'Exibir resultados' (modal) não encontrado"); return; }

  exibir.scrollIntoView({ behavior: "smooth", block: "center" });
  exibir.click();
  console.log("✅ Clicou em 'Exibir resultados'");
  await sleep(2500);

  // ---------- 6) aguardar resultados renderizarem ----------
  for (let i = 0; i < 14; i++) {
    const cards = document.querySelectorAll("li.reusable-search__result-container, .reusable-search__entity-result-list li");
    if (cards.length) break;
    await sleep(800);
  }

  // ---------- 7) dispara o próximo script ----------
  const nextScriptKey = (scriptToInject === "content_connect_only.js") ? "connect" : "message";

  chrome.storage.local.set({
    customMessage,
    filterRole,
    skipIfSent,
    only2nd3rd: filtroConexao === '["S","O"]',
    sendLimit: sendLimit || 20,
    progress: 0
  }, () => {
    chrome.runtime.sendMessage({ action: "runContentScript", script: nextScriptKey });
  });
})();
