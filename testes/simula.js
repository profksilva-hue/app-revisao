/* Santa Revisão · testes do motor por simulação (Fase 1)
   Uso: node testes/simula.js
   Cria alunos fictícios com um nível "verdadeiro" em cada habilidade, faz o motor
   escolher e corrigir questões e confere os critérios de aceite das etapas 4 e 5 da spec. */
"use strict";
const fs = require("fs"), path = require("path");
const Motor = require("../ia/motor.js"), Banco = require("../ia/banco.js");
const raiz = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(raiz, "enem/index.html"), "utf8");
const D = JSON.parse(html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const H = JSON.parse(fs.readFileSync(path.join(raiz, "ia/habilidades.json"), "utf8"));
const itens = Banco.extrair(D).concat(Banco.extrairGeradas(JSON.parse(fs.readFileSync(path.join(raiz, "ia/questoes-geradas.json"), "utf8"))));
const M = Motor.criar({ itens, habilidades: H.habilidades, nivelParaB: H.nivelParaB });

let semente = 7; const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const DIA = 864e5;
// O aluno fictício "sabe" a questão com a probabilidade do modelo de 2 parâmetros e chuta entre 5 alternativas.
function responde(thVerdadeiro, it, usaNaoSei) {
  const pr = it.ip ? { a: it.ip[0], b: it.ip[1] } : { a: 1.5, b: H.nivelParaB[it.nv] || 1.96 };
  const sabe = rnd() < 1 / (1 + Math.exp(-pr.a * (thVerdadeiro - pr.b)));
  if (sabe) return 1;
  if (usaNaoSei && rnd() < 0.7) return "ns";
  return rnd() < 0.2 ? 1 : 0;
}
const thParaChance = p => { let lo = -2, hi = 5; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (M.fRef(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
const resultados = [];
const confere = (nome, ok, detalhe) => { resultados.push({ nome, ok, detalhe }); };
const habs = Object.keys(M.porHab).filter(h => M.porHab[h].length >= 15);

// 1. Diagnose (2 questões por habilidade) e depois trilhas: quanto a classificação acerta.
(function () {
  const N = 300; let certoDiag = 0, certoTrilha = 0, total = 0, validadas = 0;
  for (let a = 0; a < N; a++) {
    const h = habs[a % habs.length]; const th = 1.2 + 0.7 * gauss(); const aluno = {}; let t = Date.now();
    const usadas = new Set();
    M.escolher(aluno, h, [0.4, 0.6], 2, t, usadas).forEach(e => { usadas.add(e.id); M.registrar(aluno, { id: e.id, r: responde(th, M.itens[e.id]), ms: 60000, ts: t += 1000 }); });
    const verdade = M.faixa(M.fRef(th));
    if (M.resumo(aluno, h, t).estado === verdade) certoDiag++;
    for (let s = 0; s < 3; s++) {
      const est = M.resumo(aluno, h, t).estado;
      const alvo = est === "recuperacao" ? [0.7, 0.8] : est === "fixacao" ? [0.55, 0.7] : [0.4, 0.55];
      M.escolher(aluno, h, alvo, 4, t, usadas).forEach(e => { usadas.add(e.id); M.registrar(aluno, { id: e.id, r: responde(th, M.itens[e.id]), ms: 60000, ts: t += 1000 }); });
    }
    const r = M.resumo(aluno, h, t); if (r.estado === verdade) certoTrilha++; if (r.validado) validadas++; total++;
  }
  confere("Classificação após a diagnose (2 questões)", true, Math.round(100 * certoDiag / total) + "% corretas (referência: estado provisório)");
  confere("Classificação após diagnose + 12 questões de trilha", certoTrilha / total >= 0.7, Math.round(100 * certoTrilha / total) + "% corretas; " + Math.round(100 * validadas / total) + "% já validadas");
})();

// 2. Chance mirada: em 100 sessões por trilha, a taxa de acerto fica a até 10 pontos da faixa.
(function () {
  const trilhas = { recuperacao: [0.7, 0.8], fixacao: [0.55, 0.7], aprimoramento: [0.4, 0.55] };
  Object.entries(trilhas).forEach(([nome, alvo]) => {
    let acertos = 0, total = 0;
    for (let s = 0; s < 100; s++) {
      const h = habs[s % habs.length]; const th = nome === "recuperacao" ? 0.6 + 0.3 * gauss() : nome === "fixacao" ? 1.4 + 0.2 * gauss() : 2.2 + 0.3 * gauss();
      const aluno = {}; let t = Date.now(); const usadas = new Set();
      // histórico prévio de 10 respostas para o motor conhecer o aluno
      M.escolher(aluno, h, [0.3, 0.9], 10, t, usadas).forEach(e => { usadas.add(e.id); M.registrar(aluno, { id: e.id, r: responde(th, M.itens[e.id]), ms: 60000, ts: t += 1000 }); });
      M.escolher(aluno, h, alvo, 8, t, usadas).forEach(e => { const r = responde(th, M.itens[e.id]); acertos += r === 1 ? 1 : 0; total++; });
    }
    const taxa = acertos / total;
    confere("Taxa de acerto na trilha " + nome, taxa >= alvo[0] - 0.1 && taxa <= alvo[1] + 0.1, Math.round(100 * taxa) + "% (faixa mirada " + alvo.map(x => Math.round(x * 100)).join("–") + "%)");
  });
})();

// 3. Um acerto isolado nunca muda o estado de uma habilidade já classificada.
(function () {
  let violacoes = 0;
  for (let k = 0; k < 200; k++) {
    const h = habs[k % habs.length]; const aluno = {}; let t = Date.now();
    const ids = M.porHab[h].map(i => i.id);
    for (let i = 0; i < 6; i++) M.registrar(aluno, { id: ids[i], r: 0, ms: 60000, ts: t += 1000 });
    const antes = M.resumo(aluno, h, t).estado;
    const r = M.registrar(aluno, { id: ids[6], r: 1, ms: 60000, ts: t += 1000 });
    const nDesde = aluno.est[h].nDesde; if (r.mudou && r.resumo.n - 1 - nDesde < 3) violacoes++;
    void antes;
  }
  confere("Acerto isolado não muda o estado", violacoes === 0, violacoes + " violações em 200 casos");
})();

// 4. Aluno em Recuperação que passa a acertar questões típicas sobe para Fixação em até 8 respostas (decisão do professor, 07/11).
(function () {
  let subiu = 0, total = 0, respostas = [];
  for (let k = 0; k < 200; k++) {
    const h = habs[k % habs.length]; const aluno = {}; let t = Date.now(); const usadas = new Set();
    M.escolher(aluno, h, [0.0, 1.0], 4, t, usadas).forEach(e => { usadas.add(e.id); M.registrar(aluno, { id: e.id, r: 0, ms: 60000, ts: t += 1000 }); });
    if (M.resumo(aluno, h, t).estado !== "recuperacao") continue;
    total++;
    for (let i = 1; i <= 10; i++) {
      // "questões típicas": as mais próximas do nível da questão de referência (~630 pontos)
      const e = M.porHab[h].filter(it => !usadas.has(it.id) && M.params(it).peso > 0)
        .sort((x, y) => Math.abs(M.params(x).b - M.config.ref.b) - Math.abs(M.params(y).b - M.config.ref.b))[0];
      if (!e) break; usadas.add(e.id);
      M.registrar(aluno, { id: e.id, r: 1, ms: 60000, ts: t += 1000 });
      if (M.resumo(aluno, h, t).estado !== "recuperacao") { subiu++; respostas.push(i); break; }
    }
  }
  const ate8 = respostas.filter(n => n <= 8).length;
  confere("Recuperação → Fixação com acertos consistentes", ate8 / total >= 0.9, ate8 + " de " + total + " subiram em até 8 respostas (mediana " + (respostas.sort((a, b) => a - b)[Math.floor(respostas.length / 2)] || "-") + ")");
})();

// 5. Questões geradas e não calibradas não alteram o domínio.
(function () {
  const h = habs[0]; const extra = { id: "GERADA-teste", h, nv: 2, gerada: true };
  const M2 = Motor.criar({ itens: itens.concat([extra]), habilidades: H.habilidades, nivelParaB: H.nivelParaB });
  const aluno = {}; const antes = M2.resumo(aluno, h).theta;
  M2.registrar(aluno, { id: "GERADA-teste", r: 1, ms: 60000 });
  const depois = M2.resumo(aluno, h).theta;
  confere("Questão gerada não altera o domínio", Math.abs(depois - antes) < 1e-9, "variação " + (depois - antes).toFixed(6));
})();

// 6. Habilidade sem prática há 30 dias aparece em revisão.
(function () {
  const h = habs[1]; const aluno = {}; const t0 = Date.now() - 40 * DIA;
  M.porHab[h].slice(0, 5).forEach((it, i) => M.registrar(aluno, { id: it.id, r: 1, ms: 60000, ts: t0 + i * 1000 }));
  const r = M.resumo(aluno, h, Date.now());
  confere("Revisão após 30 dias sem prática", r.revisao === true, "revisao=" + r.revisao);
})();

// 7. "Não sei" usado demais pesa menos.
(function () {
  const h = habs[2]; const aluno = {}; let t = Date.now();
  const ids = M.porHab[h].map(i => i.id);
  for (let i = 0; i < 6; i++) M.registrar(aluno, { id: ids[i], r: "ns", ms: 5000, ts: t += 1000, sessao: { ns: i + 1, total: i + 1 } });
  const pesos = aluno.resp[h].map(x => x[4]);
  confere("\"Não sei\" acima de 30% pesa pela metade", pesos.slice(3).every(w => w === 0.5), "pesos " + pesos.join(", "));
})();

// 8. Desempenho: tempo para registrar uma resposta.
(function () {
  const h = habs[3]; const aluno = {}; let t = Date.now(); const ids = M.porHab[h].map(i => i.id);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 40; i++) M.registrar(aluno, { id: ids[i % ids.length], r: i % 2, ms: 60000, ts: t += 1000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 40;
  confere("Tempo por resposta registrada", ms < 50, ms.toFixed(1) + " ms");
})();

console.log("Banco: " + itens.length + " questões (" + itens.filter(i => i.gerada).length + " geradas), " + itens.filter(i => i.ip).length + " calibradas, " + habs.length + " habilidades com 15+ questões\n");
resultados.forEach(r => console.log((r.ok ? "PASSOU " : "FALHOU ") + "· " + r.nome + " · " + r.detalhe));
process.exitCode = resultados.every(r => r.ok) ? 0 : 1;
