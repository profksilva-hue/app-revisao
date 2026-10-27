# App de Revisão de Matemática: ENEM e PAS

Este é o app de revisão do ENEM e do PAS/UnB em formato **PWA**: um site que o aluno instala na tela inicial do celular e que funciona sem internet depois da primeira visita.

## O que tem na pasta

```
app-revisao/
├── index.html            → tela inicial (escolha entre ENEM e PAS)
├── manifest.webmanifest  → "carteira de identidade" do app (nome, cor, ícones)
├── sw.js                 → service worker: guarda o app no celular para uso offline
├── icons/                → ícones do app (tela inicial, aba do navegador, iPhone)
├── enem/
│   ├── index.html        → o app de revisão do ENEM (12 aulas)
│   └── of/a1.json … a12.json → imagens das questões oficiais de cada aula
├── pas/
│   └── index.html        → o app de revisão do PAS (PAS 1, 2 e 3, 12 aulas por etapa)
└── .nojekyll             → arquivo vazio exigido pelo GitHub Pages; não apague
```

## Onde desenvolver e publicar: GitHub

O GitHub resolve tudo num lugar só, de graça: guarda os arquivos, permite editar pelo navegador e publica o site (GitHub Pages).

### 1. Criar a conta e o repositório
1. Crie uma conta em **github.com**.
2. Clique em **New repository**, dê o nome `revisao`, marque **Public** e clique em **Create repository**.

### 2. Subir os arquivos
1. Na página do repositório, clique em **uploading an existing file**.
2. Descompacte o .zip no computador e **arraste o conteúdo da pasta `app-revisao`** (não a pasta em si) para a janela.
3. Clique em **Commit changes**.

### 3. Publicar
1. Vá em **Settings → Pages**.
2. Em *Branch*, escolha `main` e a pasta `/ (root)` e clique em **Save**.
3. Em 1 a 2 minutos o app estará no ar em:
   `https://SEU-USUARIO.github.io/revisao/`

Esse é o link (ou o QR code) que você passa para os alunos.

### 4. Editar pelo navegador
Na página do repositório, aperte a tecla **`.`** (ponto). Abre o **github.dev**, um editor completo (o mesmo VS Code) direto no navegador, sem instalar nada. Edite, clique em *Source Control → Commit & Push* e o site se atualiza sozinho.

## Toda vez que atualizar o app

Abra `sw.js` e troque a versão na linha:

```js
const VERSAO = "revisao-v1";   // → "revisao-v2", "revisao-v3"...
```

Sem isso, os celulares que já instalaram o app podem continuar mostrando a versão antiga.

## O que muda em relação à versão do Claude

- **Progresso separado:** o ENEM guarda com o prefixo `enem26-rev-v1` e o PAS com `pas26-rev-v1`, então um não apaga o outro.
- **Funciona igual:** aulas, resumos, listas, sorteio de questões, correção, relatório em PDF, calendário e progresso por e-mail.
- **O progresso fica salvo no aparelho do aluno**, não num servidor. O recurso "código de progresso" continua servindo para levar o progresso de um aparelho para outro.
- **O painel do professor (ver o progresso da turma) não funciona fora do Claude.** Ele usava o banco de dados do artifact. Para ter isso no app publicado, o próximo passo é ligar um banco de dados gratuito, como o Supabase ou o Firebase.

## Testar no computador antes de publicar

O app precisa ser aberto por um servidor (não basta dar dois cliques no arquivo). Com o Python instalado, rode dentro da pasta:

```
python -m http.server 8000
```

e abra `http://localhost:8000` no navegador.

## Cuidado ao trocar o arquivo de um app

Todo `index.html` dos apps precisa terminar com `</body>` e `</html>`. O Live Server do VS Code injeta um script de recarga logo antes de `</body>`; quando essa tag não existe, ele injeta no primeiro `</svg>` que encontrar, que pode estar dentro do código do app, e o código aparece escrito na tela.
