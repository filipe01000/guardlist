import type {
  Argon2Params,
  BackupRestoreStrategy,
  CredentialItem,
  EncryptedVaultEnvelope,
  SecretNote,
  VaultPayload,
} from '../types/vault';
import { CryptoEngine, DEFAULT_ARGON2_PARAMS } from './CryptoEngine';
import { StorageService } from './StorageService';
import { SessionManager } from './SessionManager';
import { SyncAdapter } from './SyncAdapter';
import { createSampleSpringFieldPayload } from '../utils/seedData';
import {
  normalizeCredentialUrlForStorage,
  sanitizePlainText,
  sanitizeSafeExternalUrl,
} from '../utils/security';

export interface RestoreBackupOptions {
  allowForeignVaultMerge?: boolean;
  respectTombstones?: boolean;
}

/**
 * VaultService:
 * Serviço de domínio responsável por coordenar:
 * - CryptoEngine (Argon2id + AES-256-GCM + AAD)
 * - StorageService (IndexedDB criptografado + Anti-Rollback + Atomicidade)
 * - SessionManager (ciclo de vida da DEK em memória, geração de sessão e bloqueio por inatividade)
 * - SyncAdapter (preparação Zero-Knowledge para sincronização futura)
 * - Fila de mutações sequenciais (Mutex assíncrono contra condições de corrida em operações simultâneas)
 */
export class VaultService {
  readonly session = new SessionManager();
  readonly sync = new SyncAdapter();
  private envelope: EncryptedVaultEnvelope | null = null;
  private payload: VaultPayload | null = null;
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.session.onLock(() => {
      this.payload = null;
    });
  }

  /**
   * Enfileira operações de escrita/mutação sequencialmente para evitar condições de corrida
   * (race conditions) quando múltiplas alterações são disparadas simultaneamente.
   */
  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(task, task);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Verifica se a sessão permanece desbloqueada e na mesma geração em que a operação iniciou.
   */
  private assertSessionGeneration(expectedGeneration: number): void {
    if (
      !this.session.isUnlocked() ||
      !this.payload ||
      this.session.getGeneration() !== expectedGeneration
    ) {
      throw new Error(
        'Operação cancelada: O cofre foi bloqueado durante uma operação pendente.'
      );
    }
  }

  /**
   * Inicializa o serviço carregando o envelope criptografado do armazenamento, se existir.
   */
  async initialize(): Promise<EncryptedVaultEnvelope | null> {
    this.envelope = await StorageService.loadEnvelope();
    return this.envelope;
  }

  getEnvelope(): EncryptedVaultEnvelope | null {
    return this.envelope ? structuredClone(this.envelope) : null;
  }

  /**
   * Retorna um clone defensivo do payload descriptografado APENAS se a sessão estiver desbloqueada.
   * Impede acesso a credenciais enquanto o cofre estiver bloqueado e evita que referências externas
   * retenham ou modifiquem o estado interno após o bloqueio.
   */
  getUnlockedPayload(): VaultPayload {
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }
    return structuredClone(this.payload);
  }

  /**
   * Cria um novo cofre criptografado, persiste no StorageService e inicia a sessão.
   */
  async createVault(
    masterPassword: string,
    vaultName: string,
    includeSampleData = false,
    kdfParams: Argon2Params = DEFAULT_ARGON2_PARAMS
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> {
    return this.enqueueMutation(async () => {
      const now = new Date().toISOString();
      const cleanName =
        sanitizePlainText(vaultName, 120).trim() || 'Cofre de Springfield';
      const basePayload: VaultPayload = includeSampleData
        ? createSampleSpringFieldPayload()
        : {
            version: 1,
            vaultId: CryptoEngine.randomId('vault'),
            revision: 1,
            vaultName: cleanName,
            createdAt: now,
            updatedAt: now,
            credentials: [],
            notes: [],
            settings: {
              autoLockMinutes: 5,
              theme: 'light',
            },
          };

      basePayload.vaultName = cleanName;

      const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
        masterPassword,
        basePayload,
        kdfParams
      );

      await StorageService.saveEnvelope(envelope, {
        allowRollbackOrReplace: true,
      });
      this.envelope = envelope;
      this.payload = {
        ...basePayload,
        vaultId: envelope.vaultId,
        revision: envelope.revision,
      };
      this.session.startSession(
        sessionDek,
        this.payload.settings.autoLockMinutes
      );
      CryptoEngine.zeroize(sessionDek);
      this.sync.prepareEncryptedEnvelopeForSync(envelope);

      return {
        envelope: structuredClone(envelope),
        payload: structuredClone(this.payload),
      };
    });
  }

  /**
   * Desbloqueia o cofre existente no armazenamento usando a Senha Mestra.
   */
  async unlockVault(
    masterPassword: string
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> {
    return this.enqueueMutation(async () => {
      if (!this.envelope) {
        this.envelope = await StorageService.loadEnvelope();
      }
      if (!this.envelope) {
        throw new Error(
          'Nenhum cofre criptografado encontrado no armazenamento.'
        );
      }

      const { payload, sessionDek } = await CryptoEngine.unsealVault(
        this.envelope,
        masterPassword
      );
      this.payload = payload;
      this.session.startSession(
        sessionDek,
        payload.settings?.autoLockMinutes || 5
      );
      CryptoEngine.zeroize(sessionDek);

      return {
        envelope: structuredClone(this.envelope),
        payload: structuredClone(payload),
      };
    });
  }

  /**
   * Bloqueia manualmente o cofre e limpa a DEK e o payload em memória imediatamente,
   * invalidando qualquer operação assíncrona pendente.
   */
  lockVault(): void {
    this.payload = null;
    this.session.lock();
  }

  /**
   * Persiste alterações no cofre re-criptografando com novo nonce de 96 bits de forma atômica.
   * Se o cofre for bloqueado durante a operação ou se a gravação falhar, o estado anterior é preservado.
   */
  async savePayloadChanges(
    nextPayload: VaultPayload
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      return this.commitPayloadInternal(nextPayload, requestedGen);
    });
  }

  private async commitPayloadInternal(
    nextPayload: VaultPayload,
    expectedGen: number
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> {
    this.assertSessionGeneration(expectedGen);
    const activeDek = this.session.getActiveDek();
    try {
      if (!this.envelope) {
        throw new Error('Envelope do cofre não inicializado.');
      }

      const updatedPayload: VaultPayload = {
        ...nextPayload,
        updatedAt: new Date().toISOString(),
      };

      const nextEnvelope = await CryptoEngine.resealVaultPayload(
        this.envelope,
        activeDek,
        updatedPayload
      );

      // Verifica novamente se o cofre não foi bloqueado enquanto a criptografia assíncrona ocorria
      this.assertSessionGeneration(expectedGen);

      await StorageService.saveEnvelope(nextEnvelope);

      // Atualização atômica em memória somente após sucesso da persistência
      this.envelope = nextEnvelope;
      this.payload = {
        ...updatedPayload,
        revision: nextEnvelope.revision,
      };
      this.sync.prepareEncryptedEnvelopeForSync(nextEnvelope);

      return {
        envelope: structuredClone(nextEnvelope),
        payload: structuredClone(this.payload),
      };
    } finally {
      CryptoEngine.zeroize(activeDek);
    }
  }

  /**
   * Rotaciona a Senha Mestra autenticando a senha atual, gerando novo salt Argon2id (128 bits),
   * nova DEK (256 bits) e re-criptografando o cofre atomicamente.
   */
  async rotateMasterPassword(
    currentMasterPassword: string,
    newMasterPassword: string
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload || !this.envelope) {
      throw new Error('O cofre precisa estar desbloqueado para alterar a Senha Mestra.');
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const currentEnvelope = this.envelope!;
      const currentPayload = this.payload!;

      const { envelope: rotatedEnvelope, sessionDek: newDek } =
        await CryptoEngine.rotateMasterPassword(
          currentEnvelope,
          currentMasterPassword,
          newMasterPassword,
          currentPayload
        );

      try {
        this.assertSessionGeneration(requestedGen);
        await StorageService.saveEnvelope(rotatedEnvelope);
        this.envelope = rotatedEnvelope;
        this.payload = {
          ...currentPayload,
          revision: rotatedEnvelope.revision,
          updatedAt: rotatedEnvelope.updatedAt,
        };
        this.session.startSession(
          newDek,
          this.payload.settings.autoLockMinutes
        );
        this.sync.prepareEncryptedEnvelopeForSync(rotatedEnvelope);
        return {
          envelope: structuredClone(rotatedEnvelope),
          payload: structuredClone(this.payload),
        };
      } finally {
        CryptoEngine.zeroize(newDek);
      }
    });
  }

  /**
   * Adiciona ou edita uma credencial no cofre desbloqueado (serializado via fila de mutação).
   */
  async upsertCredential(
    item: Omit<CredentialItem, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    }
  ): Promise<CredentialItem> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const now = new Date().toISOString();

      const safeServiceName = sanitizePlainText(item.serviceName, 200).trim();
      if (!safeServiceName) {
        throw new Error('O nome do serviço é obrigatório.');
      }
      const safeUrl = normalizeCredentialUrlForStorage(item.url);
      const safeUsername = sanitizePlainText(item.username, 256).trim();
      const safeEmail = sanitizePlainText(item.email, 256).trim();
      const safePassword = sanitizePlainText(item.password, 1024);
      const safeNotes = sanitizePlainText(item.notes, 8000);
      const safeTags = (item.tags || [])
        .map((t) => sanitizePlainText(t, 64).trim())
        .filter(Boolean);

      let savedItem: CredentialItem;
      let nextCredentials: CredentialItem[];

      if (item.id) {
        const existing = current.credentials.find((c) => c.id === item.id);
        if (!existing) {
          throw new Error('Credencial não encontrada para edição.');
        }
        savedItem = {
          ...existing,
          ...item,
          id: item.id,
          serviceName: safeServiceName,
          url: safeUrl,
          username: safeUsername,
          email: safeEmail,
          password: safePassword,
          notes: safeNotes,
          tags: safeTags,
          updatedAt: now,
        };
        nextCredentials = current.credentials.map((c) =>
          c.id === item.id ? savedItem : c
        );
      } else {
        savedItem = {
          ...item,
          id: CryptoEngine.randomId('cred'),
          serviceName: safeServiceName,
          url: safeUrl,
          username: safeUsername,
          email: safeEmail,
          password: safePassword,
          notes: safeNotes,
          tags: safeTags,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        nextCredentials = [savedItem, ...current.credentials];
      }

      await this.commitPayloadInternal(
        {
          ...current,
          credentials: nextCredentials,
        },
        requestedGen
      );
      return structuredClone(savedItem);
    });
  }

  /**
   * Move uma credencial para a lixeira (soft delete) ou restaura da lixeira.
   */
  async setCredentialTrashState(
    credentialId: string,
    inTrash: boolean
  ): Promise<void> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const now = new Date().toISOString();
      const nextCredentials = current.credentials.map((c) =>
        c.id === credentialId
          ? { ...c, deletedAt: inTrash ? now : null, updatedAt: now }
          : c
      );
      await this.commitPayloadInternal(
        {
          ...current,
          credentials: nextCredentials,
        },
        requestedGen
      );
    });
  }

  /**
   * Exclui permanentemente uma credencial e registra tombstone criptografado para sincronização.
   */
  async deleteCredentialPermanently(credentialId: string): Promise<void> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const target = current.credentials.find((c) => c.id === credentialId);
      const now = new Date().toISOString();
      const nextTombstones = [...(current.tombstones || [])];
      if (target) {
        nextTombstones.push({
          recordId: credentialId,
          recordType: 'credential',
          deletedAt: now,
          revision: (target.revision || 1) + 1,
          keyEpoch: current.keyEpoch || 1,
        });
      }
      await this.commitPayloadInternal(
        {
          ...current,
          credentials: current.credentials.filter((c) => c.id !== credentialId),
          tombstones: nextTombstones,
        },
        requestedGen
      );
    });
  }

  /**
   * Adiciona ou edita uma Nota Secreta criptografada.
   */
  async upsertNote(
    note: Omit<SecretNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<SecretNote> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const now = new Date().toISOString();

      const safeTitle = sanitizePlainText(note.title, 200).trim();
      const safeCategory =
        sanitizePlainText(note.category, 100).trim() || 'Geral';
      const safeContent = sanitizePlainText(note.content, 20000);

      let savedNote: SecretNote;
      let nextNotes: SecretNote[];

      if (note.id) {
        const existing = current.notes.find((n) => n.id === note.id);
        if (!existing) {
          throw new Error('Nota secreta não encontrada para edição.');
        }
        savedNote = {
          ...existing,
          ...note,
          id: note.id,
          title: safeTitle,
          category: safeCategory,
          content: safeContent,
          updatedAt: now,
        };
        nextNotes = current.notes.map((n) =>
          n.id === note.id ? savedNote : n
        );
      } else {
        savedNote = {
          ...note,
          id: CryptoEngine.randomId('note'),
          title: safeTitle,
          category: safeCategory,
          content: safeContent,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        nextNotes = [savedNote, ...current.notes];
      }

      await this.commitPayloadInternal(
        {
          ...current,
          notes: nextNotes,
        },
        requestedGen
      );
      return structuredClone(savedNote);
    });
  }

  /**
   * Move uma Nota Secreta para a lixeira ou restaura da lixeira.
   */
  async setNoteTrashState(noteId: string, inTrash: boolean): Promise<void> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const now = new Date().toISOString();
      const nextNotes = current.notes.map((n) =>
        n.id === noteId
          ? { ...n, deletedAt: inTrash ? now : null, updatedAt: now }
          : n
      );
      await this.commitPayloadInternal(
        {
          ...current,
          notes: nextNotes,
        },
        requestedGen
      );
    });
  }

  /**
   * Exclui permanentemente uma Nota Secreta e registra tombstone criptografado para sincronização.
   */
  async deleteNotePermanently(noteId: string): Promise<void> {
    const requestedGen = this.session.getGeneration();
    if (!this.session.isUnlocked() || !this.payload) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra.'
      );
    }

    return this.enqueueMutation(async () => {
      this.assertSessionGeneration(requestedGen);
      const current = this.payload!;
      const target = current.notes.find((n) => n.id === noteId);
      const now = new Date().toISOString();
      const nextTombstones = [...(current.tombstones || [])];
      if (target) {
        nextTombstones.push({
          recordId: noteId,
          recordType: 'note',
          deletedAt: now,
          revision: (target.revision || 1) + 1,
          keyEpoch: current.keyEpoch || 1,
        });
      }
      await this.commitPayloadInternal(
        {
          ...current,
          notes: current.notes.filter((n) => n.id !== noteId),
          tombstones: nextTombstones,
        },
        requestedGen
      );
    });
  }

  /**
   * Exporta o cofre atual exclusivamente no formato criptografado JSON.
   * Nunca exporta senhas em texto puro.
   */
  exportEncryptedBackupJson(): string {
    if (!this.envelope) {
      throw new Error('Nenhum cofre disponível para exportação.');
    }
    StorageService.assertValidEncryptedEnvelope(this.envelope);
    return JSON.stringify(this.envelope, null, 2);
  }

  /**
   * Sanitiza credenciais e notas importadas de um backup antes de incorporá-las ao cofre.
   */
  private sanitizeImportedPayload(rawPayload: VaultPayload): VaultPayload {
    const sanitizedCredentials: CredentialItem[] = rawPayload.credentials.map(
      (c) => ({
        ...c,
        id: sanitizePlainText(c.id, 128),
        serviceName: sanitizePlainText(c.serviceName, 200),
        url: sanitizeSafeExternalUrl(c.url) || '',
        username: sanitizePlainText(c.username, 256),
        email: sanitizePlainText(c.email, 256),
        password: sanitizePlainText(c.password, 1024),
        notes: sanitizePlainText(c.notes, 8000),
        tags: Array.isArray(c.tags)
          ? c.tags.map((t) => sanitizePlainText(t, 64)).filter(Boolean)
          : [],
      })
    );

    const sanitizedNotes: SecretNote[] = rawPayload.notes.map((n) => ({
      ...n,
      id: sanitizePlainText(n.id, 128),
      title: sanitizePlainText(n.title, 200),
      category: sanitizePlainText(n.category, 100),
      content: sanitizePlainText(n.content, 20000),
    }));

    return {
      ...rawPayload,
      vaultName: sanitizePlainText(rawPayload.vaultName, 120),
      credentials: sanitizedCredentials,
      notes: sanitizedNotes,
    };
  }

  /**
   * Importa e restaura um backup criptografado com duas estratégias:
   * - `merge`: mescla credenciais e notas sem perder os dados existentes. Por segurança, verifica
   *   compatibilidade de `vaultId` a menos que `options.allowForeignVaultMerge` seja explicitamente habilitado.
   * - `replace`: substitui o cofre inteiro pelo backup validado.
   */
  async restoreEncryptedBackup(
    rawBackupJson: string,
    backupMasterPassword: string,
    strategy: BackupRestoreStrategy = 'replace',
    options?: RestoreBackupOptions
  ): Promise<{
    envelope: EncryptedVaultEnvelope;
    payload: VaultPayload;
    mergedCount: number;
  }> {
    return this.enqueueMutation(async () => {
      const backupEnvelope =
        StorageService.parseAndValidateBackup(rawBackupJson);
      const { payload: rawBackupPayload, sessionDek: backupDek } =
        await CryptoEngine.unsealVault(backupEnvelope, backupMasterPassword);
      const backupPayload = this.sanitizeImportedPayload(rawBackupPayload);

      if (
        strategy === 'merge' &&
        this.session.isUnlocked() &&
        this.payload &&
        this.envelope
      ) {
        CryptoEngine.zeroize(backupDek);
        const currentGen = this.session.getGeneration();
        const current = this.payload;

        if (
          options?.allowForeignVaultMerge === false &&
          current.vaultId &&
          backupEnvelope.vaultId &&
          current.vaultId !== backupEnvelope.vaultId
        ) {
          throw new Error(
            `Conflito de Identidade (vaultId incompatível): O backup pertence ao cofre "${backupEnvelope.vaultId}", diferente do cofre ativo "${current.vaultId}".`
          );
        }

        // Mapa de tombstones de exclusão permanente (aplicado quando respectTombstones === true em sincronização)
        const tombstoneMap = new Map<string, string>();
        if (options?.respectTombstones) {
          for (const t of current.tombstones || []) {
            tombstoneMap.set(t.recordId, t.deletedAt);
          }
          for (const t of backupPayload.tombstones || []) {
            const prev = tombstoneMap.get(t.recordId);
            if (!prev || Date.parse(t.deletedAt) > Date.parse(prev)) {
              tombstoneMap.set(t.recordId, t.deletedAt);
            }
          }
        }

        // Mescla credenciais sem perder nenhuma existente (atualiza se ID igual e mais recente, ou adiciona)
        const credMap = new Map<string, CredentialItem>();
        for (const c of current.credentials) {
          const tombDeletedAt = tombstoneMap.get(c.id);
          if (
            !tombDeletedAt ||
            Date.parse(c.updatedAt) > Date.parse(tombDeletedAt)
          ) {
            credMap.set(c.id, c);
          }
        }
        let mergedCount = 0;
        for (const incoming of backupPayload.credentials) {
          const tombDeletedAt = tombstoneMap.get(incoming.id);
          if (
            tombDeletedAt &&
            Date.parse(incoming.updatedAt) <= Date.parse(tombDeletedAt)
          ) {
            continue;
          }
          const existing = credMap.get(incoming.id);
          if (!existing) {
            credMap.set(incoming.id, incoming);
            mergedCount++;
          } else if (
            Date.parse(incoming.updatedAt) > Date.parse(existing.updatedAt)
          ) {
            credMap.set(incoming.id, incoming);
            mergedCount++;
          }
        }

        // Mescla notas secretas sem perda
        const noteMap = new Map<string, SecretNote>();
        for (const n of current.notes) {
          const tombDeletedAt = tombstoneMap.get(n.id);
          if (
            !tombDeletedAt ||
            Date.parse(n.updatedAt) > Date.parse(tombDeletedAt)
          ) {
            noteMap.set(n.id, n);
          }
        }
        for (const incomingNote of backupPayload.notes) {
          const tombDeletedAt = tombstoneMap.get(incomingNote.id);
          if (
            tombDeletedAt &&
            Date.parse(incomingNote.updatedAt) <= Date.parse(tombDeletedAt)
          ) {
            continue;
          }
          const existingNote = noteMap.get(incomingNote.id);
          if (!existingNote) {
            noteMap.set(incomingNote.id, incomingNote);
            mergedCount++;
          } else if (
            Date.parse(incomingNote.updatedAt) >
            Date.parse(existingNote.updatedAt)
          ) {
            noteMap.set(incomingNote.id, incomingNote);
            mergedCount++;
          }
        }

        const mergedPayload: VaultPayload = {
          ...current,
          credentials: Array.from(credMap.values()),
          notes: Array.from(noteMap.values()),
        };

        const saved = await this.commitPayloadInternal(
          mergedPayload,
          currentGen
        );
        return {
          envelope: saved.envelope,
          payload: saved.payload,
          mergedCount,
        };
      }

      // Estratégia 'replace': substitui o cofre pelo backup validado
      await StorageService.saveEnvelope(backupEnvelope, {
        allowRollbackOrReplace: true,
      });
      this.envelope = backupEnvelope;
      this.payload = backupPayload;
      this.session.startSession(
        backupDek,
        backupPayload.settings?.autoLockMinutes || 5
      );
      CryptoEngine.zeroize(backupDek);
      this.sync.prepareEncryptedEnvelopeForSync(backupEnvelope);

      return {
        envelope: structuredClone(backupEnvelope),
        payload: structuredClone(backupPayload),
        mergedCount:
          backupPayload.credentials.length + backupPayload.notes.length,
      };
    });
  }
}
