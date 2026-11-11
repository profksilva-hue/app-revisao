/* Santa Revisão · login com a conta Microsoft da escola (Cloudflare Pages Functions)
   Sessão em cookie assinado (HMAC-SHA256), sem banco de dados: guarda só o e-mail e se o aluno
   pertence ao papel da área adaptada. Nenhum diagnóstico passa por aqui. */
const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const b64uTexto = s => b64u(enc.encode(s));
export const deB64u = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return atob(s); };
export const aleatorio = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export const sha256 = async s => b64u(await crypto.subtle.digest("SHA-256", enc.encode(s)));

// Login só fica ativo quando a TI tiver entregado as chaves (variáveis de ambiente no Cloudflare).
export const configurado = env => !!(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET && env.SESSION_SECRET && env.DOMINIO);

async function chave(env) { return crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
export async function assinar(obj, env) {
  const corpo = b64uTexto(JSON.stringify(obj));
  const sig = b64u(await crypto.subtle.sign("HMAC", await chave(env), enc.encode(corpo)));
  return corpo + "." + sig;
}
export async function verificar(token, env) {
  if (!token || token.indexOf(".") < 0) return null;
  const [corpo, sig] = token.split(".");
  let bin; try { bin = Uint8Array.from(deB64u(sig), c => c.charCodeAt(0)); } catch (e) { return null; }
  const ok = await crypto.subtle.verify("HMAC", await chave(env), bin, enc.encode(corpo));
  if (!ok) return null;
  let obj; try { obj = JSON.parse(deB64u(corpo)); } catch (e) { return null; }
  if (!obj || typeof obj.exp !== "number" || obj.exp < Date.now() / 1000) return null;
  return obj;
}
export function cookies(request) {
  const out = {}; (request.headers.get("Cookie") || "").split(/;\s*/).forEach(p => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
export const cookie = (nome, valor, maxAge, path = "/") => `${nome}=${encodeURIComponent(valor)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export const SESSAO = "sr_sess", FLUXO = "sr_auth";
export const DURACAO = 7 * 24 * 3600;   // uma semana: o aluno não precisa entrar todo dia
export async function lerSessao(request, env) { return verificar(cookies(request)[SESSAO], env); }
export const voltaSegura = v => (typeof v === "string" && /^\/(?!\/)[^\s\\]*$/.test(v)) ? v : "/enem/";
export function pagina(titulo, texto, status = 400) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)}</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#F3F6F9;color:#0E2A3B}main{max-width:520px;margin:12vh auto;padding:24px;background:#fff;border:1px solid #D3DDE5;border-radius:12px}a{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:99px;background:#005084;color:#fff;text-decoration:none;font-weight:700}@media(prefers-color-scheme:dark){body{background:#0A1822;color:#E4EDF3}main{background:#10222F;border-color:#23394A}}</style></head>
<body><main><h1>${esc(titulo)}</h1><p>${esc(texto)}</p><a href="/auth/entrar">Entrar com a conta da escola</a></main></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
export const urlMs = (env, rota) => `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/${rota}`;
export const retorno = (request, env) => (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "") + "/auth/retorno";
