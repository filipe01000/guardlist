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
import { BrandMark } from './BrandMark';
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
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold">
              Saúde das senhas
            </h1>
            <ComicActionCallout text="NESTE APARELHO" tone="emerald" />
          </div>
          <p className="text-sm font-semibold text-muted mt-1">
            A análise roda neste aparelho. Nenhuma senha é enviada para fora.
          </p>
        </div>
      </div>

      {/* Painel Principal de Saúde em vidro */}
      <Card>
        <CardContent className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col items-center gap-4 text-center border-b lg:border-b-0 lg:border-r-3 border-line pb-6 lg:pb-0 lg:pr-6">
            <div className="shrink-0">
              <BrandMark size={116} />
            </div>
            <div>
              <div className="font-display text-5xl font-extrabold tabular-nums text-foreground">
                {auditReport.overallScore}
                <span className="text-xl text-muted">/100</span>
              </div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent mt-1">
                Saúde das senhas
              </p>
              <ComicSpeechBubble
                speaker="Resumo"
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
            <h2 className="font-display text-lg font-extrabold">
              Recomendações Práticas do Inspetor de Segurança
            </h2>
            <ul className="space-y-2.5">
              {auditReport.globalRecommendations.map((rec, idx) => (
                <li
                  key={idx}
                  className="p-3.5 rounded-base bg-background border border-line text-xs sm:text-sm font-bold flex items-start gap-2.5"
                >
                  <ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>

            {/* 4 Botões de Filtro Rápido da Auditoria */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`p-3 rounded-base border border-line text-left cursor-pointer transition-all ${
                  filterTab === 'all'
                    ? 'bg-accent-soft text-accent border-main'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Para Revisão</span>
                  <AlertTriangle className="w-4 h-4 text-warning" />
                </div>
                <p className="font-display text-2xl font-extrabold tabular-nums mt-1">
                  {auditReport.needsReviewCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('weak')}
                className={`p-3 rounded-base border border-line text-left cursor-pointer transition-all ${
                  filterTab === 'weak'
                    ? 'bg-destructive text-destructive-foreground -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Senhas Fracas</span>
                  <ShieldAlert className="w-4 h-4 text-danger" />
                </div>
                <p className="font-display text-2xl font-extrabold tabular-nums mt-1">
                  {auditReport.weakCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('reused')}
                className={`p-3 rounded-base border border-line text-left cursor-pointer transition-all ${
                  filterTab === 'reused'
                    ? 'bg-warning/15 text-foreground -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Repetidas</span>
                  <Repeat className="w-4 h-4 text-warning" />
                </div>
                <p className="font-display text-2xl font-extrabold tabular-nums mt-1">
                  {auditReport.reusedCount}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('old')}
                className={`p-3 rounded-base border border-line text-left cursor-pointer transition-all ${
                  filterTab === 'old'
                    ? 'bg-surface-raised text-sky-foreground -translate-y-0.5'
                    : 'bg-background'
                }`}
              >
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>Antigas (90d+)</span>
                  <Clock className="w-4 h-4 text-accent" />
                </div>
                <p className="font-display text-2xl font-extrabold tabular-nums mt-1">
                  {auditReport.oldCount}
                </p>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Credenciais Auditadas */}
      <section className="space-y-3">
        <h2 className="font-display text-xl font-extrabold">
          Credenciais que Merecem Atenção ({filteredItems.length})
        </h2>

        {filteredItems.length === 0 ? (
          <Card className="p-8 text-center items-center">
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <p className="font-display text-lg font-extrabold">
              WOO-HOO! Nenhuma vulnerabilidade encontrada neste filtro!
            </p>
            <p className="text-xs font-semibold text-muted ">
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
                      <h3 className="font-display text-lg font-extrabold">
                        {item.credential.serviceName}
                      </h3>
                      <span aria-hidden="true">·</span>
                      <span className="text-xs font-semibold text-danger ">
                        {item.reasons.join(' · ')}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-muted ">
                      Conta: <strong>{item.credential.username || item.credential.email}</strong> · Última atualização há{' '}
                      <span className="tabular-nums font-semibold">{item.ageDays}</span> dias
                    </p>
                    {item.recommendations[0] && (
                      <p className="text-xs text-muted font-bold">
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
