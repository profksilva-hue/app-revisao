/* Santa Revisão · IA adaptativa dentro do app do ENEM (Fase 2)
   Série, diagnose e tela de resultado (spec, etapa 3).
   Usa o motor (ia/motor.js), o banco (ia/banco.js) e o estado do aluno do próprio app (S.ia),
   que é salvo junto com o progresso e vai no código de progresso. Nada sai do aparelho. */
(function () {
  "use strict";
  const SR = window.SR;
  if (!SR || !window.Motor || !window.Banco) return;
  const L = "ABCDE", esc = SR.esc;
  const NOME = { recuperacao: "Recuperação", fixacao: "Fixação", aprimoramento: "Aprimoramento", introducao: "Introdução", a_diagnosticar: "A diagnosticar" };
  const ORD = { recuperacao: 0, fixacao: 1, aprimoramento: 2 };
  const MAXQ = 30;                 // spec: no máximo 30 questões (cerca de 40 minutos)
  const ALVO_DIAG = [0.4, 0.6];    // começa em dificuldade média e se ajusta a cada resposta
  let H = null, M = null, MD = null, HAB = {}, pronto = false, erro = "";
  let marcada = null, inicioQ = 0, qAtualId = null;

  const st = () => { const S = SR.S; if (!S.ia) S.ia = { v: 1, serie: null, aluno: {}, naoVistas: [], diag: null }; return S.ia; };
  const salvar = () => SR.persist();
  const fmt = x => String(Math.round(x * 10) / 10).replace(".", ",");

  async function carregar() {
    try {
      const [h, g] = await Promise.all([
        fetch("../ia/habilidades.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch("../ia/questoes-geradas.json").then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      H = h; H.habilidades.forEach(x => { HAB[x.id] = x; });
      const itens = Banco.extrair(SR.D).concat(Banco.extrairGeradas(g));
      M = Motor.criar({ itens, habilidades: H.habilidades, nivelParaB: H.nivelParaB });
      // Diagnose: só questões do banco do app (nunca as geradas); as calibradas, quando a habilidade tem ao menos 2.
      const diag = [];
      H.habilidades.forEach(hb => {
        const its = (M.porHab[hb.id] || []).filter(i => !i.gerada), cal = its.filter(i => i.ip);
        (cal.length >= 2 ? cal : its).forEach(i => diag.push(i));
      });
      MD = Motor.criar({ itens: diag, habilidades: H.habilidades, nivelParaB: H.nivelParaB });
      pronto = true;
    } catch (e) { erro = "Não foi possível carregar a IA agora. Verifique a conexão e recarregue a página."; }
    SR.renderAll();
  }

  // ---------- diagnose ----------
  function ordemIntercalada() { // uma habilidade de cada área por vez
    const porArea = {}; H.habilidades.forEach(h => { (porArea[h.area] = porArea[h.area] || []).push(h.id); });
    const filas = H.areas.map(a => (porArea[a.id] || []).slice()), out = [];
    while (filas.some(f => f.length)) filas.forEach(f => { if (f.length) out.push(f.shift()); });
    return out;
  }
  const respondidas = d => d.feitas.filter(f => f.r !== "nv").length;
  function limite() { const nv = new Set(st().naoVistas); return Math.min(MAXQ, 2 * H.habilidades.filter(h => !nv.has(h.id)).length); }
  function proxima() {
    const s = st(), d = s.diag, nv = new Set(s.naoVistas), usadas = new Set(d.usadas), cont = {};
    d.feitas.forEach(f => { cont[f.h] = (cont[f.h] || 0) + 1; });
    for (let tent = 0; tent < 60; tent++) {
      if (respondidas(d) >= limite()) return null;
      let h = d.ordem.find(x => !nv.has(x) && !cont[x] && !(d.semQuestao || []).includes(x));
      if (!h) { // segunda questão para as habilidades que mais pesam na prova
        const c = H.habilidades.filter(x => !nv.has(x.id) && (cont[x.id] || 0) < 2 && !(d.semQuestao || []).includes(x.id)).sort((a, b) => b.peso - a.peso)[0];
        h = c && c.id;
      }
      if (!h) return null;
      const e = MD.escolher(s.aluno, h, ALVO_DIAG, 1, Date.now(), usadas)[0];
      if (e) return { h, id: e.id };
      (d.semQuestao = d.semQuestao || []).push(h);
    }
    return null;
  }
  function comecar() {
    const s = st();
    s.aluno = {}; s.naoVistas = [];
    s.diag = { inicio: Date.now(), fim: null, ordem: ordemIntercalada(), feitas: [], usadas: [], atual: null };
    s.diag.atual = proxima(); marcada = null; salvar();
  }
  function responder(valor) {
    const s = st(), d = s.diag, at = d.atual; if (!at) return;
    const it = M.itens[at.id]; const ms = inicioQ ? Date.now() - inicioQ : null;
    if (valor === "nv") { // "ainda não estudei": a habilidade vai para Introdução (princípio 11)
      if (!s.naoVistas.includes(at.h)) s.naoVistas.push(at.h);
      d.feitas.push({ h: at.h, id: at.id, r: "nv" });
    } else {
      const r = valor === it.q.a ? 1 : 0;
      M.registrar(s.aluno, { id: at.id, r, ms, ts: Date.now(), longa: it.longa });
      d.feitas.push({ h: at.h, id: at.id, r, ms: ms == null ? null : Math.round(ms) });
    }
    d.usadas.push(at.id);
    d.atual = proxima(); marcada = null;
    if (!d.atual) d.fim = Date.now();
    salvar(); SR.renderAll(); window.scrollTo({ top: 0 });
  }

  // ---------- telas ----------
  const pill = e => `<span class="ia-pill ia-${e}">${esc(NOME[e] || e)}</span>`;
  function telaSerie() {
    return `<div class="ia-card"><h2>Minha trilha</h2>
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
  function telaQuestao() {
    const s = st(), d = s.diag, at = d.atual, it = M.itens[at.id], q = it.q, k = respondidas(d) + 1, n = limite();
    if (qAtualId !== at.id) { qAtualId = at.id; inicioQ = Date.now(); marcada = null; }
    const tb = q.tb ? `<div class="tbl"><table><thead><tr>${q.tb[0].map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${q.tb.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    const fig = q.f && SR.D.figs && SR.D.figs[q.f] ? `<div class="fig"><img src="${SR.D.figs[q.f]}" alt="Figura da questão"></div>` : "";
    // enunciados e alternativas são conteúdo do próprio banco do app, renderizados como nas listas
    const opts = q.o.map((o, j) => `<button class="opt" type="button" data-iao="${j}" aria-pressed="${marcada === j}"><span class="bub">${L[j]}</span><span>${SR.optT(q, j, o)}</span></button>`).join("");
    return `<div class="ia-prog"><span>Diagnose · questão <b>${k}</b> de ${n}</span><span class="ia-bar"><i style="width:${Math.round(100 * (k - 1) / n)}%"></i></span></div>
      <article class="q"><div class="q-h"><b>${esc(at.h)} · ${esc(HAB[at.h].curto)}</b></div>
        <div class="txt">${(q.t || []).map(t => `<p>${t}</p>`).join("")}</div>${tb}${fig}
        ${q.c ? `<p class="cmd">${q.c}</p>` : ""}<div class="opts${q.pdf ? " pdfo" : ""}">${opts}</div></article>
      <div class="ia-row ia-nav"><button class="btn" type="button" data-ia="confirmar" ${marcada == null ? "disabled" : ""}>Confirmar e seguir</button>
        ${s.serie !== "3" ? `<button class="btn ghost" type="button" data-ia="naoVi">Ainda não estudei este conteúdo</button>` : ""}</div>
      <p class="note">Sua resposta fica salva ao confirmar. Você pode fechar e continuar depois.</p>`;
  }
  function predominante(lista) {
    const c = {}; lista.forEach(e => { c[e] = (c[e] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a] || ORD[a] - ORD[b])[0];
  }
  function telaResultado() {
    const s = st(), d = s.diag, nv = new Set(s.naoVistas);
    const R = {}; H.habilidades.forEach(h => { R[h.id] = nv.has(h.id) ? { estado: "introducao", n: 0 } : M.resumo(s.aluno, h.id); });
    const vistos = H.habilidades.filter(h => !nv.has(h.id) && ORD[R[h.id].estado] != null);
    const eixos = H.areas.map(a => {
      const hs = vistos.filter(h => h.area === a.id); if (!hs.length) return `<div class="ia-eixo"><b>${esc(a.nome)}</b>${pill("introducao")}<small>Conteúdos que você ainda não estudou</small></div>`;
      const ests = hs.map(h => R[h.id].estado), c = {}; ests.forEach(e => { c[e] = (c[e] || 0) + 1; });
      return `<div class="ia-eixo"><b>${esc(a.nome)}</b>${pill(predominante(ests))}<small>${Object.keys(c).sort((x, y) => ORD[x] - ORD[y]).map(e => `${c[e]} em ${NOME[e]}`).join(" · ")}</small></div>`;
    }).join("");
    const rec = vistos.filter(h => R[h.id].estado === "recuperacao").sort((a, b) => (b.base || []).length - (a.base || []).length || b.peso - a.peso);
    const cartao = h => {
      const base = (h.base || []).map(b => HAB[b] ? HAB[b].curto.toLowerCase() : b);
      return `<div class="ia-def"><p class="ia-def-h"><b>${esc(h.id)} – ${esc(h.curto)}</b>${pill("recuperacao")}</p>
        <p><b>Peso na prova:</b> costuma aparecer em cerca de ${fmt(h.peso)} ${h.peso >= 1.5 ? "questões" : "questão"} por prova.</p>
        ${base.length ? `<p><b>O que ela afeta:</b> é base para ${esc(base.slice(0, -1).join(", ") + (base.length > 1 ? " e " : "") + base[base.length - 1])}.</p>` : ""}
        <p><b>Efeito na nota:</b> na TRI, errar questões fáceis desta habilidade derruba mais a nota do que errar as difíceis. Comece pela trilha de Recuperação.</p></div>`;
    };
    // as que mais sustentam outras aparecem primeiro; o resto fica recolhido para a tela não virar um muro
    const cartoes = rec.slice(0, 5).map(cartao).join("") + (rec.length > 5 ? `<details class="ia-mais"><summary>Ver as outras ${rec.length - 5} habilidades em Recuperação</summary>${rec.slice(5).map(cartao).join("")}</details>` : "");
    const trilha = e => { const hs = H.habilidades.filter(h => R[h.id].estado === e); return `<div class="ia-trilha ia-t-${e}"><h4>${NOME[e]}</h4><p class="note">${hs.length} ${hs.length === 1 ? "habilidade" : "habilidades"}</p>${hs.length ? `<ul>${hs.map(h => `<li>${esc(h.id)} · ${esc(h.curto)}</li>`).join("")}</ul>` : ""}<button class="btn" type="button" disabled>Começar</button></div>`; };
    const min = d.fim && d.inicio ? Math.max(1, Math.round((d.fim - d.inicio) / 60000)) : null;
    const intro = H.habilidades.filter(h => R[h.id].estado === "introducao");
    return `<div class="ia-card"><h2>Seu mapa inicial</h2>
        <p>Você respondeu ${respondidas(d)} questões${min ? ` em ${min} ${min === 1 ? "minuto" : "minutos"}` : ""}. Não existe nota aqui: o mapa mostra por onde começar em cada área. Ele é <b>provisório</b> e vai ficando mais preciso a cada questão das trilhas.</p></div>
      <h3 class="ia-h3">1. Seu perfil por área</h3><div class="ia-eixos">${eixos}</div>
      <h3 class="ia-h3">2. Onde vale começar</h3>${cartoes || `<p class="note">Nenhuma habilidade ficou em Recuperação. Siga pelas trilhas de Fixação e Aprimoramento.</p>`}
      <h3 class="ia-h3">3. Suas trilhas</h3><div class="ia-trilhas">${["recuperacao", "fixacao", "aprimoramento"].map(trilha).join("")}</div>
      ${intro.length ? `<p class="note"><b>Introdução</b> (ainda não estudou): ${intro.map(h => esc(h.id) + " · " + esc(h.curto)).join("; ")}. Esses conteúdos ficam fora das trilhas até você estudá-los.</p>` : ""}
      <p class="note">Ambiente de teste: os botões “Começar” abrem na próxima fase do projeto (trilhas e sessão do dia).</p>
      <div class="ia-row"><button class="btn ghost" type="button" data-ia="refazer">Refazer a diagnose do zero (teste)</button></div>`;
  }

  function render() {
    const v = document.getElementById("view-ia"); if (!v) return;
    if (erro) { v.innerHTML = `<div class="ia-card"><p>${esc(erro)}</p></div>`; return; }
    if (!pronto) { v.innerHTML = `<div class="ia-card"><p>Carregando a IA…</p></div>`; return; }
    const s = st();
    let html;
    if (!s.serie) html = telaSerie();
    else if (s.diag && s.diag.fim) html = telaResultado();
    else if (s.diag && s.diag.atual && s.diag.emCurso) html = telaQuestao();
    else html = telaConvite();
    v.innerHTML = `<div class="ia-wrap">${html}</div>`;
  }
  const convite = () => pronto && SR.logado() && !(SR.S.ia && SR.S.ia.diag && SR.S.ia.diag.fim);

  document.addEventListener("click", ev => {
    const b = ev.target.closest("#view-ia button"); if (!b || b.disabled) return;
    const s = st();
    if (b.dataset.iaSerie) { s.serie = b.dataset.iaSerie; salvar(); SR.renderAll(); return; }
    if (b.dataset.iao != null) { marcada = +b.dataset.iao; render(); return; }
    const a = b.dataset.ia;
    if (a === "comecar") { comecar(); s.diag.emCurso = true; salvar(); SR.renderAll(); window.scrollTo({ top: 0 }); }
    else if (a === "continuar") { s.diag.emCurso = true; salvar(); SR.renderAll(); window.scrollTo({ top: 0 }); }
    else if (a === "trocaSerie") { s.serie = null; salvar(); SR.renderAll(); }
    else if (a === "confirmar" && marcada != null) responder(marcada);
    else if (a === "naoVi") responder("nv");
    else if (a === "refazer") { s.diag = null; s.aluno = {}; s.naoVistas = []; salvar(); SR.renderAll(); }
  });

  const css = document.createElement("style");
  css.textContent = `
  .ia-wrap{max-width:860px;margin:0 auto;padding:4px 0 40px;font-family:var(--f-ui)}
  .ia-card{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:18px 20px;margin:0 0 16px}
  .ia-card h2{font-family:var(--f-display);margin:0 0 8px}
  .ia-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
  .ia-quote{margin:8px 0 12px;padding:10px 14px;border-left:4px solid var(--pen);background:var(--pen-soft);border-radius:6px;font-family:var(--f-body)}
  .ia-list{margin:0;padding-left:20px;line-height:1.6}
  .ia-prog{display:flex;align-items:center;gap:12px;margin:0 0 12px;color:var(--ink-2)}
  .ia-bar{flex:1;height:6px;background:var(--rule);border-radius:99px;overflow:hidden}.ia-bar i{display:block;height:100%;background:var(--pen)}
  .ia-nav{margin:14px 0 6px}
  .ia-h3{font-family:var(--f-display);margin:22px 0 10px}
  .ia-eixos{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  .ia-eixo{background:var(--sheet);border:1px solid var(--rule);border-radius:var(--radius);padding:12px;display:flex;flex-direction:column;gap:6px}
  .ia-eixo small{color:var(--ink-2)}
  .ia-pill{display:inline-block;align-self:flex-start;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;margin-left:6px}
  .ia-eixo .ia-pill{margin-left:0}
  .ia-recuperacao{background:var(--bad-soft);color:var(--bad)}.ia-fixacao{background:var(--mark-soft);color:var(--mark)}
  .ia-aprimoramento{background:var(--ok-soft);color:var(--ok)}.ia-introducao,.ia-a_diagnosticar{background:var(--pen-soft);color:var(--pen)}
  .ia-def{background:var(--sheet);border:1px solid var(--rule);border-left:4px solid var(--bad);border-radius:var(--radius);padding:12px 16px;margin:0 0 10px}
  .ia-def p{margin:4px 0}.ia-def-h{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
  .ia-trilhas{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .ia-trilha{background:var(--sheet);border:1px solid var(--rule);border-top:4px solid var(--pen);border-radius:var(--radius);padding:12px 14px}
  .ia-t-recuperacao{border-top-color:var(--bad)}.ia-t-fixacao{border-top-color:var(--mark)}.ia-t-aprimoramento{border-top-color:var(--ok)}
  .ia-mais summary{cursor:pointer;color:var(--pen);font-weight:700;margin:6px 0 10px}
  .ia-trilha h4{margin:0}.ia-trilha ul{margin:6px 0 10px;padding-left:18px;font-size:13px;line-height:1.5}`;
  document.head.appendChild(css);

  window.IA = { render, convite };
  carregar();
})();
