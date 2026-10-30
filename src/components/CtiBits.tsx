import React from 'react';
import { CtiSummary } from '../types';

export const VERDICT_LABEL: Record<CtiSummary['verdict'], string> = {
  legit: 'Legítimo',
  scanner: 'Scanner conhecido',
  low: 'Baixo risco',
  medium: 'Médio',
  high: 'Alto risco',
  unknown: 'Sem dados'
};

export const VerdictBadge: React.FC<{ summary: CtiSummary }> = ({ summary }) => (
  <span className={`verdict verdict--${summary.verdict}`} title={summary.verdictReason || undefined}>
    {VERDICT_LABEL[summary.verdict]}
    {summary.score !== null && summary.verdict !== 'legit' && summary.verdict !== 'scanner' ? ` · ${summary.score}` : ''}
  </span>
);

// Linha compacta de triagem: veredito, ocorrências, domínio/provedor e país.
export const CtiInline: React.FC<{ summary: CtiSummary }> = ({ summary }) => (
  <span className="cti-meta">
    <VerdictBadge summary={summary} />
    {/* Sempre as quatro colunas, mesmo vazias, para alinhar uma linha com a outra. */}
    <span>{summary.totalReports !== null && `${summary.totalReports} ocorrência${summary.totalReports === 1 ? '' : 's'}`}</span>
    <span title={summary.countryCode || undefined}>{summary.countryCode}</span>
    <span className="cti-meta__domain" title={[summary.domain, summary.isp, summary.asn].filter(Boolean).join(' · ') || undefined}>
      {summary.domain || summary.isp}
    </span>
  </span>
);
