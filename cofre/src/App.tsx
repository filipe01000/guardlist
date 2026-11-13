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
import { mergeRemoteRecords } from './utils/syncMerge';
import {
  loadStrengthEngine,
  useStrengthEngineReady,
} from './utils/strengthEngine';
import { AmbientBackground } from './components/AmbientBackground';
import { BrandMark } from './components/BrandMark';
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

// Token de reconexão do cofre (CryptoEngine.deriveVaultReauthToken). Sem segredo, ou com um
// segredo ilegível, segue sem a prova.
function deriveReauthTokenFor(
  payload: VaultPayload,
  vaultId: string
): string | undefined {
  const secret = payload.settings?.syncReauthSecretHex;
  if (!secret) return undefined;
  try {
    return CryptoEngine.deriveVaultReauthToken(secret, vaultId);
  } catch {
    return undefined;
  }
}

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [storedEnvelope, setStoredEnvelope] =
    useState<EncryptedVaultEnvelope | null>(null);
  const [unlockedPayload, setUnlockedPayload] = useState<VaultPayload | null>(
    null
  );
  const sessionDekRef = useRef<Uint8Array | null>(null);
  // Cópias sempre atuais do cofre aberto. O aviso do SSE chama a versão da sincronização guardada
  // no desbloqueio; lendo daqui, ela não grava por cima de alterações feitas depois.
  const unlockedPayloadRef = useRef<VaultPayload | null>(unlockedPayload);
  const storedEnvelopeRef = useRef<EncryptedVaultEnvelope | null>(storedEnvelope);
  unlockedPayloadRef.current = unlockedPayload;
  storedEnvelopeRef.current = storedEnvelope;

  // O medidor de força de senha (zxcvbn) vem num arquivo à parte. Ele começa a carregar assim que
  // o app abre; abrir, criar ou importar um cofre espera por ele antes de mostrar o painel.
  const strengthReady = useStrengthEngineReady();
  useEffect(() => {
    void loadStrengthEngine().catch(() => undefined);
  }, []);

  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newCredentialModalOpen, setNewCredentialModalOpen] = useState(false);
  const [prefilledPassword, setPrefilledPassword] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
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
      const activeEnvelope = customEnvelope || storedEnvelopeRef.current;
      const activePayload = customPayload || unlockedPayloadRef.current;
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
          vaultReauthToken: deriveReauthTokenFor(activePayload, vaultId),
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

        // Registros novos de outros aparelhos (ex.: celular) entram no cofre local sem perda. A base
        // é o cofre mais recente, não o do início desta função: ele pode ter mudado enquanto os
        // pedidos iam e voltavam do servidor (e, no aviso do SSE, esta função é a do desbloqueio).
        if (
          pullOutcome.decryptedCredentials.length > 0 ||
          pullOutcome.decryptedNotes.length > 0
        ) {
          const basePayload = unlockedPayloadRef.current;
          const baseEnvelope = storedEnvelopeRef.current;
          const currentDek = sessionDekRef.current;
          if (
            basePayload &&
            baseEnvelope &&
            currentDek &&
            (baseEnvelope.vaultId || basePayload.vaultId) === vaultId
          ) {
            const mergedPayload = mergeRemoteRecords(
              basePayload,
              pullOutcome.decryptedCredentials,
              pullOutcome.decryptedNotes
            );
            if (mergedPayload) {
              const reencryptedEnvelope = await updateEncryptedVaultPayload(
                baseEnvelope,
                currentDek,
                mergedPayload
              );
              await saveEncryptedEnvelopeToIdb(reencryptedEnvelope);
              storedEnvelopeRef.current = reencryptedEnvelope;
              unlockedPayloadRef.current = mergedPayload;
              setStoredEnvelope(reencryptedEnvelope);
              setUnlockedPayload(mergedPayload);
            }
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
          const vaultReauthToken = deriveReauthTokenFor(
            unlockedPayload,
            storedEnvelope.vaultId || unlockedPayload.vaultId
          );
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

        // Sem cofre explícito: a função lê o cofre mais recente.
        await executeIncrementalSync(currentAuth);

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
    const baseEnvelope = storedEnvelopeRef.current || storedEnvelope;
    if (!baseEnvelope || !sessionDekRef.current) {
      throw new Error('Sessão do cofre bloqueada.');
    }
    const updatedPayload: VaultPayload = {
      ...nextPayload,
      updatedAt: new Date().toISOString(),
    };
    const nextEnvelope = await updateEncryptedVaultPayload(
      baseEnvelope,
      sessionDekRef.current,
      updatedPayload
    );
    await saveEncryptedEnvelopeToIdb(nextEnvelope);
    storedEnvelopeRef.current = nextEnvelope;
    unlockedPayloadRef.current = updatedPayload;
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
    await loadStrengthEngine().catch(() => undefined);
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
        theme: 'dark',
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
    await loadStrengthEngine().catch(() => undefined);
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
    setTheme(payload.settings?.theme || 'dark');
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
    await loadStrengthEngine().catch(() => undefined);

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
    setTheme(importedPayload.settings?.theme || 'dark');
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
    // strengthReady: refaz a conta quando o medidor de força termina de carregar.
    [unlockedPayload?.credentials, strengthReady]
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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center space-y-4">
        <BrandMark size={84} spinning={true} />
        <p className="font-display text-xl font-extrabold">
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
    <div className="min-h-screen text-foreground flex flex-col lg:flex-row">
      <AmbientBackground mark={<BrandMark size={640} />} />

      {/* Menu lateral: console de vidro flutuante, como no GuardList */}
      <aside
        aria-label="Menu principal do cofre"
        className="glass hidden lg:flex lg:w-[280px] lg:sticky lg:top-6 lg:m-6 lg:mr-0 lg:max-h-[calc(100dvh-3rem)] lg:self-start shrink-0 rounded-console flex-col justify-between py-5 overflow-y-auto"
      >
        <div>
          {/* Identidade do cofre */}
          <div className="flex items-center gap-3 px-6 pb-4 mb-2.5 border-b border-glass-line">
            <BrandMark size={40} className="shrink-0" />
            <div className="min-w-0">
              <span className="font-display text-lg font-extrabold tracking-tight block truncate">
                DonutVault
              </span>
              <span className="text-xs text-muted block truncate">
                {unlockedPayload.vaultName}
              </span>
            </div>
          </div>

          {/* Navegação com os 9 itens */}
          <nav>
            {SIDEBAR_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full h-11 px-6 text-left text-sm transition-colors flex items-center justify-between cursor-pointer whitespace-nowrap border-l-[3px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 ${
                    isActive
                      ? 'bg-accent-soft text-accent font-semibold border-main'
                      : 'text-muted font-medium border-transparent hover:bg-accent-soft hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-3.5 min-w-0">
                    <item.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.id === 'trash' && trashCount > 0 && (
                    <span className="font-mono text-xs tabular-nums">
                      {trashCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Rodapé do menu: trancar o cofre */}
        <div className="px-4 pt-4 mt-3 border-t border-glass-line">
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

      {/* Conteúdo principal e barra do topo */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topo em 3 zonas: contexto, links rápidos e 1 ação principal */}
        <header className="w-full flex items-center justify-between gap-4 px-5 sm:px-8 pt-6 pb-2">
          {/* Zona 1: menu do celular e título da seção ativa */}
          <div className="flex items-center gap-3 min-w-0">
            <Button
              type="button"
              variant="neutral"
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
            <BrandMark size={32} className="hidden sm:block lg:hidden shrink-0" />
            <span className="font-display text-base sm:text-lg font-extrabold truncate">
              {SIDEBAR_ITEMS.find((i) => i.id === activeTab)?.label}
            </span>
          </div>

          {/* Zona 2: links rápidos no desktop */}
          <nav className="hidden xl:flex items-center gap-6 text-xs font-semibold text-muted">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="hover:text-foreground cursor-pointer whitespace-nowrap"
            >
              Início
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generator')}
              className="hover:text-foreground cursor-pointer whitespace-nowrap"
            >
              Gerador
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('security')}
              className="hover:text-foreground cursor-pointer whitespace-nowrap"
            >
              Saúde (<span className="font-mono tabular-nums">{auditReport.overallScore}%</span>)
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
              className="hover:text-foreground flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5" />
              ) : (
                <Moon className="w-3.5 h-3.5" />
              )}
              <span>{theme === 'dark' ? 'Tema Claro' : 'Tema Escuro'}</span>
            </button>
          </nav>

          {/* Zona 3: 1 ação principal ("Guardar nova senha") */}
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

        {/* Gaveta de navegação do celular */}
        {mobileMenuOpen && (
          <nav
            aria-label="Menu mobile"
            className="glass-strong lg:hidden mx-5 sm:mx-8 mt-2 rounded-surface py-2 overflow-hidden"
          >
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-current={activeTab === item.id ? 'page' : undefined}
                className={`w-full h-11 px-5 text-left text-sm flex items-center justify-between border-l-[3px] cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-accent-soft text-accent font-semibold border-main'
                    : 'text-muted font-medium border-transparent'
                }`}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </span>
              </button>
            ))}
            <div className="px-4 pt-2 pb-2 mt-2 border-t border-glass-line">
              <Button
                type="button"
                variant="destructive"
                onClick={lockVault}
                className="w-full"
              >
                <Lock className="w-4 h-4" />
                <span>Trancar Cofre</span>
              </Button>
            </div>
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
                await loadStrengthEngine().catch(() => undefined);
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
