/* Testes do login Microsoft (sem rede): simula a Microsoft e confere cada caminho.
   Uso: node testes/login.test.mjs */
import { onRequest as middleware } from "../functions/_middleware.js";
import { onRequestGet as entrar } from "../functions/auth/entrar.js";
import { onRequestGet as retorno } from "../functions/auth/retorno.js";
import { onRequestGet as eu } from "../functions/api/eu.js";
import { onRequestGet as sair } from "../functions/auth/sair.js";
import { b64uTexto } from "../functions/_lib/sessao.js";

const env = { MS_TENANT_ID: "tenant-escola", MS_CLIENT_ID: "app-santa", MS_CLIENT_SECRET: "segredo", SESSION_SECRET: "chave-de-teste-bem-longa-0123456789", DOMINIO: "escola.edu.br", SITE_URL: "https://santa-revisao-teste.pages.dev" };
const SITE = env.SITE_URL;
const res = []; const ok = (nome, cond, det = "") => res.push([cond ? "PASSOU" : "FALHOU", nome, det]);
const jar = setCookie => (setCookie || "").split(/,(?=\s*sr_)/).map(c => c.split(";")[0].trim()).filter(c => !/=$/.test(c)).join("; ");
const req = (path, cookie, accept = "text/html") => new Request(SITE + path, { headers: { Accept: accept, ...(cookie ? { Cookie: cookie } : {}) } });
const fakeNext = () => new Response("conteudo", { status: 200 });
let tokenPayload = null;
globalThis.fetch = async (url, init) => { // Microsoft simulada
  if (String(url).endsWith("/token")) { const b = new URLSearchParams(init.body); if (b.get("client_secret") !== env.MS_CLIENT_SECRET || !b.get("code_verifier")) return new Response("{}", { status: 400 });
    return new Response(JSON.stringify({ id_token: "h." + b64uTexto(JSON.stringify(tokenPayload)) + ".s" }), { status: 200 }); }
  throw new Error("rede inesperada: " + url);
};
async function login(payloadExtra, volta = "/enem/") {
  const r1 = await entrar({ request: req("/auth/entrar?volta=" + encodeURIComponent(volta)), env });
  const loc = new URL(r1.headers.get("Location")); const fluxo = jar(r1.headers.get("Set-Cookie"));
  tokenPayload = Object.assign({ aud: env.MS_CLIENT_ID, tid: env.MS_TENANT_ID, iss: `https://login.microsoftonline.com/${env.MS_TENANT_ID}/v2.0`, exp: Date.now() / 1000 + 3600, nonce: loc.searchParams.get("nonce"), preferred_username: "ana.souza@escola.edu.br" }, payloadExtra);
  const r2 = await retorno({ request: req(`/auth/retorno?code=abc&state=${loc.searchParams.get("state")}`, fluxo), env });
  return { r1, loc, r2, sessao: jar(r2.headers.getSetCookie ? r2.headers.getSetCookie().join(", ") : r2.headers.get("Set-Cookie")) };
}

// 1. sem chaves configuradas, nada muda
ok("Sem chaves: site abre como hoje", (await middleware({ request: req("/enem/"), env: {}, next: fakeNext })).status === 200);
ok("Sem chaves: /api/eu responde 404 (app usa o e-mail como hoje)", (await eu({ request: req("/api/eu"), env: {} })).status === 404);
// 2. sem sessão, páginas vão para o login
const m1 = await middleware({ request: req("/enem/?x=1"), env, next: fakeNext });
ok("Sem sessão: página redireciona para /auth/entrar", m1.status === 302 && m1.headers.get("Location").includes("/auth/entrar?volta=%2Fenem%2F%3Fx%3D1"));
ok("Sem sessão: arquivo responde 401", (await middleware({ request: req("/ia/motor.js", null, "*/*"), env, next: fakeNext })).status === 401);
// 3. fluxo completo, aluno comum
const A = await login({});
ok("Entrar manda para a Microsoft com PKCE e domínio", A.loc.origin === "https://login.microsoftonline.com" && A.loc.searchParams.get("code_challenge_method") === "S256" && A.loc.searchParams.get("domain_hint") === "escola.edu.br");
ok("Retorno cria a sessão e volta para a página", A.r2.status === 302 && A.r2.headers.get("Location") === "/enem/" && /sr_sess=/.test(A.sessao), A.r2.status + " " + A.r2.headers.get("Location"));
ok("Com sessão: página abre", (await middleware({ request: req("/enem/", A.sessao), env, next: fakeNext })).status === 200);
const e1 = await (await eu({ request: req("/api/eu", A.sessao, "*/*"), env })).json();
ok("/api/eu: e-mail e área padrão", e1.email === "ana.souza@escola.edu.br" && e1.adaptada === false, JSON.stringify(e1));
// 4. aluno com o papel da área adaptada
const B = await login({ roles: ["AreaAdaptada"], preferred_username: "Bruno.Lima@Escola.edu.br" });
const e2 = await (await eu({ request: req("/api/eu", B.sessao, "*/*"), env })).json();
ok("/api/eu: papel AreaAdaptada liga a área adaptada", e2.adaptada === true && e2.email === "bruno.lima@escola.edu.br", JSON.stringify(e2));
// 5. recusas
ok("Conta de fora da escola é recusada", (await login({ preferred_username: "ana@gmail.com" })).r2.status === 403);
ok("Token de outro locatário é recusado", (await login({ tid: "outra-escola" })).r2.status === 400);
ok("Nonce trocado é recusado", (await login({ nonce: "falso" })).r2.status === 400);
ok("Token vencido é recusado", (await login({ exp: Date.now() / 1000 - 10 })).r2.status === 400);
const semFluxo = await retorno({ request: req("/auth/retorno?code=abc&state=xyz"), env });
ok("Retorno sem o cookie do fluxo é recusado", semFluxo.status === 400);
ok("Volta para fora do site vira /enem/", (await login({}, "//malicioso.com")).r2.headers.get("Location") === "/enem/");
const adulterada = A.sessao.replace(/sr_sess=([^.]+)\./, (m, c) => "sr_sess=" + c.slice(0, -2) + "xx.");
ok("Sessão adulterada é recusada", (await middleware({ request: req("/enem/", adulterada), env, next: fakeNext })).status === 302);
// 6. sair
const s1 = await sair({ request: req("/auth/sair"), env });
ok("Sair apaga a sessão e encerra na Microsoft", s1.status === 302 && /sr_sess=;/.test(s1.headers.get("Set-Cookie")) && s1.headers.get("Location").includes("/oauth2/v2.0/logout"));

res.forEach(([s, n, d]) => console.log(s + " · " + n + (d && s === "FALHOU" ? " · " + d : "")));
process.exitCode = res.every(r => r[0] === "PASSOU") ? 0 : 1;
