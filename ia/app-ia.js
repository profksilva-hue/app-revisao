/* Santa Revisão · IA adaptativa dentro do app do ENEM
   Fase 2: série, diagnose e tela de resultado (spec, etapa 3).
   Fase 3: tela "Hoje", trilhas e sessão do dia (spec, etapa 5).
   Usa o motor (ia/motor.js), o banco (ia/banco.js) e o estado do aluno do próprio app (S.ia),
   que é salvo junto com o progresso e vai no código de progresso. Nada sai do aparelho. */
(function () {
  "use strict";
  const SR = window.SR;
  if (!SR || !window.Motor || !window.Banco) return;
  const L = "ABCDE", esc = SR.esc, DIA = 864e5;
  const NOME = { recuperacao: "Recuperação", fixacao: "Fixação", aprimoramento: "Aprimoramento", introducao: "Introdução", adiantar: "Adiantar", livre: "Conteúdo escolhido", a_diagnosticar: "A diagnosticar" };
  const ORD = { recuperacao: 0, fixacao: 1, aprimoramento: 2 };
  const MAXQ = 30;                 // diagnose: no máximo 30 questões (cerca de 40 minutos)
  const DIAG_DUPLAS = 15;          // decisão de 08/11: 2 questões para as 15 habilidades de maior peso
  const ALVO_DIAG = [0.4, 0.6];    // começa em dificuldade média e se ajusta a cada resposta
  // etapa 5: chance de acerto mirada e regras de cada trilha
  const TR = {
    recuperacao: { alvo: [0.7, 0.8], naoSei: true, relogio: false, min: 20 },
    fixacao: { alvo: [0.55, 0.7], naoSei: true, relogio: false, min: 20 },
    aprimoramento: { alvo: [0.4, 0.55], naoSei: false, relogio: true, min: 24 },
    adiantar: { alvo: [0.75, 0.85], naoSei: true, relogio: false, min: 10 },
    livre: { alvo: null, naoSei: true, relogio: false, min: 20 }   // conteúdo escolhido pelo aluno: a chance segue o estado de cada habilidade
  };
  let H = null, M = null, MD = null, HAB = {}, AULA = {}, pronto = false, erro = "";
  let AULAHABS = {}, telaConteudos = false, modoConteudos = "tema";
  let BIB = {}, resumoAberto = null, telaBiblio = false, ERROS = null;
  let marcada = null, inicioQ = 0, qAtualId = null, verMapa = false, dicaAberta = false, tique = null;

  const st = () => { const S = SR.S; if (!S.ia) S.ia = { v: 1, serie: null, aluno: {}, naoVistas: [], diag: null }; return S.ia; };
  const salvar = () => SR.persist();
  const fmt = x => String(Math.round(x * 10) / 10).replace(".", ",");
  const pct = p => Math.round(p * 100) + "%";

  async function carregar() {
    try {
      const [h, g] = await Promise.all([
        fetch("../ia/habilidades.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("../ia/questoes-geradas.json").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("../ia/biblioteca.json").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch("../ia/erros.json").then(r => r.ok ? r.json() : null).catch(() => null)
      ]).then(x => { (x[2] && x[2].resumos || []).forEach(r => { BIB[r.h] = r; }); ERROS = x[3]; return x; });
      H = h; H.habilidades.forEach(x => { HAB[x.id] = x; });
      const itens = Banco.extrair(SR.D).concat(Banco.extrairGeradas(g));
      M = Motor.criar({ itens, habilidades: H.habilidades, nivelParaB: H.nivelParaB });
      // aula de referência de cada habilidade (para "rever a teoria" e a dica das questões guiadas)
      H.habilidades.forEach(hb => {
        const c = {}; (M.porHab[hb.id] || []).forEach(i => { if (i.aula != null) c[i.aula] = (c[i.aula] || 0) + 1; });
        const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; if (k) AULA[hb.id] = +k;
      });
      // habilidades de cada aula (tema da escola), da mais frequente para a menos
      SR.D.aulas.forEach(a => {
        const c = {}; itens.forEach(i => { if (i.aula === a.n) c[i.h] = (c[i.h] || 0) + 1; });
        AULAHABS[a.n] = Object.keys(c).filter(h => HAB[h] && c[h] >= 3).sort((x, y) => c[y] - c[x]);
      });
      // Diagnose: só questões do banco do app (nunca as geradas); as calibradas, quando a habilidade tem ao menos 2.
      const diag = [];
      H.habilidades.forEach(hb => {
        const its = (M.porHab[hb.id] || []).filter(i => !i.gerada), cal = its.filter(i => i.ip);
        (cal.length >= 2 ? cal : its).forEach(i => diag.push(i));
      });
      MD = Motor.criar({ itens: diag, habilidades: H.habilidades, nivelParaB: H.nivelParaB });
      pronto = true;
      // a tela Hoje é a porta de entrada do app: ao abrir, o aluno cai nela (etapa 5)
      if (SR.logado() && SR.S.tab !== "prof") SR.S.tab = "ia";
    } catch (e) { erro = "Não foi possível carregar a IA agora. Verifique a conexão e recarregue a página."; }
    SR.renderAll();
  }

  // ---------- estado das habilidades ----------
  const vistas = () => { const nv = new Set(st().naoVistas); return H.habilidades.filter(h => !nv.has(h.id)); };
  function estadoDe(h) {
    if (st().naoVistas.includes(h)) return "introducao";
    const r = M.resumo(st().aluno, h);
    return ORD[r.estado] != null ? r.estado : M.faixa(r.chance);
  }
  const prioridade = (a, b) => (b.base || []).length - (a.base || []).length || b.peso - a.peso || a.id.localeCompare(b.id, "pt", { numeric: true });
  const ultimaPratica = h => { const rs = (st().aluno.resp || {})[h] || []; return rs.length ? rs[rs.length - 1][3] : 0; };

  // ---------- diagnose ----------
  const respondidas = d => d.feitas.filter(f => f.r !== "nv").length;
  function alvoDiag() { // habilidades que entram na diagnose e quantas questões cada uma recebe
    const vs = vistas();
    if (vs.length * 2 <= MAXQ) return { hs: vs.map(h => h.id), por: 2 };
    return { hs: vs.slice().sort((a, b) => b.peso - a.peso || prioridade(a, b)).slice(0, DIAG_DUPLAS).map(h => h.id), por: 2 };
  }
  function limite() { const a = alvoDiag(); return Math.min(MAXQ, a.hs.length * a.por); }
  function ordemIntercalada(ids) { // uma habilidade de cada área por vez
    const porArea = {}; ids.forEach(id => { const h = HAB[id]; (porArea[h.area] = porArea[h.area] || []).push(id); });
    const filas = H.areas.map(a => porArea[a.id] || []), out = [];
    while (filas.some(f => f.length)) filas.forEach(f => { if (f.length) out.push(f.shift()); });
    return out;
  }
  function proxima() {
    const s = st(), d = s.diag, usadas = new Set(d.usadas), cont = {}, sem = d.semQuestao || [];
    d.feitas.forEach(f => { if (f.r !== "nv") cont[f.h] = (cont[f.h] || 0) + 1; });
    for (let tent = 0; tent < 80; tent++) {
      if (respondidas(d) >= limite()) return null;
      const ordem = ordemIntercalada(alvoDiag().hs).filter(x => !sem.includes(x));
      const h = ordem.find(x => !cont[x]) || ordem.find(x => (cont[x] || 0) < 2);
      if (!h) return null;
      const e = MD.escolher(s.aluno, h, ALVO_DIAG, 1, Date.now(), usadas)[0];
      if (e) return { h, id: e.id };
      sem.push(h); d.semQuestao = sem;
    }
    return null;
  }
  function comecarDiag() {
    const s = st();
    s.aluno = {}; s.naoVistas = []; s.sessao = null; s.sessoes = [];
    s.diag = { inicio: Date.now(), fim: null, feitas: [], usadas: [], atual: null, emCurso: true };
    s.diag.atual = proxima(); marcada = null; salvar();
  }
  function encerrarDiag() {
    const s = st(), d = s.diag, agora = Date.now();
    d.fim = agora;
    // habilidades vistas que ficaram fora da diagnose começam pela média da área e se definem nas trilhas
    vistas().forEach(h => {
      if (s.aluno.est && s.aluno.est[h.id]) return;
      const r = M.resumo(s.aluno, h.id, agora);
      (s.aluno.est = s.aluno.est || {})[h.id] = { estado: M.faixa(r.chance), nDesde: 0, ts: agora, de: null, area: 1 };
    });
  }
  function responderDiag(valor) {
    const s = st(), d = s.diag, at = d.atual; if (!at) return;
    const it = M.itens[at.id]; const ms = inicioQ ? Date.now() - inicioQ : null;
    if (valor === "nv") { // "ainda não estudei": a habilidade vai para Introdução (princípio 11)
      if (!s.naoVistas.includes(at.h)) s.naoVistas.push(at.h);
      d.feitas.push({ h: at.h, id: at.id, r: "nv" });
    } else {
      const r = valor === it.q.a ? 1 : 0;
      M.registrar(s.aluno, { id: at.id, r, ms, ts: Date.now(), longa: it.longa, v: valor });
      d.feitas.push({ h: at.h, id: at.id, r, ms: ms == null ? null : Math.round(ms) });
    }
    d.usadas.push(at.id);
    d.atual = proxima(); marcada = null;
    if (!d.atual) encerrarDiag();
    salvar(); SR.renderAll(); window.scrollTo({ top: 0 });
  }

  // ---------- trilhas e sugestão do dia (etapa 5) ----------
  function habsDaTrilha(t) {
    const alvo = t === "adiantar" ? "introducao" : t;
    const hs = H.habilidades.filter(h => estadoDe(h.id) === alvo && (M.porHab[h.id] || []).length);
    if (t === "recuperacao") return hs.sort((a, b) => prioridade(a, b) || M.resumo(st().aluno, a.id).chance - M.resumo(st().aluno, b.id).chance);
    if (t === "fixacao") return hs.sort((a, b) => ultimaPratica(a.id) - ultimaPratica(b.id) || prioridade(a, b));
    return hs.sort(prioridade);
  }
  function revisoesVencidas() {
    const s = st(), agora = Date.now();
    return vistas().filter(h => {
      const e = estadoDe(h.id); if (e !== "fixacao" && e !== "aprimoramento") return false;
      const r = M.resumo(s.aluno, h.id, agora), est = (s.aluno.est || {})[h.id];
      const subiu = est && est.de && ORD[est.de] != null && ORD[est.estado] > ORD[est.de] && agora - ultimaPratica(h.id) > 3 * DIA;
      return r.revisao || subiu;
    });
  }
  function sugestao() {
    const s = st(), rec = habsDaTrilha("recuperacao"), fix = habsDaTrilha("fixacao"), apr = habsDaTrilha("aprimoramento");
    const ult = (s.sessoes || []).filter(x => x.trilha !== "livre").slice(-3).map(x => x.trilha);
    const repetida = ult.length === 3 && ult.every(x => x === ult[0]) ? ult[0] : null;
    const ok = t => t !== repetida && habsDaTrilha(t).length;
    const base = rec.find(h => (h.base || []).length);
    if (base && ok("recuperacao")) return { t: "recuperacao", motivo: `${base.id} · ${base.curto} é base para ${(base.base || []).length} outras habilidades.` };
    const rev = revisoesVencidas();
    if (rev.length && ok("fixacao")) return { t: "fixacao", motivo: `${rev.length === 1 ? "1 habilidade pede" : rev.length + " habilidades pedem"} revisão para não se perder.` };
    const peso = t => habsDaTrilha(t).reduce((x, h) => x + h.peso, 0);
    const cands = ["recuperacao", "fixacao", "aprimoramento"].filter(ok).sort((a, b) => peso(b) - peso(a));
    if (cands.length) return { t: cands[0], motivo: repetida ? `Para variar: você fez ${NOME[repetida]} nas últimas 3 sessões.` : `É a trilha com mais habilidades de peso na prova.` };
    const qualquer = ["recuperacao", "fixacao", "aprimoramento"].find(t => habsDaTrilha(t).length);
    return qualquer ? { t: qualquer, motivo: "É onde você tem habilidades para praticar agora." } : null;
  }

  // ---------- sessão do dia ----------
  function montarSlots(t, curta, escolhidas) {
    if (t === "livre") { // conteúdo escolhido pelo aluno: até 3 habilidades, cada uma na faixa do seu estado
      const hs = (escolhidas || []).slice(0, 3); if (!hs.length) return [];
      const temRec = hs.some(h => estadoDe(h) === "recuperacao");
      const tipos = curta ? (temRec ? ["pratica", "pratica", "pratica", "checagem"] : ["pratica", "pratica", "pratica", "pratica"])
        : (temRec ? ["pratica", "pratica", "pratica", "pratica", "pratica", "pratica", "checagem", "checagem"] : Array(8).fill("pratica"));
      const recs = hs.filter(h => estadoDe(h) === "recuperacao");
      return tipos.map((tipo, i) => ({ h: tipo === "checagem" ? recs[i % recs.length] : hs[i % hs.length], tipo }));
    }
    const hs = habsDaTrilha(t).slice(0, 3).map(h => h.id); if (!hs.length) return [];
    const reparte = (tipos) => tipos.map((tipo, i) => ({ h: hs[i % hs.length], tipo }));
    if (t === "recuperacao") return reparte(curta ? ["guiada", "pratica", "pratica", "checagem"] : ["guiada", "guiada", "pratica", "pratica", "pratica", "pratica", "checagem", "checagem"]);
    if (t === "adiantar") return reparte(curta ? ["facil", "facil"] : ["facil", "facil", "facil", "facil"]);
    if (t === "fixacao") {
      const rev = revisoesVencidas().map(h => h.id).filter(h => !hs.includes(h));
      const outras = vistas().filter(h => !hs.includes(h.id) && ["fixacao", "aprimoramento"].includes(estadoDe(h.id))).sort((a, b) => ultimaPratica(a.id) - ultimaPratica(b.id)).map(h => h.id);
      const rv = rev.concat(outras); const pool = rv.length ? rv : hs;
      const base = reparte(curta ? ["pratica", "pratica", "pratica"] : ["pratica", "pratica", "pratica", "pratica", "pratica", "pratica"]);
      return base.concat((curta ? [0] : [0, 1]).map(k => ({ h: pool[k % pool.length], tipo: "revisao" })));
    }
    // aprimoramento: questões de TRI alta no ritmo da prova e 2 de habilidades vizinhas
    const viz = [...new Set(hs.flatMap(h => (HAB[h].base || []).concat(HAB[h].depende || [])))].filter(h => !hs.includes(h) && estadoDe(h) !== "introducao");
    const pool = viz.length ? viz : hs;
    const base = reparte(curta ? ["prova", "prova", "prova"] : ["prova", "prova", "prova", "prova", "prova", "prova"]);
    return base.concat((curta ? [0] : [0, 1]).map(k => ({ h: pool[k % pool.length], tipo: "vizinha" })));
  }
  function alvoDoSlot(sl, t) {
    if (sl.tipo === "checagem") { const c = M.resumo(st().aluno, sl.h).chance; return [Math.max(0.05, c - 0.07), Math.min(0.95, c + 0.07)]; } // nível da questão de referência
    if (sl.tipo === "revisao") return TR.fixacao.alvo;
    if (t === "livre") { const e = estadoDe(sl.h); return e === "introducao" ? TR.adiantar.alvo : (TR[e] || TR.fixacao).alvo; }
    if (sl.tipo === "vizinha") { const e = estadoDe(sl.h); return TR[e] ? TR[e].alvo : TR.aprimoramento.alvo; }
    return TR[t].alvo;
  }
  function escolherDoSlot(se, sl) {
    const usadas = new Set(se.resp.map(r => r.id).concat(se.atual ? [se.atual.id] : []));
    const tentar = h => {
      let c = M.escolher(st().aluno, h, alvoDoSlot(Object.assign({}, sl, { h }), se.trilha), sl.tipo === "facil" ? 25 : 1, Date.now(), usadas);
      if (sl.tipo === "facil") c = c.filter(e => (M.itens[e.id].nv || 3) <= 2).concat(c).slice(0, 1);
      return c[0] ? Object.assign({ h }, c[0]) : null;
    };
    return tentar(sl.h) || se.slots.map(x => x.h).filter(h => h !== sl.h).map(tentar).find(Boolean) || null;
  }
  function comecarSessao(t, curta, escolhidas, rotulo) {
    const s = st(), slots = montarSlots(t, curta, escolhidas); if (!slots.length) return;
    const antes = {}; [...new Set(slots.map(x => x.h))].forEach(h => { antes[h] = estadoDe(h); });
    s.sessao = { trilha: t, curta: !!curta, inicio: Date.now(), slots, i: 0, resp: [], ns: 0, antes, atual: null, respondida: null, relogio: TR[t].relogio, fim: null, rotulo: rotulo || null };
    avancar();
  }
  function avancar() {
    const se = st().sessao;
    while (se.i < se.slots.length) {
      const e = escolherDoSlot(se, se.slots[se.i]);
      if (e) { se.atual = { id: e.id, h: e.h, tipo: se.slots[se.i].tipo, chance: e.chance, motivo: e.motivo }; se.respondida = null; marcada = null; dicaAberta = false; salvar(); return; }
      se.i++;
    }
    terminarSessao();
  }
  function responderSessao(valor) {
    const s = st(), se = s.sessao, at = se.atual, it = M.itens[at.id];
    const ms = inicioQ ? Date.now() - inicioQ : null;
    const r = valor === "ns" ? "ns" : (valor === it.q.a ? 1 : 0);
    if (r === "ns") se.ns++;
    if (r === 0 && typeof valor === "number") { s.errosHab = s.errosHab || {}; (s.errosHab[at.h] = s.errosHab[at.h] || []).push({ id: at.id, v: valor }); s.errosHab[at.h] = s.errosHab[at.h].slice(-6); }
    const total = se.resp.length + 1;
    const out = M.registrar(s.aluno, { id: at.id, r, ms, ts: Date.now(), longa: it.longa, sessao: { ns: se.ns, total }, v: typeof valor === "number" ? valor : undefined });
    se.resp.push({ h: at.h, id: at.id, r, tipo: at.tipo, ms: ms == null ? null : Math.round(ms) });
    se.respondida = { valor, r, mudou: out && out.mudou ? { de: out.de, para: out.para } : null, avisoNs: r === "ns" && total >= 3 && se.ns / total > 0.3 && !se.avisouNs };
    if (se.respondida.avisoNs) se.avisouNs = true;
    salvar(); render();
  }
  function terminarSessao() {
    const s = st(), se = s.sessao;
    se.fim = Date.now(); se.atual = null;
    se.depois = {}; Object.keys(se.antes).forEach(h => { se.depois[h] = estadoDe(h); });
    registrarEvolucao();
    s.sessoes = (s.sessoes || []).concat([{ ts: se.fim, trilha: se.trilha, n: se.resp.length, ac: se.resp.filter(r => r.r === 1).length }]).slice(-60);
    salvar();
  }

  // ---------- nivelamento das aulas (etapa 6, Fase 4) ----------
  // Depois da diagnose, a lista de cada aula é montada pelo nível do aluno em cada habilidade,
  // seguindo as habilidades da lista fixa (conteúdos centrais) e na faixa de chance de cada estado.
  const ALVO_LISTA = { recuperacao: [0.7, 0.8], fixacao: [0.55, 0.7], aprimoramento: [0.4, 0.55], introducao: [0.75, 0.85] };
  const nvDe = q => q.nv || 3;
  function vistoRecente(id, agora) {
    const rs = (st().aluno.resp || {}); for (const h in rs) for (const x of rs[h]) if (x[0] === id) { const dias = (agora - x[3]) / DIA; if (x[1] === 1 ? dias < 30 : dias < 3) return true; }
    return false;
  }
  function montarLista(n) {
    const a = SR.aula(n), P = SR.pool(a), ad = new Set(a.ad || []), agora = Date.now();
    const cand = P.map((q, i) => ({ q, i, id: Banco.qid(q) })).filter(x => !ad.has(x.q) && x.q.h && HAB[x.q.h] && M.itens[x.id] && !vistoRecente(x.id, agora));
    const habs = (a.q || []).map(q => q.h).filter(h => HAB[h]);
    while (habs.length < 8 && cand.length) habs.push(cand[habs.length % cand.length].q.h);
    const usados = new Set(), grupos = new Set(), out = [], chances = [];
    const nota = (x, alvo) => { const pr = M.params(M.itens[x.id]); const th = M.resumo(st().aluno, x.q.h).theta; const p = M.p3(th, pr.a, pr.b, pr.c);
      const c = (alvo[0] + alvo[1]) / 2; return { p, v: Math.abs(p - c) - (p >= alvo[0] && p <= alvo[1] ? 1 : 0) + Math.random() * 0.05 }; };
    habs.slice(0, 8).forEach(h => {
      const e = estadoDe(h), alvo = ALVO_LISTA[e] || ALVO_LISTA.fixacao;
      const livre = x => !usados.has(x.i) && !grupos.has(x.q.g || ("i" + x.i));
      let opc = cand.filter(x => x.q.h === h && livre(x));
      if (e === "introducao") { const f = opc.filter(x => nvDe(x.q) <= 2); if (f.length) opc = f; }
      if (e === "aprimoramento") { const of = opc.filter(x => x.q.of); if (of.length) opc = of; }
      if (!opc.length) opc = cand.filter(livre);
      const best = opc.map(x => Object.assign({ n: nota(x, alvo) }, x)).sort((x, y) => x.n.v - y.n.v)[0];
      if (!best) return;
      usados.add(best.i); grupos.add(best.q.g || ("i" + best.i)); out.push(best.i); chances.push(best.n.p);
    });
    if (out.length < 8) return null;  // banco insuficiente: fica a lista da turma
    out.sort((x, y) => nvDe(P[x]) - nvDe(P[y]));
    const nv = out.map(i => nvDe(P[i]));
    return { set: out, f: nv.filter(v => v <= 2).length, m: nv.filter(v => v === 3).length, d: nv.filter(v => v >= 4).length, ch: Math.round(100 * chances.reduce((x, y) => x + y, 0) / chances.length) };
  }
  function nivelar(n) {
    if (!pronto || !SR.logado()) return;
    const S = SR.S, s = st(); if (!s.diag || !s.diag.fim) return;
    s.nivel = s.nivel || {}; s.listaTurma = s.listaTurma || {};
    if (s.listaTurma[n] || S.done[n] || SR.nAns(n) > 0 || SR.tentOf(n) > 1 || (S.sets && S.sets[n])) return;
    const r = montarLista(n); if (!r) return;
    S.sets[n] = r.set; s.nivel[n] = { set: r.set.join(","), f: r.f, m: r.m, d: r.d, ch: r.ch };
    salvar();
  }
  function rotuloLista(n) {
    if (!pronto) return "";
    const S = SR.S, s = S.ia; if (!s || !s.diag || !s.diag.fim) return "";
    const nv = s.nivel && s.nivel[n], atual = S.sets && S.sets[n] ? S.sets[n].join(",") : "";
    const podeTrocar = !S.done[n] && SR.nAns(n) === 0 && SR.tentOf(n) === 1;
    if (nv && nv.set === atual) return `<div class="ia-lista"><span><b>Lista nivelada para você:</b> ${nv.f} ${nv.f === 1 ? "fácil" : "fáceis"} · ${nv.m} ${nv.m === 1 ? "média" : "médias"} · ${nv.d} ${nv.d === 1 ? "difícil" : "difíceis"}</span>${podeTrocar ? `<button class="ia-mini" type="button" data-ia-lista="turma" data-ia-aula="${n}">Usar a lista da turma</button>` : ""}</div>`;
    if (s.listaTurma && s.listaTurma[n]) return `<div class="ia-lista"><span><b>Lista da turma</b> (igual para todos)</span>${podeTrocar ? `<button class="ia-mini" type="button" data-ia-lista="nivelada" data-ia-aula="${n}">Voltar para a lista nivelada</button>` : ""}</div>`;
    return "";
  }
  function registrarLista(n, qs, ans, tent) {
    if (!pronto) return;
    const s = st(); s.listasReg = s.listasReg || {}; const chave = n + ":" + tent; if (s.listasReg[chave]) return;
    const agora = Date.now();
    qs.forEach((q, i) => { if (ans[i] == null || !q || !q.h) return; const id = Banco.qid(q); if (!M.itens[id]) return;
      M.registrar(s.aluno, { id, r: ans[i] === q.a ? 1 : 0, ms: null, ts: agora, v: ans[i] }); });
    s.listasReg[chave] = 1;
  }

  // ---------- relatório detalhado (Fase 6, aba Identificação) ----------
  const thParaChance = p => { let lo = -2, hi = 5; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (M.fRef(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
  let thFix = null; const TH_FIX_ = () => thFix == null ? (thFix = thParaChance(0.6)) : thFix;   // meio da faixa de Fixação
  function estimativaGeral(troca) {   // média das habilidades vistas, ponderada pelo peso na prova
    let sw = 0, st_ = 0, sv = 0;
    vistas().forEach(h => { const r = M.resumo(st().aluno, h.id); const th = troca && troca[h.id] != null ? Math.max(troca[h.id], r.theta) : r.theta;
      sw += h.peso; st_ += h.peso * th; sv += (h.peso * r.ep) ** 2; });
    if (!sw) return null;
    const th = st_ / sw, ep = Math.sqrt(sv) / sw, pts = v => Math.round((500 + 100 * v) / 5) * 5;
    return { th, pts: pts(th), lo: pts(th - 1.28 * ep), hi: pts(th + 1.28 * ep) };
  }
  function caminhoMaisCurto() {
    const base = estimativaGeral(); if (!base) return [];
    return vistas().filter(h => estadoDe(h.id) === "recuperacao").map(h => { const t = {}; t[h.id] = TH_FIX_(); return { h, ganho: estimativaGeral(t).th - base.th }; })
      .sort((a, b) => b.ganho - a.ganho).slice(0, 3).map(x => x.h);
  }
  function todasRespostas() { const out = []; const rs = st().aluno.resp || {}; Object.keys(rs).forEach(h => rs[h].forEach(x => out.push({ h, id: x[0], r: x[1], ms: x[2], ts: x[3], v: x[5] }))); return out.sort((a, b) => a.ts - b.ts); }
  function registrarEvolucao() {
    const e = estimativaGeral(); if (!e) return; const s = st(), d = new Date().toISOString().slice(0, 10);
    s.evol = (s.evol || []).filter(x => x.d !== d).concat([{ d, p: e.pts }]).slice(-60);
  }
  function grafEvol(pts) {
    if (pts.length < 2) return "";
    const W = 300, Hh = 70, vs = pts.map(x => x.p), mn = Math.min(...vs) - 10, mx = Math.max(...vs) + 10;
    const X = i => 10 + i * (W - 20) / (pts.length - 1), Y = v => Hh - 10 - (v - mn) * (Hh - 20) / (mx - mn || 1);
    return `<svg class="ia-spark" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Evolução da estimativa: de ${vs[0]} para ${vs[vs.length - 1]} pontos">
      <polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts.map((x, i) => X(i) + "," + Y(x.p)).join(" ")}"/>
      ${pts.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.p)}" r="3"/>`).join("")}</svg>`;
  }
  const dataBR = ts => new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  // ---------- árvore de habilidades (consequências) ----------
  let arvoreSel = null, ARV = null;
  function layoutArvore() {
    if (ARV) return ARV;
    const lv = {}, nivel = id => lv[id] != null ? lv[id] : (lv[id] = (HAB[id].depende || []).length ? 1 + Math.max(...HAB[id].depende.map(nivel)) : 0);
    H.habilidades.forEach(h => nivel(h.id));
    const linhas = []; H.habilidades.forEach(h => { (linhas[lv[h.id]] = linhas[lv[h.id]] || []).push(h.id); });
    const W = 360, DY = 74, x = {};
    const posiciona = () => linhas.forEach(l => l.forEach((id, i) => { x[id] = W * (i + 1) / (l.length + 1); }));
    posiciona();
    for (let pass = 0; pass < 4; pass++) { // ordena cada linha pela posição média das habilidades de base (menos cruzamentos)
      linhas.forEach((l, k) => { if (!k) return; l.sort((a, b) => { const m = id => { const d = HAB[id].depende; return d.reduce((s_, p) => s_ + x[p], 0) / d.length; }; return m(a) - m(b); }); });
      posiciona();
    }
    const pos = {}; linhas.forEach((l, k) => l.forEach(id => { pos[id] = { x: x[id], y: 34 + k * DY }; }));
    return (ARV = { pos, W, H: 34 + (linhas.length - 1) * DY + 34 });
  }
  function descendentes(id) { const out = new Map(), fila = [[id, 0]]; while (fila.length) { const [h, d] = fila.shift(); (HAB[h].base || []).forEach(b => { if (!out.has(b)) { out.set(b, d + 1); fila.push([b, d + 1]); } }); } return out; }
  function ascendentes(id) { const out = new Set(), fila = [id]; while (fila.length) { const h = fila.shift(); (HAB[h].depende || []).forEach(d => { if (!out.has(d)) { out.add(d); fila.push(d); } }); } return out; }
  function arvoreSVG() {
    const { pos, W, H: Ht } = layoutArvore(), sel = arvoreSel, desc = sel ? descendentes(sel) : null, asc = sel ? ascendentes(sel) : null;
    const ativo = id => !sel || id === sel || desc.has(id) || asc.has(id);
    const arestas = H.habilidades.flatMap(h => (h.depende || []).map(d => { const a = pos[d], b = pos[h.id];
      const on = sel && ((d === sel || desc.has(d)) && desc.has(h.id) || (asc.has(d) && (asc.has(h.id) || h.id === sel)));
      return `<path class="ia-ar${on ? " ia-ar-on" : ""}${sel && !on ? " ia-ar-off" : ""}" d="M${a.x},${a.y + 15} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - 15}"/>`; })).join("");
    const nos = H.habilidades.map(h => { const p = pos[h.id], e = estadoDe(h.id);
      return `<g class="ia-no ia-no-${e}${h.id === sel ? " ia-no-sel" : ""}${ativo(h.id) ? "" : " ia-no-off"}" data-ia-no="${h.id}" role="button" tabindex="0" aria-label="${esc(h.id)}, ${esc(h.curto)}, ${NOME[e]}">
        <rect x="${p.x - 27}" y="${p.y - 15}" width="54" height="30" rx="8"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle">${esc(h.id)}</text></g>`; }).join("");
    return `<svg class="ia-arv" viewBox="0 0 ${W} ${Ht}" role="group" aria-label="Árvore de habilidades: as de cima sustentam as de baixo">${arestas}${nos}</svg>`;
  }
  function arvoreDetalhe() {
    const id = arvoreSel; if (!id) return `<p class="note">Toque numa habilidade para ver os seus erros mais frequentes nela e o que uma defasagem pode complicar.</p>`;
    const h = HAB[id], s = st(), e = estadoDe(id), r = M.resumo(s.aluno, id);
    const minhas = todasRespostas().filter(x => x.h === id && x.r === 0 && M.itens[x.id]);
    const tipos = {}; minhas.forEach(x => { const k = ERROS && Number.isInteger(x.v) ? (ERROS.porQuestao[x.id] || [])[x.v] : null; if (k && k !== "outros") tipos[k] = (tipos[k] || 0) + 1; });
    const ordT = Object.keys(tipos).sort((a, b) => tipos[b] - tipos[a]);
    const coment = minhas.filter(x => Number.isInteger(x.v)).slice(-3).reverse().map(x => { const q = M.itens[x.id].q; return q.e && q.e[x.v] ? `<li>${q.e[x.v]}</li>` : ""; }).join("");
    // erros mais comuns de quem estuda esta habilidade (todo o banco)
    const banco = {}; let tot = 0; (M.porHab[id] || []).forEach(it => ((ERROS && ERROS.porQuestao[it.id]) || []).forEach(k => { if (k && k !== "outros") { banco[k] = (banco[k] || 0) + 1; tot++; } }));
    const ordB = Object.keys(banco).sort((a, b) => banco[b] - banco[a]).slice(0, 3);
    const desc = descendentes(id), diretas = [...desc].filter(([, d]) => d === 1).map(([b]) => b), indiretas = [...desc].filter(([, d]) => d > 1).map(([b]) => b);
    const pesoAfetado = [id, ...desc.keys()].reduce((x, b) => x + HAB[b].peso, 0);
    const lista = ids => ids.map(b => `<span class="ia-chip ia-${estadoDe(b)}">${esc(b)} · ${esc(HAB[b].curto)}</span>`).join("");
    const bases = (h.depende || []), basesRec = bases.filter(b => estadoDe(b) === "recuperacao");
    return `<div class="ia-det"><p class="ia-det-h"><b>${esc(id)} · ${esc(h.curto)}</b> ${pill(e)}</p>
      <p class="note">${esc(h.nome)} · ${r.n} ${r.n === 1 ? "resposta" : "respostas"}${!r.n && (s.aluno.est || {})[id] && s.aluno.est[id].area ? " (estado estimado pela área)" : ""} · cerca de ${fmt(h.peso)} ${h.peso >= 1.5 ? "questões" : "questão"} por prova</p>
      <h4>Seus erros mais frequentes aqui</h4>
      ${minhas.length ? `<p>Você errou <b>${minhas.length}</b> ${minhas.length === 1 ? "questão" : "questões"} desta habilidade${ordT.length ? `, principalmente por <b>${ordT.slice(0, 2).map(k => ERROS.tipos[k].toLowerCase() + " (" + tipos[k] + ")").join("</b> e <b>")}</b>` : ""}.</p>${coment ? `<ul>${coment}</ul>` : ""}` : `<p>Você ainda não errou questões desta habilidade.</p>`}
      ${ordB.length ? `<p class="note">No banco, os erros mais comuns de quem estuda ${esc(id)} são ${ordB.map(k => `${ERROS.tipos[k].toLowerCase()} (${Math.round(100 * banco[k] / tot)}%)`).join(", ").replace(/, ([^,]*)$/, " e $1")}.</p>` : ""}
      <h4>O que uma defasagem aqui pode complicar</h4>
      ${desc.size ? `<p>Cerca de <b>${fmt(pesoAfetado)} questões por prova</b> dependem de ${esc(id)}, direta ou indiretamente.</p>
        <p><b>Logo em seguida:</b></p><div class="ia-chips">${lista(diretas)}</div>
        ${indiretas.length ? `<p><b>Mais adiante:</b></p><div class="ia-chips">${lista(indiretas.slice(0, 6))}</div>${indiretas.length > 6 ? `<details class="ia-mais"><summary>Ver as outras ${indiretas.length - 6}</summary><div class="ia-chips">${lista(indiretas.slice(6))}</div></details>` : ""}` : ""}`
        : `<p>${esc(id)} fecha uma sequência: nenhuma outra habilidade depende dela, mas ela vale cerca de ${fmt(h.peso)} ${h.peso >= 1.5 ? "questões" : "questão"} por prova.</p>`}
      ${bases.length ? `<h4>Ela se apoia em</h4><div class="ia-chips">${lista(bases)}</div>${basesRec.length && e !== "aprimoramento" ? `<p>Comece por ${basesRec.map(b => `<b>${esc(b)}</b>`).join(" e ")}: ${basesRec.length === 1 ? "ela está" : "elas estão"} em Recuperação e sustenta${basesRec.length === 1 ? "" : "m"} ${esc(id)}.</p>` : ""}` : ""}
      <div class="ia-row"><button class="btn" type="button" data-ia-praticar="${esc(id)}">Praticar ${esc(id)}</button>${BIB[id] ? `<button class="btn ghost" type="button" data-ia-ler="${esc(id)}">Ler o resumo</button>` : ""}</div></div>`;
  }
  function arvoreHTML() {
    return `<div id="ia-arvore"><p class="note">As habilidades de cima sustentam as de baixo. As cores mostram o seu estado em cada uma.</p>
      <div class="ia-leg">${["recuperacao", "fixacao", "aprimoramento", "introducao"].map(e => `<span class="ia-chip ia-${e}">${NOME[e]}</span>`).join("")}</div>
      <div class="ia-arv-wrap">${arvoreSVG()}</div><div id="ia-arv-det">${arvoreDetalhe()}</div></div>`;
  }
  function selecionarNo(id) { arvoreSel = arvoreSel === id ? null : id; const w = document.querySelector("#ia-arvore .ia-arv-wrap"), d = document.getElementById("ia-arv-det"); if (w) w.innerHTML = arvoreSVG(); if (d) { d.innerHTML = arvoreDetalhe(); if (arvoreSel) d.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }

  function relatorioHTML() {
    if (!pronto) return "";
    const s = SR.S.ia; if (!s || !s.diag || !s.diag.fim) return `<div class="ia-relat ia-card"><h2>Meu relatório</h2><p>O relatório detalhado aparece depois da diagnose. Ela está na aba <b>Hoje</b>.</p></div>`;
    registrarEvolucao();
    const e = estimativaGeral(), alvo = s.meta || Math.ceil((e.pts + 1) / 50) * 50, cam = caminhoMaisCurto();
    const t = {}; cam.slice(0, 2).forEach(h => { t[h.id] = TH_FIX_(); }); const proj = cam.length ? estimativaGeral(t) : null;
    const nome = h => `${esc(h.id)} · ${esc(h.curto)}`;
    // 1. resumo em uma frase
    const frase = `Sua estimativa é de <b>${e.pts} pontos</b> (faixa provável de ${e.lo} a ${e.hi}).` + (s.meta ? ` Sua meta é <b>${s.meta}</b>${s.meta > e.pts ? `: faltam ${s.meta - e.pts} pontos` : ": você já está nela"}.` : "") + (cam.length ? ` As habilidades que mais fazem a sua estimativa subir agora são ${cam.map(h => `<b>${esc(h.id)}</b> (${esc(h.curto.toLowerCase())})`).join(", ").replace(/, ([^,]*)$/, " e $1")}.` : ` Nenhuma habilidade está em Recuperação: o ganho agora vem de confirmar a Fixação e subir para o Aprimoramento.`);
    const meta = `<div class="ia-row"><label class="note" for="ia-meta">Minha meta de pontos</label><input id="ia-meta" class="ia-meta" type="number" min="400" max="950" step="10" value="${s.meta || ""}" placeholder="${alvo}"><button class="ia-mini" type="button" data-iar="meta">Salvar meta</button></div>`;
    // 2. mapa das 30 habilidades
    const status = h => { const est = (s.aluno.est || {})[h.id]; if (estadoDe(h.id) === "introducao") return "ainda não estudou"; const r = M.resumo(s.aluno, h.id);
      return r.validado ? "confirmada" : r.observacao ? "em observação" : !r.n && est && est.area ? "estimada pela área" : "provisória"; };
    const mapa = `<div class="ia-mapa">${H.habilidades.map(h => { const r = M.resumo(s.aluno, h.id); return `<div class="ia-mh ia-mh-${estadoDe(h.id)}"><b>${esc(h.id)}</b><span>${esc(h.curto)}</span><small>${pill(estadoDe(h.id))} ${r.n} ${r.n === 1 ? "resposta" : "respostas"} · ${status(h)}</small></div>`; }).join("")}</div>`;
    // 3. onde perde mais pontos: erros em questões com boa chance de acerto
    const resp = todasRespostas(), erradas = resp.filter(x => x.r === 0 && M.itens[x.id]);
    const faceis = erradas.filter(x => { const pr = M.params(M.itens[x.id]); return M.p3(M.resumo(s.aluno, x.h).theta, pr.a, pr.b, pr.c) >= 0.6 || (M.itens[x.id].nv || 3) <= 2; });
    const perde = faceis.length ? `<p>Você errou <b>${faceis.length} ${faceis.length === 1 ? "questão" : "questões"}</b> que estavam ao seu alcance (chance de acerto de 60% ou mais). Na TRI, esses erros derrubam mais a nota do que errar as difíceis.</p>
      <ul>${faceis.slice(-6).reverse().map(x => { const q = M.itens[x.id].q; return `<li><b>${esc(x.h)}</b> · ${esc(q.hab || HAB[x.h].curto)} (${dataBR(x.ts)})${Number.isInteger(x.v) && q.e && q.e[x.v] ? `: você marcou ${L[x.v]}. ${q.e[x.v]}` : ""}</li>`; }).join("")}</ul>`
      : `<p>Nenhum erro em questão ao seu alcance até agora.</p>`;
    // 4. tipos de erro
    const tipos = {}; let comV = 0;
    erradas.forEach(x => { if (!Number.isInteger(x.v) || !ERROS) return; const k = (ERROS.porQuestao[x.id] || [])[x.v]; if (!k) return; comV++; tipos[k] = (tipos[k] || 0) + 1; });
    const ordT = Object.keys(tipos).filter(k => k !== "outros").sort((a, b) => tipos[b] - tipos[a]);
    const maxT = Math.max(1, ...Object.values(tipos));
    const tiposHTML = ordT.length ? `<div class="ia-barras">${ordT.slice(0, 6).map(k => `<div><span>${esc(ERROS.tipos[k])}</span><i style="width:${Math.round(100 * tipos[k] / maxT)}%"></i><b>${tipos[k]}</b></div>`).join("")}</div>
      <p>O tipo de erro que mais se repete é <b>${esc(ERROS.tipos[ordT[0]].toLowerCase())}</b>. Antes de marcar a resposta, confira esse ponto.</p>`
      : `<p class="note">Os tipos de erro aparecem conforme você resolve sessões e listas.</p>`;
    // 5. impacto futuro
    const rec = vistas().filter(h => estadoDe(h.id) === "recuperacao" && (h.base || []).length).sort(prioridade).slice(0, 4);
    const impacto = rec.length ? `<ul>${rec.map(h => `<li><b>${nome(h)}</b> em Recuperação afeta ${h.base.map(b => esc(b)).join(", ")}.</li>`).join("")}</ul>` : `<p>Nenhuma habilidade de base está em Recuperação.</p>`;
    // 6. projeção
    const projHTML = proj ? `<p>Se ${cam.slice(0, 2).map(nome).join(" e ")} ${cam.length > 1 ? "chegarem" : "chegar"} à Fixação, sua estimativa sobe para cerca de <b>${proj.pts} pontos</b> (+${proj.pts - e.pts}).</p>` : "";
    // 7. hábitos
    const comMs = resp.filter(x => x.ms != null && x.r !== "ns"), media = comMs.length ? comMs.reduce((a, x) => a + x.ms, 0) / comMs.length : 0;
    const rapidas = comMs.filter(x => x.ms < 15000 && M.itens[x.id] && M.itens[x.id].longa).length, ns = resp.filter(x => x.r === "ns").length;
    const sem7 = (s.sessoes || []).filter(x => Date.now() - x.ts < 7 * DIA).length, totS = (s.sessoes || []).length;
    const porT = {}; (s.sessoes || []).forEach(x => { porT[x.trilha] = (porT[x.trilha] || 0) + 1; });
    const evita = totS >= 5 && habsDaTrilha("recuperacao").length && (porT.recuperacao || 0) / totS < 0.2 ? `<li>Você fez ${porT.recuperacao || 0} ${(porT.recuperacao || 0) === 1 ? "sessão" : "sessões"} de Recuperação em ${totS}. É nela que estão os pontos mais fáceis de ganhar.</li>` : "";
    const habitos = `<ul>
      ${comMs.length ? `<li>Tempo médio por questão: <b>${(media / 60000).toFixed(1).replace(".", ",")} min</b> (no ENEM, cerca de 3 min).</li>` : ""}
      ${rapidas ? `<li><b>${rapidas}</b> ${rapidas === 1 ? "resposta rápida demais" : "respostas rápidas demais"} em questões longas (menos de 15 s): podem ter sido chutes.</li>` : ""}
      <li>“Não sei” usado ${ns} ${ns === 1 ? "vez" : "vezes"}.</li>
      <li>Sessões nos últimos 7 dias: <b>${sem7}</b>${totS ? ` (total: ${totS})` : ""}.</li>${evita}</ul>`;
    // 8. evolução
    const movs = Object.keys(s.aluno.est || {}).map(h => ({ h, x: s.aluno.est[h] })).filter(m => m.x.de && ORD[m.x.de] != null && ORD[m.x.estado] != null).sort((a, b) => b.x.ts - a.x.ts).slice(0, 6);
    const evol = `${grafEvol((s.evol || []).slice(-8))}${(s.evol || []).length < 2 ? `<p class="note">O gráfico aparece a partir do segundo dia de estudo.</p>` : ""}
      ${movs.length ? `<ul>${movs.map(m => `<li>${dataBR(m.x.ts)}: <b>${esc(m.h)}</b> ${ORD[m.x.estado] > ORD[m.x.de] ? "subiu" : "desceu"} de ${NOME[m.x.de]} para ${NOME[m.x.estado]}.</li>`).join("")}</ul>` : ""}`;
    // 9. plano da próxima semana
    const plano = []; const R = habsDaTrilha("recuperacao"), F = habsDaTrilha("fixacao"), A = habsDaTrilha("aprimoramento"), rev = revisoesVencidas();
    if (R.length) plano.push(`2 sessões de <b>Recuperação</b>: ${R.slice(0, 3).map(nome).join(", ")}.`);
    if (rev.length) plano.push(`1 sessão de <b>Fixação</b> para revisar ${rev.slice(0, 2).map(nome).join(" e ")}.`);
    else if (F.length) plano.push(`1 sessão de <b>Fixação</b>: ${F.slice(0, 3).map(nome).join(", ")}.`);
    if (A.length) plano.push(`1 sessão de <b>Aprimoramento</b> no ritmo de prova: ${A.slice(0, 2).map(nome).join(", ")}.`);
    const ler = R.find(h => BIB[h.id]); if (ler) plano.push(`Ler o resumo de ${nome(ler)} na Biblioteca, na versão para Recuperação.`);
    if (ordT.length) plano.push(`Em toda questão, antes de marcar, confira: ${esc(ERROS.tipos[ordT[0]].toLowerCase())}.`);
    // versão do professor
    const prof = `<details class="ia-prof"><summary>Detalhes técnicos (para o professor)</summary>
      <table class="ia-tab"><thead><tr><th>Hab.</th><th>Estado</th><th>Pontos</th><th>± (80%)</th><th>Resp.</th><th>Situação</th><th>Rápidas</th></tr></thead><tbody>
      ${H.habilidades.map(h => { const r = M.resumo(s.aluno, h.id), rp = comMs.filter(x => x.h === h.id && x.ms < 15000 && M.itens[x.id] && M.itens[x.id].longa).length;
        return `<tr><td>${esc(h.id)}</td><td>${NOME[estadoDe(h.id)]}</td><td>${r.pontos || "–"}</td><td>${r.ep != null ? Math.round(128 * r.ep) : "–"}</td><td>${r.n}</td><td>${status(h)}</td><td>${rp || ""}</td></tr>`; }).join("")}</tbody></table>
      <p class="note">Estimativa geral: θ = ${e.th.toFixed(2)} (média das habilidades ponderada pelo peso na prova). Listas niveladas: ${Object.keys(s.nivel || {}).map(n => `aula ${n} (${s.nivel[n].f}F/${s.nivel[n].m}M/${s.nivel[n].d}D, chance média prevista ${s.nivel[n].ch}%)`).join("; ") || "nenhuma ainda"}.</p></details>`;
    const sec = (n, t, c) => c ? `<section class="ia-sec"><h3>${n}. ${t}</h3>${c}</section>` : "";
    return `<div class="ia-relat ia-card"><h2>Meu relatório</h2><p class="note">Atualizado em ${new Date().toLocaleDateString("pt-BR")}. Estimativas na escala do ENEM, calculadas com as suas respostas.</p>
      <p class="ia-frase">${frase}</p>${meta}
      ${sec(1, "Plano para a próxima semana", plano.length ? `<ol>${plano.map(x => `<li>${x}</li>`).join("")}</ol>` : "")}
      ${sec(2, "Onde você perde mais pontos", perde)}
      ${sec(3, "Seus tipos de erro mais frequentes", tiposHTML)}
      ${sec(4, "Projeção", projHTML)}
      ${sec(5, "Impacto futuro das defasagens", impacto)}
      ${sec(6, "Seus hábitos de estudo", habitos)}
      ${sec(7, "Evolução", evol)}
      ${sec(8, "Árvore de habilidades", arvoreHTML())}
      ${sec(9, "Mapa das 30 habilidades", mapa)}
      ${prof}
      <div class="ia-row ia-noprint"><button class="btn ghost" type="button" data-iar="imprimir">Baixar em PDF / imprimir</button><button class="btn ghost" type="button" data-tab="ia">Ir para Hoje</button></div></div>`;
  }

  // ---------- telas ----------
  const pill = e => `<span class="ia-pill ia-${e}">${esc(NOME[e] || e)}</span>`;
  const btnTeoria = (h, foco) => BIB[h] ? `<button class="btn ghost" type="button" data-ia-resumo="${esc(h)}" data-ia-foco="${foco || ""}">Rever a teoria</button>`
    : AULA[h] ? `<button class="btn ghost" type="button" data-calgo="${AULA[h]}" data-calmode="resumo">Rever a teoria (aula ${String(AULA[h]).padStart(2, "0")})</button>` : "";

  // ---------- biblioteca teórica (etapa 6, Fase 4) ----------
  const SECOES = [["ideia", "Ideia central"], ["base", "Comece do zero"], ["formulas", "Fórmulas essenciais"], ["porque", "Por que funciona"],
    ["detalhado", "Passo a passo detalhado"], ["passos", "Passo a passo"], ["exemploPasso", "Exemplo resolvido passo a passo"], ["exemplo", "Outro exemplo resolvido"],
    ["meus", "Os erros que você cometeu"], ["erros", "Erros comuns"], ["confira", "Antes de marcar a resposta"], ["enem", "Como o ENEM cobra"], ["lembrar", "Para lembrar"], ["prereq", "Pré-requisitos"]];
  const PROF = { // o que o aluno vê primeiro, conforme o estado; o resumo completo fica a um toque
    introducao: SECOES.map(x => x[0]),
    recuperacao: ["ideia", "base", "formulas", "detalhado", "exemploPasso", "meus", "erros", "confira", "prereq"],
    fixacao: ["formulas", "lembrar", "exemplo"], aprimoramento: ["enem", "lembrar"]
  };
  function secaoHTML(r, k) {
    const lista = a => `<ul>${a.map(x => `<li>${x}</li>`).join("")}</ul>`;
    if (k === "ideia") return `<p>${r.ideia}</p>`;
    if (k === "formulas") return `<div class="ia-forms">${r.formulas.map(f => `<div class="ia-form"><div class="ia-mat">${f.f}</div><p>${f.sig}</p></div>`).join("")}</div>`;
    if (k === "porque") return `<p>${r.porque}</p>`;
    if (k === "passos") return `<ol>${r.passos.map(x => `<li>${x}</li>`).join("")}</ol>`;
    if (k === "base") return (r.base || []).length ? `<div class="ia-base">${r.base.map(b => `<div class="ia-bloco"><h4>${b.t}</h4><p>${b.txt}</p><p class="ia-exm"><b>Exemplo:</b> ${b.ex}</p></div>`).join("")}</div>` : "";
    if (k === "detalhado") return (r.passosDetalhados || []).length ? `<ol class="ia-passos">${r.passosDetalhados.map(x => `<li><b>${x.passo}.</b> ${x.como}<div class="ia-exm">${x.ex}</div></li>`).join("")}</ol>` : "";
    if (k === "exemploPasso") { const ep = r.exemploPasso, it = ep && M.itens[ep.id]; if (!it) return "";
      const q = it.q, op = q.o.map((o, j) => `<button class="opt${j === q.a ? " is-right" : ""}" type="button" disabled><span class="bub">${L[j]}</span><span>${SR.optT(q, j, o)}</span></button>`).join("");
      return `<article class="q ia-ex">${corpoQuestao(q, op)}</article><ol class="ia-passos">${ep.passos.map(x => `<li>${x}</li>`).join("")}</ol>`; }
    if (k === "confira") return (r.confira || []).length ? `<ul class="ia-check">${r.confira.map(x => `<li>${x}</li>`).join("")}</ul>` : "";
    if (k === "meus") { const es = (st().errosHab || {})[r.h] || []; if (!es.length) return "";
      return `<ul>${es.slice(-4).reverse().map(e => { const it = M.itens[e.id], q = it && it.q; return q && q.e && q.e[e.v] ? `<li>Você marcou ${L[e.v]}: ${q.e[e.v]}</li>` : ""; }).join("")}</ul>`; }
    if (k === "exemplo") { const it = r.exemplo && M.itens[r.exemplo.id]; if (!it) return "";
      const q = it.q, op = q.o.map((o, j) => `<button class="opt${j === q.a ? " is-right" : ""}" type="button" disabled><span class="bub">${L[j]}</span><span>${SR.optT(q, j, o)}</span></button>`).join("");
      return `<article class="q ia-ex">${corpoQuestao(q, op)}</article><p><b>Resposta: ${L[q.a]}.</b> ${r.exemplo.comentario}</p>`; }
    if (k === "erros") return lista(r.erros);
    if (k === "enem") return `<p>${r.enem}</p>`;
    if (k === "lembrar") return lista(r.lembrar);
    if (k === "prereq") { const ds = (HAB[r.h].depende || []); if (!ds.length) return "";
      return `<p>Esta habilidade se apoia em:</p><div class="ia-row">${ds.map(d => BIB[d] ? `<button class="ia-mini" type="button" data-ia-resumo="${esc(d)}">${esc(d)} · ${esc(HAB[d].curto)}</button>` : `<span class="note">${esc(d)} · ${esc(HAB[d].curto)}</span>`).join("")}</div>`; }
    return "";
  }
  function telaResumo() {
    const { h, completo, foco } = resumoAberto, r = BIB[h], e = estadoDe(h), mostra = completo ? PROF.introducao : (PROF[e] || PROF.introducao).concat(foco && !(PROF[e] || []).includes(foco) ? [foco] : []);
    const corpo = SECOES.filter(([k]) => mostra.includes(k) && !(k === "passos" && (r.passosDetalhados || []).length && mostra.includes("detalhado"))).map(([k, t]) => { const c = secaoHTML(r, k); return c ? `<section class="ia-sec" id="ia-sec-${k}"><h3>${t}</h3>${c}</section>` : ""; }).join("");
    return `<div class="ia-resumo">
      ${r.aprovado ? "" : `<p class="ia-rasc">Rascunho em revisão pelo professor · só aparece no site de teste</p>`}
      <p class="note">${esc(h)} · ${esc(HAB[h].nome)} · ${esc(r.serie || "")}</p>
      <h2>${esc(r.topico)}</h2>
      <p>${pill(e)} ${completo || e === "introducao" ? "Resumo completo" : `Versão para quem está em ${NOME[e]}`}</p>
      ${corpo}
      <div class="ia-row ia-noprint">${completo || e === "introducao" ? "" : `<button class="btn ghost" type="button" data-ia="resumoCompleto">Ver o resumo completo</button>`}
        <button class="btn ghost" type="button" data-ia="imprimir">Baixar em PDF / imprimir</button>
        <button class="btn" type="button" data-ia="fecharResumo">Voltar</button></div></div>`;
  }
  function telaBiblioteca() {
    const itens = H.areas.map(ar => `<h4 class="ia-h4">${esc(ar.nome)}</h4>` + H.habilidades.filter(h => h.area === ar.id).map(h => {
      const r = BIB[h.id], txt = (h.id + " " + h.nome + " " + h.curto + " " + (r ? r.topico : "")).toLowerCase();
      return `<div class="ia-cont ia-bib" data-ia-texto="${esc(txt)}"><p class="ia-cont-h"><b>${esc(h.id)} · ${esc(r ? r.topico : h.curto)}</b> ${pill(estadoDe(h.id))}</p>
        <div class="ia-row">${r ? `<button class="btn ghost" type="button" data-ia-resumo="${esc(h.id)}">Abrir resumo</button>${r.aprovado ? "" : `<small class="note">rascunho</small>`}` : `<small class="note">Resumo em produção</small>`}</div></div>`;
    }).join("")).join("");
    return `<div class="ia-card"><h2>Biblioteca</h2><p>Resumos por tópico, com fórmulas, passo a passo e erros comuns. Cada resumo se ajusta ao seu momento em cada habilidade.</p>
        <input id="ia-busca" class="ia-busca" type="search" placeholder="Buscar tópico (ex.: escala, porcentagem)" aria-label="Buscar tópico"></div>
      ${itens}<div class="ia-row"><button class="btn ghost" type="button" data-ia="hoje">Voltar para Hoje</button></div>`;
  }
  function corpoQuestao(q, opts) { // enunciados e alternativas são conteúdo do próprio banco do app, renderizados como nas listas
    const tb = q.tb ? `<div class="tbl"><table><thead><tr>${q.tb[0].map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${q.tb.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    const fig = q.f && SR.D.figs && SR.D.figs[q.f] ? `<div class="fig"><img src="${SR.D.figs[q.f]}" alt="Figura da questão"></div>` : "";
    return `<div class="txt">${(q.t || []).map(t => `<p>${t}</p>`).join("")}</div>${tb}${fig}${q.c ? `<p class="cmd">${q.c}</p>` : ""}<div class="opts${q.pdf ? " pdfo" : ""}">${opts}</div>`;
  }
  const opcoes = (q, resp) => q.o.map((o, j) => {
    let c = ""; if (resp) { if (j === q.a) c = " is-right"; else if (j === resp.valor) c = " is-wrong"; }
    return `<button class="opt${c}" type="button" data-iao="${j}" aria-pressed="${(resp ? resp.valor : marcada) === j}" ${resp ? "disabled" : ""}><span class="bub">${L[j]}</span><span>${SR.optT(q, j, o)}</span></button>`;
  }).join("");
  const marcaTempo = id => { if (qAtualId !== id) { qAtualId = id; inicioQ = Date.now(); if (!st().sessao || !st().sessao.respondida) marcada = null; } };

  function telaSerie() {
    return `<div class="ia-card"><h2>Hoje</h2>
      <p>A IA do Santa Revisão monta um caminho de estudo só seu, habilidade por habilidade, e se ajusta a cada questão que você resolve.</p>
      <p><b>Para começar, em que série você está?</b></p>
      <div class="ia-row">${["1", "2", "3"].map(n => `<button class="btn" type="button" data-ia-serie="${n}">${n}ª série</button>`).join("")}</div></div>`;
  }
  function telaConvite() {
    const s = st(), d = s.diag, n = limite();
    const andamento = d && !d.fim && d.feitas.length;
    return `<div class="ia-card"><h2>Diagnose</h2>
      <blockquote class="ia-quote">A plataforma se adapta melhor quando conhece você. Faça a diagnose com calma, sozinho e sem consulta: ela não vale nota, serve só para montar o seu caminho. Quanto mais fiel, mais certeiro o seu plano.</blockquote>
      <ul class="ia-list">
        <li>${n} questões no modelo do ENEM, das sete áreas da Matemática (cerca de ${Math.round(n * 1.4)} minutos).</li>
        <li>Sem correção durante a diagnose, para uma resposta não influenciar a outra. O resultado aparece no fim.</li>
        <li>Se precisar parar, pode fechar: ao voltar, você continua da mesma questão.</li>
        ${s.serie !== "3" ? "<li>Se aparecer um conteúdo que você ainda não estudou, toque em <b>“Ainda não estudei este conteúdo”</b>. Ele não conta como erro.</li>" : ""}
      </ul>
      <div class="ia-row"><button class="btn" type="button" data-ia="${andamento ? "continuar" : "comecar"}">${andamento ? "Continuar a diagnose" : "Começar a diagnose"}</button>
      <button class="btn ghost" type="button" data-ia="trocaSerie">Estou na ${esc(s.serie)}ª série · trocar</button></div></div>`;
  }
  function telaDiag() {
    const s = st(), d = s.diag, at = d.atual, q = M.itens[at.id].q, k = respondidas(d) + 1, n = limite();
    marcaTempo(at.id);
    return `<div class="ia-prog"><span>Diagnose · questão <b>${Math.min(k, n)}</b> de ${n}</span><span class="ia-bar"><i style="width:${Math.round(100 * (k - 1) / n)}%"></i></span></div>
      <article class="q"><div class="q-h"><b>${esc(at.h)} · ${esc(HAB[at.h].curto)}</b></div>${corpoQuestao(q, opcoes(q, null))}</article>
      <div class="ia-row ia-nav"><button class="btn" type="button" data-ia="confirmar" ${marcada == null ? "disabled" : ""}>Confirmar e seguir</button>
        ${s.serie !== "3" ? `<button class="btn ghost" type="button" data-ia="naoVi">Ainda não estudei este conteúdo</button>` : ""}</div>
      <p class="note">Sua resposta fica salva ao confirmar. Você pode fechar e continuar depois.</p>`;
  }
  function predominante(lista) {
    const c = {}; lista.forEach(e => { c[e] = (c[e] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || ORD[a] - ORD[b])[0];
  }
  function telaResultado() {
    const s = st(), d = s.diag, est = s.aluno.est || {};
    const E = {}; H.habilidades.forEach(h => { E[h.id] = estadoDe(h.id); });
    const vs = vistas();
    const eixos = H.areas.map(a => {
      const hs = vs.filter(h => h.area === a.id); if (!hs.length) return `<div class="ia-eixo"><b>${esc(a.nome)}</b>${pill("introducao")}<small>Conteúdos que você ainda não estudou</small></div>`;
      const ests = hs.map(h => E[h.id]), c = {}; ests.forEach(e => { c[e] = (c[e] || 0) + 1; });
      return `<div class="ia-eixo"><b>${esc(a.nome)}</b>${pill(predominante(ests))}<small>${Object.keys(c).sort((x, y) => ORD[x] - ORD[y]).map(e => `${c[e]} em ${NOME[e]}`).join(" · ")}</small></div>`;
    }).join("");
    const rec = vs.filter(h => E[h.id] === "recuperacao").sort(prioridade);
    const cartao = h => {
      const base = (h.base || []).map(b => HAB[b] ? HAB[b].curto.toLowerCase() : b);
      return `<div class="ia-def"><p class="ia-def-h"><b>${esc(h.id)} – ${esc(h.curto)}</b>${pill("recuperacao")}${est[h.id] && est[h.id].area ? '<small class="note">estimada pela área</small>' : ""}</p>
        <p><b>Peso na prova:</b> costuma aparecer em cerca de ${fmt(h.peso)} ${h.peso >= 1.5 ? "questões" : "questão"} por prova.</p>
        ${base.length ? `<p><b>O que ela afeta:</b> é base para ${esc(base.slice(0, -1).join(", ") + (base.length > 1 ? " e " : "") + base[base.length - 1])}.</p>` : ""}
        <p><b>Efeito na nota:</b> na TRI, errar questões fáceis desta habilidade derruba mais a nota do que errar as difíceis. Comece pela trilha de Recuperação.</p></div>`;
    };
    const cartoes = rec.slice(0, 5).map(cartao).join("") + (rec.length > 5 ? `<details class="ia-mais"><summary>Ver as outras ${rec.length - 5} habilidades em Recuperação</summary>${rec.slice(5).map(cartao).join("")}</details>` : "");
    const trilha = e => { const hs = H.habilidades.filter(h => E[h.id] === e); return `<div class="ia-trilha ia-t-${e}"><h4>${NOME[e]}</h4><p class="note">${hs.length} ${hs.length === 1 ? "habilidade" : "habilidades"}</p>${hs.length ? `<ul>${hs.map(h => `<li>${esc(h.id)} · ${esc(h.curto)}${est[h.id] && est[h.id].area ? " <small>(pela área)</small>" : ""}</li>`).join("")}</ul>` : ""}<button class="btn" type="button" data-ia-trilha="${e}" ${hs.length ? "" : "disabled"}>Começar</button></div>`; };
    const min = d.fim && d.inicio ? Math.max(1, Math.round((d.fim - d.inicio) / 60000)) : null;
    const intro = H.habilidades.filter(h => E[h.id] === "introducao");
    const porArea = vs.filter(h => est[h.id] && est[h.id].area).length;
    return `<div class="ia-card"><h2>Seu mapa inicial</h2>
        <p>Você respondeu ${respondidas(d)} questões${min ? ` em ${min} ${min === 1 ? "minuto" : "minutos"}` : ""}. Não existe nota aqui: o mapa mostra por onde começar em cada área. Ele é <b>provisório</b> e vai ficando mais preciso a cada questão das trilhas.</p>
        ${porArea ? `<p class="note">${porArea} habilidades de menor peso não entraram na diagnose: começam pela média da sua área e se definem nas primeiras questões das trilhas.</p>` : ""}</div>
      <h3 class="ia-h3">1. Seu perfil por área</h3><div class="ia-eixos">${eixos}</div>
      <h3 class="ia-h3">2. Onde vale começar</h3>${cartoes || `<p class="note">Nenhuma habilidade ficou em Recuperação. Siga pelas trilhas de Fixação e Aprimoramento.</p>`}
      <h3 class="ia-h3">3. Suas trilhas</h3><div class="ia-trilhas">${["recuperacao", "fixacao", "aprimoramento"].map(trilha).join("")}</div>
      ${intro.length ? `<p class="note"><b>Introdução</b> (ainda não estudou): ${intro.map(h => esc(h.id) + " · " + esc(h.curto)).join("; ")}. Fica opcional, na trilha Adiantar.</p>` : ""}
      <div class="ia-row"><button class="btn" type="button" data-ia="hoje">Ir para a tela Hoje</button>
        <button class="btn ghost" type="button" data-ia="refazer">Refazer a diagnose do zero (teste)</button></div>`;
  }
  function telaHoje() {
    const s = st(), sug = sugestao();
    const cartao = t => {
      const hs = habsDaTrilha(t), on = hs.length > 0, n = t === "adiantar" ? 4 : 8;
      const nomes = hs.slice(0, 3).map(h => `<li>${esc(h.id)} · ${esc(h.curto)}</li>`).join("");
      const sel = sug && sug.t === t;
      return `<div class="ia-trilha ia-t-${t === "adiantar" ? "introducao" : t}${sel ? " ia-sug" : ""}">
        ${sel ? `<p class="ia-selo">Sugerida hoje</p><p class="note">${esc(sug.motivo)}</p>` : ""}
        <h4>${NOME[t]}</h4>
        ${on ? `<ul>${nomes}</ul><p class="note">${n} questões · cerca de ${TR[t].min} min${hs.length > 3 ? ` · +${hs.length - 3} ${hs.length - 3 === 1 ? "habilidade" : "habilidades"} na fila` : ""}</p>
          <div class="ia-row"><button class="btn" type="button" data-ia-trilha="${t}">Começar</button><button class="btn ghost" type="button" data-ia-trilha="${t}" data-ia-curta="1">Tenho pouco tempo (${n / 2})</button></div>`
          : `<p class="note">${t === "adiantar" ? "" : "Nenhuma habilidade aqui por enquanto."}</p>`}</div>`;
    };
    const temIntro = habsDaTrilha("adiantar").length > 0;
    const feitas = (s.sessoes || []).length;
    return `<div class="ia-card"><h2>Hoje</h2><p>Escolha uma sessão curta. A IA sugere uma, mas quem decide é você.</p>
        ${feitas ? `<p class="note">${feitas} ${feitas === 1 ? "sessão feita" : "sessões feitas"} até agora.</p>` : ""}</div>
      <div class="ia-trilhas">${["recuperacao", "fixacao", "aprimoramento"].map(cartao).join("")}${temIntro ? cartao("adiantar") : ""}</div>
      <div class="ia-card ia-escolher"><h4>Quero escolher outro conteúdo</h4><p class="note">Está estudando um assunto na escola? Escolha o tema e pratique com questões do ENEM no seu nível.</p>
        <div class="ia-row"><button class="btn" type="button" data-ia="conteudos">Escolher conteúdo</button></div></div>
      <div class="ia-row"><button class="btn ghost" type="button" data-ia="mapa">Ver meu mapa</button><button class="btn ghost" type="button" data-ia="biblioteca">Biblioteca</button></div>`;
  }
  function telaEscolha() {
    const pillsDe = hs => hs.map(h => `<span class="ia-hab">${esc(h)} ${pill(estadoDe(h))}</span>`).join("");
    const botoes = (hs, rot) => { const v = esc(hs.slice(0, 3).join(",")), r = esc(rot);
      return `<button class="btn" type="button" data-ia-livre="${v}" data-ia-rot="${r}">Praticar (8)</button><button class="btn ghost" type="button" data-ia-livre="${v}" data-ia-rot="${r}" data-ia-curta="1">4 questões</button>`; };
    let lista;
    if (modoConteudos === "tema") {
      lista = SR.D.aulas.filter(a => (AULAHABS[a.n] || []).length).map(a => {
        const hs = AULAHABS[a.n].slice(0, 3);
        return `<div class="ia-cont"><p class="ia-cont-h"><b>Aula ${String(a.n).padStart(2, "0")} · ${esc(a.tema)}</b></p>
          ${a.cont ? `<p class="note">${esc(a.cont)}</p>` : ""}<div class="ia-habs">${pillsDe(hs)}</div>
          <div class="ia-row">${botoes(hs, "Aula " + String(a.n).padStart(2, "0") + " · " + a.tema)}<button class="ia-mini" type="button" data-calgo="${a.n}" data-calmode="resumo">Ver a teoria</button></div></div>`;
      }).join("");
    } else {
      lista = H.areas.map(ar => `<h4 class="ia-h4">${esc(ar.nome)}</h4>` + H.habilidades.filter(h => h.area === ar.id).map(h => {
        const e = estadoDe(h.id);
        return `<div class="ia-cont"><p class="ia-cont-h"><b>${esc(h.id)} · ${esc(h.curto)}</b> ${pill(e)}</p>
          <div class="ia-row">${botoes([h.id], h.id + " · " + h.curto)}${e === "introducao" ? `<button class="ia-mini" type="button" data-ia-jaVi="${esc(h.id)}">Já estou estudando isso na escola</button>` : ""}</div></div>`;
      }).join("")).join("");
    }
    return `<div class="ia-card"><h2>Escolher conteúdo</h2>
        <p>Pratique o que você está vendo na escola. A IA continua ajustando as questões ao seu nível em cada habilidade, e tudo conta para o seu mapa.</p>
        <div class="mode sm ia-row" role="group" aria-label="Organizar por"><button type="button" data-ia-modo="tema" aria-pressed="${modoConteudos === "tema"}">Por tema das aulas</button><button type="button" data-ia-modo="area" aria-pressed="${modoConteudos === "area"}">Por área do ENEM</button></div></div>
      ${lista}
      <div class="ia-row"><button class="btn ghost" type="button" data-ia="hoje">Voltar para Hoje</button><button class="btn ghost" type="button" data-tab="aulas">Abrir Aulas e listas</button></div>`;
  }
  function telaSessao() {
    const s = st(), se = s.sessao, at = se.atual, it = M.itens[at.id], q = it.q, k = se.i + 1, n = se.slots.length, resp = se.respondida;
    marcaTempo(at.id);
    const tipoTxt = { guiada: "Questão guiada", pratica: "Prática", checagem: "Checagem: nível da Fixação", revisao: "Revisão espaçada", prova: "Ritmo de prova", vizinha: "Habilidade vizinha", facil: "Primeiros passos" }[at.tipo] || "";
    const aula = AULA[at.h] && SR.D.aulas.find(a => a.n === AULA[at.h]);
    const antes = k === 1 && !resp ? (se.trilha === "recuperacao" || se.trilha === "adiantar" ? `<div class="ia-antes"><b>Antes de começar:</b> se quiser, leia o resumo da teoria. ${btnTeoria(at.h)}</div>`
      : se.trilha === "fixacao" && BIB[at.h] ? `<div class="ia-antes"><b>Ficha rápida (opcional):</b> ${btnTeoria(at.h)}</div>`
      : se.trilha === "fixacao" && aula && aula.dica ? `<details class="ia-antes"><summary>Ficha rápida (opcional)</summary><p>${aula.dica}</p></details>` : "") : "";
    const dica = at.tipo === "guiada" && !resp && aula && aula.dica ? (dicaAberta ? `<div class="ia-dica"><b>Dica:</b> ${aula.dica}</div>` : `<button class="btn ghost" type="button" data-ia="dica">Ver uma dica</button>`) : "";
    let fb = "";
    if (resp) {
      const certo = resp.r === 1, ns = resp.r === "ns";
      fb = `<div class="fbk ia-fbk ${certo ? "ok" : "no"}">
        <p><b>${certo ? "Certo!" : ns ? "Tudo bem não saber." : "Não foi dessa vez."}</b> ${certo ? "" : `A resposta é <b>${L[q.a]}</b>.`}</p>
        ${!certo && !ns && q.e && q.e[resp.valor] ? `<p class="bad"><b>Sobre a sua marcação:</b> ${q.e[resp.valor]}</p>` : ""}
        ${q.sol ? `<p class="sol"><b>Resolução:</b> ${q.sol}</p>` : ""}
        ${resp.mudou ? `<p class="ia-sobe"><b>${esc(at.h)}</b> mudou de trilha: ${pill(resp.mudou.de)} → ${pill(resp.mudou.para)}</p>` : ""}
        ${resp.avisoNs ? `<p class="note">Você usou bastante o “não sei” nesta sessão. Ele ajuda quando você realmente não sabe; quando tiver uma ideia, arrisque: errar também ensina. A partir de agora, o “não sei” pesa pela metade.</p>` : ""}
        <div class="ia-row">${!certo ? btnTeoria(at.h, "erros") : ""}<button class="btn" type="button" data-ia="proxima">${k < n ? "Próxima questão" : "Ver como foi"}</button></div></div>`;
    }
    const relogio = se.relogio ? `<span class="ia-relogio" id="ia-relogio">0:00</span>` : "";
    return `<div class="ia-prog"><span>${esc(se.rotulo || NOME[se.trilha])} · questão <b>${k}</b> de ${n}</span><span class="ia-bar"><i style="width:${Math.round(100 * (k - 1) / n)}%"></i></span>${relogio}
        <button class="ia-mini" type="button" data-ia="relogio">${se.relogio ? "Desligar" : "Ligar"} cronômetro</button></div>
      ${antes}
      <article class="q"><div class="q-h"><b>${esc(tipoTxt)}</b><span class="q-r"><small class="ia-motivo">${esc(at.motivo || "")}</small></span></div>
        ${corpoQuestao(q, opcoes(q, resp))}${dica}${fb}</article>
      ${resp ? "" : `<div class="ia-row ia-nav"><button class="btn" type="button" data-ia="responder" ${marcada == null ? "disabled" : ""}>Responder</button>
        ${TR[se.trilha].naoSei ? `<button class="btn ghost" type="button" data-ia="naoSei">Não sei</button>` : ""}
        <button class="ia-mini" type="button" data-ia="sair">Sair da sessão</button></div>`}`;
  }
  function telaFimSessao() {
    const s = st(), se = s.sessao, ac = se.resp.filter(r => r.r === 1).length, sug = sugestao();
    const mov = Object.keys(se.antes).map(h => {
      const a = se.antes[h], d = se.depois[h], sobe = ORD[d] > ORD[a], desce = ORD[d] < ORD[a];
      return `<li class="${sobe ? "ia-up" : ""}">${esc(h)} · ${esc(HAB[h].curto)}: ${sobe ? `subiu ${pill(a)} → ${pill(d)}` : desce ? `voltou ${pill(a)} → ${pill(d)} (vamos reforçar)` : `ficou em ${pill(d)}`}</li>`;
    }).join("");
    const subiu = Object.keys(se.antes).some(h => ORD[se.depois[h]] > ORD[se.antes[h]]);
    return `<div class="ia-card"><h2>${subiu ? "Você avançou!" : "Sessão concluída"}</h2>
        <p>Você acertou <b>${ac} de ${se.resp.length}</b> questões.</p>
        <ul class="ia-list">${mov}</ul>
        <p>${subiu ? "Cada subida conta: ela muda as questões que a IA escolhe para você." : "O mapa se ajusta a cada resposta. Seguir praticando é o que faz as habilidades subirem."}${sug ? ` Para amanhã, a sugestão é <b>${NOME[sug.t]}</b>.` : ""}</p>
        <div class="ia-row"><button class="btn" type="button" data-ia="hoje">Voltar para Hoje</button></div></div>`;
  }

  // Questões oficiais do ENEM são imagens guardadas em enem/of/aN.json (como nas listas do app).
  const OFI = {}, OFP = {};
  function preencherOficiais(aula) {
    const els = [...document.querySelectorAll("#view-ia img.ofi[data-k]")]; if (!els.length || aula == null) return;
    const put = m => els.forEach(el => { const u = m && m[el.dataset.k]; el.classList.remove("load"); if (u) { if (el.getAttribute("src") !== u) el.src = u; } else el.classList.add("miss"); });
    if (OFI[aula]) return put(OFI[aula]);
    els.forEach(el => el.classList.add("load"));
    if (!OFP[aula]) OFP[aula] = fetch("of/a" + aula + ".json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(m => (OFI[aula] = m)).catch(() => { delete OFP[aula]; return null; });
    OFP[aula].then(put);
  }
  function render() {
    const v = document.getElementById("view-ia"); if (!v) return;
    if (erro) { v.innerHTML = `<div class="ia-card"><p>${esc(erro)}</p></div>`; return; }
    if (!pronto) { v.innerHTML = `<div class="ia-card"><p>Carregando a IA…</p></div>`; return; }
    const s = st();
    let html;
    if (!s.serie) html = telaSerie();
    else if (resumoAberto && BIB[resumoAberto.h]) html = telaResumo();
    else if (telaBiblio && s.diag && s.diag.fim) html = telaBiblioteca();
    else if (s.diag && s.diag.fim) {
      if (s.sessao && !s.sessao.fim && s.sessao.atual) html = telaSessao();
      else if (s.sessao && s.sessao.fim && !s.sessao.visto) html = telaFimSessao();
      else html = telaConteudos ? telaEscolha() : verMapa || !s.diag.mapaVisto ? telaResultado() : telaHoje();
    }
    else if (s.diag && s.diag.atual && s.diag.emCurso) html = telaDiag();
    else html = telaConvite();
    v.innerHTML = `<div class="ia-wrap">${html}</div>`;
    const at = resumoAberto ? (BIB[resumoAberto.h] && BIB[resumoAberto.h].exemplo) : (s.sessao && !s.sessao.fim && s.sessao.atual) || (s.diag && !s.diag.fim && s.diag.emCurso && s.diag.atual);
    if (at && M.itens[at.id]) preencherOficiais(M.itens[at.id].aula);
    if (resumoAberto && resumoAberto.foco && !resumoAberto.rolou) { resumoAberto.rolou = true; const el = document.getElementById("ia-sec-" + resumoAberto.foco); if (el) el.scrollIntoView({ block: "start" }); }
  }
  const convite = () => pronto && SR.logado() && !(SR.S.ia && SR.S.ia.diag && SR.S.ia.diag.fim);

  document.addEventListener("click", ev => {
    const no = ev.target.closest("[data-ia-no]"); if (no) { selecionarNo(no.dataset.iaNo); return; }
    const bp = ev.target.closest("button[data-ia-praticar], button[data-ia-ler]");
    if (bp) { const h = bp.dataset.iaPraticar || bp.dataset.iaLer; SR.S.tab = "ia"; telaConteudos = false; telaBiblio = false; verMapa = false;
      if (bp.dataset.iaPraticar) { resumoAberto = null; comecarSessao("livre", false, [h], h + " · " + HAB[h].curto); } else resumoAberto = { h, completo: false, foco: "" };
      SR.renderAll(); window.scrollTo({ top: 0 }); return; }
    const br = ev.target.closest("#view-id button[data-iar]");
    if (br) { const s = st();
      if (br.dataset.iar === "meta") { const v = +((document.getElementById("ia-meta") || {}).value || 0); s.meta = v >= 400 && v <= 950 ? Math.round(v) : null; salvar(); SR.renderAll(); }
      if (br.dataset.iar === "imprimir") { document.body.classList.add("ia-imprimir-rel"); window.print(); setTimeout(() => document.body.classList.remove("ia-imprimir-rel"), 500); }
      return; }
    const bl = ev.target.closest("button[data-ia-lista]");
    if (bl) { const s = st(), n = +bl.dataset.iaAula; s.listaTurma = s.listaTurma || {}; s.nivel = s.nivel || {};
      if (bl.dataset.iaLista === "turma") { s.listaTurma[n] = 1; delete SR.S.sets[n]; delete s.nivel[n]; }
      else { delete s.listaTurma[n]; delete SR.S.sets[n]; }
      salvar(); SR.renderAll(); return; }
    const b = ev.target.closest("#view-ia button"); if (!b || b.disabled) return;
    const s = st(); const topo = () => window.scrollTo({ top: 0 });
    if (b.dataset.iaSerie) { s.serie = b.dataset.iaSerie; salvar(); SR.renderAll(); return; }
    if (b.dataset.iao != null) { if (!(s.sessao && s.sessao.respondida && !s.sessao.fim)) { marcada = +b.dataset.iao; render(); } return; }
    if (b.dataset.iaLivre) { telaConteudos = false; verMapa = false; s.diag.mapaVisto = true; comecarSessao("livre", !!b.dataset.iaCurta, b.dataset.iaLivre.split(","), b.dataset.iaRot); render(); topo(); return; }
    if (b.dataset.iaResumo) { resumoAberto = { h: b.dataset.iaResumo, completo: false, foco: b.dataset.iaFoco || "" }; render(); if (!resumoAberto.foco) topo(); return; }
    if (b.dataset.iaModo) { modoConteudos = b.dataset.iaModo; render(); return; }
    if (b.dataset.iaJavi) { s.naoVistas = s.naoVistas.filter(h => h !== b.dataset.iaJavi); salvar(); render(); return; }
    if (b.dataset.iaTrilha) { telaConteudos = false; verMapa = false; s.diag.mapaVisto = true; comecarSessao(b.dataset.iaTrilha, !!b.dataset.iaCurta); render(); topo(); return; }
    const a = b.dataset.ia;
    if (a === "comecar") { comecarDiag(); SR.renderAll(); topo(); }
    else if (a === "continuar") { s.diag.emCurso = true; salvar(); SR.renderAll(); topo(); }
    else if (a === "trocaSerie") { s.serie = null; salvar(); SR.renderAll(); }
    else if (a === "confirmar" && marcada != null) responderDiag(marcada);
    else if (a === "naoVi") responderDiag("nv");
    else if (a === "refazer") { s.diag = null; s.aluno = {}; s.naoVistas = []; s.sessao = null; s.sessoes = []; verMapa = false; salvar(); SR.renderAll(); }
    else if (a === "responder" && marcada != null) responderSessao(marcada);
    else if (a === "naoSei") responderSessao("ns");
    else if (a === "dica") { dicaAberta = true; render(); }
    else if (a === "proxima") { s.sessao.i++; avancar(); render(); topo(); }
    else if (a === "relogio") { s.sessao.relogio = !s.sessao.relogio; salvar(); render(); }
    else if (a === "sair") { terminarSessao(); render(); topo(); }
    else if (a === "hoje") { verMapa = false; telaConteudos = false; telaBiblio = false; s.diag.mapaVisto = true; if (s.sessao && s.sessao.fim) s.sessao.visto = true; salvar(); render(); topo(); }
    else if (a === "mapa") { verMapa = true; telaConteudos = false; render(); topo(); }
    else if (a === "resumoCompleto") { resumoAberto.completo = true; render(); }
    else if (a === "fecharResumo") { resumoAberto = null; render(); topo(); }
    else if (a === "biblioteca") { telaBiblio = true; telaConteudos = false; verMapa = false; render(); topo(); }
    else if (a === "imprimir") { document.body.classList.add("ia-imprimir"); window.print(); setTimeout(() => document.body.classList.remove("ia-imprimir"), 500); }
    else if (a === "conteudos") { telaConteudos = true; verMapa = false; render(); topo(); }
  });
  document.addEventListener("keydown", ev => { const no = ev.target.closest && ev.target.closest("[data-ia-no]"); if (no && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); selecionarNo(no.dataset.iaNo); } });
  document.addEventListener("input", ev => {
    if (ev.target.id !== "ia-busca") return;
    const t = ev.target.value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    document.querySelectorAll("#view-ia .ia-bib").forEach(el => { el.hidden = !!t && !el.dataset.iaTexto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(t); });
  });
  // cronômetro opcional (ligado por padrão só no Aprimoramento)
  tique = setInterval(() => {
    const el = document.getElementById("ia-relogio"); if (!el || !inicioQ) return;
    const sg = Math.floor((Date.now() - inicioQ) / 1000); el.textContent = Math.floor(sg / 60) + ":" + String(sg % 60).padStart(2, "0");
  }, 1000);

  const css = document.createElement("style");
  css.textContent = `
  .ia-wrap{max-width:860px;margin:0 auto;padding:4px 0 40px;font-family:var(--f-ui)}
  .ia-card{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:18px 20px;margin:0 0 16px}
  .ia-card h2{font-family:var(--f-display);margin:0 0 8px}
  .ia-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:center}
  .ia-quote{margin:8px 0 12px;padding:10px 14px;border-left:4px solid var(--pen);background:var(--pen-soft);border-radius:6px;font-family:var(--f-body)}
  .ia-list{margin:0;padding-left:20px;line-height:1.7}
  .ia-prog{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0 0 12px;color:var(--ink-2)}
  .ia-bar{flex:1;min-width:80px;height:6px;background:var(--rule);border-radius:99px;overflow:hidden}.ia-bar i{display:block;height:100%;background:var(--pen)}
  .ia-relogio{font-family:var(--f-mono);font-weight:600;color:var(--ink)}
  .ia-mini{background:none;border:0;color:var(--pen);font:600 13px var(--f-ui);cursor:pointer;padding:4px;text-decoration:underline}
  .ia-nav{margin:14px 0 6px}
  .ia-h3{font-family:var(--f-display);margin:22px 0 10px}
  .ia-eixos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  .ia-eixo{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:6px}
  .ia-eixo small{color:var(--ink-2)}
  .ia-pill{display:inline-block;align-self:flex-start;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;margin:0 2px}
  .ia-recuperacao{background:var(--bad-soft);color:var(--bad)}.ia-fixacao{background:var(--mark-soft);color:var(--mark)}
  .ia-aprimoramento{background:var(--ok-soft);color:var(--ok)}.ia-introducao,.ia-adiantar,.ia-a_diagnosticar{background:var(--pen-soft);color:var(--pen)}
  .ia-def{background:var(--sheet);border:1px solid var(--rule);border-left:4px solid var(--bad);border-radius:var(--radius);padding:12px 16px;margin:0 0 10px}
  .ia-def p{margin:4px 0}.ia-def-h{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
  .ia-mais summary{cursor:pointer;color:var(--pen);font-weight:700;margin:6px 0 10px}
  .ia-trilhas{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .ia-trilha{background:var(--sheet);border:1px solid var(--rule);border-top:4px solid var(--pen);border-radius:var(--radius);padding:12px 14px}
  .ia-t-recuperacao{border-top-color:var(--bad)}.ia-t-fixacao{border-top-color:var(--mark)}.ia-t-aprimoramento{border-top-color:var(--ok)}
  .ia-sug{box-shadow:0 0 0 2px var(--pen)}
  .ia-selo{display:inline-block;margin:0 0 4px;padding:2px 10px;border-radius:99px;background:var(--pen);color:#fff;font-size:12px;font-weight:700}
  .ia-trilha h4{margin:0}.ia-trilha ul{margin:6px 0 8px;padding-left:18px;font-size:13px;line-height:1.5}
  .ia-escolher{margin-top:16px;border-style:dashed}.ia-escolher h4{margin:0 0 4px}
  .ia-cont{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:12px 14px;margin:0 0 10px}
  .ia-cont p{margin:2px 0}.ia-cont .ia-row{margin-top:8px}
  .ia-habs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ia-hab{font-size:13px;color:var(--ink-2)}
  .ia-h4{font-family:var(--f-display);margin:18px 0 8px}
  .ia-lista{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:12px;padding:8px 12px;border-radius:8px;background:var(--pen-soft);font:14px var(--f-ui)}
  .ia-resumo{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:18px 20px}
  .ia-resumo h2{font-family:var(--f-display);margin:4px 0 6px}
  .ia-sec{border-top:1px solid var(--rule);padding-top:10px;margin-top:12px}.ia-sec h3{font-family:var(--f-display);font-size:17px;margin:0 0 6px}
  .ia-sec ul,.ia-sec ol{padding-left:22px;line-height:1.6;margin:4px 0}
  .ia-forms{display:grid;gap:10px}.ia-form{background:var(--pen-soft);border-radius:8px;padding:10px 14px}.ia-form p{margin:6px 0 0;font-size:14px}
  .ia-mat{font-size:1.35em;overflow-x:auto}.ia-mat math{font-size:1em;math-style:normal}
  .ia-rasc{display:inline-block;margin:0 0 6px;padding:3px 10px;border-radius:99px;background:var(--mark-soft);color:var(--mark);font-size:12px;font-weight:700}
  .ia-busca{width:100%;box-sizing:border-box;margin-top:8px;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;font:15px var(--f-ui);background:var(--sheet);color:var(--ink)}
  .ia-ex{margin:6px 0}
  .ia-base{display:grid;gap:10px}.ia-bloco{border:1px solid var(--rule);border-radius:8px;padding:10px 14px}.ia-bloco h4{margin:0 0 4px;font-size:15px}.ia-bloco p{margin:4px 0}
  .ia-exm{background:var(--pen-soft);border-radius:6px;padding:6px 10px;margin:6px 0 0;font-size:14px}
  .ia-passos{padding-left:22px}.ia-passos li{margin:0 0 10px;line-height:1.55}
  .ia-check{list-style:none;padding-left:0}.ia-check li{padding-left:26px;position:relative;margin:4px 0}.ia-check li::before{content:"☐";position:absolute;left:4px;color:var(--pen)}
  @media print{body.ia-imprimir *{visibility:hidden}body.ia-imprimir .ia-resumo,body.ia-imprimir .ia-resumo *{visibility:visible}
    body.ia-imprimir .ia-resumo{position:absolute;left:0;top:0;width:100%;border:0}body.ia-imprimir .ia-noprint{display:none}}
  .ia-relat{margin:0 0 18px;font-family:var(--f-ui)}.ia-relat h2{font-family:var(--f-display);margin:0 0 4px}
  .ia-frase{font-size:17px;line-height:1.5;margin:12px 0 4px}
  .ia-meta{width:90px;padding:6px 8px;border:1px solid var(--rule);border-radius:6px;font:15px var(--f-ui);background:var(--sheet);color:var(--ink)}
  .ia-mapa{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .ia-mh{border:1px solid var(--rule);border-left:4px solid var(--pen);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;font-size:13px}
  .ia-mh small{color:var(--ink-2)}.ia-mh-recuperacao{border-left-color:var(--bad)}.ia-mh-fixacao{border-left-color:var(--mark)}.ia-mh-aprimoramento{border-left-color:var(--ok)}
  .ia-barras div{display:grid;grid-template-columns:minmax(120px,190px) 1fr 30px;gap:8px;align-items:center;margin:4px 0;font-size:14px}
  .ia-barras i{display:block;height:10px;border-radius:99px;background:var(--pen)}.ia-barras b{text-align:right}
  .ia-spark{width:100%;max-width:340px;height:auto;color:var(--pen);fill:var(--pen)}
  .ia-prof{margin-top:16px}.ia-prof summary{cursor:pointer;font-weight:700;color:var(--pen)}
  .ia-tab{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}.ia-tab th,.ia-tab td{border-bottom:1px solid var(--rule);padding:4px 6px;text-align:left}
  @media print{body.ia-imprimir-rel *{visibility:hidden}body.ia-imprimir-rel .ia-relat,body.ia-imprimir-rel .ia-relat *{visibility:visible}
    body.ia-imprimir-rel .ia-relat{position:absolute;left:0;top:0;width:100%;border:0}body.ia-imprimir-rel .ia-noprint{display:none}body.ia-imprimir-rel .ia-prof{display:none}}
  .ia-arv-wrap{overflow-x:auto}.ia-arv{width:100%;max-width:520px;display:block;margin:6px auto}
  .ia-ar{fill:none;stroke:var(--rule);stroke-width:1.5}.ia-ar-on{stroke:var(--pen);stroke-width:2.5}.ia-ar-off{opacity:.25}
  .ia-no{cursor:pointer}.ia-no rect{fill:var(--sheet);stroke:var(--pen);stroke-width:1.5}.ia-no text{font:700 13px var(--f-ui);fill:var(--ink)}
  .ia-no-recuperacao rect{fill:var(--bad-soft);stroke:var(--bad)}.ia-no-fixacao rect{fill:var(--mark-soft);stroke:var(--mark)}
  .ia-no-aprimoramento rect{fill:var(--ok-soft);stroke:var(--ok)}.ia-no-introducao rect{fill:var(--pen-soft);stroke:var(--pen)}
  .ia-no-sel rect{stroke-width:3.5}.ia-no-off{opacity:.3}.ia-no:focus{outline:none}.ia-no:focus rect{stroke-width:3.5}
  .ia-leg,.ia-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
  .ia-chip{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12.5px;font-weight:600}
  .ia-det{border:1px solid var(--rule);border-radius:var(--radius);padding:12px 16px;margin-top:8px}.ia-det h4{margin:12px 0 4px}.ia-det p{margin:4px 0}
  .ia-motivo{color:var(--ink-2);font-weight:400}
  .ia-antes,.ia-dica{background:var(--pen-soft);border-radius:8px;padding:10px 14px;margin:0 0 12px}
  .ia-antes summary{cursor:pointer;font-weight:700;color:var(--pen)}
  .ia-dica{margin:12px 0 0}
  .ia-fbk{margin-top:14px;padding:12px 14px;border-radius:8px;border:1px solid var(--rule)}
  .ia-fbk.ok{background:var(--ok-soft)}.ia-fbk.no{background:var(--bad-soft)}
  .ia-fbk p{margin:6px 0}
  .ia-sobe{animation:iaPulse 1.2s ease 2}
  .ia-up{font-weight:700}
  @keyframes iaPulse{50%{transform:scale(1.03)}}
  @media (prefers-reduced-motion:reduce){.ia-sobe{animation:none}}`;
  document.head.appendChild(css);

  window.IA = { render, convite, nivelar, rotuloLista, registrarLista, relatorioHTML };
  carregar();
})();
