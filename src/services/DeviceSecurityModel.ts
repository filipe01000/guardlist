import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Argon2Params } from '../types/vault';
import { CryptoEngine } from './CryptoEngine';

export interface AuthorizedDeviceRecord {
  deviceId: string;
  userId: string;
  deviceName: string;
  platform: 'desktop-web' | 'mobile-web' | 'ios' | 'android';
  authMethod: 'webauthn-passkey' | 'session-token';
  credentialId?: string;
  sessionTokenHashHex: string;
  authorizedAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface EmergencyRecoveryWrapMetadata {
  vaultId: string;
  keyEpoch: number;
  recoveryKeyVersion: number;
  kdfParams: Argon2Params;
  recoverySaltHex: string;
  recoveryWrappedDekHex: string;
  recoveryDekNonceHex: string;
  recoveryKeyCommitmentSha256: string;
  // Hash do token que prova a posse da Chave de Recuperação; é o que o servidor guarda.
  recoveryAuthVerifierSha256: string;
  createdAt: string;
}

export interface EmergencyKitDocument {
  kitId: string;
  generatedAt: string;
  vaultId: string;
  accountIdentifier: string;
  /** Factor 2FA opcional de desbloqueio (combinado com a Senha Mestra via HKDF) */
  secretKey: string;
  /** Chave independente de recuperação de emergência (256 bits CSPRNG: DVLT-REC-...) capaz de desencapsular a cópia de emergência da DEK */
  recoveryKey?: string;
  /** Metadados públicos do encapsulamento independente da DEK (podem ser armazenados no servidor Zero-Knowledge ou offline) */
  recoveryMetadata?: EmergencyRecoveryWrapMetadata;
  kdfProfile: Argon2Params;
  securityNotice: string;
}

/**
 * DeviceSecurityModel (Fase 4A & Fase 5A — §3 & §4):
 * Modela a separação estrita entre:
 * 1. Autenticação da Conta / Dispositivo perante o servidor Zero-Knowledge (WebAuthn/Passkey + Token de Sessão por Dispositivo)
 * 2. Desbloqueio Criptográfico Local do Cofre (Senha Mestra + Secret Key 2FA opcional)
 * 3. Recuperação Criptográfica Independente (Recovery Key de 256 bits que encapsula uma cópia independente da DEK)
 */
export class DeviceSecurityModel {
  private devices = new Map<string, AuthorizedDeviceRecord>();

  /**
   * Hash SHA-256 de um token de sessão (o servidor armazena apenas o hash do token, nunca o token em texto puro).
   */
  static hashSessionToken(rawToken: string): string {
    return bytesToHex(sha256(utf8ToBytes(rawToken)));
  }

  /**
   * Provisiona um novo dispositivo autorizado para um usuário, retornando o registro do dispositivo
   * e o token de sessão de transporte (que autentica chamadas REST, mas NÃO possui poder de descriptografar o cofre).
   */
  provisionNewDevice(params: {
    userId: string;
    deviceName: string;
    platform: AuthorizedDeviceRecord['platform'];
    authMethod: AuthorizedDeviceRecord['authMethod'];
    webauthnCredentialId?: string;
  }): { device: AuthorizedDeviceRecord; rawSessionToken: string } {
    const deviceId = CryptoEngine.randomId('dev');
    const rawSessionToken = `dvlt_sess_${bytesToHex(CryptoEngine.getRandomBytes(24))}`;
    const now = new Date().toISOString();

    const record: AuthorizedDeviceRecord = {
      deviceId,
      userId: params.userId,
      deviceName: params.deviceName,
      platform: params.platform,
      authMethod: params.authMethod,
      credentialId: params.webauthnCredentialId,
      sessionTokenHashHex: DeviceSecurityModel.hashSessionToken(rawSessionToken),
      authorizedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };

    this.devices.set(deviceId, record);
    return {
      device: structuredClone(record),
      rawSessionToken,
    };
  }

  /**
   * Valida se uma requisição de sincronização pertence ao `userId` esperado e se a sessão/dispositivo
   * não foi revogada.
   */
  verifyDeviceAuthorization(
    userId: string,
    deviceId: string,
    rawSessionToken: string
  ): AuthorizedDeviceRecord {
    const record = this.devices.get(deviceId);
    if (!record) {
      throw new Error('Dispositivo não reconhecido ou não autorizado (401).');
    }
    if (record.userId !== userId) {
      throw new Error(
        `Violação de Autorização Entre Usuários (403 Forbidden): O dispositivo ${deviceId} pertence a outro usuário.`
      );
    }
    if (record.revokedAt !== null) {
      throw new Error(
        `Sessão Revogada (401 Unauthorized): O dispositivo "${record.deviceName}" foi revogado em ${record.revokedAt}.`
      );
    }
    const expectedHash = DeviceSecurityModel.hashSessionToken(rawSessionToken);
    if (expectedHash !== record.sessionTokenHashHex) {
      throw new Error('Token de sessão do dispositivo inválido (401).');
    }

    record.lastSeenAt = new Date().toISOString();
    return structuredClone(record);
  }

  /**
   * Revoga imediatamente o acesso de sincronização de um dispositivo.
   */
  revokeDevice(userId: string, deviceId: string): AuthorizedDeviceRecord {
    const record = this.devices.get(deviceId);
    if (!record) {
      throw new Error('Dispositivo não encontrado.');
    }
    if (record.userId !== userId) {
      throw new Error(
        'Violação de Autorização (403): Não é permitido revogar dispositivos de outro usuário.'
      );
    }
    record.revokedAt = new Date().toISOString();
    return structuredClone(record);
  }

  /**
   * Lista o histórico de dispositivos autorizados e revogados de um usuário.
   */
  listUserDevices(userId: string): AuthorizedDeviceRecord[] {
    return Array.from(this.devices.values())
      .filter((d) => d.userId === userId)
      .map((d) => structuredClone(d));
  }

  /**
   * Gera um Kit de Emergência básico (compatibilidade com testes síncronos Fase 4A/4B).
   */
  static generateEmergencyKit(params: {
    vaultId: string;
    accountIdentifier: string;
    secretKey?: string;
    kdfProfile: Argon2Params;
  }): EmergencyKitDocument {
    return {
      kitId: CryptoEngine.randomId('ekit'),
      generatedAt: new Date().toISOString(),
      vaultId: params.vaultId,
      accountIdentifier: params.accountIdentifier,
      secretKey:
        params.secretKey || CryptoEngine.generateHighEntropySecretKey(),
      recoveryKey: CryptoEngine.generateRecoveryKey256(),
      kdfProfile: structuredClone(params.kdfProfile),
      securityNotice:
        'Guarde este Kit de Emergência em local físico seguro e offline. A Chave de Recuperação (DVLT-REC-...) permite recuperar a DEK do cofre em um novo dispositivo sem que o servidor Zero-Knowledge jamais a conheça.',
    };
  }

  /**
   * Gera e verifica criptograficamente um Kit de Emergência completo (Fase 5A — §3):
   * - Gera uma Chave de Recuperação independente de 256 bits (`DVLT-REC-...`).
   * - Encapsula uma cópia da `sessionDek` usando `RK-KEK` derivada via Argon2id + HKDF-SHA256 e `AES-256-GCM`.
   * - Executa verificação criptográfica imediata (round-trip) comprovando que a DEK encapsulada pode ser recuperada sem erros antes de emitir o documento.
   * - Jamais envia `recoveryKey` ou `sessionDek` ao servidor.
   */
  static async generateVerifiedCryptographicEmergencyKit(params: {
    sessionDek: Uint8Array;
    vaultId: string;
    accountIdentifier: string;
    keyEpoch: number;
    recoveryKeyVersion: number;
    kdfProfile: Argon2Params;
    secretKey?: string;
  }): Promise<EmergencyKitDocument> {
    const { recoveryKey, recoveryMetadata } =
      await CryptoEngine.encapsulateDekForEmergencyRecovery(
        params.sessionDek,
        params.vaultId,
        params.keyEpoch,
        params.recoveryKeyVersion,
        params.kdfProfile
      );

    // Verificação criptográfica obrigatória da recuperação (Self-Test antes da emissão)
    const verifiedDek = await CryptoEngine.recoverDekFromEmergencyKit(
      recoveryKey,
      recoveryMetadata,
      params.vaultId
    );
    try {
      if (bytesToHex(verifiedDek) !== bytesToHex(params.sessionDek)) {
        throw new Error(
          'Falha crítica na verificação criptográfica do Kit de Emergência: DEK recuperada diverge da DEK original.'
        );
      }
    } finally {
      CryptoEngine.zeroize(verifiedDek);
    }

    return {
      kitId: CryptoEngine.randomId('ekit'),
      generatedAt: recoveryMetadata.createdAt,
      vaultId: params.vaultId,
      accountIdentifier: params.accountIdentifier,
      secretKey:
        params.secretKey || CryptoEngine.generateHighEntropySecretKey(),
      recoveryKey,
      recoveryMetadata,
      kdfProfile: structuredClone(params.kdfProfile),
      securityNotice:
        'KIT DE EMERGÊNCIA CRIPTOGRÁFICO VERIFICADO (OFFLINE-ONLY): A Chave de Recuperação Independente de 256 bits (DVLT-REC-...) desencapsula a cópia cifrada da DEK em um novo dispositivo caso você perca todos os aparelhos ou esqueça a Senha Mestra. O servidor jamais recebe esta chave.',
    };
  }
}
