import type {
  Argon2Params,
  EncryptedVaultEnvelope,
  VaultPayload,
} from '../types/vault';
import { CryptoEngine, DEFAULT_ARGON2_PARAMS } from '../services/CryptoEngine';

export { DEFAULT_ARGON2_PARAMS };

export function zeroizeBuffer(buf: Uint8Array | null | undefined): void {
  CryptoEngine.zeroize(buf);
}

export function getRandomBytes(length: number): Uint8Array {
  return CryptoEngine.getRandomBytes(length);
}

export function deriveKekBytes(
  masterPassword: string,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS
): Uint8Array {
  return CryptoEngine.deriveKek(masterPassword, salt, params);
}

export function computeEnvelopeIntegrityHash(
  envelope: Omit<EncryptedVaultEnvelope, 'integritySha256Hex'>
): string {
  return CryptoEngine.computeIntegrityHash(envelope);
}

export async function createEncryptedVaultEnvelope(
  masterPassword: string,
  payload: VaultPayload,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS
): Promise<{ envelope: EncryptedVaultEnvelope; sessionDek: Uint8Array }> {
  return CryptoEngine.sealNewVault(masterPassword, payload, params);
}

export async function updateEncryptedVaultPayload(
  existingEnvelope: EncryptedVaultEnvelope,
  sessionDek: Uint8Array,
  updatedPayload: VaultPayload
): Promise<EncryptedVaultEnvelope> {
  return CryptoEngine.resealVaultPayload(
    existingEnvelope,
    sessionDek,
    updatedPayload
  );
}

export async function unlockEncryptedVaultEnvelope(
  envelope: EncryptedVaultEnvelope,
  masterPassword: string
): Promise<{ payload: VaultPayload; sessionDek: Uint8Array }> {
  return CryptoEngine.unsealVault(envelope, masterPassword);
}

export async function rotateMasterPassword(
  existingEnvelope: EncryptedVaultEnvelope,
  currentMasterPassword: string,
  newMasterPassword: string,
  currentPayload: VaultPayload
): Promise<{ envelope: EncryptedVaultEnvelope; sessionDek: Uint8Array }> {
  return CryptoEngine.rotateMasterPassword(
    existingEnvelope,
    currentMasterPassword,
    newMasterPassword,
    currentPayload
  );
}
