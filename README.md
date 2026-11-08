# DonutVault

Gerenciador de senhas zero-knowledge com cara de desenho animado dos anos 90.

- O cofre é cifrado no navegador (AES-256-GCM). A chave sai da Senha Mestra pelo Argon2id.
- O servidor guarda só dados cifrados e nunca recebe a Senha Mestra nem as chaves.
- A sincronização é opcional: dá para usar só no navegador ou exportar um backup cifrado.

Stack: React + Vite no cliente, Express no servidor, Postgres com Drizzle.

Projeto independente, ainda sem auditoria externa.

## Rodar localmente

Requisitos: Node 24 e Docker.

1. Instale as dependências: `npm ci`
2. Suba os bancos locais: `docker compose up -d`
   - Desenvolvimento em `127.0.0.1:55433`.
   - Testes em `127.0.0.1:55432`.
3. Crie o `.env` a partir do `.env.example`, com:

   ```
   DATABASE_URL=postgres://postgres:donutvault@127.0.0.1:55433/donutvault_local
   NODE_ENV=development
   PORT=3000
   ```

4. Aplique as migrações: `npm run db:migrate`
5. Rode: `npm run dev` e abra http://localhost:3000

## Testes

Os testes gravam dados no banco indicado, então use sempre o banco de teste e nunca o de produção:

```bash
export DATABASE_URL= SQL_HOST=127.0.0.1 PGPORT=55432 SQL_USER=postgres SQL_PASSWORD=dvtest SQL_DB_NAME=dvtest
npm run db:migrate
npm test
```

O `DATABASE_URL` vazio faz o app usar as variáveis `SQL_*` em vez do valor do `.env`.

Antes de enviar mudanças, rode também `npx tsc --noEmit` e `npx vite build`.

## Banco de dados

- Mudança no esquema: `npm run db:generate -- --name nome_da_mudanca`, revisar o SQL gerado e versionar
  a pasta `drizzle/`.
- O `npm start` aplica as migrações antes de subir o servidor.

## Deploy

Render (plano gratuito, deploy manual) com Postgres no Neon. Passo a passo, variáveis e decisões de
segurança estão no [DEPLOYMENT.md](DEPLOYMENT.md).
