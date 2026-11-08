/* Santa Revisão · classifica os comentários de erro das alternativas em tipos de erro (relatório, Fase 6).
   Uso: node ferramentas/classificar-erros.js  → gera ia/erros.json
   Primeira versão por palavras-chave; o professor revisa uma amostra e as regras são ajustadas. */
"use strict";
const fs = require("fs"), path = require("path");
const raiz = path.join(__dirname, "..");
const Banco = require("../ia/banco.js");
const D = JSON.parse(fs.readFileSync(path.join(raiz, "enem/index.html"), "utf8").match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const G = JSON.parse(fs.readFileSync(path.join(raiz, "ia/questoes-geradas.json"), "utf8"));
const TIPOS = {
  arredondamento: "Arredondamento", conversao: "Conversão de unidades", porcentagem: "Porcentagem",
  grafico: "Leitura de gráfico ou tabela", proporcao: "Proporção e escala", formula: "Fórmula ou conceito",
  interpretacao: "Interpretação do enunciado", calculo: "Conta ou operação", outros: "Outros"
};
const REGRAS = [ // a primeira que casar define o tipo
  ["arredondamento", /arredond/i],
  ["conversao", /convert|convers|unidade|\bcm\b|\bkm\b|\bmm\b|cm²|m²|m³|segundo|minuto|\bhoras?\b|gramas?\b|litros?\b|mililitro|quilômetro|metros?\b/i],
  ["porcentagem", /porcent|%|desconto|juros|acréscimo|aumento de/i],
  ["grafico", /gráfico|tabela|eixo|barra|coluna|setor|legenda|curva/i],
  ["proporcao", /proporç|regra de três|escala|fator|linear|ao quadrado|ao cubo|razão|inversamente|diretamente/i],
  ["formula", /fórmula|área|perímetro|volume|média|mediana|moda|desvio|amplitude|probabilidade|combina|arranjo|permuta|fatorial|logaritmo|expoente|vértice|raio|diâmetro|pitágoras|seno|cosseno|tangente|ângulo|planifica|juro composto|progress/i],
  ["interpretacao", /^\s*(esse|essa|este|esta|isso)\b|usou|apenas|\bsó\b|parte|pergunta|comando|enunciado|pedid|\bpede\b|esqueceu|não considerou|considerou só|ignorou|supôs|contou|confundiu|leu |descreveu|escolheu/i],
  ["calculo", /calcul|conta\b|somou|subtraiu|multiplicou|dividiu|sinal|inverteu|trocou|errou/i]
];
const tipo = t => { const s = String(t || "").replace(/<[^>]+>/g, ""); for (const [k, re] of REGRAS) if (re.test(s)) return k; return "outros"; };
const itens = Banco.extrair(D).concat(Banco.extrairGeradas(G));
const out = {}, cont = {};
itens.forEach(it => { const e = it.q.e || []; out[it.id] = it.q.o.map((_, j) => j === it.q.a || !e[j] ? "" : tipo(e[j])); out[it.id].forEach(k => { if (k) cont[k] = (cont[k] || 0) + 1; }); });
fs.writeFileSync(path.join(raiz, "ia/erros.json"), JSON.stringify({ versao: 1, tipos: TIPOS, porQuestao: out }));
console.log(itens.length + " questões; tipos:", cont);
