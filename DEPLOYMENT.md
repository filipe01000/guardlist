# Homologação: Render Free + Neon Free

Node.js 24.22.1. Código identificado como DonutVault 0.9.3 pelo proprietário.

## Render

- Novo Web Service `donutvault-hml`, runtime Node, região Ohio, plano **Free**.
- Build: `npm ci --include=dev && npm run build && npm prune --omit=dev`.
- Start: `npm start`.
- Health check: `/healthz`. Verifica o processo sem acordar PostgreSQL a cada sondagem.
- Auto-deploy: desativado. Não configurar disco, worker ou banco Render.
- Variáveis: `NODE_ENV=production` e `DATABASE_URL` do Neon como segredo.
- WebAuthn: o RP ID e a origem são definidos pelo servidor, nunca pelo cliente. No Render,
  `RENDER_EXTERNAL_URL` já basta. Em domínio próprio, defina `WEBAUTHN_RP_ID` (ex.: `vault.filipeti.com.br`)
  e `WEBAUTHN_ORIGIN` (ex.: `https://vault.filipeti.com.br`). Em produção sem nenhuma delas, as rotas de
  passkey respondem 500 em vez de aceitar qualquer origem.
- Pareamento: um novo dispositivo só entra em conta existente com a sessão de um dispositivo já autorizado
  (cabeçalhos `Authorization` + `X-Device-Id` ou cookie HttpOnly) ou por passkey.
- Sessões: o mesmo navegador renova a própria sessão a cada desbloqueio (o token anterior deixa de valer).
  Cada conta tem no máximo 20 sessões ativas; ao passar disso, as usadas há mais tempo são revogadas.
- Reconexão: com a sessão vencida (30 dias sem abrir o app), o navegador volta a sincronizar provando a
  posse do cofre com um token que sai de um segredo guardado dentro do cofre cifrado. O servidor guarda
  só o hash, gravado uma vez por conta (no primeiro aparelho ou por um aparelho com sessão válida).
  Trocar a chave do cofre (troca de Senha Mestra) também exige esse token quando a conta já tem um.
- CSP: definida pelo servidor, por cabeçalho. Em produção não há script inline; no desenvolvimento o
  Vite precisa de script e estilo inline e de WebSocket, e a política se ajusta pelo `NODE_ENV`.
- IP do cliente: no Render vale o `CF-Connecting-IP`, posto pela Cloudflare, que recusa esse cabeçalho
  quando vem do cliente. O `X-Forwarded-For` só conta quando vem de proxy confiável (`TRUST_PROXY`,
  padrão `loopback`). Fora do Render, atrás da Cloudflare, defina `CLIENT_IP_HEADER=cf-connecting-ip`;
  atrás de outro proxy, `TRUST_PROXY` com o número de saltos. Se o cabeçalho configurado faltar, o log
  mostra `[client-ip]` e o servidor usa o endereço da conexão.
- Kit de Emergência: o pacote de recuperação só sai com o token derivado da Chave de Recuperação
  (o servidor guarda apenas o hash). Kits gerados antes desta versão precisam ser gerados de novo.
- O GuardList usa outro serviço e repositório; não é alterado por este projeto.

## Banco

Projeto Neon `donutvault-hml`, organização Free, Ohio. Use conexão direta com TLS; a aplicação valida o certificado. O arquivo `.env` é somente local e fica ignorado pelo Git. Não colocar senhas no repositório.

`npm start` aplica as migrações versionadas antes de iniciar o servidor. Uma falha impede a inicialização. A migração inicial cria nove tabelas e pode ser executada novamente sem repetir o esquema.

Para alterações futuras: `npm run db:generate -- --name nome_da_alteracao`, revisar o SQL gerado e versionar a pasta `drizzle`.

## Validação

`npm run lint`, `npm run build`, `node scripts/test-db-config.ts` e `npm test`.

Os testes de integração criam dados fictícios no banco indicado por `DATABASE_URL`. Use um banco de validação separado; não execute a suíte contra um banco com dados reais. A aplicação é um protótipo para homologação e não foi submetida a auditoria independente.

Render Free pode dormir após inatividade; o Neon Free também pode suspender compute. As franquias devem ser acompanhadas no painel. Não fazer upgrades pagos automaticamente.
