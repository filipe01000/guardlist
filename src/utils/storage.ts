import type { EncryptedVaultEnvelope } from '../types/vault';
import { StorageService } from '../services/StorageService';

export async function saveEncryptedEnvelopeToIdb(
  envelope: EncryptedVaultEnvelope
): Promise<void> {
  return StorageService.saveEnvelope(envelope);
}

export async function loadEncryptedEnvelopeFromIdb(): Promise<EncryptedVaultEnvelope | null> {
  return StorageService.loadEnvelope();
}

export async function deleteEncryptedEnvelopeFromIdb(): Promise<void> {
  return StorageService.clearEnvelope();
}

export function parseAndValidateBackupJson(
  rawJson: string
): EncryptedVaultEnvelope {
  return StorageService.parseAndValidateBackup(rawJson);
}
