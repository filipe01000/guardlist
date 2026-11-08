import { argon2id } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type {
  AadContext,
  Argon2Params,
  Argon2ProfileId,
  CredentialItem,
  EncryptedVaultContainerV2,
  EncryptedVaultEnvelope,
  EncryptedVaultRecordV2,
  RecordAadContextV2,
  SecretNote,
  VaultPayload,
} from '../types/vault';

export const ARGON2_PROFILES: Record<Argon2ProfileId, Argon2Params> = {
  'legacy-v1': {
    t: 2,
    m: 16384, // 16 MiB
    p: 1,
    dkLen: 32,
    profileId: 'legacy-v1',
  },
  'owasp-mobile-v2': {
    t: 2,
    m: 19456, // 19 MiB (OWASP ASVS minimum recommendation for Argon2id with t=2)
    p: 1,
    dkLen: 32,
    profileId: 'owasp-mobile-v2',
  },
  'owasp-desktop-v2': {
    t: 2,
    m: 19456, // 19 MiB balanced for fast desktop/mobile unlock (~300ms in JS)
    p: 1,
    dkLen: 32,
    profileId: 'owasp-desktop-v2',
  },
  'owasp-high-v2': {
    t: 1,
    m: 47104, // 46 MiB high-memory OWASP profile
    p: 1,
    dkLen: 32,
    profileId: 'owasp-high-v2',
  },
  'test-fast': {
    t: 1,
    m: 4096, // 4 MiB for unit/adversarial test suites
    p: 1,
    dkLen: 32,
    profileId: 'test-fast',
  },
};

export const DEFAULT_ARGON2_PARAMS: Argon2Params = ARGON2_PROFILES['legacy-v1'];

/**
 * CryptoEngine (Fase 4A):
 * Motor criptográfico Zero-Knowledge responsável por:
 * - Geração de entropia via Web Crypto API (CSPRNG)
 * - Derivação de KEK via Argon2id (com suporte opcional a Secret Key de alta entropia estilo 1Password)
 * - Geração e proteção de DEK de 256 bits (Envelope Encryption)
 * - Derivação de subchaves por registro e por época (`keyEpoch`) via HKDF-SHA256
 * - Criptografia autenticada AES-256-GCM com nonces exclusivos de 96 bits e AAD estruturado
 * - Separação entre Alteração da Senha Mestra (re-wrap da DEK) e Rotação Completa da DEK (novo keyEpoch)
 * - Migração transacional e reversível do formato V1 (payload único) para V2 (registros individuais E2EE)
 */
export class CryptoEngine {
  /**
   * Sobrescreve buffers Uint8Array com zeros na memória quando possível.
   */
  static zeroize(buf: Uint8Array | null | undefined): void {
    if (buf && buf.length > 0) {
      buf.fill(0);
    }
  }

  /**
   * Gera um identificador único seguro usando crypto.randomUUID() ou CSPRNG.
   */
  static randomId(prefix = 'id'): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    const bytes = CryptoEngine.getRandomBytes(16);
    return `${prefix}-${bytesToHex(bytes)}`;
  }

  /**
   * Gera bytes criptograficamente aleatórios usando Web Crypto API.
   */
  static getRandomBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Gera uma Secret Key de alta entropia (128 bits = 16 bytes) no formato legível
   * `DVLT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` para proteção adicional entre dispositivos.
   */
  static generateHighEntropySecretKey(): string {
    const raw = CryptoEngine.getRandomBytes(16);
    const hex = bytesToHex(raw).toUpperCase();
    CryptoEngine.zeroize(raw);
    const groups = hex.match(/.{1,4}/g) || [hex];
    return `DVLT-${groups.join('-')}`;
  }

  /**
   * Constrói bytes de AAD (Additional Authenticated Data) V1 vinculando identidade do cofre,
   * versão do protocolo e tipo de registro (`dek-wrap` vs `vault-payload`).
   */
  static buildAadBytes(ctx: AadContext): Uint8Array {
    const canonical = `${ctx.format}|v=${ctx.version}|vaultId=${ctx.vaultId}|type=${ctx.recordType}`;
    return utf8ToBytes(canonical);
  }

  /**
   * Constrói bytes de AAD V2 (Registros Criptografados Individualmente) autenticando:
   * formato, versão, vaultId, recordId, recordType, revision, keyEpoch e tombstone (deleted).
   */
  static buildRecordAadBytesV2(ctx: RecordAadContextV2): Uint8Array {
    const canonical = [
      ctx.format,
      `v=${ctx.version}`,
      `vaultId=${ctx.vaultId}`,
      `recordId=${ctx.recordId}`,
      `type=${ctx.recordType}`,
      `rev=${ctx.revision}`,
      `epoch=${ctx.keyEpoch}`,
      `deleted=${ctx.deleted ? 1 : 0}`,
    ].join('|');
    return utf8ToBytes(canonical);
  }

  /**
   * Combina Senha Mestra + Secret Key opcional usando HKDF-SHA256 antes do Argon2id
   * (Modelo Dual-Secret inspirado no 1Password). Se `secretKey` não for informada,
   * utiliza os bytes UTF-8 da Senha Mestra mantendo compatibilidade total com V1.
   */
  private static preparePasswordInputBytes(
    masterPassword: string,
    secretKey?: string
  ): Uint8Array {
    const pwdBytes = utf8ToBytes(masterPassword);
    if (!secretKey || !secretKey.trim()) {
      return pwdBytes;
    }
    const normalizedSecret = utf8ToBytes(
      secretKey.trim().toUpperCase().replace(/\s+/g, '')
    );
    try {
      return hkdf(
        sha256,
        pwdBytes,
        normalizedSecret,
        utf8ToBytes('donutvault-dual-secret-kek-input-v2'),
        64
      );
    } finally {
      CryptoEngine.zeroize(pwdBytes);
      CryptoEngine.zeroize(normalizedSecret);
    }
  }

  /**
   * Deriva a KEK (Key Encryption Key, 256 bits) a partir da Senha Mestra (+ Secret Key opcional)
   * e salt de 128 bits usando Argon2id.
   */
  static deriveKek(
    masterPassword: string,
    salt: Uint8Array,
    params: Argon2Params = DEFAULT_ARGON2_PARAMS,
    secretKey?: string
  ): Uint8Array {
    if (salt.length < 16) {
      throw new Error(
        'Salt criptográfico deve possuir pelo menos 16 bytes (128 bits).'
      );
    }
    const inputBytes = CryptoEngine.preparePasswordInputBytes(
      masterPassword,
      secretKey
    );
    try {
      return argon2id(inputBytes, salt, {
        t: params.t,
        m: params.m,
        p: params.p,
        dkLen: params.dkLen,
      });
    } finally {
      CryptoEngine.zeroize(inputBytes);
    }
  }

  /**
   * Deriva uma subchave AES-256-GCM exclusiva de 256 bits para um registro específico
   * e uma época de chave (`keyEpoch`) usando HKDF-SHA256 a partir da DEK mestre.
   */
  static deriveRecordSubkeyV2(
    masterDek: Uint8Array,
    vaultId: string,
    recordId: string,
    recordType: string,
    keyEpoch: number
  ): Uint8Array {
    if (masterDek.length !== 32) {
      throw new Error('DEK mestre deve possuir 32 bytes (256 bits).');
    }
    const info = utf8ToBytes(
      `donutvault-v2-record-subkey|${vaultId}|${recordType}|epoch=${keyEpoch}|id=${recordId}`
    );
    const salt = utf8ToBytes(`donutvault-v2-hkdf-salt|${vaultId}`);
    return hkdf(sha256, masterDek, salt, info, 32);
  }

  /**
   * Importa chave bruta de 256 bits para objeto CryptoKey não-exportável da Web Crypto API.
   */
  private static async importAesGcmKey(
    rawKeyBytes: Uint8Array
  ): Promise<CryptoKey> {
    if (rawKeyBytes.length !== 32) {
      throw new Error(
        'Chave AES-256-GCM deve possuir exatamente 32 bytes (256 bits).'
      );
    }
    return crypto.subtle.importKey(
      'raw',
      rawKeyBytes as unknown as BufferSource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Criptografa dados usando AES-256-GCM com nonce exclusivo de 96 bits (12 bytes) e AAD obrigatório.
   */
  static async encryptAes256Gcm(
    rawKeyBytes: Uint8Array,
    plaintextBytes: Uint8Array,
    aadBytes: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
    const nonce = CryptoEngine.getRandomBytes(12); // 96-bit unique nonce
    const key = await CryptoEngine.importAesGcmKey(rawKeyBytes);
    const algorithm: AesGcmParams = {
      name: 'AES-GCM',
      iv: nonce as unknown as BufferSource,
      additionalData: aadBytes as unknown as BufferSource,
      tagLength: 128,
    };
    const encryptedBuffer = await crypto.subtle.encrypt(
      algorithm,
      key,
      plaintextBytes as unknown as BufferSource
    );
    return {
      ciphertext: new Uint8Array(encryptedBuffer),
      nonce,
    };
  }

  /**
   * Descriptografa e autentica dados usando AES-256-GCM (tag de 128 bits + verificação de AAD).
   */
  static async decryptAes256Gcm(
    rawKeyBytes: Uint8Array,
    ciphertextBytes: Uint8Array,
    nonceBytes: Uint8Array,
    aadBytes: Uint8Array
  ): Promise<Uint8Array> {
    if (nonceBytes.length !== 12) {
      throw new Error(
        'Nonce inválido: AES-256-GCM requer IV de 12 bytes (96 bits).'
      );
    }
    const key = await CryptoEngine.importAesGcmKey(rawKeyBytes);
    const algorithm: AesGcmParams = {
      name: 'AES-GCM',
      iv: nonceBytes as unknown as BufferSource,
      additionalData: aadBytes as unknown as BufferSource,
      tagLength: 128,
    };
    const decryptedBuffer = await crypto.subtle.decrypt(
      algorithm,
      key,
      ciphertextBytes as unknown as BufferSource
    );
    return new Uint8Array(decryptedBuffer);
  }

  /**
   * Calcula hash SHA-256 canônico sobre todos os campos estruturais do envelope V1.
   */
  static computeIntegrityHash(
    envelope: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'>
  ): string {
    const canonical = [
      envelope.format,
      String(envelope.version),
      envelope.vaultId || 'legacy-vault',
      String(envelope.revision ?? 1),
      envelope.kdf,
      `${envelope.kdfParams.t}:${envelope.kdfParams.m}:${envelope.kdfParams.p}:${envelope.kdfParams.dkLen}`,
      envelope.saltHex,
      envelope.dekNonceHex,
      envelope.wrappedDekHex,
      envelope.payloadNonceHex,
      envelope.ciphertextHex,
    ].join('|');
    return bytesToHex(sha256(utf8ToBytes(canonical)));
  }

  /**
   * Calcula hash SHA-256 canônico sobre o contêiner V2 e todos os seus registros individuais.
   */
  static computeContainerIntegrityHashV2(
    container: Omit<EncryptedVaultContainerV2, 'integritySha256Hex'>
  ): string {
    const recordsDigest = container.records
      .map(
        (r) =>
          `${r.recordId}:${r.recordType}:${r.revision}:${r.keyEpoch}:${r.deleted ? 1 : 0}:${r.nonceHex}:${r.ciphertextHex}:${r.aadHashSha256Hex}`
      )
      .sort()
      .join(';');

    const s = container.settingsRecord;
    const settingsDigest = `${s.recordId}:${s.revision}:${s.keyEpoch}:${s.nonceHex}:${s.ciphertextHex}:${s.aadHashSha256Hex}`;

    const canonical = [
      container.format,
      String(container.version),
      container.vaultId,
      String(container.revision),
      String(container.keyEpoch),
      container.requiresSecretKey ? 'sk=1' : 'sk=0',
      container.kdf,
      `${container.kdfParams.t}:${container.kdfParams.m}:${container.kdfParams.p}:${container.kdfParams.dkLen}`,
      container.saltHex,
      container.dekNonceHex,
      container.wrappedDekHex,
      settingsDigest,
      recordsDigest,
    ].join('|');

    return bytesToHex(sha256(utf8ToBytes(canonical)));
  }

  // ============================================================================
  // OPERAÇÕES V1 (PAYLOAD ÚNICO — MANTIDAS COM 100% DE COMPATIBILIDADE)
  // ============================================================================

  static async sealNewVault(
    masterPassword: string,
    payload: VaultPayload,
    params: Argon2Params = DEFAULT_ARGON2_PARAMS
  ): Promise<{ envelope: EncryptedVaultEnvelope; sessionDek: Uint8Array }> {
    if (!masterPassword || masterPassword.length < 4) {
      throw new Error('A senha mestra deve ter pelo menos 4 caracteres.');
    }

    const vaultId = payload.vaultId || CryptoEngine.randomId('vault');
    const normalizedPayload: VaultPayload = {
      ...payload,
      version: 1,
      vaultId,
      revision: payload.revision || 1,
      keyEpoch: payload.keyEpoch || 1,
    };

    const salt = CryptoEngine.getRandomBytes(16); // 128-bit random salt
    const dek = CryptoEngine.getRandomBytes(32); // 256-bit random DEK
    const kek = CryptoEngine.deriveKek(masterPassword, salt, params);

    try {
      const dekAad = CryptoEngine.buildAadBytes({
        format: 'DONUTVAULT_ENCRYPTED_V1',
        version: 1,
        vaultId,
        recordType: 'dek-wrap',
      });

      const payloadAad = CryptoEngine.buildAadBytes({
        format: 'DONUTVAULT_ENCRYPTED_V1',
        version: 1,
        vaultId,
        recordType: 'vault-payload',
      });

      const { ciphertext: wrappedDek, nonce: dekNonce } =
        await CryptoEngine.encryptAes256Gcm(kek, dek, dekAad);

      const payloadBytes = utf8ToBytes(JSON.stringify(normalizedPayload));
      let payloadCiphertext: Uint8Array;
      let payloadNonce: Uint8Array;
      try {
        const enc = await CryptoEngine.encryptAes256Gcm(
          dek,
          payloadBytes,
          payloadAad
        );
        payloadCiphertext = enc.ciphertext;
        payloadNonce = enc.nonce;
      } finally {
        CryptoEngine.zeroize(payloadBytes);
      }

      const now = new Date().toISOString();
      const partial: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'> = {
        format: 'DONUTVAULT_ENCRYPTED_V1',
        version: 1,
        vaultId,
        revision: normalizedPayload.revision,
        keyEpoch: normalizedPayload.keyEpoch,
        createdAt: normalizedPayload.createdAt || now,
        updatedAt: now,
        kdf: 'argon2id',
        kdfParams: params,
        saltHex: bytesToHex(salt),
        wrappedDekHex: bytesToHex(wrappedDek),
        dekNonceHex: bytesToHex(dekNonce),
        ciphertextHex: bytesToHex(payloadCiphertext),
        payloadNonceHex: bytesToHex(payloadNonce),
      };

      return {
        envelope: {
          ...partial,
          integritySha256Hex: CryptoEngine.computeIntegrityHash(partial),
        },
        sessionDek: dek,
      };
    } finally {
      CryptoEngine.zeroize(kek);
    }
  }

  static async resealVaultPayload(
    existingEnvelope: EncryptedVaultEnvelope,
    sessionDek: Uint8Array,
    updatedPayload: VaultPayload
  ): Promise<EncryptedVaultEnvelope> {
    const vaultId =
      existingEnvelope.vaultId || updatedPayload.vaultId || 'legacy-vault';
    const nextRevision = (existingEnvelope.revision || 1) + 1;
    const normalizedPayload: VaultPayload = {
      ...updatedPayload,
      vaultId,
      revision: nextRevision,
    };

    const payloadAad = CryptoEngine.buildAadBytes({
      format: 'DONUTVAULT_ENCRYPTED_V1',
      version: 1,
      vaultId,
      recordType: 'vault-payload',
    });

    const payloadBytes = utf8ToBytes(JSON.stringify(normalizedPayload));
    try {
      const { ciphertext, nonce } = await CryptoEngine.encryptAes256Gcm(
        sessionDek,
        payloadBytes,
        payloadAad
      );

      const newNonceHex = bytesToHex(nonce);
      if (
        newNonceHex === existingEnvelope.payloadNonceHex ||
        newNonceHex === existingEnvelope.dekNonceHex
      ) {
        throw new Error('Violação de segurança: Nonce repetido detectado.');
      }

      const now = new Date().toISOString();
      const partial: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'> = {
        ...existingEnvelope,
        vaultId,
        revision: nextRevision,
        updatedAt: now,
        ciphertextHex: bytesToHex(ciphertext),
        payloadNonceHex: newNonceHex,
      };

      return {
        ...partial,
        integritySha256Hex: CryptoEngine.computeIntegrityHash(partial),
      };
    } finally {
      CryptoEngine.zeroize(payloadBytes);
    }
  }

  static assertNoNonceReuse(
    previousEnvelope: EncryptedVaultEnvelope | null,
    nextEnvelope: EncryptedVaultEnvelope
  ): void {
    if (nextEnvelope.dekNonceHex === nextEnvelope.payloadNonceHex) {
      throw new Error(
        'Violação crítica de segurança: Nonce reutilizado entre dekNonceHex e payloadNonceHex!'
      );
    }
    if (
      previousEnvelope &&
      previousEnvelope.wrappedDekHex === nextEnvelope.wrappedDekHex &&
      previousEnvelope.payloadNonceHex === nextEnvelope.payloadNonceHex &&
      previousEnvelope.ciphertextHex !== nextEnvelope.ciphertextHex
    ) {
      throw new Error(
        'Violação crítica de segurança: Reutilização de nonce AES-256-GCM detectada para a mesma DEK!'
      );
    }
  }

  static async unsealVault(
    envelope: EncryptedVaultEnvelope,
    masterPassword: string
  ): Promise<{ payload: VaultPayload; sessionDek: Uint8Array }> {
    if (
      !envelope ||
      envelope.format !== 'DONUTVAULT_ENCRYPTED_V1' ||
      envelope.version !== 1
    ) {
      throw new Error(
        'Formato de cofre inválido ou versão criptográfica incompatível.'
      );
    }

    if (envelope.dekNonceHex === envelope.payloadNonceHex) {
      throw new Error(
        'Violação crítica de segurança: Nonce reutilizado detectado no envelope.'
      );
    }

    const expectedHash = CryptoEngine.computeIntegrityHash(envelope);
    if (expectedHash !== envelope.integritySha256Hex) {
      throw new Error(
        'Falha na verificação de integridade! O arquivo do cofre foi corrompido ou adulterado.'
      );
    }

    const vaultId = envelope.vaultId || 'legacy-vault';
    const salt = hexToBytes(envelope.saltHex);
    const kek = CryptoEngine.deriveKek(
      masterPassword,
      salt,
      envelope.kdfParams
    );

    const dekAad = CryptoEngine.buildAadBytes({
      format: 'DONUTVAULT_ENCRYPTED_V1',
      version: 1,
      vaultId,
      recordType: 'dek-wrap',
    });

    const payloadAad = CryptoEngine.buildAadBytes({
      format: 'DONUTVAULT_ENCRYPTED_V1',
      version: 1,
      vaultId,
      recordType: 'vault-payload',
    });

    try {
      let dek: Uint8Array;
      try {
        dek = await CryptoEngine.decryptAes256Gcm(
          kek,
          hexToBytes(envelope.wrappedDekHex),
          hexToBytes(envelope.dekNonceHex),
          dekAad
        );
      } catch {
        throw new Error(
          'D’oh! Senha mestra incorreta. Nem o Sr. Burns conseguiu adivinhar!'
        );
      }

      let payload: VaultPayload;
      try {
        const decryptedBytes = await CryptoEngine.decryptAes256Gcm(
          dek,
          hexToBytes(envelope.ciphertextHex),
          hexToBytes(envelope.payloadNonceHex),
          payloadAad
        );
        const jsonString = new TextDecoder().decode(decryptedBytes);
        CryptoEngine.zeroize(decryptedBytes);
        payload = JSON.parse(jsonString) as VaultPayload;
      } catch {
        CryptoEngine.zeroize(dek);
        throw new Error(
          'Falha de autenticação GCM ao descriptografar o conteúdo do cofre (ciphertext ou AAD inválido).'
        );
      }

      if (
        !payload ||
        typeof payload !== 'object' ||
        !Array.isArray(payload.credentials) ||
        !Array.isArray(payload.notes)
      ) {
        CryptoEngine.zeroize(dek);
        throw new Error(
          'Estrutura interna do payload descriptografado é inválida ou maliciosa.'
        );
      }

      if (
        payload.vaultId &&
        envelope.vaultId &&
        payload.vaultId !== envelope.vaultId
      ) {
        CryptoEngine.zeroize(dek);
        throw new Error(
          'Violação de integridade: vaultId interno incompatível com o vaultId autenticado no AAD.'
        );
      }

      return {
        payload: {
          ...payload,
          vaultId: payload.vaultId || vaultId,
          revision: payload.revision || envelope.revision || 1,
        },
        sessionDek: dek,
      };
    } finally {
      CryptoEngine.zeroize(kek);
    }
  }

  /**
   * Separação de responsabilidades (§1):
   * 1) `rewrapMasterPasswordOnly`: Altera apenas a Senha Mestra e/ou parâmetros Argon2id,
   *    re-encapsulando a MESMA DEK (sem alterar o ciphertext do payload nem o keyEpoch).
   */
  static async rewrapMasterPasswordOnly(
    existingEnvelope: EncryptedVaultEnvelope,
    currentMasterPassword: string,
    newMasterPassword: string,
    newKdfParams?: Argon2Params
  ): Promise<EncryptedVaultEnvelope> {
    const { sessionDek } = await CryptoEngine.unsealVault(
      existingEnvelope,
      currentMasterPassword
    );
    const targetParams = newKdfParams || existingEnvelope.kdfParams;
    const newSalt = CryptoEngine.getRandomBytes(16);
    const newKek = CryptoEngine.deriveKek(
      newMasterPassword,
      newSalt,
      targetParams
    );

    try {
      const dekAad = CryptoEngine.buildAadBytes({
        format: 'DONUTVAULT_ENCRYPTED_V1',
        version: 1,
        vaultId: existingEnvelope.vaultId,
        recordType: 'dek-wrap',
      });
      const { ciphertext: wrappedDek, nonce: dekNonce } =
        await CryptoEngine.encryptAes256Gcm(newKek, sessionDek, dekAad);

      const partial: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'> = {
        ...existingEnvelope,
        updatedAt: new Date().toISOString(),
        kdfParams: targetParams,
        saltHex: bytesToHex(newSalt),
        wrappedDekHex: bytesToHex(wrappedDek),
        dekNonceHex: bytesToHex(dekNonce),
      };

      return {
        ...partial,
        integritySha256Hex: CryptoEngine.computeIntegrityHash(partial),
      };
    } finally {
      CryptoEngine.zeroize(sessionDek);
      CryptoEngine.zeroize(newKek);
    }
  }

  /**
   * 2) `rotateMasterPassword`: Rotação completa (gera novo salt Argon2id, NOVA DEK de 256 bits,
   *    incrementa `keyEpoch` e `revision` e re-criptografa o cofre inteiro).
   */
  static async rotateMasterPassword(
    existingEnvelope: EncryptedVaultEnvelope,
    currentMasterPassword: string,
    newMasterPassword: string,
    currentPayload: VaultPayload,
    newKdfParams?: Argon2Params
  ): Promise<{ envelope: EncryptedVaultEnvelope; sessionDek: Uint8Array }> {
    const { sessionDek: oldDek } = await CryptoEngine.unsealVault(
      existingEnvelope,
      currentMasterPassword
    );
    CryptoEngine.zeroize(oldDek);

    return CryptoEngine.sealNewVault(
      newMasterPassword,
      {
        ...currentPayload,
        revision: (existingEnvelope.revision || 1) + 1,
        keyEpoch: (existingEnvelope.keyEpoch || 1) + 1,
      },
      newKdfParams || existingEnvelope.kdfParams
    );
  }

  // ============================================================================
  // OPERAÇÕES V2 (REGISTROS CRIPTOGRAFADOS INDIVIDUALMENTE + HKDF + AAD V2)
  // ============================================================================

  /**
   * Criptografa um registro individual V2 (`credential`, `note` ou `vault-settings`)
   * usando uma subchave derivada via HKDF-SHA256 para `(vaultId, recordType, keyEpoch, recordId)`
   * e vincula `revision`, `keyEpoch`, `recordId` e `deleted` (tombstone) no AAD do AES-256-GCM.
   */
  static async sealRecordV2(
    masterDek: Uint8Array,
    vaultId: string,
    recordId: string,
    recordType: 'credential' | 'note' | 'vault-settings',
    revision: number,
    keyEpoch: number,
    deleted: boolean,
    plaintextObject: unknown
  ): Promise<EncryptedVaultRecordV2> {
    const aadCtx: RecordAadContextV2 = {
      format: 'DONUTVAULT_ENCRYPTED_V2',
      version: 2,
      vaultId,
      recordId,
      recordType,
      revision,
      keyEpoch,
      deleted,
    };
    const aadBytes = CryptoEngine.buildRecordAadBytesV2(aadCtx);
    const aadHashSha256Hex = bytesToHex(sha256(aadBytes));
    const subkey = CryptoEngine.deriveRecordSubkeyV2(
      masterDek,
      vaultId,
      recordId,
      recordType,
      keyEpoch
    );
    const plaintextBytes = utf8ToBytes(JSON.stringify(plaintextObject));

    try {
      const { ciphertext, nonce } = await CryptoEngine.encryptAes256Gcm(
        subkey,
        plaintextBytes,
        aadBytes
      );
      return {
        recordId,
        vaultId,
        recordType,
        formatVersion: 2,
        revision,
        keyEpoch,
        deleted,
        updatedAt: new Date().toISOString(),
        nonceHex: bytesToHex(nonce),
        ciphertextHex: bytesToHex(ciphertext),
        aadHashSha256Hex,
      };
    } finally {
      CryptoEngine.zeroize(subkey);
      CryptoEngine.zeroize(plaintextBytes);
    }
  }

  /**
   * Descriptografa e autentica um registro individual V2 verificando rigorosamente o AAD
   * (`vaultId`, `recordId`, `recordType`, `revision`, `keyEpoch`, `deleted`).
   */
  static async unsealRecordV2<T = unknown>(
    masterDek: Uint8Array,
    record: EncryptedVaultRecordV2,
    expectedVaultId: string
  ): Promise<T> {
    if (record.vaultId !== expectedVaultId) {
      throw new Error(
        `Violação de isolamento no registro ${record.recordId}: vaultId incompatível.`
      );
    }

    const aadCtx: RecordAadContextV2 = {
      format: 'DONUTVAULT_ENCRYPTED_V2',
      version: 2,
      vaultId: record.vaultId,
      recordId: record.recordId,
      recordType: record.recordType,
      revision: record.revision,
      keyEpoch: record.keyEpoch,
      deleted: record.deleted,
    };
    const aadBytes = CryptoEngine.buildRecordAadBytesV2(aadCtx);
    const expectedAadHash = bytesToHex(sha256(aadBytes));

    if (expectedAadHash !== record.aadHashSha256Hex) {
      throw new Error(
        `Adulteração de metadados/AAD detectada no registro ${record.recordId}.`
      );
    }

    const subkey = CryptoEngine.deriveRecordSubkeyV2(
      masterDek,
      record.vaultId,
      record.recordId,
      record.recordType,
      record.keyEpoch
    );

    try {
      const decryptedBytes = await CryptoEngine.decryptAes256Gcm(
        subkey,
        hexToBytes(record.ciphertextHex),
        hexToBytes(record.nonceHex),
        aadBytes
      );
      const decoded = new TextDecoder().decode(decryptedBytes);
      CryptoEngine.zeroize(decryptedBytes);
      return JSON.parse(decoded) as T;
    } catch {
      throw new Error(
        `Falha de autenticação AES-256-GCM ao descriptografar o registro ${record.recordId} (ciphertext ou revisão adulterada).`
      );
    } finally {
      CryptoEngine.zeroize(subkey);
    }
  }

  /**
   * Cria um Contêiner Criptografado V2 completo a partir de um `VaultPayload`,
   * criptografando cada credencial e cada nota em seu próprio `EncryptedVaultRecordV2`.
   */
  static async sealContainerV2(
    masterPassword: string,
    payload: VaultPayload,
    params: Argon2Params = ARGON2_PROFILES['owasp-desktop-v2'],
    secretKey?: string,
    existingDek?: Uint8Array,
    migratedFromV1Snapshot?: EncryptedVaultEnvelope | null
  ): Promise<{ container: EncryptedVaultContainerV2; sessionDek: Uint8Array }> {
    const vaultId = payload.vaultId || CryptoEngine.randomId('vault');
    const keyEpoch = payload.keyEpoch || 1;
    const revision = payload.revision || 1;

    const salt = CryptoEngine.getRandomBytes(16);
    const dek = existingDek
      ? new Uint8Array(existingDek)
      : CryptoEngine.getRandomBytes(32);
    const kek = CryptoEngine.deriveKek(
      masterPassword,
      salt,
      params,
      secretKey
    );

    try {
      const dekAad = CryptoEngine.buildRecordAadBytesV2({
        format: 'DONUTVAULT_ENCRYPTED_V2',
        version: 2,
        vaultId,
        recordId: 'master-dek',
        recordType: 'dek-wrap',
        revision,
        keyEpoch,
        deleted: false,
      });

      const { ciphertext: wrappedDek, nonce: dekNonce } =
        await CryptoEngine.encryptAes256Gcm(kek, dek, dekAad);

      // 1. Criptografa cabeçalho privado (vaultName, settings, tombstones)
      const settingsRecord = await CryptoEngine.sealRecordV2(
        dek,
        vaultId,
        'vault-header-settings',
        'vault-settings',
        revision,
        keyEpoch,
        false,
        {
          vaultId,
          vaultName: payload.vaultName,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
          settings: payload.settings,
          tombstones: payload.tombstones || [],
        }
      );

      // 2. Criptografa cada credencial individualmente
      const encryptedCredentials = await Promise.all(
        payload.credentials.map((cred) =>
          CryptoEngine.sealRecordV2(
            dek,
            vaultId,
            cred.id,
            'credential',
            cred.revision || 1,
            keyEpoch,
            Boolean(cred.deletedAt),
            cred
          )
        )
      );

      // 3. Criptografa cada nota secreta individualmente
      const encryptedNotes = await Promise.all(
        payload.notes.map((note) =>
          CryptoEngine.sealRecordV2(
            dek,
            vaultId,
            note.id,
            'note',
            note.revision || 1,
            keyEpoch,
            Boolean(note.deletedAt),
            note
          )
        )
      );

      const records = [...encryptedCredentials, ...encryptedNotes];
      const usedNonces = new Set<string>([
        bytesToHex(dekNonce),
        settingsRecord.nonceHex,
      ]);
      for (const r of records) {
        if (usedNonces.has(r.nonceHex)) {
          throw new Error(
            'Colisão de nonce detectada durante selagem de registros V2.'
          );
        }
        usedNonces.add(r.nonceHex);
      }

      const now = new Date().toISOString();
      const partial: Omit<EncryptedVaultContainerV2, 'integritySha256Hex'> = {
        format: 'DONUTVAULT_ENCRYPTED_V2',
        version: 2,
        vaultId,
        revision,
        keyEpoch,
        requiresSecretKey: Boolean(secretKey && secretKey.trim()),
        createdAt: payload.createdAt || now,
        updatedAt: now,
        kdf: 'argon2id',
        kdfParams: params,
        saltHex: bytesToHex(salt),
        wrappedDekHex: bytesToHex(wrappedDek),
        dekNonceHex: bytesToHex(dekNonce),
        settingsRecord,
        records,
        migratedFromV1Snapshot: migratedFromV1Snapshot || null,
      };

      return {
        container: {
          ...partial,
          integritySha256Hex:
            CryptoEngine.computeContainerIntegrityHashV2(partial),
        },
        sessionDek: dek,
      };
    } finally {
      CryptoEngine.zeroize(kek);
    }
  }

  /**
   * Desbloqueia e autentica um Contêiner V2 completo e reconstrói o `VaultPayload` em memória.
   */
  static async unsealContainerV2(
    container: EncryptedVaultContainerV2,
    masterPassword: string,
    secretKey?: string
  ): Promise<{ payload: VaultPayload; sessionDek: Uint8Array }> {
    if (
      !container ||
      container.format !== 'DONUTVAULT_ENCRYPTED_V2' ||
      container.version !== 2
    ) {
      throw new Error('Contêiner V2 inválido ou versão incompatível.');
    }

    const expectedHash =
      CryptoEngine.computeContainerIntegrityHashV2(container);
    if (expectedHash !== container.integritySha256Hex) {
      throw new Error(
        'Falha na verificação de integridade SHA-256 do contêiner V2! Dados adulterados.'
      );
    }

    const salt = hexToBytes(container.saltHex);
    const kek = CryptoEngine.deriveKek(
      masterPassword,
      salt,
      container.kdfParams,
      secretKey
    );

    const dekAad = CryptoEngine.buildRecordAadBytesV2({
      format: 'DONUTVAULT_ENCRYPTED_V2',
      version: 2,
      vaultId: container.vaultId,
      recordId: 'master-dek',
      recordType: 'dek-wrap',
      revision: container.revision,
      keyEpoch: container.keyEpoch,
      deleted: false,
    });

    try {
      let dek: Uint8Array;
      try {
        dek = await CryptoEngine.decryptAes256Gcm(
          kek,
          hexToBytes(container.wrappedDekHex),
          hexToBytes(container.dekNonceHex),
          dekAad
        );
      } catch {
        throw new Error(
          'Falha de autenticação ao desbloquear contêiner V2: Senha Mestra ou Secret Key incorreta.'
        );
      }

      try {
        const headerData = await CryptoEngine.unsealRecordV2<{
          vaultId: string;
          vaultName: string;
          createdAt: string;
          updatedAt: string;
          settings: VaultPayload['settings'];
          tombstones?: VaultPayload['tombstones'];
        }>(dek, container.settingsRecord, container.vaultId);

        if (headerData.vaultId !== container.vaultId) {
          throw new Error('vaultId do cabeçalho V2 diverge do contêiner.');
        }

        const credentials: CredentialItem[] = [];
        const notes: SecretNote[] = [];

        for (const record of container.records) {
          if (record.recordType === 'credential') {
            const cred = await CryptoEngine.unsealRecordV2<CredentialItem>(
              dek,
              record,
              container.vaultId
            );
            if (cred.id !== record.recordId) {
              throw new Error(
                `Violação de integridade: ID interno da credencial (${cred.id}) diverge do recordId (${record.recordId}).`
              );
            }
            credentials.push({ ...cred, revision: record.revision });
          } else if (record.recordType === 'note') {
            const note = await CryptoEngine.unsealRecordV2<SecretNote>(
              dek,
              record,
              container.vaultId
            );
            if (note.id !== record.recordId) {
              throw new Error(
                `Violação de integridade: ID interno da nota (${note.id}) diverge do recordId (${record.recordId}).`
              );
            }
            notes.push({ ...note, revision: record.revision });
          }
        }

        return {
          payload: {
            version: 2,
            vaultId: container.vaultId,
            revision: container.revision,
            keyEpoch: container.keyEpoch,
            vaultName: headerData.vaultName,
            createdAt: headerData.createdAt,
            updatedAt: headerData.updatedAt,
            credentials,
            notes,
            tombstones: headerData.tombstones || [],
            settings: headerData.settings,
          },
          sessionDek: dek,
        };
      } catch (err) {
        CryptoEngine.zeroize(dek);
        throw err;
      }
    } finally {
      CryptoEngine.zeroize(kek);
    }
  }

  /**
   * Migração Transacional V1 (Payload Único) -> V2 (Registros Criptografados Individualmente):
   * - Preserva snapshot criptografado V1 (`migratedFromV1Snapshot`) para permitir restauração.
   * - Permite atualizar o perfil Argon2id simultaneamente (ex: para `owasp-desktop-v2`).
   * - Verifica pós-migração que 100% das credenciais e notas foram migradas sem perda de dados.
   */
  static async migrateV1EnvelopeToV2Container(
    v1Envelope: EncryptedVaultEnvelope,
    masterPassword: string,
    targetKdfParams?: Argon2Params,
    secretKey?: string
  ): Promise<{
    container: EncryptedVaultContainerV2;
    payload: VaultPayload;
    sessionDek: Uint8Array;
  }> {
    const { payload: v1Payload, sessionDek: v1Dek } =
      await CryptoEngine.unsealVault(v1Envelope, masterPassword);

    try {
      const kdfParams = targetKdfParams || v1Envelope.kdfParams;
      const { container, sessionDek: v2Dek } =
        await CryptoEngine.sealContainerV2(
          masterPassword,
          v1Payload,
          kdfParams,
          secretKey,
          v1Dek,
          structuredClone(v1Envelope)
        );

      // Verificação transacional pós-migração: descriptografa o contêiner V2 recém-gerado e comprova zero perda
      const verified = await CryptoEngine.unsealContainerV2(
        container,
        masterPassword,
        secretKey
      );
      CryptoEngine.zeroize(verified.sessionDek);

      if (
        verified.payload.credentials.length !== v1Payload.credentials.length ||
        verified.payload.notes.length !== v1Payload.notes.length ||
        verified.payload.vaultName !== v1Payload.vaultName
      ) {
        CryptoEngine.zeroize(v2Dek);
        throw new Error(
          'Falha de verificação transacional: divergência na contagem de registros migrados para V2.'
        );
      }

      return {
        container,
        payload: verified.payload,
        sessionDek: v2Dek,
      };
    } finally {
      CryptoEngine.zeroize(v1Dek);
    }
  }

  /**
   * Rotaciona a DEK de um Contêiner V2 (gera nova DEK de 256 bits, incrementa `keyEpoch`
   * e re-criptografa todos os registros individuais com as novas subchaves HKDF).
   */
  static async rotateContainerDekV2(
    container: EncryptedVaultContainerV2,
    masterPassword: string,
    secretKey?: string
  ): Promise<{
    container: EncryptedVaultContainerV2;
    payload: VaultPayload;
    sessionDek: Uint8Array;
  }> {
    const { payload, sessionDek: oldDek } =
      await CryptoEngine.unsealContainerV2(
        container,
        masterPassword,
        secretKey
      );
    CryptoEngine.zeroize(oldDek);

    const nextPayload: VaultPayload = {
      ...payload,
      revision: container.revision + 1,
      keyEpoch: container.keyEpoch + 1,
    };

    const { container: rotatedContainer, sessionDek: newDek } =
      await CryptoEngine.sealContainerV2(
        masterPassword,
        nextPayload,
        container.kdfParams,
        secretKey,
        undefined, // Gera nova DEK aleatória de 256 bits
        container.migratedFromV1Snapshot
      );

    return {
      container: rotatedContainer,
      payload: nextPayload,
      sessionDek: newDek,
    };
  }

  // ============================================================================
  // FASE 5A — §3: RECUPERAÇÃO DE EMERGÊNCIA COM CHAVE INDEPENDENTE DE 256 BITS
  // (Separada da Secret Key de desbloqueio 2FA e da Senha Mestra)
  // ============================================================================

  /**
   * Gera uma Chave Independente de Recuperação de Emergência de 256 bits (32 bytes CSPRNG)
   * formatada como `DVLT-REC-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX`.
   * Esta chave é matematicamente independente da Senha Mestra e da Secret Key 2FA.
   */
  static generateRecoveryKey256(): string {
    const raw = CryptoEngine.getRandomBytes(32); // 256 bits de entropia CSPRNG
    const hex = bytesToHex(raw).toUpperCase();
    CryptoEngine.zeroize(raw);
    const groups: string[] = [];
    for (let i = 0; i < hex.length; i += 8) {
      groups.push(hex.slice(i, i + 8));
    }
    return `DVLT-REC-${groups.join('-')}`;
  }

  /**
   * Deriva uma Recovery Key Encryption Key (`RK-KEK`) de 256 bits a partir da Chave de Recuperação
   * usando Argon2id + separação de domínio HKDF-SHA256 (`DONUTVAULT_RECOVERY_KEK_V1`).
   */
  static deriveRecoveryKek(
    recoveryKey: string,
    recoverySalt: Uint8Array,
    params: Argon2Params = DEFAULT_ARGON2_PARAMS
  ): Uint8Array {
    const normalized = recoveryKey.trim().toUpperCase();
    if (!normalized.startsWith('DVLT-REC-') || normalized.length < 70) {
      throw new Error(
        'Formato de Chave de Recuperação de Emergência inválido (esperado DVLT-REC-... de 256 bits).'
      );
    }
    const domainInput = hkdf(
      sha256,
      utf8ToBytes(normalized),
      recoverySalt,
      utf8ToBytes('DONUTVAULT_RECOVERY_KEK_V1'),
      64
    );
    try {
      return argon2id(domainInput, recoverySalt, {
        t: params.t,
        m: params.m,
        p: params.p,
        dkLen: params.dkLen,
      });
    } finally {
      CryptoEngine.zeroize(domainInput);
    }
  }

  /**
   * Calcula o compromisso de integridade SHA-256 sobre os metadados públicos do encapsulamento de recuperação
   * (sem jamais incluir a Recovery Key ou a DEK em texto puro).
   */
  static computeRecoveryCommitmentHash(meta: {
    vaultId: string;
    keyEpoch: number;
    recoveryKeyVersion: number;
    recoverySaltHex: string;
    recoveryDekNonceHex: string;
    recoveryWrappedDekHex: string;
  }): string {
    const canonical = JSON.stringify({
      domain: 'DONUTVAULT_RECOVERY_COMMITMENT_V1',
      vaultId: meta.vaultId,
      keyEpoch: meta.keyEpoch,
      recoveryKeyVersion: meta.recoveryKeyVersion,
      recoverySaltHex: meta.recoverySaltHex,
      recoveryDekNonceHex: meta.recoveryDekNonceHex,
      recoveryWrappedDekHex: meta.recoveryWrappedDekHex,
    });
    return bytesToHex(sha256(utf8ToBytes(canonical)));
  }

  /**
   * Encapsula uma cópia independente da DEK de 256 bits do cofre usando uma Chave de Recuperação
   * de alta entropia (256 bits CSPRNG) e AES-256-GCM com AAD vinculado a `vaultId`, `keyEpoch` e `recoveryKeyVersion`.
   */
  static async encapsulateDekForEmergencyRecovery(
    sessionDek: Uint8Array,
    vaultId: string,
    keyEpoch = 1,
    recoveryKeyVersion = 1,
    params: Argon2Params = DEFAULT_ARGON2_PARAMS,
    customRecoveryKey?: string
  ): Promise<{
    recoveryKey: string;
    recoveryMetadata: {
      vaultId: string;
      keyEpoch: number;
      recoveryKeyVersion: number;
      kdfParams: Argon2Params;
      recoverySaltHex: string;
      recoveryWrappedDekHex: string;
      recoveryDekNonceHex: string;
      recoveryKeyCommitmentSha256: string;
      createdAt: string;
    };
  }> {
    if (!(sessionDek instanceof Uint8Array) || sessionDek.byteLength !== 32) {
      throw new Error('DEK de sessão inválida para encapsulamento de recuperação.');
    }
    if (!vaultId || recoveryKeyVersion < 1) {
      throw new Error('vaultId e recoveryKeyVersion >= 1 são obrigatórios.');
    }

    const recoveryKey = customRecoveryKey || CryptoEngine.generateRecoveryKey256();
    const recoverySalt = CryptoEngine.getRandomBytes(16);
    const rkKek = CryptoEngine.deriveRecoveryKek(recoveryKey, recoverySalt, params);

    const recoveryAad = utf8ToBytes(
      JSON.stringify({
        format: 'DONUTVAULT_RECOVERY_WRAP_V2',
        version: 2,
        vaultId,
        keyEpoch,
        recoveryKeyVersion,
        purpose: 'emergency-dek-recovery',
      })
    );

    try {
      const { ciphertext: wrappedDek, nonce: dekNonce } =
        await CryptoEngine.encryptAes256Gcm(rkKek, sessionDek, recoveryAad);

      const recoverySaltHex = bytesToHex(recoverySalt);
      const recoveryWrappedDekHex = bytesToHex(wrappedDek);
      const recoveryDekNonceHex = bytesToHex(dekNonce);
      const recoveryKeyCommitmentSha256 =
        CryptoEngine.computeRecoveryCommitmentHash({
          vaultId,
          keyEpoch,
          recoveryKeyVersion,
          recoverySaltHex,
          recoveryDekNonceHex,
          recoveryWrappedDekHex,
        });

      return {
        recoveryKey,
        recoveryMetadata: {
          vaultId,
          keyEpoch,
          recoveryKeyVersion,
          kdfParams: structuredClone(params),
          recoverySaltHex,
          recoveryWrappedDekHex,
          recoveryDekNonceHex,
          recoveryKeyCommitmentSha256,
          createdAt: new Date().toISOString(),
        },
      };
    } finally {
      CryptoEngine.zeroize(rkKek);
    }
  }

  /**
   * Recupera e autentica criptograficamente a DEK de 256 bits do cofre a partir da
   * Chave de Recuperação de Emergência (`DVLT-REC-...`) e dos metadados públicos de recuperação.
   */
  static async recoverDekFromEmergencyKit(
    recoveryKey: string,
    recoveryMetadata: {
      vaultId: string;
      keyEpoch: number;
      recoveryKeyVersion: number;
      kdfParams: Argon2Params;
      recoverySaltHex: string;
      recoveryWrappedDekHex: string;
      recoveryDekNonceHex: string;
      recoveryKeyCommitmentSha256: string;
    },
    expectedVaultId: string
  ): Promise<Uint8Array> {
    if (!recoveryMetadata || recoveryMetadata.vaultId !== expectedVaultId) {
      throw new Error(
        `Falha de recuperação: O Kit de Emergência pertence a outro cofre (esperado ${expectedVaultId}).`
      );
    }
    if (recoveryMetadata.recoveryKeyVersion < 1) {
      throw new Error(
        'Chave de recuperação revogada ou desativada para este cofre.'
      );
    }

    const expectedCommitment = CryptoEngine.computeRecoveryCommitmentHash({
      vaultId: recoveryMetadata.vaultId,
      keyEpoch: recoveryMetadata.keyEpoch,
      recoveryKeyVersion: recoveryMetadata.recoveryKeyVersion,
      recoverySaltHex: recoveryMetadata.recoverySaltHex,
      recoveryDekNonceHex: recoveryMetadata.recoveryDekNonceHex,
      recoveryWrappedDekHex: recoveryMetadata.recoveryWrappedDekHex,
    });
    if (expectedCommitment !== recoveryMetadata.recoveryKeyCommitmentSha256) {
      throw new Error(
        'Falha de integridade: O compromisso SHA-256 do encapsulamento de recuperação foi adulterado!'
      );
    }

    const recoverySalt = hexToBytes(recoveryMetadata.recoverySaltHex);
    const rkKek = CryptoEngine.deriveRecoveryKek(
      recoveryKey,
      recoverySalt,
      recoveryMetadata.kdfParams
    );

    const recoveryAad = utf8ToBytes(
      JSON.stringify({
        format: 'DONUTVAULT_RECOVERY_WRAP_V2',
        version: 2,
        vaultId: recoveryMetadata.vaultId,
        keyEpoch: recoveryMetadata.keyEpoch,
        recoveryKeyVersion: recoveryMetadata.recoveryKeyVersion,
        purpose: 'emergency-dek-recovery',
      })
    );

    try {
      const recoveredDek = await CryptoEngine.decryptAes256Gcm(
        rkKek,
        hexToBytes(recoveryMetadata.recoveryWrappedDekHex),
        hexToBytes(recoveryMetadata.recoveryDekNonceHex),
        recoveryAad
      );
      if (recoveredDek.byteLength !== 32) {
        CryptoEngine.zeroize(recoveredDek);
        throw new Error('DEK recuperada possui comprimento inválido.');
      }
      return recoveredDek;
    } catch {
      throw new Error(
        'Falha na recuperação criptográfica: Chave de Recuperação incorreta, versão substituída/revogada ou metadados adulterados.'
      );
    } finally {
      CryptoEngine.zeroize(rkKek);
    }
  }

  /**
   * Recupera integralmente um cofre em um dispositivo totalmente novo usando a Chave de Recuperação
   * de Emergência (`DVLT-REC-...`) + os registros criptografados baixados do servidor PostgreSQL,
   * descriptografando todas as credenciais e notas em memória e re-encapsulando a DEK sob uma nova Senha Mestra!
   */
  static async recoverVaultOnNewDeviceWithEmergencyKit(params: {
    recoveryKey: string;
    recoveryMetadata: {
      vaultId: string;
      keyEpoch: number;
      recoveryKeyVersion: number;
      kdfParams: Argon2Params;
      recoverySaltHex: string;
      recoveryWrappedDekHex: string;
      recoveryDekNonceHex: string;
      recoveryKeyCommitmentSha256: string;
    };
    encryptedRecords: EncryptedVaultRecordV2[];
    newMasterPassword: string;
    vaultName?: string;
    targetKdfParams?: Argon2Params;
  }): Promise<{
    recoveredPayload: VaultPayload;
    newEnvelope: EncryptedVaultEnvelope;
    newContainerV2: EncryptedVaultContainerV2;
    sessionDek: Uint8Array;
  }> {
    const recoveredDek = await CryptoEngine.recoverDekFromEmergencyKit(
      params.recoveryKey,
      params.recoveryMetadata,
      params.recoveryMetadata.vaultId
    );

    try {
      const credentials: CredentialItem[] = [];
      const notes: SecretNote[] = [];

      for (const rec of params.encryptedRecords) {
        if (rec.deleted) continue;
        if (rec.recordType === 'credential') {
          const cred = await CryptoEngine.unsealRecordV2<CredentialItem>(
            recoveredDek,
            rec,
            params.recoveryMetadata.vaultId
          );
          credentials.push({ ...cred, revision: rec.revision });
        } else if (rec.recordType === 'note') {
          const note = await CryptoEngine.unsealRecordV2<SecretNote>(
            recoveredDek,
            rec,
            params.recoveryMetadata.vaultId
          );
          notes.push({ ...note, revision: rec.revision });
        }
      }

      const now = new Date().toISOString();
      const recoveredPayload: VaultPayload = {
        version: 2,
        vaultId: params.recoveryMetadata.vaultId,
        revision: 1,
        keyEpoch: params.recoveryMetadata.keyEpoch,
        vaultName: params.vaultName || 'Cofre Recuperado de Springfield',
        createdAt: now,
        updatedAt: now,
        credentials,
        notes,
        settings: {
          autoLockMinutes: 5,
          theme: 'light',
        },
      };

      const kdfParams = params.targetKdfParams || params.recoveryMetadata.kdfParams;
      const { container: newContainerV2, sessionDek } =
        await CryptoEngine.sealContainerV2(
          params.newMasterPassword,
          recoveredPayload,
          kdfParams,
          undefined,
          recoveredDek
        );

      // Re-encapsula também como envelope V1 compatível preservando a MESMA DEK recuperada
      const v1Salt = hexToBytes(newContainerV2.saltHex);
      const v1Kek = CryptoEngine.deriveKek(
        params.newMasterPassword,
        v1Salt,
        kdfParams
      );
      let newEnvelope: EncryptedVaultEnvelope;
      try {
        const dekAad = CryptoEngine.buildAadBytes({
          format: 'DONUTVAULT_ENCRYPTED_V1',
          version: 1,
          vaultId: recoveredPayload.vaultId,
          recordType: 'dek-wrap',
        });
        const payloadAad = CryptoEngine.buildAadBytes({
          format: 'DONUTVAULT_ENCRYPTED_V1',
          version: 1,
          vaultId: recoveredPayload.vaultId,
          recordType: 'vault-payload',
        });
        const { ciphertext: wrappedDek, nonce: dekNonce } =
          await CryptoEngine.encryptAes256Gcm(v1Kek, sessionDek, dekAad);
        const payloadBytes = utf8ToBytes(JSON.stringify(recoveredPayload));
        const { ciphertext: payloadCipher, nonce: payloadNonce } =
          await CryptoEngine.encryptAes256Gcm(
            sessionDek,
            payloadBytes,
            payloadAad
          );
        CryptoEngine.zeroize(payloadBytes);

        const partialEnv: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'> = {
          format: 'DONUTVAULT_ENCRYPTED_V1',
          version: 1,
          vaultId: recoveredPayload.vaultId,
          revision: 1,
          keyEpoch: recoveredPayload.keyEpoch,
          createdAt: now,
          updatedAt: now,
          kdf: 'argon2id',
          kdfParams,
          saltHex: bytesToHex(v1Salt),
          wrappedDekHex: bytesToHex(wrappedDek),
          dekNonceHex: bytesToHex(dekNonce),
          ciphertextHex: bytesToHex(payloadCipher),
          payloadNonceHex: bytesToHex(payloadNonce),
        };
        newEnvelope = {
          ...partialEnv,
          integritySha256Hex: CryptoEngine.computeIntegrityHash(partialEnv),
        };
      } finally {
        CryptoEngine.zeroize(v1Kek);
      }

      return {
        recoveredPayload,
        newEnvelope,
        newContainerV2,
        sessionDek,
      };
    } finally {
      CryptoEngine.zeroize(recoveredDek);
    }
  }
}
