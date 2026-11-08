# DonutVault — o que falta fazer

Pedido de continuação. Leia tudo antes de começar: as seções "Regras", "Não quebrar" e "Decisões
aceitas" valem para todas as tarefas.

## O projeto

Gerenciador de senhas zero-knowledge. O cofre é cifrado no navegador (Argon2id + AES-256-GCM, chaves
derivadas com HKDF) e o servidor só guarda dados cifrados.

- Cliente: React + Vite (`src/App.tsx`, `src/components/`, `src/services/`).
- Servidor: Express (`server.ts`, `src/server/syncRoutes.ts`, `src/middleware/`).
- Banco: Postgres com Drizzle (`src/db/schema.ts`, `src/db/repository.ts`, migrações em `drizzle/`).
- Repositório: https://github.com/filipe01000/donutvault-hml, branch `main`. Em produção está a
  `32f5da2` (Render, deploy manual + Neon).
- O guia de deploy atualizado é o `DEPLOYMENT.md`.

## Como rodar e validar

Node 24. Os testes precisam de um Postgres próprio para teste:

```bash
npm ci
docker run -d --name dv-test-pg -e POSTGRES_PASSWORD=dvtest -e POSTGRES_DB=dvtest -p 55432:5432 postgres:16-alpine
export DATABASE_URL= SQL_HOST=127.0.0.1 PGPORT=55432 SQL_USER=postgres SQL_PASSWORD=dvtest SQL_DB_NAME=dvtest
npm run db:migrate
npm test          # 76 testes hoje; eles gravam dados no banco indicado
npx tsc --noEmit
npx vite build
```

- Servidor local: `.env` com `DATABASE_URL` de um Postgres local, `npm run db:migrate` e
  `npx tsx server.ts` (porta em `PORT`).
- Migração nova: `npm run db:generate -- --name nome_da_mudanca`, revisar o SQL e versionar a pasta
  `drizzle/`. O `npm start` aplica as migrações antes de subir o servidor.

## Regras

- Nunca rodar testes, migrações ou scripts contra o banco de produção (Neon). Nunca criar dados de
  teste em produção. Não fazer deploy.
- Antes de cada commit: `npx tsc --noEmit`, `npm test` e `npx vite build` passando.
- Um commit por tarefa, no estilo do histórico (`git log`): assunto em inglês no imperativo e corpo
  com tópicos explicando o quê e o porquê. Não fazer push nem merge na `main` sem o dono pedir.
- Comentários e textos de interface em português, claros e calmos, sem jargão na interface.
  O visual é de desenho animado, mas momentos de risco são tratados com seriedade.
- Não mexer no GuardList (é outro serviço, em outro repositório).

## Não quebrar (regras de segurança já implantadas)

- Nada sai do navegador em texto puro: senhas, notas, DEK, KEK e chaves. O servidor recusa campos
  sensíveis (`enforceZeroPlaintextBodyGuard` em `src/middleware/auth.ts`).
- O IP do cliente vem só de `extractClientIp` (`src/middleware/clientIp.ts`). No Render vale o
  `cf-connecting-ip`; o `X-Forwarded-For` só conta vindo de proxy confiável (`TRUST_PROXY`). Nunca ler
  `req.headers['x-forwarded-for']` direto.
- O anti-scanner só isenta uma sessão depois de conferi-la no banco (`isSessionClaimVerified`), nunca
  pela simples presença de cookie ou cabeçalho.
- Uma conta existente só ganha aparelho novo com prova de posse: sessão válida (cookie, ou
  `Authorization` + `X-Device-Id`), token de reconexão (`vaultReauthToken`) ou passkey.
- `users.reauth_verifier_sha256` é gravado uma única vez e nunca sobrescrito.
- O pacote de recuperação só sai com `recoveryAuthToken`; o servidor guarda apenas o hash.
- O consumo de desafios WebAuthn e o avanço do contador de passkey são atômicos (UPDATE condicional).
- `settings.syncReauthSecretHex` nunca pode sumir do cofre. Toda gravação do cofre tem de partir do
  conteúdo mais recente. Sem esse segredo, o navegador não volta a sincronizar quando a sessão vence.

## Decisões aceitas (não "corrigir")

- O mesmo navegador renova a própria sessão a cada desbloqueio e o token antigo deixa de valer. Uma
  segunda aba aberta para de sincronizar até ser recarregada.
- Cada conta tem no máximo 20 sessões ativas; as usadas há mais tempo são revogadas.
- Kits de emergência anteriores à `cdd5527` precisam ser gerados de novo. A tela do kit foi removida.
- A auditoria de eventos anônimos é amostrada: um por tipo e origem a cada 10 minutos.

## Tarefas (em ordem de importância)

### 1. Sincronização pode gravar por cima de alterações locais (confirmar e corrigir)

- **Onde:** `src/App.tsx`. O `executeIncrementalSync` mescla os registros recebidos sobre o cofre que
  recebeu e grava o resultado. O efeito que cadastra o aparelho e abre o SSE guarda essa função e a
  chama no `eventSource.onmessage`. A função guardada é a do momento do desbloqueio, então o
  `unlockedPayload` e o `storedEnvelope` que ela usa podem estar velhos.
- **Risco:** uma alteração feita depois do desbloqueio (senha nova, configuração) pode sumir quando
  chega uma atualização de outro aparelho.
- **Fazer:** primeiro reproduzir o problema. Se confirmar, fazer a mescla sempre ler o estado mais
  recente, por exemplo com refs para o cofre e o envelope atuais. De preferência, extrair a mescla
  para uma função pura em `src/utils/`, com testes `node --test`.
- **Pronto quando:** uma alteração local feita depois do desbloqueio sobrevive a uma atualização
  remota, há teste automatizado da mescla e o `settings.syncReauthSecretHex` é preservado.

### 2. Qualquer sessão consegue travar a sincronização do dono

- **Onde:** `POST /api/v1/sync/vault` (`src/server/syncRoutes.ts`) chama
  `registerOrUpdateVaultMetadataInDb` (`src/db/repository.ts`). Qualquer sessão válida da conta pode
  gravar um `activeKeyEpoch` maior e outro `wrappedDekHex`. Depois disso o cliente do dono recebe 409
  (anti-rollback) em toda sincronização.
- **Ideia:** exigir prova de posse do cofre para mudar `activeKeyEpoch`, `wrappedDekHex`, `saltHex`,
  `dekNonceHex` ou `kdfParams`. A prova já existe:
  - o cliente deriva o token com
    `CryptoEngine.deriveVaultReauthToken(settings.syncReauthSecretHex, vaultId)`;
  - o servidor confere com `verifyUserReauthTokenInDb`.

  Contas ainda sem verificador gravado precisam de uma regra de transição.
- **Atenção:** a troca de Senha Mestra gera DEK nova e `keyEpoch + 1` (`rotateMasterPassword` chama
  `sealNewVault`). Esse fluxo legítimo tem de continuar sincronizando.
- **Pronto quando:** uma sessão sem a prova recebe 403 ao tentar mudar esses campos, a troca de senha
  do dono continua sincronizando e há testes de integração.

### 3. CSP com `'unsafe-inline'`

- **Onde:** o `index.html` tem `<meta http-equiv="Content-Security-Policy">` com
  `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
  e `connect-src 'self' ws: wss:`. O servidor (`securityHeadersAndAntiFingerprintMiddleware` em
  `src/middleware/reconDefense.ts`) só manda CSP nas rotas `/api/`.
- **Fazer:** em produção, mandar a CSP do HTML por cabeçalho HTTP, com:
  - `script-src` sem `'unsafe-inline'`;
  - `connect-src 'self'` (o `ws:` só faz falta no dev, para o recarregamento do Vite);
  - `frame-ancestors 'none'`.

  Manter `'unsafe-inline'` em estilos só se o app realmente usar estilo inline.
- **Pronto quando:** com `npm run build` e `NODE_ENV=production npx tsx server.ts`, o app cria e
  desbloqueia um cofre e sincroniza sem erro de CSP no console do navegador.

### 4. Pacote JavaScript grande

- O `npx vite build` avisa que há arquivo acima de 500 kB. Dividir, por exemplo com `React.lazy` nas
  telas pesadas e separando bibliotecas grandes em arquivos próprios.
- **Pronto quando:** o aviso some (ou há justificativa) e a primeira tela carrega menos JavaScript.

### 5. Documentação desatualizada

- O `README.md`, o `docker-compose.yml` e o começo do `.env.example` ainda falam de AI Studio, Gemini
  e Cloud SQL.
- **Fazer:** atualizar para Render, Neon e Postgres local no Docker, com as variáveis atuais
  (`DATABASE_URL`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `CLIENT_IP_HEADER`, `TRUST_PROXY`) e como rodar
  os testes. Use o `DEPLOYMENT.md` como fonte.

### 6. Sobras sem uso

- Remover a dependência `@google/genai` (nenhum arquivo a importa) com `npm uninstall @google/genai`,
  e o `metadata.json` do AI Studio (nada o lê). Confirmar com uma busca antes de apagar.

### 7. Pastas fora do Git

- Acrescentar ao `.gitignore` as pastas de ferramentas locais `.impeccable/`, `.omc/` e `.claude/`.
- A pasta `marketing/` (carrossel do LinkedIn) fica a critério do dono: perguntar antes e não apagar.

## Fica com o dono (não é tarefa de código)

- Verificar em produção que uma prova de reconexão errada é recusada. Isso exige uma conta que já
  exista, e não se deve criar dados de teste no Neon.
- Publicar o post do LinkedIn.
- Fazer o deploy no Render (manual, pelo painel) depois de revisar e enviar os commits.
