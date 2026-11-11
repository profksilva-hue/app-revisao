/* Santa Revisão · motor da IA adaptativa (Fase 1)
   Implementa a etapa 4 da spec: modelo do aluno por habilidade, os quatro estados,
   validação com amostra segura e escolha de questões pela chance de acerto.

   Tudo roda no aparelho do aluno (princípio 5). Nenhuma chamada de rede.
   Funciona no navegador (window.Motor) e no Node (require), para os testes por simulação. */
(function (raiz) {
  "use strict";

  // ---------- parâmetros (spec, etapa 4) ----------
  const CONFIG = {
    grade: { min: -2, max: 5, passo: 0.05 },   // escala de proficiência (θ), 0 = média do ENEM
    priori: { media: 1.0, dp: 1.0 },           // ponto de partida antes de qualquer resposta
    ref: { a: 1.97, b: 1.29, c: 0.16 },        // questão de referência: nível 2 do banco (~630 pontos)
    limites: { recuperacao: 0.50, aprimoramento: 0.75 },
    histerese: { sobeDeR: 0.55, sobeDeF: 0.80, desceDeF: 0.45, desceDeA: 0.70 },
    minRespostasParaMudar: 3,
    maxAntesDeObservacao: 12,
    chute: { ms: 15000, peso: 0.5 },          // resposta rápida demais em questão longa
    naoSei: { usoEsperado: 0.7, limiteSessao: 0.30, pesoSeAbuso: 0.5 },
    esquecimento: { dias: 30, achatamento: 0.7 },
    repeticao: { dias: 30, diasSeErrou: 3 },
    naoCalibrada: { a: 1.5, c: 0.2, peso: 0.5 }, // questões do ENEM só com nível de 1 a 5
    pontos: { base: 500, escala: 100 },         // conversão aproximada para a escala do ENEM
    recencia: { fator: 0.9, minimo: 0.5 },
    adaptada: { peso: 0.5 }      // respostas antigas pesam menos: o aluno aprende
  };

  const DIA = 864e5;
  const L = x => 1 / (1 + Math.exp(-x));
  const p2 = (th, a, b) => L(a * (th - b));
  const p3 = (th, a, b, c) => c + (1 - c) * p2(th, a, b);
  const faixa = p => p < CONFIG.limites.recuperacao ? "recuperacao" : p < CONFIG.limites.aprimoramento ? "fixacao" : "aprimoramento";

  function criar(opcoes) {
    const cfg = Object.assign({}, CONFIG, (opcoes && opcoes.config) || {});
    const hab = {}; ((opcoes && opcoes.habilidades) || []).forEach(h => { hab[h.id] = h; });
    const nivelB = (opcoes && opcoes.nivelParaB) || { 1: 0.47, 2: 1.29, 3: 1.96, 4: 2.68, 5: 3.71 };
    const itens = {}; const porHab = {};
    ((opcoes && opcoes.itens) || []).forEach(it => {
      if (!it || !it.id || !it.h) return;
      itens[it.id] = it; (porHab[it.h] = porHab[it.h] || []).push(it);
    });
    const G = []; for (let t = cfg.grade.min; t <= cfg.grade.max + 1e-9; t += cfg.grade.passo) G.push(+t.toFixed(4));
    const rec = depois => Math.max(cfg.recencia.minimo, Math.pow(cfg.recencia.fator, depois));
    const fRef = th => p3(th, cfg.ref.a, cfg.ref.b, cfg.ref.c);

    // Parâmetros de uma questão e o peso dela no cálculo do domínio (princípio 9).
    function params(it) {
      if (!it) return null;
      if (it.gerada && !it.ip) return { a: cfg.naoCalibrada.a, b: nivelB[it.nv] != null ? nivelB[it.nv] : nivelB[3], c: cfg.naoCalibrada.c, peso: 0 };
      if (it.ip) return { a: it.ip[0], b: it.ip[1], c: it.ip[2], peso: 1 };
      const b = nivelB[it.nv] != null ? nivelB[it.nv] : nivelB[3];
      return { a: cfg.naoCalibrada.a, b, c: it.cc != null ? it.cc : cfg.naoCalibrada.c, peso: cfg.naoCalibrada.peso };   // cc: chute por tipo de item (PAS)
    }

    function verossimilhanca(th, pr, r) {
      if (r === "ns") { // "não sei": o aluno declarou não saber (etapa 5)
        const u = cfg.naoSei.usoEsperado;
        return (1 - p2(th, pr.a, pr.b)) * u + 1e-9;
      }
      const p = p3(th, pr.a, pr.b, pr.c);
      return r ? p : 1 - p;
    }

    // Distribuição a posteriori do domínio numa habilidade.
    function posterior(aluno, h, agora, semRecencia) {
      const rs = (aluno.resp && aluno.resp[h]) || [];
      const m0 = mediaDaArea(aluno, h, agora);
      let lp = G.map(g => -((g - m0) ** 2) / (2 * cfg.priori.dp ** 2));
      rs.forEach(([id, r, , , w], k) => {
        const pr = params(itens[id]); if (!pr || !pr.peso || !w) return;
        const peso = pr.peso * w * (semRecencia ? 1 : rec(rs.length - 1 - k));
        lp = lp.map((v, i) => v + peso * Math.log(verossimilhanca(G[i], pr, r)));
      });
      const ultimo = rs.length ? rs[rs.length - 1][3] : null;
      const esquecida = ultimo != null && agora - ultimo > cfg.esquecimento.dias * DIA;
      if (esquecida) lp = lp.map(v => v * cfg.esquecimento.achatamento); // menos confiança, mesmo centro
      const mx = Math.max(...lp); const ps = lp.map(v => Math.exp(v - mx));
      const z = ps.reduce((s, v) => s + v, 0);
      return { ps: ps.map(v => v / z), n: rs.length, esquecida, ultimo };
    }

    // Habilidade com poucas respostas "empresta" o nível das outras da mesma área (etapa 4).
    function mediaDaArea(aluno, h, agora) {
      const area = hab[h] && hab[h].area; if (!area) return cfg.priori.media;
      const outras = Object.keys(aluno.resp || {}).filter(k => k !== h && hab[k] && hab[k].area === area && (aluno.resp[k] || []).length >= 3);
      if (!outras.length) return cfg.priori.media;
      const ms = outras.map(k => media(posteriorSemArea(aluno, k)));
      const m = ms.reduce((s, v) => s + v, 0) / ms.length;
      return 0.5 * cfg.priori.media + 0.5 * m;
    }
    function posteriorSemArea(aluno, h) {
      const rs = (aluno.resp && aluno.resp[h]) || [];
      let lp = G.map(g => -((g - cfg.priori.media) ** 2) / (2 * cfg.priori.dp ** 2));
      rs.forEach(([id, r, , , w], k) => { const pr = params(itens[id]); if (!pr || !pr.peso || !w) return; lp = lp.map((v, i) => v + pr.peso * w * rec(rs.length - 1 - k) * Math.log(verossimilhanca(G[i], pr, r))); });
      const mx = Math.max(...lp); const ps = lp.map(v => Math.exp(v - mx)); const z = ps.reduce((s, v) => s + v, 0);
      return { ps: ps.map(v => v / z) };
    }
    const media = post => post.ps.reduce((s, p, i) => s + p * G[i], 0);
    function quantil(post, q) { let acc = 0; for (let i = 0; i < G.length; i++) { acc += post.ps[i]; if (acc >= q) return G[i]; } return G[G.length - 1]; }

    // Resumo de uma habilidade: domínio, chance na questão de referência, intervalos e estado.
    function resumo(aluno, h, agora, vista) {
      agora = agora || Date.now();
      if (vista === false) return { h, estado: "introducao", n: 0 };
      const post = posterior(aluno, h, agora);
      const toda = posterior(aluno, h, agora, true);
      const th = media(post);
      const sd = Math.sqrt(post.ps.reduce((s, p, i) => s + p * (G[i] - th) ** 2, 0));
      const r = {
        h, n: post.n, theta: th, ep: sd,
        pontos: Math.round(cfg.pontos.base + cfg.pontos.escala * th),
        chance: fRef(th),
        // A estimativa acompanha o aluno de agora (respostas recentes pesam mais);
        // a validação usa toda a evidência: sobe rápido, valida com calma.
        ic80: [fRef(quantil(toda, 0.10)), fRef(quantil(toda, 0.90))],
        ic90: [fRef(quantil(toda, 0.05)), fRef(quantil(toda, 0.95))],
        revisao: post.esquecida
      };
      const est = (aluno.est && aluno.est[h]) || null;
      r.estado = est ? est.estado : (post.n ? faixa(r.chance) : "a_diagnosticar");
      r.validado = validado(r.estado, r);
      r.observacao = !r.validado && post.n >= cfg.maxAntesDeObservacao;
      r.provisorio = !r.validado && !r.observacao && post.n > 0;
      return r;
    }
    // Amostra segura (etapa 4): o intervalo de confiança cabe inteiro na faixa do estado.
    function validado(estado, r) {
      if (r.n < cfg.minRespostasParaMudar) return false;
      if (estado === "recuperacao") return r.ic80[1] < cfg.limites.recuperacao;
      if (estado === "fixacao") return r.ic80[0] >= cfg.limites.recuperacao && r.ic80[1] < cfg.limites.aprimoramento;
      if (estado === "aprimoramento") return r.ic90[0] >= cfg.limites.aprimoramento; // promover exige mais
      return false;
    }
    // Mudança de estado com margens (histerese) e mínimo de respostas desde a última mudança.
    function proximoEstado(atual, r, nDesde) {
      if (!atual || atual === "a_diagnosticar" || atual === "introducao") return faixa(r.chance);
      if (r.n - nDesde < cfg.minRespostasParaMudar) return atual;
      const H = cfg.histerese, p = r.chance;
      if (atual === "recuperacao") return p > H.sobeDeF ? "aprimoramento" : p > H.sobeDeR ? "fixacao" : atual;
      if (atual === "fixacao") return p > H.sobeDeF ? "aprimoramento" : p < H.desceDeF ? "recuperacao" : atual;
      if (atual === "aprimoramento") return p < H.desceDeA ? (p < H.desceDeF ? "recuperacao" : "fixacao") : atual;
      return atual;
    }

    // Registra uma resposta e atualiza o estado da habilidade.
    // resposta: { id, r: 1 | 0 | "ns", ms, ts, longa, sessao: { ns, total } }
    function registrar(aluno, resposta) {
      const it = itens[resposta.id]; if (!it) return null;
      aluno.resp = aluno.resp || {}; aluno.est = aluno.est || {};
      const h = it.h; const ts = resposta.ts || Date.now();
      let w = 1;
      if (resposta.r !== "ns" && resposta.longa && resposta.ms != null && resposta.ms < cfg.chute.ms) w *= cfg.chute.peso; // possível chute
      if (resposta.adaptada) w *= cfg.adaptada.peso;   // versão adaptada (não calibrada): conta menos no domínio
      if (resposta.r === "ns" && resposta.sessao && resposta.sessao.total >= 3 && resposta.sessao.ns / resposta.sessao.total > cfg.naoSei.limiteSessao) w *= cfg.naoSei.pesoSeAbuso;
      (aluno.resp[h] = aluno.resp[h] || []).push([resposta.id, resposta.r === "ns" ? "ns" : resposta.r ? 1 : 0, resposta.ms == null ? null : Math.round(resposta.ms), ts, w].concat(Number.isInteger(resposta.v) ? [resposta.v] : []));   // v = alternativa marcada (relatório)
      const r = resumo(aluno, h, ts, true);
      const atual = aluno.est[h] || { estado: null, nDesde: 0, ts };
      const novo = proximoEstado(atual.estado, r, atual.nDesde);
      const mudou = novo !== atual.estado;
      aluno.est[h] = mudou ? { estado: novo, nDesde: r.n, ts, de: atual.estado } : atual;
      const depois = resumo(aluno, h, ts, true);
      return { h, mudou, de: atual.estado, para: novo, resumo: depois };
    }

    // Escolhe n questões de uma habilidade com a chance de acerto mirada (etapa 5).
    function escolher(aluno, h, alvo, n, agora, excluir) {
      agora = agora || Date.now();
      const th = media(posterior(aluno, h, agora));
      const vistas = {};
      Object.values(aluno.resp || {}).forEach(rs => rs.forEach(([id, r, , ts]) => { vistas[id] = { r, ts }; }));
      const centro = (alvo[0] + alvo[1]) / 2;
      const cand = (porHab[h] || []).filter(it => {
        if (excluir && excluir.has(it.id)) return false;
        const v = vistas[it.id]; if (!v) return true;
        const dias = (agora - v.ts) / DIA;
        return v.r === 1 ? dias >= cfg.repeticao.dias : dias >= cfg.repeticao.diasSeErrou;
      }).map(it => {
        const pr = params(it); const p = p3(th, pr.a, pr.b, pr.c);
        const dentro = p >= alvo[0] && p <= alvo[1];
        return { it, p, nota: Math.abs(p - centro) - (dentro ? 1 : 0) - (it.ip ? 0.05 : 0) + Math.random() * 0.04 };
      }).sort((x, y) => x.nota - y.nota);
      return cand.slice(0, n).map(c => ({ id: c.it.id, chance: c.p, calibrada: !!c.it.ip, motivo: motivo(aluno, h, c.p) }));
    }
    function motivo(aluno, h, p) { // princípio 3: toda questão diz por que foi escolhida
      const r = (aluno.resp && aluno.resp[h]) || []; const ult = r[r.length - 1];
      const nome = hab[h] ? h + " · " + hab[h].nome : h;
      if (ult && ult[1] === 0) return nome + " · você errou uma parecida da última vez";
      if (!r.length) return nome + " · primeira questão desta habilidade";
      return nome + " · chance estimada de acerto de " + Math.round(p * 100) + "%";
    }

    function mapa(aluno, vistas, agora) {
      return Object.keys(hab).map(h => resumo(aluno, h, agora, vistas ? !!vistas[h] : true));
    }

    return { config: cfg, itens, porHab, habilidades: hab, params, resumo, registrar, escolher, mapa, faixa, fRef, p3 };
  }

  const Motor = { criar, CONFIG, p3, faixa };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor; else raiz.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);
