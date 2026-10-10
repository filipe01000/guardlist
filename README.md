# GuardList

Aplicação React + TypeScript para administrar listas de bloqueio, importar e validar indicadores, identificar ocorrências entre clientes e exportar dados. A persistência desta versão é local, no IndexedDB do navegador.

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

Para validar a versão de produção:

```bash
npm run lint
npm run build
```

## Deploy no Render

O repositório já inclui `render.yaml`. No Render, use **New → Blueprint** apontando para o repositório, ou crie um **Web Service** manualmente com:

- Build Command: `npm ci --include=dev && npm run build`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Variáveis de ambiente (definidas no painel, nunca no repositório):

- `APP_USERS`: usuários que podem entrar. Sem ela, qualquer pessoa com a URL acessa o app e consome a cota das APIs.
- `SESSION_SECRET`: assina as sessões de login. O `render.yaml` já gera um valor aleatório.
- `ABUSEIPDB_API_KEY`, `GREYNOISE_API_KEY`, `OTX_API_KEY`: integrações CTI (opcionais).
- `CTI_RATE_LIMIT_PER_MIN` (padrão 30) e `ABUSE_SUMMARY_RATE_LIMIT_PER_MIN` (padrão 120): limites por IP.

### Usuários

Para criar um usuário, rode localmente:

```bash
npm run user:add -- maria
```

O comando pede a senha (mínimo de 10 caracteres) sem mostrá-la e imprime uma linha como `maria:scrypt:...`. Cole essa linha em `APP_USERS` no Render; para vários usuários, separe as linhas por vírgula. Para tirar o acesso de alguém, remova a entrada dessa pessoa: as sessões dela deixam de valer quando o serviço reinicia com a nova variável.

Não defina `HOST` no Render; em produção o servidor já escuta em `0.0.0.0` e usa a `PORT` fornecida pela plataforma.

Os dados ficam no IndexedDB de cada navegador, não no servidor: cada máquina tem sua própria base. Use o backup JSON para transferir ou guardar os dados.

## Limitações das integrações CTI

As ocorrências e correlações entre clientes são calculadas com os dados locais reais do aplicativo. Quando uma chave não está configurada, os campos correspondentes permanecem demonstrativos e aparecem identificados como tal na interface. Quando o provedor responde, a interface substitui esses campos pelos dados reais e mostra o estado individual da conexão.

Para dados CTI reais, use um backend autenticado que mantenha as chaves fora do navegador, aplique limites de requisição, cache e tratamento de erros. AbuseIPDB e GreyNoise exigem chaves para consultas completas; o AlienVault OTX também usa chave para recursos autenticados e limites adequados. Nunca coloque essas chaves em variáveis `VITE_*`, porque elas ficam visíveis no JavaScript entregue ao usuário.

Os links externos do dossiê abrem páginas públicas de investigação para o indicador selecionado, mas não substituem uma integração de API.
