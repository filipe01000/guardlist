import React, { useState } from 'react';
import {
  Cloud,
  Wifi,
  WifiOff,
  RefreshCw,
  Smartphone,
  Monitor,
  ShieldCheck,
  AlertTriangle,
  KeyRound,
  Plus,
  Trash2,
  Download,
  Copy,
  Check,
  Lock,
} from 'lucide-react';
import type { EmergencyKitDocument } from '../services/DeviceSecurityModel';
import { Button } from './ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './ui/card';
import { Input } from './ui/input';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';

export interface SyncDeviceViewItem {
  deviceId: string;
  userUid: string;
  deviceName: string;
  platform: string;
  authMethod: string;
  authorizedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface SyncDashboardProps {
  isOnline: boolean;
  isSyncing: boolean;
  syncHeadline: string;
  pendingCount: number;
  conflictsCount: number;
  lastSyncedAt: string | null;
  serverCursor: number;
  currentDeviceId: string | null;
  accountUid: string;
  devices: SyncDeviceViewItem[];
  emergencyKit: EmergencyKitDocument | null;
  onManualSync: () => Promise<void>;
  onToggleSimulatedOffline: () => void;
  onAuthorizeNewDevice: (params: {
    deviceName: string;
    platform: 'desktop-web' | 'mobile-web' | 'ios' | 'android';
    authMethod: 'webauthn-passkey' | 'firebase-oauth' | 'session-token';
  }) => Promise<void>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
  onGenerateEmergencyKit: () => void;
  onSignInGoogle?: () => Promise<void>;
  compact?: boolean;
}

export function SyncDashboardPanel({
  isOnline,
  isSyncing,
  syncHeadline,
  pendingCount,
  conflictsCount,
  lastSyncedAt,
  serverCursor,
  currentDeviceId,
  accountUid,
  devices,
  emergencyKit,
  onManualSync,
  onToggleSimulatedOffline,
  onAuthorizeNewDevice,
  onRevokeDevice,
  onGenerateEmergencyKit,
  onSignInGoogle,
  compact = false,
}: SyncDashboardProps) {
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDevicePlatform, setNewDevicePlatform] = useState<
    'desktop-web' | 'mobile-web' | 'ios' | 'android'
  >('mobile-web');
  const [newDeviceAuthMethod, setNewDeviceAuthMethod] = useState<
    'webauthn-passkey' | 'firebase-oauth' | 'session-token'
  >('webauthn-passkey');
  const [showPairForm, setShowPairForm] = useState(false);
  const [copiedKit, setCopiedKit] = useState(false);

  const activeDevices = devices.filter((d) => !d.revokedAt);

  const handlePairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDeviceName.trim();
    if (!trimmed) return;
    await onAuthorizeNewDevice({
      deviceName: trimmed,
      platform: newDevicePlatform,
      authMethod: newDeviceAuthMethod,
    });
    setNewDeviceName('');
    setShowPairForm(false);
  };

  const handleDownloadEmergencyKit = () => {
    if (!emergencyKit) return;
    const blob = new Blob([JSON.stringify(emergencyKit, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `donutvault-emergency-kit-${emergencyKit.vaultId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopySecretKey = async () => {
    if (!emergencyKit) return;
    try {
      await navigator.clipboard.writeText(
        emergencyKit.recoveryKey || emergencyKit.secretKey
      );
      setCopiedKit(true);
      setTimeout(() => setCopiedKit(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <Card
      data-testid="sync-dashboard-panel"
      className="bg-[#E0F2FE]/85 dark:bg-slate-900 border-4 border-border shadow-[6px_6px_0px_0px_var(--border)]"
    >
      <CardHeader className="border-b-3 border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Cloud className="w-5 h-5 text-[#0284C7] dark:text-sky" />
              <CardTitle className="text-lg sm:text-xl">
                Sincronização Zero-Knowledge (PC & Celular)
              </CardTitle>
              <ComicActionCallout
                text={
                  !isOnline
                    ? 'MODO OFFLINE'
                    : isSyncing
                      ? 'SINCRONIZANDO...'
                      : 'E2EE ATIVO'
                }
                tone={!isOnline ? 'yellow' : isSyncing ? 'sky' : 'emerald'}
              />
            </div>
            <CardDescription className="text-xs font-bold text-stone-700 dark:text-slate-300">
              Seus registros são criptografados com AES-256-GCM + HKDF antes de sair do dispositivo. O servidor PostgreSQL jamais enxerga suas senhas ou notas.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant={isOnline ? 'emerald' : 'neutral'}
              size="xs"
              onClick={onToggleSimulatedOffline}
              aria-label="Alternar modo de conexão online ou offline"
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isSyncing || !isOnline}
              onClick={onManualSync}
            >
              <RefreshCw
                className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`}
              />
              <span>Sincronizar Agora</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        {/* Balão de Status com as Mensagens Divertidas do Barnaby (§8) */}
        <ComicSpeechBubble
          speaker="CENTRAL DE SINCRONIZAÇÃO"
          tone={!isOnline ? 'yellow' : conflictsCount > 0 ? 'pink' : 'white'}
          tailDirection="none"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p
                data-testid="sync-status-headline"
                className="font-display text-sm sm:text-base font-black text-foreground"
              >
                {syncHeadline}
              </p>
              <p className="text-xs font-bold text-stone-600 dark:text-slate-300 mt-0.5">
                Última sincronização:{' '}
                {lastSyncedAt
                  ? new Date(lastSyncedAt).toLocaleTimeString('pt-BR')
                  : 'Aguardando primeira sincronização'}{' '}
                · Cursor E2EE: #{serverCursor}
              </p>
            </div>

            {conflictsCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-base bg-rose-200 dark:bg-rose-950 border-2 border-border text-xs font-black text-rose-950 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{conflictsCount} conflito(s) preservado(s) sem perda!</span>
              </div>
            )}
          </div>
        </ComicSpeechBubble>

        {/* 4 Indicadores Operacionais do Dashboard de Sincronização */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-base bg-white dark:bg-slate-800 border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
            <span className="font-black uppercase text-stone-600 dark:text-slate-400 block">
              CONEXÃO
            </span>
            <span className="font-display text-base font-black mt-1 flex items-center gap-1.5">
              {isOnline ? (
                <>
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  <span>Conectado (TLS)</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4 text-amber-600" />
                  <span>Fila Offline</span>
                </>
              )}
            </span>
          </div>

          <div className="p-3 rounded-base bg-[#FEF08A] dark:bg-slate-800 border-3 border-border shadow-[2px_2px_0px_0px_var(--border)] text-[#09090B] dark:text-white">
            <span className="font-black uppercase opacity-80 block">
              ALTERAÇÕES PENDENTES
            </span>
            <span
              data-testid="sync-pending-count"
              className="font-display text-xl font-black mt-1 block tabular-nums"
            >
              {pendingCount}
            </span>
          </div>

          <div className="p-3 rounded-base bg-[#DCFCE7] dark:bg-slate-800 border-3 border-border shadow-[2px_2px_0px_0px_var(--border)] text-[#09090B] dark:text-white">
            <span className="font-black uppercase opacity-80 block">
              DISPOSITIVOS ATIVOS
            </span>
            <span
              data-testid="sync-devices-count"
              className="font-display text-xl font-black mt-1 block tabular-nums"
            >
              {activeDevices.length}
            </span>
          </div>

          <div className="p-3 rounded-base bg-[#FCE7F3] dark:bg-slate-800 border-3 border-border shadow-[2px_2px_0px_0px_var(--border)] text-[#09090B] dark:text-white">
            <span className="font-black uppercase opacity-80 block">
              ALERTAS DE CONFLITO
            </span>
            <span className="font-display text-xl font-black mt-1 block tabular-nums">
              {conflictsCount}
            </span>
          </div>
        </div>

        {/* Gerenciamento e Pareamento de Dispositivos + Kit de Emergência (exibido completo ou sob demanda) */}
        {!compact && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
            {/* Lista de Dispositivos Autorizados (7 cols) */}
            <div className="lg:col-span-7 p-4 rounded-base bg-white dark:bg-slate-800 border-3 border-border space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-black flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-[#0284C7]" />
                    <span>Dispositivos Autorizados ({activeDevices.length})</span>
                  </h3>
                  <p className="text-[11px] font-semibold text-stone-600 dark:text-slate-400">
                    Conta autenticada: <code className="font-mono">{accountUid}</code>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {onSignInGoogle && (
                    <Button
                      type="button"
                      variant="neutral"
                      size="xs"
                      onClick={onSignInGoogle}
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Login Google OAuth</span>
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="pink"
                    size="xs"
                    onClick={() => setShowPairForm((s) => !s)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Parear Dispositivo</span>
                  </Button>
                </div>
              </div>

              {showPairForm && (
                <form
                  onSubmit={handlePairSubmit}
                  className="p-3 rounded-base bg-[#FEF08A]/50 dark:bg-slate-900 border-2 border-border space-y-2.5 text-xs"
                >
                  <p className="font-extrabold">
                    🔐 Autorizar Novo Computador ou Celular (Sem transmitir DEK/Senha Mestra)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input
                      type="text"
                      value={newDeviceName}
                      onChange={(e) => setNewDeviceName(e.target.value)}
                      placeholder="Ex: Celular DonutPhone"
                      aria-label="Nome do novo dispositivo"
                      required
                    />
                    <select
                      aria-label="Plataforma do dispositivo"
                      value={newDevicePlatform}
                      onChange={(e) =>
                        setNewDevicePlatform(
                          e.target.value as
                            | 'desktop-web'
                            | 'mobile-web'
                            | 'ios'
                            | 'android'
                        )
                      }
                      className="h-10 px-2 font-extrabold bg-white dark:bg-slate-800 border-3 border-border rounded-base"
                    >
                      <option value="mobile-web">Celular (PWA Mobile)</option>
                      <option value="desktop-web">Computador (Desktop)</option>
                      <option value="android">Android</option>
                      <option value="ios">iPhone / iOS</option>
                    </select>
                    <select
                      aria-label="Método de autenticação da conta"
                      value={newDeviceAuthMethod}
                      onChange={(e) =>
                        setNewDeviceAuthMethod(
                          e.target.value as
                            | 'webauthn-passkey'
                            | 'firebase-oauth'
                            | 'session-token'
                        )
                      }
                      className="h-10 px-2 font-extrabold bg-white dark:bg-slate-800 border-3 border-border rounded-base"
                    >
                      <option value="webauthn-passkey">WebAuthn / Passkey</option>
                      <option value="firebase-oauth">Google OAuth 2.0</option>
                      <option value="session-token">Token de Sessão</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="neutral"
                      size="xs"
                      onClick={() => setShowPairForm(false)}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" variant="emerald" size="xs">
                      Confirmar Pareamento Seguro
                    </Button>
                  </div>
                </form>
              )}

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {devices.map((dev) => {
                  const isCurrent = dev.deviceId === currentDeviceId;
                  const isRevoked = Boolean(dev.revokedAt);
                  return (
                    <div
                      key={dev.deviceId}
                      className={`p-2.5 rounded-base border-2 border-border flex items-center justify-between gap-2 text-xs ${
                        isRevoked
                          ? 'bg-stone-200/70 dark:bg-slate-900 opacity-65'
                          : 'bg-secondary-background'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {dev.platform.includes('mobile') ||
                        dev.platform === 'ios' ||
                        dev.platform === 'android' ? (
                          <Smartphone className="w-4 h-4 text-pink shrink-0" />
                        ) : (
                          <Monitor className="w-4 h-4 text-[#0284C7] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-extrabold truncate">
                            {dev.deviceName}{' '}
                            {isCurrent && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 bg-main text-main-foreground border border-border ml-1">
                                ESTE APARELHO
                              </span>
                            )}
                            {isRevoked && (
                              <span className="text-[10px] font-black px-1.5 py-0.5 bg-rose-500 text-white border border-border ml-1">
                                REVOGADO
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] font-semibold text-stone-600 dark:text-slate-400 truncate">
                            {dev.platform} · {dev.authMethod}
                          </p>
                        </div>
                      </div>

                      {!isRevoked && (
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          onClick={() => onRevokeDevice(dev.deviceId)}
                          aria-label={`Revogar dispositivo ${dev.deviceName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revogar</span>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] font-semibold text-stone-600 dark:text-slate-400 leading-snug">
                Nota de segurança: Revogar um dispositivo bloqueia imediatamente novas sincronizações (HTTP 401), mas não garante o apagamento remoto de cópias criptografadas que já estavam armazenadas localmente naquele aparelho.
              </p>
            </div>

            {/* Kit de Emergência e Secret Key de 128 bits (5 cols) */}
            <div className="lg:col-span-5 p-4 rounded-base bg-white dark:bg-slate-800 border-3 border-border flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <h3 className="font-display text-sm font-black flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-pink" />
                  <span>Kit de Emergência & Pareamento Independente</span>
                </h3>
                <p className="text-xs font-semibold text-stone-600 dark:text-slate-300 leading-relaxed">
                  Ao adicionar um novo celular ou computador, ele baixa apenas os registros criptografados do PostgreSQL e exige sua Senha Mestra localmente. Nunca usamos QR Code com a chave DEK em texto puro!
                </p>

                {emergencyKit ? (
                  <div className="p-3 rounded-base bg-[#FEF08A] text-[#09090B] border-2 border-border space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-black uppercase text-[11px]">
                        Chave de Recuperação Independente (256-bit):
                      </p>
                      {emergencyKit.recoveryMetadata && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 bg-emerald-600 text-white border border-border">
                          DEK Encapsulada v{emergencyKit.recoveryMetadata.recoveryKeyVersion}
                        </span>
                      )}
                    </div>
                    <p
                      data-testid="emergency-recovery-key"
                      className="font-mono font-black text-[11px] break-all bg-white p-2 border border-border"
                    >
                      {emergencyKit.recoveryKey || emergencyKit.secretKey}
                    </p>
                    <p className="text-[10px] font-bold text-stone-700">
                      Secret Key 2FA (128-bit):{' '}
                      <code className="font-mono">{emergencyKit.secretKey}</code>
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        onClick={handleCopySecretKey}
                      >
                        {copiedKit ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Copiada!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar Recovery Key</span>
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="sky"
                        size="xs"
                        onClick={handleDownloadEmergencyKit}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Baixar Kit (.json)</span>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-base bg-secondary-background border-2 border-border text-xs font-semibold">
                    Gere seu Kit de Emergência para encapsular uma cópia de recuperação da DEK com chave independente de 256 bits fora do servidor.
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="pink"
                size="sm"
                onClick={onGenerateEmergencyKit}
                className="w-full"
              >
                <Lock className="w-4 h-4" />
                <span>
                  {emergencyKit
                    ? 'Regerar Kit de Emergência'
                    : 'Gerar Kit de Emergência Seguro'}
                </span>
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t-3 border-border text-[11px] font-bold text-stone-700 dark:text-slate-300 flex flex-wrap justify-between gap-2">
        <span>
          Metadados observáveis pelo servidor: timestamps de sincronização, tamanho dos ciphertexts, revisões e IDs opacos.
        </span>
        <span>
          Sincronização não substitui backups criptografados externos.
        </span>
      </CardFooter>
    </Card>
  );
}
