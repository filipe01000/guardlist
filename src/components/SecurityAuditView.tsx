import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  ShieldAlert,
  ShieldCheck,
  Repeat,
  Clock,
  AlertTriangle,
  Wand2,
  CheckCircle2,
} from 'lucide-react';
import type { VaultSecurityAuditReport } from '../utils/audit';
import { generateSecurePassword } from '../utils/generator';
import { BarnabyMascot } from './CartoonIllustrations';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';

interface SecurityAuditViewProps {
  auditReport: VaultSecurityAuditReport;
  onQuickUpgradePassword: (credentialId: string, newPassword: string) => Promise<void>;
  onNotify?: (burst: string, title: string, tone?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export function SecurityAuditView({
  auditReport,
  onQuickUpgradePassword,
  onNotify,
}: SecurityAuditViewProps) {
  const [filterTab, setFilterTab] = useState<'all' | 'weak' | 'reused' | 'old'>('all');
  const [upgradedIds, setUpgradedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (
      auditReport.totalActiveCredentials > 0 &&
      auditReport.weakCount === 0 &&
      auditReport.reusedCount === 0
    ) {
      try {
        confetti({
          particleCount: 35,
          spread: 60,
          origin: { y: 0.7 },
        });
      } catch {
        // Ignora
      }
    }
  }, [
    auditReport.totalActiveCredentials,
    auditReport.weakCount,
    auditReport.reusedCount,
  ]);

  const filteredItems = auditReport.auditedItems.filter((item) => {
    if (filterTab === 'weak') return item.isWeak;
    if (filterTab === 'reused') return item.isReused;
    if (filterTab === 'old') return item.isOld;
    return item.needsReview;
  });

  const handleOneClickStrengthen = async (credentialId: string, serviceName: string) => {
    const strongPassword = generateSecurePassword({
      mode: 'random',
      length: 22,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      avoidAmbiguous: true,
      wordCount: 4,
      wordSeparator: '-',
      capitalizeWords: true,
      includeNumberInPassphrase: true,
    });
    await onQuickUpgradePassword(credentialId, strongPassword);
    setUpgradedIds((prev) => ({ ...prev, [credentialId]: true }));
    onNotify?.(
      'BLINDADO!',
      `A senha de "${serviceName}" foi substituída por uma senha forte de 22 caracteres!`,
      'success'
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              🛡️ Segurança do Cofre & Auditoria
            </h1>
            <ComicActionCallout text="ZXCVBN OFFLINE!" tone="emerald" />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-slate-400 mt-1">
            Análise local via motor <strong>zxcvbn</strong>. Nenhuma senha jamais é enviada para servidores ou APIs externas.
          </p>
        </div>
      </div>

      {/* Painel Principal de Saúde Neobrutal-UI + Mascote Comic */}
      <Card>
        <CardContent className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col items-center gap-4 text-center border-b-3 lg:border-b-0 lg:border-r-3 border-border pb-6 lg:pb-0 lg:pr-6">
            <div className="bg-[#E0F2FE] border-3 border-border rounded-2xl p-2 shadow-shadow animate-float">
              <BarnabyMascot
                size={116}
                mood={
                  auditReport.overallScore >= 85
                    ? 'celebrating'
                    : auditReport.overallScore >= 65
                      ? 'thinking'
                      : 'panic'
                }
              />
            </div>
            <div>
              <div className="font-display text-5xl font-black tabular-nums text-foreground">
                {auditReport.overallScore}
                <span className="text-xl text-stone-500">/100</span>
              </div>
              <p className="text-xs font-black uppercase tracking-wider text-pink mt-1">
                Índice de Blindagem Setor 7G
              </p>
              <ComicSpeechBubble
                speaker="INSPETOR BARNABY"
                tone={auditReport.overallScore >= 85 ? 'mint' : 'yellow'}
                tailDirection="top"
                className="mt-3"
              >
                {auditReport.healthHeadline}
              </ComicSpeechBubble>
            </div>
          </div>

          {/* Recomendações Práticas + Filtros */}
          <div className="lg:col-span-8 space-y-4">
            <h2 className="font-display text-lg font-black">
              Recomendações Práticas do Inspetor de Segurança
            </h2>
            <ul className="space-y-2.5">
              {auditReport.globalRecommendations.map((rec, idx) => (
                <li
                  key={idx}
                  className="p-3.5 rounded-base bg-background border-3 border-border shadow-[2px_2px_0px_0px_var(--border)] text-xs sm:text-sm font-bold flex items-start gap-2.5"
                >
                  <ShieldCheck className="w-4 h-4 text-[#0284C7] shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>

            {/* 4 Botões de Filtro Rápido da Auditoria */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`p-3 rounded-base border-3 border-border text-left cursor-pointer transition-all ${
                  filterTab === 'all'
                    ? 'bg-main text-main-foreground shadow-shadow -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Para Revisão</span>
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                </div>
                <p className="font-display text-2xl font-black tabular-nums mt-1">
                  {auditReport.needsReviewCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('weak')}
                className={`p-3 rounded-base border-3 border-border text-left cursor-pointer transition-all ${
                  filterTab === 'weak'
                    ? 'bg-rose-500 text-white shadow-shadow -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Senhas Fracas</span>
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                </div>
                <p className="font-display text-2xl font-black tabular-nums mt-1">
                  {auditReport.weakCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('reused')}
                className={`p-3 rounded-base border-3 border-border text-left cursor-pointer transition-all ${
                  filterTab === 'reused'
                    ? 'bg-amber-400 text-[#09090B] shadow-shadow -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Repetidas</span>
                  <Repeat className="w-4 h-4 text-amber-600" />
                </div>
                <p className="font-display text-2xl font-black tabular-nums mt-1">
                  {auditReport.reusedCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('old')}
                className={`p-3 rounded-base border-3 border-border text-left cursor-pointer transition-all ${
                  filterTab === 'old'
                    ? 'bg-sky text-sky-foreground shadow-shadow -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-black">
                  <span>Antigas (90d+)</span>
                  <Clock className="w-4 h-4 text-[#0284C7]" />
                </div>
                <p className="font-display text-2xl font-black tabular-nums mt-1">
                  {auditReport.oldCount}
                </p>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Credenciais Auditadas */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-black">
          Credenciais que Merecem Atenção ({filteredItems.length})
        </h2>

        {filteredItems.length === 0 ? (
          <Card className="p-8 text-center items-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="font-display text-lg font-black">
              WOO-HOO! Nenhuma vulnerabilidade encontrada neste filtro!
            </p>
            <p className="text-xs font-semibold text-stone-600 dark:text-slate-400">
              Suas rosquinhas digitais estão protegidas com excelência.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredItems.map((item) => (
              <Card key={item.credential.id} className="py-4">
                <CardContent className="px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-black">
                        {item.credential.serviceName}
                      </h3>
                      <span aria-hidden="true">·</span>
                      <span className="text-xs font-black text-rose-600 dark:text-rose-400">
                        {item.reasons.join(' · ')}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-stone-600 dark:text-slate-300">
                      Conta: <strong>{item.credential.username || item.credential.email}</strong> · Última atualização há{' '}
                      <span className="tabular-nums font-black">{item.ageDays}</span> dias
                    </p>
                    {item.recommendations[0] && (
                      <p className="text-xs text-stone-700 dark:text-slate-300 font-bold">
                        💡 {item.recommendations[0]}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Button
                      type="button"
                      variant={upgradedIds[item.credential.id] ? 'emerald' : 'default'}
                      size="sm"
                      onClick={() =>
                        handleOneClickStrengthen(
                          item.credential.id,
                          item.credential.serviceName
                        )
                      }
                    >
                      <Wand2 className="w-4 h-4" />
                      <span>
                        {upgradedIds[item.credential.id]
                          ? 'Senha Renovada!'
                          : 'Gerar Senha Forte Automaticamente'}
                      </span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
