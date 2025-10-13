// [FIX-CSV-01] handleFromUrl global para uso nas funções de export (fora do DOMContentLoaded)
if (typeof window.handleFromUrl !== "function") {
  window.handleFromUrl = function(url = "") {
    const m = String(url).match(/\/in\/([^\/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  };
}

// log.js — grupos + CSV + gráficos (linha, barras, rosca) + colapso + KPI de curtidas + RÓTULOS DE DADOS
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(["logs", "likesCountTotal"], (res) => {
    const logs = Array.isArray(res.logs) ? res.logs.slice() : [];
    const likesCountTotal = Number.isFinite(+res.likesCountTotal) ? +res.likesCountTotal : 0;
    window.__VIRALMIND_LOGS__ = logs.slice(); // para exportação

    // Listas
    const diretasList = document.getElementById("mensagens-list");
    const conexoesList = document.getElementById("conexoes-list");
    const conexoesMensagensList = document.getElementById("conexoes-mensagens-list");
    const followupsList = document.getElementById("conversas-list");

    const exportBtn = document.getElementById("export-csv");
    const exportScope = document.getElementById("export-scope");

    // Canvas dos gráficos
    const dailyCanvas = document.getElementById("chart-daily");
    const monthlyCanvas = document.getElementById("chart-monthly");
    const locCanvas = document.getElementById("chart-locations");
    const locLegend = document.getElementById("chart-locations-legend");

    // KPI de curtidas
    const likesEl = document.getElementById("likes-count");

    if (!diretasList || !conexoesList || !conexoesMensagensList || !followupsList) {
      console.error("❌ IDs de listas não encontrados no HTML.");
      return;
    }

    // (Mantém títulos; apenas ajusta texto dentro do span, sem remover o botão)
    const tDiretas = document.getElementById("mensagens-title")?.querySelector(".title-text");
    const tFollow  = document.getElementById("conversas-title")?.querySelector(".title-text");
    if (tDiretas) tDiretas.textContent = "Mensagens Diretas";
    if (tFollow)  tFollow.textContent  = "Fallow-ups";

    // Helpers
    const norm = (s="") => s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    const mapTipo = (raw="") => {
      const t = norm(raw);
      if (t === "conexao" || /conexao sem nota|conexao\s*-\s*sem nota/.test(t)) return "conexao";
      if (t === "mensagem" || /mensagem com nota|conexao com nota|convite com nota/.test(t)) return "mensagem";
      if (t === "mensagem_followup_thread" || t === "conversa") return "followup";
      if (/conexao/.test(t) && /nota/.test(t) && /sem/.test(t)) return "conexao";
      if ((/conexao/.test(t) || /convite/.test(t)) && /com nota/.test(t)) return "mensagem";
      return raw || "";
    };
    const handleFromUrl = (url="") => {
      const m = String(url).match(/\/in\/([^\/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    };

    // Ordena (recente → antigo)
    logs.sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

    const empty = {
      diretas: "<li>Nenhuma mensagem direta.</li>",
      conexoes: "<li>Nenhuma conexão enviada.</li>",
      conexoesMsg: "<li>Nenhuma conexão com mensagem.</li>",
      followups: "<li>Nenhum follow-up registrado.</li>",
    };

    // ===== Render das listas =====
    (function renderLists() {
      const setFollowKey = new Set();
      const nomesConexaoComMensagem = new Set();

      logs.forEach(item => {
        const tipoKey = mapTipo(item.tipo);
        // Ignora logs que não são das 4 categorias (ex.: likes)
        if (!["mensagem", "conexao", "followup"].includes(tipoKey)) return;

        const li = document.createElement("li");

        const nome = item.nome || "—";
        const cargoHtml = item.cargo ? `💼 ${item.cargo}<br/>` : "";
        const localidade = item.localidade ? `📍 ${item.localidade}` : "";
        const conta = item.conta || handleFromUrl(item.profileUrl || "");
        const contaHtml = conta ? `👤 ${conta}<br/>` : "";
        const profileHtml = item.profileUrl ? `🔗 <a href="${item.profileUrl}" target="_blank" rel="noopener">Perfil</a><br/>` : "";
        const threadHtml = item.threadUrl ? `🔗 <a href="${item.threadUrl}" target="_blank" rel="noopener">Thread</a><br/>` : "";
        const dataFormatada = item.data ? formatarData(new Date(item.data)) : "";

        li.innerHTML = `
          <strong>${nome}</strong><br/>
          ${cargoHtml}
          ${localidade ? `${localidade}<br/>` : ""}
          ${contaHtml}
          ${profileHtml}
          ✉️ Tipo: ${item.tipo || "—"}<br/>
          ${threadHtml}
          🕒 ${dataFormatada || "—"}
        `;

        if (tipoKey === "mensagem") {
          // adiciona em diretas e (se ainda não listado) em conexões com mensagem
          diretasList.appendChild(li);
          const key = item.nome || "";
          if (key && !nomesConexaoComMensagem.has(key)) {
            conexoesMensagensList.appendChild(li.cloneNode(true));
            nomesConexaoComMensagem.add(key);
          }
        } else if (tipoKey === "conexao") {
          conexoesList.appendChild(li);
        } else if (tipoKey === "followup") {
          const key = (item.nome || "—") + "|" + (item.threadUrl || "");
          if (!setFollowKey.has(key)) {
            followupsList.appendChild(li);
            setFollowKey.add(key);
          }
        }
      });

      if (!conexoesMensagensList.hasChildNodes()) conexoesMensagensList.innerHTML = empty.conexoesMsg;
      if (!followupsList.hasChildNodes()) followupsList.innerHTML = empty.followups;
      if (!diretasList.hasChildNodes()) diretasList.innerHTML = empty.diretas;
      if (!conexoesList.hasChildNodes()) conexoesList.innerHTML = empty.conexoes;
    })();

    // ===== Gráficos =====
    const dailySeries = buildDailySeries(logs, 30);
    if (dailyCanvas) drawLineChart(dailyCanvas, dailySeries.labels, dailySeries.data);

    const monthlySeries = buildMonthlySeries(logs, 12);
    if (monthlyCanvas) drawBarChart(monthlyCanvas, monthlySeries.labels, monthlySeries.data);

    if (locCanvas) {
      const locSeries = buildLocationSeries(logs, 8); // top 7 + Outros
      drawDoughnutChart(locCanvas, locSeries.labels, locSeries.data, locSeries.colors, locLegend);
    }

    // ===== KPI: total de curtidas enviadas =====
    if (likesEl) {
      const computed = countLikes(logs);
      // Usa o maior entre o total persistido e o computado pelos logs
      likesEl.textContent = String(Math.max(computed, likesCountTotal));
    }

    // INIT: colapsar/expandir por grupo (+/−)
    initCollapsibles();

    // Exportar CSV
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        try {
          const data = Array.isArray(window.__VIRALMIND_LOGS__) ? window.__VIRALMIND_LOGS__ : [];
          if (!data.length) { alert("Sem registros para exportar."); return; }
          let scope = exportScope?.value || "all";
          if (scope === "mensagens") scope = "diretas";
          if (scope === "conversas") scope = "followups";

          const csv = buildCSVWithScope(data, scope);
          const suffix =
            scope === "all" ? "todos" :
            scope === "diretas" ? "mensagens_diretas" :
            scope === "conexoes" ? "conexoes" :
            scope === "conexoesMsg" ? "conexoes_com_mensagem" :
            scope === "followups" ? "follow_ups" :
            scope === "primeira" ? "primeira_mensagem" : "export";

          downloadCSV(csv, `viralMind_logs_${suffix}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.csv`);
        } catch (e) {
          console.error("Falha ao gerar CSV:", e);
          alert("Falha ao gerar CSV. Veja o console para detalhes.");
        }
      });
    }
  });

  // 🔄 Atualização em tempo real do KPI de curtidas quando a chave "logs" OU "likesCountTotal" mudar
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const likesElLive = document.getElementById("likes-count");
      if (!likesElLive) return;

      const newLogs = changes.logs ? (Array.isArray(changes.logs.newValue) ? changes.logs.newValue : []) : null;
      const newLikesPersisted = changes.likesCountTotal ? (+changes.likesCountTotal.newValue || 0) : null;

      // Recalcula conciliando o que mudou
      if (newLogs || Number.isFinite(newLikesPersisted)) {
        const fromLogs = newLogs ? countLikes(newLogs) : null;
        let current = parseInt(likesElLive.textContent || "0", 10) || 0;
        let next = current;

        if (fromLogs != null && newLikesPersisted != null) next = Math.max(fromLogs, newLikesPersisted);
        else if (fromLogs != null) next = Math.max(current, fromLogs);
        else if (newLikesPersisted != null) next = Math.max(current, newLikesPersisted);

        likesElLive.textContent = String(next);
      }
    });
  } catch (e) {
    console.warn("onChanged indisponível no contexto:", e);
  }
});

/* ---------- Colapsar/Expandir por grupo ---------- */
function initCollapsibles() {
  const buttons = document.querySelectorAll('.group-title .toggle-btn[data-target]');
  buttons.forEach(btn => {
    const targetSel = btn.getAttribute('data-target');
    const list = document.querySelector(targetSel);
    if (!list) return;

    // Estado inicial: recolhido
    list.classList.add('collapsed');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '+';

    const toggle = () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        list.classList.add('collapsed');
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '+';
      } else {
        list.classList.remove('collapsed');
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = '−';
      }
    };

    // Clique no botão
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    // (Opcional) Clique no título também alterna, sem afetar clique no botão
    const header = btn.closest('.group-title');
    if (header) {
      header.addEventListener('click', (e) => {
        if (e.target === btn) return;
        toggle();
      });
    }
  });
}

/* ---------- Agrupamento/CSV (AJUSTADO) ---------- */
function groupLogs(logs) {
  const arr = logs.slice().sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  const norm = (s="") => s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const mapTipo = (raw="") => {
    const t = norm(raw);
    if (t === "conexao" || /conexao sem nota|conexao\s*-\s*sem nota/.test(t)) return "conexao";
    if (t === "mensagem" || /mensagem com nota|conexao com nota|convite com nota/.test(t)) return "mensagem";
    if (t === "mensagem_followup_thread" || t === "conversa") return "followup";
    if (/conexao/.test(t) && /nota/.test(t) && /sem/.test(t)) return "conexao";
    if ((/conexao/.test(t) || /convite/.test(t)) && /com nota/.test(t)) return "mensagem";
    return raw || "";
  };
  const isPrimeira = (raw = "") => {
    const t = norm(raw);
    return t === "primeira_mensagem" || t === "primeira mensagem" || t === "primeira" || t === "first_message";
  };

  const groups = { diretas: [], conexoes: [], conexoesMsg: [], followups: [], primeira: [] };
  const seenCxMsg = new Set();

  arr.forEach(it => {
    const t = mapTipo(it.tipo);
    if (t === "mensagem") {
      groups.diretas.push(it);
      const key = it.nome || "";
      if (key && !seenCxMsg.has(key)) {
        groups.conexoesMsg.push(it);
        seenCxMsg.add(key);
      }
    } else if (t === "conexao") {
      groups.conexoes.push(it);
    } else if (t === "followup") {
      // Evita duplicatas pelo par nome+thread
      const key = (it.nome || "—") + "|" + (it.threadUrl || "");
      if (!groups.followups.find(x => (((x.nome||"—")+"|"+(x.threadUrl||"")) === key))) {
        groups.followups.push(it);
      }
    } else if (isPrimeira(it.tipo)) {
      groups.primeira.push(it);
    }
  });

  return groups;
}

function buildCSVWithScope(logs, scope = "all") {
  const header = ["Nome", "Tipo", "Data ISO", "Thread", "Cargo", "Localidade", "Conta", "Profile URL"];

  const toCell = (v) => (v == null ? "" : String(v));
  const toISO = (v) => {
    try { return new Date(v).toISOString(); } catch { return ""; }
  };
  const blockToRows = (items) => items.map(it => {
    const profileUrl = it.profileUrl || "";
    const conta = it.conta || window.handleFromUrl(profileUrl);
    return ([
      toCell(it.nome),
      toCell(it.tipo),
      toISO(it.data),
      toCell(it.threadUrl),
      toCell(it.cargo),
      toCell(it.localidade),
      toCell(conta),
      toCell(profileUrl),
    ]);
  });

  if (scope === "all") {
    const rows = [];
    const pushTitle = (title) => rows.push([title, "", "", "", "", "", "", ""]);
    const pushHeader = () => rows.push(header);
    const pushGap = () => rows.push(["", "", "", "", "", "", "", ""]);

    const groupsAll = groupLogs(logs);
    if (groupsAll.diretas.length)     { pushTitle("### Mensagens Diretas");     pushHeader(); rows.push(...blockToRows(groupsAll.diretas));     pushGap(); }
    if (groupsAll.conexoes.length)    { pushTitle("### Conexões sem Nota");     pushHeader(); rows.push(...blockToRows(groupsAll.conexoes));    pushGap(); }
    if (groupsAll.conexoesMsg.length) { pushTitle("### Conexões com Mensagem"); pushHeader(); rows.push(...blockToRows(groupsAll.conexoesMsg)); pushGap(); }
    if (groupsAll.followups.length)   { pushTitle("### Fallow-ups");            pushHeader(); rows.push(...blockToRows(groupsAll.followups));   pushGap(); }
    if (groupsAll.primeira.length)    { pushTitle("### Primera Mensagem");      pushHeader(); rows.push(...blockToRows(groupsAll.primeira));    pushGap(); }

    if (rows.length === 0) { rows.push(header, ...blockToRows(logs)); }
    return toCSV(rows);
  }

  // Suporte a rótulos do select
  const legacyToNew = { mensagens: "diretas", conversas: "followups", primeira: "primeira" };
  const key = legacyToNew[scope] || scope;

  const mapTitle = {
    diretas:   "### Mensagens Diretas",
    conexoes:  "### Conexões sem Nota",
    conexoesMsg:"### Conexões com Mensagem",
    followups: "### Fallow-ups",
    primeira:  "### Primera Mensagem",
  };

  const groupsSel = groupLogs(logs);
  const list = groupsSel[key] || [];
  if (!list.length) {
    alert("Esse grupo não possui registros para exportar.");
    return toCSV([header]);
  }
  const rows = [];
  rows.push([mapTitle[key], "", "", "", "", "", "", ""]);
  rows.push(header);
  rows.push(...blockToRows(list));
  return toCSV(rows);
}

function toCSV(rows) {
  const lines = rows.map(cols =>
    cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")
  );
  return "\ufeff" + lines.join("\r\n");
}
function downloadCSV(csvText, fileName) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

/* ---------- Séries para gráficos ---------- */
function buildDailySeries(logs, lastNDays = 30) {
  const map = new Map();
  logs.forEach(l => {
    const d = l.data ? new Date(l.data) : null;
    if (!d || isNaN(+d)) return;
    const key = d.toISOString().slice(0,10); // YYYY-MM-DD
    map.set(key, (map.get(key) || 0) + 1);
  });

  const labels = [];
  const data = [];
  const today = new Date();
  for (let i = lastNDays - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const k = d.toISOString().slice(0,10);
    labels.push(k.slice(5)); // MM-DD
    data.push(map.get(k) || 0);
  }
  return { labels, data };
}

function buildMonthlySeries(logs, lastNMonths = 12) {
  const map = new Map();
  logs.forEach(l => {
    const d = l.data ? new Date(l.data) : null;
    if (!d || isNaN(+d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    map.set(key, (map.get(key) || 0) + 1);
  });

  const labels = [];
  const data = [];
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - (lastNMonths - 1), 1);
  for (let i = 0; i < lastNMonths; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    labels.push(key);
    data.push(map.get(key) || 0);
  }
  return { labels, data };
}

function buildLocationSeries(logs, maxSlices = 8) {
  const clean = (s="") => {
    const t = s.toString().trim();
    return t ? t : "Não informado";
  };
  const count = new Map();
  logs.forEach(l => {
    const k = clean(l.localidade || "");
    count.set(k, (count.get(k) || 0) + 1);
  });

  // ordena desc e aplica "Outros"
  const all = [...count.entries()].sort((a,b)=>b[1]-a[1]);
  let labels = [];
  let values = [];
  if (all.length <= maxSlices) {
    labels = all.map(([k]) => k);
    values = all.map(([_,v]) => v);
  } else {
    const top = all.slice(0, maxSlices - 1);
    const rest = all.slice(maxSlices - 1);
    const outros = rest.reduce((acc, [_,v]) => acc + v, 0);
    labels = [...top.map(([k]) => k), "Outros"];
    values = [...top.map(([_,v]) => v), outros];
  }
  const colors = genPalette(labels.length);
  return { labels, data: values, colors };
}

/* ---------- Desenho dos gráficos (Canvas puro) ---------- */
function genPalette(n) {
  const cols = [];
  for (let i=0; i<n; i++) {
    const h = Math.round((360 / Math.max(1,n)) * i);
    const s = 65;
    const l = 55;
    cols.push(`hsl(${h} ${s}% ${l}%)`);
  }
  return cols;
}

function drawLineChart(canvas, labels, values) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const pad = { l: 38, r: 10, t: 18, b: 26 }; // t/b levemente maiores p/ caber rótulos
  const x0 = pad.l, y0 = pad.t, x1 = W - pad.r, y1 = H - pad.b;

  const minY = 0;
  const maxY = Math.max(1, Math.max(...values));
  const ticks = niceTicks(minY, maxY, 6);

  // Eixos
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.moveTo(x0, y1); ctx.lineTo(x0, y0);
  ctx.stroke();

  // Grade + labels Y
  ctx.fillStyle = "#9ca3af";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ticks.forEach(t => {
    const y = y1 - (t - minY) / (maxY - minY) * (y1 - y0);
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillText(String(t), x0 - 6, y);
  });

  // Linha
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const points = [];
  labels.forEach((_, i) => {
    const x = x0 + (i / Math.max(1, labels.length - 1)) * (x1 - x0);
    const y = y1 - (values[i] - minY) / (maxY - minY) * (y1 - y0);
    points.push({x,y});
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Pontos
  ctx.fillStyle = "#60a5fa";
  points.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI*2);
    ctx.fill();
  });

  // Rótulos de dados (não mostra zero para não poluir)
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  values.forEach((v, i) => {
    if (v === 0) return;
    const p = points[i];
    const yLabel = Math.max(p.y - 6, y0 + 10);
    ctx.fillText(String(v), p.x, yLabel);
  });

  // Rótulos X (rotacionados)
  for (let i = 0; i < labels.length; i += Math.ceil(labels.length / 10)) {
    drawRotatedText(ctx, labels[i], x0 + (i / Math.max(1, labels.length - 1)) * (x1 - x0), y1 + 12, 45);
  }
}

function drawBarChart(canvas, labels, values) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const pad = { l: 38, r: 10, t: 18, b: 26 }; // t/b maiores p/ caber rótulos
  const x0 = pad.l, y0 = pad.t, x1 = W - pad.r, y1 = H - pad.b;

  const minY = 0;
  const maxY = Math.max(1, Math.max(...values));
  const ticks = niceTicks(minY, maxY, 6);

  // Eixos
  ctx.strokeStyle = "#374151";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.moveTo(x0, y1); ctx.lineTo(x0, y0);
  ctx.stroke();

  // Grade + labels Y
  ctx.fillStyle = "#9ca3af";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ticks.forEach(t => {
    const y = y1 - (t - minY) / (maxY - minY) * (y1 - y0);
    ctx.strokeStyle = "#1f2937";
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillText(String(t), x0 - 6, y);
  });

  // Barras
  const bw = (x1 - x0) / Math.max(1, values.length);
  ctx.fillStyle = "#34d399";
  values.forEach((v, i) => {
    const x = x0 + i * bw + bw * 0.1;
    const w = bw * 0.8;
    const y = y1 - (v - minY) / (maxY - minY) * (y1 - y0);
    ctx.fillRect(x, y, w, y1 - y);

    // Rótulo de dados
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const cx = x + w / 2;
    const yLabel = (v === 0) ? (y1 - 6) : Math.max(y - 6, y0 + 10);
    ctx.fillText(String(v), cx, yLabel);

    // volta cor da barra para as próximas
    ctx.fillStyle = "#34d399";
  });

  // Rótulos X
  for (let i = 0; i < labels.length; i++) {
    if (i % Math.ceil(labels.length / 10) !== 0) continue;
    drawRotatedText(ctx, labels[i], x0 + i * bw + bw / 2, y1 + 12, 45);
  }
}

function drawDoughnutChart(canvas, labels, values, colors, legendEl) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) * 0.38;
  const innerR = radius * 0.62;

  const total = values.reduce((a,b)=>a+b,0);
  if (total === 0) {
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("Sem dados de localidade", cx, cy);
    if (legendEl) legendEl.innerHTML = "";
    return;
  }

  let start = -Math.PI/2;
  for (let i=0; i<values.length; i++) {
    const val = values[i];
    const ang = (val/total) * Math.PI * 2;
    const end = start + ang;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, start, end, false);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    start = end;
  }

  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI*2); ctx.stroke();

  ctx.fillStyle = "#e5e7eb";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(total.toString(), cx, cy - 6);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText("disparos", cx, cy + 12);

  if (legendEl) {
    legendEl.innerHTML = "";
    for (let i=0;i<labels.length;i++){
      const pct = ((values[i]/total)*100);
      const item = document.createElement("div");
      item.className = "legend-item";
      const colorBox = document.createElement("span");
      colorBox.className = "legend-color";
      colorBox.style.background = colors[i % colors.length];
      const text = document.createElement("span");
      text.textContent = `${labels[i]} — ${values[i]} (${pct.toFixed(1)}%)`;
      item.appendChild(colorBox);
      item.appendChild(text);
      legendEl.appendChild(item);
    }
  }
}

/* ---------- Utilidades ---------- */
function drawRotatedText(ctx, text, x, y, angleDeg) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function niceTicks(min, max, maxTicks = 6) {
  if (min === max) max = min + 1;
  const range = niceNum(max - min, false);
  const tickSpacing = niceNum(range / (maxTicks - 1), true);
  const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
  const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + 0.5 * tickSpacing; v += tickSpacing) {
    ticks.push(Math.round(v));
  }
  if (ticks[0] > 0) ticks.unshift(0);
  return Array.from(new Set(ticks));
}
function niceNum(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function formatarData(d) {
  if (!(d instanceof Date) || isNaN(+d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
}

/* ---------- KPI de curtidas ---------- */
function countLikes(logs) {
  let n = 0;
  const isLike = (it) => {
    const t = (it?.tipo || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
    // cobre 'like_publicacao', 'curtida_publicacao' e variações
    return t.includes("like") || t.includes("curtida");
  };
  for (const it of logs) if (isLike(it)) n++;
  return n;
}


/* [INCLUSÃO 2] Primera Mensagem: sync com chrome.storage.local (não altera outras estruturas) */
(function(){
  function norm(s){ return (s==null?"":String(s)).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim(); }
  function handleFromUrl(url){
    var m = String(url||"").match(/\/in\/([^\/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function isPrimeiraItem(it){
    var t = norm((it && (it.tipo || it.type)) || "");
    return t === "primeira_mensagem" || t === "primeira mensagem" || t === "primeira" || t === "first_message";
  }
  function fmtData(v){
    try{
      if (typeof window.formatarData === "function") return window.formatarData(new Date(v));
      var d = new Date(v);
      if (isNaN(+d)) return "";
      var dd = String(d.getDate()).padStart(2,"0");
      var mm = String(d.getMonth()+1).padStart(2,"0");
      var yyyy = d.getFullYear();
      var HH = String(d.getHours()).padStart(2,"0");
      var MM = String(d.getMinutes()).padStart(2,"0");
      return dd + "/" + mm + "/" + yyyy + " " + HH + ":" + MM;
    }catch(e){ return ""; }
  }

  function mapItem(it){
    var profileUrl = it.profileUrl || it.perfil || it.url || "";
    return {
      nome: it.nome || it.name || it.fullName || "—",
      cargo: it.cargo || it.position || it.title || "",
      localidade: it.localidade || it.location || "",
      conta: it.conta || it.account || handleFromUrl(profileUrl),
      profileUrl: profileUrl,
      threadUrl: it.threadUrl || it.thread || "",
      data: it.data || it.date || it.timestamp || it.createdAt || ""
    };
  }

  function renderPrimeiraFrom(logs){
    var listEl = document.getElementById("primeira-mensagem-list");
    if (!listEl) return;
    // Limpa apenas a lista de "Primera Mensagem"
    while(listEl.firstChild) listEl.removeChild(listEl.firstChild);

    var appended = 0;
    (logs||[]).forEach(function(it){
      if (!isPrimeiraItem(it)) return;
      var m = mapItem(it);
      var li = document.createElement("li");
      li.innerHTML = [
        "<strong>"+ m.nome +"</strong><br/>",
        (m.cargo ? "💼 " + m.cargo + "<br/>" : ""),
        (m.localidade ? "📍 " + m.localidade + "<br/>" : ""),
        (m.conta ? "👤 " + m.conta + "<br/>" : ""),
        (m.profileUrl ? '🔗 <a href="'+ m.profileUrl +'" target="_blank" rel="noopener">Perfil</a><br/>' : ""),
        "✉️ Tipo: Primera Mensagem<br/>",
        "🕒 " + (fmtData(m.data) || "—")
      ].join("");
      listEl.appendChild(li);
      appended++;
    });
    if (!appended){
      listEl.innerHTML = "<li>Nenhum envio de primeira mensagem.</li>";
    }
  }

  function tryRenderFromGlobals(){
    try{
      var logs = Array.isArray(window.__VIRALMIND_LOGS__) ? window.__VIRALMIND_LOGS__ : [];
      // Se já tiver items de 'primeira' nos logs globais, renderiza e sai
      if ((logs||[]).some(isPrimeiraItem)){
        renderPrimeiraFrom(logs);
        return true;
      }
    }catch(e){}
    return false;
  }

  function fetchFromStorageAndRender(){
    if (!(window.chrome && chrome.storage && chrome.storage.local)) return;
    chrome.storage.local.get(["logs","VIRALMIND_LOGS"], function(res){
      var logs = [];
      if (Array.isArray(res && res.VIRALMIND_LOGS)) logs = res.VIRALMIND_LOGS;
      else if (Array.isArray(res && res.logs)) logs = res.logs;
      renderPrimeiraFrom(logs);
    });
  }

  function init(){
    var ok = tryRenderFromGlobals();
    if (!ok) fetchFromStorageAndRender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Atualiza em tempo real quando os logs mudarem no storage
  if (window.chrome && chrome.storage && chrome.storage.onChanged){
    chrome.storage.onChanged.addListener(function(changes, areaName){
      if (areaName !== "local") return;
      if (changes.logs || changes.VIRALMIND_LOGS){
        fetchFromStorageAndRender();
      }
    });
  }
})();
