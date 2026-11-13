export type CategoryId =
  | 'redes-sociais'
  | 'bancos-financas'
  | 'trabalho-usina'
  | 'streaming-jogos'
  | 'compras-entregas'
  | 'email-contas'
  | 'outros';

export interface CategoryMeta {
  id: CategoryId;
  name: string;
  description: string;
  color: string;
  iconName: string;
}

export interface CredentialItem {
  id: string;
  serviceName: string;
  url: string;
  username: string;
  email: string;
  password: string;
  category: CategoryId;
  tags: string[];
  notes: string;
  favorite: boolean;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  deletedAt?: string | null; // ISO string if in trash
  revision?: number;
  conflictOfId?: string | null;
}

export interface SecretNote {
  id: string;
  title: string;
  content: string;
  category: string;
  favorite: boolean;
  colorTint: 'yellow' | 'pink' | 'blue' | 'mint';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  revision?: number;
  conflictOfId?: string | null;
}

export interface HardDeleteTombstone {
  recordId: string;
  recordType: 'credential' | 'note';
  deletedAt: string;
  revision: number;
  keyEpoch: number;
}

export interface VaultPayload {
  version: number;
  vaultId: string;
  revision: number;
  keyEpoch?: number;
  vaultName: string;
  createdAt: string;
  updatedAt: string;
  credentials: CredentialItem[];
  notes: SecretNote[];
  tombstones?: HardDeleteTombstone[];
  settings: {
    autoLockMinutes: number;
    theme: 'light' | 'dark';
    // Sincronização com o servidor. Cofres novos começam com `false` e o usuário ativa.
    // Ausente (cofres antigos) equivale a `true`, para não cortar quem já sincroniza.
    syncEnabled?: boolean;
    // Segredo de reconexão (64 hex). Com ele o navegador prova a posse do cofre quando a sessão
    // no servidor vence. Fica só aqui dentro, cifrado; o servidor recebe um token derivado.
    syncReauthSecretHex?: string;
  };
}

export type Argon2ProfileId =
  | 'legacy-v1'
  | 'owasp-mobile-v2'
  | 'owasp-desktop-v2'
  | 'owasp-high-v2'
  | 'test-fast';

export interface Argon2Params {
  t: number; // iterations / time cost
  m: number; // memory cost in KiB
  p: number; // parallelism
  dkLen: number; // 32 bytes (256 bits)
  profileId?: Argon2ProfileId;
}

/**
 * Contexto AAD (Additional Authenticated Data) usado no AES-256-GCM (Formato V1)
 * para autenticar identidade do cofre, tipo de registro e versão criptográfica.
 */
export interface AadContext {
  format: 'DONUTVAULT_ENCRYPTED_V1';
  version: 1;
  vaultId: string;
  recordType: 'dek-wrap' | 'vault-payload';
}

/**
 * Contexto AAD V2 (Registros Criptografados Individualmente):
 * Vincula criptograficamente vaultId, recordId, recordType, revision, keyEpoch e tombstone (deleted).
 */
export interface RecordAadContextV2 {
  format: 'DONUTVAULT_ENCRYPTED_V2';
  version: 2;
  vaultId: string;
  recordId: string;
  recordType: 'dek-wrap' | 'vault-settings' | 'credential' | 'note';
  revision: number;
  keyEpoch: number;
  deleted: boolean;
}

/**
 * Envelope criptografado V1 (Payload Único) — Mantido com 100% de retrocompatibilidade.
 */
export interface EncryptedVaultEnvelope {
  format: 'DONUTVAULT_ENCRYPTED_V1';
  version: 1;
  vaultId: string;
  revision: number;
  keyEpoch?: number;
  createdAt: string;
  updatedAt: string;
  kdf: 'argon2id';
  kdfParams: Argon2Params;
  saltHex: string; // 16 bytes random salt (128 bits)
  wrappedDekHex: string; // DEK encrypted with KEK via AES-256-GCM
  dekNonceHex: string; // 12 bytes (96-bit) random IV for DEK wrapping
  ciphertextHex: string; // VaultPayload JSON encrypted with DEK via AES-256-GCM
  payloadNonceHex: string; // 12 bytes (96-bit) unique IV per vault save
  integritySha256Hex: string; // SHA-256 over canonical header + vaultId + revision + salt + nonces + ciphertexts
}

/**
 * Registro Individual Criptografado V2 (E2EE Per-Record Architecture):
 * Nenhum dado privado (título, senha, usuário, URL, nota ou categoria) fica visível fora do ciphertextHex.
 */
export interface EncryptedVaultRecordV2 {
  recordId: string;
  vaultId: string;
  recordType: 'credential' | 'note' | 'vault-settings';
  formatVersion: 2;
  revision: number;
  keyEpoch: number;
  deleted: boolean; // Tombstone autenticado por AAD
  updatedAt: string;
  nonceHex: string; // 96-bit unique IV
  ciphertextHex: string; // Encrypted JSON of the record (or empty tombstoned payload)
  aadHashSha256Hex: string; // SHA-256 of canonical AAD for quick integrity verification
}

/**
 * Contêiner Criptografado V2 com Registros Individuais e Suporte a Sincronização Incremental E2EE.
 */
export interface EncryptedVaultContainerV2 {
  format: 'DONUTVAULT_ENCRYPTED_V2';
  version: 2;
  vaultId: string;
  revision: number;
  keyEpoch: number;
  requiresSecretKey?: boolean;
  createdAt: string;
  updatedAt: string;
  kdf: 'argon2id';
  kdfParams: Argon2Params;
  saltHex: string;
  wrappedDekHex: string;
  dekNonceHex: string;
  settingsRecord: EncryptedVaultRecordV2;
  records: EncryptedVaultRecordV2[];
  conflictArchive?: EncryptedVaultRecordV2[];
  migratedFromV1Snapshot?: EncryptedVaultEnvelope | null;
  integritySha256Hex: string;
}

export type BackupRestoreStrategy = 'merge' | 'replace';

export type NavigationTab =
  | 'dashboard'
  | 'passwords'
  | 'favorites'
  | 'generator'
  | 'security'
  | 'notes'
  | 'categories'
  | 'trash'
  | 'settings';

export interface PasswordGeneratorConfig {
  mode: 'random' | 'passphrase';
  length: number; // 8 to 128
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
  wordCount: number; // 3 to 10 for passphrase
  wordSeparator: string;
  capitalizeWords: boolean;
  includeNumberInPassphrase: boolean;
}
