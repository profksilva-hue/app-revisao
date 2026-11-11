/* Exige a conta da escola em todas as páginas e arquivos do site (exceto as rotas de login).
   Sem as chaves configuradas, o site funciona exatamente como hoje (login pelo e-mail no app). */
import { configurado, lerSessao } from "./_lib/sessao.js";

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  if (!configurado(env)) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith("/auth/")) return next();
  if (await lerSessao(request, env)) return next();
  const pagina = request.method === "GET" && (request.headers.get("Accept") || "").includes("text/html");
  if (pagina) return Response.redirect(new URL("/auth/entrar?volta=" + encodeURIComponent(url.pathname + url.search), url).toString(), 302);
  return new Response(JSON.stringify({ erro: "sessao" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
