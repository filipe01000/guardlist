import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { db } from './index.ts';
import {
  authAuditLogs,
  authorizedDevices,
  encryptedRecordHistory,
  encryptedRecords,
  syncOperationLog,
  users,
  vaults,
  webauthnChallenges,
  webauthnCredentials,
} from './schema.ts';
import type { Argon2Params, EncryptedVaultRecordV2 } from '../types/vault.ts';
import {
  assertWellFormedEncryptedRecordV2,
  type SyncPullResponse,
  type SyncPushItemResult,
  type SyncPushOperation,
} from '../services/SyncAdapter.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';

let shouldSimulateDbFailure = false;

export function setSimulateNextDbFailure(fail: boolean): void {
  shouldSimulateDbFailure = fail;
}

function checkSimulatedDbFailure(): void {
  if (shouldSimulateDbFailure) {
    shouldSimulateDbFailure = false;
    throw new Error('Simulated transient PostgreSQL outage');
  }
}

export function hashTokenSha256(raw: string): string {
  return bytesToHex(sha256(utf8ToBytes(raw)));
}

/**
 * Registra ou atualiza usuário de forma idempotente (onConflictDoUpdate) no PostgreSQL.
 */
export async function getOrCreateUser(uid: string, email: string) {
  try {
    checkSimulatedDbFailure();
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Falha ao sincronizar conta de usuário no banco de dados.', {
      cause: error,
    });
  }
}

/**
 * Registra evento de auditoria de autenticação sem jamais armazenar segredos
 * e utilizando HMAC-SHA256 com chave secreta rotativa (Fase 5C — §3) em vez de SHA-256 simples de IPv4.
 */
export async function recordAuthAuditEvent(params: {
  userUid: string;
  deviceId: string;
  eventType: string;
  clientIp: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  try {
    const safeMetadata = { ...(params.metadata || {}) };
    // Garante que nenhum campo sensível jamais entre no log estruturado
    delete safeMetadata.password;
    delete safeMetadata.masterPassword;
    delete safeMetadata.dek;
    delete safeMetadata.kek;
    delete safeMetadata.secretKey;
    delete safeMetadata.recoveryKey;
    delete safeMetadata.sessionToken;
    delete safeMetadata.csrfToken;

    const { scannerDetector } = await import(
      '../services/ScannerDetectionService.ts'
    );

    await db.insert(authAuditLogs).values({
      userUid: params.userUid,
      deviceId: params.deviceId,
      eventType: params.eventType,
      ipHashSha256: scannerDetector.pseudonymizeIdentifierHmac(
        params.clientIp || '0.0.0.0',
        'ip'
      ),
      metadataJson: JSON.stringify(safeMetadata),
    });
  } catch (error) {
    console.error('Audit log insert failed:', error);
  }
}

/**
 * Provisiona um novo dispositivo autorizado no PostgreSQL e retorna o token de sessão de transporte
 * + token CSRF vinculado à sessão.
 * Fase 5A (§1): Se a conta (`userUid`) já possui cofres ou credenciais WebAuthn registradas,
 * exige comprovação de posse da conta (`verifiedOwner: true`) para impedir registro de dispositivo em conta alheia!
 */
export async function provisionDeviceInDb(params: {
  userUid: string;
  email: string;
  deviceName: string;
  platform: 'desktop-web' | 'mobile-web' | 'ios' | 'android';
  authMethod: 'webauthn-passkey' | 'firebase-oauth' | 'session-token';
  webauthnCredentialId?: string;
  publicKeySpkiB64?: string;
  ttlMs?: number;
  verifiedOwner?: boolean;
  enforceStrictOwnershipIfVaultExists?: boolean;
}) {
  try {
    checkSimulatedDbFailure();

    // Verifica se já existem cofres ou passkeys pertencentes a este userUid
    const existingVaults = await db
      .select()
      .from(vaults)
      .where(eq(vaults.userUid, params.userUid));
    const existingPasskeys = await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userUid, params.userUid));

    // Um dispositivo já autorizado também conta: fecha a janela entre o primeiro
    // pareamento e o envio do cofre, em que a conta ainda não tem cofre nem passkey.
    const existingDevices = await db
      .select({ deviceId: authorizedDevices.deviceId })
      .from(authorizedDevices)
      .where(eq(authorizedDevices.userUid, params.userUid))
      .limit(1);

    const accountHasProtectedAssets =
      existingVaults.length > 0 ||
      existingPasskeys.length > 0 ||
      existingDevices.length > 0;

    if (
      accountHasProtectedAssets &&
      params.enforceStrictOwnershipIfVaultExists &&
      !params.verifiedOwner
    ) {
      const err = new Error(
        `Violação de Autorização (403 Forbidden): A conta "${params.userUid}" já possui cofre ou Passkey ativa. Para parear um novo dispositivo, autentique-se primeiro na conta existente.`
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    await getOrCreateUser(params.userUid, params.email);

    const deviceId = CryptoEngine.randomId('dev');
    const rawSessionToken = `dvlt_sess_${bytesToHex(CryptoEngine.getRandomBytes(24))}`;
    const rawCsrfToken = `dvlt_csrf_${bytesToHex(CryptoEngine.getRandomBytes(24))}`;
    const sessionTokenSha256 = hashTokenSha256(rawSessionToken);
    const csrfTokenSha256 = hashTokenSha256(rawCsrfToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (params.ttlMs ?? 30 * 24 * 60 * 60 * 1000)
    );

    const inserted = await db
      .insert(authorizedDevices)
      .values({
        deviceId,
        userUid: params.userUid,
        deviceName: params.deviceName.slice(0, 120),
        platform: params.platform,
        authMethod: params.authMethod,
        webauthnCredentialId: params.webauthnCredentialId || null,
        publicKeySpkiB64: params.publicKeySpkiB64 || null,
        sessionTokenSha256,
        csrfTokenSha256,
        authorizedAt: now,
        lastSeenAt: now,
        expiresAt,
        revokedAt: null,
      })
      .returning();

    return {
      device: inserted[0],
      rawSessionToken,
      rawCsrfToken,
    };
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database query failed in provisionDeviceInDb:', error);
    throw new Error('Falha ao provisionar dispositivo autorizado no PostgreSQL.', {
      cause: error,
    });
  }
}

/**
 * Verifica autenticação e autorização do dispositivo no PostgreSQL.
 * Checa propriedade da conta (`403 Forbidden`), revogação (`401 Unauthorized`) e expiração (`401 Unauthorized`).
 */
export async function verifyDeviceSessionInDb(params: {
  expectedUserUid?: string;
  deviceId: string;
  rawSessionToken: string;
}) {
  try {
    checkSimulatedDbFailure();
    const rows = await db
      .select()
      .from(authorizedDevices)
      .where(eq(authorizedDevices.deviceId, params.deviceId));

    const device = rows[0];
    if (!device) {
      const err = new Error('Dispositivo não encontrado ou não autorizado (401).');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    if (params.expectedUserUid && device.userUid !== params.expectedUserUid) {
      const err = new Error(
        `Violação de Autorização Entre Contas (403 Forbidden): Dispositivo pertence a outro usuário.`
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    if (device.revokedAt !== null) {
      const err = new Error(
        `Sessão Revogada (401 Unauthorized): O dispositivo "${device.deviceName}" foi revogado.`
      );
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    if (device.expiresAt.getTime() <= Date.now()) {
      const err = new Error(
        'Sessão Expirada (401 Unauthorized): Renove a autenticação do dispositivo.'
      );
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    const tokenHash = hashTokenSha256(params.rawSessionToken);
    if (tokenHash !== device.sessionTokenSha256) {
      const err = new Error('Token de sessão inválido (401 Unauthorized).');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }

    await db
      .update(authorizedDevices)
      .set({ lastSeenAt: new Date() })
      .where(eq(authorizedDevices.deviceId, device.deviceId));

    return device;
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database query failed in verifyDeviceSessionInDb:', error);
    throw new Error('Falha ao validar sessão do dispositivo no banco de dados.', {
      cause: error,
    });
  }
}

/**
 * Lista todos os dispositivos autorizados e revogados de um usuário no PostgreSQL.
 */
export async function listUserDevicesFromDb(userUid: string) {
  try {
    checkSimulatedDbFailure();
    const rows = await db
      .select()
      .from(authorizedDevices)
      .where(eq(authorizedDevices.userUid, userUid))
      .orderBy(desc(authorizedDevices.authorizedAt));

    return rows.map((d) => ({
      deviceId: d.deviceId,
      userUid: d.userUid,
      deviceName: d.deviceName,
      platform: d.platform,
      authMethod: d.authMethod,
      authorizedAt: d.authorizedAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
      revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
    }));
  } catch (error) {
    console.error('Database query failed in listUserDevicesFromDb:', error);
    throw new Error('Falha ao listar dispositivos do usuário.', { cause: error });
  }
}

/**
 * Revoga imediatamente um dispositivo autorizado do usuário no PostgreSQL.
 */
export async function revokeUserDeviceInDb(
  authenticatedUserUid: string,
  targetDeviceId: string
) {
  try {
    checkSimulatedDbFailure();
    const rows = await db
      .select()
      .from(authorizedDevices)
      .where(eq(authorizedDevices.deviceId, targetDeviceId));

    const target = rows[0];
    if (!target) {
      const err = new Error('Dispositivo não encontrado (404).');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    if (target.userUid !== authenticatedUserUid) {
      const err = new Error(
        'Violação de Autorização (403 Forbidden): Não é permitido revogar dispositivo de outra conta.'
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const now = new Date();
    const updated = await db
      .update(authorizedDevices)
      .set({ revokedAt: now })
      .where(eq(authorizedDevices.deviceId, targetDeviceId))
      .returning();

    return updated[0];
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database query failed in revokeUserDeviceInDb:', error);
    throw new Error('Falha ao revogar dispositivo no banco de dados.', {
      cause: error,
    });
  }
}

/**
 * Registra ou atualiza os metadados criptográficos Zero-Knowledge de um cofre no PostgreSQL.
 * Bloqueia tentativas de acesso entre usuários (403) e regressão de keyEpoch (Anti-Rollback).
 */
export async function registerOrUpdateVaultMetadataInDb(params: {
  userUid: string;
  vaultId: string;
  activeKeyEpoch: number;
  kdfParams: Argon2Params;
  saltHex: string;
  wrappedDekHex: string;
  dekNonceHex: string;
}) {
  try {
    checkSimulatedDbFailure();
    const existingRows = await db
      .select()
      .from(vaults)
      .where(eq(vaults.vaultId, params.vaultId));

    const existing = existingRows[0];
    if (existing) {
      if (existing.userUid !== params.userUid) {
        const err = new Error(
          'Violação de Autorização Entre Contas (403 Forbidden): Este cofre pertence a outro usuário.'
        );
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }
      if (params.activeKeyEpoch < existing.activeKeyEpoch) {
        const err = new Error(
          `Anti-Rollback de Chave (409 Conflict): Não é permitido regredir activeKeyEpoch de ${existing.activeKeyEpoch} para ${params.activeKeyEpoch}.`
        );
        (err as Error & { statusCode?: number }).statusCode = 409;
        throw err;
      }

      const updated = await db
        .update(vaults)
        .set({
          activeKeyEpoch: params.activeKeyEpoch,
          kdfParamsJson: JSON.stringify(params.kdfParams),
          saltHex: params.saltHex,
          wrappedDekHex: params.wrappedDekHex,
          dekNonceHex: params.dekNonceHex,
          updatedAt: new Date(),
        })
        .where(eq(vaults.vaultId, params.vaultId))
        .returning();
      return updated[0];
    }

    const inserted = await db
      .insert(vaults)
      .values({
        vaultId: params.vaultId,
        userUid: params.userUid,
        activeKeyEpoch: params.activeKeyEpoch,
        kdfParamsJson: JSON.stringify(params.kdfParams),
        saltHex: params.saltHex,
        wrappedDekHex: params.wrappedDekHex,
        dekNonceHex: params.dekNonceHex,
        updatedAt: new Date(),
      })
      .returning();

    return inserted[0];
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error(
      'Database query failed in registerOrUpdateVaultMetadataInDb:',
      error
    );
    throw new Error('Falha ao registrar metadados criptográficos do cofre.', {
      cause: error,
    });
  }
}

/**
 * Executa Push Incremental em transação PostgreSQL real com:
 * - Isolamento por usuário (403 Forbidden)
 * - Validação estrita Zero-Knowledge (assertWellFormedEncryptedRecordV2)
 * - Idempotência por operationId (syncOperationLog)
 * - Proteção contra keyEpoch obsoleta e Rollback de revisão
 * - Controle otimista de concorrência (Compare-And-Swap por expectedBaseRevision)
 * - Histórico criptografado automático de versões anteriores
 */
export async function pushEncryptedOperationsToDb(params: {
  userUid: string;
  vaultId: string;
  operations: SyncPushOperation[];
}): Promise<{ results: SyncPushItemResult[]; latestCursor: number }> {
  try {
    checkSimulatedDbFailure();
    return await db.transaction(async (tx) => {
      // Trava a linha do cofre até o fim da transação. Sem isso, dois envios simultâneos
      // liam o mesmo estado: recebiam o mesmo serverCursor (e um aparelho podia nunca baixar
      // um dos registros), as duas edições do mesmo item eram aceitas (uma sumia) e o mesmo
      // registro novo era gravado duas vezes. Com a trava, os envios de um cofre são em fila.
      const vaultRows = await tx
        .select()
        .from(vaults)
        .where(eq(vaults.vaultId, params.vaultId))
        .for('update');

      const vault = vaultRows[0];
      if (!vault) {
        const err = new Error('Cofre não encontrado no servidor (404).');
        (err as Error & { statusCode?: number }).statusCode = 404;
        throw err;
      }

      if (vault.userUid !== params.userUid) {
        const err = new Error(
          `Violação de Autorização Entre Contas (403 Forbidden): Usuário não tem permissão para acessar o cofre ${params.vaultId}.`
        );
        (err as Error & { statusCode?: number }).statusCode = 403;
        throw err;
      }

      let activeKeyEpoch = vault.activeKeyEpoch;

      // Obtém o maior serverCursor atual para este cofre
      const existingVaultRecords = await tx
        .select()
        .from(encryptedRecords)
        .where(eq(encryptedRecords.vaultId, params.vaultId));

      let currentMaxCursor = existingVaultRecords.reduce(
        (max, r) => Math.max(max, r.serverCursor),
        0
      );

      const recordsById = new Map(
        existingVaultRecords.map((r) => [r.recordId, r])
      );
      const results: SyncPushItemResult[] = [];

      for (const op of params.operations) {
        if (op.vaultId !== params.vaultId) {
          const err = new Error(
            'vaultId da operação diverge do cofre autenticado (400).'
          );
          (err as Error & { statusCode?: number }).statusCode = 400;
          throw err;
        }

        // 1. Valida formato criptográfico V2 e ausência total de texto puro
        try {
          assertWellFormedEncryptedRecordV2(op.record);
        } catch (validationErr) {
          const err = new Error(
            validationErr instanceof Error
              ? validationErr.message
              : 'Registro criptografado malformado.'
          );
          (err as Error & { statusCode?: number }).statusCode = 400;
          throw err;
        }

        // 2. Verifica idempotência por operationId no PostgreSQL
        const opLogRows = await tx
          .select()
          .from(syncOperationLog)
          .where(eq(syncOperationLog.operationId, op.operationId));

        if (opLogRows.length > 0) {
          const prev = opLogRows[0];
          results.push({
            operationId: op.operationId,
            recordId: prev.recordId,
            status: 'IDEMPOTENT_REPLAY',
            serverRevision: prev.serverRevision,
          });
          continue;
        }

        const existing = recordsById.get(op.record.recordId);

        // 3. Rejeita época de chave (keyEpoch) obsoleta após rotação de DEK
        if (op.record.keyEpoch < activeKeyEpoch) {
          results.push({
            operationId: op.operationId,
            recordId: op.record.recordId,
            status: 'REJECTED_STALE_KEY_EPOCH',
            serverRevision: existing ? existing.revision : 0,
            message: `Registro cifrado com keyEpoch=${op.record.keyEpoch}, mas o cofre exige keyEpoch>=${activeKeyEpoch}.`,
          });
          continue;
        }

        const serverRecordV2: EncryptedVaultRecordV2 | undefined = existing
          ? {
              recordId: existing.recordId,
              vaultId: existing.vaultId,
              recordType: existing.recordType as EncryptedVaultRecordV2['recordType'],
              formatVersion: 2,
              revision: existing.revision,
              keyEpoch: existing.keyEpoch,
              deleted: existing.deleted,
              updatedAt: existing.updatedAt.toISOString(),
              nonceHex: existing.nonceHex,
              ciphertextHex: existing.ciphertextHex,
              aadHashSha256Hex: existing.aadHashSha256Hex,
            }
          : undefined;

        // 4. Proteção contra Rollback e Conflitos de Revisão
        if (existing && op.record.revision <= existing.revision) {
          if (op.expectedBaseRevision < existing.revision) {
            results.push({
              operationId: op.operationId,
              recordId: op.record.recordId,
              status: 'CONFLICT',
              serverRevision: existing.revision,
              serverRecord: serverRecordV2,
              message: `Conflito otimista: expectedBaseRevision=${op.expectedBaseRevision}, serverRevision=${existing.revision}.`,
            });
            continue;
          }
          results.push({
            operationId: op.operationId,
            recordId: op.record.recordId,
            status: 'REJECTED_ROLLBACK',
            serverRevision: existing.revision,
            serverRecord: serverRecordV2,
            message: `Tentativa de Rollback rejeitada: revisão enviada (${op.record.revision}) <= revisão atual (${existing.revision}).`,
          });
          continue;
        }

        // 5. Compare-And-Swap (CAS) na expectedBaseRevision
        const currentRev = existing ? existing.revision : 0;
        if (op.expectedBaseRevision !== currentRev) {
          results.push({
            operationId: op.operationId,
            recordId: op.record.recordId,
            status: 'CONFLICT',
            serverRevision: currentRev,
            serverRecord: serverRecordV2,
            message: `Conflito detectado: expectedBaseRevision=${op.expectedBaseRevision}, serverRevision=${currentRev}.`,
          });
          continue;
        }

        // 6. Arquiva versão anterior no histórico criptografado antes de atualizar
        if (existing) {
          await tx.insert(encryptedRecordHistory).values({
            vaultId: existing.vaultId,
            recordId: existing.recordId,
            recordType: existing.recordType,
            revision: existing.revision,
            keyEpoch: existing.keyEpoch,
            deleted: existing.deleted,
            nonceHex: existing.nonceHex,
            ciphertextHex: existing.ciphertextHex,
            aadHashSha256Hex: existing.aadHashSha256Hex,
          });
        }

        currentMaxCursor += 1;
        const now = new Date();

        if (existing) {
          const updatedRows = await tx
            .update(encryptedRecords)
            .set({
              recordType: op.record.recordType,
              formatVersion: 2,
              revision: op.record.revision,
              keyEpoch: op.record.keyEpoch,
              deleted: op.record.deleted,
              nonceHex: op.record.nonceHex,
              ciphertextHex: op.record.ciphertextHex,
              aadHashSha256Hex: op.record.aadHashSha256Hex,
              serverCursor: currentMaxCursor,
              updatedAt: now,
            })
            .where(eq(encryptedRecords.id, existing.id))
            .returning();
          recordsById.set(op.record.recordId, updatedRows[0]);
        } else {
          const insertedRows = await tx
            .insert(encryptedRecords)
            .values({
              vaultId: params.vaultId,
              recordId: op.record.recordId,
              recordType: op.record.recordType,
              formatVersion: 2,
              revision: op.record.revision,
              keyEpoch: op.record.keyEpoch,
              deleted: op.record.deleted,
              nonceHex: op.record.nonceHex,
              ciphertextHex: op.record.ciphertextHex,
              aadHashSha256Hex: op.record.aadHashSha256Hex,
              serverCursor: currentMaxCursor,
              updatedAt: now,
            })
            .returning();
          recordsById.set(op.record.recordId, insertedRows[0]);
        }

        if (op.record.keyEpoch > activeKeyEpoch) {
          activeKeyEpoch = op.record.keyEpoch;
          await tx
            .update(vaults)
            .set({ activeKeyEpoch, updatedAt: now })
            .where(eq(vaults.vaultId, params.vaultId));
        }

        await tx.insert(syncOperationLog).values({
          operationId: op.operationId,
          vaultId: params.vaultId,
          userUid: params.userUid,
          recordId: op.record.recordId,
          status: 'APPLIED',
          serverRevision: op.record.revision,
          processedAt: now,
        });

        results.push({
          operationId: op.operationId,
          recordId: op.record.recordId,
          status: 'APPLIED',
          serverRevision: op.record.revision,
        });
      }

      return { results, latestCursor: currentMaxCursor };
    });
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database transaction failed in pushEncryptedOperationsToDb:', error);
    throw new Error(
      'Falha transacional no PostgreSQL ao processar lote de sincronização criptografada.',
      { cause: error }
    );
  }
}

/**
 * Executa Pull Incremental no PostgreSQL buscando apenas os registros com serverCursor > sinceCursor.
 */
export async function pullEncryptedRecordsFromDb(params: {
  userUid: string;
  vaultId: string;
  sinceCursor: number;
}): Promise<
  SyncPullResponse & {
    vaultMetadata: {
      kdfParams: Argon2Params;
      saltHex: string;
      wrappedDekHex: string;
      dekNonceHex: string;
    };
  }
> {
  try {
    checkSimulatedDbFailure();
    const vaultRows = await db
      .select()
      .from(vaults)
      .where(eq(vaults.vaultId, params.vaultId));

    const vault = vaultRows[0];
    if (!vault) {
      const err = new Error('Cofre não encontrado no servidor (404).');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }

    if (vault.userUid !== params.userUid) {
      const err = new Error(
        `Violação de Autorização Entre Contas (403 Forbidden): Usuário não tem permissão para acessar o cofre ${params.vaultId}.`
      );
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const allVaultRecords = await db
      .select()
      .from(encryptedRecords)
      .where(eq(encryptedRecords.vaultId, params.vaultId))
      .orderBy(asc(encryptedRecords.serverCursor));

    const currentServerCursor = allVaultRecords.reduce(
      (max, r) => Math.max(max, r.serverCursor),
      0
    );

    const changedRows = allVaultRecords.filter(
      (r) => r.serverCursor > params.sinceCursor
    );

    const records: EncryptedVaultRecordV2[] = changedRows.map((r) => ({
      recordId: r.recordId,
      vaultId: r.vaultId,
      recordType: r.recordType as EncryptedVaultRecordV2['recordType'],
      formatVersion: 2,
      revision: r.revision,
      keyEpoch: r.keyEpoch,
      deleted: r.deleted,
      updatedAt: r.updatedAt.toISOString(),
      nonceHex: r.nonceHex,
      ciphertextHex: r.ciphertextHex,
      aadHashSha256Hex: r.aadHashSha256Hex,
    }));

    return {
      vaultId: params.vaultId,
      currentServerCursor,
      currentKeyEpoch: vault.activeKeyEpoch,
      records,
      vaultMetadata: {
        kdfParams: JSON.parse(vault.kdfParamsJson) as Argon2Params,
        saltHex: vault.saltHex,
        wrappedDekHex: vault.wrappedDekHex,
        dekNonceHex: vault.dekNonceHex,
      },
    };
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database query failed in pullEncryptedRecordsFromDb:', error);
    throw new Error(
      'Falha ao consultar registros criptografados incrementais no PostgreSQL.',
      { cause: error }
    );
  }
}

/**
 * Consulta o histórico criptografado de revisões anteriores de um cofre no PostgreSQL.
 */
export async function getEncryptedVaultHistoryFromDb(params: {
  userUid: string;
  vaultId: string;
}): Promise<EncryptedVaultRecordV2[]> {
  try {
    checkSimulatedDbFailure();
    const vaultRows = await db
      .select()
      .from(vaults)
      .where(eq(vaults.vaultId, params.vaultId));

    const vault = vaultRows[0];
    if (!vault) {
      const err = new Error('Cofre não encontrado (404).');
      (err as Error & { statusCode?: number }).statusCode = 404;
      throw err;
    }
    if (vault.userUid !== params.userUid) {
      const err = new Error('Violação de Autorização (403 Forbidden).');
      (err as Error & { statusCode?: number }).statusCode = 403;
      throw err;
    }

    const rows = await db
      .select()
      .from(encryptedRecordHistory)
      .where(eq(encryptedRecordHistory.vaultId, params.vaultId))
      .orderBy(desc(encryptedRecordHistory.historyId));

    return rows.map((r) => ({
      recordId: r.recordId,
      vaultId: r.vaultId,
      recordType: r.recordType as EncryptedVaultRecordV2['recordType'],
      formatVersion: 2,
      revision: r.revision,
      keyEpoch: r.keyEpoch,
      deleted: r.deleted,
      updatedAt: r.archivedAt.toISOString(),
      nonceHex: r.nonceHex,
      ciphertextHex: r.ciphertextHex,
      aadHashSha256Hex: r.aadHashSha256Hex,
    }));
  } catch (error) {
    if ((error as Error & { statusCode?: number }).statusCode) {
      throw error;
    }
    console.error('Database query failed in getEncryptedVaultHistoryFromDb:', error);
    throw new Error('Falha ao buscar histórico criptografado.', { cause: error });
  }
}

/**
 * Inspeciona todos os registros brutos e logs de auditoria armazenados no PostgreSQL para um cofre
 * (usado pelos testes de integração para comprovar que ZERO segredos em texto puro existem no banco ou nos logs).
 */
export async function inspectRawDatabaseStateForTest(vaultId: string) {
  try {
    const recs = await db
      .select()
      .from(encryptedRecords)
      .where(gt(encryptedRecords.id, 0));
    const logs = await db
      .select()
      .from(authAuditLogs)
      .where(gt(authAuditLogs.auditId, 0));
    const vRows = await db
      .select()
      .from(vaults)
      .where(and(eq(vaults.vaultId, vaultId)));

    return {
      vaults: vRows,
      encryptedRecords: recs.filter((r) => r.vaultId === vaultId),
      auditLogs: logs,
    };
  } catch (error) {
    console.error('Database query failed in inspectRawDatabaseStateForTest:', error);
    throw new Error('Falha ao inspecionar estado bruto do banco.', {
      cause: error,
    });
  }
}

// ============================================================================
// FASE 5A — §1, §2, §3: WEBAUTHN PASSKEYS, SINGLE-USE CHALLENGES, CSRF & RECOVERY
// ============================================================================

/**
 * Cria um desafio criptográfico temporário e de uso único no PostgreSQL
 * (WebAuthn Registration, WebAuthn Authentication ou Ticket SSE efêmero).
 */
export async function createSingleUseChallengeInDb(params: {
  userUid: string;
  challenge: string;
  purpose: 'registration' | 'authentication' | 'sse-ticket';
  rpId: string;
  expectedOrigin: string;
  ttlMs?: number;
}) {
  checkSimulatedDbFailure();
  const challengeId = CryptoEngine.randomId('chal');
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? 5 * 60 * 1000));

  const inserted = await db
    .insert(webauthnChallenges)
    .values({
      challengeId,
      userUid: params.userUid,
      challenge: params.challenge,
      purpose: params.purpose,
      rpId: params.rpId,
      expectedOrigin: params.expectedOrigin,
      expiresAt,
      consumedAt: null,
    })
    .returning();

  return inserted[0];
}

/**
 * Consome atomicamente um desafio criptográfico de uso único.
 * Rejeita desafios inexistentes, expirados, de outra finalidade/usuário ou já utilizados (proteção Anti-Replay).
 */
export async function consumeSingleUseChallengeInDb(params: {
  challengeId?: string;
  userUid: string;
  purpose: 'registration' | 'authentication' | 'sse-ticket';
  expectedChallenge?: string;
}) {
  checkSimulatedDbFailure();
  const rows = params.challengeId
    ? await db
        .select()
        .from(webauthnChallenges)
        .where(eq(webauthnChallenges.challengeId, params.challengeId))
    : await db
        .select()
        .from(webauthnChallenges)
        .where(
          and(
            eq(webauthnChallenges.userUid, params.userUid),
            eq(webauthnChallenges.purpose, params.purpose)
          )
        )
        .orderBy(desc(webauthnChallenges.createdAt));

  const row = rows[0];
  if (!row) {
    const err = new Error(
      'Desafio criptográfico não encontrado ou inválido (401 Unauthorized).'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  if (row.userUid !== params.userUid || row.purpose !== params.purpose) {
    const err = new Error(
      'Desafio criptográfico não pertence a este usuário ou finalidade (403 Forbidden).'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  if (row.consumedAt !== null) {
    const err = new Error(
      'Ataque de Replay bloqueado (401 Unauthorized): Este desafio criptográfico de uso único já foi consumido anteriormente!'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    const err = new Error(
      'Desafio criptográfico expirado (401 Unauthorized). Solicite um novo desafio.'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  if (params.expectedChallenge && row.challenge !== params.expectedChallenge) {
    const err = new Error(
      'Divergência de desafio criptográfico (401 Unauthorized).'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  const updated = await db
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(webauthnChallenges.challengeId, row.challengeId))
    .returning();

  return updated[0];
}

/**
 * Salva uma credencial WebAuthn / Passkey verificada vinculada ao `userUid`.
 * Impede que uma mesma credencial seja registrada em outra conta.
 */
export async function saveWebAuthnCredentialInDb(params: {
  credentialId: string;
  userUid: string;
  email: string;
  publicKeyBytes: Uint8Array;
  counter: number;
  deviceType: string;
  backedUp: boolean;
  transports?: string[];
}) {
  checkSimulatedDbFailure();
  await getOrCreateUser(params.userUid, params.email);

  const existing = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, params.credentialId));

  if (existing.length > 0 && existing[0].userUid !== params.userUid) {
    const err = new Error(
      'Violação de Segurança WebAuthn (403 Forbidden): Esta Passkey já está vinculada a outra conta.'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const publicKeyBase64 = Buffer.from(params.publicKeyBytes).toString('base64');
  const transportsJson = JSON.stringify(params.transports || []);

  if (existing.length > 0) {
    const updated = await db
      .update(webauthnCredentials)
      .set({
        publicKeyBase64,
        counter: params.counter,
        deviceType: params.deviceType,
        backedUp: params.backedUp,
        transportsJson,
        lastUsedAt: new Date(),
      })
      .where(eq(webauthnCredentials.credentialId, params.credentialId))
      .returning();
    return updated[0];
  }

  const inserted = await db
    .insert(webauthnCredentials)
    .values({
      credentialId: params.credentialId,
      userUid: params.userUid,
      publicKeyBase64,
      counter: params.counter,
      deviceType: params.deviceType,
      backedUp: params.backedUp,
      transportsJson,
    })
    .returning();

  return inserted[0];
}

/**
 * Lista todas as Passkeys registradas para um usuário.
 */
export async function listUserWebAuthnCredentialsFromDb(userUid: string) {
  checkSimulatedDbFailure();
  return await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userUid, userUid));
}

/**
 * Busca uma Passkey específica vinculada ao `userUid` e atualiza o contador de assinaturas
 * (proteção contra clonagem de autenticador / replay).
 */
export async function verifyAndAdvanceWebAuthnCounterInDb(params: {
  credentialId: string;
  expectedUserUid: string;
  newCounter: number;
}) {
  checkSimulatedDbFailure();
  const rows = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, params.credentialId));

  const cred = rows[0];
  if (!cred) {
    const err = new Error('Passkey não encontrada (401 Unauthorized).');
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  if (cred.userUid !== params.expectedUserUid) {
    const err = new Error(
      'Violação de Autorização WebAuthn (403 Forbidden): Passkey pertence a outra conta.'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  if (
    (cred.counter > 0 || params.newCounter > 0) &&
    params.newCounter <= cred.counter
  ) {
    const err = new Error(
      `Alerta de Clonagem/Replay WebAuthn (401 Unauthorized): Contador de assinatura recebido (${params.newCounter}) não avançou em relação ao registrado (${cred.counter}).`
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  const updated = await db
    .update(webauthnCredentials)
    .set({
      counter: params.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(webauthnCredentials.credentialId, params.credentialId))
    .returning();

  return updated[0];
}

/**
 * Salva ou rotaciona o encapsulamento independente de recuperação de emergência da DEK no PostgreSQL (Fase 5A — §3).
 * Jamais armazena a Chave de Recuperação ou a DEK em texto puro.
 */
export async function saveVaultRecoveryWrapInDb(params: {
  userUid: string;
  vaultId: string;
  recoveryKeyVersion: number;
  recoverySaltHex: string;
  recoveryWrappedDekHex: string;
  recoveryDekNonceHex: string;
  recoveryKeyCommitmentSha256: string;
}) {
  checkSimulatedDbFailure();
  const rows = await db
    .select()
    .from(vaults)
    .where(eq(vaults.vaultId, params.vaultId));

  const vault = rows[0];
  if (!vault) {
    const err = new Error('Cofre não encontrado (404).');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  if (vault.userUid !== params.userUid) {
    const err = new Error(
      'Violação de Autorização (403 Forbidden): Não é permitido alterar a chave de recuperação de outro usuário.'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  if (params.recoveryKeyVersion <= vault.recoveryKeyVersion) {
    const err = new Error(
      `Anti-Rollback de Chave de Recuperação (409 Conflict): A nova versão (${params.recoveryKeyVersion}) deve ser maior que a versão atual (${vault.recoveryKeyVersion}).`
    );
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }

  const now = new Date();
  const updated = await db
    .update(vaults)
    .set({
      recoverySaltHex: params.recoverySaltHex,
      recoveryWrappedDekHex: params.recoveryWrappedDekHex,
      recoveryDekNonceHex: params.recoveryDekNonceHex,
      recoveryKeyVersion: params.recoveryKeyVersion,
      recoveryKeyCommitmentSha256: params.recoveryKeyCommitmentSha256,
      recoveryUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(vaults.vaultId, params.vaultId))
    .returning();

  return updated[0];
}

/**
 * Revoga a chave de recuperação de emergência atual limpando o blob encapsulado no servidor
 * e avançando a versão, impedindo que um Kit de Emergência antigo comprometido seja utilizado.
 */
export async function revokeVaultRecoveryKeyInDb(params: {
  userUid: string;
  vaultId: string;
}) {
  checkSimulatedDbFailure();
  const rows = await db
    .select()
    .from(vaults)
    .where(eq(vaults.vaultId, params.vaultId));

  const vault = rows[0];
  if (!vault) {
    const err = new Error('Cofre não encontrado (404).');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  if (vault.userUid !== params.userUid) {
    const err = new Error('Violação de Autorização (403 Forbidden).');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const now = new Date();
  const nextVersion = vault.recoveryKeyVersion + 1;
  const updated = await db
    .update(vaults)
    .set({
      recoverySaltHex: null,
      recoveryWrappedDekHex: null,
      recoveryDekNonceHex: null,
      recoveryKeyVersion: nextVersion,
      recoveryKeyCommitmentSha256: null,
      recoveryUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(vaults.vaultId, params.vaultId))
    .returning();

  return updated[0];
}

/**
 * Obtém o pacote criptografado de recuperação para um dispositivo totalmente novo
 * mediante apresentação do `recoveryKeyCommitmentSha256` (prova Zero-Knowledge de posse do Kit de Emergência).
 */
export async function fetchEmergencyRecoveryBundleFromDb(params: {
  vaultId: string;
  recoveryKeyCommitmentSha256: string;
}) {
  checkSimulatedDbFailure();
  const rows = await db
    .select()
    .from(vaults)
    .where(eq(vaults.vaultId, params.vaultId));

  const vault = rows[0];
  if (!vault) {
    // Anti-Enumeração (Fase 5B — §3): Executa hash dummy e retorna exatamente o mesmo 401
    // que um compromisso inválido para impedir enumeração de vaultId por status HTTP ou timing!
    hashTokenSha256(`decoy-commitment:${params.vaultId}:${params.recoveryKeyCommitmentSha256}`);
    const err = new Error(
      'Compromisso criptográfico do Kit de Emergência inválido ou substituído por versão mais recente (401 Unauthorized).'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  if (
    !vault.recoveryWrappedDekHex ||
    !vault.recoverySaltHex ||
    !vault.recoveryDekNonceHex ||
    !vault.recoveryKeyCommitmentSha256
  ) {
    const err = new Error(
      'Recuperação de emergência não habilitada ou revogada para este cofre (403 Forbidden).'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  if (
    vault.recoveryKeyCommitmentSha256 !== params.recoveryKeyCommitmentSha256
  ) {
    const err = new Error(
      'Compromisso criptográfico do Kit de Emergência inválido ou substituído por versão mais recente (401 Unauthorized).'
    );
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }

  const allVaultRecords = await db
    .select()
    .from(encryptedRecords)
    .where(eq(encryptedRecords.vaultId, params.vaultId))
    .orderBy(asc(encryptedRecords.serverCursor));

  const records: EncryptedVaultRecordV2[] = allVaultRecords.map((r) => ({
    recordId: r.recordId,
    vaultId: r.vaultId,
    recordType: r.recordType as EncryptedVaultRecordV2['recordType'],
    formatVersion: 2,
    revision: r.revision,
    keyEpoch: r.keyEpoch,
    deleted: r.deleted,
    updatedAt: r.updatedAt.toISOString(),
    nonceHex: r.nonceHex,
    ciphertextHex: r.ciphertextHex,
    aadHashSha256Hex: r.aadHashSha256Hex,
  }));

  return {
    vaultId: vault.vaultId,
    userUid: vault.userUid,
    recoveryMetadata: {
      vaultId: vault.vaultId,
      keyEpoch: vault.activeKeyEpoch,
      recoveryKeyVersion: vault.recoveryKeyVersion,
      kdfParams: JSON.parse(vault.kdfParamsJson) as Argon2Params,
      recoverySaltHex: vault.recoverySaltHex,
      recoveryWrappedDekHex: vault.recoveryWrappedDekHex,
      recoveryDekNonceHex: vault.recoveryDekNonceHex,
      recoveryKeyCommitmentSha256: vault.recoveryKeyCommitmentSha256,
    },
    records,
  };
}
