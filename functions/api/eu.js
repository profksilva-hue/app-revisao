/* Quem está logado: o app lê isto para entrar sozinho com o e-mail da escola e saber se abre a área adaptada.
   Resposta mínima: e-mail e um sim/não. Nunca o motivo. */
import { configurado, lerSessao } from "../_lib/sessao.js";

export async function onRequestGet({ request, env }) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (!configurado(env)) return json({ sso: false }, 404);
  const s = await lerSessao(request, env);
  if (!s) return json({ erro: "sessao" }, 401);
  return json({ sso: true, email: s.email, adaptada: !!s.ad });
}
