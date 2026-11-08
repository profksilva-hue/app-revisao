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
  // No navegador: lê os dados embutidos na página do ENEM.
  async function carregarDoSite(caminho) {
    const html = await fetch(caminho || "../enem/index.html").then(r => { if (!r.ok) throw new Error(r.status); return r.text(); });
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("dados não encontrados");
    return JSON.parse(m[1]);
  }
  const Banco = { extrair, carregarDoSite, qid };
  if (typeof module !== "undefined" && module.exports) module.exports = Banco; else raiz.Banco = Banco;
})(typeof window !== "undefined" ? window : globalThis);
