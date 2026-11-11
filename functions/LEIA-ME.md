# Login com a conta Microsoft da escola (Cloudflare Pages Functions)

Estas funções só rodam quando o site é publicado pelo Cloudflare ligado ao repositório (Git) ou pela
ferramenta `wrangler`. No envio por arquivo zip elas não funcionam, e o site segue com o login por e-mail.

## Variáveis no Cloudflare (Configurações → Variáveis e segredos)

| Nome | O que é | Tipo |
| --- | --- | --- |
| `MS_TENANT_ID` | ID do locatário (diretório) da escola no Microsoft Entra | texto |
| `MS_CLIENT_ID` | ID do aplicativo "Santa Revisão" registrado pela TI | texto |
| `MS_CLIENT_SECRET` | Valor do segredo do aplicativo | **segredo** |
| `SESSION_SECRET` | Texto aleatório com 32 caracteres ou mais, só do site | **segredo** |
| `DOMINIO` | Domínio dos e-mails da escola (ex.: `escola.edu.br`) | texto |
| `SITE_URL` | Endereço do site (ex.: `https://santa-revisao-teste.pages.dev`) | texto |
| `PAPEL_ADAPTADA` | Valor da função do aplicativo para a área adaptada (padrão: `AreaAdaptada`) | texto |

Sem `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SESSION_SECRET` e `DOMINIO`, nada muda no site.

## Rotas

- `/auth/entrar` → login na Microsoft (código de autorização com PKCE, state e nonce)
- `/auth/retorno` → confere o token, o domínio e a função "Área adaptada" e cria a sessão (cookie assinado, 7 dias)
- `/auth/sair` → apaga a sessão e encerra o login na Microsoft
- `/api/eu` → `{ email, adaptada }` para o app (sem diagnóstico, sem nome)
- `_middleware.js` → exige a sessão em todas as páginas e arquivos do site

Testes sem rede: `node testes/login.test.mjs`.
