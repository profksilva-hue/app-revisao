/* Volta da Microsoft: troca o código pelo token de identidade, confere quem é o aluno e cria a sessão.
   O token vem direto do endpoint da Microsoft por TLS, com o segredo do aplicativo (cliente confidencial);
   por isso conferimos emissor, público, locatário, validade e nonce (OpenID Connect, seção 3.1.3.7). */
import { configurado, verificar, assinar, cookies, cookie, deB64u, FLUXO, SESSAO, DURACAO, urlMs, retorno, pagina } from "../_lib/sessao.js";

export async function onRequestGet({ request, env }) {
  if (!configurado(env)) return pagina("Login ainda não configurado", "O login com a conta da escola ainda não foi ativado neste site.", 404);
  const url = new URL(request.url), q = url.searchParams;
  if (q.get("error")) return pagina("Não foi possível entrar", "A Microsoft não concluiu o login. Tente de novo com a sua conta da escola.", 400);
  const fluxo = await verificar(cookies(request)[FLUXO], env);
  if (!fluxo || !q.get("code") || q.get("state") !== fluxo.state) return pagina("Login expirado", "O login demorou demais ou foi aberto em outra aba. Tente de novo.", 400);

  const r = await fetch(urlMs(env, "token"), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: "authorization_code", code: q.get("code"), redirect_uri: retorno(request, env), code_verifier: fluxo.verifier, scope: "openid profile email" })
  });
  if (!r.ok) return pagina("Não foi possível entrar", "A Microsoft recusou o login. Tente de novo; se continuar, avise o professor.", 502);
  const tok = await r.json();
  let id; try { id = JSON.parse(deB64u(String(tok.id_token).split(".")[1])); } catch (e) { return pagina("Não foi possível entrar", "Resposta inesperada da Microsoft.", 502); }
  const agora = Date.now() / 1000;
  const ok = id && id.aud === env.MS_CLIENT_ID && id.tid === env.MS_TENANT_ID && id.iss === `https://login.microsoftonline.com/${env.MS_TENANT_ID}/v2.0`
    && typeof id.exp === "number" && id.exp > agora && id.nonce === fluxo.nonce;
  if (!ok) return pagina("Não foi possível entrar", "Não conseguimos confirmar o seu login. Tente de novo.", 400);
  const email = String(id.email || id.preferred_username || "").trim().toLowerCase();
  if (!email.endsWith("@" + String(env.DOMINIO).toLowerCase())) return pagina("Use a conta da escola", "Este site é só para contas da escola. Entre com o seu e-mail institucional.", 403);
  // Área adaptada: papel do aplicativo atribuído pela escola ao grupo (Entra ID → Aplicativos empresariais → Usuários e grupos).
  // Dois níveis: AreaAdaptada (apoio 1) e ApoioAmpliado (apoio 2, inclui o 1). Só o nível vai para a sessão, nunca o motivo.
  const papeis = Array.isArray(id.roles) ? id.roles : [];
  const ad = papeis.includes(env.PAPEL_AMPLIADO || "ApoioAmpliado") ? 2 : papeis.includes(env.PAPEL_ADAPTADA || "AreaAdaptada") ? 1 : 0;
  const sessao = await assinar({ email, ad, exp: Math.floor(agora) + DURACAO }, env);
  const h = new Headers({ Location: fluxo.volta, "Cache-Control": "no-store" });
  h.append("Set-Cookie", cookie(SESSAO, sessao, DURACAO));
  h.append("Set-Cookie", cookie(FLUXO, "", 0, "/auth"));
  return new Response(null, { status: 302, headers: h });
}
