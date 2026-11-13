import type {
  CredentialItem,
  EncryptedVaultEnvelope,
  EncryptedVaultRecordV2,
  SecretNote,
} from '../types/vault';
import { CryptoEngine } from './CryptoEngine';
import { DeviceSecurityModel } from './DeviceSecurityModel';

export interface SyncStatus {
  mode: 'local-only' | 'e2ee-ready';
  pendingRevision: number;
  queuedOperationsCount: number;
  unresolvedConflictsCount: number;
  lastPreparedAt: string | null;
}

export interface SyncPushOperation {
  operationId: string; // Idempotency key (UUID)
  vaultId: string;
  expectedBaseRevision: number; // 0 if new record, otherwise current revision known by client
  record: EncryptedVaultRecordV2;
  clientTimestamp: string;
}

export interface SyncPushItemResult {
  operationId: string;
  recordId: string;
  status:
    | 'APPLIED'
    | 'IDEMPOTENT_REPLAY'
    | 'CONFLICT'
    | 'REJECTED_ROLLBACK'
    | 'REJECTED_STALE_KEY_EPOCH';
  serverRevision: number;
  serverRecord?: EncryptedVaultRecordV2;
  message?: string;
}

export interface SyncPullResponse {
  vaultId: string;
  currentServerCursor: number;
  currentKeyEpoch: number;
  records: EncryptedVaultRecordV2[];
}

export interface OfflineQueueEntry {
  operation: SyncPushOperation;
  attempts: number;
  nextRetryAfterMs: number;
  lastError?: string;
}

export interface ClientConflictResolutionOutcome {
  primaryRecord: EncryptedVaultRecordV2;
  conflictCopyRecord: EncryptedVaultRecordV2 | null;
  archivedEncryptedVersion: EncryptedVaultRecordV2;
  resolutionType:
    | 'IDENTICAL_NOOP'
    | 'CONCURRENT_EDIT_FORKED'
    | 'EDIT_VS_DELETE_PRESERVED';
}

const HEX_CHECK = /^[0-9a-f]+$/i;

/**
 * Valida se um `EncryptedVaultRecordV2` recebido da rede ou da fila possui estrutura
 * criptográfica bem-formada e não expõe campos em texto puro.
 */
export function assertWellFormedEncryptedRecordV2(
  record: EncryptedVaultRecordV2
): void {
  if (
    !record ||
    typeof record !== 'object' ||
    record.formatVersion !== 2 ||
    !record.recordId ||
    !record.vaultId ||
    !['credential', 'note', 'vault-settings'].includes(record.recordType) ||
    typeof record.revision !== 'number' ||
    record.revision < 1 ||
    typeof record.keyEpoch !== 'number' ||
    record.keyEpoch < 1 ||
    typeof record.deleted !== 'boolean' ||
    typeof record.nonceHex !== 'string' ||
    record.nonceHex.length !== 24 ||
    !HEX_CHECK.test(record.nonceHex) ||
    typeof record.ciphertextHex !== 'string' ||
    record.ciphertextHex.length < 32 ||
    !HEX_CHECK.test(record.ciphertextHex) ||
    typeof record.aadHashSha256Hex !== 'string' ||
    record.aadHashSha256Hex.length !== 64 ||
    !HEX_CHECK.test(record.aadHashSha256Hex)
  ) {
    throw new Error(
      'Registro criptografado V2 malformado ou inválido rejeitado pelo protocolo Zero-Knowledge.'
    );
  }

  const raw = record as unknown as Record<string, unknown>;
  if (
    'password' in raw ||
    'serviceName' in raw ||
    'content' in raw ||
    'title' in raw ||
    'dek' in raw
  ) {
    throw new Error(
      'Violação Zero-Knowledge: Registro de sincronização contém propriedades em texto puro!'
    );
  }
}

/**
 * SyncAdapter (Fase 4A — Cliente):
 * Gerencia a fila offline de operações criptografadas, cálculo de backoff exponencial,
 * deduplicação de operações e resolução segura de conflitos no cliente sem perda de dados.
 */
export class SyncAdapter {
  private lastEnvelopeRevision = 0;
  private lastPreparedAt: string | null = null;
  private offlineQueue = new Map<string, OfflineQueueEntry>();
  private conflictArchive: EncryptedVaultRecordV2[] = [];

  /**
   * Compatibilidade com o fluxo de envelope V1/V2 local.
   */
  prepareEncryptedEnvelopeForSync(
    envelope: Pick<EncryptedVaultEnvelope, 'revision' | 'updatedAt'>
  ): SyncStatus {
    this.lastEnvelopeRevision = envelope.revision || 1;
    this.lastPreparedAt = envelope.updatedAt;
    return this.getStatus();
  }

  /**
   * Enfileira uma operação de registro criptografado V2 na fila offline do dispositivo.
   */
  enqueueRecordOperation(
    record: EncryptedVaultRecordV2,
    expectedBaseRevision: number,
    customOperationId?: string
  ): SyncPushOperation {
    assertWellFormedEncryptedRecordV2(record);
    const operation: SyncPushOperation = {
      operationId: customOperationId || CryptoEngine.randomId('op'),
      vaultId: record.vaultId,
      expectedBaseRevision,
      record: structuredClone(record),
      clientTimestamp: new Date().toISOString(),
    };

    this.offlineQueue.set(operation.operationId, {
      operation,
      attempts: 0,
      nextRetryAfterMs: 0,
    });
    this.lastEnvelopeRevision = Math.max(
      this.lastEnvelopeRevision,
      record.revision
    );
    this.lastPreparedAt = record.updatedAt;
    return structuredClone(operation);
  }

  /**
   * Calcula o atraso de retentativa com Exponential Backoff (base 500ms, teto 60s).
   */
  static computeBackoffDelayMs(attempts: number): number {
    const clamped = Math.min(Math.max(1, attempts), 8);
    return Math.min(60_000, 500 * Math.pow(2, clamped - 1));
  }

  /**
   * Marca falha temporária de rede em uma operação da fila offline, mantendo-a intacta
   * e agendando backoff exponencial.
   */
  recordTransientNetworkFailure(operationId: string, errorMessage: string): number {
    const entry = this.offlineQueue.get(operationId);
    if (!entry) return 0;
    entry.attempts += 1;
    entry.nextRetryAfterMs = SyncAdapter.computeBackoffDelayMs(entry.attempts);
    entry.lastError = errorMessage;
    return entry.nextRetryAfterMs;
  }

  /**
   * Remove operação da fila offline após confirmação (`APPLIED` ou `IDEMPOTENT_REPLAY`).
   */
  acknowledgeOperationSuccess(operationId: string): void {
    this.offlineQueue.delete(operationId);
  }

  /**
   * Esvazia a fila offline. Usado antes do primeiro envio de um cofre, que é substituído
   * por um retrato completo dos registros.
   */
  clearPendingQueue(): void {
    this.offlineQueue.clear();
  }

  getPendingQueue(): OfflineQueueEntry[] {
    return Array.from(this.offlineQueue.values()).map((e) =>
      structuredClone(e)
    );
  }

  getConflictArchive(): EncryptedVaultRecordV2[] {
    return this.conflictArchive.map((r) => structuredClone(r));
  }

  /**
   * Re-criptografa todos os itens pendentes na fila offline caso outro dispositivo tenha
   * rotacionado a DEK (`newKeyEpoch`) enquanto este dispositivo estava offline.
   */
  async reencryptOfflineQueueForNewKeyEpoch(
    oldDek: Uint8Array,
    newDek: Uint8Array,
    newKeyEpoch: number
  ): Promise<number> {
    let reencryptedCount = 0;
    for (const [opId, entry] of this.offlineQueue.entries()) {
      const oldRec = entry.operation.record;
      if (oldRec.keyEpoch < newKeyEpoch) {
        const decryptedObj = await CryptoEngine.unsealRecordV2<Record<string, unknown>>(
          oldDek,
          oldRec,
          oldRec.vaultId
        );
        const updatedRecord = await CryptoEngine.sealRecordV2(
          newDek,
          oldRec.vaultId,
          oldRec.recordId,
          oldRec.recordType,
          oldRec.revision,
          newKeyEpoch,
          oldRec.deleted,
          decryptedObj
        );
        entry.operation.record = updatedRecord;
        this.offlineQueue.set(opId, entry);
        reencryptedCount += 1;
      }
    }
    return reencryptedCount;
  }

  /**
   * Algoritmo Cliente de Resolução de Conflitos Zero-Knowledge (§5):
   * - O servidor jamais lê os dados; ele apenas informa `CONFLICT` e entrega `serverRecord` criptografado.
   * - O cliente descriptografa `localRecord` e `serverRecord` em memória com a `masterDek`.
   * - Jamais descarta silenciosamente alterações conflitantes:
   *   1. Se ambos editaram uma credencial/nota com conteúdos diferentes, preserva a versão mais recente
   *      como registro principal (`revision = serverRecord.revision + 1`) e gera um novo registro
   *      criptografado bifurcado (`conflictCopyRecord`) contendo a versão alternativa + arquiva o
   *      ciphertext original em `conflictArchive`.
   *   2. Se um dispositivo excluiu (`deleted: true`) e o outro editou (`deleted: false`), a edição
   *      é SEMPRE preservada (`EDIT_VS_DELETE_PRESERVED`) para impedir perda acidental de dados!
   */
  async resolveRecordConflictClientSide(
    masterDek: Uint8Array,
    localRecord: EncryptedVaultRecordV2,
    serverRecord: EncryptedVaultRecordV2,
    activeKeyEpoch: number
  ): Promise<ClientConflictResolutionOutcome> {
    assertWellFormedEncryptedRecordV2(localRecord);
    assertWellFormedEncryptedRecordV2(serverRecord);

    if (localRecord.vaultId !== serverRecord.vaultId) {
      throw new Error('Conflito inválido: registros pertencem a cofres distintos.');
    }

    const vaultId = localRecord.vaultId;
    const nextRevision = Math.max(localRecord.revision, serverRecord.revision) + 1;

    // Caso 1: Exclusão em um dispositivo vs Edição no outro -> Preserva SEMPRE o registro editado (não-excluído)
    if (localRecord.deleted !== serverRecord.deleted) {
      const survivingRecord = localRecord.deleted ? serverRecord : localRecord;
      const deletedRecord = localRecord.deleted ? localRecord : serverRecord;

      const survivingData = await CryptoEngine.unsealRecordV2<
        CredentialItem | SecretNote
      >(masterDek, survivingRecord, vaultId);

      const resurrected: CredentialItem | SecretNote = {
        ...survivingData,
        deletedAt: null,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
      };

      const primaryRecord = await CryptoEngine.sealRecordV2(
        masterDek,
        vaultId,
        localRecord.recordId,
        localRecord.recordType,
        nextRevision,
        activeKeyEpoch,
        false,
        resurrected
      );

      this.conflictArchive.push(structuredClone(deletedRecord));
      return {
        primaryRecord,
        conflictCopyRecord: null,
        archivedEncryptedVersion: structuredClone(deletedRecord),
        resolutionType: 'EDIT_VS_DELETE_PRESERVED',
      };
    }

    // Caso 2: Edições concorrentes no mesmo registro por dois dispositivos (PC e Celular)
    if (localRecord.recordType === 'credential') {
      const localCred = await CryptoEngine.unsealRecordV2<CredentialItem>(
        masterDek,
        localRecord,
        vaultId
      );
      const serverCred = await CryptoEngine.unsealRecordV2<CredentialItem>(
        masterDek,
        serverRecord,
        vaultId
      );

      // Se ambos fizeram exatamente a mesma edição, consolida sem duplicar
      if (
        localCred.password === serverCred.password &&
        localCred.username === serverCred.username &&
        localCred.serviceName === serverCred.serviceName &&
        localCred.url === serverCred.url &&
        localCred.notes === serverCred.notes
      ) {
        const primaryRecord = await CryptoEngine.sealRecordV2(
          masterDek,
          vaultId,
          localRecord.recordId,
          'credential',
          nextRevision,
          activeKeyEpoch,
          localRecord.deleted,
          { ...localCred, revision: nextRevision }
        );
        return {
          primaryRecord,
          conflictCopyRecord: null,
          archivedEncryptedVersion: structuredClone(serverRecord),
          resolutionType: 'IDENTICAL_NOOP',
        };
      }

      // Determina vencedor por timestamp (ou mantém local como vencedor em empate) e cria cópia bifurcada para o perdedor
      const localIsNewer =
        Date.parse(localCred.updatedAt) >= Date.parse(serverCred.updatedAt);
      const winner = localIsNewer ? localCred : serverCred;
      const loser = localIsNewer ? serverCred : localCred;
      const loserEncrypted = localIsNewer ? serverRecord : localRecord;

      const primaryRecord = await CryptoEngine.sealRecordV2(
        masterDek,
        vaultId,
        localRecord.recordId,
        'credential',
        nextRevision,
        activeKeyEpoch,
        false,
        {
          ...winner,
          revision: nextRevision,
          updatedAt: new Date().toISOString(),
        }
      );

      const forkId = CryptoEngine.randomId('cred-conflict');
      const forkedCred: CredentialItem = {
        ...loser,
        id: forkId,
        serviceName: `${loser.serviceName} [Conflito Preservado]`,
        conflictOfId: winner.id,
        revision: 1,
        updatedAt: new Date().toISOString(),
      };

      const conflictCopyRecord = await CryptoEngine.sealRecordV2(
        masterDek,
        vaultId,
        forkId,
        'credential',
        1,
        activeKeyEpoch,
        false,
        forkedCred
      );

      this.conflictArchive.push(structuredClone(loserEncrypted));
      return {
        primaryRecord,
        conflictCopyRecord,
        archivedEncryptedVersion: structuredClone(loserEncrypted),
        resolutionType: 'CONCURRENT_EDIT_FORKED',
      };
    }

    // Notas secretas editadas concorrentemente
    const localNote = await CryptoEngine.unsealRecordV2<SecretNote>(
      masterDek,
      localRecord,
      vaultId
    );
    const serverNote = await CryptoEngine.unsealRecordV2<SecretNote>(
      masterDek,
      serverRecord,
      vaultId
    );

    const localIsNewer =
      Date.parse(localNote.updatedAt) >= Date.parse(serverNote.updatedAt);
    const winnerNote = localIsNewer ? localNote : serverNote;
    const loserNote = localIsNewer ? serverNote : localNote;
    const loserEncrypted = localIsNewer ? serverRecord : localRecord;

    const primaryRecord = await CryptoEngine.sealRecordV2(
      masterDek,
      vaultId,
      localRecord.recordId,
      'note',
      nextRevision,
      activeKeyEpoch,
      false,
      {
        ...winnerNote,
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
      }
    );

    const forkId = CryptoEngine.randomId('note-conflict');
    const forkedNote: SecretNote = {
      ...loserNote,
      id: forkId,
      title: `${loserNote.title} [Conflito Preservado]`,
      conflictOfId: winnerNote.id,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };

    const conflictCopyRecord = await CryptoEngine.sealRecordV2(
      masterDek,
      vaultId,
      forkId,
      'note',
      1,
      activeKeyEpoch,
      false,
      forkedNote
    );

    this.conflictArchive.push(structuredClone(loserEncrypted));
    return {
      primaryRecord,
      conflictCopyRecord,
      archivedEncryptedVersion: structuredClone(loserEncrypted),
      resolutionType: 'CONCURRENT_EDIT_FORKED',
    };
  }

  /**
   * Exporta o estado da fila offline e cursor de sincronização para persistência no IndexedDB.
   */
  exportPersistentQueueState(lastCursor = 0): string {
    return JSON.stringify({
      lastCursor,
      lastEnvelopeRevision: this.lastEnvelopeRevision,
      lastPreparedAt: this.lastPreparedAt,
      queue: Array.from(this.offlineQueue.entries()),
      conflictArchive: this.conflictArchive,
    });
  }

  /**
   * Restaura a fila offline persistida do IndexedDB após recarregamento ou reconexão.
   */
  restorePersistentQueueState(serializedJson: string): { lastCursor: number } {
    try {
      const parsed = JSON.parse(serializedJson) as {
        lastCursor?: number;
        lastEnvelopeRevision?: number;
        lastPreparedAt?: string | null;
        queue?: [string, OfflineQueueEntry][];
        conflictArchive?: EncryptedVaultRecordV2[];
      };
      if (Array.isArray(parsed.queue)) {
        this.offlineQueue = new Map(parsed.queue);
      }
      if (Array.isArray(parsed.conflictArchive)) {
        this.conflictArchive = parsed.conflictArchive;
      }
      if (typeof parsed.lastEnvelopeRevision === 'number') {
        this.lastEnvelopeRevision = parsed.lastEnvelopeRevision;
      }
      if (parsed.lastPreparedAt !== undefined) {
        this.lastPreparedAt = parsed.lastPreparedAt;
      }
      return { lastCursor: parsed.lastCursor || 0 };
    } catch {
      return { lastCursor: 0 };
    }
  }

  /**
   * Registra um novo dispositivo autorizado no backend real (`POST /api/v1/auth/devices/register`).
   */
  async registerDeviceOnBackend(
    baseUrl: string,
    params: {
      userUid: string;
      email?: string;
      deviceName: string;
      platform: 'desktop-web' | 'mobile-web' | 'ios' | 'android';
      authMethod: 'webauthn-passkey' | 'firebase-oauth' | 'session-token';
      webauthnCredentialId?: string;
      // Prova de posse do cofre (CryptoEngine.deriveVaultReauthToken), usada quando a sessão venceu.
      vaultReauthToken?: string;
    },
    // Sessão de um dispositivo já autorizado da mesma conta. O servidor exige essa prova
    // para parear um novo dispositivo em conta existente (sem ela, só o cookie HttpOnly vale).
    ownerAuth?: { deviceId: string; sessionToken: string }
  ): Promise<{
    device: {
      deviceId: string;
      userUid: string;
      deviceName: string;
      platform: string;
      authMethod: string;
      authorizedAt: string;
      lastSeenAt: string;
      expiresAt: string;
      revokedAt: string | null;
    };
    sessionToken: string;
  }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (ownerAuth) {
      headers.Authorization = `Bearer ${ownerAuth.sessionToken}`;
      headers['X-Device-Id'] = ownerAuth.deviceId;
    }
    const res = await fetch(`${baseUrl}/api/v1/auth/devices/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Registra ou atualiza os metadados criptográficos Zero-Knowledge do cofre no backend (`POST /api/v1/sync/vault`).
   */
  async registerVaultOnBackend(
    baseUrl: string,
    auth: { userUid: string; deviceId: string; sessionToken: string },
    vaultMeta: {
      vaultId: string;
      activeKeyEpoch: number;
      kdfParams: EncryptedVaultEnvelope['kdfParams'];
      saltHex: string;
      wrappedDekHex: string;
      dekNonceHex: string;
      // Prova de posse do cofre; o servidor a exige quando estes metadados mudam.
      vaultReauthToken?: string;
    }
  ): Promise<{ vaultId: string; activeKeyEpoch: number; updatedAt: string }> {
    const res = await fetch(`${baseUrl}/api/v1/sync/vault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.sessionToken}`,
        'X-Device-Id': auth.deviceId,
        'X-User-Uid': auth.userUid,
      },
      body: JSON.stringify(vaultMeta),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Envia todas as operações pendentes da fila offline para o backend (`POST /api/v1/sync/push`)
   * e resolve automaticamente eventuais conflitos no cliente sem perda de dados!
   */
  async flushOfflineQueueToBackend(
    baseUrl: string,
    auth: { userUid: string; deviceId: string; sessionToken: string },
    vaultId: string,
    masterDek: Uint8Array,
    activeKeyEpoch: number
  ): Promise<{
    appliedCount: number;
    idempotentReplaysCount: number;
    resolvedConflicts: ClientConflictResolutionOutcome[];
    latestCursor: number;
  }> {
    const pendingEntries = Array.from(this.offlineQueue.values()).filter(
      (e) => e.operation.vaultId === vaultId
    );
    if (pendingEntries.length === 0) {
      return {
        appliedCount: 0,
        idempotentReplaysCount: 0,
        resolvedConflicts: [],
        latestCursor: 0,
      };
    }

    const operations = pendingEntries.map((e) => e.operation);
    const res = await fetch(`${baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.sessionToken}`,
        'X-Device-Id': auth.deviceId,
        'X-User-Uid': auth.userUid,
      },
      body: JSON.stringify({ vaultId, operations }),
    });

    const data = await res.json();
    if (!res.ok) {
      for (const op of operations) {
        this.recordTransientNetworkFailure(
          op.operationId,
          data.error || `HTTP ${res.status}`
        );
      }
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }

    const results = (data.results || []) as SyncPushItemResult[];
    let appliedCount = 0;
    let idempotentReplaysCount = 0;
    let latestCursor = Number(data.latestCursor || 0);
    const resolvedConflicts: ClientConflictResolutionOutcome[] = [];

    for (const r of results) {
      const queuedEntry = this.offlineQueue.get(r.operationId);
      if (r.status === 'APPLIED') {
        appliedCount += 1;
        this.acknowledgeOperationSuccess(r.operationId);
      } else if (r.status === 'IDEMPOTENT_REPLAY') {
        idempotentReplaysCount += 1;
        this.acknowledgeOperationSuccess(r.operationId);
      } else if (
        r.status === 'CONFLICT' &&
        queuedEntry &&
        r.serverRecord
      ) {
        const outcome = await this.resolveRecordConflictClientSide(
          masterDek,
          queuedEntry.operation.record,
          r.serverRecord,
          activeKeyEpoch
        );
        resolvedConflicts.push(outcome);
        this.acknowledgeOperationSuccess(r.operationId);

        const followUpOps: SyncPushOperation[] = [
          {
            operationId: CryptoEngine.randomId('op-resolve'),
            vaultId,
            expectedBaseRevision: r.serverRevision,
            record: outcome.primaryRecord,
            clientTimestamp: new Date().toISOString(),
          },
        ];
        if (outcome.conflictCopyRecord) {
          followUpOps.push({
            operationId: CryptoEngine.randomId('op-fork'),
            vaultId,
            expectedBaseRevision: 0,
            record: outcome.conflictCopyRecord,
            clientTimestamp: new Date().toISOString(),
          });
        }

        const followRes = await fetch(`${baseUrl}/api/v1/sync/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.sessionToken}`,
            'X-Device-Id': auth.deviceId,
            'X-User-Uid': auth.userUid,
          },
          body: JSON.stringify({ vaultId, operations: followUpOps }),
        });
        if (followRes.ok) {
          const followData = await followRes.json();
          latestCursor = Math.max(
            latestCursor,
            Number(followData.latestCursor || 0)
          );
          appliedCount += followUpOps.length;
        }
      }
    }

    return {
      appliedCount,
      idempotentReplaysCount,
      resolvedConflicts,
      latestCursor,
    };
  }

  /**
   * Realiza Pull Incremental do backend (`GET /api/v1/sync/pull`) e descriptografa
   * os registros localmente em memória usando a `masterDek` do dispositivo.
   */
  async pullAndDecryptFromBackend(
    baseUrl: string,
    auth: { userUid: string; deviceId: string; sessionToken: string },
    vaultId: string,
    sinceCursor: number,
    masterDek: Uint8Array
  ): Promise<{
    currentServerCursor: number;
    currentKeyEpoch: number;
    decryptedCredentials: CredentialItem[];
    decryptedNotes: SecretNote[];
    deletedRecordIds: string[];
    rawRecords: EncryptedVaultRecordV2[];
  }> {
    const url = `${baseUrl}/api/v1/sync/pull?vaultId=${encodeURIComponent(
      vaultId
    )}&sinceCursor=${sinceCursor}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.sessionToken}`,
        'X-Device-Id': auth.deviceId,
        'X-User-Uid': auth.userUid,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Erro HTTP ${res.status}`);
    }

    const records = (data.records || []) as EncryptedVaultRecordV2[];
    const decryptedCredentials: CredentialItem[] = [];
    const decryptedNotes: SecretNote[] = [];
    const deletedRecordIds: string[] = [];

    for (const rec of records) {
      assertWellFormedEncryptedRecordV2(rec);
      if (rec.deleted) {
        deletedRecordIds.push(rec.recordId);
      }
      if (rec.recordType === 'credential') {
        const cred = await CryptoEngine.unsealRecordV2<CredentialItem>(
          masterDek,
          rec,
          vaultId
        );
        decryptedCredentials.push({ ...cred, revision: rec.revision });
      } else if (rec.recordType === 'note') {
        const note = await CryptoEngine.unsealRecordV2<SecretNote>(
          masterDek,
          rec,
          vaultId
        );
        decryptedNotes.push({ ...note, revision: rec.revision });
      }
    }

    return {
      currentServerCursor: Number(data.currentServerCursor || 0),
      currentKeyEpoch: Number(data.currentKeyEpoch || 1),
      decryptedCredentials,
      decryptedNotes,
      deletedRecordIds,
      rawRecords: records,
    };
  }

  getStatus(): SyncStatus {
    return {
      mode: 'e2ee-ready',
      pendingRevision: this.lastEnvelopeRevision,
      queuedOperationsCount: this.offlineQueue.size,
      unresolvedConflictsCount: this.conflictArchive.length,
      lastPreparedAt: this.lastPreparedAt,
    };
  }
}

/**
 * ZeroKnowledgeSyncServerEngine (Fase 4A — Simulador de Contratos do Servidor para Testes Obrigatórios §3, §5, §7):
 * Valida o comportamento exato do servidor proposto (Fastify + PostgreSQL) sem jamais possuir chaves:
 * - Isolamento por `userId` e validação de sessão/revogação via `DeviceSecurityModel`
 * - Comparação e Troca Atômica (CAS) de `revision` por `recordId`
 * - Idempotência estrita por `operationId` (reenvio de operações antigas/duplicadas)
 * - Rejeição de tentativas de Rollback e de `keyEpoch` obsoleta
 * - Suporte a Pull Incremental por cursor monotônico (`serverCursor`) e Tombstones de exclusão
 */
export class ZeroKnowledgeSyncServerEngine {
  private readonly deviceAuth: DeviceSecurityModel;
  private vaultOwners = new Map<string, string>(); // vaultId -> userId
  private vaultKeyEpochs = new Map<string, number>(); // vaultId -> currentKeyEpoch
  private recordsByVault = new Map<
    string,
    Map<string, { record: EncryptedVaultRecordV2; cursor: number }>
  >();
  private encryptedHistoryByVault = new Map<string, EncryptedVaultRecordV2[]>();
  private processedOperations = new Map<string, SyncPushItemResult>();
  private globalCursor = 0;

  constructor(deviceAuth: DeviceSecurityModel) {
    this.deviceAuth = deviceAuth;
  }

  /**
   * Registra a propriedade de um cofre para um `userId` autenticado.
   */
  registerVaultOwnership(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string,
    initialKeyEpoch = 1
  ): void {
    this.deviceAuth.verifyDeviceAuthorization(userId, deviceId, sessionToken);
    const existingOwner = this.vaultOwners.get(vaultId);
    if (existingOwner && existingOwner !== userId) {
      throw new Error(
        'Violação de Autorização (403 Forbidden): Este vaultId pertence a outro usuário.'
      );
    }
    this.vaultOwners.set(vaultId, userId);
    if (!this.vaultKeyEpochs.has(vaultId)) {
      this.vaultKeyEpochs.set(vaultId, initialKeyEpoch);
    }
    if (!this.recordsByVault.has(vaultId)) {
      this.recordsByVault.set(vaultId, new Map());
    }
    if (!this.encryptedHistoryByVault.has(vaultId)) {
      this.encryptedHistoryByVault.set(vaultId, []);
    }
  }

  /**
   * Atualiza o `keyEpoch` mínimo exigido pelo cofre após uma rotação de chave DEK.
   */
  advanceVaultKeyEpoch(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string,
    newKeyEpoch: number
  ): void {
    this.assertUserOwnsVault(userId, deviceId, sessionToken, vaultId);
    const currentEpoch = this.vaultKeyEpochs.get(vaultId) || 1;
    if (newKeyEpoch < currentEpoch) {
      throw new Error(
        `Anti-Rollback de Chave: Não é permitido regredir keyEpoch de ${currentEpoch} para ${newKeyEpoch}.`
      );
    }
    this.vaultKeyEpochs.set(vaultId, newKeyEpoch);
  }

  private assertUserOwnsVault(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string
  ): void {
    this.deviceAuth.verifyDeviceAuthorization(userId, deviceId, sessionToken);
    const owner = this.vaultOwners.get(vaultId);
    if (!owner) {
      throw new Error('Cofre não registrado no servidor (404).');
    }
    if (owner !== userId) {
      throw new Error(
        `Violação de Autorização Entre Usuários (403 Forbidden): Usuário ${userId} não tem permissão para acessar o cofre ${vaultId}.`
      );
    }
  }

  /**
   * Endpoint Zero-Knowledge `POST /api/v1/sync/push`:
   * Processa operações criptografadas com idempotência por `operationId` e Compare-And-Swap por revisão.
   */
  pushOperations(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string,
    operations: SyncPushOperation[]
  ): SyncPushItemResult[] {
    this.assertUserOwnsVault(userId, deviceId, sessionToken, vaultId);
    const vaultRecords = this.recordsByVault.get(vaultId)!;
    const vaultHistory = this.encryptedHistoryByVault.get(vaultId)!;
    const activeKeyEpoch = this.vaultKeyEpochs.get(vaultId) || 1;

    const results: SyncPushItemResult[] = [];

    for (const op of operations) {
      if (op.vaultId !== vaultId) {
        throw new Error('vaultId da operação diverge do cofre autenticado.');
      }

      // 1. Valida formato criptográfico estrito antes de tocar no estado
      assertWellFormedEncryptedRecordV2(op.record);

      // 2. Idempotência: se o `operationId` já foi processado antes, retorna o mesmo resultado sem reexecutar!
      const alreadyProcessed = this.processedOperations.get(op.operationId);
      if (alreadyProcessed) {
        results.push({
          ...alreadyProcessed,
          status: 'IDEMPOTENT_REPLAY',
        });
        continue;
      }

      // 3. Verifica se o registro usa uma época de chave (keyEpoch) obsoleta após rotação de DEK
      if (op.record.keyEpoch < activeKeyEpoch) {
        results.push({
          operationId: op.operationId,
          recordId: op.record.recordId,
          status: 'REJECTED_STALE_KEY_EPOCH',
          serverRevision:
            vaultRecords.get(op.record.recordId)?.record.revision || 0,
          message: `Registro cifrado com keyEpoch=${op.record.keyEpoch}, mas o cofre exige keyEpoch>=${activeKeyEpoch}.`,
        });
        continue;
      }

      const existingEntry = vaultRecords.get(op.record.recordId);

      // 4. Proteção contra Rollback de revisão
      if (existingEntry && op.record.revision <= existingEntry.record.revision) {
        if (op.expectedBaseRevision < existingEntry.record.revision) {
          results.push({
            operationId: op.operationId,
            recordId: op.record.recordId,
            status: 'CONFLICT',
            serverRevision: existingEntry.record.revision,
            serverRecord: structuredClone(existingEntry.record),
            message: `Conflito CAS: revisão base esperada (${op.expectedBaseRevision}) diverge da revisão no servidor (${existingEntry.record.revision}).`,
          });
          continue;
        }
        results.push({
          operationId: op.operationId,
          recordId: op.record.recordId,
          status: 'REJECTED_ROLLBACK',
          serverRevision: existingEntry.record.revision,
          serverRecord: structuredClone(existingEntry.record),
          message: `Tentativa de Rollback rejeitada: revisão enviada (${op.record.revision}) <= revisão atual (${existingEntry.record.revision}).`,
        });
        continue;
      }

      // 5. Compare-And-Swap (CAS) Atômico na revisão base esperada
      const currentRev = existingEntry ? existingEntry.record.revision : 0;
      if (op.expectedBaseRevision !== currentRev) {
        results.push({
          operationId: op.operationId,
          recordId: op.record.recordId,
          status: 'CONFLICT',
          serverRevision: currentRev,
          serverRecord: existingEntry
            ? structuredClone(existingEntry.record)
            : undefined,
          message: `Conflito detectado: expectedBaseRevision=${op.expectedBaseRevision}, serverRevision=${currentRev}.`,
        });
        continue;
      }

      // 6. Aplica a atualização atomicamente e arquiva versão anterior no histórico criptografado
      if (existingEntry) {
        vaultHistory.push(structuredClone(existingEntry.record));
      }
      this.globalCursor += 1;
      const storedRecord = structuredClone(op.record);
      vaultRecords.set(storedRecord.recordId, {
        record: storedRecord,
        cursor: this.globalCursor,
      });

      if (storedRecord.keyEpoch > activeKeyEpoch) {
        this.vaultKeyEpochs.set(vaultId, storedRecord.keyEpoch);
      }

      const appliedResult: SyncPushItemResult = {
        operationId: op.operationId,
        recordId: storedRecord.recordId,
        status: 'APPLIED',
        serverRevision: storedRecord.revision,
      };
      this.processedOperations.set(op.operationId, appliedResult);
      results.push(appliedResult);
    }

    return results;
  }

  /**
   * Endpoint Zero-Knowledge `GET /api/v1/sync/pull`:
   * Retorna apenas os registros criptografados cujo cursor de modificação é maior que `sinceCursor`.
   */
  pullIncremental(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string,
    sinceCursor = 0
  ): SyncPullResponse {
    this.assertUserOwnsVault(userId, deviceId, sessionToken, vaultId);
    const vaultRecords = this.recordsByVault.get(vaultId)!;
    const changed: EncryptedVaultRecordV2[] = [];

    for (const entry of vaultRecords.values()) {
      if (entry.cursor > sinceCursor) {
        changed.push(structuredClone(entry.record));
      }
    }

    return {
      vaultId,
      currentServerCursor: this.globalCursor,
      currentKeyEpoch: this.vaultKeyEpochs.get(vaultId) || 1,
      records: changed,
    };
  }

  /**
   * Retorna o histórico criptografado retido no servidor para auditoria/recuperação.
   */
  getEncryptedHistory(
    userId: string,
    deviceId: string,
    sessionToken: string,
    vaultId: string
  ): EncryptedVaultRecordV2[] {
    this.assertUserOwnsVault(userId, deviceId, sessionToken, vaultId);
    return (this.encryptedHistoryByVault.get(vaultId) || []).map((r) =>
      structuredClone(r)
    );
  }
}
