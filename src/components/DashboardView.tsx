import React, { useState } from 'react';
import {
  Plus,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  Repeat,
  Clock,
  ArrowUpRight,
  Sparkles,
  Dices,
} from 'lucide-react';
import type { CredentialItem, NavigationTab } from '../types/vault';
import type { VaultSecurityAuditReport } from '../utils/audit';
import { VAULT_CATEGORIES } from '../utils/seedData';
import { copySecretToClipboardWithAutoClear } from '../utils/security';
import { BarnabyMascot } from './CartoonIllustrations';
import { Button } from './ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from './ui/card';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';
import {
  SyncDashboardPanel,
  type SyncDashboardProps,
} from './SyncDashboardPanel';

interface DashboardViewProps {
  credentials: CredentialItem[];
  auditReport: VaultSecurityAuditReport;
  onOpenNewCredentialModal: () => void;
  onNavigate: (tab: NavigationTab) => void;
  onSelectCategory: (catId: string) => void;
  onNotify?: (burst: string, title: string, tone?: 'success' | 'info' | 'warning' | 'danger') => void;
  syncDashboardProps?: SyncDashboardProps;
}

export function DashboardView({
  credentials,
  auditReport,
  onOpenNewCredentialModal,
  onNavigate,
  onSelectCategory,
  onNotify,
  syncDashboardProps,
}: DashboardViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeCredentials = credentials
    .filter((c) => !c.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const recentCredentials = activeCredentials.slice(0, 5);

  const handleCopyPassword = async (cred: CredentialItem) => {
    try {
      await copySecretToClipboardWithAutoClear(cred.password, 30_000);
      setCopiedId(cred.id);
      onNotify?.(
        'ZAP!',
        `Senha de "${cred.serviceName}" copiada (limpeza automática em 30s)!`,
        'info'
      );
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback silencioso
    }
  };

  const getCategoryName = (catId: string) =>
    VAULT_CATEGORIES.find((c) => c.id === catId)?.name || 'Outros';

  const mascotMood =
    auditReport.overallScore >= 85
      ? 'celebrating'
      : auditReport.overallScore >= 60
        ? 'happy'
        : 'panic';

  return (
    <div className="space-y-7">
      {/* Banner Principal em Estilo Quadrinhos StreamUI + Neobrutal-UI */}
      <section className="bg-main bg-comic-stripes text-main-foreground border-4 border-border rounded-base p-6 sm:p-7 shadow-[6px_6px_0px_0px_var(--border)] flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 flex-1">
          <div className="shrink-0 bg-white border-4 border-border rounded-2xl p-2 shadow-[4px_4px_0px_0px_var(--border)] animate-float">
            <BarnabyMascot size={96} mood={mascotMood} />
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ComicActionCallout
                text={
                  auditReport.overallScore >= 85
                    ? 'COFRE EM DIA'
                    : 'ATENÇÃO'
                }
                tone={auditReport.overallScore >= 85 ? 'emerald' : 'pink'}
              />
              <span className="text-xs font-black uppercase tracking-wider text-[#09090B]/80">
                Início
              </span>
            </div>

            <ComicSpeechBubble
              speaker="INSPETOR BARNABY"
              tone="white"
              tailDirection="left"
              className="max-w-2xl"
            >
              <span className="font-display text-base sm:text-lg font-black block text-foreground">
                {auditReport.healthHeadline}
              </span>
              <span className="text-xs font-semibold text-stone-600 dark:text-slate-300 block mt-0.5">
                Tudo aqui é cifrado neste aparelho com a sua Senha Mestra.
              </span>
            </ComicSpeechBubble>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 w-full lg:w-auto">
          <Button
            type="button"
            variant="pink"
            size="lg"
            onClick={onOpenNewCredentialModal}
            className="w-full sm:w-auto text-base"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>Guardar nova senha</span>
          </Button>
        </div>
      </section>

      {/* 4 Cards KPI Neobrutal-UI (Total/Fortes, Fracas, Reutilizadas e Antigas) */}
      <section
        aria-label="Métricas principais do cofre"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
      >
        <Card className="py-5 gap-2 bg-[#E0F2FE] dark:bg-slate-800 text-[#09090B] dark:text-white">
          <CardContent className="px-5">
            <div className="flex items-center justify-between text-xs font-black uppercase">
              <span>SENHAS CADASTRADAS</span>
              <KeyRound className="w-4 h-4 text-[#0284C7] dark:text-sky" />
            </div>
            <p className="font-display text-4xl font-black mt-2 tabular-nums">
              {auditReport.totalActiveCredentials}
            </p>
            <p className="text-xs font-bold opacity-85 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{auditReport.strongCount} senhas fortes blindadas</span>
            </p>
          </CardContent>
        </Card>

        <Card className="py-5 gap-2 bg-[#FCE7F3] dark:bg-slate-800 text-[#09090B] dark:text-white">
          <CardContent className="px-5">
            <div className="flex items-center justify-between text-xs font-black uppercase text-rose-900 dark:text-rose-400">
              <span>SENHAS FRACAS</span>
              <ShieldAlert className="w-4 h-4 text-rose-700 dark:text-rose-400" />
            </div>
            <p className="font-display text-4xl font-black mt-2 tabular-nums text-rose-700 dark:text-rose-400">
              {auditReport.weakCount}
            </p>
            <p className="text-xs font-bold opacity-80 mt-1">
              {auditReport.weakCount === 0
                ? 'Nenhuma rosquinha vulnerável!'
                : 'Precisam de troca imediata'}
            </p>
          </CardContent>
        </Card>

        <Card className="py-5 gap-2 bg-[#FEF08A] dark:bg-slate-800 text-[#09090B] dark:text-white">
          <CardContent className="px-5">
            <div className="flex items-center justify-between text-xs font-black uppercase text-amber-950 dark:text-amber-300">
              <span>SENHAS REUTILIZADAS</span>
              <Repeat className="w-4 h-4 text-amber-800 dark:text-amber-300" />
            </div>
            <p className="font-display text-4xl font-black mt-2 tabular-nums text-amber-900 dark:text-amber-300">
              {auditReport.reusedCount}
            </p>
            <p className="text-xs font-bold opacity-80 mt-1">
              {auditReport.reusedCount === 0
                ? 'Todas as senhas são exclusivas!'
                : 'Contas usando a mesma senha'}
            </p>
          </CardContent>
        </Card>

        <Card className="py-5 gap-2 bg-[#DCFCE7] dark:bg-slate-800 text-[#09090B] dark:text-white">
          <CardContent className="px-5">
            <div className="flex items-center justify-between text-xs font-black uppercase text-emerald-950 dark:text-emerald-300">
              <span>SENHAS ANTIGAS</span>
              <Clock className="w-4 h-4 text-emerald-800 dark:text-emerald-400" />
            </div>
            <p className="font-display text-4xl font-black mt-2 tabular-nums text-emerald-900 dark:text-emerald-300">
              {auditReport.oldCount}
            </p>
            <p className="text-xs font-bold opacity-80 mt-1">
              {auditReport.oldCount === 0
                ? 'Todas atualizadas recentemente!'
                : 'Mais de 90 dias sem rotação'}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Dashboard de Sincronização Zero-Knowledge (PC & Celular — Fase 4B) */}
      {syncDashboardProps && <SyncDashboardPanel {...syncDashboardProps} compact />}

      {/* Indicador de Segurança Geral + Tabela Neobrutal-UI de Credenciais Recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Coluna Esquerda (5 cols): Medidor Geral de Segurança */}
        <Card className="lg:col-span-5 justify-between">
          <CardHeader className="border-b-3 border-border">
            <div className="flex items-center justify-between">
              <CardTitle>Saúde das senhas</CardTitle>
            </div>
            <CardDescription>
              Calculada neste aparelho, sem enviar nada
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="flex items-center gap-5">
              <div className="w-24 h-24 rounded-2xl border-4 border-border bg-main text-main-foreground flex flex-col items-center justify-center shrink-0 shadow-shadow -rotate-2">
                <span className="font-display text-3xl font-black tabular-nums">
                  {auditReport.overallScore}%
                </span>
                <span className="text-[11px] font-black uppercase">
                  Saúde
                </span>
              </div>

              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-extrabold">
                    <span>Fortes ({auditReport.strongCount})</span>
                    <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                      {auditReport.totalActiveCredentials > 0
                        ? Math.round(
                            (auditReport.strongCount /
                              auditReport.totalActiveCredentials) *
                              100
                          )
                        : 100}
                      %
                    </span>
                  </div>
                  <div className="w-full h-3.5 bg-stone-200 dark:bg-slate-700 rounded-md overflow-hidden border-2 border-border">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{
                        width: `${
                          auditReport.totalActiveCredentials > 0
                            ? (auditReport.strongCount /
                                auditReport.totalActiveCredentials) *
                              100
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-extrabold">
                    <span>Médias ({auditReport.mediumCount})</span>
                    <span className="tabular-nums text-amber-600 dark:text-amber-400">
                      {auditReport.totalActiveCredentials > 0
                        ? Math.round(
                            (auditReport.mediumCount /
                              auditReport.totalActiveCredentials) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full h-3.5 bg-stone-200 dark:bg-slate-700 rounded-md overflow-hidden border-2 border-border">
                    <div
                      className="h-full bg-amber-400 transition-all"
                      style={{
                        width: `${
                          auditReport.totalActiveCredentials > 0
                            ? (auditReport.mediumCount /
                                auditReport.totalActiveCredentials) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-extrabold">
                    <span>Fracas ({auditReport.weakCount})</span>
                    <span className="tabular-nums text-rose-600 dark:text-rose-400">
                      {auditReport.totalActiveCredentials > 0
                        ? Math.round(
                            (auditReport.weakCount /
                              auditReport.totalActiveCredentials) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="w-full h-3.5 bg-stone-200 dark:bg-slate-700 rounded-md overflow-hidden border-2 border-border">
                    <div
                      className="h-full bg-rose-500 transition-all"
                      style={{
                        width: `${
                          auditReport.totalActiveCredentials > 0
                            ? (auditReport.weakCount /
                                auditReport.totalActiveCredentials) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t-3 border-border justify-between gap-3 flex-wrap">
            <Button
              type="button"
              variant="sky"
              size="sm"
              onClick={() => onNavigate('security')}
            >
              <span>Ver Auditoria Completa</span>
              <ArrowUpRight className="w-4 h-4" />
            </Button>

            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => onNavigate('generator')}
            >
              <Dices className="w-4 h-4 text-pink" />
              <span>Gerador de Senhas</span>
            </Button>
          </CardFooter>
        </Card>

        {/* Coluna Direita (7 cols): Credenciais Adicionadas Recentemente em Tabela Neobrutal-UI */}
        <Card className="lg:col-span-7 justify-between">
          <CardHeader className="border-b-3 border-border">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Credenciais Adicionadas Recentemente</CardTitle>
                <CardDescription>
                  Tabela rápida das últimas senhas protegidas no cofre
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="neutral"
                size="xs"
                onClick={() => onNavigate('passwords')}
              >
                Ver todas ({activeCredentials.length})
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {recentCredentials.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <Sparkles className="w-8 h-8 text-pink mx-auto" />
                <p className="text-sm font-black">
                  O prato de rosquinhas está vazio!
                </p>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={onOpenNewCredentialModal}
                >
                  Guardar primeira senha
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Serviço</TableHead>
                    <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                    <TableHead className="text-right">Ação Rápida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCredentials.map((cred) => (
                    <TableRow key={cred.id}>
                      <TableCell>
                        <div className="font-extrabold text-sm text-foreground">
                          {cred.serviceName}
                        </div>
                        <div className="text-xs text-stone-600 dark:text-slate-400 truncate max-w-[200px]">
                          {cred.username || cred.email}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs font-bold text-stone-700 dark:text-slate-300">
                        {getCategoryName(cred.category)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant={copiedId === cred.id ? 'emerald' : 'default'}
                          size="xs"
                          onClick={() => handleCopyPassword(cred)}
                          aria-label={`Copiar senha de ${cred.serviceName}`}
                        >
                          {copiedId === cred.id ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Copiada!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copiar Senha</span>
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>

          <CardFooter className="border-t-3 border-border flex-wrap gap-2">
            <span className="text-xs font-black uppercase mr-1">
              Categorias:
            </span>
            {VAULT_CATEGORIES.slice(0, 4).map((cat) => (
              <Button
                key={cat.id}
                type="button"
                variant="neutral"
                size="xs"
                onClick={() => {
                  onSelectCategory(cat.id);
                  onNavigate('categories');
                }}
              >
                {cat.name}
              </Button>
            ))}
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
