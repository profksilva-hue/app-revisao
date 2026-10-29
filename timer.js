/* Cronômetro das listas (ENEM e PAS)
   - Opcional: o aluno liga em "Treinar com tempo" no cartão-resposta.
   - Conta mesmo com a página fechada (como na prova); dá para pausar.
   - Ao corrigir, mostra o tempo total, o tempo de cada item e os acertos.
   - Lê o app só pela ponte window.__revApp (definida no fim de cada app).
   - Guarda os tempos no aparelho: <prefixo do app>:crono:<e-mail>:<aula>:<tentativa>. */
(() => {
  const A = window.__revApp;
  if (!A) return;

  // ---------- armazenamento ----------
  const mem = {};
  const rd = k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return mem[k] || null; } };
  const wr = (k, v) => { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const rm = k => { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} };
  const quem = () => A.email() || null;
  const kRec = (n, t) => quem() ? A.key + ":crono:" + quem() + ":" + n + ":" + t : null;
  const kMeta = n => A.key + ":crono-meta:" + n;
  const anon = {};
  const getRec = (n, t) => { const k = kRec(n, t); return k ? rd(k) : anon[n + ":" + t] || null; };
  const putRec = (n, t, r) => { const k = kRec(n, t); if (k) wr(k, r); else anon[n + ":" + t] = r; };
  const delRec = (n, t) => { const k = kRec(n, t); if (k) rm(k); else delete anon[n + ":" + t]; };

  // ---------- tempo ----------
  const decorrido = r => r ? r.acc + (r.run ? Date.now() - r.t0 : 0) : 0;
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
  const minTxt = m => (Math.round(m * 10) / 10).toString().replace(".", ",") + " min";
  const metaPadrao = n => A.metaItens(n).reduce((s, x) => s + x, 0);
  const metaMin = n => { const v = rd(kMeta(n)); return v && v > 0 ? v : Math.round(metaPadrao(n)); };
  const pad2 = i => String(i + 1).padStart(2, "0");

  // ---------- estado da aula aberta ----------
  function contexto() {
    const c = A.atual();
    if (!c) return null;
    let r = getRec(c.n, c.t);
    const feito = A.feito(c.n);
    // lista apagada ou refeita com o mesmo número de tentativa: o registro antigo não vale mais
    if (r && r.fim != null && !feito) { delRec(c.n, c.t); r = null; }
    return { n: c.n, t: c.t, r, feito, modo: A.modo() };
  }

  // registra o momento da 1ª marcação de cada item e encerra ao corrigir
  function acompanhar(cx) {
    const r = cx.r;
    if (!r) return;
    if (r.fim != null) {
      // depois da correção, só acompanha a autoavaliação do item discursivo (PAS, tipo D)
      if (cx.feito) { const ac = A.itens(cx.n).filter(it => it.ok).length; if (ac !== r.ac) { r.ac = ac; putRec(cx.n, cx.t, r); } }
      return;
    }
    let mudou = false;
    const el = decorrido(r);
    A.itens(cx.n).forEach((it, i) => { if (it.marcado && r.marks[i] == null) { r.marks[i] = el; mudou = true; } });
    if (cx.feito) {
      const its = A.itens(cx.n);
      r.fim = el; r.run = false; r.acc = el; r.ac = its.filter(it => it.ok).length; r.tot = its.length; mudou = true;
    }
    if (mudou) putRec(cx.n, cx.t, r);
  }

  // ---------- análise depois da correção ----------
  function analise(n, r) {
    const its = A.itens(n), ritmo = A.metaItens(n), fator = (r.meta || metaMin(n)) / metaPadrao(n);
    const ordem = Object.keys(r.marks).map(Number).filter(i => i < its.length).sort((x, y) => r.marks[x] - r.marks[y]);
    const tempo = {}; let ant = 0;
    ordem.forEach(i => { tempo[i] = Math.max(0, r.marks[i] - ant); ant = r.marks[i]; });
    const linhas = its.map((it, i) => {
      const lim = ritmo[i] * fator * 60000, t = tempo[i];
      const st = !it.marcado ? "br" : it.pend ? "pd" : it.ok ? "ok" : it.parcial ? "pa" : "er";
      return { i, st, t, lento: t != null && t > lim, rapidoErro: t != null && st === "er" && t < lim * 0.35, lim };
    });
    return { linhas, ac: its.filter(it => it.ok).length, tot: its.length };
  }
  function tentativas(n) {
    const out = [];
    for (let t = 1; t <= 30; t++) { const r = getRec(n, t); if (r && r.fim != null) out.push({ t, r }); }
    return out;
  }

  // ---------- interface ----------
  const css = `
.crono{border:1px solid var(--rule,#D3DDE5);border-radius:10px;padding:10px 12px;margin:0 0 14px;display:flex;flex-direction:column;gap:8px;background:var(--sheet,#fff)}
.crono h4{margin:0;font:700 11.5px/1.2 var(--f-ui,system-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2,#4A5F70);display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 8px;align-items:baseline}
.crono h4 .st{font-weight:600;letter-spacing:.04em;text-transform:none;color:var(--mark,#8A5F08)}
.crono .rel{font:600 28px/1 var(--f-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:var(--ink,#0E2A3B);white-space:nowrap}
.crono .rel small{display:block;margin-top:4px;font:500 12px/1.2 var(--f-ui,system-ui);color:var(--ink-2,#4A5F70);white-space:normal}
.crono .bar{height:6px;border-radius:99px;background:var(--rule,#D3DDE5);overflow:hidden}
.crono .bar i{display:block;height:100%;background:var(--pen,#005084);border-radius:99px;transition:width .4s}
.crono.over .bar i{background:var(--bad,#B23A48)} .crono.over .rel{color:var(--bad,#B23A48)}
.crono p{margin:0;font-size:12.5px;line-height:1.45;color:var(--ink-2,#4A5F70)}
.crono p b{color:var(--ink,#0E2A3B)}
.crono .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.crono button{font:600 12.5px/1 var(--f-ui,system-ui);border:1px solid var(--rule,#D3DDE5);background:transparent;color:var(--ink,#0E2A3B);border-radius:99px;padding:7px 12px;cursor:pointer}
.crono button.pri{background:var(--pen,#005084);border-color:var(--pen,#005084);color:#fff}
.crono button.sq{padding:5px 9px;border-radius:6px}
.crono .chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:5px}
.crono .chip{font:600 11.5px/1.25 var(--f-mono,ui-monospace,monospace);border-radius:6px;padding:5px 6px;text-align:center;border:1.5px solid transparent;font-variant-numeric:tabular-nums}
.crono .chip.ok{background:var(--ok-soft,#E1F1E7);color:var(--ok,#2B7A4B)} .crono .chip.er{background:var(--bad-soft,#F7E3E6);color:var(--bad,#B23A48)}
.crono .chip.pa{background:var(--mark-soft,#F8F1E0);color:var(--mark,#8A5F08)} .crono .chip.pd{color:var(--mark,#8A5F08);border-color:var(--mark,#8A5F08);border-style:dashed} .crono .chip.br{color:var(--ink-2,#4A5F70);border-color:var(--rule,#D3DDE5);border-style:dashed}
.crono .chip.lento{border-color:var(--mark,#8A5F08);border-style:solid}
.crono .key{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11.5px;color:var(--ink-2,#4A5F70)}
.crono .key i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px;border:1.5px solid var(--mark,#8A5F08)}
.crono-pill{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:50;display:flex;gap:8px;align-items:center;
  font:600 15px/1 var(--f-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;background:var(--ink,#0E2A3B);color:var(--sheet,#fff);border:0;border-radius:99px;padding:11px 15px;box-shadow:0 4px 16px rgba(0,0,0,.18);cursor:pointer}
.crono-pill.over{background:var(--bad,#B23A48);color:#fff} .crono-pill small{font-size:12px;opacity:.75;font-weight:500}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const pill = document.createElement("button");
  pill.type = "button"; pill.className = "crono-pill"; pill.hidden = true; pill.setAttribute("aria-label", "Ir para o cronômetro");
  document.body.appendChild(pill);

  function blocoHTML(cx) {
    const { n, r, feito } = cx, meta = r && r.meta || metaMin(n), U = A.unidades, u = A.unidade;
    if (feito) {
      if (!r || r.fim == null) return `<h4>Tempo</h4><p>Lista feita sem cronômetro. Ao refazer, ligue <b>Treinar com tempo</b> para ver quanto você leva em cada ${u}.</p>`;
      const an = analise(n, r), dif = r.fim - meta * 60000, mk = an.linhas.filter(l => l.t != null);
      const media = mk.length ? r.fim / mk.length : 0;
      const lentos = an.linhas.filter(l => l.lento), rapidos = an.linhas.filter(l => l.rapidoErro);
      const lentErr = lentos.filter(l => l.st === "er" || l.st === "pa").length;
      const hist = tentativas(n);
      return `<h4>Tempo da lista <span class="st">${dif > 0 ? "acima da meta" : "dentro da meta"}</span></h4>
        <div class="rel">${fmt(r.fim)}<small>meta de ${fmt(meta * 60000)}</small></div>
        <p><b>${dif > 0 ? fmt(dif) + " acima" : fmt(-dif) + " abaixo"}</b> da meta · média de <b>${fmt(media)}</b> por ${u} marcad${u === "questão" ? "a" : "o"} · ${an.ac} de ${an.tot} cert${u === "questão" ? "as" : "os"}.</p>
        <div class="chips">${an.linhas.map(l => `<span class="chip ${l.st}${l.lento ? " lento" : ""}" title="${l.t == null ? "em branco" : l.st === "pd" ? "falta autoavaliar" : "ritmo: até " + fmt(l.lim)}">${pad2(l.i)} ${l.st === "ok" ? "✓" : l.st === "er" ? "✗" : l.st === "pa" ? "½" : l.st === "pd" ? "?" : "–"}<br>${l.t == null ? "—" : fmt(l.t)}</span>`).join("")}</div>
        <div class="key"><span><i></i>passou do ritmo</span>${an.linhas.some(l => l.st === "pd") ? "<span>? falta autoavaliar</span>" : ""}<span>tempo entre uma marcação e a anterior</span></div>
        ${lentos.length ? `<p><b>Passaram do ritmo:</b> ${lentos.map(l => pad2(l.i)).join(", ")}${lentErr ? ` (${lentErr} com erro): tempo gasto sem retorno; na prova, pule e volte no fim` : ": acertou, mas precisa ganhar velocidade"}.</p>` : ""}
        ${rapidos.length ? `<p><b>Erros rápidos:</b> ${rapidos.map(l => pad2(l.i)).join(", ")}. Respondeu depressa e errou: releia o comando antes de marcar.</p>` : ""}
        ${hist.length > 1 ? `<p><b>Suas tentativas:</b> ${hist.map(h => `${h.t}ª ${fmt(h.r.fim)}${h.r.tot ? ` · ${h.t === cx.t ? an.ac : h.r.ac}/${h.r.tot}` : ""}`).join(" → ")}</p>` : ""}`;
    }
    if (!r) {
      return `<h4>Treinar com tempo</h4>
        <div class="row" style="justify-content:space-between"><span class="rel" style="font-size:24px">${meta} min<small>de meta para a lista</small></span>
          <span class="row"><button type="button" class="sq" data-crono="menos" aria-label="Diminuir meta">−</button><button type="button" class="sq" data-crono="mais" aria-label="Aumentar meta">+</button></span></div>
        <p>${A.ritmoTxt}</p>
        <button type="button" class="pri" data-crono="ini">Iniciar cronômetro</button>
        <p>Conta mesmo se você sair da página, como na prova. Ao corrigir, você vê o tempo de cada ${u}.</p>`;
    }
    // parte fixa; os números que mudam a cada segundo são preenchidos por dinamico()
    return `<h4>Cronômetro <span class="st">${r.run ? "" : "pausado"}</span></h4>
      <div class="rel" data-crono-el></div>
      <div class="bar"><i data-crono-bar></i></div>
      <p data-crono-falta></p>
      <p data-crono-fora hidden>O cronômetro está ligado há muito tempo. Se você parou de resolver, zere e comece de novo.</p>
      <div class="row">${r.run ? `<button type="button" data-crono="pausa">Pausar</button>` : `<button type="button" class="pri" data-crono="cont">Continuar</button>`}<button type="button" data-crono="zera">Zerar</button></div>`;
  }
  const setH = (el, h) => { if (el && el.innerHTML !== h) el.innerHTML = h; };
  function dinamico(box, cx) {
    const r = cx.r; if (!r || r.fim != null) return;
    const meta = r.meta || metaMin(cx.n), el = decorrido(r), falt = meta * 60000 - el, u = A.unidade;
    setH(box.querySelector("[data-crono-el]"), `${fmt(el)}<small>meta de ${fmt(meta * 60000)}</small>`);
    const bar = box.querySelector("[data-crono-bar]"), w = Math.min(100, el / (meta * 600)).toFixed(1) + "%";
    if (bar && bar.style.width !== w) bar.style.width = w;
    setH(box.querySelector("[data-crono-falta]"), `${falt < 0 ? `<b>${fmt(-falt)}</b> acima da meta` : `faltam <b>${fmt(falt)}</b>`} · ${Object.keys(r.marks).length} de ${A.itens(cx.n).length} ${A.unidades} marcad${u === "questão" ? "as" : "os"}`);
    const fora = box.querySelector("[data-crono-fora]"); if (fora) fora.hidden = el <= meta * 60000 * 3;
  }

  let ultimoHTML = "", ultimoCard = null;
  function atualizar() {
    const card = document.querySelector("#main aside.card");
    const cx = contexto();
    let box = card && card.querySelector(".crono");
    const mostrar = card && cx && cx.modo !== "gab" && (cx.modo !== "resumo" || (cx.r && cx.r.fim == null) || cx.feito);
    if (cx) acompanhar(cx);
    if (!mostrar) { if (box) box.remove(); pill.hidden = true; return; }
    if (!box || card !== ultimoCard) {
      box = box || document.createElement("section");
      box.className = "crono"; box.setAttribute("aria-label", "Cronômetro da lista");
      const h = card.querySelector("h3");
      if (h && h.nextSibling !== box) h.after(box); else if (!h) card.prepend(box);
      ultimoHTML = ""; ultimoCard = card;
    }
    const cx2 = contexto();
    const html = blocoHTML(cx2);
    if (html !== ultimoHTML) { box.innerHTML = html; ultimoHTML = html; }
    dinamico(box, cx2);
    const r = cx2.r, meta = r && r.meta || metaMin(cx2.n);
    box.classList.toggle("over", !!r && r.fim == null && decorrido(r) > meta * 60000);
    // pílula flutuante: só com o cronômetro ativo e o bloco fora da tela
    const ativo = r && r.fim == null && !cx2.feito && card.getClientRects().length;
    if (ativo) {
      const b = box.getBoundingClientRect(), vis = b.bottom > 0 && b.top < innerHeight;
      const el = decorrido(r);
      pill.hidden = vis;
      pill.classList.toggle("over", el > meta * 60000);
      const t = `${r.run ? "⏱" : "⏸"} ${fmt(el)} <small>/ ${fmt(meta * 60000)}</small>`;
      if (pill.innerHTML !== t) pill.innerHTML = t;
    } else pill.hidden = true;
  }

  // ---------- ações ----------
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-crono]");
    if (e.target.closest && e.target.closest(".crono-pill")) { const c = document.querySelector("#main .crono"); if (c) c.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    if (!b) return;
    const cx = contexto(); if (!cx) return;
    const act = b.dataset.crono;
    if (act === "mais" || act === "menos") { wr(kMeta(cx.n), Math.max(1, metaMin(cx.n) + (act === "mais" ? 1 : -1))); }
    else if (act === "ini") putRec(cx.n, cx.t, { run: true, t0: Date.now(), acc: 0, marks: {}, fim: null, meta: metaMin(cx.n) });
    else if (act === "pausa" && cx.r) { cx.r.acc = decorrido(cx.r); cx.r.run = false; putRec(cx.n, cx.t, cx.r); }
    else if (act === "cont" && cx.r) { cx.r.run = true; cx.r.t0 = Date.now(); putRec(cx.n, cx.t, cx.r); }
    else if (act === "zera") delRec(cx.n, cx.t);
    ultimoHTML = ""; atualizar();
  });

  // a cada re-renderização do app, recoloca o bloco no cartão
  const main = document.getElementById("main");
  let pend = false;
  const agenda = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; atualizar(); }); };
  const dentro = m => { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; return !!(t && t.closest && t.closest(".crono")); };
  if (main) new MutationObserver(ms => { if (ms.every(dentro)) return; agenda(); })
    .observe(main, { childList: true, subtree: true });
  addEventListener("scroll", agenda, { passive: true });
  document.addEventListener("visibilitychange", agenda);
  setInterval(atualizar, 1000);
  atualizar();
})();
