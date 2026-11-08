import type { CredentialItem, SecretNote, VaultPayload } from '../types/vault';

/**
 * Junta ao cofre local os registros que chegaram de outros aparelhos. Vale a versão de revisão
 * maior; o que só existe aqui fica. O resto do cofre (configurações, segredo de reconexão) vem do
 * `base` sem mudança, então quem chama deve passar o cofre mais recente. Devolve `null` quando
 * nada muda.
 */
export function mergeRemoteRecords(
  base: VaultPayload,
  remoteCredentials: CredentialItem[],
  remoteNotes: SecretNote[],
  now: Date = new Date()
): VaultPayload | null {
  let changed = false;

  const credentials = new Map(base.credentials.map((c) => [c.id, c]));
  for (const remote of remoteCredentials) {
    const local = credentials.get(remote.id);
    if (!local || (remote.revision || 1) > (local.revision || 1)) {
      credentials.set(remote.id, remote);
      changed = true;
    }
  }

  const notes = new Map(base.notes.map((n) => [n.id, n]));
  for (const remote of remoteNotes) {
    const local = notes.get(remote.id);
    if (!local || (remote.revision || 1) > (local.revision || 1)) {
      notes.set(remote.id, remote);
      changed = true;
    }
  }

  if (!changed) return null;
  return {
    ...base,
    credentials: Array.from(credentials.values()),
    notes: Array.from(notes.values()),
    updatedAt: now.toISOString(),
  };
}
