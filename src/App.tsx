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
} from 'lucide-react';
import type {
  BackupRestoreStrategy,
  CredentialItem,
  EncryptedVaultEnvelope,
  NavigationTab,
  SecretNote,
  VaultPayload,
} from './types/vault';
import { CryptoEngine } from './services/CryptoEngine';
import {
  DeviceSecurityModel,
  type EmergencyKitDocument,
} from './services/DeviceSecurityModel';
import { StorageService } from './services/StorageService';
import { SyncAdapter } from './services/SyncAdapter';
import { signInWithGooglePopup } from './lib/firebase';
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
import { createSampleSpringFieldPayload } from './utils/seedData';
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

const SIDEBAR_ITEMS: { id: NavigationTab; label: string }[] = [
  { id: 'dashboard', label: '🏠 Minha Springfield' },
  { id: 'passwords', label: '🔐 Minhas Senhas' },
  { id: 'favorites', label: '🍩 Favoritos' },
  { id: 'generator', label: '🎲 Gerador de Senhas' },
  { id: 'security', label: '🛡️ Auditoria de Segurança' },
  { id: 'notes', label: '📝 Notas Secretas' },
  { id: 'categories', label: '📁 Categorias' },
  { id: 'trash', label: '🗑️ Lixeira' },
  { id: 'settings', label: '⚙️ Configurações' },
];

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
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncHeadline, setSyncHeadline] = useState(
    '🍩 Suas rosquinhas estão sincronizadas!'
  );
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [conflictsCount, setConflictsCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [serverCursor, setServerCursor] = useState<number>(0);
  const [accountUid, setAccountUid] = useState<string>('barnaby-setor-7g');
  const [syncAuthSession, setSyncAuthSession] = useState<{
    userUid: string;
    deviceId: string;
    sessionToken: string;
  } | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<
    SyncDeviceViewItem[]
  >([]);
  const [emergencyKit, setEmergencyKit] =
    useState<EmergencyKitDocument | null>(null);
  const serverCursorRef = useRef<number>(0);
  const effectiveOnline = isOnline && !simulatedOffline;

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
    setNewCredentialModalOpen(false);
    setMobileMenuOpen(false);
  }, []);

  // Carrega envelope criptografado do IndexedDB ao iniciar (e suporta ?autostart=1)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const existing = await loadEncryptedEnvelopeFromIdb();
        if (!mounted) return;
        setStoredEnvelope(existing);

        const params = new URLSearchParams(window.location.search);
        if (params.get('autostart') === '1') {
          if (
            existing &&
            existing.vaultId &&
            existing.vaultId !== 'vault-springfield-7g'
          ) {
            try {
              const { payload, sessionDek } =
                await unlockEncryptedVaultEnvelope(existing, 'Rosquinha2026!');
              if (!mounted) return;
              sessionDekRef.current = sessionDek;
              setStoredEnvelope(existing);
              setUnlockedPayload(payload);
              setTheme(payload.settings?.theme || 'light');
              return;
            } catch {
              // Se a senha mestra do cofre salvo divergir, recria cofre de demonstração
            }
          }
          const sample = createSampleSpringFieldPayload();
          const { envelope, sessionDek } = await createEncryptedVaultEnvelope(
            'Rosquinha2026!',
            sample
          );
          await saveEncryptedEnvelopeToIdb(envelope);
          if (!mounted) return;
          sessionDekRef.current = sessionDek;
          setStoredEnvelope(envelope);
          setUnlockedPayload(sample);
          setTheme(sample.settings.theme);
        }
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
      if (!simulatedOffline) {
        setSyncHeadline('☁️ Enviando segredos criptografados...');
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncHeadline('📴 Sem internet? Relaxa, o cofre continua aqui!');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [simulatedOffline]);

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
        setSyncHeadline('📴 Sem internet? Relaxa, o cofre continua aqui!');
        setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);
        return;
      }

      try {
        setIsSyncing(true);
        setSyncHeadline('☁️ Enviando segredos criptografados...');

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
        setSyncHeadline('🍩 Suas rosquinhas estão sincronizadas!');

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
        setPendingSyncCount(syncAdapterRef.current.getPendingQueue().length);
        setSyncHeadline('📴 Sem internet? Relaxa, o cofre continua aqui!');
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

  // Provisiona dispositivo automaticamente ao desbloquear o cofre e conecta ao stream SSE
  useEffect(() => {
    if (!unlockedPayload || !storedEnvelope || !sessionDekRef.current) return;
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

          const registered =
            await syncAdapterRef.current.registerDeviceOnBackend('', {
              userUid: vaultBasedUid,
              email: `${vaultBasedUid}@donutvault.local`,
              deviceName: 'Computador Principal (Setor 7G)',
              platform: 'desktop-web',
              authMethod: 'webauthn-passkey',
            });
          if (cancelled) return;
          currentAuth = {
            userUid: vaultBasedUid,
            deviceId: registered.device.deviceId,
            sessionToken: registered.sessionToken,
          };
          setSyncAuthSession(currentAuth);
          setAuthorizedDevices([registered.device]);

          // Enfileira os registros iniciais se o servidor ainda estiver no cursor 0
          if (
            serverCursorRef.current === 0 &&
            syncAdapterRef.current.getPendingQueue().length === 0 &&
            sessionDekRef.current
          ) {
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
  }, [Boolean(unlockedPayload), storedEnvelope?.vaultId]);

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
      setSyncHeadline('📴 Sem internet? Relaxa, o cofre continua aqui!');
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

  // Handlers de Autenticação / Criptografia Inicial
  const handleCreateVault = async (
    masterPassword: string,
    vaultName: string,
    includeSampleData: boolean
  ) => {
    const basePayload: VaultPayload = includeSampleData
      ? createSampleSpringFieldPayload()
      : {
          version: 1,
          vaultId: CryptoEngine.randomId('vault'),
          revision: 1,
          vaultName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          credentials: [],
          notes: [],
          settings: {
            autoLockMinutes: 5,
            theme: 'light' as const,
          },
        };

    basePayload.vaultName = vaultName;
    const { envelope, sessionDek } = await createEncryptedVaultEnvelope(
      masterPassword,
      basePayload
    );
    await saveEncryptedEnvelopeToIdb(envelope);
    sessionDekRef.current = sessionDek;
    setStoredEnvelope(envelope);
    setUnlockedPayload(basePayload);
    setTheme(basePayload.settings.theme);
    setActiveTab('dashboard');
    triggerComicToast(
      'WOO-HOO!',
      'Cofre criado e blindado com Argon2id + AES-256-GCM!',
      'success'
    );
  };

  const handleUnlockVault = async (masterPassword: string) => {
    if (!storedEnvelope) {
      throw new Error('Nenhum cofre encontrado neste navegador.');
    }
    const { payload, sessionDek } = await unlockEncryptedVaultEnvelope(
      storedEnvelope,
      masterPassword
    );
    sessionDekRef.current = sessionDek;
    setUnlockedPayload(payload);
    setTheme(payload.settings?.theme || 'light');
    setActiveTab('dashboard');
    triggerComicToast(
      'ABERTO!',
      'Cofre de Springfield desbloqueado com sucesso!',
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
        'Backup criptografado mesclado sem perda de dados existentes!',
        'success'
      );
      return;
    }

    await saveEncryptedEnvelopeToIdb(validatedEnvelope);
    if (sessionDekRef.current) {
      zeroizeBuffer(sessionDekRef.current);
    }
    sessionDekRef.current = importedDek;
    setStoredEnvelope(validatedEnvelope);
    setUnlockedPayload(importedPayload);
    setTheme(importedPayload.settings?.theme || 'light');
    setActiveTab('dashboard');
    triggerComicToast(
      'RESTAURADO!',
      'Backup criptografado validado via SHA-256 e restaurado!',
      'success'
    );
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
      'Arquivo .donutvault.json exportado com assinatura SHA-256!',
      'success'
    );
  };

  // Relatório de auditoria calculado em tempo real
  const auditReport = useMemo(
    () => runVaultSecurityAudit(unlockedPayload?.credentials || []),
    [unlockedPayload?.credentials]
  );

  // Handlers de Pareamento e Gerenciamento do Dashboard de Sincronização (§5 e §8)
  const handleAuthorizeNewDevice = async (params: {
    deviceName: string;
    platform: 'desktop-web' | 'mobile-web' | 'ios' | 'android';
    authMethod: 'webauthn-passkey' | 'firebase-oauth' | 'session-token';
  }) => {
    try {
      const res = await syncAdapterRef.current.registerDeviceOnBackend(
        '',
        {
          userUid: accountUid,
          email: `${accountUid}@donutvault.local`,
          deviceName: params.deviceName,
          platform: params.platform,
          authMethod: params.authMethod,
        },
        syncAuthSession
          ? {
              deviceId: syncAuthSession.deviceId,
              sessionToken: syncAuthSession.sessionToken,
            }
          : undefined
      );
      setAuthorizedDevices((prev) => [res.device, ...prev]);
      setSyncHeadline('🔐 Novo dispositivo autorizado!');
      triggerComicToast(
        'PAREADO!',
        '🔐 Novo dispositivo autorizado!',
        'success',
        `O aparelho "${res.device.deviceName}" agora pode baixar registros criptografados.`
      );
    } catch (err) {
      triggerComicToast(
        'D’OH!',
        err instanceof Error ? err.message : 'Erro ao autorizar dispositivo.',
        'danger'
      );
    }
  };

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
        'Sessão do dispositivo revogada no servidor!',
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

  const handleGenerateEmergencyKit = async () => {
    if (!storedEnvelope || !sessionDekRef.current) return;
    try {
      const nextRecoveryVersion =
        (emergencyKit?.recoveryMetadata?.recoveryKeyVersion || 0) + 1;
      const kit =
        await DeviceSecurityModel.generateVerifiedCryptographicEmergencyKit({
          sessionDek: sessionDekRef.current,
          vaultId: storedEnvelope.vaultId,
          accountIdentifier: `${accountUid}@donutvault.local`,
          keyEpoch: storedEnvelope.keyEpoch || 1,
          recoveryKeyVersion: nextRecoveryVersion,
          kdfProfile: storedEnvelope.kdfParams,
        });
      setEmergencyKit(kit);

      if (kit.recoveryMetadata && syncAuthSession && effectiveOnline) {
        await fetch('/api/v1/sync/vault/recovery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${syncAuthSession.sessionToken}`,
            'X-Device-Id': syncAuthSession.deviceId,
            'X-User-Uid': syncAuthSession.userUid,
          },
          body: JSON.stringify({
            vaultId: storedEnvelope.vaultId,
            recoveryKeyVersion: kit.recoveryMetadata.recoveryKeyVersion,
            recoverySaltHex: kit.recoveryMetadata.recoverySaltHex,
            recoveryWrappedDekHex: kit.recoveryMetadata.recoveryWrappedDekHex,
            recoveryDekNonceHex: kit.recoveryMetadata.recoveryDekNonceHex,
            recoveryKeyCommitmentSha256:
              kit.recoveryMetadata.recoveryKeyCommitmentSha256,
          }),
        }).catch(() => undefined);
      }

      triggerComicToast(
        'KIT GERADO!',
        'Kit de Emergência com Chave de Recuperação de 256 bits e DEK encapsulada criado localmente!',
        'success'
      );
    } catch (err) {
      triggerComicToast(
        'ERRO!',
        err instanceof Error
          ? err.message
          : 'Erro ao gerar Kit de Emergência criptográfico.',
        'danger'
      );
    }
  };

  const handleSignInGoogle = async () => {
    try {
      const { user } = await signInWithGooglePopup();
      setAccountUid(user.uid);
      triggerComicToast(
        'AUTENTICADO!',
        `Conta Google (${user.email || user.uid}) conectada com sucesso!`,
        'success'
      );
    } catch {
      triggerComicToast(
        'INFO',
        'Mantendo autenticação local por Passkey/Token de Sessão.',
        'info'
      );
    }
  };

  const syncDashboardProps: SyncDashboardProps = {
    isOnline: effectiveOnline,
    isSyncing,
    syncHeadline,
    pendingCount: pendingSyncCount,
    conflictsCount,
    lastSyncedAt,
    serverCursor,
    currentDeviceId: syncAuthSession?.deviceId || null,
    accountUid,
    devices: authorizedDevices,
    emergencyKit,
    onManualSync: async () => {
      await executeIncrementalSync();
      triggerComicToast(
        'SYNC!',
        '🍩 Suas rosquinhas estão sincronizadas!',
        'success'
      );
    },
    onToggleSimulatedOffline: () => {
      setSimulatedOffline((prev) => {
        const next = !prev;
        if (next) {
          setSyncHeadline('📴 Sem internet? Relaxa, o cofre continua aqui!');
          triggerComicToast(
            'OFFLINE!',
            '📴 Sem internet? Relaxa, o cofre continua aqui!',
            'warning'
          );
        } else {
          setSyncHeadline('☁️ Enviando segredos criptografados...');
          setTimeout(() => {
            executeIncrementalSync();
          }, 80);
        }
        return next;
      });
    },
    onAuthorizeNewDevice: handleAuthorizeNewDevice,
    onRevokeDevice: handleRevokeDevice,
    onGenerateEmergencyKit: handleGenerateEmergencyKit,
    onSignInGoogle: handleSignInGoogle,
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
        onImportBackupFile={handleImportBackup}
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
                  <span className="truncate">{item.label}</span>
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
              Visão Geral
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className="hover:text-pink cursor-pointer whitespace-nowrap"
            >
              Gerador CSPRNG
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
                <span>{item.label}</span>
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
                const { envelope: rotatedEnvelope, sessionDek: newDek } =
                  await rotateMasterPassword(
                    storedEnvelope,
                    currentPwd,
                    newPwd,
                    unlockedPayload
                  );
                await saveEncryptedEnvelopeToIdb(rotatedEnvelope);
                if (sessionDekRef.current) {
                  zeroizeBuffer(sessionDekRef.current);
                }
                sessionDekRef.current = newDek;
                setStoredEnvelope(rotatedEnvelope);
                triggerComicToast(
                  'BLINDADO!',
                  'Senha Mestra rotacionada com novo salt Argon2id!',
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
