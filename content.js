// content.js — envia convite com nota (mensagem) para novas conexões (2º/3º grau)
// Agora com cota compartilhada (vmQuota) para respeitar o limite mesmo com múltiplas instâncias.

(() => {
  'use strict';

  if (window.__vm_content_with_note_running) {
    console.log("[VM] content.js já em execução.");
    return;
  }
  window.__vm_content_with_note_running = true;

  // ---------- utils ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function shouldStopExecution() {
    return new Promise((resolve) => {
      chrome.storage.local.get("shouldStop", (d) => resolve(!!d.shouldStop));
    });
  }

  // normaliza acentos/caixa
  function norm(s = "") {
    return s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  async function waitForElement(selector, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el;
      await sleep(200);
    }
    return null;
  }

  async function waitForEnviarButton(timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const button = [...document.querySelectorAll("button")].find(
        (b) =>
          (b.innerText || "").trim().toLowerCase() === "enviar" &&
          !b.disabled &&
          b.offsetParent !== null
      );
      if (button) return button;

      // fallback: botão primário no modal
      const modal = document.querySelector(".artdeco-modal, div[role='dialog']");
      const primary = modal?.querySelector("button.artdeco-button--primary");
      if (primary && primary.offsetParent !== null && !primary.disabled) return primary;

      await sleep(200);
    }
    return null;
  }

  function gerarMensagem(nome, customMessage) {
    if (customMessage && customMessage.includes("{name}")) {
      return customMessage.replace("{name}", nome);
    }
    return `Olá ${nome}, espero que esteja bem. Sou o Presidente Regional da PUC angels Grande São Paulo.

Estamos expandindo nossa rede de líderes e inovadores. Gostaria de te convidar para conhecer a Associação PUC angels e como podemos juntos fortalecer ainda mais esse ecossistema.`;
  }

  function verificarFiltros(textoCard, filtroCargo, filtroLocalidade) {
    const texto = norm(textoCard);
    const cargoOK = !filtroCargo || texto.includes(norm(filtroCargo));
    const localOK = !filtroLocalidade || texto.includes(norm(filtroLocalidade));
    return cargoOK && localOK;
  }

  function is2ndOr3rdConnection(card) {
    const txt = (card?.innerText || "").toLowerCase();
    return (
      txt.includes("2º") ||
      txt.includes("3º") ||
      txt.includes("segundo grau") ||
      txt.includes("terceiro grau") ||
      /[^0-9]2[º°][^0-9]/.test(txt) ||
      /[^0-9]3[º°][^0-9]/.test(txt)
    );
  }

  function extrairDadosDoCard(card) {
    const linhas = card?.innerText?.split("\n").map((l) => l.trim()).filter(Boolean) || [];
    const nomeCompleto = linhas[0] || "Nome não encontrado";

    const cargo =
      linhas.find(
        (l, i) =>
          i > 0 &&
          i < 8 &&
          !l.toLowerCase().includes("ver perfil") &&
          !l.toLowerCase().includes("conexão") &&
          !/^•/.test(l)
      ) || "Cargo não identificado";

    const localidade =
      linhas.find((l) => /^[A-Za-zÀ-ú\s]+,\s?[A-Z]{2}$/.test(l)) || "Localidade não identificada";

    return { nomeCompleto, cargo, localidade };
  }

  function pageNextButton() {
    const btn = document.querySelector('button[aria-label="Avançar"]');
    if (btn && !btn.disabled) return btn;
    return null;
  }

  // ---------- cota compartilhada (vmQuota) ----------
  async function ensureQuotaInitialized(sendLimit) {
    return new Promise((resolve) => {
      chrome.storage.local.get(["vmQuota"], (d) => {
        let q = Number(d.vmQuota);
        if (!Number.isFinite(q) || q < 0) {
          chrome.storage.local.set({ vmQuota: sendLimit }, () => resolve(sendLimit));
        } else {
          resolve(q);
        }
      });
    });
  }

  async function reserveQuota() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["vmQuota"], (d) => {
        let q = Number(d.vmQuota);
        if (!Number.isFinite(q)) q = 0;
        if (q <= 0) return resolve(false);
        chrome.storage.local.set({ vmQuota: q - 1 }, () => resolve(true));
      });
    });
  }

  async function refundQuota() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["vmQuota"], (d) => {
        let q = Number(d.vmQuota);
        if (!Number.isFinite(q)) q = 0;
        chrome.storage.local.set({ vmQuota: q + 1 }, () => resolve());
      });
    });
  }

  // ---------- fluxo principal ----------
  function main() {
    chrome.storage.local.get(
      [
        "shouldStop",
        "customMessage",
        "filterLocation",
        "localidadeNome",
        "filterRole",
        "skipIfSent",
        "only2nd3rd",
        "filtroConexao",
        "sendLimit",
        "progress"
      ],
      async (data) => {
        // normaliza chaves de localização e 2º/3º
        const loc = (data.filterLocation || data.localidadeNome || "").toLowerCase();

        let only2nd3rd = data.only2nd3rd !== false; // default true se não vier
        if (typeof data.filtroConexao === "string") {
          try {
            const arr = JSON.parse(data.filtroConexao);
            // se usuário escolheu 2º e 3º (["S","O"]), ativa o filtro
            only2nd3rd = Array.isArray(arr) && arr.includes("S") && arr.includes("O");
          } catch {}
        }

        const config = {
          customMessage: data.customMessage || "",
          filterLocation: loc,
          filterRole: (data.filterRole || "").toLowerCase(),
          skipIfSent: !!data.skipIfSent,
          only2nd3rd,
          sendLimit: Number.isFinite(+data.sendLimit) && +data.sendLimit > 0 ? +data.sendLimit : 20
        };

        // inicializa cota compartilhada caso não tenha sido setada pela popup
        await ensureQuotaInitialized(config.sendLimit);

        navigatePagesAndSend(config);
      }
    );
  }

  async function navigatePagesAndSend(config) {
    let totalEnviados = 0;

    while (true) {
      const enviadosNestaPagina = await sendInvitesWithNoteOnPage(
        config,
        config.sendLimit - totalEnviados
      );
      totalEnviados += enviadosNestaPagina;

      await new Promise((r) => chrome.storage.local.set({ progress: totalEnviados }, r));

      // verifica cota restante
      const quotaLeft = await new Promise((resolve) =>
        chrome.storage.local.get(["vmQuota"], (d) => resolve(Number(d.vmQuota) || 0))
      );
      if (totalEnviados >= config.sendLimit || quotaLeft <= 0 || (await shouldStopExecution()))
        break;

      const nextButton = pageNextButton();
      if (nextButton) {
        nextButton.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(1200);
        nextButton.click();
        await sleep(5000);
      } else {
        console.log("🚫 Botão de próxima página não encontrado ou desabilitado.");
        break;
      }
    }

    console.log("🎉 Envio concluído. Total enviados:", totalEnviados);
  }

  // -> procura **Conectar**, clica em **Adicionar nota**, preenche e **Envia**
  async function sendInvitesWithNoteOnPage(config, remainingLimit) {
    let enviados = 0;

    const connectButtons = [...document.querySelectorAll("button")].filter(
      (btn) => (btn.innerText || "").trim().toLowerCase() === "conectar"
    );

    console.log("🔍 Detectados:", connectButtons.length, "botões de CONECTAR na página.");

    for (let i = 0; i < connectButtons.length; i++) {
      if (await shouldStopExecution()) break;
      if (enviados >= remainingLimit) break;

      // checa cota global ANTES de iniciar fluxo
      const okReserve = await reserveQuota();
      if (!okReserve) {
        console.log("⛔ Sem cota (vmQuota) disponível. Encerrando.");
        break;
      }

      const btn = connectButtons[i];
      const card = btn.closest(".reusable-search__result-container") || btn.closest("li");
      const cardText = card?.innerText || "";

      // filtros
      if (config.only2nd3rd && !is2ndOr3rdConnection(card)) {
        await refundQuota(); // não vamos usar essa cota
        continue;
      }
      if (!verificarFiltros(cardText, config.filterRole, config.filterLocation)) {
        await refundQuota();
        continue;
      }

      // extrai dados
      const { nomeCompleto, cargo, localidade } = extrairDadosDoCard(card);
      const primeiroNome = (nomeCompleto || "").split(" ")[0];
      const mensagem = gerarMensagem(primeiroNome, config.customMessage);

      let sentThis = false;

      try {
        btn.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(900);
        btn.click();
        await sleep(1400);

        if (await shouldStopExecution()) throw new Error("stop");

        // Adicionar nota
        let addNoteBtn =
          [...document.querySelectorAll("button")].find(
            (b) =>
              b.offsetParent !== null &&
              (b.getAttribute("aria-label") || "").toLowerCase().includes("adicionar nota")
          ) ||
          [...document.querySelectorAll("button")].find(
            (b) =>
              b.offsetParent !== null && (b.innerText || "").trim().toLowerCase() === "adicionar nota"
          );

        if (!addNoteBtn) throw new Error("no_add_note");

        addNoteBtn.click();
        await sleep(900);

        // Campo mensagem
        let textarea = await waitForElement('textarea[name="message"]', 3000);
        if (!textarea) textarea = await waitForElement('div[role="textbox"]', 2500);
        if (!textarea) throw new Error("no_textarea");

        // Preenche (dispara eventos para habilitar "Enviar")
        if (textarea.tagName === "TEXTAREA") {
          textarea.focus();
          textarea.value = "";
          textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "" }));
          await sleep(60);
          textarea.value = mensagem;
          textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: mensagem }));
          textarea.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          textarea.focus();
          document.execCommand("insertText", false, mensagem);
          textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: mensagem }));
          textarea.dispatchEvent(new Event("change", { bubbles: true }));
        }

        await sleep(600);
        if (await shouldStopExecution()) throw new Error("stop");

        const sendBtn = await waitForEnviarButton(6000);
        if (!sendBtn) throw new Error("no_send_btn");

        sendBtn.click();
        sentThis = true;
        enviados++;
        console.log(`✅ Convite ${enviados} enviado para ${primeiroNome}.`);

        // log + progresso
        chrome.storage.local.get(["logs", "progress"], (res) => {
          const logs = res.logs || [];
          logs.push({
            nome: nomeCompleto,
            primeiroNome,
            cargo,
            localidade,
            tipo: "mensagem",
            data: new Date().toISOString()
          });
          const progress = (typeof res.progress === "number" ? res.progress : 0) + 1;
          chrome.storage.local.set({ logs, progress });
        });

        await sleep(900);
        const closeBtn = document.querySelector('button[aria-label="Fechar"]');
        if (closeBtn) try { closeBtn.click(); } catch {}
        await sleep(Math.floor(Math.random() * 5000) + 10000);
      } catch (e) {
        // falhou em algum ponto => devolve cota
        if (!sentThis) await refundQuota();
        // fecha modal se aberto
        const close = document.querySelector('button[aria-label="Fechar"]');
        if (close) try { close.click(); } catch {}
        await sleep(400);
        continue;
      }
    }

    return enviados;
  }

  try {
    main();
  } catch (e) {
    console.error("[VM] Falha no main():", e);
  }
})();
