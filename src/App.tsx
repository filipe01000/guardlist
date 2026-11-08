/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Lock,
  Plus,
  Menu,
  X,
  Sun,
  Moon,
  Home,
  KeyRound,
  Star,
  Dices,
  ShieldCheck,
  StickyNote,
  FolderOpen,
  Trash2,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type {
  BackupRestoreStrategy,
  CredentialItem,
  EncryptedVaultEnvelope,
  NavigationTab,
  SecretNote,
  VaultPayload,
} from './types/vault';
import { CryptoEngine, NEW_VAULT_ARGON2_PARAMS } from './services/CryptoEngine';
import { checkMasterPasswordPolicy } from './utils/generator';
import { StorageService } from './services/StorageService';
import { SyncAdapter } from './services/SyncAdapter';
import {
  createEncryptedVaultEnvelope,
  unlockEncryptedVaultEnvelope,
  updateEncryptedVaultPayload,
  rotateMasterPassword,
  zeroizeBuffer,
} from './utils/crypto';
import {
  loadEncryptedEnvelopeFromIdb,
  saveEncryptedEnvelopeToIdb,
  deleteEncryptedEnvelopeFromIdb,
  parseAndValidateBackupJson,
} from './utils/storage';
import { runVaultSecurityAudit } from './utils/audit';
import { DonutVaultLogo } from './components/CartoonIllustrations';
import { WelcomeScreen } from './components/WelcomeScreen';
import { DashboardView } from './components/DashboardView';
import { PasswordsView } from './components/PasswordsView';
import { GeneratorView } from './components/GeneratorView';
import { SecurityAuditView } from './components/SecurityAuditView';
import { SecretNotesView } from './components/SecretNotesView';
import { SettingsView } from './components/SettingsView';
import type {
  SyncDashboardProps,
  SyncDeviceViewItem,
} from './components/SyncDashboardPanel';
import { Button } from './components/ui/button';
import {
  ComicToastOverlay,
  type ComicToastMessage,
} from './components/ui/comic';

const SIDEBAR_ITEMS: { id: NavigationTab; label: string; icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Início', icon: Home },
  { id: 'passwords', label: 'Senhas', icon: KeyRound },
  { id: 'favorites', label: 'Favoritos', icon: Star },
  { id: 'generator', label: 'Gerador de senhas', icon: Dices },
  { id: 'security', label: 'Saúde das senhas', icon: ShieldCheck },
  { id: 'notes', label: 'Notas seguras', icon: StickyNote },
  { id: 'categories', label: 'Categorias', icon: FolderOpen },
  { id: 'trash', label: 'Lixeira', icon: Trash2 },
  { id: 'settings', label: 'Configurações', icon: Settings },
];

// Nome legível do aparelho para a lista de aparelhos conectados ("Chrome no Windows").
function describeThisDevice(): {
  name: string;
  platform: 'desktop-web' | 'mobile-web';
} {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Navegador';
  const system = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/.test(ua);
  return {
    name: system ? `${browser} no ${system}` : `${browser} neste aparelho`,
    platform: mobile ? 'mobile-web' : 'desktop-web',
  };
}

const SYNC_HEADLINE_DONE = 'Tudo sincronizado.';
const SYNC_HEADLINE_SENDING = 'Enviando alterações cifradas…';
const SYNC_HEADLINE_OFFLINE =
  'Sem conexão. Suas alterações ficam guardadas e sobem quando a internet voltar.';
const SYNC_HEADLINE_FAILED =
  'Não foi possível sincronizar agora. Suas alterações continuam na fila.';

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [storedEnvelope, setStoredEnvelope] =
    useState<EncryptedVaultEnvelope | null>(null);
  const [unlockedPayload, setUnlockedPayload] = useState<VaultPayload | null>(
    null
  );
  const sessionDekRef = useRef<Uint8Array | null>(null);

  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newCredentialModalOpen, setNewCredentialModalOpen] = useState(false);
  const [prefilledPassword, setPrefilledPassword] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [comicToast, setComicToast] = useState<ComicToastMessage | null>(null);

  // Estado de Sincronização Zero-Knowledge (Fase 4B)
  const syncAdapterRef = useRef<SyncAdapter>(new SyncAdapter());
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncHeadline, setSyncHeadline] = useState(
    SYNC_HEADLINE_DONE
  );
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [conflictsCount, setConflictsCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [serverCursor, setServerCursor] = useState<number>(0);
  const [accountUid, setAccountUid] = useState<string>('');
  const [syncAuthSession, setSyncAuthSession] = useState<{
    userUid: string;
    deviceId: string;
    sessionToken: string;
  } | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<
    SyncDeviceViewItem[]
  >([]);
  const serverCursorRef = useRef<number>(0);
  const effectiveOnline = isOnline;
  // Cofres sem a configuração (criados antes dela) seguem sincronizando como antes.
  const syncEnabled = unlockedPayload?.settings?.syncEnabled !== false;

  const triggerComicToast = useCallback(
    (
      burst: string,
      title: string,
      tone: ComicToastMessage['tone'] = 'info',
      description?: string
    ) => {
      setComicToast({
        id: CryptoEngine.randomId('toast'),
        burst,
        title,
        description,
        tone,
      });
    },
    []
  );

  useEffect(() => {
    if (!comicToast) return;
    const t = setTimeout(() => setComicToast(null), 3800);
    return () => clearTimeout(t);
  }, [comicToast]);

  // Sincroniza classe .dark no <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Bloqueia o cofre limpando a chave DEK e o payload descriptografado da memória
  const lockVault = useCallback(() => {
    if (sessionDekRef.current) {
      zeroizeBuffer(sessionDekRef.current);
      sessionDekRef.current = null;
    }
    setUnlockedPayload(null);
    // O próximo desbloqueio pede uma sessão nova ao servidor (renova a atual ou prova a posse do
    // cofre). Mantida aqui, uma sessão vencida com a aba aberta travava a sincronização.
    setSyncAuthSession(null);
    setNewCredentialModalOpen(false);
    setMobileMenuOpen(false);
  }, []);

  // Carrega envelope criptografado do IndexedDB ao iniciar
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const existing = await loadEncryptedEnvelopeFromIdb();
        if (!mounted) return;
        setStoredEnvelope(existing);
      } catch {
        // IndexedDB indisponível ou vazio
      } finally {
        if (mounted) setIsInitializing(false);
      }
    })();

    return () => {
      mounted = false;
      if (sessionDekRef.current) {
        zeroizeBuffer(sessionDekRef.current);
      }
    };
  }, []);

  // Monitor de Inatividade para Bloqueio Automático
  useEffect(() => {
    if (!unlockedPayload) return;
    const timeoutMs =
      (unlockedPayload.settings.autoLockMinutes || 5) * 60 * 1000;
    let timerId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timerId);
      timerId = setTimeout(() => {
        lockVault();
      }, timeoutMs);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [unlockedPayload, lockVault]);

  // Monitora eventos nativos online/offline do navegador
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncHeadline(SYNC_HEADLINE_SENDING);
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncHeadline(SYNC_HEADLINE_OFFLINE);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Inicializa sessão de dispositivo e sincronização Zero-Knowledge no PostgreSQL quando o cofre é desbloqueado
  const executeIncrementalSync = useCallback(
    async (
      customAuth?: { userUid: string; deviceId: string; sessionToken: string },
      customEnvelope?: EncryptedVaultEnvelope,
      customPayload?: VaultPayload
    ) => {
      const activeAuth = customAuth || syncAuthSession;
      const activeEnvelope = customEnvelope || storedEnvelope;
      const activePayload = customPayload || unlockedPayload;
      const activeDek = sessionDekRef.current;

      if (!activeAuth || !activeEnvelope || !activePayload || !activeDek) {
        return;
      }

      if (!effectiveOnline) {
        setSyncHeadline(SYNC_HEADLINE_OFFLINE);
        setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);
        return;
      }

      try {
        setIsSyncing(true);
        setSyncHeadline(SYNC_HEADLINE_SENDING);

        const vaultId = activeEnvelope.vaultId || activePayload.vaultId;
        const keyEpoch = activeEnvelope.keyEpoch || activePayload.keyEpoch || 1;

        await syncAdapterRef.current.registerVaultOnBackend('', activeAuth, {
          vaultId,
          activeKeyEpoch: keyEpoch,
          kdfParams: activeEnvelope.kdfParams,
          saltHex: activeEnvelope.saltHex,
          wrappedDekHex: activeEnvelope.wrappedDekHex,
          dekNonceHex: activeEnvelope.dekNonceHex,
        });

        // 1. Push da fila offline pendente
        const pushOutcome =
          await syncAdapterRef.current.flushOfflineQueueToBackend(
            '',
            activeAuth,
            vaultId,
            activeDek,
            keyEpoch
          );

        // 2. Pull incremental a partir do último cursor conhecido
        const pullOutcome =
          await syncAdapterRef.current.pullAndDecryptFromBackend(
            '',
            activeAuth,
            vaultId,
            serverCursorRef.current,
            activeDek
          );

        const nextCursor = Math.max(
          serverCursorRef.current,
          pushOutcome.latestCursor,
          pullOutcome.currentServerCursor
        );
        serverCursorRef.current = nextCursor;
        setServerCursor(nextCursor);

        // Se chegaram registros novos de outros dispositivos (ex: Celular), mescla localmente sem perda
        if (
          pullOutcome.decryptedCredentials.length > 0 ||
          pullOutcome.decryptedNotes.length > 0
        ) {
          let hasRemoteUpdates = false;
          const credMap = new Map<string, CredentialItem>(
            activePayload.credentials.map((c) => [c.id, c])
          );
          for (const remoteCred of pullOutcome.decryptedCredentials) {
            const localCred = credMap.get(remoteCred.id);
            if (
              !localCred ||
              (remoteCred.revision || 1) > (localCred.revision || 1)
            ) {
              credMap.set(remoteCred.id, remoteCred);
              hasRemoteUpdates = true;
            }
          }

          const noteMap = new Map<string, SecretNote>(
            activePayload.notes.map((n) => [n.id, n])
          );
          for (const remoteNote of pullOutcome.decryptedNotes) {
            const localNote = noteMap.get(remoteNote.id);
            if (
              !localNote ||
              (remoteNote.revision || 1) > (localNote.revision || 1)
            ) {
              noteMap.set(remoteNote.id, remoteNote);
              hasRemoteUpdates = true;
            }
          }

          if (hasRemoteUpdates) {
            const mergedPayload: VaultPayload = {
              ...activePayload,
              credentials: Array.from(credMap.values()),
              notes: Array.from(noteMap.values()),
              updatedAt: new Date().toISOString(),
            };
            const reencryptedEnvelope = await updateEncryptedVaultPayload(
              activeEnvelope,
              activeDek,
              mergedPayload
            );
            await saveEncryptedEnvelopeToIdb(reencryptedEnvelope);
            setStoredEnvelope(reencryptedEnvelope);
            setUnlockedPayload(mergedPayload);
          }
        }

        // Atualiza fila persistente no IndexedDB
        await StorageService.savePersistentSyncState(
          syncAdapterRef.current.exportPersistentQueueState(nextCursor)
        );

        const queueRemaining = syncAdapterRef.current.getPendingQueue().length;
        const archiveConflicts =
          syncAdapterRef.current.getConflictArchive().length;
        setPendingSyncCount(queueRemaining);
        setConflictsCount(archiveConflicts);
        setLastSyncedAt(new Date().toISOString());
        setSyncHeadline(SYNC_HEADLINE_DONE);

        // Atualiza lista de dispositivos autorizados
        const devRes = await fetch('/api/v1/auth/devices', {
          headers: {
            Authorization: `Bearer ${activeAuth.sessionToken}`,
            'X-Device-Id': activeAuth.deviceId,
            'X-User-Uid': activeAuth.userUid,
          },
        });
        if (devRes.ok) {
          const devData = await devRes.json();
          if (Array.isArray(devData.devices)) {
            setAuthorizedDevices(devData.devices);
          }
        }
      } catch {
        // Antes, qualquer falha aparecia como "sem internet", mesmo com o servidor fora do ar.
        setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);
        setSyncHeadline(
          typeof navigator !== 'undefined' && !navigator.onLine
            ? SYNC_HEADLINE_OFFLINE
            : SYNC_HEADLINE_FAILED
        );
      } finally {
        setIsSyncing(false);
      }
    },
    [
      syncAuthSession,
      storedEnvelope,
      unlockedPayload,
      effectiveOnline,
    ]
  );

  // Com a sincronização ligada, provisiona o dispositivo ao desbloquear o cofre e conecta ao SSE.
  // Desligada, nada sai do navegador: as alterações ficam na fila local, como no modo offline.
  useEffect(() => {
    if (
      !unlockedPayload ||
      !storedEnvelope ||
      !sessionDekRef.current ||
      !syncEnabled
    ) {
      return;
    }
    let cancelled = false;
    let eventSource: EventSource | null = null;

    (async () => {
      try {
        const savedQueueState = await StorageService.loadPersistentSyncState();
        if (savedQueueState) {
          const { lastCursor } =
            syncAdapterRef.current.restorePersistentQueueState(savedQueueState);
          serverCursorRef.current = lastCursor;
          setServerCursor(lastCursor);
          setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);
          setConflictsCount(
            syncAdapterRef.current.getConflictArchive().length
          );
        }

        let currentAuth = syncAuthSession;
        if (!currentAuth) {
          const vaultBasedUid = `usr-${(
            storedEnvelope.vaultId || 'springfield'
          ).slice(0, 24)}`;
          setAccountUid(vaultBasedUid);

          const thisDevice = describeThisDevice();
          // Prova de posse do cofre: deixa este navegador voltar a sincronizar quando a sessão
          // no servidor vencer (o cookie dura 30 dias desde o último desbloqueio).
          const reauthSecret = unlockedPayload.settings?.syncReauthSecretHex;
          let vaultReauthToken: string | undefined;
          try {
            vaultReauthToken = reauthSecret
              ? CryptoEngine.deriveVaultReauthToken(
                  reauthSecret,
                  storedEnvelope.vaultId || unlockedPayload.vaultId
                )
              : undefined;
          } catch {
            // Segredo ilegível: segue sem a prova, como antes.
          }
          const registered =
            await syncAdapterRef.current.registerDeviceOnBackend('', {
              userUid: vaultBasedUid,
              email: `${vaultBasedUid}@donutvault.local`,
              deviceName: thisDevice.name,
              platform: thisDevice.platform,
              // Sessão de aparelho; passkeys ainda não são usadas no navegador.
              authMethod: 'session-token',
              vaultReauthToken,
            });
          if (cancelled) return;
          currentAuth = {
            userUid: vaultBasedUid,
            deviceId: registered.device.deviceId,
            sessionToken: registered.sessionToken,
          };
          setSyncAuthSession(currentAuth);
          setAuthorizedDevices([registered.device]);

          // Primeira sincronização (cursor 0): envia o cofre inteiro. A fila local pode já ter
          // alterações feitas com a sincronização desligada; ela é trocada por um retrato
          // completo do cofre para o servidor não ficar só com os itens alterados.
          if (serverCursorRef.current === 0 && sessionDekRef.current) {
            syncAdapterRef.current.clearPendingQueue();
            const vaultId = storedEnvelope.vaultId || unlockedPayload.vaultId;
            const keyEpoch = storedEnvelope.keyEpoch || 1;
            for (const cred of unlockedPayload.credentials) {
              const rec = await CryptoEngine.sealRecordV2(
                sessionDekRef.current,
                vaultId,
                cred.id,
                'credential',
                cred.revision || 1,
                keyEpoch,
                Boolean(cred.deletedAt),
                cred
              );
              syncAdapterRef.current.enqueueRecordOperation(rec, 0);
            }
            for (const note of unlockedPayload.notes) {
              const rec = await CryptoEngine.sealRecordV2(
                sessionDekRef.current,
                vaultId,
                note.id,
                'note',
                note.revision || 1,
                keyEpoch,
                Boolean(note.deletedAt),
                note
              );
              syncAdapterRef.current.enqueueRecordOperation(rec, 0);
            }
          }
        }

        await executeIncrementalSync(
          currentAuth,
          storedEnvelope,
          unlockedPayload
        );

        // Conecta ao SSE para notificações em tempo real usando Cookie HttpOnly (jamais envia token na URL!)
        if (typeof EventSource !== 'undefined' && currentAuth) {
          const vaultId = storedEnvelope.vaultId || unlockedPayload.vaultId;
          const sseUrl = `/api/v1/sync/events?vaultId=${encodeURIComponent(
            vaultId
          )}`;
          eventSource = new EventSource(sseUrl, { withCredentials: true });
          eventSource.onmessage = (ev) => {
            try {
              const parsed = JSON.parse(ev.data);
              if (
                parsed.type === 'SYNC_CURSOR_UPDATED' &&
                parsed.sourceDeviceId !== currentAuth?.deviceId
              ) {
                executeIncrementalSync(currentAuth);
              }
            } catch {
              // ignore
            }
          };
        }
      } catch {
        // Permanece em funcionamento offline
      }
    })();

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [Boolean(unlockedPayload), storedEnvelope?.vaultId, syncEnabled]);

  // Enfileira um registro modificado (criptografado localmente em V2) e sincroniza
  const enqueueRecordChangeForSync = async (
    recordType: 'credential' | 'note',
    item: CredentialItem | SecretNote,
    expectedBaseRevision: number,
    deleted: boolean
  ) => {
    if (!storedEnvelope || !sessionDekRef.current) return;
    const vaultId = storedEnvelope.vaultId || 'vault-default';
    const keyEpoch = storedEnvelope.keyEpoch || 1;
    const nextRev = expectedBaseRevision + 1;

    const encryptedRec = await CryptoEngine.sealRecordV2(
      sessionDekRef.current,
      vaultId,
      item.id,
      recordType,
      nextRev,
      keyEpoch,
      deleted,
      { ...item, revision: nextRev }
    );

    syncAdapterRef.current.enqueueRecordOperation(
      encryptedRec,
      expectedBaseRevision
    );
    await StorageService.savePersistentSyncState(
      syncAdapterRef.current.exportPersistentQueueState(serverCursorRef.current)
    );
    setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);

    if (effectiveOnline && syncAuthSession) {
      await executeIncrementalSync();
    } else {
      setSyncHeadline(SYNC_HEADLINE_OFFLINE);
    }
  };

  // Persiste qualquer alteração re-criptografando com novo nonce único
  const persistUpdatedPayload = async (nextPayload: VaultPayload) => {
    if (!storedEnvelope || !sessionDekRef.current) {
      throw new Error('Sessão do cofre bloqueada.');
    }
    const updatedPayload: VaultPayload = {
      ...nextPayload,
      updatedAt: new Date().toISOString(),
    };
    const nextEnvelope = await updateEncryptedVaultPayload(
      storedEnvelope,
      sessionDekRef.current,
      updatedPayload
    );
    await saveEncryptedEnvelopeToIdb(nextEnvelope);
    setStoredEnvelope(nextEnvelope);
    setUnlockedPayload(updatedPayload);
  };

  // O estado de sincronização (cursor, fila e conflitos) pertence ao cofre que estava neste
  // navegador. Quando outro cofre o substitui, esse estado é descartado; sem isso o cofre novo
  // herdava o cursor e a fila do antigo e a primeira sincronização saía errada.
  const resetSyncStateForReplacedVault = async () => {
    syncAdapterRef.current = new SyncAdapter();
    serverCursorRef.current = 0;
    setServerCursor(0);
    setPendingSyncCount(0);
    setConflictsCount(0);
    setSyncAuthSession(null);
    setAuthorizedDevices([]);
    await StorageService.clearPersistentSyncState();
  };

  // Handlers de Autenticação / Criptografia Inicial
  const handleCreateVault = async (
    masterPassword: string,
    vaultName: string,
    enableSync: boolean,
    replaceExisting = false
  ) => {
    // Criar um cofre grava por cima do que estiver salvo neste navegador. Só com confirmação.
    if (storedEnvelope && !replaceExisting) {
      throw new Error(
        'Já existe um cofre neste navegador. Confirme a substituição antes de criar outro.'
      );
    }
    const policy = checkMasterPasswordPolicy(masterPassword);
    if (!policy.ok) {
      throw new Error(policy.reason);
    }
    // Cofre novo começa vazio: sem credenciais ou notas de exemplo.
    const now = new Date().toISOString();
    const basePayload: VaultPayload = {
      version: 1,
      vaultId: CryptoEngine.randomId('vault'),
      revision: 1,
      vaultName,
      createdAt: now,
      updatedAt: now,
      credentials: [],
      notes: [],
      settings: {
        autoLockMinutes: 5,
        theme: 'light',
        syncEnabled: enableSync,
        syncReauthSecretHex: CryptoEngine.generateVaultReauthSecret(),
      },
    };
    const { envelope, sessionDek } = await createEncryptedVaultEnvelope(
      masterPassword,
      basePayload,
      NEW_VAULT_ARGON2_PARAMS
    );
    await saveEncryptedEnvelopeToIdb(envelope);
    if (storedEnvelope) {
      await resetSyncStateForReplacedVault();
    }
    sessionDekRef.current = sessionDek;
    setStoredEnvelope(envelope);
    setUnlockedPayload(basePayload);
    setTheme(basePayload.settings.theme);
    setActiveTab('dashboard');
    triggerComicToast(
      'WOO-HOO!',
      'Cofre criado. Ele é cifrado neste navegador com a sua Senha Mestra.',
      'success'
    );
  };

  // Cofres sem segredo de reconexão (criados antes dele) ganham um ao abrir. Ele entra antes de o
  // cofre aberto chegar ao estado do app, para nenhuma cópia em memória ficar sem ele (a
  // sincronização regrava o cofre a partir dessas cópias). Se a gravação falhar, o cofre abre
  // assim mesmo, sem o segredo, e nada é enviado ao servidor.
  const ensureSyncReauthSecret = async (
    envelope: EncryptedVaultEnvelope,
    sessionDek: Uint8Array,
    payload: VaultPayload,
    preferredSecret?: string
  ): Promise<{ envelope: EncryptedVaultEnvelope; payload: VaultPayload }> => {
    if (payload.settings?.syncReauthSecretHex) {
      return { envelope, payload };
    }
    const withSecret: VaultPayload = {
      ...payload,
      settings: {
        ...payload.settings,
        syncReauthSecretHex:
          preferredSecret || CryptoEngine.generateVaultReauthSecret(),
      },
    };
    try {
      const resealed = await updateEncryptedVaultPayload(
        envelope,
        sessionDek,
        withSecret
      );
      return { envelope: resealed, payload: withSecret };
    } catch {
      return { envelope, payload };
    }
  };

  const handleUnlockVault = async (masterPassword: string) => {
    if (!storedEnvelope) {
      throw new Error('Nenhum cofre encontrado neste navegador.');
    }
    const { payload: openedPayload, sessionDek } =
      await unlockEncryptedVaultEnvelope(storedEnvelope, masterPassword);
    let payload = openedPayload;
    const ensured = await ensureSyncReauthSecret(
      storedEnvelope,
      sessionDek,
      openedPayload
    );
    if (ensured.envelope !== storedEnvelope) {
      try {
        await saveEncryptedEnvelopeToIdb(ensured.envelope);
        setStoredEnvelope(ensured.envelope);
        payload = ensured.payload;
      } catch {
        // Sem gravar, o segredo não vale: seguir sem ele evita perdê-lo depois.
      }
    }
    sessionDekRef.current = sessionDek;
    setUnlockedPayload(payload);
    setTheme(payload.settings?.theme || 'light');
    setActiveTab('dashboard');
    const policy = checkMasterPasswordPolicy(masterPassword);
    if (!policy.ok) {
      // Cofres criados antes da regra atual continuam abrindo, mas o usuário é avisado.
      triggerComicToast(
        'ATENÇÃO!',
        'Sua Senha Mestra está abaixo da regra atual.',
        'warning',
        `${policy.reason} Troque em Configurações.`
      );
      return;
    }
    triggerComicToast(
      'ABERTO!',
      'Cofre desbloqueado.',
      'success'
    );
  };

  const handleImportBackup = async (
    fileContent: string,
    masterPassword: string,
    strategy: BackupRestoreStrategy = 'replace'
  ) => {
    const validatedEnvelope = parseAndValidateBackupJson(fileContent);
    const { payload: importedPayload, sessionDek: importedDek } =
      await unlockEncryptedVaultEnvelope(validatedEnvelope, masterPassword);

    if (
      strategy === 'merge' &&
      unlockedPayload &&
      storedEnvelope &&
      sessionDekRef.current
    ) {
      zeroizeBuffer(importedDek);

      const credMap = new Map<string, CredentialItem>();
      for (const c of unlockedPayload.credentials) credMap.set(c.id, c);
      for (const c of importedPayload.credentials) {
        const existing = credMap.get(c.id);
        if (
          !existing ||
          Date.parse(c.updatedAt) >= Date.parse(existing.updatedAt)
        ) {
          credMap.set(c.id, c);
        }
      }

      const noteMap = new Map<string, SecretNote>();
      for (const n of unlockedPayload.notes) noteMap.set(n.id, n);
      for (const n of importedPayload.notes) {
        const existing = noteMap.get(n.id);
        if (
          !existing ||
          Date.parse(n.updatedAt) >= Date.parse(existing.updatedAt)
        ) {
          noteMap.set(n.id, n);
        }
      }

      await persistUpdatedPayload({
        ...unlockedPayload,
        credentials: Array.from(credMap.values()),
        notes: Array.from(noteMap.values()),
      });
      triggerComicToast(
        'MESCLADO!',
        'Backup mesclado. Nada do que já estava no cofre foi perdido.',
        'success'
      );
      return;
    }

    const replacingAnotherVault = Boolean(
      storedEnvelope && storedEnvelope.vaultId !== validatedEnvelope.vaultId
    );
    // Backup antigo do mesmo cofre, sem segredo de reconexão: mantém o que este navegador já usa,
    // porque é ele que o servidor conhece.
    const restored = await ensureSyncReauthSecret(
      validatedEnvelope,
      importedDek,
      importedPayload,
      replacingAnotherVault
        ? undefined
        : unlockedPayload?.settings?.syncReauthSecretHex
    );
    await saveEncryptedEnvelopeToIdb(restored.envelope);
    if (replacingAnotherVault) {
      await resetSyncStateForReplacedVault();
    }
    if (sessionDekRef.current) {
      zeroizeBuffer(sessionDekRef.current);
    }
    sessionDekRef.current = importedDek;
    setStoredEnvelope(restored.envelope);
    setUnlockedPayload(restored.payload);
    setTheme(importedPayload.settings?.theme || 'light');
    setActiveTab('dashboard');
    triggerComicToast(
      'RESTAURADO!',
      'Backup verificado e restaurado.',
      'success'
    );
  };

  // Na tela de entrada, restaurar um backup substitui o cofre salvo neste navegador.
  // Com um cofre já salvo, só segue com a confirmação explícita da tela.
  const handleWelcomeImport = async (
    fileContent: string,
    masterPassword: string,
    replaceExisting: boolean
  ) => {
    if (storedEnvelope && !replaceExisting) {
      throw new Error(
        'Já existe um cofre neste navegador. Confirme a substituição antes de restaurar um backup.'
      );
    }
    await handleImportBackup(fileContent, masterPassword, 'replace');
  };

  // Handlers CRUD de Credenciais
  const handleSaveCredential = async (
    item: Omit<CredentialItem, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
    }
  ) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    let nextCredentials: CredentialItem[];
    let targetCred: CredentialItem;
    let baseRev = 0;

    if (item.id) {
      const existing = unlockedPayload.credentials.find((c) => c.id === item.id);
      baseRev = existing?.revision || 1;
      targetCred = {
        ...(existing || item),
        ...item,
        id: item.id,
        revision: baseRev + 1,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      nextCredentials = unlockedPayload.credentials.map((c) =>
        c.id === item.id ? targetCred : c
      );
    } else {
      targetCred = {
        ...item,
        id: CryptoEngine.randomId('cred'),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      nextCredentials = [targetCred, ...unlockedPayload.credentials];
    }

    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
    await enqueueRecordChangeForSync(
      'credential',
      targetCred,
      baseRev,
      Boolean(targetCred.deletedAt)
    );
  };

  const handleToggleFavorite = async (id: string) => {
    if (!unlockedPayload) return;
    const nextCredentials = unlockedPayload.credentials.map((c) =>
      c.id === id
        ? { ...c, favorite: !c.favorite, updatedAt: new Date().toISOString() }
        : c
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
  };

  const handleMoveToTrash = async (id: string) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    const nextCredentials = unlockedPayload.credentials.map((c) =>
      c.id === id ? { ...c, deletedAt: now, updatedAt: now } : c
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
    triggerComicToast('LIXEIRA!', 'Credencial movida para a lixeira.', 'warning');
  };

  const handleRestoreFromTrash = async (id: string) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    const nextCredentials = unlockedPayload.credentials.map((c) =>
      c.id === id ? { ...c, deletedAt: null, updatedAt: now } : c
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
    triggerComicToast('SALVO!', 'Credencial restaurada da lixeira!', 'success');
  };

  const handlePermanentDelete = async (id: string) => {
    if (!unlockedPayload) return;
    const nextCredentials = unlockedPayload.credentials.filter(
      (c) => c.id !== id
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
    triggerComicToast('ZAP!', 'Credencial destruída permanentemente.', 'danger');
  };

  const handleEmptyTrash = async () => {
    if (!unlockedPayload) return;
    const nextCredentials = unlockedPayload.credentials.filter(
      (c) => !c.deletedAt
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      credentials: nextCredentials,
    });
    triggerComicToast('LIMPO!', 'A lixeira do cofre foi esvaziada.', 'info');
  };

  // Handlers de Notas Secretas
  const handleSaveNote = async (
    note: Omit<SecretNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    let nextNotes: SecretNote[];

    if (note.id) {
      nextNotes = unlockedPayload.notes.map((n) =>
        n.id === note.id ? { ...n, ...note, id: note.id, updatedAt: now } : n
      );
    } else {
      const created: SecretNote = {
        ...note,
        id: CryptoEngine.randomId('note'),
        createdAt: now,
        updatedAt: now,
      };
      nextNotes = [created, ...unlockedPayload.notes];
    }

    await persistUpdatedPayload({
      ...unlockedPayload,
      notes: nextNotes,
    });
  };

  const handleMoveNoteToTrash = async (id: string) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    const nextNotes = unlockedPayload.notes.map((n) =>
      n.id === id ? { ...n, deletedAt: now, updatedAt: now } : n
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      notes: nextNotes,
    });
    triggerComicToast('LIXEIRA!', 'Nota secreta movida para a lixeira.', 'warning');
  };

  const handleRestoreNoteFromTrash = async (id: string) => {
    if (!unlockedPayload) return;
    const now = new Date().toISOString();
    const nextNotes = unlockedPayload.notes.map((n) =>
      n.id === id ? { ...n, deletedAt: null, updatedAt: now } : n
    );
    await persistUpdatedPayload({
      ...unlockedPayload,
      notes: nextNotes,
    });
    triggerComicToast('RESTAURADA!', 'Nota secreta restaurada da lixeira!', 'success');
  };

  const handleDeleteNote = async (id: string) => {
    if (!unlockedPayload) return;
    const nextNotes = unlockedPayload.notes.filter((n) => n.id !== id);
    await persistUpdatedPayload({
      ...unlockedPayload,
      notes: nextNotes,
    });
    triggerComicToast('APAGADO!', 'Nota secreta destruída permanentemente.', 'danger');
  };

  // Exportar Backup Criptografado
  const handleExportBackup = () => {
    if (!storedEnvelope) return;
    const jsonString = JSON.stringify(storedEnvelope, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `donutvault-backup-${datePart}.donutvault.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerComicToast(
      'BACKUP!',
      'Backup cifrado baixado (.donutvault.json).',
      'success'
    );
  };

  // Relatório de auditoria calculado em tempo real
  const auditReport = useMemo(
    () => runVaultSecurityAudit(unlockedPayload?.credentials || []),
    [unlockedPayload?.credentials]
  );

  // Aparelhos conectados à sincronização
  const handleRevokeDevice = async (targetDeviceId: string) => {
    if (!syncAuthSession) return;
    try {
      const res = await fetch(
        `/api/v1/auth/devices/${encodeURIComponent(targetDeviceId)}/revoke`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${syncAuthSession.sessionToken}`,
            'X-Device-Id': syncAuthSession.deviceId,
            'X-User-Uid': syncAuthSession.userUid,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao revogar dispositivo.');
      }
      setAuthorizedDevices((prev) =>
        prev.map((d) =>
          d.deviceId === targetDeviceId
            ? { ...d, revokedAt: data.revokedAt }
            : d
        )
      );
      triggerComicToast(
        'REVOGADO!',
        'Aparelho revogado. Ele não sincroniza mais.',
        'warning'
      );
    } catch (err) {
      triggerComicToast(
        'ERRO!',
        err instanceof Error ? err.message : 'Erro ao revogar dispositivo.',
        'danger'
      );
    }
  };

  // Liga ou desliga a sincronização deste cofre. A escolha fica salva, cifrada, no próprio cofre.
  // Ao desligar, a sessão continua válida no servidor (o cookie prova a posse da conta ao religar),
  // mas nada mais é enviado. A cópia já enviada permanece no servidor.
  const handleToggleSync = async (enabled: boolean) => {
    if (!unlockedPayload) return;
    await persistUpdatedPayload({
      ...unlockedPayload,
      settings: { ...unlockedPayload.settings, syncEnabled: enabled },
    });
    if (!enabled) {
      setSyncAuthSession(null);
      setSyncHeadline('Sincronização desligada: o cofre está só neste navegador.');
    }
    triggerComicToast(
      enabled ? 'LIGADA!' : 'DESLIGADA!',
      enabled ? 'Sincronização ativada.' : 'Sincronização desativada.',
      'info',
      enabled
        ? 'O cofre, cifrado neste navegador, será enviado ao servidor.'
        : 'Nada mais sai deste navegador. O que já foi enviado continua no servidor.'
    );
  };

  const syncDashboardProps: SyncDashboardProps = {
    syncEnabled,
    onToggleSync: handleToggleSync,
    isOnline: effectiveOnline,
    isSyncing,
    syncHeadline,
    pendingCount: pendingSyncCount,
    conflictsCount,
    lastSyncedAt,
    currentDeviceId: syncAuthSession?.deviceId || null,
    devices: authorizedDevices,
    onManualSync: async () => {
      await executeIncrementalSync();
      triggerComicToast('SYNC!', SYNC_HEADLINE_DONE, 'success');
    },
    onRevokeDevice: handleRevokeDevice,
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-background bg-comic-halftone flex flex-col items-center justify-center p-6 text-center space-y-4">
        <DonutVaultLogo size={84} spinning={true} />
        <p className="font-display text-xl font-black">
          Assando rosquinhas criptográficas...
        </p>
      </div>
    );
  }

  // Se o cofre estiver trancado, exibe a Tela Inicial de Boas-Vindas
  if (!unlockedPayload || !storedEnvelope) {
    return (
      <WelcomeScreen
        hasExistingVault={Boolean(storedEnvelope)}
        existingVaultUpdatedAt={storedEnvelope?.updatedAt}
        onCreateVault={handleCreateVault}
        onUnlockVault={handleUnlockVault}
        onImportBackupFile={handleWelcomeImport}
        onExportExistingVault={handleExportBackup}
      />
    );
  }

  const trashCount = unlockedPayload.credentials.filter((c) =>
    Boolean(c.deletedAt)
  ).length;

  return (
    <div className="min-h-screen bg-background bg-comic-halftone text-foreground flex flex-col lg:flex-row">
      {/* Sidebar Desktop Neobrutal-UI (Azul-celeste com bordas pretas grossas e botões táteis) */}
      <aside
        aria-label="Menu principal do cofre"
        className="hidden lg:flex lg:w-72 lg:sticky lg:top-0 lg:h-screen shrink-0 bg-[#E0F2FE] dark:bg-[#0F172A] border-r-4 border-border flex-col justify-between p-5"
      >
        <div className="space-y-6">
          {/* Identidade do Cofre na Sidebar */}
          <div className="flex items-center gap-3 pb-4 border-b-3 border-border">
            <DonutVaultLogo size={48} />
            <div className="min-w-0">
              <span className="font-display text-xl font-black tracking-tight block truncate">
                DonutVault
              </span>
              <span className="text-xs font-extrabold text-stone-700 dark:text-sky-300 block truncate">
                {unlockedPayload.vaultName}
              </span>
            </div>
          </div>

          {/* Lista de Navegação Neobrutal-UI com os 9 itens exatos */}
          <nav className="space-y-2">
            {SIDEBAR_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full px-4 py-2.5 rounded-base text-left text-sm font-black transition-all flex items-center justify-between cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-main text-main-foreground border-3 border-border shadow-shadow translate-x-[1px] translate-y-[1px]'
                      : 'text-foreground hover:bg-white/80 dark:hover:bg-slate-800 border-3 border-transparent hover:border-border'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.id === 'trash' && trashCount > 0 && (
                    <span className="font-mono text-xs tabular-nums">
                      ({trashCount})
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Rodapé da Sidebar: Botão Neobrutal-UI de Trancar Cofre */}
        <div className="pt-4 border-t-3 border-border">
          <Button
            type="button"
            variant="neutral"
            onClick={lockVault}
            className="w-full"
          >
            <Lock className="w-4 h-4" />
            <span>Trancar Cofre Agora</span>
          </Button>
        </div>
      </aside>

      {/* Conteúdo Principal + Top Header Neobrutal-UI */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar seguindo o Top Bar Contract (3 zonas: Contexto, Links Rápidos, 1 CTA Primário) */}
        <header className="w-full flex items-center justify-between gap-4 px-5 sm:px-8 py-4 bg-secondary-background border-b-4 border-border">
          {/* Zona 1: Menu Mobile + Título da Seção Ativa */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label="Abrir menu de navegação"
              className="lg:hidden"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
            <span className="font-display text-base sm:text-lg font-black truncate">
              {SIDEBAR_ITEMS.find((i) => i.id === activeTab)?.label}
            </span>
          </div>

          {/* Zona 2: Links concisos de navegação rápida no desktop */}
          <nav className="hidden xl:flex items-center gap-6 text-xs font-extrabold text-stone-700 dark:text-slate-300">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="hover:text-pink cursor-pointer whitespace-nowrap"
            >
              Início
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className="hover:text-pink cursor-pointer whitespace-nowrap"
            >
              Gerador
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className="hover:text-pink cursor-pointer whitespace-nowrap"
            >
              Saúde ({auditReport.overallScore}%)
            </button>
            <button
              type="button"
              onClick={async () => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                await persistUpdatedPayload({
                  ...unlockedPayload,
                  settings: { ...unlockedPayload.settings, theme: nextTheme },
                });
              }}
              aria-label="Alternar tema claro e escuro"
              className="hover:text-pink flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span>{theme === 'dark' ? 'Tema Claro' : 'Tema Escuro'}</span>
            </button>
          </nav>

          {/* Zona 3: 1 Ação Primária ("Guardar nova senha") */}
          <div className="flex items-center shrink-0">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => {
                setPrefilledPassword('');
                setNewCredentialModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Guardar nova senha</span>
            </Button>
          </div>
        </header>

        {/* Gaveta de Navegação Mobile */}
        {mobileMenuOpen && (
          <nav
            aria-label="Menu mobile"
            className="lg:hidden bg-[#E0F2FE] dark:bg-[#0F172A] border-b-4 border-border p-4 space-y-2"
          >
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full px-4 py-2.5 rounded-base text-left text-sm font-black flex items-center justify-between ${
                  activeTab === item.id
                    ? 'bg-main text-main-foreground border-3 border-border shadow-shadow'
                    : 'text-foreground'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <item.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
              </button>
            ))}
            <Button
              type="button"
              variant="destructive"
              onClick={lockVault}
              className="w-full mt-2"
            >
              <Lock className="w-4 h-4" />
              <span>Trancar Cofre</span>
            </Button>
          </nav>
        )}

        {/* Área Principal da View Selecionada */}
        <main className="flex-1 p-5 sm:p-8 max-w-6xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              credentials={unlockedPayload.credentials}
              auditReport={auditReport}
              onOpenNewCredentialModal={() => {
                setPrefilledPassword('');
                setNewCredentialModalOpen(true);
              }}
              onNavigate={(tab) => setActiveTab(tab)}
              onSelectCategory={(catId) => setSelectedCategoryId(catId)}
              onNotify={triggerComicToast}
              syncDashboardProps={syncDashboardProps}
            />
          )}

          {(activeTab === 'passwords' ||
            activeTab === 'favorites' ||
            activeTab === 'categories' ||
            activeTab === 'trash' ||
            newCredentialModalOpen) && (
            <div
              className={
                activeTab !== 'passwords' &&
                activeTab !== 'favorites' &&
                activeTab !== 'categories' &&
                activeTab !== 'trash'
                  ? 'hidden'
                  : ''
              }
            >
              <PasswordsView
                mode={
                  activeTab === 'favorites'
                    ? 'favorites'
                    : activeTab === 'categories'
                      ? 'categories'
                      : activeTab === 'trash'
                        ? 'trash'
                        : 'all'
                }
                credentials={unlockedPayload.credentials}
                selectedCategoryId={selectedCategoryId}
                onSelectCategoryId={setSelectedCategoryId}
                onSaveCredential={handleSaveCredential}
                onToggleFavorite={handleToggleFavorite}
                onMoveToTrash={handleMoveToTrash}
                onRestoreFromTrash={handleRestoreFromTrash}
                onPermanentDelete={handlePermanentDelete}
                onEmptyTrash={handleEmptyTrash}
                externalModalOpen={newCredentialModalOpen}
                onCloseExternalModal={() => setNewCredentialModalOpen(false)}
                prefilledPassword={prefilledPassword}
                onNotify={triggerComicToast}
              />
            </div>
          )}

          {activeTab === 'generator' && (
            <GeneratorView
              onUsePasswordInNewCredential={(pwd) => {
                setPrefilledPassword(pwd);
                setNewCredentialModalOpen(true);
              }}
              onNotify={triggerComicToast}
            />
          )}

          {activeTab === 'security' && (
            <SecurityAuditView
              auditReport={auditReport}
              onQuickUpgradePassword={async (credId, newPassword) => {
                const target = unlockedPayload.credentials.find(
                  (c) => c.id === credId
                );
                if (!target) return;
                await handleSaveCredential({
                  ...target,
                  password: newPassword,
                });
              }}
              onNotify={triggerComicToast}
            />
          )}

          {activeTab === 'notes' && (
            <SecretNotesView
              notes={unlockedPayload.notes}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              onMoveNoteToTrash={handleMoveNoteToTrash}
              onRestoreNoteFromTrash={handleRestoreNoteFromTrash}
              onNotify={triggerComicToast}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              envelope={storedEnvelope}
              autoLockMinutes={unlockedPayload.settings.autoLockMinutes}
              theme={theme}
              onUpdateAutoLock={async (minutes) => {
                await persistUpdatedPayload({
                  ...unlockedPayload,
                  settings: {
                    ...unlockedPayload.settings,
                    autoLockMinutes: minutes,
                  },
                });
                triggerComicToast(
                  'TIMER!',
                  `Bloqueio automático ajustado para ${minutes} min.`,
                  'info'
                );
              }}
              onToggleTheme={async () => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(nextTheme);
                await persistUpdatedPayload({
                  ...unlockedPayload,
                  settings: {
                    ...unlockedPayload.settings,
                    theme: nextTheme,
                  },
                });
              }}
              onChangeMasterPassword={async (currentPwd, newPwd) => {
                const policy = checkMasterPasswordPolicy(newPwd);
                if (!policy.ok) {
                  throw new Error(policy.reason);
                }
                // A troca de senha também leva o cofre para os parâmetros Argon2id atuais.
                const { envelope: rotatedEnvelope, sessionDek: newDek } =
                  await rotateMasterPassword(
                    storedEnvelope,
                    currentPwd,
                    newPwd,
                    unlockedPayload,
                    NEW_VAULT_ARGON2_PARAMS
                  );
                await saveEncryptedEnvelopeToIdb(rotatedEnvelope);
                if (sessionDekRef.current) {
                  zeroizeBuffer(sessionDekRef.current);
                }
                sessionDekRef.current = newDek;
                setStoredEnvelope(rotatedEnvelope);
                triggerComicToast(
                  'BLINDADO!',
                  'Senha Mestra trocada.',
                  'success'
                );
              }}
              onExportBackup={handleExportBackup}
              onImportBackupInSession={handleImportBackup}
              onDeleteEntireVault={async () => {
                await deleteEncryptedEnvelopeFromIdb();
                lockVault();
                setStoredEnvelope(null);
              }}
              onLockNow={lockVault}
              syncDashboardProps={syncDashboardProps}
            />
          )}
        </main>
      </div>

      {/* Notificação Flutuante em Estilo Quadrinhos StreamUI */}
      <ComicToastOverlay
        toast={comicToast}
        onDismiss={() => setComicToast(null)}
      />
    </div>
  );
}
