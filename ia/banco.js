/* Santa Revisão · leitura do banco de questões para o motor da IA (Fase 1)
   Lê os dados que já existem no app do ENEM e devolve uma lista única de questões,
   com o mesmo identificador que o app usa (qid), para o motor e o app falarem a mesma língua. */
(function (raiz) {
  "use strict";
  const hsh = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  // Mesmo cálculo de identificador do app (enem/index.html, função qid).
  const qid = q => q._id || (q._id = q.of && /^of:/.test(q.g || "") ? "E" + q.g.slice(3) : String(q.g || "q").replace(/^var:/, "V").slice(0, 24) + "~" + hsh(JSON.stringify([q.t, q.c, q.o])));

  function extrair(D) {
    const vistos = new Map();
    (D.aulas || []).forEach(aula => {
      ["q", "bank", "of"].forEach(campo => {
        const lista = aula[campo]; if (!Array.isArray(lista)) return;
        lista.forEach(q => {
          if (!q || typeof q !== "object" || !q.h || !Array.isArray(q.o)) return;
          const id = qid(q); if (vistos.has(id)) return;
          const texto = (q.t || []).join(" ") + " " + (q.c || "");
          vistos.set(id, {
            id, h: q.h, aula: aula.n, nv: q.nv || 3,
            ip: Array.isArray(q.ip) && q.ip.length === 3 ? q.ip : null,
            longa: texto.replace(/<[^>]*>/g, "").length > 350,
            oficial: !!(q.of && q.of.src), fonte: q.of && q.of.src || "",
            q // a questão completa, para exibir (conteúdo do professor)
          });
        });
      });
    });
    return Array.from(vistos.values());
  }
  // Questões geradas com Claude e aprovadas pelo professor (ia/questoes-geradas.json).
  // Não calibradas: o motor as usa nas trilhas, mas com peso zero no domínio.
  function extrairGeradas(J) {
    return ((J && J.questoes) || []).filter(q => q && q.id && q.h && Array.isArray(q.o) && q.o.length === 5).map(q => {
      const texto = (q.t || []).join(" ") + " " + (q.c || "");
      return { id: q.id, h: q.h, aula: null, nv: q.nv || 2, ip: null, gerada: true, longa: texto.length > 350, oficial: false, fonte: "Gerada com Claude · lote " + (q.lote || "?"), q };
    });
  }
  // PAS: itens dos tipos A (certo/errado), B (numérico) e C (múltipla escolha) viram questões da IA.
  // O tipo D (discursivo, autoavaliado) fica só nas listas. cc = chance de acertar no chute, por tipo.
  const CHUTE = { A: 0.5, B: 0.02, C: 0.25 };
  function extrairPAS(D) {
    const vistos = new Map();
    (D.aulas || []).forEach(aula => (aula.bank || []).forEach(q => {
      if (!q || !q.h || !CHUTE.hasOwnProperty(q.tp) || q.a == null) return;
      const id = "P" + hsh(JSON.stringify([q.base || null, q.t, q.c, q.o || null])); if (vistos.has(id)) return;
      const iq = q.tp === "A"
        ? { tp: "A", t: (q.base || []).filter(x => !/^Julgue os itens/i.test(x)), c: "Julgue o item: " + q.t.join(" "), o: ["Certo", "Errado"], a: q.a, sol: q.sol, h: q.h, hab: q.hab, nv: q.nv, tb: q.tb || q.btb || null }
        : q.tp === "C" ? { tp: "C", t: q.t, c: q.c, o: q.o, a: q.a, e: q.e, sol: q.sol, h: q.h, hab: q.hab, nv: q.nv, tb: q.tb || null }
        : { tp: "B", t: q.t, c: q.c, a: q.a, sol: q.sol, eb: q.eb, h: q.h, hab: q.hab, nv: q.nv, tb: q.tb || null };
      const texto = (iq.t || []).join(" ") + " " + (iq.c || "");
      vistos.set(id, { id, h: q.h, aula: aula.n, nv: q.nv || 3, ip: null, cc: CHUTE[q.tp], tp: q.tp, longa: texto.replace(/<[^>]*>/g, "").length > 350, oficial: false, fonte: "", q: iq });
    }));
    return Array.from(vistos.values());
  }
  // No navegador: lê os dados embutidos na página do ENEM.
  async function carregarDoSite(caminho) {
    const html = await fetch(caminho || "../enem/index.html").then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("dados não encontrados");
    return JSON.parse(m[1]);
  }
  const Banco = { extrair, extrairPAS, extrairGeradas, carregarDoSite, qid };
  if (typeof module !== "undefined" && module.exports) module.exports = Banco; else raiz.Banco = Banco;
})(typeof window !== "undefined" ? window : globalThis);
