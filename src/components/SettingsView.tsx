import React, { useState, useRef } from 'react';
import {
  KeyRound,
  Clock,
  Sun,
  Moon,
  Download,
  Upload,
  Trash2,
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Rocket,
} from 'lucide-react';
import type {
  BackupRestoreStrategy,
  EncryptedVaultEnvelope,
} from '../types/vault';
import { Button } from './ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from './ui/card';
import { Input } from './ui/input';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';
import { checkMasterPasswordPolicy } from '../utils/generator';
import {
  SyncDashboardPanel,
  type SyncDashboardProps,
} from './SyncDashboardPanel';

interface SettingsViewProps {
  envelope: EncryptedVaultEnvelope;
  autoLockMinutes: number;
  theme: 'light' | 'dark';
  onUpdateAutoLock: (minutes: number) => Promise<void>;
  onToggleTheme: () => Promise<void>;
  onChangeMasterPassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<void>;
  onExportBackup: () => void;
  onImportBackupInSession: (
    fileJson: string,
    masterPassword: string,
    strategy?: BackupRestoreStrategy
  ) => Promise<void>;
  onDeleteEntireVault: () => Promise<void>;
  onLockNow: () => void;
  syncDashboardProps?: SyncDashboardProps;
}

export function SettingsView({
  envelope,
  autoLockMinutes,
  theme,
  onUpdateAutoLock,
  onToggleTheme,
  onChangeMasterPassword,
  onExportBackup,
  onImportBackupInSession,
  onDeleteEntireVault,
  onLockNow,
  syncDashboardProps,
}: SettingsViewProps) {
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmNewPwd, setConfirmNewPwd] = useState('');
  const [pwdStatus, setPwdStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  const [importPassword, setImportPassword] = useState('');
  const [importJson, setImportJson] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importStrategy, setImportStrategy] =
    useState<BackupRestoreStrategy>('merge');
  const [confirmReplaceBackup, setConfirmReplaceBackup] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [confirmDeleteVault, setConfirmDeleteVault] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdStatus(null);

    const policy = checkMasterPasswordPolicy(newPwd);
    if (!policy.ok) {
      setPwdStatus({ type: 'error', text: policy.reason });
      return;
    }
    if (newPwd !== confirmNewPwd) {
      setPwdStatus({
        type: 'error',
        text: 'A confirmação da nova Senha Mestra não confere.',
      });
      return;
    }

    try {
      setIsRotating(true);
      await onChangeMasterPassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmNewPwd('');
      setPwdStatus({
        type: 'success',
        text: 'WOO-HOO! Senha Mestra alterada com novo salt Argon2id e nova chave DEK!',
      });
    } catch (err) {
      setPwdStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'Erro ao alterar senha mestra.',
      });
    } finally {
      setIsRotating(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportJson(reader.result);
        setImportStatus(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importJson || !importPassword) return;
    if (importStrategy === 'replace' && !confirmReplaceBackup) {
      setImportStatus(
        'Confirme explicitamente antes de substituir os dados existentes do cofre.'
      );
      return;
    }
    try {
      await onImportBackupInSession(
        importJson,
        importPassword,
        importStrategy
      );
      setImportStatus(
        importStrategy === 'merge'
          ? 'Backup validado via SHA-256 e mesclado sem perda de dados existentes!'
          : 'Backup validado via SHA-256 e restaurado substituindo o cofre!'
      );
      setImportPassword('');
      setImportJson('');
      setConfirmReplaceBackup(false);
    } catch (err) {
      setImportStatus(
        err instanceof Error ? err.message : 'Erro ao importar backup.'
      );
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              ⚙️ Configurações & Engenharia do Cofre
            </h1>
            <ComicActionCallout text="SETOR 7G" tone="yellow" />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-slate-400 mt-1">
            Gerencie sua Senha Mestra, bloqueio por inatividade, backups criptografados e tema visual.
          </p>
        </div>

        <Button type="button" variant="sky" onClick={onLockNow}>
          <Lock className="w-4 h-4" />
          <span>Trancar Cofre Agora</span>
        </Button>
      </div>

      {syncDashboardProps && <SyncDashboardPanel {...syncDashboardProps} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Coluna Esquerda: Tema, Bloqueio Automático e Alterar Senha Mestra */}
        <div className="lg:col-span-6 space-y-6">
          <Card>
            <CardHeader className="border-b-3 border-border">
              <CardTitle>Aparência e Bloqueio Automático</CardTitle>
              <CardDescription>
                Personalize a experiência visual e o timer de segurança
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4 pb-4 border-b-2 border-border">
                <div>
                  <p className="font-extrabold text-sm">Tema de Springfield</p>
                  <p className="text-xs font-semibold text-stone-600 dark:text-slate-400">
                    Alterne entre o modo ensolarado diurno e o turno noturno da usina
                  </p>
                </div>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={onToggleTheme}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4" />
                      <span>Modo Claro</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4" />
                      <span>Modo Escuro</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <label
                    htmlFor="autolock-select"
                    className="font-extrabold text-sm flex items-center gap-1.5"
                  >
                    <Clock className="w-4 h-4 text-[#0284C7]" />
                    <span>Bloqueio Automático por Inatividade</span>
                  </label>
                  <p className="text-xs font-semibold text-stone-600 dark:text-slate-400">
                    Limpa a chave DEK da memória RAM quando você se afasta
                  </p>
                </div>

                <select
                  id="autolock-select"
                  value={autoLockMinutes}
                  onChange={(e) => onUpdateAutoLock(Number(e.target.value))}
                  className="h-10 px-3 text-xs font-extrabold bg-background border-3 border-border rounded-base shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer"
                >
                  <option value={1}>1 minuto</option>
                  <option value={5}>5 minutos</option>
                  <option value={15}>15 minutos</option>
                  <option value={30}>30 minutos</option>
                  <option value={60}>1 hora</option>
                </select>
              </div>
            </CardContent>
          </Card>

          {/* Alterar Senha Mestra */}
          <Card>
            <CardHeader className="border-b-3 border-border">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-pink" />
                <CardTitle>Alterar Senha Mestra</CardTitle>
              </div>
              <CardDescription>
                Re-deriva a chave Argon2id com novo salt de 128 bits e rotaciona a DEK
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handlePasswordChangeSubmit} className="space-y-3.5">
                <div>
                  <label htmlFor="curr-master" className="block text-xs font-extrabold uppercase mb-1">
                    Senha Mestra Atual
                  </label>
                  <Input
                    id="curr-master"
                    type="password"
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="new-master" className="block text-xs font-extrabold uppercase mb-1">
                    Nova Senha Mestra
                  </label>
                  <Input
                    id="new-master"
                    type="password"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="conf-new-master" className="block text-xs font-extrabold uppercase mb-1">
                    Confirmar Nova Senha Mestra
                  </label>
                  <Input
                    id="conf-new-master"
                    type="password"
                    value={confirmNewPwd}
                    onChange={(e) => setConfirmNewPwd(e.target.value)}
                    className="font-mono"
                    required
                  />
                </div>

                {pwdStatus && (
                  <ComicSpeechBubble
                    speaker={pwdStatus.type === 'success' ? 'SUCESSO!' : 'ATENÇÃO'}
                    tone={pwdStatus.type === 'success' ? 'mint' : 'danger'}
                    tailDirection="none"
                  >
                    <div className="flex items-center gap-2">
                      {pwdStatus.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{pwdStatus.text}</span>
                    </div>
                  </ComicSpeechBubble>
                )}

                <Button
                  type="submit"
                  variant="default"
                  disabled={isRotating}
                  className="w-full"
                >
                  {isRotating
                    ? 'Re-derivando Argon2id e Re-criptografando...'
                    : 'Atualizar Senha Mestra'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Coluna Direita: Backups Criptografados, Especificações e Exclusão */}
        <div className="lg:col-span-6 space-y-6">
          <Card>
            <CardHeader className="border-b-3 border-border">
              <CardTitle>Backup Criptografado & Recuperação Segura</CardTitle>
              <CardDescription>
                Exporte ou restaure seu envelope (<code className="font-mono">DONUTVAULT_ENCRYPTED_V1</code>) com mesclagem sem perda de dados existentes
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="sky"
                  onClick={onExportBackup}
                >
                  <Download className="w-4 h-4" />
                  <span>Exportar Backup Criptografado (.json)</span>
                </Button>

                <Button
                  type="button"
                  variant="neutral"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4 text-pink" />
                  <span>Importar Backup Criptografado</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.donutvault"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {importJson && (
                <form
                  onSubmit={handleImportSubmit}
                  className="p-4 rounded-base bg-background border-3 border-border space-y-3"
                >
                  <p className="text-xs font-extrabold">
                    Arquivo selecionado: {importFileName}
                  </p>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="restore-strategy"
                      className="block text-xs font-extrabold uppercase"
                    >
                      Modo de Restauração
                    </label>
                    <select
                      id="restore-strategy"
                      value={importStrategy}
                      onChange={(e) => {
                        setImportStrategy(
                          e.target.value as BackupRestoreStrategy
                        );
                        setConfirmReplaceBackup(false);
                      }}
                      className="w-full h-10 px-3 text-xs font-extrabold bg-secondary-background border-3 border-border rounded-base"
                    >
                      <option value="merge">
                        Mesclar com cofre atual (Sem perda de dados existentes)
                      </option>
                      <option value="replace">
                        Substituir cofre inteiro pelo backup
                      </option>
                    </select>
                  </div>

                  {importStrategy === 'replace' && (
                    <label className="flex items-start gap-2 p-2.5 rounded-base bg-rose-100 dark:bg-rose-950/60 border-2 border-border text-xs font-bold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmReplaceBackup}
                        onChange={(e) =>
                          setConfirmReplaceBackup(e.target.checked)
                        }
                        className="mt-0.5 accent-pink"
                      />
                      <span>
                        Confirmo explicitamente que desejo substituir as credenciais e notas atuais por este backup.
                      </span>
                    </label>
                  )}

                  <Input
                    type="password"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Senha Mestra deste arquivo de backup..."
                    className="font-mono"
                    required
                  />
                  <Button type="submit" variant="pink" size="sm">
                    {importStrategy === 'merge'
                      ? 'Validar SHA-256 e Mesclar Sem Perda de Dados'
                      : 'Validar SHA-256 e Substituir Cofre Atual'}
                  </Button>
                </form>
              )}

              {importStatus && (
                <p className="text-xs font-black text-[#0284C7] dark:text-sky">
                  {importStatus}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Especificações Criptográficas Reais */}
          <Card>
            <CardHeader className="border-b-3 border-border">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <CardTitle className="text-lg">
                  Especificações de Segurança e Criptografia Ativas
                </CardTitle>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="text-xs space-y-1.5 font-mono font-bold text-foreground bg-background p-4 rounded-base border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
                <div>
                  Formato: {envelope.format} (v{envelope.version} · Revisão #
                  {envelope.revision ?? 1})
                </div>
                <div className="truncate">
                  Identidade do Cofre (AAD): {envelope.vaultId || 'vault-v1'}
                </div>
                <div>
                  KDF: Argon2id (m={envelope.kdfParams.m} KiB, t={envelope.kdfParams.t}, p={envelope.kdfParams.p}, {envelope.kdfParams.dkLen * 8}-bit)
                </div>
                <div>
                  Cifra Autenticada: Web Crypto API AES-256-GCM (Tag 128-bit + AAD Estruturado)
                </div>
                <div className="truncate">Salt Hex (128-bit): {envelope.saltHex}</div>
                <div className="truncate">Nonce Payload Atual (96-bit): {envelope.payloadNonceHex}</div>
                <div className="truncate">SHA-256 Integridade: {envelope.integritySha256Hex.slice(0, 32)}...</div>
              </div>

              <div className="p-3 rounded-base bg-[#FEF08A]/60 dark:bg-slate-800 border-2 border-border text-[11px] font-semibold text-stone-800 dark:text-slate-200 space-y-1 leading-relaxed">
                <p className="font-black uppercase text-xs">
                  Proteção de Memória & Limitações do Navegador:
                </p>
                <p>
                  As chaves binárias (<code className="font-mono">KEK</code> e{' '}
                  <code className="font-mono">DEK</code> em{' '}
                  <code className="font-mono">Uint8Array</code>) são sobrescritas com zeros (<code className="font-mono">fill(0)</code>) imediatamente após o uso ou bloqueio do cofre. Contudo, em motores JavaScript de navegadores, strings UTF-16 são imutáveis e gerenciadas pelo Garbage Collector (GC), não sendo possível garantir zeramento físico imediato de strings de texto no heap sem extensões nativas.
                </p>
              </div>

              <p className="text-[11px] font-semibold text-stone-600 dark:text-slate-400 leading-relaxed">
                Nota de transparência: Embora o DonutVault implemente primitivas criptográficas reais (Argon2id + AES-256-GCM + CSPRNG sem viés), nenhum software deve ser considerado pronto para guardar credenciais críticas de produção sem passar por uma auditoria de segurança independente.
              </p>
            </CardContent>
          </Card>

          {/* Zona de Perigo: Excluir Cofre */}
          <Card className="bg-rose-100 dark:bg-rose-950/40">
            <CardContent className="space-y-3">
              <h2 className="font-display text-lg font-black text-rose-800 dark:text-rose-300">
                Zona de Perigo Setor 7G
              </h2>
              <p className="text-xs font-semibold text-stone-800 dark:text-slate-200">
                Excluir o cofre apaga permanentemente o envelope criptografado do IndexedDB deste navegador.
              </p>
              {!confirmDeleteVault ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDeleteVault(true)}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Excluir Cofre Permanentemente</span>
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onDeleteEntireVault}
                  >
                    Confirmar Destruição Total do Cofre
                  </Button>
                  <Button
                    type="button"
                    variant="neutral"
                    size="sm"
                    onClick={() => setConfirmDeleteVault(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Seção de Roadmap Futuro */}
      <Card>
        <CardHeader className="border-b-3 border-border">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-pink" />
            <CardTitle>
              Roadmap Futuro do DonutVault (Planejado — Não Implementado na v1.0)
            </CardTitle>
          </div>
          <CardDescription>
            A arquitetura modular de envelopes criptografados do DonutVault já está estruturada para receber nas próximas versões:
          </CardDescription>
        </CardHeader>

        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="p-4 rounded-base bg-[#FEF08A] text-[#09090B] border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
            <p className="font-display font-black text-sm">Extensões Chrome & Firefox</p>
            <p className="font-semibold mt-1">
              Preenchimento automático seguro de credenciais direto nas páginas web.
            </p>
          </div>
          <div className="p-4 rounded-base bg-[#E0F2FE] text-[#09090B] border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
            <p className="font-display font-black text-sm">Passkeys (WebAuthn) & TOTP</p>
            <p className="font-semibold mt-1">
              Suporte futuro a chaves de acesso sem senha e gerador de códigos 2FA.
            </p>
          </div>
          <div className="p-4 rounded-base bg-[#FCE7F3] text-[#09090B] border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
            <p className="font-display font-black text-sm">Apps Android & iOS</p>
            <p className="font-semibold mt-1">
              Desbloqueio biométrico móvel e integração com Autofill nativo.
            </p>
          </div>
          <div className="p-4 rounded-base bg-[#DCFCE7] text-[#09090B] border-3 border-border shadow-[2px_2px_0px_0px_var(--border)]">
            <p className="font-display font-black text-sm">Sincronização E2EE & Cofres</p>
            <p className="font-semibold mt-1">
              Compartilhamento ponta a ponta criptografado e autenticação multifator.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
