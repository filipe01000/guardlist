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
} from 'lucide-react';
import {
  DonutVaultLogo,
  BarnabyMascot,
  CartoonVaultDoor,
} from './CartoonIllustrations';
import { evaluatePasswordStrength } from '../utils/generator';
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
    includeSampleData: boolean
  ) => Promise<void>;
  onUnlockVault: (masterPassword: string) => Promise<void>;
  onImportBackupFile: (fileContent: string, masterPassword: string) => Promise<void>;
}

export function WelcomeScreen({
  hasExistingVault,
  existingVaultUpdatedAt,
  onCreateVault,
  onUnlockVault,
  onImportBackupFile,
}: WelcomeScreenProps) {
  const [activeModal, setActiveModal] = useState<'none' | 'create' | 'unlock' | 'import'>(
    hasExistingVault ? 'unlock' : 'none'
  );
  const [vaultName, setVaultName] = useState('Cofre da Família de Springfield');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [includeSampleData, setIncludeSampleData] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [importedJson, setImportedJson] = useState<string>('');
  const [importedFileName, setImportedFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [vaultDoorOpen, setVaultDoorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [donutClicks, setDonutClicks] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const strength = evaluatePasswordStrength(masterPassword);

  const resetForm = (nextModal: 'none' | 'create' | 'unlock' | 'import') => {
    setErrorMsg(null);
    setMasterPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setActiveModal(nextModal);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (masterPassword.length < 6) {
      setErrorMsg('A Senha Mestra precisa ter pelo menos 6 caracteres para proteger suas rosquinhas!');
      return;
    }
    if (masterPassword !== confirmPassword) {
      setErrorMsg('D’oh! As duas senhas mestras digitadas não conferem.');
      return;
    }

    try {
      setIsProcessing(true);
      setVaultDoorOpen(true);
      await new Promise((r) => setTimeout(r, 350));
      await onCreateVault(
        masterPassword,
        vaultName.trim() || 'Cofre de Springfield',
        includeSampleData
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
      setErrorMsg('Digite sua Senha Mestra para girar o volante do cofre!');
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
        setActiveModal('import');
        setErrorMsg(null);
      }
    };
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

    try {
      setIsProcessing(true);
      setVaultDoorOpen(true);
      await onImportBackupFile(importedJson, masterPassword);
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
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setDonutClicks((c) => c + 1)}
              aria-label="Logotipo interativo DonutVault"
              className="focus-visible:outline-2 focus-visible:outline-pink rounded-full transition-transform active:scale-95 cursor-pointer"
            >
              <DonutVaultLogo size={48} spinning={isProcessing} />
            </button>
            <span className="font-display text-2xl font-black tracking-tight whitespace-nowrap shrink-0">
              DonutVault
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-extrabold">
            <a href="#criptografia" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              AES-256-GCM
            </a>
            <a href="#argon2id" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Argon2id KDF
            </a>
            <a href="#auditoria" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Auditoria Local
            </a>
            <a href="#zero-knowledge" className="hover:text-pink transition-colors whitespace-nowrap shrink-0">
              Zero-Knowledge
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
                <span>Guardião Oficial de Credenciais · 100% Client-Side</span>
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
              O <strong>DonutVault</strong> une a estética vibrante de quadrinhos e desenhos animados dos anos 90 com engenharia criptográfica de verdade: <strong>AES-256-GCM autenticado</strong>, derivação <strong>Argon2id</strong> com salt aleatório e armazenamento blindado no seu navegador.
            </p>

            {donutClicks >= 3 && (
              <ComicSpeechBubble speaker="EASTER EGG DO INSPETOR BARNABY" tone="yellow" tailDirection="none">
                &ldquo;WOO-HOO! Você descobriu o estoque secreto de rosquinhas de morango de 256 bits do Setor 7G!&rdquo;
              </ComicSpeechBubble>
            )}

            {/* Os 3 Botões Obrigatórios da Tela Inicial usando Neobrutal-UI Button */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
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
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-5 h-5 text-pink" />
                <span>Importar backup criptografado</span>
              </Button>
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
              <span>AES-256-GCM Autenticado</span>
              <span aria-hidden="true">·</span>
              <span>Argon2id + Salt de 128 bits</span>
              <span aria-hidden="true">·</span>
              <span>Nonces Únicos de 96 bits</span>
              <span aria-hidden="true">·</span>
              <span>Auditoria Offline zxcvbn</span>
            </div>
          </div>

          {/* Coluna Direita: Neobrutal-UI Card com Mascote Barnaby e Balão Comic */}
          <div className="lg:col-span-5">
            <Card className="border-4 shadow-[8px_8px_0px_0px_var(--border)] bg-secondary-background">
              <CardHeader className="border-b-3 border-border pb-5 bg-[#E0F2FE] dark:bg-slate-800 rounded-t-[10px] -mt-6 pt-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="animate-float shrink-0 bg-white border-3 border-border rounded-2xl p-1 shadow-[3px_3px_0px_0px_var(--border)]">
                      <BarnabyMascot
                        size={82}
                        mood={
                          errorMsg
                            ? 'panic'
                            : isProcessing || vaultDoorOpen
                              ? 'celebrating'
                              : 'happy'
                        }
                      />
                    </div>
                    <div>
                      <ComicActionCallout
                        text="GUARDIÃO BARNABY"
                        tone="yellow"
                        className="mb-1.5 text-[10px] px-2 py-0.5"
                      />
                      <CardTitle className="text-xl text-[#09090B] dark:text-white">
                        {activeModal === 'create'
                          ? 'Novo Cofre Blindado'
                          : activeModal === 'import'
                            ? 'Restaurar Backup'
                            : 'Portão do Setor 7G'}
                      </CardTitle>
                      <CardDescription className="text-xs font-bold text-stone-700 dark:text-slate-300 mt-0.5">
                        {hasExistingVault
                          ? `Cofre local pronto${existingVaultUpdatedAt ? ` · ${new Date(existingVaultUpdatedAt).toLocaleDateString('pt-BR')}` : ''}`
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
                      &ldquo;Olá, vizinho! Eu sou o <strong>Barnaby</strong>, pai de família atrapalhado mas especialista em blindagem de rosquinhas! Suas senhas nunca saem do seu computador!&rdquo;
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

                {/* Formulário: CRIAR MEU COFRE */}
                {activeModal === 'create' && (
                  <form onSubmit={handleCreateSubmit} className="space-y-3.5">
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
                        placeholder="Ex: Cofre da Família de Springfield"
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

                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FEF08A]/70 dark:bg-slate-800 border-2 border-border cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={includeSampleData}
                        onChange={(e) => setIncludeSampleData(e.target.checked)}
                        className="mt-0.5 accent-pink w-4 h-4"
                      />
                      <span className="font-semibold text-foreground">
                        <strong>Incluir credenciais divertidas de Springfield</strong> (ótimo para testar a Auditoria, Favoritos e Categorias na hora!)
                      </span>
                    </label>

                    {errorMsg && (
                      <ComicSpeechBubble speaker="ALERTA DO SETOR 7G" tone="danger" tailDirection="none">
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
                          ? 'Derivando Argon2id e Criptografando...'
                          : 'Criar e Criptografar Cofre'}
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
                      <ComicSpeechBubble speaker="D'OH! ACESSO NEGADO" tone="danger" tailDirection="none">
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
                          {isProcessing ? 'Validando Argon2id...' : 'Desbloquear Cofre'}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="neutral"
                        onClick={() => resetForm('create')}
                      >
                        Criar Novo
                      </Button>
                    </div>
                  </form>
                )}

                {/* Formulário: IMPORTAR BACKUP CRIPTOGRAFADO */}
                {activeModal === 'import' && (
                  <form onSubmit={handleImportSubmit} className="space-y-4">
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
                          ? 'Verificando SHA-256...'
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

        {/* Faixa de Arquitetura de Segurança Real em Cards Neobrutal-UI */}
        <section
          id="criptografia"
          className="mt-8 pt-6 border-t-3 border-border grid grid-cols-1 md:grid-cols-4 gap-5"
        >
          <Card className="py-4 gap-2 bg-[#FEF08A] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <p className="font-mono text-xs font-black text-[#0284C7] dark:text-[#38BDF8]">
                01. AES-256-GCM AUTENTICADO
              </p>
              <h3 className="font-display text-base font-black mt-1">
                Envelope Encryption Real
              </h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Chave aleatória de 256 bits (DEK) gerada via Web Crypto API e embrulhada pela chave derivada da Senha Mestra.
              </p>
            </CardContent>
          </Card>

          <Card id="argon2id" className="py-4 gap-2 bg-[#E0F2FE] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <p className="font-mono text-xs font-black text-pink">
                02. ARGON2ID + SALT 128-BIT
              </p>
              <h3 className="font-display text-base font-black mt-1">
                Resistente a GPU & ASIC
              </h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Derivação memory-hard Argon2id com salt único de 16 bytes e nonces exclusivos de 12 bytes a cada gravação.
              </p>
            </CardContent>
          </Card>

          <Card id="auditoria" className="py-4 gap-2 bg-[#FCE7F3] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <p className="font-mono text-xs font-black text-emerald-700 dark:text-emerald-400">
                03. AUDITORIA ZXCVBN LOCAL
              </p>
              <h3 className="font-display text-base font-black mt-1">
                Zero Vazamento de Rede
              </h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Análise de entropia, senhas repetidas e antigas executada 100% offline, sem enviar nada para APIs externas.
              </p>
            </CardContent>
          </Card>

          <Card id="zero-knowledge" className="py-4 gap-2 bg-[#DCFCE7] dark:bg-slate-800 text-[#09090B] dark:text-white">
            <CardContent className="px-5">
              <p className="font-mono text-xs font-black text-amber-800 dark:text-amber-300">
                04. INDEXEDDB + SHA-256
              </p>
              <h3 className="font-display text-base font-black mt-1">
                Integridade Verificada
              </h3>
              <p className="text-xs font-semibold opacity-85 mt-1 leading-relaxed">
                Armazenamento local criptografado com verificação de integridade SHA-256 e bloqueio automático por inatividade.
              </p>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Rodapé Neobrutalista com aviso responsável */}
      <footer className="w-full bg-secondary-background border-t-3 border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-bold text-stone-600 dark:text-slate-400">
          <span>
            <strong>DonutVault v0.9.3</strong> — Neobrutal-UI & StreamUI Comic Edition · Web Crypto API + Argon2id.
          </span>
          <span>
            Aviso técnico: Protótipo educacional e demonstrativo; recomenda-se auditoria independente antes de uso crítico.
          </span>
        </div>
      </footer>
    </div>
  );
}
