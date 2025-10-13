// =============================
// content_like_publications.js
// =============================
//
// Este arquivo contempla:
// - Funções para curtir a PUBLICAÇÃO (post principal) no LinkedIn
// - Mensageria com o popup para disparar o like tab-a-tab
// - Logger robusto para registrar todas as curtidas em chrome.storage.local (tipo: 'like_publicacao')
//   * O logger observa mudanças de aria-pressed nos botões de "Gostei" e também faz fallback no clique
//
// Observação: Se você já tem suas funções originais de curtir, pode manter.
// O bloco "[VM][likes logger]" no final é 100% seguro para colar ao fim do seu arquivo.
// Aqui deixo uma implementação funcional completa (sem remover nada essencial).

(() => {
    'use strict';
  
    // ---------- Utils ----------
    const sleep  = (ms) => new Promise(r => setTimeout(r, ms));
    const hud = (txt) => {
      let el = document.getElementById('VM_LIKE_HUD');
      if (!el) {
        el = document.createElement('div');
        el.id = 'VM_LIKE_HUD';
        el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:2147483647;background:#0d1117;color:#e6edf3;border:1px solid #30363d;padding:8px 10px;border-radius:8px;font:12px/1.3 -apple-system,Segoe UI,Arial;box-shadow:0 4px 14px rgba(0,0,0,.4)';
        document.body.appendChild(el);
      }
      el.textContent = `ViralMind • ${txt}`;
    };
  
    // ---------- Detecção do botão de like da PUBLICAÇÃO (post principal) ----------
    function isAlreadyLiked(btn) {
      if (!btn) return false;
      const pressed = btn.getAttribute('aria-pressed');
      return pressed === 'true';
    }
  
    function looksLikePostLikeButton(btn) {
      if (!btn) return false;
      if (!btn.matches('button')) return false;
      // Evita botões de comentário/respostas
      const label = (btn.getAttribute('aria-label') || btn.innerText || '').toLowerCase();
      if (!/gostei|like/.test(label)) return false;
  
      // Heurística: dentro de ações da publicação
      const inActions = btn.closest('[data-test-reactions-button], .social-actions, .feed-shared-social-action-bar, .comments-comment-social-bar') ||
                        btn.closest('[class*="social"]');
      if (!inActions) return false;
  
      // Evita curtidas em COMENTÁRIOS
      const inComment = btn.closest('.comments-comment-item, [data-test-comment], .comments-comment-');
      if (inComment) return false;
  
      // Preferir um botão dentro do bloco de ação principal da publicação
      const isPrimary = !!btn.closest('.feed-shared-social-action-bar, [data-test-social-actions], [data-test-single-feed-entry]');
      return isPrimary;
    }
  
    function getMainLikeButton() {
      // LinkedIn varia a estrutura; pegamos todos que parecem "like" e filtramos
      const all = [...document.querySelectorAll('button[aria-pressed][aria-label], button[aria-pressed]')];
      const candidates = all.filter(looksLikePostLikeButton);
      if (candidates.length) {
        // Preferir o primeiro visível
        const visible = candidates.find(b => b.offsetParent !== null) || candidates[0];
        return visible;
      }
      return null;
    }
  
    async function waitLikedState(btn, timeout=7000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (isAlreadyLiked(btn)) return true;
        await sleep(120);
      }
      return false;
    }
  
    async function likeCurrentPublication() {
      try {
        hud('procurando botão…');
        let btn = getMainLikeButton();
        if (!btn) {
          // às vezes a publicação carrega lazy; tenta rolar um pouco
          window.scrollBy(0, 300);
          await sleep(400);
          btn = getMainLikeButton();
        }
        if (!btn) return { ok:false, reason: 'like-not-found' };
  
        if (isAlreadyLiked(btn)) {
          hud('já curtido ✓');
          return { ok:true, status:'already' };
        }
  
        hud('clicando…');
        btn.click();
        const liked = await waitLikedState(btn, 5000);
        if (liked) {
          hud('curtido ✓');
          recordLikeNow(location.href);
          return { ok:true, status:'liked' };
        }
  
        // fallback: alguns cliques só aplicam depois de re-render
        await sleep(300);
        const btn2 = getMainLikeButton();
        if (btn2 && isAlreadyLiked(btn2)) {
          hud('curtido ✓');
          recordLikeNow(location.href);
          return { ok:true, status:'liked' };
        }
  
        hud('falhou no like');
        return { ok:false, reason:'not-liked' };
      } catch (e) {
        console.warn('[VM][like] erro:', e);
        return { ok:false, reason: e?.message || 'exception' };
      }
    }
  
    // ---------- Mensageria com o popup ----------
    chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'LIKE_PUBLICATION') {
        (async () => {
          const r = await likeCurrentPublication();
          sendResponse(r);
        })();
        return true; // resposta async
      }
    });
  
    // ---------- Logger explícito (quando curtimos via script) ----------
    function recordLikeNow(url) {
        try {
          const entry = {
            tipo: 'like_publicacao',        // mantém nome consistente
            data: new Date().toISOString(),
            link: url || location.href
          };
      
          chrome.storage?.local?.get(['logs', 'likeTally'], (res) => {
            const logs = Array.isArray(res?.logs) ? res.logs.slice() : [];
            const likeTallyPrev = Number.isFinite(+res?.likeTally) ? +res.likeTally : 0;
      
            // evita duplicar em curto intervalo (mesmo link nas últimas 12h)
            const now = Date.now();
            const twelveH = 12 * 60 * 60 * 1000;
            const already = logs.some(l =>
              (l?.tipo || '').toLowerCase().includes('like') &&
              l?.link === entry.link &&
              l?.data && (now - new Date(l.data).getTime()) < twelveH
            );
      
            if (!already) logs.push(entry);
      
            chrome.storage.local.set({
              logs,
              likeTally: likeTallyPrev + (already ? 0 : 1)
            });
          });
        } catch (e) {
          console.warn('[VM][likes logger] falha ao salvar log/contador:', e);
        }
      }
      
  
    // ---------- [VM][likes logger] Observa aria-pressed e registra ----------
    if (!window.__vm_like_logger_installed) {
      window.__vm_like_logger_installed = true;
  
      const marked = new WeakSet();
  
      function saveLikeFromObserver() {
        recordLikeNow(location.href);
      }
  
      // Observa mudança de aria-pressed nos botões
      const attrObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' &&
              m.attributeName === 'aria-pressed' &&
              m.target?.matches?.('button[aria-pressed]')) {
            const btn = m.target;
            if (!looksLikePostLikeButton(btn)) continue;
            if (btn.getAttribute('aria-pressed') === 'true' && !marked.has(btn)) {
              marked.add(btn);
              saveLikeFromObserver();
            }
          }
        }
      });
  
      // Observa inclusão de novos botões na página
      const domObserver = new MutationObserver((mutations) => {
        for (const mu of mutations) {
          mu.addedNodes && mu.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              node.querySelectorAll?.('button[aria-pressed]').forEach((btn) => {
                try { attrObserver.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] }); } catch {}
              });
            }
          });
        }
      });
  
      // Inicializa para botões já presentes
      document.querySelectorAll('button[aria-pressed]').forEach((btn) => {
        try { attrObserver.observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] }); } catch {}
      });
  
      // Observa a árvore inteira para novos botões (SPA)
      try { domObserver.observe(document.documentElement, { childList: true, subtree: true }); } catch {}
  
      // Fallback: clique rápido com estado já "true"
      document.addEventListener('click', (e) => {
        const b = e.target?.closest?.('button[aria-pressed]');
        if (!b) return;
        if (!looksLikePostLikeButton(b)) return;
        if (b.getAttribute('aria-pressed') === 'true' && !marked.has(b)) {
          marked.add(b);
          saveLikeFromObserver();
        }
      });
    }
  })();
  