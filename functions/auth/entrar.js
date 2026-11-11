/* Início do login: manda o aluno para a página de login da Microsoft da escola
   (fluxo de código de autorização com PKCE, state e nonce). */
import { configurado, aleatorio, sha256, assinar, cookie, FLUXO, urlMs, retorno, voltaSegura, pagina } from "../_lib/sessao.js";

export async function onRequestGet({ request, env }) {
  if (!configurado(env)) return pagina("Login ainda não configurado", "O login com a conta da escola ainda não foi ativado neste site.", 404);
  const url = new URL(request.url);
  const state = aleatorio(), nonce = aleatorio(), verifier = aleatorio(48);
  const fluxo = await assinar({ state, nonce, verifier, volta: voltaSegura(url.searchParams.get("volta")), exp: Math.floor(Date.now() / 1000) + 600 }, env);
  const p = new URLSearchParams({
    client_id: env.MS_CLIENT_ID, response_type: "code", redirect_uri: retorno(request, env), response_mode: "query",
    scope: "openid profile email", state, nonce, code_challenge: await sha256(verifier), code_challenge_method: "S256",
    domain_hint: env.DOMINIO, prompt: "select_account"
  });
  return new Response(null, { status: 302, headers: { Location: urlMs(env, "authorize") + "?" + p, "Set-Cookie": cookie(FLUXO, fluxo, 600, "/auth"), "Cache-Control": "no-store" } });
}
