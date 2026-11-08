import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Tabela de contas de usuários autenticadas (separadas do desbloqueio criptográfico do cofre).
 * Usa o UID (Firebase Auth UID ou WebAuthn Account UID) diretamente como chave primária textual.
 */
export const users = pgTable('users', {
  uid: text('uid').primaryKey(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Dispositivos autorizados (PC, Celular, WebAuthn/Passkeys, Sessões com expiração e revogação).
 * O servidor armazena apenas o hash SHA-256 do token de sessão e a chave pública WebAuthn.
 */
export const authorizedDevices = pgTable('authorized_devices', {
  deviceId: text('device_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  deviceName: text('device_name').notNull(),
  platform: text('platform').notNull(), // 'desktop-web' | 'mobile-web' | 'ios' | 'android'
  authMethod: text('auth_method').notNull(), // 'webauthn-passkey' | 'firebase-oauth' | 'session-token'
  webauthnCredentialId: text('webauthn_credential_id'),
  publicKeySpkiB64: text('public_key_spki_b64'),
  sessionTokenSha256: text('session_token_sha256').notNull(),
  csrfTokenSha256: text('csrf_token_sha256'),
  authorizedAt: timestamp('authorized_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
});

/**
 * Credenciais WebAuthn / Passkeys vinculadas criptograficamente à conta do usuário (§1 Fase 5A).
 * Armazena a chave pública COSE, o contador de assinaturas (anti-clone/anti-replay) e metadados do autenticador.
 */
export const webauthnCredentials = pgTable('webauthn_credentials', {
  credentialId: text('credential_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  publicKeyBase64: text('public_key_base64').notNull(),
  counter: integer('counter').default(0).notNull(),
  deviceType: text('device_type').default('singleDevice').notNull(),
  backedUp: boolean('backed_up').default(false).notNull(),
  transportsJson: text('transports_json').default('[]').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
});

/**
 * Desafios criptográficos temporários e de uso único (WebAuthn Registration, Authentication e Tickets SSE efêmeros).
 * Protege contra ataques de Replay marcando `consumed_at` atomicamente no primeiro uso.
 */
export const webauthnChallenges = pgTable('webauthn_challenges', {
  challengeId: text('challenge_id').primaryKey(),
  userUid: text('user_uid').notNull(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose').notNull(), // 'registration' | 'authentication' | 'sse-ticket'
  rpId: text('rp_id').notNull(),
  expectedOrigin: text('expected_origin').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Metadados criptográficos do cofre por usuário (Zero-Knowledge).
 * Armazena apenas salt, wrappedDekHex (DEK cifrada com KEK), activeKeyEpoch
 * e o encapsulamento independente de recuperação de emergência (DEK cifrada com RK-KEK de 256 bits).
 * Jamais armazena Senha Mestra, KEK, Secret Key, Recovery Key ou DEK em texto puro.
 */
export const vaults = pgTable('vaults', {
  vaultId: text('vault_id').primaryKey(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  activeKeyEpoch: integer('active_key_epoch').default(1).notNull(),
  kdfParamsJson: text('kdf_params_json').notNull(),
  saltHex: text('salt_hex').notNull(),
  wrappedDekHex: text('wrapped_dek_hex').notNull(),
  dekNonceHex: text('dek_nonce_hex').notNull(),
  recoverySaltHex: text('recovery_salt_hex'),
  recoveryWrappedDekHex: text('recovery_wrapped_dek_hex'),
  recoveryDekNonceHex: text('recovery_dek_nonce_hex'),
  recoveryKeyVersion: integer('recovery_key_version').default(0).notNull(),
  recoveryKeyCommitmentSha256: text('recovery_key_commitment_sha256'),
  recoveryUpdatedAt: timestamp('recovery_updated_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Registros individuais criptografados E2EE (EncryptedVaultRecordV2).
 * Cada credencial, nota secreta ou bloco de configurações é um blob cifrado AES-256-GCM opaco.
 */
export const encryptedRecords = pgTable('encrypted_records', {
  id: serial('id').primaryKey(),
  vaultId: text('vault_id')
    .references(() => vaults.vaultId)
    .notNull(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').notNull(), // 'credential' | 'note' | 'vault-settings'
  formatVersion: integer('format_version').default(2).notNull(),
  revision: integer('revision').notNull(),
  keyEpoch: integer('key_epoch').default(1).notNull(),
  deleted: boolean('deleted').default(false).notNull(), // Tombstone autenticado no AAD
  nonceHex: text('nonce_hex').notNull(),
  ciphertextHex: text('ciphertext_hex').notNull(),
  aadHashSha256Hex: text('aad_hash_sha256_hex').notNull(),
  serverCursor: integer('server_cursor').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Histórico criptografado de versões anteriores de registros (para proteção contra perda de dados e auditoria E2EE).
 */
export const encryptedRecordHistory = pgTable('encrypted_record_history', {
  historyId: serial('history_id').primaryKey(),
  vaultId: text('vault_id')
    .references(() => vaults.vaultId)
    .notNull(),
  recordId: text('record_id').notNull(),
  recordType: text('record_type').notNull(),
  revision: integer('revision').notNull(),
  keyEpoch: integer('key_epoch').notNull(),
  deleted: boolean('deleted').notNull(),
  nonceHex: text('nonce_hex').notNull(),
  ciphertextHex: text('ciphertext_hex').notNull(),
  aadHashSha256Hex: text('aad_hash_sha256_hex').notNull(),
  archivedAt: timestamp('archived_at').defaultNow().notNull(),
});

/**
 * Log de operações para garantir idempotência estrita por operationId no Push incremental.
 */
export const syncOperationLog = pgTable('sync_operation_log', {
  operationId: text('operation_id').primaryKey(),
  vaultId: text('vault_id')
    .references(() => vaults.vaultId)
    .notNull(),
  userUid: text('user_uid')
    .references(() => users.uid)
    .notNull(),
  recordId: text('record_id').notNull(),
  status: text('status').notNull(),
  serverRevision: integer('server_revision').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
});

/**
 * Auditoria de eventos de autenticação e segurança sem qualquer segredo em texto puro.
 */
export const authAuditLogs = pgTable('auth_audit_logs', {
  auditId: serial('audit_id').primaryKey(),
  userUid: text('user_uid').notNull(),
  deviceId: text('device_id').notNull(),
  eventType: text('event_type').notNull(),
  ipHashSha256: text('ip_hash_sha256').notNull(),
  metadataJson: text('metadata_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  devices: many(authorizedDevices),
  passkeys: many(webauthnCredentials),
  vaults: many(vaults),
}));

export const vaultsRelations = relations(vaults, ({ one, many }) => ({
  owner: one(users, {
    fields: [vaults.userUid],
    references: [users.uid],
  }),
  records: many(encryptedRecords),
}));
