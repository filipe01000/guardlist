# Sincronização com as blocklists dos clientes — design

Data: 24/10/2026
Estado: aprovado em conversa; aguardando revisão deste documento antes do plano de implementação.

## 1. Objetivo

A lista de bloqueio "oficial" de cada cliente mora num destino dele (um arquivo lido pelo firewall, um grupo de endereços na API do firewall, um arquivo num bucket etc.). O GuardList passa a poder ficar **espelhado** com esse destino: toda mudança feita no GuardList é gravada lá, e mudanças feitas direto lá entram no GuardList.

Esta etapa prepara o **servidor**: banco, motor de sincronização, contrato de conectores, segurança e API. Não há tela nova e nenhum conector de fornecedor real; esses são as próximas etapas.

### O que foi decidido

- **Opcional por cliente.** Cliente sem conexão funciona exatamente como hoje (importação, validação, exportação `.txt`/`.csv`, Copiar NANO). O uso manual nunca deixa de existir.
- **Os dois lados editam.** Mudanças feitas no destino entram no GuardList, e as feitas no GuardList vão para o destino.
- **Mudanças de fora são aplicadas e registradas.** Entram na hora, pelas regras do GuardList. Serviço legítimo ou conflito com exceção entram marcados para a Revisão de bloqueios. Tudo aparece no Histórico com a origem.
- **Qualquer tipo de destino.** O destino varia por cliente e o produto será vendido: a estrutura aceita qualquer tipo por meio de conectores, sem mudar o resto do app.
- **Arquitetura:** motor de sincronização dentro do servidor, por rodadas, que sempre regrava a lista inteira no destino (abordagem A). Pode virar um serviço separado no futuro sem reescrita.

### Fora desta etapa

- Telas (configurar conexão, ver estado, confirmar remoção em massa). A API já devolve o que elas vão precisar.
- Conectores reais (SFTP, FortiGate, Palo Alto, pfSense/OPNsense…).
- Publicar a lista por URL para o firewall puxar.
- Multi-empresa (várias empresas no mesmo servidor). Será um projeto próprio.

## 2. Dados

### 2.1 `sync_connections`

Liga um cliente a um destino. Um cliente pode ter várias.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | TEXT PK | |
| `client_id` | TEXT NOT NULL | índice |
| `type` | TEXT NOT NULL | tipo do conector, ex.: `sftp` |
| `name` | TEXT NOT NULL | nome legível, ex.: "Firewall matriz" |
| `config` | JSONB NOT NULL | campos comuns do conector (servidor, caminho, grupo…) |
| `secret` | TEXT | credencial criptografada (`v1:iv:tag:dados`, base64); nula se não houver |
| `enabled` | BOOLEAN NOT NULL DEFAULT FALSE | nasce pausada |
| `first_sync` | TEXT NOT NULL DEFAULT 'merge' | `merge`, `remote` ou `local` (seção 3.4) |
| `interval_minutes` | INTEGER NOT NULL DEFAULT 10 | conferência periódica |
| `max_removal_pct` | INTEGER NOT NULL DEFAULT 20 | trava de remoção em massa |
| `max_removal_count` | INTEGER NOT NULL DEFAULT 500 | trava de remoção em massa |
| `state` | TEXT NOT NULL DEFAULT 'paused' | `ok`, `pending`, `running`, `error`, `paused`, `blocked` |
| `dirty_since` | TIMESTAMPTZ | primeira mudança local ainda não sincronizada |
| `next_attempt_at` | TIMESTAMPTZ | próxima tentativa depois de erro |
| `failures` | INTEGER NOT NULL DEFAULT 0 | falhas seguidas |
| `last_run_at`, `last_ok_at` | TIMESTAMPTZ | |
| `last_error` | TEXT | já sem credenciais |
| `blocked_plan` | JSONB | rodada travada aguardando confirmação (seção 3.5) |
| `remote_identity` | TEXT | impressão digital confirmada do servidor (chave SSH, certificado) |
| `created_at`, `updated_at` | TIMESTAMPTZ | |
| `created_by`, `updated_by` | TEXT | |

### 2.2 `sync_bases`

Uma por conexão: a lista como ficou na última rodada bem-sucedida.

| Coluna | Tipo | Observação |
|---|---|---|
| `connection_id` | TEXT PK | |
| `indicators` | JSONB NOT NULL | lista normalizada e ordenada |
| `hash` | TEXT NOT NULL | SHA-256 da lista, para comparar rápido |
| `remote_version` | TEXT | versão do destino na última gravação/leitura, se houver |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

### 2.3 `sync_runs`

Registro de cada rodada. Ficam as últimas 200 por conexão.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `connection_id` | TEXT NOT NULL | índice com `started_at DESC` |
| `started_at`, `finished_at` | TIMESTAMPTZ | |
| `trigger` | TEXT | `change`, `interval`, `manual`, `retry` |
| `dry_run` | BOOLEAN | |
| `result` | TEXT | `ok`, `noop`, `error`, `blocked` |
| `remote_added`, `remote_removed` | INTEGER | mudanças vindas do destino |
| `local_added`, `local_removed` | INTEGER | mudanças do GuardList desde a base |
| `pushed` | INTEGER | tamanho da lista gravada (0 se não gravou) |
| `review_flagged` | INTEGER | entraram marcados para revisão |
| `unsupported` | INTEGER | itens que o destino não aceita (seção 4.3) |
| `invalid_lines` | INTEGER | linhas inválidas lidas do destino |
| `error` | TEXT | já sem credenciais |
| `detail` | JSONB | amostras (até 20 itens de cada grupo) |

### 2.4 O que já existe e ganha uso novo

- **Histórico:** registros com origem "servidor do cliente · <nome da conexão>".
- **Itens que entram de fora:** Fonte/Ticket com a marca `sync:<nome da conexão>`.
- **Versões (snapshots):** antes de aplicar mudanças de fora, uma versão é salva, como em qualquer importação; desfazer funciona igual.
- **`audit_log`:** criação, edição, troca de credencial, pausa, exclusão, confirmação de remoção em massa e rodadas com erro.

### 2.5 Regras de comparação

- "A lista" de um cliente é o conjunto de indicadores com status `active`.
- Tudo é normalizado antes de comparar: `1.2.3.4/32` vira `1.2.3.4`; IPv6 na forma canônica, com `/128` também removido; domínios em minúsculas e sem ponto final.
- Linhas vazias, comentários (`#`, `//`, `;`) e linhas inválidas do destino são contadas em `invalid_lines`, com amostra no `detail`, e **não são preservadas** quando o GuardList regrava a lista.

## 3. Motor de sincronização

Arquivo principal: `server/sync/engine.ts`. A decisão de cada rodada é uma função pura em `server/sync/plan.ts`.

### 3.1 Quando roda

Um laço no servidor (iniciado junto com as rotinas de `server/jobs.ts`) confere as conexões a cada 30 segundos e roda uma rodada quando a conexão está ligada (`enabled`, estado diferente de `blocked`) e:

- **mudança local:** `dirty_since` existe e não houve nova mudança há 60 s (junta uma importação grande numa rodada só); ou
- **intervalo:** `last_run_at + interval_minutes` já passou; ou
- **pedido manual:** `POST /run`; ou
- **nova tentativa:** `next_attempt_at` chegou.

Cada conexão roda uma rodada por vez. A trava é feita no banco: `UPDATE ... SET state = 'running' WHERE id = $1 AND state <> 'running'`, com expiração de 5 minutos para destravar uma rodada que caiu. Funciona mesmo com mais de uma instância do servidor.

### 3.2 Aviso de mudança local

Toda operação do `server/store.ts` que muda os ativos de um cliente chama `sync.markDirty(clientId)`, que preenche `dirty_since` das conexões ligadas daquele cliente (se ainda estiver vazio). Operações: importar, remover, alterar status, validar lista e validar todas, desfazer, restaurar versão, zerar lista, aprovar importação pendente e restaurar backup completo.

Se alguma operação escapar, a conferência por intervalo compara o hash dos ativos com o da base e encontra a diferença. O pior caso é atraso, nunca perda.

### 3.3 A rodada

1. **Ler o destino:** `connector.read()`. Normalizar; contar inválidos e não suportados.
2. **Montar os conjuntos:** `remote` (destino), `local` (ativos do GuardList) e `base` (`sync_bases`).
3. **Planejar:** `planRound({ base, local, remote, firstSync, limits })` devolve:
   - `remoteAdds = remote − base`, `remoteRemoves = base − remote`;
   - `localAdds = local − base`, `localRemoves = base − local` (só para registro);
   - `toAddHere = remoteAdds − local`, `toRemoveHere = remoteRemoves ∩ local`;
   - `desired = (local ∪ toAddHere) − toRemoveHere`;
   - `needsWrite = desired ≠ remote`;
   - `blocked` se a trava de remoção em massa disparar (3.5).

   Como são conjuntos, não há conflito: uma inclusão e uma remoção do mesmo item não podem acontecer em lados diferentes no mesmo intervalo a partir da mesma base.
4. **Aplicar no GuardList** (se não for simulação), numa única transação:
   - salvar uma versão do cliente;
   - `toAddHere` entra pelo mesmo caminho da importação (validação, cobertura por CIDR, exceções, reputação em cache). Serviço legítimo e conflito com exceção **entram** marcados para revisão;
   - `toRemoveHere` passa para `removido`, com o motivo "removido no servidor do cliente · <conexão>";
   - um registro no Histórico com a origem.
5. **Gravar o destino:** se `needsWrite`, `connector.write(desired filtrado, { expectedVersion })`. Itens que o destino não aceita ficam de fora e são registrados.
6. **Fechar:** salvar `sync_bases` com `desired` filtrado e a nova versão; registrar em `sync_runs`; limpar `dirty_since` (só se não houve mudança local depois do início da rodada); zerar `failures`; `state = 'ok'`.

Se o GuardList mudar durante a rodada, `dirty_since` fica preenchido e a próxima rodada leva a mudança.

### 3.4 Primeira conexão (sem base)

Conforme `first_sync`:

- `merge` (padrão): `desired = local ∪ remote`. Nunca remove nada.
- `remote`: `desired = remote`. O GuardList passa a refletir o destino; o que só existia no GuardList vai para `removido`, com motivo.
- `local`: `desired = local`. O destino é regravado com a lista do GuardList.

A trava de remoção em massa também vale na primeira rodada. Recomenda-se rodar a primeira em **simulação** (`POST /run` com `dryRun: true`), que calcula e registra tudo sem aplicar nem gravar.

### 3.5 Trava de remoção em massa

Se a rodada for remover, de um lado ou de outro, mais de `max_removal_pct`% da lista ou mais de `max_removal_count` itens:

- nada é aplicado nem gravado;
- `state = 'blocked'` e o plano vai para `blocked_plan` (contagens e amostras);
- aviso para administradores: "remoção em massa aguardando confirmação";
- `POST /confirm-removal { accept: true }` roda a rodada de novo, liberando a trava só para ela. Se o destino tiver mudado nesse meio-tempo, o plano é recalculado e conferido de novo;
- `{ accept: false }` descarta o plano e pausa a conexão (`enabled = false`).

Isso cobre arquivo esvaziado por engano, permissão perdida e leitura cortada.

### 3.6 Falhas

- Erro na leitura, aplicação ou gravação: a base não muda e o que já foi aplicado na transação é desfeito. A exceção é a gravação no destino, que vem depois da transação: se ela falhar, o GuardList já tem as mudanças de fora (corretas e registradas) e a próxima rodada tenta gravar de novo.
- **Versão diferente** na gravação (alguém mexeu entre leitura e gravação): a rodada termina com `result = 'error'` e "o destino mudou durante a sincronização"; a próxima rodada relê, sem contar como falha seguida.
- Novas tentativas: 1, 5, 15 e 30 minutos; depois disso, o intervalo normal. `failures` conta as falhas seguidas.
- Com 3 falhas seguidas, aviso para administradores (mesmo mecanismo de `/api/notifications` usado para backup que falhou).
- O resto do GuardList nunca é afetado por um destino fora do ar.

### 3.7 Pausa e uso manual

- Conexão pausada não roda. O cliente fica manual.
- Ao religar, a próxima rodada usa a base antiga: o que mudou nos dois lados durante a pausa se soma, sujeito à trava.
- Excluir a conexão apaga a conexão e a base; a lista no destino **não é apagada**.
- Cliente excluído: conexões pausadas.

## 4. Conectores

### 4.1 Contrato

`server/sync/connectors/types.ts`:

```ts
export type FieldKind = 'text' | 'number' | 'select' | 'secret' | 'textarea' | 'boolean';

export interface ConnectorField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: { value: string; label: string }[]; // para 'select'
  help?: string;
}

export interface ConnectorCapabilities {
  ipv4: boolean;
  ipv6: boolean;
  cidr: boolean;
  domains: boolean;
  maxItems?: number;
  versioned: boolean; // read() devolve versão e write() respeita expectedVersion
}

export interface ConnectorContext {
  config: Record<string, unknown>;
  secret: Record<string, string> | null; // já descriptografado; nunca registrado
  remoteIdentity: string | null;          // impressão digital confirmada
  signal: AbortSignal;                    // tempo limite da operação
  net: SafeNet;                           // acesso de rede com as proteções da seção 5.3
}

export interface ReadResult { lines: string[]; version?: string; identity?: string }
export interface WriteResult { version?: string }
export interface TestResult { ok: boolean; detail: string; identity?: string }

export interface SyncConnector {
  type: string;
  label: string;
  fields: ConnectorField[];
  capabilities: ConnectorCapabilities;
  read(ctx: ConnectorContext): Promise<ReadResult>;
  write(ctx: ConnectorContext, indicators: string[], opts: { expectedVersion?: string }): Promise<WriteResult>;
  test(ctx: ConnectorContext): Promise<TestResult>;
  applyDelta?(ctx: ConnectorContext, add: string[], remove: string[], opts: { expectedVersion?: string }): Promise<WriteResult>;
}
```

- Erros previstos usam `ConnectorError` com um código (`auth`, `not_found`, `permission`, `version_conflict`, `too_large`, `identity_mismatch`, `network`, `timeout`) e uma mensagem segura para exibir.
- `applyDelta` é opcional. Se existir, o motor o usa no lugar de `write` quando a soma de inclusões e remoções for menor que 10% da lista (ou menor que 50 itens, o que for maior); a base continua sendo a lista completa.

### 4.2 Registro

`server/sync/connectors/index.ts` exporta a lista de conectores disponíveis. Um tipo novo é um arquivo novo e uma linha no registro. O motor, o banco e a API não mudam.

### 4.3 Capacidades

Antes de gravar, o motor remove os itens que o destino não aceita (por exemplo, domínios num destino só de IP) e registra a contagem em `unsupported`. Se a lista passar de `maxItems`, a rodada falha com "a lista tem N itens e o destino aceita até M", em vez de cortar.

### 4.4 Conector de teste

`server/sync/connectors/memory.ts` (tipo `memory`): guarda a lista em memória (ou num arquivo local em desenvolvimento), com versão e opção de simular falha, demora e conflito de versão. Só é registrado quando `NODE_ENV !== 'production'`. Serve aos testes automáticos e ao desenvolvimento.

## 5. Segurança

### 5.1 Credenciais

- AES-256-GCM, chave de 32 bytes em `SYNC_SECRET_KEY` (base64). Formato guardado: `v1:<iv>:<tag>:<dados>`, para permitir trocar a chave depois (`SYNC_SECRET_KEY_V2` etc.).
- Sem `SYNC_SECRET_KEY`, a integração fica desligada: `GET /connectors` informa `enabled: false` e a criação de conexões é recusada. O resto do app funciona normalmente.
- A credencial nunca volta pela API: a API devolve `hasSecret: true/false`. Para trocar, envia-se uma nova; enviar vazio mantém a atual.
- Campos de configuração marcados como `secret` no conector vão para `secret`, nunca para `config`.

### 5.2 Permissões

- Administradores: criar, editar, trocar credencial, pausar, religar, excluir, testar, confirmar remoção em massa.
- Todos os usuários logados: ver tipos, conexões, estado e rodadas; pedir "sincronizar agora" (com limite de uso por usuário).
- Toda ação de administrador vai para o `audit_log`.

### 5.3 Rede (`SafeNet`)

- Endereços recusados por padrão: loopback, redes privadas (RFC 1918), link-local (incluindo 169.254.169.254, metadados da nuvem), CGNAT, `::1`, `fc00::/7` e `fe80::/10`. A checagem acontece **depois** de resolver o DNS, para impedir que um nome aponte para um endereço interno.
- `SYNC_ALLOW_PRIVATE=1` libera redes privadas, para instalações dentro da rede do cliente.
- Tempo limite de 30 s por operação e resposta máxima de 20 MB.
- TLS sempre verificado. Conectores SSH guardam a impressão digital da chave do servidor no primeiro `test`, e ela só passa a valer depois de o administrador confirmar. Se a chave mudar depois, a rodada falha com `identity_mismatch`.

### 5.4 Registros

Mensagens de erro passam por uma limpeza que remove credenciais, cabeçalhos de autorização e trechos de URL com senha antes de irem para `last_error`, `sync_runs` e `audit_log`.

## 6. API

Rotas em `server/sync/routes.ts`, montadas em `/api/sync`. Exigem sessão; as marcadas **admin** usam `adminOnly`.

| Método e rota | Quem | O que faz |
|---|---|---|
| `GET /connectors` | todos | tipos disponíveis, campos, capacidades e se a integração está ligada |
| `GET /connections?clientId=` | todos | conexões (sem credencial) com estado e última rodada |
| `POST /connections` | admin | cria; nasce pausada |
| `PATCH /connections/:id` | admin | edita, troca credencial, pausa ou religa |
| `DELETE /connections/:id` | admin | apaga conexão e base; o destino não é tocado |
| `POST /connections/:id/test` | admin | testa acesso, leitura e escrita sem alterar nada; devolve a impressão digital para confirmar |
| `POST /connections/:id/confirm-identity` | admin | confirma a impressão digital mostrada no teste |
| `POST /connections/:id/run` | todos | "sincronizar agora"; `{ dryRun?: boolean }` |
| `POST /connections/:id/confirm-removal` | admin | `{ accept: boolean }` |
| `GET /connections/:id/runs?limit=` | todos | rodadas, da mais recente |

Também:

- `GET /api/status` ganha o resumo: total de conexões, quantas em erro, travadas e pausadas.
- `GET /api/notifications` ganha os avisos de 3 falhas seguidas e de remoção em massa travada.
- Backup completo inclui as conexões **sem** credenciais. Ao restaurar, elas voltam pausadas e sem credencial.

## 7. Testes

Unitários (`server/sync/*.test.ts`):

- `planRound`: todas as combinações de inclusão e remoção nos dois lados; os três modos da primeira conexão; nada a fazer; trava de remoção em massa (por percentual e por quantidade).
- Normalização: `/32`, `/128`, IPv6, domínios, comentários e linhas inválidas.
- Criptografia: ida e volta; recusa de dado adulterado; chave ausente.
- `SafeNet`: endereços internos recusados (inclusive por DNS) e liberação por `SYNC_ALLOW_PRIVATE`.
- Limpeza de mensagens de erro.

Integração (PGlite em memória e conector `memory`):

- Inclusão e remoção feitas no destino entram no GuardList, com Histórico, versão salva e desfazer funcionando.
- Mudança feita no GuardList é gravada no destino.
- Serviço legítimo e conflito com exceção vindos de fora entram marcados para revisão.
- Falha de leitura ou gravação não altera a base.
- Conflito de versão faz a próxima rodada reler.
- Remoção em massa trava, e a confirmação e o descarte funcionam.
- Duas rodadas da mesma conexão não acontecem juntas.
- Simulação não altera nada.
- Cliente sem conexão: comportamento idêntico, com os testes atuais passando.

O script `npm test` passa a incluir `server/sync/*.test.ts`.

## 8. Arquivos

Novos:

- `server/sync/engine.ts`: laço, trava, rodada, novas tentativas e avisos.
- `server/sync/plan.ts`: `planRound` (função pura).
- `server/sync/normalize.ts`: normalização e filtro por capacidades.
- `server/sync/crypto.ts`: criptografia das credenciais.
- `server/sync/safeNet.ts`: rede com as proteções da seção 5.3.
- `server/sync/repo.ts`: acesso às tabelas `sync_*`.
- `server/sync/routes.ts`: API.
- `server/sync/connectors/types.ts`, `index.ts`, `memory.ts`.
- Testes correspondentes.

Alterados:

- `server/db.ts`: tabelas novas.
- `server/store.ts`: chamadas a `markDirty`, aplicação de mudanças de fora reaproveitando o caminho da importação, backup com conexões.
- `server.ts`: monta as rotas e inicia o laço.
- `server/jobs.ts` (ou o ponto de status): resumo e avisos.
- `.env.example`: `SYNC_SECRET_KEY` e `SYNC_ALLOW_PRIVATE`.
- `package.json`: testes novos no script.
