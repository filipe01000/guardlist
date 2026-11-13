# DonutVault — instruções para quem mexer no código

Gerenciador de senhas zero-knowledge. O cofre é cifrado no navegador (Argon2id + AES-256-GCM, chaves
derivadas com HKDF) e o servidor só guarda dados cifrados. Visão geral no `README.md`, deploy no
`DEPLOYMENT.md`.

## Validar antes de cada commit

```bash
docker compose up -d
export DATABASE_URL= SQL_HOST=127.0.0.1 PGPORT=55432 SQL_USER=postgres SQL_PASSWORD=dvtest SQL_DB_NAME=dvtest
npm run db:migrate
npx tsc --noEmit
npm test
npx vite build
```

## Regras

- Nunca rodar testes, migrações ou scripts contra o banco de produção (Neon). Nunca criar dados de
  teste em produção. Não fazer deploy nem push sem o dono pedir.
- Commits no estilo do histórico (`git log`): assunto em inglês no imperativo e corpo com tópicos
  explicando o quê e o porquê.
- Comentários e textos de interface em português, claros e calmos, sem jargão na interface. O visual
  segue o do GuardList, com toques dos anos 90 (desenho em `docs/superpowers/specs/`), e momentos de
  risco são tratados com seriedade.
- O cofre vive dentro do repositório do GuardList, na pasta `cofre/`, e é servido pelo mesmo serviço
  do Render em `/cofre`. Ele tem banco próprio (`DONUTVAULT_DATABASE_URL`) e nunca usa o
  `DATABASE_URL` do GuardList, que é o banco da equipe. Não importar código do GuardList aqui dentro.
- Chamadas à API usam `API_BASE` (`src/lib/apiBase.ts`); os cookies de sessão seguem o ponto de
  montagem (`sessionCookiePath`). Nunca escrever `/api/v1` fixo no cliente.

## Não quebrar

- Nada sai do navegador em texto puro: senhas, notas, DEK, KEK e chaves. O servidor recusa campos
  sensíveis (`enforceZeroPlaintextBodyGuard` em `src/middleware/auth.ts`).
- O IP do cliente vem só de `extractClientIp` (`src/middleware/clientIp.ts`). No Render vale o
  `cf-connecting-ip`; o `X-Forwarded-For` só conta vindo de proxy confiável (`TRUST_PROXY`). Nunca ler
  `req.headers['x-forwarded-for']` direto.
- O anti-scanner só isenta uma sessão depois de conferi-la no banco (`isSessionClaimVerified`).
- Conta existente só ganha aparelho novo com prova de posse: sessão válida (cookie, ou `Authorization`
  + `X-Device-Id`), token de reconexão (`vaultReauthToken`) ou passkey.
- `users.reauth_verifier_sha256` é gravado uma única vez e nunca sobrescrito. Trocar a chave do cofre
  (`POST /api/v1/sync/vault` com época, DEK cifrada, sal, nonce ou Argon2 diferentes) exige esse token
  quando a conta já tem um (`assertVaultKeyChangeAllowed`).
- O pacote de recuperação só sai com `recoveryAuthToken`; o servidor guarda apenas o hash.
- O consumo de desafios WebAuthn e o avanço do contador de passkey são atômicos (UPDATE condicional).
- `settings.syncReauthSecretHex` nunca pode sumir do cofre. Toda gravação parte do cofre mais recente:
  no `App.tsx`, use `unlockedPayloadRef` e `storedEnvelopeRef`, não o estado capturado por efeitos, e
  mescle registros remotos com `mergeRemoteRecords` (`src/utils/syncMerge.ts`).
- A CSP da página vem do servidor (`securityHeadersAndAntiFingerprintMiddleware`). Em produção não há
  script inline. Não recolocar CSP no `index.html` nem `'unsafe-inline'` em `script-src`.
- O medidor de força (zxcvbn) carrega sob demanda (`src/utils/strengthEngine.ts`). Antes de checar a
  Senha Mestra, espere `loadStrengthEngine()`. Sem o medidor, `checkMasterPasswordPolicy` recusa a
  senha; nunca aprova por omissão.

## Decisões aceitas (não "corrigir")

- O mesmo navegador renova a própria sessão a cada desbloqueio e o token antigo deixa de valer. Uma
  segunda aba aberta para de sincronizar até ser recarregada.
- Cada conta tem no máximo 20 sessões ativas; as usadas há mais tempo são revogadas.
- Contas criadas antes do token de reconexão podem trocar a chave do cofre sem ele até gravarem o seu,
  o que acontece no próximo desbloqueio com sessão válida.
- Kits de emergência anteriores à `cdd5527` precisam ser gerados de novo. A tela do kit foi removida.
- A auditoria de eventos anônimos é amostrada: um por tipo e origem a cada 10 minutos.
- O arquivo do zxcvbn passa de 500 kB (é quase todo dicionário); por isso o limite de aviso do build
  é 900 kB. O pacote principal fica abaixo de 500 kB.
