import React from 'react';
import { CtiSummary } from '../types';

export const VERDICT_LABEL: Record<CtiSummary['verdict'], string> = {
  legit: 'Legítimo',
  low: 'Baixo risco',
  medium: 'Médio',
  high: 'Alto risco',
  unknown: 'Sem dados'
};

export const VerdictBadge: React.FC<{ summary: CtiSummary }> = ({ summary }) => (
  <span className={`verdict verdict--${summary.verdict}`} title={summary.verdictReason || undefined}>
    {VERDICT_LABEL[summary.verdict]}
    {summary.score !== null && summary.verdict !== 'legit' ? ` · ${summary.score}` : ''}
  </span>
);

// Linha compacta de triagem: veredito, ocorrências, domínio/provedor e país.
export const CtiInline: React.FC<{ summary: CtiSummary }> = ({ summary }) => (
  <span className="cti-meta">
    <VerdictBadge summary={summary} />
    {summary.totalReports !== null && <span>{summary.totalReports} ocorrência{summary.totalReports === 1 ? '' : 's'}</span>}
    {(summary.domain || summary.isp) && (
      <span className="cti-meta__domain" title={[summary.domain, summary.isp, summary.asn].filter(Boolean).join(' · ')}>
        {summary.domain || summary.isp}
      </span>
    )}
    {summary.countryCode && <span title={summary.countryCode}>{summary.countryCode}</span>}
  </span>
);
