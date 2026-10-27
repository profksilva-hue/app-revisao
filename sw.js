/* Service worker do app de Revisão.
   - Guarda a "casca" do app no celular na primeira visita (funciona offline).
   - As listas de cada aula (enem/of/aN.json) são guardadas conforme o aluno abre a aula.
   - Sempre que você publicar uma atualização, MUDE A VERSÃO abaixo (ex.: v2, v3...).
     Assim os celulares dos alunos baixam a versão nova. */
const VERSAO = "revisao-v1";

const CASCA = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon-32.png",
  "./enem/",
  "./enem/index.html",
  "./pas/",
  "./pas/index.html"
];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(VERSAO).then(c => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Páginas: tenta a rede primeiro (conteúdo sempre atualizado) e cai no cache se estiver offline.
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req).then(r => { const c = r.clone(); caches.open(VERSAO).then(x => x.put(req, c)); return r; })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // Listas das aulas, ícones, fontes e bibliotecas: usa o cache e atualiza em segundo plano.
  const mesmoSite = url.origin === self.location.origin;
  const cdn = /fonts\.(googleapis|gstatic)\.com$|cdnjs\.cloudflare\.com$/.test(url.hostname);
  if (mesmoSite || cdn) {
    ev.respondWith(
      caches.open(VERSAO).then(cache =>
        cache.match(req).then(hit => {
          const rede = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()); return r; })
            .catch(() => hit);
          return hit || rede;
        })
      )
    );
  }
});
