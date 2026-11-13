import {
  AlertTriangle,
  Cloud,
  Monitor,
  RefreshCw,
  Smartphone,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './ui/card';
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
  syncEnabled: boolean;
  onToggleSync: (enabled: boolean) => Promise<void>;
  isOnline: boolean;
  isSyncing: boolean;
  syncHeadline: string;
  pendingCount: number;
  conflictsCount: number;
  lastSyncedAt: string | null;
  currentDeviceId: string | null;
  devices: SyncDeviceViewItem[];
  onManualSync: () => Promise<void>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
  // Versão resumida (painel inicial): só o status, sem a lista de aparelhos.
  compact?: boolean;
}

const cardClassName =
  'bg-surface-subtle border border-line ';

function isMobilePlatform(platform: string): boolean {
  return platform.includes('mobile') || platform === 'ios' || platform === 'android';
}

export function SyncDashboardPanel({
  syncEnabled,
  onToggleSync,
  isOnline,
  isSyncing,
  syncHeadline,
  pendingCount,
  conflictsCount,
  lastSyncedAt,
  currentDeviceId,
  devices,
  onManualSync,
  onRevokeDevice,
  compact = false,
}: SyncDashboardProps) {
  const activeDevices = devices.filter((d) => !d.revokedAt);

  if (!syncEnabled) {
    return (
      <Card data-testid="sync-dashboard-panel" className={cardClassName}>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Cloud className="w-5 h-5 text-accent " />
            <CardTitle className="text-lg sm:text-xl">Sincronização desligada</CardTitle>
            <ComicActionCallout text="SÓ NESTE NAVEGADOR" tone="yellow" />
          </div>
          <CardDescription className="text-xs font-bold text-muted ">
            Seu cofre está guardado só neste navegador. Ao ativar, o servidor passa a guardar
            uma cópia cifrada: os registros e a chave do cofre, protegida pela sua Senha Mestra.
            Ele não lê nada sem ela, mas uma senha fraca pode ser quebrada por quem tiver acesso
            ao banco de dados.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void onToggleSync(true)}
          >
            <Cloud className="w-4 h-4" />
            <span>Ativar sincronização</span>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card data-testid="sync-dashboard-panel" className={cardClassName}>
      <CardHeader className="border-b border-line">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Cloud className="w-5 h-5 text-accent " />
              <CardTitle className="text-lg sm:text-xl">Sincronização</CardTitle>
              <ComicActionCallout
                text={!isOnline ? 'SEM CONEXÃO' : isSyncing ? 'SINCRONIZANDO…' : 'ATIVA'}
                tone={!isOnline ? 'yellow' : isSyncing ? 'sky' : 'emerald'}
              />
            </div>
            <CardDescription className="text-xs font-bold text-muted ">
              Seus registros são cifrados neste aparelho antes de sair. O servidor guarda só
              dados cifrados e não consegue ler suas senhas nem suas notas.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isSyncing || !isOnline}
              onClick={onManualSync}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sincronizar agora</span>
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="xs"
              onClick={() => void onToggleSync(false)}
              aria-label="Desativar a sincronização com o servidor"
            >
              <span>Desativar</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-4">
        <ComicSpeechBubble
          speaker="STATUS"
          tone={!isOnline ? 'yellow' : conflictsCount > 0 ? 'pink' : 'white'}
          tailDirection="none"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p
                data-testid="sync-status-headline"
                className="font-display text-sm sm:text-base font-extrabold text-foreground flex items-center gap-1.5"
              >
                {!isOnline && <WifiOff className="w-4 h-4 shrink-0 text-warning" />}
                <span>{syncHeadline}</span>
              </p>
              <p className="text-xs font-bold text-muted mt-0.5">
                {lastSyncedAt
                  ? `Última sincronização: ${new Date(lastSyncedAt).toLocaleTimeString('pt-BR')}`
                  : 'Ainda não sincronizado'}
              </p>
            </div>

            {conflictsCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-base bg-danger/15 border border-line text-xs font-semibold text-danger ">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {conflictsCount === 1
                    ? '1 conflito guardado, nada se perdeu'
                    : `${conflictsCount} conflitos guardados, nada se perdeu`}
                </span>
              </div>
            )}
          </div>
        </ComicSpeechBubble>

        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-base bg-surface-raised border border-line text-foreground ">
            <span className="font-semibold uppercase opacity-80 block">Na fila</span>
            <span
              data-testid="sync-pending-count"
              className="font-display text-xl font-extrabold mt-1 block tabular-nums"
            >
              {pendingCount}
            </span>
          </div>
          <div className="p-3 rounded-base bg-surface-raised border border-line text-foreground ">
            <span className="font-semibold uppercase opacity-80 block">Aparelhos</span>
            <span
              data-testid="sync-devices-count"
              className="font-display text-xl font-extrabold mt-1 block tabular-nums"
            >
              {activeDevices.length}
            </span>
          </div>
          <div className="p-3 rounded-base bg-surface-raised border border-line text-foreground ">
            <span className="font-semibold uppercase opacity-80 block">Conflitos</span>
            <span className="font-display text-xl font-extrabold mt-1 block tabular-nums">
              {conflictsCount}
            </span>
          </div>
        </div>

        {!compact && (
          <div className="p-4 rounded-base bg-surface-raised border border-line space-y-3">
            <h3 className="font-display text-sm font-extrabold flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-accent" />
              <span>Aparelhos conectados ({activeDevices.length})</span>
            </h3>

            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {devices.map((dev) => {
                const isCurrent = dev.deviceId === currentDeviceId;
                const isRevoked = Boolean(dev.revokedAt);
                return (
                  <div
                    key={dev.deviceId}
                    className={`p-2.5 rounded-base border border-line flex items-center justify-between gap-2 text-xs ${
                      isRevoked
                        ? 'bg-surface-subtle opacity-65'
                        : 'bg-secondary-background'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isMobilePlatform(dev.platform) ? (
                        <Smartphone className="w-4 h-4 text-accent shrink-0" />
                      ) : (
                        <Monitor className="w-4 h-4 text-accent shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-extrabold truncate">
                          {dev.deviceName}{' '}
                          {isCurrent && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-current text-accent ml-1">
                              ESTE APARELHO
                            </span>
                          )}
                          {isRevoked && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-destructive text-destructive-foreground border border-line ml-1">
                              REVOGADO
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] font-semibold text-muted truncate">
                          {isMobilePlatform(dev.platform) ? 'Celular' : 'Computador'} · conectado
                          em {new Date(dev.authorizedAt).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                    </div>

                    {!isRevoked && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="xs"
                        onClick={() => onRevokeDevice(dev.deviceId)}
                        aria-label={`Revogar o aparelho ${dev.deviceName}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revogar</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] font-semibold text-muted leading-snug">
              Revogar um aparelho bloqueia as próximas sincronizações dele na hora. O que ele já
              tinha baixado continua guardado nele, cifrado.
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="border-t border-line text-[11px] font-bold text-muted flex flex-wrap justify-between gap-2">
        <span>O servidor vê só quando você sincroniza e o tamanho dos dados cifrados.</span>
        <span>A sincronização não substitui um backup exportado.</span>
      </CardFooter>
    </Card>
  );
}
