// pacing.js — Agendador/pacing genérico (sem dependências)
(() => {
    if (window.__pacer) return; // evita redefinição
  
    const rng = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
  
    const cfg = {
      // janelas padrão de espera (ms) por tipo de ação
      ranges: {
        mensagens: [12000, 18000],
        conectar: [9000, 15000],
        primeira: [14000, 22000],
        followups: [8000, 14000],
      },
      jitter: [120, 900],          // microvariação humana extra
      longEvery: 7,                // a cada N tarefas, pausa mais longa
      longPause: [35000, 60000],   // janela da pausa longa (ms)
      checkStep: 250,              // granularidade da checagem de parada (ms)
    };
  
    const counters = { mensagens: 0, conectar: 0, primeira: 0, followups: 0 };
    let stopGetter = () => false;
  
    async function cancellableWait(ms) {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        if (stopGetter()) throw new Error("STOP_REQUESTED");
        const chunk = Math.min(cfg.checkStep, end - performance.now());
        await sleep(chunk);
      }
    }
  
    async function between(tipo /* 'mensagens' | 'conectar' | 'primeira' | 'followups' */) {
      const [min, max] = cfg.ranges[tipo] || [10000, 15000];
      let waitMs = rng(min, max) + rng(cfg.jitter[0], cfg.jitter[1]);
  
      counters[tipo] = (counters[tipo] || 0) + 1;
      if (cfg.longEvery > 0 && counters[tipo] % cfg.longEvery === 0) {
        waitMs += rng(cfg.longPause[0], cfg.longPause[1]);
      }
  
      await cancellableWait(waitMs);
    }
  
    function setRanges(partial) {
      // Ex.: setRanges({ mensagens:[13000,19000], conectar:[10000,16000] })
      Object.assign(cfg.ranges, partial);
    }
  
    function attachStopFlag(getterFn) {
      // getterFn deve retornar true quando for hora de interromper
      if (typeof getterFn === "function") stopGetter = getterFn;
    }
  
    window.__pacer = { between, setRanges, attachStopFlag, cfg, counters };
  })();
  