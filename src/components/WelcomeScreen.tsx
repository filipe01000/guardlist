import React, { useState, useRef } from 'react';
import {
  ShieldCheck,
  Unlock,
  PlusCircle,
  Upload,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Download,
} from 'lucide-react';
import { BrandMark } from './BrandMark';
import { CartoonVaultDoor } from './CartoonIllustrations';
import {
  checkMasterPasswordPolicy,
  evaluatePasswordStrength,
  MASTER_PASSWORD_MIN_LENGTH,
} from '../utils/generator';
import {
  loadStrengthEngine,
  useStrengthEngineReady,
} from '../utils/strengthEngine';
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

interface WelcomeScreenProps {
  hasExistingVault: boolean;
  existingVaultUpdatedAt?: string;
  onCreateVault: (
    masterPassword: string,
    vaultName: string,
    enableSync: boolean,
    replaceExisting: boolean
  ) => Promise<void>;
  onUnlockVault: (masterPassword: string) => Promise<void>;
  onImportBackupFile: (
    fileContent: string,
    masterPassword: string,
    replaceExisting: boolean
  ) => Promise<void>;
  // Baixa o backup cifrado do cofre salvo; funciona com o cofre trancado.
  onExportExistingVault?: () => void;
}

type WelcomePanel = 'none' | 'create' | 'unlock' | 'import' | 'confirm-replace';

export function WelcomeScreen({
  hasExistingVault,
  existingVaultUpdatedAt,
  onCreateVault,
  onUnlockVault,
  onImportBackupFile,
  onExportExistingVault,
}: WelcomeScreenProps) {
  const [activeModal, setActiveModal] = useState<WelcomePanel>(
    hasExistingVault ? 'unlock' : 'none'
  );
  // Com um cofre salvo, criar outro ou restaurar um backup apaga esse cofre deste navegador.
  // As duas ações passam antes por uma confirmação explícita.
  const [replaceIntent, setReplaceIntent] = useState<'create' | 'import'>('create');
  const [replaceAcknowledged, setReplaceAcknowledged] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [vaultName, setVaultName] = useState('Meu cofre');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [enableSync, setEnableSync] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [importedJson, setImportedJson] = useState<string>('');
  const [importedFileName, setImportedFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [vaultDoorOpen, setVaultDoorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [donutClicks, setDonutClicks] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useStrengthEngineReady();
  const strength = evaluatePasswordStrength(masterPassword);

  const resetForm = (nextModal: WelcomePanel) => {
    setErrorMsg(null);
    setMasterPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setActiveModal(nextModal);
  };

  const existingVaultDate = existingVaultUpdatedAt
    ? new Date(existingVaultUpdatedAt).toLocaleDateString('pt-BR')
    : null;

  const requestReplace = (intent: 'create' | 'import') => {
    if (!hasExistingVault || replaceConfirmed) {
      if (intent === 'create') resetForm('create');
      else fileInputRef.current?.click();
      return;
    }
    setReplaceIntent(intent);
    setReplaceAcknowledged(false);
    resetForm('confirm-replace');
  };

  const confirmReplace = () => {
    if (!replaceAcknowledged) return;
    setReplaceConfirmed(true);
    if (replaceIntent === 'create') {
      resetForm('create');
    } else if (importedJson) {
      resetForm('import');
    } else {
      fileInputRef.current?.click();
    }
  };

  const cancelReplace = () => {
    setReplaceConfirmed(false);
    setReplaceAcknowledged(false);
    setImportedJson('');
    setImportedFileName('');
    resetForm('unlock');
  };

  const handleDownloadExistingBackup = () => {
    onExportExistingVault?.();
    setBackupDownloaded(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (hasExistingVault && !replaceConfirmed) {
      requestReplace('create');
      return;
    }

    await loadStrengthEngine().catch(() => undefined);
    const policy = checkMasterPasswordPolicy(masterPassword);
    if (!policy.ok) {
      setErrorMsg(policy.reason);
      return;
    }
    if (masterPassword !== confirmPassword) {
      setErrorMsg('As duas senhas não são iguais.');
      return;
    }

    try {
      setIsProcessing(true);
      setVaultDoorOpen(true);
      await new Promise((r) => setTimeout(r, 350));
      await onCreateVault(
        masterPassword,
        vaultName.trim() || 'Meu cofre',
        enableSync,
        replaceConfirmed
      );
    } catch (err) {
      setVaultDoorOpen(false);
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao criar o cofre.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!masterPassword) {
      setErrorMsg('Digite sua Senha Mestra.');
      return;
    }

    try {
      setIsProcessing(true);
      await onUnlockVault(masterPassword);
      setVaultDoorOpen(true);
    } catch (err) {
      setVaultDoorOpen(false);
      setErrorMsg(err instanceof Error ? err.message : 'Falha ao desbloquear o cofre.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportedFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportedJson(reader.result);
        setErrorMsg(null);
        if (hasExistingVault && !replaceConfirmed) {
          setReplaceIntent('import');
          setReplaceAcknowledged(false);
          setActiveModal('confirm-replace');
        } else {
          setActiveModal('import');
        }
      }
    };
    // Permite escolher o mesmo arquivo de novo depois de cancelar.
    e.target.value = '';
    reader.readAsText(file);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!importedJson) {
      setErrorMsg('Selecione um arquivo de backup criptografado (.json) primeiro.');
      return;
    }
    if (!masterPassword) {
      setErrorMsg('Digite a Senha Mestra usada quando esse backup foi exportado.');
      return;
    }
    if (hasExistingVault && !replaceConfirmed) {
      requestReplace('import');
      return;
    }

    try {
      setIsProcessing(true);
      setVaultDoorOpen(true);
      await onImportBackupFile(importedJson, masterPassword, replaceConfirmed);
    } catch (err) {
      setVaultDoorOpen(false);
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao importar o backup.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-comic-halftone text-foreground flex flex-col justify-between">
      {/* Top Bar Neobrutalista (3 zonas limpas) */}
      <header className="w-full bg-secondary-background border-b-4 border-border">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-8 px-4 sm:px-6 py-4">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDonutClicks((c) => c + 1)}
              aria-label="Logotipo interativo DonutVault"
              className="focus-visible:outline-2 focus-visible:outline-pink rounded-full transition-transform active:scale-95 cursor-pointer"
            >
              <BrandMark size={48} spinning={isProcessing} />
            </button>
            <span className="font-display text-xl sm:text-2xl font-black tracking-tight whitespace-nowrap shrink-0">
              DonutVault
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-extrabold">
            <a href="#criptografia" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Como protege
            </a>
            <a href="#auditoria" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Saúde das senhas
            </a>
            <a href="#sincronizacao" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Sincronização
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <Button
              type="button"
              variant="default"
              onClick={() => resetForm(hasExistingVault ? 'unlock' : 'create')}
            >
              {hasExistingVault ? 'Abrir Meu Cofre' : 'Começar Agora'}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Principal Neobrutal-UI + StreamUI Comic */}
      <main className="w-full max-w-7xl mx-auto px-6 py-6 lg:py-8 flex-1 flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Coluna Esquerda: Título Cartoon Anos 90 + 3 Ações Principais */}
          <div className="lg:col-span-7 space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <ComicActionCallout text="EDIÇÃO ANOS 90!" tone="pink" />
              <span className="text-xs sm:text-sm font-extrabold text-stone-700 dark:text-slate-300 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#0284C7]" />
                <span>Gerenciador de senhas · criptografia feita no seu navegador</span>
              </span>
            </div>

            <h1
              className="font-display text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.06] text-foreground"
              style={{ textWrap: 'balance' }}
            >
              Suas senhas estão mais protegidas que a{' '}
              <span className="inline-block bg-main text-main-foreground px-3 py-0.5 border-3 border-border shadow-[4px_4px_0px_0px_var(--border)] -rotate-1">
                última rosquinha!
              </span>
            </h1>

            <p className="text-base sm:text-lg font-semibold text-stone-700 dark:text-slate-300 max-w-2xl leading-relaxed">
              O <strong>DonutVault</strong> guarda suas senhas com cara de desenho animado e criptografia de verdade. Tudo é cifrado aqui, no seu navegador, antes de ser salvo, e só a sua <strong>Senha Mestra</strong> abre o cofre. Nem o servidor consegue ler.
            </p>

            {donutClicks >= 3 && (
              <ComicSpeechBubble speaker="EASTER EGG DO INSPETOR BARNABY" tone="yellow" tailDirection="none">
                &ldquo;Você achou a rosquinha secreta! Ela também é cifrada.&rdquo;
              </ComicSpeechBubble>
            )}

            {/* Ações principais. Com um cofre salvo, a principal é desbloquear: criar outro
                cofre fica só como link discreto no formulário, atrás de uma confirmação. */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              {hasExistingVault ? (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="lg"
                    onClick={() => resetForm('unlock')}
                  >
                    <Unlock className="w-5 h-5 stroke-[2.5]" />
                    <span>Desbloquear meu cofre</span>
                  </Button>

                  <Button
                    type="button"
                    variant="neutral"
                    size="lg"
                    onClick={() => requestReplace('import')}
                  >
                    <Upload className="w-5 h-5 text-pink" />
                    <span>Restaurar backup</span>
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="default"
                    size="lg"
                    onClick={() => resetForm('create')}
                  >
                    <PlusCircle className="w-5 h-5 stroke-[2.5]" />
                    <span>Criar meu cofre</span>
                  </Button>

                  <Button
                    type="button"
                    variant="sky"
                    size="lg"
                    onClick={() => resetForm('unlock')}
                  >
                    <Unlock className="w-5 h-5 stroke-[2.5]" />
                    <span>Desbloquear cofre</span>
                  </Button>

                  <Button
                    type="button"
                    variant="neutral"
                    size="lg"
                    onClick={() => requestReplace('import')}
                  >
                    <Upload className="w-5 h-5 text-pink" />
                    <span>Importar backup criptografado</span>
                  </Button>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.donutvault"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Selecionar arquivo de backup criptografado"
              />
            </div>

            {/* Resumo técnico em texto limpo sem pílulas */}
            <div className="pt-2 flex flex-wrap items-center gap-y-2 gap-x-3 text-xs font-extrabold text-stone-700 dark:text-slate-300">
              <span>AES-256-GCM e Argon2id</span>
              <span aria-hidden="true">·</span>
              <span>Funciona sem internet</span>
              <span aria-hidden="true">·</span>
              <span>Sincronização opcional</span>
            </div>
          </div>

          {/* Coluna Direita: Neobrutal-UI Card com Mascote Barnaby e Balão Comic */}
          <div className="lg:col-span-5">
            <Card className="border-4 shadow-[8px_8px_0px_0px_var(--border)] bg-secondary-background">
              <CardHeader className="border-b-3 border-border pb-5 bg-[#E0F2FE] dark:bg-slate-800 rounded-t-[10px] -mt-6 pt-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="animate-float shrink-0 bg-white border-3 border-border rounded-2xl p-1 shadow-[3px_3px_0px_0px_var(--border)]">
                      <BrandMark size={82} />
                    </div>
                    <div>
                      <ComicActionCallout
                        text="GUARDIÃO BARNABY"
                        tone="yellow"
                        className="mb-1.5 text-[10px] px-2 py-0.5"
                      />
                      <CardTitle className="text-xl text-[#09090B] dark:text-white">
                        {activeModal === 'confirm-replace'
                          ? 'Substituir o cofre deste navegador?'
                          : activeModal === 'create'
                            ? 'Novo cofre'
                            : activeModal === 'import'
                              ? 'Restaurar Backup'
                              : 'Seu cofre'}
                      </CardTitle>
                      <CardDescription className="text-xs font-bold text-stone-700 dark:text-slate-300 mt-0.5">
                        {hasExistingVault
                          ? `Cofre local pronto${existingVaultDate ? ` · ${existingVaultDate}` : ''}`
                          : 'Crie seu cofre criptografado em segundos!'}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="hidden sm:block shrink-0">
                    <CartoonVaultDoor isOpen={vaultDoorOpen} size={64} />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-2 space-y-4">
                {/* Estado Inicial com Balão de Quadrinhos StreamUI */}
                {activeModal === 'none' && (
                  <div className="space-y-4">
                    <ComicSpeechBubble
                      speaker="BARNABY ROSQUINHA"
                      tone="yellow"
                      tailDirection="top"
                    >
                      &ldquo;Oi! Eu sou o <strong>Barnaby</strong>, o guarda deste cofre. Suas senhas são cifradas aqui mesmo, no seu navegador, antes de qualquer coisa.&rdquo;
                    </ComicSpeechBubble>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <Button
                        type="button"
                        variant="default"
                        onClick={() => resetForm('create')}
                        className="w-full"
                      >
                        Criar meu cofre
                      </Button>
                      <Button
                        type="button"
                        variant="sky"
                        onClick={() => resetForm('unlock')}
                        className="w-full"
                      >
                        Desbloquear cofre
                      </Button>
                    </div>
                  </div>
                )}

                {/* Confirmação antes de substituir o cofre salvo. Momento de risco: texto direto,
                    backup oferecido antes e ação destrutiva só depois de marcar que entendeu. */}
                {activeModal === 'confirm-replace' && (
                  <div className="space-y-4" aria-live="polite">
                    <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border-3 border-border">
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-700 dark:text-rose-300" />
                      <div className="space-y-1.5 text-sm text-stone-900 dark:text-rose-50">
                        <p className="font-extrabold">
                          {replaceIntent === 'create'
                            ? 'Criar outro cofre apaga o cofre salvo neste navegador.'
                            : 'Restaurar um backup apaga o cofre salvo neste navegador.'}
                        </p>
                        <p className="font-medium leading-relaxed">
                          O cofre atual
                          {existingVaultDate ? `, atualizado em ${existingVaultDate},` : ''} sai
                          daqui e o novo fica no lugar. Se ele não estiver sincronizado com o
                          servidor nem guardado em um backup, as senhas dele se perdem.
                        </p>
                      </div>
                    </div>

                    {onExportExistingVault && (
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="neutral"
                          onClick={handleDownloadExistingBackup}
                          autoFocus
                        >
                          <Download className="w-4 h-4" />
                          <span>Baixar backup do cofre atual</span>
                        </Button>
                        {backupDownloaded && (
                          <span className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800 dark:text-emerald-300">
                            <CheckCircle2 className="w-4 h-4" />
                            Backup baixado
                          </span>
                        )}
                      </div>
                    )}

                    <label className="flex items-start gap-2.5 text-sm font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={replaceAcknowledged}
                        onChange={(e) => setReplaceAcknowledged(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-destructive"
                      />
                      <span>Entendo que o cofre atual será apagado deste navegador.</span>
                    </label>

                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!replaceAcknowledged}
                        onClick={confirmReplace}
                        className="flex-1"
                      >
                        {replaceIntent === 'create'
                          ? 'Apagar e criar outro cofre'
                          : 'Apagar e restaurar o backup'}
                      </Button>
                      <Button type="button" variant="neutral" onClick={cancelReplace}>
                        Voltar
                      </Button>
                    </div>
                  </div>
                )}

                {/* Formulário: CRIAR MEU COFRE */}
                {activeModal === 'create' && (
                  <form onSubmit={handleCreateSubmit} className="space-y-3.5">
                    {hasExistingVault && (
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border-2 border-border text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700 dark:text-rose-300" />
                        <span className="font-semibold text-stone-900 dark:text-rose-50">
                          Este cofre novo vai substituir o cofre salvo neste navegador.{' '}
                          <button
                            type="button"
                            onClick={cancelReplace}
                            className="font-extrabold underline underline-offset-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            Cancelar
                          </button>
                        </span>
                      </div>
                    )}
                    <div>
                      <label
                        htmlFor="vault-name-input"
                        className="block text-xs font-extrabold uppercase tracking-wide mb-1"
                      >
                        Nome do seu Cofre
                      </label>
                      <Input
                        id="vault-name-input"
                        type="text"
                        value={vaultName}
                        onChange={(e) => setVaultName(e.target.value)}
                        placeholder="Ex.: Pessoal, Trabalho"
                        required
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="create-master-password"
                        className="block text-xs font-extrabold uppercase tracking-wide mb-1"
                      >
                        Senha Mestra (Jamais armazenada ou enviada)
                      </label>
                      <div className="relative">
                        <Input
                          id="create-master-password"
                          type={showPassword ? 'text' : 'password'}
                          value={masterPassword}
                          onChange={(e) => setMasterPassword(e.target.value)}
                          placeholder="Crie uma Senha Mestra forte..."
                          className="pr-10 font-mono"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? 'Esconder senha mestra' : 'Mostrar senha mestra'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-600 dark:text-slate-400 hover:text-foreground cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-stone-600 dark:text-slate-300">
                        Mínimo de {MASTER_PASSWORD_MIN_LENGTH} caracteres e força "Forte". Uma frase
                        com várias palavras funciona bem.
                      </p>
                      {masterPassword.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between text-xs font-extrabold">
                            <span>Força: {strength.label}</span>
                            <span className="text-stone-600 dark:text-slate-300">
                              {strength.funnyMessage}
                            </span>
                          </div>
                          <div className="w-full h-3 bg-stone-200 dark:bg-slate-700 rounded-full overflow-hidden border-2 border-border">
                            <div
                              className={`h-full transition-all ${
                                strength.level === 'strong'
                                  ? 'w-full bg-emerald-500'
                                  : strength.level === 'medium'
                                    ? 'w-2/3 bg-amber-400'
                                    : 'w-1/3 bg-rose-500'
                              }`}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="confirm-master-password"
                        className="block text-xs font-extrabold uppercase tracking-wide mb-1"
                      >
                        Confirmar Senha Mestra
                      </label>
                      <Input
                        id="confirm-master-password"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a Senha Mestra..."
                        className="font-mono"
                        required
                      />
                    </div>


                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#E0F2FE]/70 dark:bg-slate-800 border-2 border-border cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={enableSync}
                        onChange={(e) => setEnableSync(e.target.checked)}
                        className="mt-0.5 accent-pink w-4 h-4"
                      />
                      <span className="font-semibold text-foreground">
                        <strong>Sincronizar com o servidor</strong> (opcional). O servidor guarda uma
                        cópia cifrada do cofre para outros aparelhos. Dá para ativar depois em
                        Configurações.
                      </span>
                    </label>

                    {errorMsg && (
                      <ComicSpeechBubble speaker="REVISE ANTES DE CONTINUAR" tone="danger" tailDirection="none">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{errorMsg}</span>
                        </div>
                      </ComicSpeechBubble>
                    )}

                    <Button
                      type="submit"
                      variant="default"
                      size="lg"
                      disabled={isProcessing}
                      className="w-full"
                    >
                      <Lock className="w-4 h-4" />
                      <span>
                        {isProcessing
                          ? 'Criando o cofre…'
                          : 'Criar cofre'}
                      </span>
                    </Button>
                  </form>
                )}

                {/* Formulário: DESBLOQUEAR COFRE */}
                {activeModal === 'unlock' && (
                  <form onSubmit={handleUnlockSubmit} className="space-y-4">
                    {!hasExistingVault && (
                      <ComicSpeechBubble speaker="DICA DO BARNABY" tone="sky" tailDirection="top">
                        Você ainda não possui um cofre salvo neste navegador. Clique em{' '}
                        <button
                          type="button"
                          onClick={() => resetForm('create')}
                          className="underline font-black text-pink cursor-pointer"
                        >
                          Criar meu cofre
                        </button>{' '}
                        ou importe um backup criptografado!
                      </ComicSpeechBubble>
                    )}

                    <div>
                      <label
                        htmlFor="unlock-master-password"
                        className="block text-xs font-extrabold uppercase tracking-wide mb-1"
                      >
                        Digite sua Senha Mestra para Desbloquear
                      </label>
                      <div className="relative">
                        <Input
                          id="unlock-master-password"
                          type={showPassword ? 'text' : 'password'}
                          value={masterPassword}
                          onChange={(e) => setMasterPassword(e.target.value)}
                          placeholder="Sua Senha Mestra secreta..."
                          className="pr-10 font-mono"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-600 dark:text-slate-400 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {errorMsg && (
                      <ComicSpeechBubble speaker="NÃO FOI POSSÍVEL ABRIR" tone="danger" tailDirection="none">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{errorMsg}</span>
                        </div>
                      </ComicSpeechBubble>
                    )}

                    <div className="flex items-center gap-3">
                      <Button
                        type="submit"
                        variant="sky"
                        disabled={isProcessing || !hasExistingVault}
                        className="flex-1"
                      >
                        <Unlock className="w-4 h-4" />
                        <span>
                          {isProcessing ? 'Abrindo o cofre…' : 'Desbloquear Cofre'}
                        </span>
                      </Button>
                    </div>

                    {hasExistingVault && (
                      <p className="text-xs font-semibold text-stone-700 dark:text-slate-300">
                        Quer começar do zero?{' '}
                        <button
                          type="button"
                          onClick={() => requestReplace('create')}
                          className="font-extrabold text-foreground underline underline-offset-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          Criar outro cofre
                        </button>
                      </p>
                    )}
                  </form>
                )}

                {/* Formulário: IMPORTAR BACKUP CRIPTOGRAFADO */}
                {activeModal === 'import' && (
                  <form onSubmit={handleImportSubmit} className="space-y-4">
                    {hasExistingVault && (
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border-2 border-border text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-700 dark:text-rose-300" />
                        <span className="font-semibold text-stone-900 dark:text-rose-50">
                          Este backup vai substituir o cofre salvo neste navegador.{' '}
                          <button
                            type="button"
                            onClick={cancelReplace}
                            className="font-extrabold underline underline-offset-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            Cancelar
                          </button>
                        </span>
                      </div>
                    )}
                    <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 border-3 border-border text-xs flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span className="font-bold text-stone-900 dark:text-emerald-200 truncate">
                        Arquivo: <strong>{importedFileName || 'backup.donutvault.json'}</strong>
                      </span>
                    </div>

                    <div>
                      <label
                        htmlFor="import-master-password"
                        className="block text-xs font-extrabold uppercase tracking-wide mb-1"
                      >
                        Senha Mestra do Backup
                      </label>
                      <Input
                        id="import-master-password"
                        type={showPassword ? 'text' : 'password'}
                        value={masterPassword}
                        onChange={(e) => setMasterPassword(e.target.value)}
                        placeholder="Senha mestra que protege este backup..."
                        className="font-mono"
                        required
                      />
                    </div>

                    {errorMsg && (
                      <ComicSpeechBubble speaker="ERRO DE BACKUP" tone="danger" tailDirection="none">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{errorMsg}</span>
                        </div>
                      </ComicSpeechBubble>
                    )}

                    <div className="flex items-center gap-3">
                      <Button
                        type="submit"
                        variant="pink"
                        disabled={isProcessing}
                        className="flex-1"
                      >
                        {isProcessing
                          ? 'Verificando o backup…'
                          : 'Restaurar e Desbloquear'}
                      </Button>
                      <Button
                        type="button"
                        variant="neutral"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Trocar Arquivo
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Como o cofre protege, em linguagem comum */}
        <section
          id="criptografia"
          className="mt-8 pt-6 border-t-3 border-border grid grid-cols-1 md:grid-cols-4 gap-5"
        >
          <Card className="py-4 gap-2 bg-[#FEF08A] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <h3 className="font-display text-base font-black">Cifrado no seu aparelho</h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Cada senha é cifrada no navegador antes de ser salva. Sem a Senha Mestra, o que
                fica guardado é ilegível, inclusive para o servidor.
              </p>
            </CardContent>
          </Card>

          <Card className="py-4 gap-2 bg-[#E0F2FE] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <h3 className="font-display text-base font-black">Difícil de adivinhar</h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                A Senha Mestra passa pelo Argon2id, que deixa cada tentativa de adivinhação lenta
                e cara. Por isso o cofre exige uma senha forte.
              </p>
            </CardContent>
          </Card>

          <Card id="auditoria" className="py-4 gap-2 bg-[#FCE7F3] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <h3 className="font-display text-base font-black">Saúde das senhas</h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Mostra senhas fracas, repetidas e antigas e ajuda a trocar. A análise roda no seu
                aparelho, sem enviar nada para fora.
              </p>
            </CardContent>
          </Card>

          <Card id="sincronizacao" className="py-4 gap-2 bg-[#DCFCE7] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <h3 className="font-display text-base font-black">Você escolhe onde fica</h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Use só neste navegador, exporte um backup cifrado ou ative a sincronização. O
                cofre tranca sozinho quando você se afasta.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Rodapé com a versão e uma nota honesta sobre auditoria */}
      <footer className="w-full bg-secondary-background border-t-3 border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-bold text-stone-600 dark:text-slate-400">
          <span>
            <strong>DonutVault v0.9.3</strong> · Criptografia no navegador com Web Crypto e
            Argon2id.
          </span>
          <span>Projeto independente, ainda sem auditoria de segurança externa.</span>
        </div>
      </footer>
    </div>
  );
}
