/**
 * Apoio de CTI do lado do navegador: resumo do AbuseIPDB para a lista do cliente e o histórico local
 * de um indicador para o dossiê. A reputação em si vem sempre do servidor (server/cti.ts), com dados reais.
 */

import { BlocklistEntry, Client, IndicatorStatus } from '../types';

export type CtiSourceStatus = 'ok' | 'not_configured' | 'not_found' | 'rate_limited' | 'error';

export interface AbuseListSummary {
  indicator: string;
  fetchedAt: string;
  cached?: boolean;
  status: CtiSourceStatus;
  data?: {
    domain: string | null;
    hostnames: string[];
    totalReports: number;
    lastReportedAt: string | null;
    abuseConfidenceScore: number;
  };
  message?: string;
}

export async function fetchAbuseListSummary(
  indicator: string,
  options: { signal?: AbortSignal; forceRefresh?: boolean } = {}
): Promise<AbuseListSummary> {
  const query = options.forceRefresh ? '?refresh=1' : '';
  const response = await fetch(`/api/abuse-summary/${encodeURIComponent(indicator)}${query}`, {
    signal: options.signal,
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Falha ao consultar o resumo do AbuseIPDB.');
  return body as AbuseListSummary;
}

export interface LocalDossier {
  /** Um registro por cliente: o ativo tem preferência; entre iguais, o mais recente. */
  correlatedClients: Array<{
    clientId: string;
    clientName: string;
    addedDate: string;
    ticket?: string;
    status: IndicatorStatus;
    notes?: string;
  }>;
  /** Inclusões e remoções registradas no GuardList, da mais recente para a mais antiga. */
  timeline: Array<{
    date: string;
    clientName: string;
    event: 'inclusao' | 'remocao';
    description: string;
    source: string;
  }>;
}

/** Histórico do indicador nas listas dos clientes: só o que está registrado no GuardList. */
export function localDossier(indicator: string, allEntries: BlocklistEntry[], clientsMap: Map<string, Client>): LocalDossier {
  const target = indicator.toLowerCase();
  const occurrences = allEntries
    .filter((e) => e.indicator.toLowerCase() === target)
    .map((e) => ({
      clientId: e.clientId,
      clientName: clientsMap.get(e.clientId)?.name ?? e.clientId,
      addedDate: e.addedDate,
      ticket: e.sourceTicket,
      status: e.status,
      notes: e.notes,
      removedAt: e.removedAt
    }));

  // Reimportações preservam registros antigos; disseminação conta clientes distintos.
  const byClient = new Map<string, LocalDossier['correlatedClients'][number]>();
  for (const occurrence of occurrences) {
    const previous = byClient.get(occurrence.clientId);
    if (!previous || (occurrence.status === 'active' && previous.status !== 'active')
      || (occurrence.status === previous.status && occurrence.addedDate > previous.addedDate)) {
      const { removedAt: _removedAt, ...kept } = occurrence;
      byClient.set(occurrence.clientId, kept);
    }
  }

  const timeline: LocalDossier['timeline'] = [];
  for (const o of occurrences) {
    timeline.push({
      date: o.addedDate,
      clientName: o.clientName,
      event: 'inclusao',
      description: `Incluído na lista (${o.ticket || 'sem ticket'}).`,
      source: o.ticket || 'GuardList'
    });
    if (o.status === 'removed' && o.removedAt) {
      timeline.push({
        date: o.removedAt.slice(0, 10),
        clientName: o.clientName,
        event: 'remocao',
        description: 'Retirado da lista (histórico preservado).',
        source: 'GuardList'
      });
    }
  }
  timeline.sort((a, b) => b.date.localeCompare(a.date));

  return { correlatedClients: [...byClient.values()], timeline };
}
