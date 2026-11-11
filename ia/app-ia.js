/* Santa Revisão · IA adaptativa dentro dos apps do ENEM e do PAS
   Fase 2: série, diagnose e tela de resultado (spec, etapa 3).
   Fase 3: tela "Hoje", trilhas e sessão do dia (spec, etapa 5).
   Usa o motor (ia/motor.js), o banco (ia/banco.js) e o estado do aluno do próprio app (S.ia),
   que é salvo junto com o progresso e vai no código de progresso. Nada sai do aparelho. */
(function () {
  "use strict";
  const SR = window.SR;
  if (!SR || !window.Motor || !window.Banco) return;
  const L = "ABCDE", esc = SR.esc, DIA = 864e5;
  // Mesmo motor e mesma tela para o ENEM e para o PAS/UnB. No PAS: 3 etapas, itens A (certo/errado), B (numérico) e C;
  // escala do relatório em % de domínio (não há TRI oficial); diagnose da etapa do aluno (2 itens) e das anteriores (1 item).
  const PAS = SR.exame === "pas", DIR = PAS ? "../ia/pas/" : "../ia/";
  const PROVA = PAS ? "PAS" : "ENEM";
  const CE = ["C", "E"];
  const letra = (q, j) => q.tp === "A" ? CE[j] : L[j];
  const gabTxt = q => q.tp === "B" ? String(q.a).padStart(3, "0") : q.tp === "A" ? (q.a ? "E (errado)" : "C (certo)") : L[q.a];
  const acerto = (q, v) => q.tp === "B" ? v !== "" && v != null && +v === q.a : v === q.a;
  const sigla = h => HAB[h] && HAB[h].sigla || h;
  const NOME = { recuperacao: "Recuperação", fixacao: "Fixação", aprimoramento: "Aprimoramento", introducao: "Introdução", fora: "Próximas etapas", adiantar: "Adiantar", livre: "Conteúdo escolhido", a_diagnosticar: "A diagnosticar" };
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
  let AREA_URL = null, APOIO = {};
  let H = null, M = null, MD = null, HAB = {}, AULA = {}, pronto = false, erro = "";
  let AULAHABS = {}, telaConteudos = false, modoConteudos = "tema";
  let BIB = {}, resumoAberto = null, telaBiblio = false, ERROS = null, ADAPT = {}, SSO = null;
  // ---------- área adaptada (proposta de 11/11) ----------
  // Quem está no grupo da escola abre o mesmo app com apoios. Até o login Microsoft existir,
  // o site de teste simula o grupo (?area=adaptada / ?area=padrao ou o botão no relatório).
  const AMB_TESTE = /teste|-lab\b|localhost|127\.0\.0\.1/.test(location.hostname);
  const adaptada = () => !!(SR.S.ia && SR.S.ia.adaptada);
  // Apoio ampliado (nível 2 da área adaptada): uma coisa por tela, sessões de 4 questões com pausas, menos texto e menos estímulo.
  const ampliado = () => adaptada() && SR.S.ia.apoio === 2;
  const AREA_NOME = () => ampliado() ? "área adaptada · apoio ampliado" : adaptada() ? "área adaptada" : "área padrão";
  function defineArea(a) { const x = st(); if (a === "ampliada") { x.adaptada = true; x.apoio = 2; } else if (a === "adaptada") { x.adaptada = true; delete x.apoio; } else { delete x.adaptada; delete x.apoio; } }
  const ehTexto = q => !q.pdf && !/class="ofi pdf"/.test((q.t || []).join(" "));
  const versao = it => (adaptada() && ADAPT[it.id]) || it.q;   // versão adaptada aprovada, se houver
  let riscadas = new Set(), modoRiscar = false;
  let marcada = null, inicioQ = 0, qAtualId = null, verMapa = false, dicaAberta = false, tique = null;

  const st = () => { const S = SR.S; if (!S.ia) S.ia = { v: 1, serie: null, aluno: {}, naoVistas: [], diag: null }; return S.ia; };
  const salvar = () => SR.persist();
  const fmt = x => String(Math.round(x * 10) / 10).replace(".", ",");
  const pct = p => Math.round(p * 100) + "%";

  async function carregar() {
    try {
      const [h, g] = await Promise.all([
        fetch(DIR + "habilidades.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        PAS ? null : fetch("../ia/questoes-geradas.json").then(r => r.ok ? r.json() : null).catch(() => null),
        PAS ? null : fetch("../ia/biblioteca.json").then(r => r.ok ? r.json() : null).catch(() => null),
        PAS ? null : fetch("../ia/erros.json").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(DIR + "adaptadas.json").then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(DIR + "apoio-aulas.json").then(r => r.ok ? r.json() : null).catch(() => null)
      ]).then(x => { APOIO = {}; Object.entries((x[5] && x[5].aulas) || {}).forEach(([n, v]) => { if (v && (v.aprovado || AMB_TESTE)) APOIO[n] = v; }); (x[2] && x[2].resumos || []).forEach(r => { BIB[r.h] = r; }); ERROS = x[3]; ADAPT = {}; Object.entries((x[4] && x[4].versoes) || {}).forEach(([id, v]) => { if (v && (v.aprovado || AMB_TESTE)) ADAPT[id] = v; /* no site oficial, só versões aprovadas */ }); return x; });
      H = h; H.habilidades.forEach(x => { HAB[x.id] = x; });
      const itens = PAS ? Banco.extrairPAS(SR.D) : Banco.extrair(SR.D).concat(Banco.extrairGeradas(g));
      const CFG = PAS ? { config: { ref: { a: 1.5, b: 1.29, c: 0 } } } : {};   // PAS: chance de resolver de fato um item médio (sem chute)
      M = Motor.criar(Object.assign({ itens, habilidades: H.habilidades, nivelParaB: H.nivelParaB }, CFG));
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
      MD = Motor.criar(Object.assign({ itens: diag, habilidades: H.habilidades, nivelParaB: H.nivelParaB }, CFG));
      pronto = true;
      // Login com a conta Microsoft da escola: quando ativo, o app entra sozinho com o e-mail institucional
      // e a área adaptada vem do papel atribuído pela escola (nunca do aparelho).
      try {
        const r = await fetch("/api/eu", { cache: "no-store", credentials: "same-origin" });
        if (r.ok) { const u = await r.json(); if (u && u.sso && u.email) { SSO = u; if (SR.email() !== u.email) SR.entrarSSO(u.email); defineArea(u.apoio === 2 ? "ampliada" : u.adaptada ? "adaptada" : "padrao"); salvar(); } }
      } catch (e) { /* sem login configurado: segue pelo e-mail digitado */ }
      if (!SSO && AMB_TESTE) AREA_URL = new URLSearchParams(location.search).get("area");   // aplicada quando o aluno estiver logado (ver render)
      // a tela Hoje é a porta de entrada do app: ao abrir, o aluno cai nela (etapa 5)
      if (SR.logado() && SR.S.tab !== "prof") SR.S.tab = "ia";
    } catch (e) { erro = "Não foi possível carregar a IA agora. Verifique a conexão e recarregue a página."; }
    SR.renderAll();
  }

  // ---------- estado das habilidades ----------
  // PAS: só as habilidades da etapa do aluno e das anteriores (e que têm itens no banco)
  const ativa = h => !PAS || (HAB[h] && HAB[h].etapa <= (+st().serie || 3) && (M.porHab[h] || []).length > 0);
  const HABS = () => H.habilidades.filter(h => ativa(h.id));
  const vistas = () => { const nv = new Set(st().naoVistas); return HABS().filter(h => !nv.has(h.id)); };
  function estadoDe(h) {
    if (!ativa(h)) return "fora";
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
    if (PAS) { const e = +st().serie; return { hs: vs.map(h => h.id), q: id => HAB[id].etapa === e ? 2 : 1 }; }   // decisão de 11/11: etapa do aluno e anteriores
    if (vs.length * 2 <= MAXQ) return { hs: vs.map(h => h.id), q: () => 2 };
    return { hs: vs.slice().sort((a, b) => b.peso - a.peso || prioridade(a, b)).slice(0, DIAG_DUPLAS).map(h => h.id), q: () => 2 };
  }
  function limite() { const a = alvoDiag(); return Math.min(PAS ? 60 : MAXQ, a.hs.reduce((x, h) => x + a.q(h), 0)); }
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
      const ad = alvoDiag(), et = +s.serie;
      const ordem = (PAS ? ordemIntercalada(ad.hs.filter(x => HAB[x].etapa === et)).concat(ordemIntercalada(ad.hs.filter(x => HAB[x].etapa !== et))) : ordemIntercalada(ad.hs)).filter(x => !sem.includes(x));
      const h = ordem.find(x => !cont[x]) || ordem.find(x => (cont[x] || 0) < ad.q(x));
      if (!h) return null;
      const cs = MD.escolher(s.aluno, h, ALVO_DIAG, adaptada() ? 30 : 1, Date.now(), usadas);
      const e = adaptada() ? (cs.find(c => ADAPT[c.id] && c.chance >= 0.25 && c.chance <= 0.8) || cs.slice(0, 8).find(c => ehTexto(M.itens[c.id].q)) || cs[0]) : cs[0];
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
      const r = acerto(versao(it), valor) ? 1 : 0;
      M.registrar(s.aluno, { id: at.id, r, ms, ts: Date.now(), longa: adaptada() ? false : it.longa, v: valor, adaptada: adaptada() && !!ADAPT[at.id] });
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
    const hs = HABS().filter(h => estadoDe(h.id) === alvo && (M.porHab[h.id] || []).length);
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
      let c = M.escolher(st().aluno, h, alvoDoSlot(Object.assign({}, sl, { h }), se.trilha), sl.tipo === "facil" || adaptada() ? 40 : 1, Date.now(), usadas);
      if (sl.tipo === "facil") c = c.filter(e => (M.itens[e.id].nv || 3) <= 2).concat(c);
      if (adaptada()) { const al = alvoDoSlot(Object.assign({}, sl, { h }), se.trilha); c = c.filter(e => ADAPT[e.id] && e.chance >= al[0] - 0.15 && e.chance <= al[1] + 0.15).concat(c.slice(0, 8).filter(e => ehTexto(M.itens[e.id].q)), c); }   // prefere versões adaptadas (perto da faixa), depois questões em texto
      c = c.slice(0, 1);
      return c[0] ? Object.assign({ h }, c[0]) : null;
    };
    return tentar(sl.h) || se.slots.map(x => x.h).filter(h => h !== sl.h).map(tentar).find(Boolean) || null;
  }
  function comecarSessao(t, curta, escolhidas, rotulo) {
    const s = st(), slots = montarSlots(t, curta, escolhidas); if (!slots.length) return;
    const antes = {}; [...new Set(slots.map(x => x.h))].forEach(h => { antes[h] = estadoDe(h); });
    s.sessao = { trilha: t, curta: !!curta, inicio: Date.now(), slots, i: 0, resp: [], ns: 0, antes, atual: null, respondida: null, relogio: adaptada() ? false : TR[t].relogio, fim: null, rotulo: rotulo || null };
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
    const r = valor === "ns" ? "ns" : (acerto(versao(it), valor) ? 1 : 0);
    if (r === "ns") se.ns++;
    if (r === 0 && typeof valor === "number" && versao(it).tp !== "B") { s.errosHab = s.errosHab || {}; (s.errosHab[at.h] = s.errosHab[at.h] || []).push({ id: at.id, v: valor }); s.errosHab[at.h] = s.errosHab[at.h].slice(-6); }
    const total = se.resp.length + 1;
    const out = M.registrar(s.aluno, { id: at.id, r, ms, ts: Date.now(), longa: adaptada() ? false : it.longa, sessao: { ns: se.ns, total }, v: typeof valor === "number" ? valor : undefined, adaptada: adaptada() && !!ADAPT[at.id] });
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
    const th = st_ / sw, ep = Math.sqrt(sv) / sw, pts = v => PAS ? Math.round(100 * M.fRef(v)) : Math.round((500 + 100 * v) / 5) * 5;
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
    return `<svg class="ia-spark" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Evolução da estimativa: de ${vs[0]} para ${vs[vs.length - 1]}${PAS ? "%" : " pontos"}">
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
    const W = Math.max(360, 62 * Math.max(...linhas.map(l => l.length)) + 20), DY = 74, x = {};
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
    const feita = SR.S.ia && SR.S.ia.diag && SR.S.ia.diag.fim;
    const nos = H.habilidades.map(h => { const p = pos[h.id], e = feita ? estadoDe(h.id) : "a_diagnosticar";
      return `<g class="ia-no ia-no-${e}${h.id === sel ? " ia-no-sel" : ""}${ativo(h.id) ? "" : " ia-no-off"}" data-ia-no="${h.id}" role="button" tabindex="0" aria-label="${esc(h.id)}, ${esc(h.curto)}, ${NOME[e]}">
        <rect x="${p.x - 27}" y="${p.y - 15}" width="54" height="30" rx="8"/><text x="${p.x}" y="${p.y + 5}" text-anchor="middle">${esc(sigla(h.id))}</text></g>`; }).join("");
    return `<svg class="ia-arv" viewBox="0 0 ${W} ${Ht}"${W > 360 ? ` style="min-width:${Math.round(W * 0.95)}px"` : ""} role="group" aria-label="Árvore de habilidades: as de cima sustentam as de baixo">${arestas}${nos}</svg>`;
  }
  function arvoreDetalhe() {
    const id = arvoreSel; if (!id) return `<p class="note">Toque numa habilidade para ver os seus erros mais frequentes nela e o que uma defasagem pode complicar.</p>`;
    const h = HAB[id], s = st(), feita = s.diag && s.diag.fim, e = feita ? estadoDe(id) : "a_diagnosticar", r = M.resumo(s.aluno, id);
    const minhas = todasRespostas().filter(x => x.h === id && x.r === 0 && M.itens[x.id]);
    const tipos = {}; minhas.forEach(x => { const k = ERROS && Number.isInteger(x.v) ? (ERROS.porQuestao[x.id] || [])[x.v] : null; if (k && k !== "outros") tipos[k] = (tipos[k] || 0) + 1; });
    const ordT = Object.keys(tipos).sort((a, b) => tipos[b] - tipos[a]);
    const coment = minhas.filter(x => Number.isInteger(x.v)).slice(-3).reverse().map(x => { const q = M.itens[x.id].q; return q.e && q.e[x.v] ? `<li>${q.e[x.v]}</li>` : ""; }).join("");
    // erros mais comuns de quem estuda esta habilidade (todo o banco)
    const banco = {}; let tot = 0; (M.porHab[id] || []).forEach(it => ((ERROS && ERROS.porQuestao[it.id]) || []).forEach(k => { if (k && k !== "outros") { banco[k] = (banco[k] || 0) + 1; tot++; } }));
    const ordB = Object.keys(banco).sort((a, b) => banco[b] - banco[a]).slice(0, 3);
    const desc = descendentes(id), diretas = [...desc].filter(([, d]) => d === 1).map(([b]) => b), indiretas = [...desc].filter(([, d]) => d > 1).map(([b]) => b);
    const pesoAfetado = [id, ...desc.keys()].reduce((x, b) => x + HAB[b].peso, 0);
    const lista = ids => ids.map(b => `<span class="ia-chip ia-${feita ? estadoDe(b) : "a_diagnosticar"}">${esc(b)} · ${esc(HAB[b].curto)}</span>`).join("");
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
      ${bases.length ? `<h4>Ela se apoia em</h4><div class="ia-chips">${lista(bases)}</div>${feita && basesRec.length && e !== "aprimoramento" ? `<p>Comece por ${basesRec.map(b => `<b>${esc(b)}</b>`).join(" e ")}: ${basesRec.length === 1 ? "ela está" : "elas estão"} em Recuperação e sustenta${basesRec.length === 1 ? "" : "m"} ${esc(id)}.</p>` : ""}` : ""}
      <div class="ia-row">${feita ? `<button class="btn" type="button" data-ia-praticar="${esc(id)}">Praticar ${esc(id)}</button>` : ""}${BIB[id] ? `<button class="btn ghost" type="button" data-ia-ler="${esc(id)}">Ler o resumo</button>` : ""}</div></div>`;
  }
  function arvoreHTML() {
    return `<div id="ia-arvore"><p class="note">As habilidades de cima sustentam as de baixo. As cores mostram o seu estado em cada uma.</p>
      <div class="ia-leg">${["recuperacao", "fixacao", "aprimoramento", "introducao"].map(e => `<span class="ia-chip ia-${e}">${NOME[e]}</span>`).join("")}</div>
      <div class="ia-arv-wrap">${arvoreSVG()}</div><div id="ia-arv-det">${arvoreDetalhe()}</div></div>`;
  }
  function renderArvore() {
    const v = document.getElementById("view-arv"); if (!v) return;
    if (erro) { v.innerHTML = `<div class="ia-wrap"><div class="ia-card"><p>${esc(erro)}</p></div></div>`; return; }
    if (!pronto) { v.innerHTML = `<div class="ia-wrap"><div class="ia-card"><p>Carregando…</p></div></div>`; return; }
    const feita = SR.S.ia && SR.S.ia.diag && SR.S.ia.diag.fim;
    v.innerHTML = `<div class="ia-wrap"><div class="ia-card"><h2>Árvore de habilidades</h2>
      <p>${PAS ? `As ${H.habilidades.length} habilidades de Matemática do PAS (etapas 1, 2 e 3)` : "As 30 habilidades de Matemática do ENEM"}, ligadas pelas suas consequências: cada uma sustenta as que estão abaixo dela. Toque numa habilidade para ver os seus erros mais frequentes nela e o que uma defasagem pode complicar.</p>
      ${feita ? "" : `<p class="note">As cores aparecem depois da diagnose, na aba <b>Hoje</b>. Até lá, a árvore mostra só as ligações.</p>`}</div>
      <div class="ia-card">${arvoreHTML()}</div></div>`;
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
    const frase = (PAS ? `Seu domínio estimado da Matemática do PAS (etapa ${esc(s.serie)} e anteriores) é de <b>${e.pts}%</b> (faixa provável de ${e.lo}% a ${e.hi}%).` : `Sua estimativa é de <b>${e.pts} pontos</b> (faixa provável de ${e.lo} a ${e.hi}).`) + (s.meta && !PAS ? ` Sua meta é <b>${s.meta}</b>${s.meta > e.pts ? `: faltam ${s.meta - e.pts} pontos` : ": você já está nela"}.` : "") + (cam.length ? ` As habilidades que mais fazem a sua estimativa subir agora são ${cam.map(h => `<b>${esc(h.id)}</b> (${esc(h.curto.toLowerCase())})`).join(", ").replace(/, ([^,]*)$/, " e $1")}.` : ` Nenhuma habilidade está em Recuperação: o ganho agora vem de confirmar a Fixação e subir para o Aprimoramento.`);
    const meta = PAS ? "" : `<div class="ia-row"><label class="note" for="ia-meta">Minha meta de pontos</label><input id="ia-meta" class="ia-meta" type="number" min="400" max="950" step="10" value="${s.meta || ""}" placeholder="${alvo}"><button class="ia-mini" type="button" data-iar="meta">Salvar meta</button></div>`;
    // 2. mapa das 30 habilidades
    const status = h => { const est = (s.aluno.est || {})[h.id]; if (estadoDe(h.id) === "introducao") return "ainda não estudou"; const r = M.resumo(s.aluno, h.id);
      return r.validado ? "confirmada" : r.observacao ? "em observação" : !r.n && est && est.area ? "estimada pela área" : "provisória"; };
    const mapa = `<div class="ia-mapa">${HABS().map(h => { const r = M.resumo(s.aluno, h.id); return `<div class="ia-mh ia-mh-${estadoDe(h.id)}"><b>${esc(h.id)}</b><span>${esc(h.curto)}</span><small>${pill(estadoDe(h.id))} ${r.n} ${r.n === 1 ? "resposta" : "respostas"} · ${status(h)}</small></div>`; }).join("")}</div>`;
    // 3. onde perde mais pontos: erros em questões com boa chance de acerto
    const resp = todasRespostas(), erradas = resp.filter(x => x.r === 0 && M.itens[x.id]);
    const faceis = erradas.filter(x => { const pr = M.params(M.itens[x.id]); return M.p3(M.resumo(s.aluno, x.h).theta, pr.a, pr.b, pr.c) >= 0.6 || (M.itens[x.id].nv || 3) <= 2; });
    const perde = faceis.length ? `<p>Você errou <b>${faceis.length} ${faceis.length === 1 ? "questão" : "questões"}</b> que estavam ao seu alcance (chance de acerto de 60% ou mais). ${PAS ? "No PAS, cada item de certo ou errado marcado errado anula um certo: nesses, vale mais deixar em branco quando não tiver certeza." : "Na TRI, esses erros derrubam mais a nota do que errar as difíceis."}</p>
      <ul>${faceis.slice(-6).reverse().map(x => { const q = M.itens[x.id].q; return `<li><b>${esc(x.h)}</b> · ${esc(q.hab || HAB[x.h].curto)} (${dataBR(x.ts)})${Number.isInteger(x.v) && q.e && q.e[x.v] ? `: você marcou ${letra(q, x.v)}. ${q.e[x.v]}` : ""}</li>`; }).join("")}</ul>`
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
    const projHTML = proj ? `<p>Se ${cam.slice(0, 2).map(nome).join(" e ")} ${cam.length > 1 ? "chegarem" : "chegar"} à Fixação, sua estimativa sobe para cerca de <b>${proj.pts}${PAS ? "%" : " pontos"}</b> (+${proj.pts - e.pts}${PAS ? " pontos percentuais" : ""}).</p>` : "";
    // 7. hábitos
    const comMs = resp.filter(x => x.ms != null && x.r !== "ns"), media = comMs.length ? comMs.reduce((a, x) => a + x.ms, 0) / comMs.length : 0;
    const rapidas = comMs.filter(x => x.ms < 15000 && M.itens[x.id] && M.itens[x.id].longa).length, ns = resp.filter(x => x.r === "ns").length;
    const sem7 = (s.sessoes || []).filter(x => Date.now() - x.ts < 7 * DIA).length, totS = (s.sessoes || []).length;
    const porT = {}; (s.sessoes || []).forEach(x => { porT[x.trilha] = (porT[x.trilha] || 0) + 1; });
    const evita = totS >= 5 && habsDaTrilha("recuperacao").length && (porT.recuperacao || 0) / totS < 0.2 ? `<li>Você fez ${porT.recuperacao || 0} ${(porT.recuperacao || 0) === 1 ? "sessão" : "sessões"} de Recuperação em ${totS}. É nela que estão os pontos mais fáceis de ganhar.</li>` : "";
    const habitos = `<ul>
      ${comMs.length ? `<li>Tempo médio por questão: <b>${(media / 60000).toFixed(1).replace(".", ",")} min</b>${PAS ? "" : " (no ENEM, cerca de 3 min)"}.</li>` : ""}
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
      <table class="ia-tab"><thead><tr><th>Hab.</th><th>Estado</th><th>${PAS ? "Domínio" : "Pontos"}</th><th>± (80%)</th><th>Resp.</th><th>Situação</th><th>Rápidas</th></tr></thead><tbody>
      ${HABS().map(h => { const r = M.resumo(s.aluno, h.id), rp = comMs.filter(x => x.h === h.id && x.ms < 15000 && M.itens[x.id] && M.itens[x.id].longa).length;
        return `<tr><td>${esc(h.id)}</td><td>${NOME[estadoDe(h.id)]}</td><td>${PAS ? (r.n ? Math.round(100 * r.chance) + "%" : "–") : r.pontos || "–"}</td><td>${r.ep != null ? Math.round(128 * r.ep) : "–"}</td><td>${r.n}</td><td>${status(h)}</td><td>${rp || ""}</td></tr>`; }).join("")}</tbody></table>
      <p class="note">${adaptada() ? "<b>Área adaptada: ativa.</b> " : ""}Estimativa geral: θ = ${e.th.toFixed(2)} (média das habilidades ponderada pelo peso na prova). Listas niveladas: ${Object.keys(s.nivel || {}).map(n => `aula ${n} (${s.nivel[n].f}F/${s.nivel[n].m}M/${s.nivel[n].d}D, chance média prevista ${s.nivel[n].ch}%)`).join("; ") || "nenhuma ainda"}.</p></details>`;
    const sec = (n, t, c) => c ? `<section class="ia-sec"><h3>${n}. ${t}</h3>${c}</section>` : "";
    return `<div class="ia-relat ia-card"><h2>Meu relatório</h2><p class="note">Atualizado em ${new Date().toLocaleDateString("pt-BR")}. ${PAS ? "Estimativas em % de domínio (a chance de resolver um item médio do PAS sem chute), calculadas com as suas respostas." : "Estimativas na escala do ENEM, calculadas com as suas respostas."}</p>
      <p class="ia-frase">${frase}</p>${meta}
      ${sec(1, "Plano para a próxima semana", plano.length ? `<ol>${plano.map(x => `<li>${x}</li>`).join("")}</ol>` : "")}
      ${sec(2, "Onde você perde mais pontos", perde)}
      ${sec(3, "Seus tipos de erro mais frequentes", tiposHTML)}
      ${sec(4, "Projeção", projHTML)}
      ${sec(5, "Impacto futuro das defasagens", impacto)}
      ${sec(6, "Seus hábitos de estudo", habitos)}
      ${sec(7, "Evolução", evol)}
      ${sec(8, "Árvore de habilidades", `<p>Veja como as habilidades se sustentam e o que cada defasagem pode complicar.</p><div class="ia-row"><button class="btn ghost" type="button" data-tab="arv">Abrir a árvore de habilidades</button></div>`)}
      ${sec(9, `Mapa das ${HABS().length} habilidades`, mapa)}
      ${prof}
      ${SSO ? `<p class="note ia-noprint">Conectado com a conta da escola (${esc(SSO.email)}). <a href="/auth/sair">Sair da conta</a></p>` : ""}
      ${AMB_TESTE && !SSO ? `<p class="note ia-noprint">Ambiente de teste: <button class="ia-mini" type="button" data-iar="simular">${ampliado() ? "Voltar para a área padrão" : adaptada() ? "Simular o apoio ampliado" : "Simular a área adaptada"}</button> (no site oficial, isso virá do grupo da escola no login Microsoft).</p>` : ""}
      <div class="ia-row ia-noprint"><button class="btn ghost" type="button" data-iar="imprimir">Baixar em PDF / imprimir</button><button class="btn ghost" type="button" data-tab="ia">Ir para Hoje</button></div></div>`;
  }

  // ---------- telas ----------
  const pill = e => `<span class="ia-pill ia-${e}">${esc(NOME[e] || e)}</span>`;
  const btnTeoria = (h, foco) => BIB[h] ? `<button class="btn ghost" type="button" data-ia-resumo="${esc(h)}" data-ia-foco="${foco || ""}">Rever a teoria</button>`
    : AULA[h] ? linkAula(AULA[h], `Rever a teoria (aula ${String(AULA[h]).padStart(2, "0")})`, "btn ghost") : "";
  // ENEM: abre a aula pelo calendário do app; PAS: troca para a etapa da aula e abre o resumo
  const linkAula = (n, txt, cls) => PAS ? `<button class="${cls}" type="button" data-ia-aula="${n}">${txt}</button>` : `<button class="${cls}" type="button" data-calgo="${n}" data-calmode="resumo">${txt}</button>`;

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
      return `<article class="q ia-ex">${corpoQuestao(q, op)}</article><p><b>Resposta: ${gabTxt(q)}.</b> ${r.exemplo.comentario}</p>`; }
    if (k === "erros") return lista(r.erros);
    if (k === "enem") return `<p>${r.enem}</p>`;
    if (k === "lembrar") return lista(r.lembrar);
    if (k === "prereq") { const ds = (HAB[r.h].depende || []); if (!ds.length) return "";
      return `<p>Esta habilidade se apoia em:</p><div class="ia-row">${ds.map(d => BIB[d] ? `<button class="ia-mini" type="button" data-ia-resumo="${esc(d)}">${esc(d)} · ${esc(HAB[d].curto)}</button>` : `<span class="note">${esc(d)} · ${esc(HAB[d].curto)}</span>`).join("")}</div>`; }
    return "";
  }
  // Área adaptada: apoios visuais do resumo (esquema do caminho, figura, decisão, vocabulário, pistas e cartão de bolso).
  function apoioAdaptado(r) { return apoioHTML(r.adaptado, r.h); }
  // Apoio ampliado: o resumo da aula vira uma sequência de partes curtas, uma por tela, com ouvir, voltar e avançar.
  let passoAula = { n: null, i: 0, teoria: false, sol: false };
  function apoioAula(n) {
    const ap = apoioHTML(APOIO[n], "Aula " + String(n).padStart(2, "0"));
    if (!ampliado() || !ap.partes) return ap;
    if (passoAula.n !== n) passoAula = { n, i: 0, teoria: false, sol: false };
    if (passoAula.teoria) return { antes: `<div class="ia-row ia-noprint"><button class="btn" type="button" data-iaap="voltarPartes">Voltar para as partes</button></div>`, depois: "" };
    const res = (SR.aula(n) || {}).res || {}, P = ap.partes;
    const passos = res.ex ? String(res.ex[1]).split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚ0-9])/).filter(Boolean) : [];
    const exemplo = res.ex ? `<p>${res.ex[0]}</p>${passoAula.sol ? `<ol class="ia-passos">${passos.map(x => `<li>${x}</li>`).join("")}</ol>` : `<button class="btn ghost" type="button" data-iaap="sol">Mostrar a resolução, passo a passo</button>`}` : "";
    const cards = [
      ["Plano desta aula", `<p>Você vai ver <b>6 partes</b>, uma de cada vez. Pode ouvir cada parte, voltar e ir com calma.</p><ol class="ia-agenda"><li>Palavras importantes</li><li>Veja a ideia</li><li>O caminho</li><li>Como decidir</li><li>Exemplo resolvido</li><li>Cartão de bolso</li></ol>`],
      ["Palavras importantes", P.palavras], ["Veja a ideia", P.figura], ["O caminho", P.esquema], ["Como decidir", P.decisao], ["Exemplo resolvido", exemplo],
      ["Cartão de bolso", P.cartao + `<p class="ia-fim">Pronto! Agora você pode praticar.</p><div class="ia-row"><button class="btn" type="button" data-mode="lista">Ir para as questões</button></div>`]
    ].filter(c => c[1]);
    const i = Math.max(0, Math.min(passoAula.i, cards.length - 1)), [t, c] = cards[i];
    return { inteiro: `${APOIO[n].aprovado === false ? `<p class="ia-rasc">Apoios da área adaptada em revisão pelo professor · só aparecem no site de teste</p>` : ""}
      <div class="ia-pontos" aria-hidden="true">${cards.map((_, k) => `<span class="${k === i ? "on" : k < i ? "ok" : ""}"></span>`).join("")}</div>
      <p class="note">Parte ${i + 1} de ${cards.length}</p>
      <section class="ia-parte" aria-live="polite"><h3>${t}</h3>${c}</section>
      <div class="ia-row ia-noprint ia-parte-nav">${i > 0 ? `<button class="btn ghost" type="button" data-iaap="ant">← Voltar</button>` : ""}
        <button class="ia-mini" type="button" data-iaap="ouvir">🔊 Ouvir esta parte</button>
        ${i < cards.length - 1 ? `<button class="btn" type="button" data-iaap="prox">Próxima →</button>` : ""}</div>
      <p class="ia-noprint"><button class="ia-mini" type="button" data-iaap="teoria">Ver a teoria completa</button></p>` };
  }
  function falar(texto, bt, rotulo) {
    if (!window.speechSynthesis) return;
    const volta = () => { if (bt) { bt.textContent = rotulo; bt.setAttribute("aria-pressed", "false"); } };
    if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); volta(); return; }
    const u = new SpeechSynthesisUtterance(texto); u.lang = "pt-BR"; u.rate = 0.9; u.onend = u.onerror = volta; speechSynthesis.speak(u);
    if (bt) { bt.textContent = "⏹ Parar a leitura"; bt.setAttribute("aria-pressed", "true"); }
  }
  function apoioHTML(a, rot) {
    if (!adaptada() || !a) return { antes: "", depois: "" };
    const sec = (id, t, c) => c ? `<section class="ia-sec ia-apoio" id="ia-sec-${id}"><h3>${t}</h3>${c}</section>` : "";
    const esquema = (a.esquema || []).length ? `<ol class="ia-fluxo">${a.esquema.map((p, i) => `<li><span class="ia-fluxo-ic" aria-hidden="true">${p.ic}</span><div><b>${i + 1}. ${p.t}</b><p>${p.txt}</p></div></li>`).join("")}</ol>` : "";
    const figura = a.figura ? `<figure class="ia-fig"><div class="ia-fig-rola" tabindex="0" aria-label="Figura (role para o lado)">${a.figura}</div><p class="ia-fig-dica">↔ Arraste a figura para o lado para ver tudo.</p>${a.legenda ? `<figcaption>${a.legenda}</figcaption>` : ""}</figure>` : "";
    const d = a.decisao, decisao = d ? `<div class="ia-dec"><p class="ia-dec-q">${d.pergunta}</p><div class="ia-dec-r"><div><b>${d.sim.t}</b><p>${d.sim.r}</p></div><div><b>${d.nao.t}</b><p>${d.nao.r}</p></div></div></div>` : "";
    const palavras = (a.palavras || []).length ? `<dl class="ia-gloss">${a.palavras.map(w => `<div><dt>${w.termo}</dt><dd>${w.sig}</dd></div>`).join("")}</dl>` : "";
    const pistas = (a.pistas || []).length ? `<ul class="ia-pistas">${a.pistas.map(x => `<li><span>${x.frase}</span><span aria-hidden="true">→</span><span>${x.indica}</span></li>`).join("")}</ul>` : "";
    const cartao = (a.cartao || []).length ? `<div class="ia-cartao"><b>Cartão de bolso · ${esc(rot)}</b><ul>${a.cartao.map(x => `<li>${x}</li>`).join("")}</ul></div>` : "";
    const partes = { esquema, figura, decisao, palavras, pistas, cartao };
    return { partes, antes: (a.aprovado !== false ? "" : `<p class="ia-rasc">Apoios da área adaptada em revisão pelo professor · só aparecem no site de teste</p>`) + sec("caminho", `O caminho em ${(a.esquema || []).length} passos`, esquema) + sec("figura", "Veja a ideia", figura) + sec("decidir", "Como decidir", decisao) + sec("palavras", "Palavras importantes", palavras),
      depois: sec("pistas", "Pistas no enunciado", pistas) + sec("cartao", "Para levar com você", cartao) };
  }
  function telaResumo() {
    const { h, completo, foco } = resumoAberto, r = BIB[h], e = estadoDe(h), mostra = completo ? PROF.introducao : (PROF[e] || PROF.introducao).concat(foco && !(PROF[e] || []).includes(foco) ? [foco] : []);
    const corpo = SECOES.filter(([k]) => mostra.includes(k) && !(k === "passos" && (r.passosDetalhados || []).length && mostra.includes("detalhado"))).map(([k, t]) => { const c = secaoHTML(r, k); return c ? `<section class="ia-sec" id="ia-sec-${k}"><h3>${t}</h3>${c}</section>` : ""; }).join(""), ap = apoioAdaptado(r);
    return `<div class="ia-resumo">
      ${r.aprovado ? "" : `<p class="ia-rasc">Rascunho em revisão pelo professor · só aparece no site de teste</p>`}
      <p class="note">${esc(h)} · ${esc(HAB[h].nome)} · ${esc(r.serie || "")}</p>
      <h2>${esc(r.topico)}</h2>
      <p>${pill(e)} ${completo || e === "introducao" ? "Resumo completo" : `Versão para quem está em ${NOME[e]}`}</p>
      ${ap.antes}${corpo}${ap.depois}
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
  // Apoio de leitura (área adaptada): parágrafos sem marcação viram partes numeradas e os números ficam em destaque.
  // número inteiro (com separador de milhar por espaço ou ponto), decimal com vírgula e % ficam juntos, sem quebrar a linha
  const destaca = t => t.replace(/\d{1,3}(?:[ \u00a0.]\d{3})+(?:,\d+)?(?:\s?%)?|\d+(?:,\d+)?(?:\s?%)?/g, m => "<b>" + m.replace(/ /g, "\u00a0") + "</b>");
  function segmenta(ps) {
    const partes = []; ps.forEach(p => { if (/[<>]/.test(p)) { partes.push(p); return; } p.split(/(?<=[.!?;:])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9“"(])/).forEach(x => { if (x.trim()) partes.push(destaca(x.trim())); }); });
    return partes.length > 1 ? `<ol class="ia-partes">${partes.map(x => `<li>${x}</li>`).join("")}</ol>` : partes.map(x => `<p>${x}</p>`).join("");
  }
  function corpoQuestao(q, opts) { // enunciados e alternativas são conteúdo do próprio banco do app, renderizados como nas listas
    if (adaptada() && ehTexto(q)) {
      const tb = q.tb ? `<div class="tbl"><table><thead><tr>${q.tb[0].map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${q.tb.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
      const fig = q.f && SR.D.figs && SR.D.figs[q.f] ? `<div class="fig"><img src="${SR.D.figs[q.f]}" alt="Figura da questão"></div>` : "";
      const dados = Array.isArray(q.dados) && q.dados.length ? `<div class="ia-dados"><b>Dados da questão</b><ul>${q.dados.map(d => `<li>${destaca(esc(d))}</li>`).join("")}</ul></div>` : "";
      return `<div class="txt">${segmenta(q.t || [])}</div>${dados}${tb}${fig}${q.c ? `<div class="ia-pede"><b>O que a questão pede:</b> ${q.c}</div>` : ""}<div class="opts">${opts}</div>`;
    }
    const tb = q.tb ? `<div class="tbl"><table><thead><tr>${q.tb[0].map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${q.tb.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    const fig = q.f && SR.D.figs && SR.D.figs[q.f] ? `<div class="fig"><img src="${SR.D.figs[q.f]}" alt="Figura da questão"></div>` : "";
    return `<div class="txt">${(q.t || []).map(t => `<p>${t}</p>`).join("")}</div>${tb}${fig}${q.c ? `<p class="cmd">${q.c}</p>` : ""}<div class="opts${q.pdf ? " pdfo" : ""}">${opts}</div>`;
  }
  const ouvir = `<button class="ia-mini" type="button" data-ia="ouvir">🔊 Ouvir a questão</button>`;
  const opcoes = (q, resp) => q.tp === "B" ? numerica(q, resp) : `${q.tp === "A" && !resp ? `<p class="note ia-ce">No PAS, item errado anula um certo: na prova, em dúvida, deixe em branco.</p>` : ""}` + q.o.map((o, j) => {
    let c = riscadas.has(j) && !resp ? " is-riscada" : ""; if (resp) { if (j === q.a) c = " is-right"; else if (j === resp.valor) c = " is-wrong"; }
    return `<button class="opt${c}" type="button" data-iao="${j}" aria-pressed="${(resp ? resp.valor : marcada) === j}" ${resp ? "disabled" : ""}><span class="bub">${letra(q, j)}</span><span>${SR.optT(q, j, o)}</span></button>`;
  }).join("");
  // PAS tipo B: resposta numérica de 000 a 999
  function numerica(q, resp) {
    const v = resp ? (resp.valor === "ns" ? "" : String(resp.valor)) : (marcada == null ? "" : String(marcada));
    return `<div class="ia-bnum"><label for="ia-bin">Sua resposta (de 000 a 999)</label>
      <input id="ia-bin" class="ia-bin${resp ? (resp.r === 1 ? " is-right" : " is-wrong") : ""}" data-iab="1" inputmode="numeric" maxlength="3" autocomplete="off" value="${esc(v)}" placeholder="000" ${resp ? "disabled" : ""}></div>`;
  }
  const marcaTempo = id => { if (qAtualId !== id) { qAtualId = id; inicioQ = Date.now(); riscadas = new Set(); modoRiscar = false; if (!st().sessao || !st().sessao.respondida) marcada = null; } };
  const riscarBtn = () => `<button class="ia-mini" type="button" data-ia="riscar" aria-pressed="${modoRiscar}">${modoRiscar ? "✂ Riscando: toque nas que descartou · terminar" : "✂ Riscar alternativas"}</button>`;

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
        ${PAS ? `<li>${n} itens no modelo do PAS (certo ou errado, múltipla escolha e resposta numérica): 2 por habilidade da etapa ${esc(s.serie)} e 1 por habilidade das etapas anteriores (cerca de ${Math.round(n * 1.2)} minutos).</li>` : `<li>${n} questões no modelo do ENEM, das sete áreas da Matemática (cerca de ${Math.round(n * 1.4)} minutos).</li>`}
        <li>Sem correção durante a diagnose, para uma resposta não influenciar a outra. O resultado aparece no fim.</li>
        <li>Se precisar parar, pode fechar: ao voltar, você continua da mesma questão.</li>
        ${s.serie !== "3" ? "<li>Se aparecer um conteúdo que você ainda não estudou, toque em <b>“Ainda não estudei este conteúdo”</b>. Ele não conta como erro.</li>" : ""}
      </ul>
      <div class="ia-row"><button class="btn" type="button" data-ia="${andamento ? "continuar" : "comecar"}">${andamento ? "Continuar a diagnose" : "Começar a diagnose"}</button>
      <button class="btn ghost" type="button" data-ia="trocaSerie">Estou na ${esc(s.serie)}ª série · trocar</button></div></div>`;
  }
  function telaDiag() {
    const s = st(), d = s.diag, at = d.atual, q = versao(M.itens[at.id]), k = respondidas(d) + 1, n = limite();
    marcaTempo(at.id);
    const marcos = ampliado() ? [Math.round(n / 3), Math.round(2 * n / 3)] : [Math.floor(n / 2)], rd = respondidas(d);
    if (adaptada() && marcos.includes(rd) && !(d.pausas || []).includes(rd) && !(rd === Math.floor(n / 2) && d.pausaVista && !ampliado())) return `<div class="ia-card"><h2>${ampliado() ? "Hora da pausa" : "Metade feita!"}</h2>
      <p>Você já respondeu ${respondidas(d)} de ${n} questões. Faça uma pausa: beba água, levante um pouco. Quando quiser, continue de onde parou.</p>
      <div class="ia-row"><button class="btn" type="button" data-ia="pausaOk">Continuar agora</button><button class="btn ghost" type="button" data-ia="pausaDepois">Continuar depois</button></div></div>`;
    return `<div class="ia-prog"><span>Diagnose · questão <b>${Math.min(k, n)}</b> de ${n}</span><span class="ia-bar"><i style="width:${Math.round(100 * (k - 1) / n)}%"></i></span></div>
      <article class="q"><div class="q-h"><b>${esc(at.h)} · ${esc(HAB[at.h].curto)}</b>${adaptada() ? `<span class="q-r">${ehTexto(q) ? ouvir : ""}${q.tp !== "B" ? riscarBtn() : ""}</span>` : ""}</div>${corpoQuestao(q, opcoes(q, null))}</article>
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
          <div class="ia-row">${ampliado() ? `<button class="btn" type="button" data-ia-trilha="${t}" data-ia-curta="1">Começar (${n / 2} questões)</button>` : adaptada() ? `<button class="btn" type="button" data-ia-trilha="${t}" data-ia-curta="1">Começar (${n / 2} questões)</button><button class="btn ghost" type="button" data-ia-trilha="${t}">Sessão completa (${n})</button>` : `<button class="btn" type="button" data-ia-trilha="${t}">Começar</button><button class="btn ghost" type="button" data-ia-trilha="${t}" data-ia-curta="1">Tenho pouco tempo (${n / 2})</button>`}</div>`
          : `<p class="note">${t === "adiantar" ? "" : "Nenhuma habilidade aqui por enquanto."}</p>`}</div>`;
    };
    const temIntro = habsDaTrilha("adiantar").length > 0;
    const feitas = (s.sessoes || []).length;
    return `<div class="ia-card"><h2>Hoje</h2><p>Escolha uma sessão curta. A IA sugere uma, mas quem decide é você.</p>
        ${feitas ? `<p class="note">${feitas} ${feitas === 1 ? "sessão feita" : "sessões feitas"} até agora.</p>` : ""}</div>
      <div class="ia-trilhas">${["recuperacao", "fixacao", "aprimoramento"].map(cartao).join("")}${temIntro ? cartao("adiantar") : ""}</div>
      <div class="ia-card ia-escolher"><h4>Quero escolher outro conteúdo</h4><p class="note">Está estudando um assunto na escola? Escolha o tema e pratique com questões ${PAS ? "no modelo do PAS" : "do ENEM"} no seu nível.</p>
        <div class="ia-row"><button class="btn" type="button" data-ia="conteudos">Escolher conteúdo</button></div></div>
      <div class="ia-row"><button class="btn ghost" type="button" data-ia="mapa">Ver meu mapa</button>${Object.keys(BIB).length ? `<button class="btn ghost" type="button" data-ia="biblioteca">Biblioteca</button>` : ""}</div>`;
  }
  function telaEscolha() {
    const pillsDe = hs => hs.map(h => `<span class="ia-hab">${esc(h)} ${pill(estadoDe(h))}</span>`).join("");
    const botoes = (hs, rot) => { const v = esc(hs.slice(0, 3).join(",")), r = esc(rot);
      return ampliado() ? `<button class="btn" type="button" data-ia-livre="${v}" data-ia-rot="${r}" data-ia-curta="1">Praticar (4 questões)</button>`
        : `<button class="btn" type="button" data-ia-livre="${v}" data-ia-rot="${r}">Praticar (8)</button><button class="btn ghost" type="button" data-ia-livre="${v}" data-ia-rot="${r}" data-ia-curta="1">4 questões</button>`; };
    let lista;
    if (modoConteudos === "tema") {
      lista = SR.D.aulas.filter(a => (AULAHABS[a.n] || []).length && (!PAS || a.et <= +st().serie)).map(a => {
        const hs = AULAHABS[a.n].slice(0, 3);
        return `<div class="ia-cont"><p class="ia-cont-h"><b>Aula ${String(a.n).padStart(2, "0")} · ${esc(a.tema)}</b></p>
          ${a.cont ? `<p class="note">${esc(a.cont)}</p>` : ""}<div class="ia-habs">${pillsDe(hs)}</div>
          <div class="ia-row">${botoes(hs, "Aula " + String(a.n).padStart(2, "0") + " · " + a.tema)}${linkAula(a.n, "Ver a teoria", "ia-mini")}</div></div>`;
      }).join("");
    } else {
      lista = H.areas.map(ar => `<h4 class="ia-h4">${esc(ar.nome)}</h4>` + HABS().filter(h => h.area === ar.id).map(h => {
        const e = estadoDe(h.id);
        return `<div class="ia-cont"><p class="ia-cont-h"><b>${esc(h.id)} · ${esc(h.curto)}</b> ${pill(e)}</p>
          <div class="ia-row">${botoes([h.id], h.id + " · " + h.curto)}${e === "introducao" ? `<button class="ia-mini" type="button" data-ia-jaVi="${esc(h.id)}">Já estou estudando isso na escola</button>` : ""}</div></div>`;
      }).join("")).join("");
    }
    return `<div class="ia-card"><h2>Escolher conteúdo</h2>
        <p>Pratique o que você está vendo na escola. A IA continua ajustando as questões ao seu nível em cada habilidade, e tudo conta para o seu mapa.</p>
        <div class="mode sm ia-row" role="group" aria-label="Organizar por"><button type="button" data-ia-modo="tema" aria-pressed="${modoConteudos === "tema"}">Por tema das aulas</button><button type="button" data-ia-modo="area" aria-pressed="${modoConteudos === "area"}">Por área ${PAS ? "da Matemática" : "do ENEM"}</button></div></div>
      ${lista}
      <div class="ia-row"><button class="btn ghost" type="button" data-ia="hoje">Voltar para Hoje</button><button class="btn ghost" type="button" data-tab="aulas">Abrir Aulas e listas</button></div>`;
  }
  function telaSessao() {
    const s = st(), se = s.sessao, at = se.atual, it = M.itens[at.id], q = versao(it), k = se.i + 1, n = se.slots.length, resp = se.respondida;
    marcaTempo(at.id);
    const tipoTxt = { guiada: "Questão guiada", pratica: "Prática", checagem: "Checagem: nível da Fixação", revisao: "Revisão espaçada", prova: "Ritmo de prova", vizinha: "Habilidade vizinha", facil: "Primeiros passos" }[at.tipo] || "";
    const aula = AULA[at.h] && SR.D.aulas.find(a => a.n === AULA[at.h]);
    const antes = k === 1 && !resp ? (se.trilha === "recuperacao" || se.trilha === "adiantar" ? `<div class="ia-antes"><b>Antes de começar:</b> se quiser, leia o resumo da teoria. ${btnTeoria(at.h)}</div>`
      : se.trilha === "fixacao" && BIB[at.h] ? `<div class="ia-antes"><b>Ficha rápida (opcional):</b> ${btnTeoria(at.h)}</div>`
      : se.trilha === "fixacao" && aula && aula.dica ? `<details class="ia-antes"><summary>Ficha rápida (opcional)</summary><p>${aula.dica}</p></details>` : "") : "";
    const textoDica = q.dica ? esc(q.dica) : aula && aula.dica;
    const dica = (at.tipo === "guiada" || adaptada()) && !resp && textoDica ? (dicaAberta ? `<div class="ia-dica"><b>Dica:</b> ${textoDica}</div>` : `<button class="btn ghost" type="button" data-ia="dica">Ver uma dica</button>`) : "";
    let fb = "";
    if (resp) {
      const certo = resp.r === 1, ns = resp.r === "ns";
      fb = `<div class="fbk ia-fbk ${certo ? "ok" : "no"}">
        <p><b>${certo ? "Certo!" : ns ? "Tudo bem não saber." : "Não foi dessa vez."}</b> ${certo ? "" : `A resposta é <b>${gabTxt(q)}</b>.`}</p>
        ${!certo && !ns && q.e && q.e[resp.valor] ? `<p class="bad"><b>Sobre a sua marcação:</b> ${q.e[resp.valor]}</p>` : ""}
        ${q.sol ? `<p class="sol"><b>Resolução:</b> ${q.sol}</p>` : ""}
        ${resp.mudou ? `<p class="ia-sobe"><b>${esc(at.h)}</b> mudou de trilha: ${pill(resp.mudou.de)} → ${pill(resp.mudou.para)}</p>` : ""}
        ${resp.avisoNs ? `<p class="note">Você usou bastante o “não sei” nesta sessão. Ele ajuda quando você realmente não sabe; quando tiver uma ideia, arrisque: errar também ensina. A partir de agora, o “não sei” pesa pela metade.</p>` : ""}
        ${adaptada() && k < n && se.slots[se.i + 1] && se.slots[se.i + 1].h !== at.h ? `<p class="ia-aviso">Próxima questão: outra habilidade, <b>${esc(se.slots[se.i + 1].h)} · ${esc(HAB[se.slots[se.i + 1].h].curto)}</b>.</p>` : ""}
        <div class="ia-row">${!certo ? btnTeoria(at.h, "erros") : ""}<button class="btn" type="button" data-ia="proxima">${k < n ? "Próxima questão" : "Ver como foi"}</button></div></div>`;
    }
    if (ampliado() && !resp && se.i > 0 && se.i % 2 === 0 && !(se.pausas || []).includes(se.i)) return `<div class="ia-card"><h2>Pausa</h2>
      <p>Você fez ${se.i} de ${n} questões. Respire, beba água. Quando quiser, continue.</p>
      <div class="ia-row"><button class="btn" type="button" data-ia="pausaSessao">Continuar</button><button class="ia-mini" type="button" data-ia="sair">Parar por hoje</button></div></div>`;
    const relogio = se.relogio ? `<span class="ia-relogio" id="ia-relogio">0:00</span>` : "";
    return `<div class="ia-prog"><span>${esc(se.rotulo || NOME[se.trilha])} · questão <b>${k}</b> de ${n}</span><span class="ia-bar"><i style="width:${Math.round(100 * (k - 1) / n)}%"></i></span>${relogio}
        ${adaptada() ? "" : `<button class="ia-mini" type="button" data-ia="relogio">${se.relogio ? "Desligar" : "Ligar"} cronômetro</button>`}</div>
      ${antes}
      <article class="q"><div class="q-h"><b>${esc(tipoTxt)}</b><span class="q-r">${adaptada() && ehTexto(q) ? ouvir : ""}${adaptada() && !resp && q.tp !== "B" ? riscarBtn() : ""}${ampliado() ? "" : `<small class="ia-motivo">${esc(at.motivo || "")}</small>`}</span></div>
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
    if (AREA_URL && SR.logado()) { if (["adaptada", "ampliada", "padrao"].includes(AREA_URL)) defineArea(AREA_URL); AREA_URL = null; salvar(); }
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
    const teste = AMB_TESTE && !SSO ? `<p class="note ia-noprint ia-teste">Ambiente de teste · você está na <b>${AREA_NOME()}</b> · simular: ${[["padrao", "padrão"], ["adaptada", "adaptada"], ["ampliada", "apoio ampliado"]].map(([k, t]) => `<button class="ia-mini" type="button" data-iar="simular" data-area="${k}" aria-pressed="${(k === "ampliada" ? ampliado() : k === "adaptada" ? adaptada() && !ampliado() : !adaptada())}">${t}</button>`).join(" ")}</p>` : "";
    v.innerHTML = `<div class="ia-wrap${adaptada() ? " ia-adapt" : ""}${ampliado() ? " ia-amp" : ""}">${teste}${html}</div>`;
    if (window.speechSynthesis) speechSynthesis.cancel();
    const at = resumoAberto ? (BIB[resumoAberto.h] && BIB[resumoAberto.h].exemplo) : (s.sessao && !s.sessao.fim && s.sessao.atual) || (s.diag && !s.diag.fim && s.diag.emCurso && s.diag.atual);
    if (at && M.itens[at.id]) preencherOficiais(M.itens[at.id].aula);
    if (resumoAberto && resumoAberto.foco && !resumoAberto.rolou) { resumoAberto.rolou = true; const el = document.getElementById("ia-sec-" + resumoAberto.foco); if (el) el.scrollIntoView({ block: "start" }); }
  }
  const convite = () => pronto && SR.logado() && !(SR.S.ia && SR.S.ia.diag && SR.S.ia.diag.fim);

  document.addEventListener("input", ev => {   // PAS tipo B: só algarismos, até 3
    const el = ev.target.closest && ev.target.closest("input[data-iab]"); if (!el) return;
    const d = el.value.replace(/\D/g, "").slice(0, 3); if (el.value !== d) el.value = d;
    marcada = d === "" ? null : +d;
    document.querySelectorAll('#view-ia [data-ia="responder"], #view-ia [data-ia="confirmar"]').forEach(b => { b.disabled = marcada == null; });
  });
  document.addEventListener("click", ev => {
    const no = ev.target.closest("[data-ia-no]"); if (no) { selecionarNo(no.dataset.iaNo); return; }
    const bp = ev.target.closest("button[data-ia-praticar], button[data-ia-ler]");
    if (bp) { const h = bp.dataset.iaPraticar || bp.dataset.iaLer; SR.S.tab = "ia"; telaConteudos = false; telaBiblio = false; verMapa = false;
      if (bp.dataset.iaPraticar) { resumoAberto = null; comecarSessao("livre", false, [h], h + " · " + HAB[h].curto); } else resumoAberto = { h, completo: false, foco: "" };
      SR.renderAll(); window.scrollTo({ top: 0 }); return; }
    const la = ev.target.closest("button[data-ia-aula]");
    if (la && SR.abrirResumo) { SR.abrirResumo(+la.dataset.iaAula); window.scrollTo({ top: 0 }); return; }
    const pa = ev.target.closest("button[data-iaap]");
    if (pa) { const k = pa.dataset.iaap;
      if (k === "ouvir") { const el = document.querySelector(".ia-parte"); if (el) falar(el.innerText.replace(/\n+/g, ". "), pa, "🔊 Ouvir esta parte"); return; }
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (k === "prox") { passoAula.i++; passoAula.sol = false; } if (k === "ant") { passoAula.i = Math.max(0, passoAula.i - 1); passoAula.sol = false; }
      if (k === "sol") passoAula.sol = true; if (k === "teoria") passoAula.teoria = true; if (k === "voltarPartes") passoAula.teoria = false;
      SR.renderAll(); if (k !== "sol") { const r = document.querySelector("article.resumo"); if (r) r.scrollIntoView({ block: "start" }); } return; }
    const br = ev.target.closest("#view-id button[data-iar], #view-ia button[data-iar=\"simular\"]");
    if (br) { const s = st();
      if (br.dataset.iar === "meta") { const v = +((document.getElementById("ia-meta") || {}).value || 0); s.meta = v >= 400 && v <= 950 ? Math.round(v) : null; salvar(); SR.renderAll(); }
      if (br.dataset.iar === "simular" && AMB_TESTE && !SSO) { defineArea(br.dataset.area || (ampliado() ? "padrao" : adaptada() ? "ampliada" : "adaptada")); salvar(); SR.renderAll(); return; }
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
    if (b.dataset.iao != null) { if (!(s.sessao && s.sessao.respondida && !s.sessao.fim)) { const j = +b.dataset.iao;
      if (modoRiscar) { if (riscadas.has(j)) riscadas.delete(j); else { riscadas.add(j); if (marcada === j) marcada = null; } } else marcada = j; render(); } return; }
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
    else if (a === "ouvir") { const q = document.querySelector("#view-ia article.q"); if (!q || !window.speechSynthesis) return;
      const bt = ev.target.closest("[data-ia=ouvir]"), volta = () => { document.querySelectorAll("#view-ia [data-ia=ouvir]").forEach(b => { b.textContent = "🔊 Ouvir a questão"; b.setAttribute("aria-pressed", "false"); }); };
      if (speechSynthesis.speaking || speechSynthesis.pending) { speechSynthesis.cancel(); volta(); return; }   // segundo toque: para a leitura
      const partes = [...q.querySelectorAll(".txt, .tbl, .ia-pede, .cmd")].map(e => e.innerText).concat([...q.querySelectorAll(".opts .opt")].map((o, j) => "Alternativa " + L[j] + ": " + o.innerText.replace(/^[A-E]\s*/, "")));
      speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(partes.join(". ")); u.lang = "pt-BR"; u.rate = 0.95; u.onend = u.onerror = volta; speechSynthesis.speak(u);
      if (bt) { bt.textContent = "⏹ Parar a leitura"; bt.setAttribute("aria-pressed", "true"); } }
    else if (a === "pausaOk") { s.diag.pausaVista = true; s.diag.pausas = (s.diag.pausas || []).concat(respondidas(s.diag)); salvar(); render(); topo(); }
    else if (a === "pausaSessao") { s.sessao.pausas = (s.sessao.pausas || []).concat(s.sessao.i); salvar(); render(); topo(); }
    else if (a === "riscar") { modoRiscar = !modoRiscar; render(); }
    else if (a === "pausaDepois") { s.diag.pausaVista = true; s.diag.pausas = (s.diag.pausas || []).concat(respondidas(s.diag)); s.diag.emCurso = false; salvar(); SR.renderAll(); topo(); }
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
  .ia-no-aprimoramento rect{fill:var(--ok-soft);stroke:var(--ok)}.ia-no-introducao rect{fill:var(--pen-soft);stroke:var(--pen)}.ia-no-a_diagnosticar rect{fill:var(--sheet);stroke:var(--ink-2)}
  .ia-no-sel rect{stroke-width:3.5}.ia-no-off{opacity:.3}.ia-no:focus{outline:none}.ia-no:focus rect{stroke-width:3.5}
  .ia-leg,.ia-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
  .ia-chip{display:inline-block;padding:3px 10px;border-radius:99px;font-size:12.5px;font-weight:600}
  .ia-det{border:1px solid var(--rule);border-radius:var(--radius);padding:12px 16px;margin-top:8px}.ia-det h4{margin:12px 0 4px}.ia-det p{margin:4px 0}
  .ia-fluxo{list-style:none;padding:0;margin:0;display:grid;gap:0}.ia-fluxo li{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--rule);border-radius:10px;padding:10px 14px;background:var(--sheet);position:relative;margin-bottom:22px}
  .ia-fluxo li:not(:last-child)::after{content:"↓";position:absolute;left:50%;bottom:-22px;transform:translateX(-50%);color:var(--pen);font-size:18px;line-height:22px}
  .ia-fluxo-ic{font-size:26px;line-height:1;flex:none;width:34px;text-align:center}.ia-fluxo p{margin:2px 0 0}
  .ia-fig{margin:0}.ia-fig figcaption{font-size:15px;color:var(--ink-2);margin-top:6px}.ia-resumo .ia-fluxo{padding-left:0;margin-left:0}.resumo .ia-fluxo{padding-left:0;margin-left:0}.resumo .ia-apoio h3{font-size:17px}
  .ia-svg .sv-ax{stroke:var(--ink-2);stroke-width:2}.ia-svg .sv-gr{stroke:var(--rule);stroke-width:1.5;stroke-dasharray:4 4}.ia-svg .sv-gr2{stroke:var(--ink-2);stroke-width:2;fill:none}
  .ia-svg .sv-bar{fill:var(--pen)}.ia-svg .sv-ci{fill:var(--mark)}.ia-svg .sv-cn{fill:#fff;font-weight:700;font-size:15px}.ia-svg .sv-dot{fill:var(--pen)}
  .ia-svg .sv-sh{fill:var(--pen-soft);stroke:var(--pen);stroke-width:2.5}.ia-svg .sv-sh2{fill:var(--pen-soft);stroke:none}.ia-svg .sv-fav{fill:var(--ok-soft);stroke:var(--ok);stroke-width:3}
  .ia-fig-rola{overflow-x:auto;-webkit-overflow-scrolling:touch}.ia-fig-dica{display:none;font-size:13px;color:var(--ink-2);margin:4px 0 0}
  @media (max-width:640px){.ia-fig-rola .ia-svg{min-width:560px}.ia-fig-dica{display:block}}
  .ia-svg{width:100%;height:auto;display:block;font-family:var(--f-ui)}.ia-svg .sv-cx{fill:var(--pen-soft);stroke:var(--rule)}.ia-svg .sv-tt{fill:var(--pen);font-weight:700;font-size:20px}
  .ia-svg .sv-lb{fill:var(--ink-2);font-size:15px}.ia-svg .sv-n{fill:var(--ink);font-weight:700;font-size:22px}.ia-svg .sv-op{fill:var(--ok);font-weight:700;font-size:18px}.ia-svg .sv-opd{fill:var(--bad)}
  .ia-svg .sv-rg{fill:var(--ink);font-size:14px}.ia-svg .sv-up,.ia-svg .sv-rg-l{stroke:var(--ok);stroke-width:4;fill:none}.ia-svg .sv-upf{fill:var(--ok)}.ia-svg .sv-dn{stroke:var(--bad);stroke-width:4;fill:none}.ia-svg .sv-dnf{fill:var(--bad)}
  .ia-svg .sv-rg-l{stroke:var(--pen)}.ia-svg .sv-esc rect{fill:var(--sheet);stroke:var(--pen);stroke-width:2}.ia-svg .sv-esc text{fill:var(--ink);font-weight:700;font-size:16px}
  .ia-dec{border:2px solid var(--pen);border-radius:12px;padding:12px}.ia-dec-q{font-weight:700;margin:0 0 10px}.ia-dec-r{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .ia-dec-r>div{border-radius:10px;padding:10px;background:var(--ok-soft)}.ia-dec-r>div+div{background:var(--mark-soft)}.ia-dec-r p{margin:4px 0 0}
  .ia-gloss{margin:0;display:grid;gap:8px}.ia-gloss div{border-left:4px solid var(--mark);padding:2px 10px}.ia-gloss dt{font-weight:700}.ia-gloss dd{margin:0}
  .ia-pistas{list-style:none;padding:0;margin:0;display:grid;gap:8px}.ia-pistas li{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;border:1px solid var(--rule);border-radius:8px;padding:8px 10px}.ia-pistas li span:first-child{font-weight:700}
  .ia-pontos{display:flex;gap:8px;margin:4px 0}.ia-pontos span{width:12px;height:12px;border-radius:50%;background:var(--rule)}.ia-pontos .ok{background:var(--pen-soft);outline:2px solid var(--pen)}.ia-pontos .on{background:var(--pen)}
  .ia-parte{border:2px solid var(--pen);border-radius:14px;padding:18px;background:var(--sheet)}.ia-parte h3{font-size:20px!important;margin:0 0 10px}.ia-parte-nav{justify-content:space-between;align-items:center}
  .ia-agenda{font-size:18px;line-height:1.9}.ia-fim{font-weight:700;margin-top:12px}
  .ia-amp *,.resumo.ia-amp *{animation:none!important;transition:none!important}.ia-amp .btn,.resumo.ia-amp .btn{min-height:52px;font-size:17px}
  .ia-no-fora rect{opacity:.35}.ia-no-fora text{opacity:.5}.ia-bnum{display:grid;gap:6px;max-width:260px}.ia-bin{font:700 28px var(--f-mono);letter-spacing:.3em;padding:10px 14px;border:2px solid var(--rule);border-radius:10px;background:var(--sheet);color:var(--ink);width:150px}
  .ia-bin.is-right{border-color:var(--ok)}.ia-bin.is-wrong{border-color:var(--bad)}.ia-ce{margin:0 0 6px}
  .opt.is-riscada{opacity:.5}.opt.is-riscada span:last-child{text-decoration:line-through}
  .ia-cartao{border:2px dashed var(--pen);border-radius:12px;padding:12px 16px;background:var(--pen-soft)}.ia-cartao ul{margin:6px 0 0;padding-left:20px}
  @media (max-width:520px){.ia-dec-r{grid-template-columns:1fr}.ia-pistas li{grid-template-columns:1fr}.ia-pistas li span[aria-hidden]{display:none}}
  .ia-adapt{font-size:17px;line-height:1.75}.ia-adapt .txt p,.ia-adapt .ia-partes li{font-size:17px;line-height:1.75}
  .ia-adapt .opt{min-height:52px}.ia-adapt .ia-card,.ia-adapt .q{padding:22px}
  .ia-partes{padding-left:26px;margin:4px 0}.ia-partes li{margin:0 0 10px}
  .ia-dados{border:1px dashed var(--pen);border-radius:8px;padding:8px 14px;margin:10px 0}.ia-dados ul{margin:4px 0;padding-left:20px}
  .ia-pede{background:var(--pen-soft);border-left:4px solid var(--pen);border-radius:6px;padding:10px 14px;margin:12px 0}
  .ia-aviso{background:var(--mark-soft);border-radius:6px;padding:8px 12px}
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

  window.IA = { apoioAula, render, renderArvore, convite, nivelar, rotuloLista, registrarLista, relatorioHTML };
  carregar();
})();
