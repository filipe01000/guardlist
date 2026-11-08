import type { EncryptedVaultEnvelope } from '../types/vault';
import { CryptoEngine } from './CryptoEngine';

const DB_NAME = 'DonutVaultEncryptedDB';
const DB_VERSION = 1;
const STORE_NAME = 'vault_envelopes';
const PRIMARY_KEY = 'primary_donut_vault';

const HEX_REGEX = /^[0-9a-f]+$/i;

export interface SaveEnvelopeOptions {
  allowRollbackOrReplace?: boolean;
}

/**
 * StorageService:
 * Camada isolada de persistência local criptografada com garantias de:
 * - Atomicidade de escrita (preservação do estado anterior em caso de falha/queda de energia)
 * - Proteção Anti-Rollback (impede regressão de `revision` para o mesmo `vaultId`)
 * - Detecção de reutilização de Nonce AES-GCM
 * - Rejeição de estruturas maliciosas, Prototype Pollution e parâmetros KDF inválidos
 * - Jamais utiliza localStorage ou sessionStorage para armazenar segredos
 */
export class StorageService {
  private static memoryFallbackStore = new Map<string, string>();
  private static shouldFailNextWrite = false;

  /**
   * Permite simular perda de energia ou falha de I/O na próxima operação de escrita
   * para testes adversariais de atomicidade.
   */
  static simulateNextWriteFailure(shouldFail = true): void {
    StorageService.shouldFailNextWrite = shouldFail;
  }

  private static isIndexedDbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private static openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!StorageService.isIndexedDbAvailable()) {
        reject(new Error('IndexedDB não disponível neste ambiente.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ||
            new Error('Erro ao abrir o banco IndexedDB do DonutVault.')
        );
    });
  }

  /**
   * Verifica rigorosamente que um objeto é um EncryptedVaultEnvelope válido, íntegro,
   * com parâmetros KDF seguros, nonces de 96 bits exclusivos e zero campos em texto puro.
   */
  static assertValidEncryptedEnvelope(envelope: EncryptedVaultEnvelope): void {
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      envelope.format !== 'DONUTVAULT_ENCRYPTED_V1' ||
      envelope.version !== 1 ||
      envelope.kdf !== 'argon2id' ||
      typeof envelope.saltHex !== 'string' ||
      typeof envelope.wrappedDekHex !== 'string' ||
      typeof envelope.dekNonceHex !== 'string' ||
      typeof envelope.ciphertextHex !== 'string' ||
      typeof envelope.payloadNonceHex !== 'string' ||
      typeof envelope.integritySha256Hex !== 'string'
    ) {
      throw new Error(
        'Envelope inválido: formato ou versão criptográfica incompatível.'
      );
    }

    // Validação dos parâmetros Argon2id (contra DoS ou enfraquecimento malicioso)
    const kdf = envelope.kdfParams;
    if (
      !kdf ||
      typeof kdf !== 'object' ||
      typeof kdf.t !== 'number' ||
      typeof kdf.m !== 'number' ||
      typeof kdf.p !== 'number' ||
      typeof kdf.dkLen !== 'number' ||
      !Number.isInteger(kdf.t) ||
      kdf.t < 1 ||
      kdf.t > 64 ||
      !Number.isInteger(kdf.m) ||
      kdf.m < 1024 ||
      kdf.m > 524288 ||
      !Number.isInteger(kdf.p) ||
      kdf.p < 1 ||
      kdf.p > 16 ||
      kdf.dkLen !== 32
    ) {
      throw new Error(
        'Envelope rejeitado: parâmetros Argon2id inválidos ou fora dos limites de segurança.'
      );
    }

    // Validação de comprimentos e formato hexadecimal de Salt, Nonces e Ciphertexts
    if (
      envelope.saltHex.length < 32 ||
      !HEX_REGEX.test(envelope.saltHex) ||
      envelope.dekNonceHex.length !== 24 ||
      !HEX_REGEX.test(envelope.dekNonceHex) ||
      envelope.payloadNonceHex.length !== 24 ||
      !HEX_REGEX.test(envelope.payloadNonceHex) ||
      envelope.wrappedDekHex.length < 64 ||
      !HEX_REGEX.test(envelope.wrappedDekHex) ||
      envelope.ciphertextHex.length < 32 ||
      !HEX_REGEX.test(envelope.ciphertextHex) ||
      envelope.integritySha256Hex.length !== 64 ||
      !HEX_REGEX.test(envelope.integritySha256Hex)
    ) {
      throw new Error(
        'Envelope rejeitado: campos criptográficos hexadecimais corrompidos ou com tamanho inválido.'
      );
    }

    if (envelope.dekNonceHex === envelope.payloadNonceHex) {
      throw new Error(
        'Violação crítica de segurança: Nonce reutilizado entre DEK e Payload!'
      );
    }

    // Garante que nenhuma propriedade em texto puro acidentalmente exista no envelope
    const rawRecord = envelope as unknown as Record<string, unknown>;
    if (
      'credentials' in rawRecord ||
      'notes' in rawRecord ||
      'masterPassword' in rawRecord ||
      'sessionDek' in rawRecord ||
      'dek' in rawRecord ||
      'kek' in rawRecord
    ) {
      throw new Error(
        'Violação crítica de segurança: tentativa de persistir dados ou chaves em texto puro no armazenamento!'
      );
    }

    const expectedHash = CryptoEngine.computeIntegrityHash(envelope);
    if (expectedHash !== envelope.integritySha256Hex) {
      throw new Error(
        'Alerta de Segurança: A assinatura de integridade SHA-256 do cofre não confere! Dados corrompidos ou adulterados.'
      );
    }
  }

  /**
   * Persiste apenas o envelope criptografado no IndexedDB (ou store de teste)
   * com proteção Anti-Rollback, verificação de não-reutilização de nonce e atomicidade.
   */
  static async saveEnvelope(
    envelope: EncryptedVaultEnvelope,
    options?: SaveEnvelopeOptions
  ): Promise<void> {
    StorageService.assertValidEncryptedEnvelope(envelope);

    // Verifica estado anterior para proteção Anti-Rollback e não-reutilização de Nonce
    const existing = await StorageService.loadEnvelope().catch(() => null);
    if (existing) {
      CryptoEngine.assertNoNonceReuse(existing, envelope);
      if (
        !options?.allowRollbackOrReplace &&
        existing.vaultId &&
        envelope.vaultId &&
        existing.vaultId === envelope.vaultId &&
        (envelope.revision ?? 1) < (existing.revision ?? 1)
      ) {
        throw new Error(
          `Alerta de Segurança (Anti-Rollback): Tentativa de regredir a revisão do cofre de #${existing.revision} para #${envelope.revision} bloqueada.`
        );
      }
    }

    // Simulação de perda de energia / falha de escrita para testes adversariais de atomicidade
    if (StorageService.shouldFailNextWrite) {
      StorageService.shouldFailNextWrite = false;
      throw new Error(
        'Falha crítica de I/O simulada (perda de energia durante a persistência). O estado anterior permanece intacto.'
      );
    }

    const serialized = JSON.stringify(envelope);

    if (!StorageService.isIndexedDbAvailable()) {
      StorageService.memoryFallbackStore.set(PRIMARY_KEY, serialized);
      return;
    }

    const db = await StorageService.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(envelope, PRIMARY_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(
          tx.error ||
            new Error('Falha ao gravar cofre criptografado no IndexedDB.')
        );
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('Transação IndexedDB abortada atomicamente.'));
      };
    });
  }

  /**
   * Carrega o envelope criptografado e valida sua integridade antes de retorná-lo.
   */
  static async loadEnvelope(): Promise<EncryptedVaultEnvelope | null> {
    if (!StorageService.isIndexedDbAvailable()) {
      const serialized = StorageService.memoryFallbackStore.get(PRIMARY_KEY);
      if (!serialized) return null;
      const parsed = JSON.parse(serialized) as EncryptedVaultEnvelope;
      StorageService.assertValidEncryptedEnvelope(parsed);
      return parsed;
    }

    const db = await StorageService.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(PRIMARY_KEY);
      req.onsuccess = () => {
        db.close();
        const result = (req.result as EncryptedVaultEnvelope) || null;
        if (result) {
          try {
            StorageService.assertValidEncryptedEnvelope(result);
          } catch (err) {
            reject(err);
            return;
          }
        }
        resolve(result);
      };
      req.onerror = () => {
        db.close();
        reject(
          req.error ||
            new Error('Falha ao ler cofre criptografado do IndexedDB.')
        );
      };
    });
  }

  /**
   * Remove permanentemente o cofre criptografado do armazenamento.
   */
  static async clearEnvelope(): Promise<void> {
    StorageService.shouldFailNextWrite = false;
    if (!StorageService.isIndexedDbAvailable()) {
      StorageService.memoryFallbackStore.delete(PRIMARY_KEY);
      return;
    }

    const db = await StorageService.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(PRIMARY_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Falha ao excluir cofre do IndexedDB.'));
      };
    });
  }

  /**
   * Inspeciona a representação bruta armazenada (útil para auditoria de segurança e testes automatizados
   * comprovarem ausência de texto puro no banco).
   */
  static async inspectRawStoredString(): Promise<string | null> {
    const env = await StorageService.loadEnvelope();
    return env ? JSON.stringify(env) : null;
  }

  /**
   * Analisa e valida rigorosamente um arquivo JSON de backup criptografado antes de qualquer operação.
   * Bloqueia JSON corrompido, Prototype Pollution (`__proto__`, `constructor`), campos maliciosos e adulteração SHA-256.
   */
  static parseAndValidateBackup(rawJson: string): EncryptedVaultEnvelope {
    if (typeof rawJson !== 'string' || rawJson.length === 0) {
      throw new Error('O arquivo de backup está vazio ou é inválido.');
    }
    if (rawJson.length > 10 * 1024 * 1024) {
      throw new Error('Arquivo de backup excede o limite máximo permitido (10 MB).');
    }

    // Bloqueia tentativas de Prototype Pollution no JSON bruto
    if (
      rawJson.includes('"__proto__"') ||
      rawJson.includes('"constructor"') ||
      rawJson.includes('"prototype"')
    ) {
      throw new Error(
        'Estrutura de backup maliciosa detectada e bloqueada (Prototype Pollution).'
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('O arquivo selecionado não é um JSON válido ou está corrompido.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Estrutura de backup inválida.');
    }

    const env = parsed as EncryptedVaultEnvelope;
    StorageService.assertValidEncryptedEnvelope(env);
    return env;
  }

  // ============================================================================
  // FILA OFFLINE PERSISTENTE E METADADOS DE SINCRONIZAÇÃO (ZERO-SECRET)
  // ============================================================================

  private static readonly SYNC_STATE_KEY = 'donutvault_persistent_sync_state_v2';

  static async savePersistentSyncState(stateJson: string): Promise<void> {
    if (
      stateJson.includes('"masterPassword"') ||
      stateJson.includes('"sessionDek"')
    ) {
      throw new Error(
        'Violação Zero-Knowledge: proibido persistir chaves ou senhas na fila de sincronização.'
      );
    }

    if (!StorageService.isIndexedDbAvailable()) {
      StorageService.memoryFallbackStore.set(
        StorageService.SYNC_STATE_KEY,
        stateJson
      );
      return;
    }

    const db = await StorageService.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(stateJson, StorageService.SYNC_STATE_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(
          tx.error ||
            new Error('Falha ao persistir fila offline no IndexedDB.')
        );
      };
    });
  }

  static async loadPersistentSyncState(): Promise<string | null> {
    if (!StorageService.isIndexedDbAvailable()) {
      return (
        StorageService.memoryFallbackStore.get(StorageService.SYNC_STATE_KEY) ||
        null
      );
    }

    const db = await StorageService.openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(StorageService.SYNC_STATE_KEY);
      req.onsuccess = () => {
        db.close();
        resolve(typeof req.result === 'string' ? req.result : null);
      };
      req.onerror = () => {
        db.close();
        reject(
          req.error || new Error('Falha ao ler fila offline do IndexedDB.')
        );
      };
    });
  }
}

