// open_like_button.js — NÃO altera popup.js. Apenas abre o popup_like.html.
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('open-like-popup');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chrome.runtime.getURL('popup_like.html');
      // janelinha leve; ajuste se quiser
      chrome.windows.create({ url, type: 'popup', width: 460, height: 560 });
    });
  });
  