# GuardList

Aplicação React + TypeScript para administrar listas de bloqueio, importar e validar indicadores, identificar ocorrências entre clientes e exportar dados. Os dados ficam num banco Postgres compartilhado pela equipe (Neon em produção), e cada alteração registra quem a fez.

## Executar localmente

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

Para ativar as integrações, copie `.env.example` para `.env.local`, preencha as chaves e reinicie o servidor:

```dotenv
ABUSEIPDB_API_KEY=sua_chave
GREYNOISE_API_KEY=sua_chave
OTX_API_KEY=sua_chave
```

## Testes e validação

Para validar a versão de produção:

```bash
npm run lint
npm test
npm run build
```

`npm test` cobre autenticação, bloqueio de contas, comunicação com o backend e validação de indicadores. Também executa `server/store.integration.test.ts` e `server/pagination.test.ts`: importação append/replace, aprovação e rejeição, isolamento entre clientes, desfazer, validação e restauração de backups, rollback e paginação. Esses testes usam o schema real num PGlite descartável em memória, sem conectar ao banco da equipe nem ler `DATABASE_URL`.

## Deploy no Render

O repositório já inclui `render.yaml`. No Render, use **New → Blueprint** apontando para o repositório, ou crie um **Web Service** manualmente com:

- Build Command: `npm ci --include=dev && npm run build`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Variáveis de ambiente (definidas no painel, nunca no repositório):

- `DATABASE_URL`: connection string do Postgres da equipe (Neon). Sem ela, o servidor usa um banco local temporário que se perde a cada deploy.
- `ADMIN_INITIAL_PASSWORD`: senha provisória do primeiro administrador (usuário `admin`), trocada no primeiro acesso. Só é lida com o banco sem usuários.
- `APP_USERS` (opcional): usuários antigos no formato `usuario:scrypt:...`; com o banco vazio, viram administradores na primeira subida.
- `SESSION_SECRET`: assina as sessões de login. O `render.yaml` já gera um valor aleatório.
- `ABUSEIPDB_API_KEY`, `GREYNOISE_API_KEY`, `OTX_API_KEY`: integrações CTI (opcionais).
- `CTI_RATE_LIMIT_PER_MIN` (padrão 30) e `ABUSE_SUMMARY_RATE_LIMIT_PER_MIN` (padrão 120): limites por IP.

Não defina `HOST` no Render; em produção o servidor já escuta em `0.0.0.0` e usa a `PORT` fornecida pela plataforma.

### Banco de dados (Neon)

1. Crie uma conta em neon.tech e um projeto Postgres (região mais próxima da do Render, por exemplo US East).
2. Copie a connection string (`postgresql://...?sslmode=require`) e cole em `DATABASE_URL` no Render.
3. No primeiro deploy, o servidor cria as tabelas sozinho. Não há dados de demonstração em produção.

### Usuários e permissões

- **Administrador:** tudo, mais a área **Administração** (usuários e sessões, aprovações, auditoria, status do sistema), exceções dos clientes, regras de revisão e aprovação, e restaurar backups.
- **Analista:** importa, edita e exporta as listas de todos os clientes. "Substituir lista" e lotes acima do limite (500 itens, ajustável) ficam aguardando um administrador.

Contas novas e senhas redefinidas recebem uma senha provisória, trocada obrigatoriamente no primeiro acesso. Desativar alguém, mudar o papel ou redefinir a senha encerra na hora as sessões abertas dessa pessoa. Cada pessoa troca a própria senha e vê as próprias sessões clicando no seu nome na barra lateral. Depois de 5 senhas erradas seguidas, a conta trava por 15 minutos (um administrador pode liberar antes).

### Rotina da operação

- **Exceções por cliente:** IPs, redes ou domínios que nunca podem ser bloqueados (gateway, parceiros). A importação recusa o que bater com elas.
- **Reputação na importação:** a pré-visualização consulta AbuseIPDB, GreyNoise e OTX (até 100 IPs por vez, com cache) e marca IPs de serviços legítimos (Google, Cloudflare, Microsoft…), que por padrão não são gravados.
- **Validar lista / Validar todas as listas:** retira repetidos, IPs dentro de um CIDR da mesma lista e conflitos com exceções, sempre com uma versão salva antes.
- **Revisão de bloqueios:** bloqueios sem reaparecer nas importações e sem denúncias há mais de 90 dias (ajustável) vão para uma fila para manter ou remover.
- **Desfazer:** depois de importar, remover ou excluir, o aviso traz um botão Desfazer por alguns segundos.
- **Atalhos:** `?` mostra a lista; `Ctrl+K` ou `/` consulta vários IPs em todas as listas.

### E-mail: relatório mensal e backup diário

Defina no Render `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `REPORT_EMAILS` e `BACKUP_EMAILS` (veja `.env.example`). Com isso o servidor envia, no dia 1º, o relatório geral do mês anterior (HTML com a marca + planilha CSV) e, todo dia, um backup compactado (.json.gz). Falhas aparecem em Administração → Status do sistema e num aviso para os administradores. O Neon também permite restaurar o banco para um horário anterior (Branches → Restore); a janela disponível depende do plano.

### Migrar os dados de antes

Versões anteriores guardavam os dados no navegador de cada pessoa. Um administrador que abrir **Backup e ajustes** no navegador onde estavam esses dados vê a opção **Enviar para a equipe**. Outra forma é baixar o backup .json na versão antiga e usar **Restaurar backup**.

## Limitações das integrações CTI

As ocorrências e correlações entre clientes são calculadas com os dados locais reais do aplicativo. Quando uma chave não está configurada, os campos correspondentes permanecem demonstrativos e aparecem identificados como tal na interface. Quando o provedor responde, a interface substitui esses campos pelos dados reais e mostra o estado individual da conexão.

Para dados CTI reais, use um backend autenticado que mantenha as chaves fora do navegador, aplique limites de requisição, cache e tratamento de erros. AbuseIPDB e GreyNoise exigem chaves para consultas completas; o AlienVault OTX também usa chave para recursos autenticados e limites adequados. Nunca coloque essas chaves em variáveis `VITE_*`, porque elas ficam visíveis no JavaScript entregue ao usuário.

Os links externos do dossiê abrem páginas públicas de investigação para o indicador selecionado, mas não substituem uma integração de API.
