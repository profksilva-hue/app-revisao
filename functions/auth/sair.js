/* Sair: apaga a sessão do site e encerra o login na Microsoft. */
import { configurado, cookie, SESSAO, urlMs } from "../_lib/sessao.js";

export async function onRequestGet({ request, env }) {
  const origem = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const destino = configurado(env) ? urlMs(env, "logout") + "?post_logout_redirect_uri=" + encodeURIComponent(origem + "/") : origem + "/";
  return new Response(null, { status: 302, headers: { Location: destino, "Set-Cookie": cookie(SESSAO, "", 0), "Cache-Control": "no-store" } });
}
