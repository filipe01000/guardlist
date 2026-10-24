# Sincronização com as blocklists dos clientes — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preparar o servidor do GuardList para espelhar a lista de cada cliente com um destino externo, nos dois sentidos, por conectores plugáveis, sem mudar o uso manual de quem não tem conexão.

**Architecture:** Motor por rodadas dentro do servidor (`server/sync/`). Cada rodada lê o destino, compara com a base e com o GuardList numa função pura (`planRound`), aplica aqui o que mudou lá num caminho próprio (marca para revisão em vez de recusar), regrava a lista inteira lá e guarda a nova base. Os conectores seguem um contrato único; nesta etapa só existe o conector `memory`, para testes e desenvolvimento.

**Tech Stack:** Node ≥ 20.19, TypeScript via `tsx`, Express 4, PostgreSQL/PGlite (`server/db.ts`), `node:test` + `node:assert/strict`, `node:crypto`, `node:dns`, `fetch` nativo. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-10-24-sincronizacao-blocklists-design.md`

## Global Constraints

- Nenhuma dependência nova no `package.json`.
- Cliente sem conexão: comportamento idêntico ao atual; os 109 testes existentes continuam passando.
- Identificadores em inglês, comentários e mensagens ao usuário em português, no estilo do código vizinho; mensagens sem "com sucesso" nem exclamação.
- Credenciais nunca em `config`, nunca devolvidas pela API, nunca em `last_error`, `sync_runs` ou `audit_log`.
- Valores fixos da spec: rodada a cada 30 s de conferência; espera de 60 s após mudança local; intervalo padrão 10 min; trava de 5 min para rodada presa; novas tentativas em 1, 5, 15 e 30 min; aviso com 3 falhas seguidas; trava de remoção em massa 20% ou 500 itens; tempo limite de rede 30 s; resposta máxima 20 MB; 200 rodadas guardadas por conexão.
- Decisão deste plano (não estava na spec): a regra de percentual da trava só vale quando a lista tem 50 itens ou mais, para que listas pequenas não travem a cada remoção. A regra de 500 itens vale sempre.
- Commits só locais, com mensagem em português terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca `git push` sem autorização do usuário.
- Cada task adiciona ao `git add` apenas os arquivos dela.
- Rodar um teste: `npx tsx --test <arquivo>`. Suíte completa: `npm test`. Tipos: `npm run lint`.

## Review Focus

1. **Arquivo do destino com o mesmo IP repetido, ou `1.2.3.4` e `1.2.3.4/32` juntos:** conta como um item só e a regravação não duplica. Teste em Task 1.
2. **IP vindo de fora já coberto por um CIDR ativo:** o GuardList o retira por redundância e a regravação o remove do destino; a rodada seguinte não pode "brigar" com isso (precisa dar `noop`). Teste em Task 7.
3. **Servidor reiniciado no meio de uma rodada** (estado preso em `running`): depois de 5 min a conexão volta a rodar. Teste em Task 5.
4. **Conexão excluída ou cliente excluído enquanto a rodada roda:** a rodada termina sem exceção não tratada e sem recriar dados. Teste em Task 7.
5. **Mudança local feita durante a rodada:** `dirty_since` continua preenchido e a próxima rodada leva a mudança. Teste em Task 7.

---

### Task 1: Normalização e capacidades

**Files:**
- Create: `server/sync/normalize.ts`
- Test: `server/sync/normalize.test.ts`

**Interfaces:**
- Consumes: `normalizeIndicator(raw: string): string` e `classifyIndicator(indicator: string): { type: IndicatorType; isValid: boolean }` de `src/utils/validator.ts`.
- Produces:
  - `type SyncKind = 'ipv4' | 'ipv6' | 'cidr4' | 'cidr6' | 'domain'`
  - `normalizeForSync(raw: string): { value: string; kind: SyncKind } | null` (nulo para inválido ou comentário)
  - `parseRemoteLines(lines: string[]): { values: string[]; invalid: string[] }` (`values` ordenado e sem repetição; linhas vazias ignoradas; comentários `#`, `//`, `;` e inválidas vão para `invalid`)
  - `filterByCapabilities(values: string[], caps: ConnectorCapabilities): { accepted: string[]; unsupported: string[] }`
  - `hashList(values: string[]): string` (SHA-256 hex da lista ordenada unida por `\n`)
  - `ConnectorCapabilities` vem de Task 4; até lá, declarar o tipo localmente e trocar o import na Task 4.

- [ ] **Step 1: Escrever os testes**

```ts
test('normaliza /32 e /128 para o IP puro', () => {
  assert.equal(normalizeForSync('1.2.3.4/32')?.value, '1.2.3.4');
  assert.equal(normalizeForSync('2001:DB8::1/128')?.value, '2001:db8::1');
  assert.equal(normalizeForSync('10.0.0.0/8')?.kind, 'cidr4');
});
test('domínio em minúsculas e sem ponto final', () => {
  assert.deepEqual(normalizeForSync('Exemplo.COM.'), { value: 'exemplo.com', kind: 'domain' });
});
test('linhas do destino: repetidos somem, comentários e inválidos são contados', () => {
  const r = parseRemoteLines(['1.2.3.4', '1.2.3.4/32', '', '# comentário', 'lixo!!', '5.6.7.8']);
  assert.deepEqual(r.values, ['1.2.3.4', '5.6.7.8']);
  assert.deepEqual(r.invalid, ['# comentário', 'lixo!!']);
});
test('capacidades: destino só de IPv4 recusa CIDR, IPv6 e domínio', () => {
  const caps = { ipv4: true, ipv6: false, cidr: false, domains: false, versioned: false };
  const r = filterByCapabilities(['1.2.3.4', '10.0.0.0/8', '2001:db8::1', 'a.com'], caps);
  assert.deepEqual(r.accepted, ['1.2.3.4']);
  assert.deepEqual(r.unsupported, ['10.0.0.0/8', '2001:db8::1', 'a.com']);
});
test('hash não depende da ordem', () => {
  assert.equal(hashList(['b', 'a']), hashList(['a', 'b']));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/normalize.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `server/sync/normalize.ts`** reaproveitando `normalizeIndicator` e `classifyIndicator`; IPv6 canônico via `new URL('http://[x]').hostname` sem colchetes.
- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS.
- [ ] **Step 5: Commit** — `git add server/sync/normalize.ts server/sync/normalize.test.ts` e commit "Sincronização: normalização das listas".

---

### Task 2: Cálculo da rodada (`planRound`)

**Files:**
- Create: `server/sync/plan.ts`
- Test: `server/sync/plan.test.ts`

**Interfaces:**
- Produces:

```ts
export type FirstSync = 'merge' | 'remote' | 'local';
export interface PlanInput {
  base: string[] | null;          // null = primeira rodada
  local: string[];
  remote: string[];
  firstSync: FirstSync;
  limits: { maxRemovalPct: number; maxRemovalCount: number };
  allowMassRemoval?: boolean;
}
export interface RoundPlan {
  first: boolean;
  remoteAdds: string[]; remoteRemoves: string[];
  localAdds: string[]; localRemoves: string[];
  toAddHere: string[]; toRemoveHere: string[];
  removedThere: string[];          // remote − desired
  desired: string[];               // ordenado
  needsWrite: boolean;             // desired ≠ remote
  blocked: null | { reason: 'mass_removal'; removeHere: number; removeThere: number; listSize: number };
}
export function planRound(input: PlanInput): RoundPlan;
```

Regras (seção 3.3–3.5 da spec): com base, `toAddHere = (remote − base) − local`, `toRemoveHere = (base − remote) ∩ local`, `desired = (local ∪ toAddHere) − toRemoveHere`. Sem base: `merge` → `desired = local ∪ remote`, nada removido aqui; `remote` → `desired = remote`, `toRemoveHere = local − remote`; `local` → `desired = local`. Trava: `listSize = max(|local|, |remote|)`; bloqueia se `toRemoveHere` ou `removedThere` passar de `maxRemovalCount`, ou (com `listSize ≥ 50`) passar de `maxRemovalPct`% de `listSize`; `allowMassRemoval` ignora a trava. Todas as listas de saída ordenadas.

- [ ] **Step 1: Escrever os testes**

```ts
const limits = { maxRemovalPct: 20, maxRemovalCount: 500 };
test('inclusão lá entra aqui e não regrava', () => {
  const p = planRound({ base: ['a'], local: ['a'], remote: ['a', 'b'], firstSync: 'merge', limits });
  assert.deepEqual(p.toAddHere, ['b']); assert.deepEqual(p.desired, ['a', 'b']); assert.equal(p.needsWrite, false);
});
test('remoção lá sai daqui', () => {
  const p = planRound({ base: ['a', 'b'], local: ['a', 'b'], remote: ['a'], firstSync: 'merge', limits });
  assert.deepEqual(p.toRemoveHere, ['b']); assert.equal(p.needsWrite, false);
});
test('mudanças dos dois lados se somam', () => {
  const p = planRound({ base: ['a', 'b'], local: ['a', 'b', 'c'], remote: ['b', 'd'], firstSync: 'merge', limits });
  assert.deepEqual(p.desired, ['b', 'c', 'd']); assert.deepEqual(p.toAddHere, ['d']); assert.deepEqual(p.toRemoveHere, ['a']); assert.equal(p.needsWrite, true);
});
test('nada mudou: noop', () => {
  const p = planRound({ base: ['a'], local: ['a'], remote: ['a'], firstSync: 'merge', limits });
  assert.equal(p.needsWrite, false); assert.equal(p.toAddHere.length + p.toRemoveHere.length, 0);
});
test('primeira rodada merge junta e nunca remove', () => {
  const p = planRound({ base: null, local: ['a', 'b'], remote: ['b', 'c'], firstSync: 'merge', limits });
  assert.deepEqual(p.desired, ['a', 'b', 'c']); assert.deepEqual(p.toRemoveHere, []); assert.equal(p.first, true);
});
test('primeira rodada remote: vale a lista de lá', () => {
  const p = planRound({ base: null, local: ['a', 'b'], remote: ['b', 'c'], firstSync: 'remote', limits });
  assert.deepEqual(p.desired, ['b', 'c']); assert.deepEqual(p.toRemoveHere, ['a']); assert.equal(p.needsWrite, false);
});
test('primeira rodada local: vale a do GuardList', () => {
  const p = planRound({ base: null, local: ['a'], remote: ['b'], firstSync: 'local', limits });
  assert.deepEqual(p.desired, ['a']); assert.deepEqual(p.removedThere, ['b']); assert.equal(p.needsWrite, true);
});
test('arquivo esvaziado trava por percentual', () => {
  const base = Array.from({ length: 100 }, (_, i) => `10.0.0.${i}`);
  const p = planRound({ base, local: base, remote: [], firstSync: 'merge', limits });
  assert.equal(p.blocked?.reason, 'mass_removal'); assert.equal(p.blocked?.removeHere, 100);
});
test('lista pequena não trava por percentual', () => {
  const p = planRound({ base: ['a', 'b', 'c'], local: ['a', 'b', 'c'], remote: ['a'], firstSync: 'merge', limits });
  assert.equal(p.blocked, null);
});
test('mais de 500 remoções travam mesmo abaixo de 20%', () => {
  const base = Array.from({ length: 3000 }, (_, i) => `i${i}`);
  const p = planRound({ base, local: base, remote: base.slice(501), firstSync: 'merge', limits });
  assert.notEqual(p.blocked, null);
});
test('allowMassRemoval libera a trava', () => {
  const base = Array.from({ length: 100 }, (_, i) => `i${i}`);
  assert.equal(planRound({ base, local: base, remote: [], firstSync: 'merge', limits, allowMassRemoval: true }).blocked, null);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/plan.test.ts` → FAIL.
- [ ] **Step 3: Implementar `planRound`** em `server/sync/plan.ts` com `Set`, sem acesso a banco ou rede.
- [ ] **Step 4: Rodar e ver passar** → PASS.
- [ ] **Step 5: Commit** — "Sincronização: cálculo da rodada".

---

### Task 3: Credenciais, rede segura e limpeza de mensagens

**Files:**
- Create: `server/sync/errors.ts`, `server/sync/crypto.ts`, `server/sync/safeNet.ts`, `server/sync/redact.ts`, `server/sync/connectors/errors.ts`
- Test: `server/sync/crypto.test.ts`, `server/sync/safeNet.test.ts`, `server/sync/redact.test.ts`

**Interfaces:**
- Produces (`crypto.ts`):
  - `syncEnabled(env?: NodeJS.ProcessEnv): boolean` — verdadeiro se `SYNC_SECRET_KEY` decodifica (base64) em 32 bytes.
  - `encryptSecret(value: Record<string, string>, env?): string` — formato `v1:<iv b64>:<tag b64>:<dados b64>`, AES-256-GCM, IV de 12 bytes.
  - `decryptSecret(blob: string, env?): Record<string, string>` — lança `SyncError('Credencial ilegível…')` se adulterada ou chave errada.
- Produces (`server/sync/errors.ts`): `class SyncError extends Error { status: number }` (mesmo padrão de `StoreError`, status padrão 400), usada pelas tasks seguintes.
- Produces (`safeNet.ts`):
  - `isBlockedAddress(ip: string, allowPrivate: boolean): boolean` — bloqueia sempre loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), `0.0.0.0/8`; sem `allowPrivate`, bloqueia também `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`.
  - `interface SafeNet { assertHost(host: string): Promise<string>; fetchText(url: string, init?: RequestInit): Promise<{ status: number; headers: Headers; text: string }>; timeoutMs: number; maxBytes: number }`
  - `createSafeNet(opts?: { env?: NodeJS.ProcessEnv; lookup?: (host: string) => Promise<string[]> }): SafeNet` — `timeoutMs = 30_000`, `maxBytes = 20 * 1024 * 1024`; `allowPrivate` vem de `SYNC_ALLOW_PRIVATE === '1'`; `assertHost` resolve o DNS (todas as respostas) e recusa se **qualquer** endereço for bloqueado, com `ConnectorError('network', 'Endereço interno não permitido.')`; `fetchText` usa `AbortSignal.timeout` e para de ler ao passar de `maxBytes` com `ConnectorError('too_large', …)`.
  - `ConnectorError` vem de Task 4; nesta task, criar `server/sync/connectors/errors.ts` com `type ConnectorErrorCode = 'auth' | 'not_found' | 'permission' | 'version_conflict' | 'too_large' | 'identity_mismatch' | 'network' | 'timeout'` e `class ConnectorError extends Error { code: ConnectorErrorCode }`.
- Produces (`redact.ts`): `redactError(message: string, secrets?: string[]): string` — troca cada segredo por `***`, apaga `user:pass@` em URLs e valores de `Authorization`/`Bearer`/`token=`/`key=`, corta em 500 caracteres.

- [ ] **Step 1: Escrever os testes**

```ts
// crypto.test.ts
const env = { SYNC_SECRET_KEY: Buffer.alloc(32, 7).toString('base64') };
test('ida e volta', () => {
  const blob = encryptSecret({ password: 's3nha' }, env);
  assert.match(blob, /^v1:/); assert.deepEqual(decryptSecret(blob, env), { password: 's3nha' });
});
test('dado adulterado é recusado', () => {
  const blob = encryptSecret({ a: 'b' }, env);
  const bad = blob.slice(0, -2) + (blob.endsWith('A') ? 'B' : 'A') + blob.slice(-1);
  assert.throws(() => decryptSecret(bad, env));
});
test('sem chave a integração fica desligada', () => {
  assert.equal(syncEnabled({}), false); assert.equal(syncEnabled({ SYNC_SECRET_KEY: 'curta' }), false);
});
// safeNet.test.ts
test('endereços internos', () => {
  for (const ip of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '192.168.0.1', '::1', 'fd00::1']) assert.equal(isBlockedAddress(ip, false), true, ip);
  assert.equal(isBlockedAddress('8.8.8.8', false), false);
  assert.equal(isBlockedAddress('10.1.2.3', true), false);
  assert.equal(isBlockedAddress('169.254.169.254', true), true);
});
test('nome que resolve para endereço interno é recusado', async () => {
  const net = createSafeNet({ env: {}, lookup: async () => ['93.184.216.34', '10.0.0.5'] });
  await assert.rejects(net.assertHost('exemplo.com'), /interno/);
});
// redact.test.ts
test('limpa credenciais', () => {
  const m = redactError('falhou em https://adm:s3nha@fw.local/x Authorization: Bearer abc123 token=zzz', ['s3nha']);
  assert.doesNotMatch(m, /s3nha|abc123|zzz/);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/crypto.test.ts server/sync/safeNet.test.ts server/sync/redact.test.ts` → FAIL.
- [ ] **Step 3: Implementar os três arquivos e `server/sync/connectors/errors.ts`** com `node:crypto`, `node:dns/promises` (`lookup(host, { all: true })` como padrão de `lookup`) e `node:net` (`isIP`, `BlockList`).
- [ ] **Step 4: Rodar e ver passar** → PASS.
- [ ] **Step 5: Commit** — "Sincronização: credenciais criptografadas, rede segura e limpeza de mensagens".

---

### Task 4: Contrato dos conectores, registro e conector de teste

**Files:**
- Create: `server/sync/connectors/types.ts`, `server/sync/connectors/index.ts`, `server/sync/connectors/memory.ts`
- Modify: `server/sync/normalize.ts` (importar `ConnectorCapabilities` de `types.ts`)
- Test: `server/sync/connectors/memory.test.ts`

**Interfaces:**
- Consumes: `ConnectorError` (Task 3), `SafeNet` (Task 3).
- Produces: os tipos da seção 4.1 da spec, exatamente como escritos lá (`FieldKind`, `ConnectorField`, `ConnectorCapabilities`, `ConnectorContext`, `ReadResult`, `WriteResult`, `TestResult`, `SyncConnector`), reexportando `ConnectorError` e `ConnectorErrorCode`.
- `index.ts`: `listConnectors(env?: NodeJS.ProcessEnv): SyncConnector[]` e `getConnector(type: string, env?): SyncConnector | undefined`. O `memory` só entra quando `env.NODE_ENV !== 'production'`.
- `memory.ts`:
  - `interface MemoryTarget { lines: string[]; version: number; failNext?: 'read' | 'write' | 'auth'; changeBeforeWrite?: string[] }`
  - `memoryTargets: Map<string, MemoryTarget>` e `resetMemoryTargets(): void`
  - `memoryConnector: SyncConnector` com `type = 'memory'`, `label = 'Lista em memória (testes)'`, campo `target` (texto, obrigatório), campo secreto `token` (opcional) e `maxItems` (número, opcional) em `config`; capacidades todas verdadeiras, `versioned = true`.
  - `read` devolve `{ lines, version: String(version) }`; `write` lança `ConnectorError('version_conflict')` se `expectedVersion` diferir, senão grava e incrementa a versão; `failNext` lança o erro uma vez (`network` para `read`/`write`, `auth` para `auth`); `changeBeforeWrite` substitui as linhas entre a leitura e a gravação (simula alguém mexendo lá).

- [ ] **Step 1: Escrever os testes**

```ts
test('memory lê, grava e versiona', async () => {
  resetMemoryTargets(); memoryTargets.set('t1', { lines: ['1.1.1.1'], version: 1 });
  const ctx = fakeCtx({ target: 't1' });
  const r = await memoryConnector.read(ctx);
  assert.deepEqual(r, { lines: ['1.1.1.1'], version: '1' });
  const w = await memoryConnector.write(ctx, ['2.2.2.2'], { expectedVersion: '1' });
  assert.equal(w.version, '2'); assert.deepEqual(memoryTargets.get('t1')?.lines, ['2.2.2.2']);
});
test('versão diferente gera version_conflict', async () => {
  resetMemoryTargets(); memoryTargets.set('t1', { lines: [], version: 5 });
  await assert.rejects(memoryConnector.write(fakeCtx({ target: 't1' }), [], { expectedVersion: '4' }), (e: any) => e.code === 'version_conflict');
});
test('memory não aparece em produção', () => {
  assert.equal(getConnector('memory', { NODE_ENV: 'production' }), undefined);
  assert.ok(getConnector('memory', { NODE_ENV: 'test' }));
});
```

(`fakeCtx(config)` é um ajudante local do teste que monta um `ConnectorContext` com `secret: null`, `remoteIdentity: null`, `signal: AbortSignal.timeout(1000)` e `net: createSafeNet({ env: {} })`.)

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/connectors/memory.test.ts` → FAIL.
- [ ] **Step 3: Implementar os três arquivos** e ajustar o import em `normalize.ts`.
- [ ] **Step 4: Rodar e ver passar** — também `npx tsx --test server/sync/normalize.test.ts` → PASS.
- [ ] **Step 5: Commit** — "Sincronização: contrato dos conectores e conector de teste".

---

### Task 5: Tabelas e repositório

**Files:**
- Modify: `server/db.ts` (acrescentar ao `SCHEMA`, no fim, as três tabelas da seção 2 da spec, mais a coluna `running_since TIMESTAMPTZ` em `sync_connections` e o índice `sync_runs (connection_id, started_at DESC)`)
- Create: `server/sync/repo.ts`
- Test: `server/sync/repo.test.ts`

**Interfaces:**
- Consumes: `Database`, `Query` (`server/db.ts`); `Actor`, `audit` (`server/storeCore.ts`); `encryptSecret` (Task 3).
- Produces:

```ts
export type ConnectionState = 'ok' | 'pending' | 'running' | 'error' | 'paused' | 'blocked';
export type RunTrigger = 'change' | 'interval' | 'manual' | 'retry' | 'confirm';
export interface SyncConnection {
  id: string; clientId: string; type: string; name: string; config: Record<string, unknown>;
  secret: string | null; enabled: boolean; firstSync: FirstSync; intervalMinutes: number;
  maxRemovalPct: number; maxRemovalCount: number; state: ConnectionState;
  dirtySince: string | null; nextAttemptAt: string | null; failures: number;
  lastRunAt: string | null; lastOkAt: string | null; lastError: string | null;
  blockedPlan: Record<string, unknown> | null; remoteIdentity: string | null; runningSince: string | null;
}
export type PublicConnection = Omit<SyncConnection, 'secret'> & { hasSecret: boolean };
export interface SyncRunRecord {
  connectionId: string; startedAt: string; finishedAt: string; trigger: RunTrigger; dryRun: boolean;
  result: 'ok' | 'noop' | 'error' | 'blocked';
  remoteAdded: number; remoteRemoved: number; localAdded: number; localRemoved: number;
  pushed: number; reviewFlagged: number; unsupported: number; invalidLines: number;
  error: string | null; detail: Record<string, unknown>;
}
export function toPublic(c: SyncConnection): PublicConnection;
export function createSyncRepo(db: Database): {
  create(actor: Actor, input: { clientId: string; type: string; name: string; config: Record<string, unknown>; secret: string | null; firstSync?: FirstSync; intervalMinutes?: number; maxRemovalPct?: number; maxRemovalCount?: number }): Promise<SyncConnection>;
  get(id: string): Promise<SyncConnection | null>;
  list(clientId?: string): Promise<SyncConnection[]>;
  update(actor: Actor, id: string, patch: Partial<Pick<SyncConnection, 'name' | 'config' | 'secret' | 'enabled' | 'firstSync' | 'intervalMinutes' | 'maxRemovalPct' | 'maxRemovalCount' | 'remoteIdentity'>>): Promise<SyncConnection>;
  remove(actor: Actor, id: string): Promise<void>;          // apaga conexão, base e rodadas
  setState(id: string, patch: Partial<Pick<SyncConnection, 'state' | 'dirtySince' | 'nextAttemptAt' | 'failures' | 'lastRunAt' | 'lastOkAt' | 'lastError' | 'blockedPlan' | 'runningSince' | 'enabled'>>): Promise<void>;
  markDirty(clientId: string): Promise<void>;               // dirty_since = coalesce(dirty_since, now()) nas ligadas
  pauseClient(clientId: string): Promise<void>;             // enabled = false, state = 'paused'
  claim(id: string, now: Date): Promise<SyncConnection | null>;  // trava; aceita running_since com mais de 5 min
  getBase(id: string): Promise<{ indicators: string[]; hash: string; remoteVersion: string | null } | null>;
  saveBase(id: string, indicators: string[], remoteVersion: string | null): Promise<void>;  // calcula hash com hashList
  addRun(run: SyncRunRecord): Promise<void>;                // mantém as 200 mais recentes da conexão
  listRuns(id: string, limit: number): Promise<SyncRunRecord[]>;
};
export type SyncRepo = ReturnType<typeof createSyncRepo>;
```

`create`, `update` (inclusive troca de credencial e liga/pausa) e `remove` gravam no `audit_log` (`sync.create`, `sync.update`, `sync.secret`, `sync.enable`, `sync.pause`, `sync.delete`) sem o conteúdo da credencial. Conexão nova: `enabled = false`, `state = 'paused'`. `claim` faz `UPDATE sync_connections SET state = 'running', running_since = $2 WHERE id = $1 AND (state <> 'running' OR running_since < $2 - interval '5 minutes') RETURNING *`.

- [ ] **Step 1: Escrever os testes** (PGlite em memória, com `openMemoryDatabase()` e um cliente criado por `createStore(db).saveClient`)

```ts
test('conexão nasce pausada e não expõe a credencial', async (t) => {
  const { repo } = await setup(t);
  const c = await repo.create(admin, { clientId: 'a', type: 'memory', name: 'FW', config: { target: 't' }, secret: 'v1:x:y:z' });
  assert.equal(c.enabled, false); assert.equal(c.state, 'paused');
  const pub = toPublic(c); assert.equal('secret' in pub, false); assert.equal(pub.hasSecret, true);
});
test('claim impede duas rodadas e destrava depois de 5 min', async (t) => {
  const { repo, c } = await setupWithConnection(t);
  const now = new Date('2026-10-24T12:00:00Z');
  assert.ok(await repo.claim(c.id, now));
  assert.equal(await repo.claim(c.id, new Date('2026-10-24T12:04:00Z')), null);
  assert.ok(await repo.claim(c.id, new Date('2026-10-24T12:05:01Z')));
});
test('markDirty só marca conexões ligadas e mantém a primeira data', async (t) => { /* ligar uma, deixar outra pausada; chamar duas vezes; conferir dirtySince */ });
test('rodadas: guarda só as 200 mais recentes', async (t) => { /* addRun 205 vezes; listRuns(id, 500).length === 200 */ });
test('remove apaga base e rodadas', async (t) => { /* saveBase, addRun, remove; getBase === null, listRuns vazio */ });
test('audit_log não contém a credencial', async (t) => { /* create com secret 'v1:segredo'; SELECT detail FROM audit_log não contém 'segredo' */ });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/repo.test.ts` → FAIL.
- [ ] **Step 3: Implementar** o schema em `server/db.ts` (com `CREATE TABLE IF NOT EXISTS`, como as demais) e `server/sync/repo.ts`. IDs: `sync-${Date.now()}-${random}`, no mesmo formato dos outros IDs do projeto.
- [ ] **Step 4: Rodar e ver passar** — e `npm test` (os 109 antigos continuam PASS).
- [ ] **Step 5: Commit** — "Sincronização: tabelas e repositório".

---

### Task 6: Aplicar no GuardList as mudanças de fora

**Files:**
- Create: `server/sync/apply.ts`
- Modify: `src/types/index.ts` (em `BlocklistEntry`, acrescentar `syncFlag?: 'exception' | 'legit'` e `syncSource?: string`)
- Modify: `server/store.ts` — `getReviewQueue` inclui itens ativos com `data->>'syncFlag'` não nulo, mesmo sem idade; `reviewEntries` com `keep` remove `syncFlag` (`data - 'syncFlag'`)
- Test: `server/sync/apply.test.ts`

**Interfaces:**
- Consumes: de `server/storeCore.ts`: `getClient`, `entriesOf`, `upsertEntries`, `snapshot`, `retireRedundant`, `exceptionList`, `audit`; `exceptionHit` de `src/utils/redundancy.ts`; `classifyIndicator` de `src/utils/validator.ts`.
- Produces:

```ts
export function syncActor(connectionName: string): Actor;   // { username: 'sync', displayName: `Sincronização · ${connectionName}`, role: 'admin' }
export async function applyRemoteChanges(q: Query, input: {
  clientId: string; connectionName: string; add: string[]; remove: string[]; todayStr: string;
}): Promise<{ added: number; removed: number; flagged: number; retired: number; snapshotId: string; historyId: string }>;
```

Comportamento (seções 2.4 e 3.3, passo 4):
- Salva uma versão antes (`snapshot`, rótulo "Antes da sincronização com <conexão>").
- Cada item de `add` vira um `BlocklistEntry` ativo com `type` de `classifyIndicator`, `addedDate = todayStr`, `sourceTicket = 'sync:<conexão>'`, `syncSource = <conexão>` e notas "Incluído no servidor do cliente · <conexão>". Se bater numa exceção do cliente, entra com `syncFlag: 'exception'`; se `cti_cache.data->>'verdict' = 'legit'`, com `syncFlag: 'legit'`. Nunca é recusado.
- Cada item de `remove` ativo passa a `removed`, com `removedBy = 'Sincronização · <conexão>'` e nota "removido no servidor do cliente · <conexão>".
- Roda `retireRedundant` e grava um registro em `history` com `notes` começando por "Servidor do cliente · <conexão>" e `importedBy` igual ao nome do ator, mais `audit(..., 'sync.apply', …)`.
- `add` e `remove` vazios: não faz nada e devolve zeros (sem versão nem histórico).

- [ ] **Step 1: Escrever os testes** (PGlite; cliente `a` com exceção `192.0.2.1`)

```ts
test('inclusão e remoção vindas de fora, com histórico e versão salva', async (t) => {
  const { db, store } = await setup(t); /* cliente a com 1.1.1.1 ativo */
  const r = await db.tx((q) => applyRemoteChanges(q, { clientId: 'a', connectionName: 'FW', add: ['2.2.2.2'], remove: ['1.1.1.1'], todayStr: '2026-10-24' }));
  assert.equal(r.added, 1); assert.equal(r.removed, 1);
  const ativos = (await store.getClientEntries(admin, 'a', 'active')).map((e) => e.indicator);
  assert.deepEqual(ativos, ['2.2.2.2']);
  const hist = await store.getHistoryRecords(admin, 'a');
  assert.match(hist[0].notes || '', /^Servidor do cliente · FW/);
});
test('exceção vinda de fora entra marcada e aparece na Revisão', async (t) => {
  /* add ['192.0.2.1']; entrada ativa com syncFlag 'exception'; getReviewQueue inclui o item */
});
test('legítimo pelo cache entra marcado como legit', async (t) => {
  /* INSERT em cti_cache com verdict 'legit'; add; syncFlag === 'legit' */
});
test('manter na revisão limpa a marca', async (t) => {
  /* reviewEntries(keep); syncFlag ausente; some da fila */
});
test('desfazer pela versão salva volta ao estado anterior', async (t) => {
  /* restoreClientSnapshot(r.snapshotId) devolve 1.1.1.1 ativo e tira 2.2.2.2 */
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/apply.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `apply.ts` e as duas mudanças em `store.ts`/`types/index.ts`.
- [ ] **Step 4: Rodar e ver passar** — e `npm test` → PASS.
- [ ] **Step 5: Commit** — "Sincronização: aplicar no GuardList as mudanças vindas do destino".

---

### Task 7: Motor — a rodada

**Files:**
- Create: `server/sync/engine.ts`
- Test: `server/sync/engine.test.ts`

**Interfaces:**
- Consumes: `SyncRepo`, `SyncConnection`, `SyncRunRecord`, `RunTrigger` (Task 5); `planRound` (Task 2); `parseRemoteLines`, `normalizeForSync`, `filterByCapabilities` (Tasks 1 e 4); `getConnector` (Task 4); `decryptSecret`, `SyncError` (Task 3); `createSafeNet` (Task 3); `redactError` (Task 3); `applyRemoteChanges` (Task 6); `entriesOf` (`storeCore.ts`).
- Produces:

```ts
export interface SyncEngineDeps { db: Database; repo: SyncRepo; env?: NodeJS.ProcessEnv; now?: () => Date; net?: SafeNet }
export function createSyncEngine(deps: SyncEngineDeps): {
  runRound(id: string, opts: { trigger: RunTrigger; dryRun?: boolean; allowMassRemoval?: boolean }): Promise<SyncRunRecord | null>; // null se a trava estiver ocupada
  confirmRemoval(actor: Actor, id: string, accept: boolean): Promise<SyncRunRecord | null>;
  testConnection(id: string): Promise<TestResult>;
  markDirty(clientId: string): Promise<void>;
};
export type SyncEngine = ReturnType<typeof createSyncEngine>;
export const RETRY_MINUTES = [1, 5, 15, 30];
```

Rodada (seções 3.3–3.6), na ordem:
1. `repo.claim(id, now)`; se nulo, devolve `null`. Guarda `startedAt`.
2. Se a conexão, o cliente ou o conector não existirem mais, solta a trava e devolve um registro `result: 'error'` com mensagem clara (Review Focus 4).
3. Monta o `ConnectorContext` (credencial com `decryptSecret`, `signal = AbortSignal.timeout(net.timeoutMs)`).
4. `read` → `parseRemoteLines`. Local = ativos do cliente normalizados com `normalizeForSync`. Base = `repo.getBase`.
5. `planRound` com `firstSync` e limites da conexão.
6. `blocked` (e não simulação): `state = 'blocked'`, `blockedPlan` com contagens e até 20 amostras de cada lado, registro `result: 'blocked'`. Nada aplicado nem gravado.
7. `dryRun`: só registra (`result: 'noop'` se não houver nada, senão `ok`), com amostras em `detail`; não altera base, estado de sucesso nem `dirtySince`.
8. Aplica `toAddHere`/`toRemoveHere` com `db.tx((q) => applyRemoteChanges(...))`. Relê os ativos (o `retireRedundant` pode ter tirado itens), calcula `desired` final, filtra por capacidades e confere `maxItems` (`SyncError` "a lista tem N itens e o destino aceita até M").
9. Se `desired` filtrado ≠ remoto: `write` com `expectedVersion` (quando `versioned`); usa `applyDelta` se existir e a diferença for menor que 10% da lista ou menor que 50 itens.
10. Sucesso: `saveBase(desired filtrado, versão)`; `dirtySince = null` só se não mudou desde `startedAt` (Review Focus 5); `failures = 0`, `nextAttemptAt = null`, `state = 'ok'`, `lastOkAt`, `lastRunAt`; `addRun`.
11. Erro: base intacta; `lastError = redactError(msg, valores da credencial)`; `ConnectorError` com `version_conflict` não incrementa `failures` e marca `nextAttemptAt = now`; os demais incrementam `failures` e marcam `nextAttemptAt = now + RETRY_MINUTES[min(failures-1, 3)]` minutos; `state = 'error'`; `addRun` com `result: 'error'`.
12. Sempre solta a trava (`runningSince = null`; estado definido acima).

`confirmRemoval(accept = true)` exige `state = 'blocked'`, grava no `audit_log` e chama `runRound(id, { trigger: 'confirm', allowMassRemoval: true })`. Com `accept = false`: limpa `blockedPlan`, `enabled = false`, `state = 'paused'`. `testConnection` chama `connector.test` com os mesmos cuidados de rede e devolve o resultado com a mensagem limpa.

- [ ] **Step 1: Escrever os testes** (PGlite + `memory`; ajudante `setupSync(t)` cria cliente `a`, conexão ligada para o alvo `t1` e o motor com `env = { NODE_ENV: 'test', SYNC_SECRET_KEY: <32 bytes> }`)

```ts
test('inclusão lá entra aqui; mudança daqui vai para lá', async (t) => { /* 1ª rodada merge; depois alvo += 3.3.3.3 → ativo aqui; depois importar 4.4.4.4 aqui → memoryTargets.get('t1').lines contém 4.4.4.4 */ });
test('segunda rodada sem mudanças dá noop', async (t) => { /* duas rodadas seguidas; a segunda tem result 'noop' e pushed 0 */ });
test('IP de fora coberto por CIDR ativo é retirado e a rodada seguinte fica estável', async (t) => {
  /* ativo 10.0.0.0/24; alvo inclui 10.0.0.5; rodada 1 grava lista sem 10.0.0.5; rodada 2 → 'noop' (Review Focus 2) */
});
test('falha na leitura não mexe na base e agenda nova tentativa em 1 min', async (t) => { /* failNext 'read'; base igual; failures 1; nextAttemptAt = now + 1 min; state 'error' */ });
test('três falhas seguidas: failures 3 e espera de 15 min', async (t) => { });
test('versão alterada entre leitura e gravação não conta como falha', async (t) => { /* changeBeforeWrite; result 'error'; failures 0 */ });
test('arquivo esvaziado trava a conexão e confirmar aplica', async (t) => { /* 60 itens; alvo vazio; state 'blocked'; confirmRemoval(true) → ativos 0, state 'ok' */ });
test('descartar a remoção em massa pausa a conexão', async (t) => { });
test('simulação não altera nada', async (t) => { /* dryRun; ativos, alvo e base iguais; run com dryRun true */ });
test('mudança local durante a rodada mantém dirtySince', async (t) => { /* now() injetado; markDirty com data posterior a startedAt antes do fim (via changeBeforeWrite chamando markDirty); dirtySince continua */ });
test('conexão excluída no meio: rodada termina com erro tratado', async (t) => { /* changeBeforeWrite chama repo.remove; runRound resolve sem lançar */ });
test('credencial nunca aparece em lastError nem em sync_runs', async (t) => { /* secret token 'tok-123'; failNext 'auth' com mensagem contendo o token; buscar 'tok-123' nas tabelas */ });
test('cliente sem conexão não é tocado', async (t) => { /* cliente b com itens; rodada de a; itens de b iguais */ });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/engine.test.ts` → FAIL.
- [ ] **Step 3: Implementar `server/sync/engine.ts`.**
- [ ] **Step 4: Rodar e ver passar** — e `npm test` → PASS.
- [ ] **Step 5: Commit** — "Sincronização: motor da rodada".

---

### Task 8: Agendador e avisos de mudança local

**Files:**
- Modify: `server/sync/engine.ts` (acrescentar `tick` e `start`)
- Modify: `server/store.ts` — `createStore(db, opts?: { onClientChanged?: (clientId: string) => void })`; chamar `opts.onClientChanged?.(clientId)` depois de cada operação da seção 3.2 da spec (`importBatch` quando gravou, `decidePendingImport` aprovado, `undoImport`, `validateAllClients`/`cleanAllClients` para cada cliente afetado, `reviewEntries` remove, `cleanRedundantEntries`, `updateEntryStatus`, `bulkDeleteEntries`, `restoreClientSnapshot`, `deleteClientEntriesAll`, `replaceClientEntries`, `bulkInsertEntries`, `restoreFullBackupJSON` para todos); em `deleteClient`, pausar as conexões do cliente na mesma transação (`UPDATE sync_connections SET enabled = false, state = 'paused' WHERE client_id = $1`)
- Test: `server/sync/scheduler.test.ts`

**Interfaces:**
- Produces (somadas ao retorno de `createSyncEngine`):
  - `tick(): Promise<void>` — roda, uma por vez, as conexões ligadas e não travadas que estejam devidas: `dirtySince ≤ now − 60 s` (`change`), `nextAttemptAt ≤ now` (`retry`) ou `lastRunAt` nulo ou `≤ now − intervalMinutes` (`interval`). Na conferência por intervalo, se o hash dos ativos for igual ao da base e o destino não for lido como diferente, a rodada dá `noop`, que é o caminho normal da Task 7.
  - `start(): void` — `setInterval(safeTick, 30_000).unref()`, com a mesma proteção contra sobreposição de `server/jobs.ts`; não faz nada se `syncEnabled(env)` for falso.

- [ ] **Step 1: Escrever os testes** (`now` injetado)

```ts
test('mudança local roda só depois de 60 s sem novas mudanças', async (t) => { /* markDirty em 12:00:00; tick 12:00:30 não roda; tick 12:01:01 roda */ });
test('conferência por intervalo', async (t) => { /* lastRunAt 12:00; tick 12:09 não roda; 12:10:01 roda com trigger 'interval' */ });
test('nova tentativa no horário marcado', async (t) => { });
test('conexão pausada ou travada não roda', async (t) => { });
test('importar pelo store marca a conexão do cliente', async (t) => {
  /* createStore(db, { onClientChanged: (id) => engine.markDirty(id) }); importBatch(admin, ...); conexão com dirtySince preenchido */
});
test('excluir o cliente pausa as conexões', async (t) => { });
test('sem SYNC_SECRET_KEY o start não agenda nada', () => { });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/scheduler.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `tick`/`start` e os avisos em `store.ts`.
- [ ] **Step 4: Rodar e ver passar** — e `npm test` → PASS (o parâmetro novo de `createStore` é opcional, então os testes antigos não mudam).
- [ ] **Step 5: Commit** — "Sincronização: agendador e avisos de mudança".

---

### Task 9: Serviço, API e ligação com o servidor

**Files:**
- Create: `server/sync/service.ts`, `server/sync/routes.ts`
- Modify: `server.ts` (criar repo, motor e serviço; `createStore(db, { onClientChanged })`; montar `/api/sync`; `engine.start()`; resumo em `/api/status`; avisos em `/api/notifications`)
- Modify: `server/store.ts` — `exportFullBackupJSON` inclui `syncConnections` (sem `secret` e sem estado de execução); `restoreFullBackupJSON` recria as conexões com `enabled = false`, `state = 'paused'`, `secret = null` e apaga as bases
- Modify: `.env.example` (`SYNC_SECRET_KEY`, com o comando para gerar a chave, e `SYNC_ALLOW_PRIVATE`)
- Modify: `package.json` (script `test` passa a incluir `server/sync/*.test.ts server/sync/connectors/*.test.ts`)
- Test: `server/sync/service.test.ts`

**Interfaces:**
- Consumes: `SyncRepo`, `SyncEngine`, `listConnectors`/`getConnector`, `encryptSecret`, `syncEnabled`, `toPublic`, `SyncError`.
- Produces:

```ts
export function createSyncService(deps: { repo: SyncRepo; engine: SyncEngine; db: Database; env?: NodeJS.ProcessEnv }): {
  connectors(): { enabled: boolean; connectors: Array<Pick<SyncConnector, 'type' | 'label' | 'fields' | 'capabilities'>> };
  list(actor: Actor, clientId?: string): Promise<PublicConnection[]>;
  create(actor: Actor, body: unknown): Promise<PublicConnection>;
  update(actor: Actor, id: string, body: unknown): Promise<PublicConnection>;
  remove(actor: Actor, id: string): Promise<void>;
  test(actor: Actor, id: string): Promise<TestResult>;
  confirmIdentity(actor: Actor, id: string, identity: string): Promise<PublicConnection>;
  run(actor: Actor, id: string, body: unknown): Promise<SyncRunRecord | null>;
  confirmRemoval(actor: Actor, id: string, body: unknown): Promise<SyncRunRecord | null>;
  runs(actor: Actor, id: string, limit?: unknown): Promise<SyncRunRecord[]>;
  summary(): Promise<{ total: number; error: number; blocked: number; paused: number; failing: Array<{ id: string; name: string; clientId: string; failures: number }>; blockedList: Array<{ id: string; name: string; clientId: string }> }>;
};
export function createSyncRouter(service: ReturnType<typeof createSyncService>, mw: { adminOnly: RequestHandler; runLimit: RequestHandler; json: RequestHandler }): express.Router;
```

Regras do serviço:
- `create`/`update`/`remove`/`test`/`confirmIdentity`/`confirmRemoval` chamam `requireAdmin`.
- `create` falha com `SyncError(503, 'A integração está desligada: falta SYNC_SECRET_KEY no servidor.')` se `syncEnabled` for falso; também falha com tipo desconhecido, cliente inexistente ou campo obrigatório ausente (mensagem com o rótulo do campo).
- Campos `secret` do conector vão para `encryptSecret`; os demais, para `config`.
- Em `update`, credencial vazia mantém a atual.
- `firstSync` aceita só `merge`, `remote` e `local`; `intervalMinutes` entre 1 e 1440; `maxRemovalPct` entre 1 e 100; `maxRemovalCount` ≥ 1.
- `run` aceita `{ dryRun?: boolean }`; com a conexão pausada, só simulação é permitida.
- `summary.failing` lista as conexões com `failures ≥ 3`.

Rotas: exatamente a tabela da seção 6 da spec, mais `POST /connections/:id/confirm-identity`, com `sendError` do `server.ts` para `SyncError`/`StoreError`. O `runLimit` é `rateLimit('sincronização', 10)`.

Em `/api/notifications`, para administradores, acrescentar `syncFailing: summary.failing.length` e `syncBlocked: summary.blockedList.length`. Em `/api/status`, acrescentar `sync: summary`.

- [ ] **Step 1: Escrever os testes**

```ts
test('analista não cria conexão', async (t) => { await assert.rejects(svc.create(analyst, body), /administradores/i); });
test('sem SYNC_SECRET_KEY a criação é recusada', async (t) => { /* env sem chave → status 503 */ });
test('credencial vai criptografada e não volta', async (t) => {
  const c = await svc.create(admin, { clientId: 'a', type: 'memory', name: 'FW', config: { target: 't1' }, secret: { token: 'tok-1' } });
  assert.equal(c.hasSecret, true); assert.equal(JSON.stringify(c).includes('tok-1'), false);
  const row = await db.query<{ secret: string }>('SELECT secret FROM sync_connections WHERE id = $1', [c.id]);
  assert.match(row[0].secret, /^v1:/);
});
test('campo obrigatório ausente', async (t) => { /* sem config.target → mensagem cita o rótulo do campo */ });
test('atualizar sem credencial mantém a atual', async (t) => { });
test('conexão pausada só aceita simulação', async (t) => { });
test('backup leva conexões sem credencial e restauração volta pausada', async (t) => {
  /* exportFullBackupJSON não contém 'v1:'; restoreFullBackupJSON → conexão com enabled false, hasSecret false */
});
test('summary aponta conexões com 3 falhas e travadas', async (t) => { });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx tsx --test server/sync/service.test.ts` → FAIL.
- [ ] **Step 3: Implementar** serviço, rotas, ligação em `server.ts`, backup, `.env.example` e `package.json`.
- [ ] **Step 4: Rodar tudo** — `npm test` (todos PASS, incluindo os novos), `npm run lint` (sem erros), `npm run build` (ok).
- [ ] **Step 5: Verificar no servidor de desenvolvimento** — subir com `SYNC_SECRET_KEY` de teste, entrar como admin e conferir com `fetch` no navegador: `GET /api/sync/connectors` lista `memory`; criar conexão para o cliente fictício, `POST /run { dryRun: true }`, ligar, rodar, conferir `GET /connections/:id/runs` e o item no Histórico.
- [ ] **Step 6: Commit** — "Sincronização: API, ligação com o servidor e backup".
