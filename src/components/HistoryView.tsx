import React, { useState, useEffect, useMemo } from 'react';
import { FileSearch, History, Loader2, Upload } from 'lucide-react';
import { Client, ImportHistoryRecord } from '../types';
import { getHistoryRecords } from '../db/store';
import { PageHeader } from './PageHeader';
import { requestImportReport } from './contextActions';

interface HistoryViewProps {
  clients: Client[];
  onStartImport?: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ clients, onStartImport }) => {
  const [selectedClientId, setSelectedClientId] = useState<string>('ALL');
  const [records, setRecords] = useState<ImportHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await getHistoryRecords(selectedClientId);
        setRecords(data);
      } catch (err) {
        console.error('Erro ao carregar histórico:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [selectedClientId]);

  // Agrupamento por dia (os bloqueios são diários): os 14 dias mais recentes com importação, do mais antigo ao mais novo.
  const dailyEvolution = useMemo(() => {
    const map = new Map<string, { day: string; added: number; discarded: number; count: number }>();
    for (const r of records) {
      const parsed = new Date(r.date);
      const day = Number.isNaN(parsed.getTime())
        ? r.date.slice(0, 10)
        : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      if (!map.has(day)) map.set(day, { day, added: 0, discarded: 0, count: 0 });
      const data = map.get(day)!;
      data.added += r.addedCount;
      data.discarded += r.duplicatesDiscarded + r.coveredByCidrDiscarded;
      data.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14).reverse();
  }, [records]);

  const maxAdded = Math.max(...dailyEvolution.map(w => w.added), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Histórico de importações"
        description="Cada importação gravada, com o que entrou e o que foi descartado."
        actions={
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="field"
            aria-label="Filtrar por cliente"
          >
            <option value="ALL">Todos os clientes</option>
            {clients.filter(c => !c.isArchived).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        }
      />

      {isLoading && records.length === 0 ? (
        <div className="data-panel">
          <div className="empty-state"><Loader2 className="animate-spin" aria-hidden="true" /><p>Carregando o histórico…</p></div>
        </div>
      ) : records.length === 0 ? (
        <div className="data-panel">
          <div className="empty-state">
            <History aria-hidden="true" />
            <strong>Nenhuma importação registrada</strong>
            <p>
              {selectedClientId === 'ALL'
                ? 'Quando a primeira lista for gravada, ela aparece aqui com o resumo e o relatório do que entrou e do que foi descartado.'
                : 'Este cliente ainda não tem importações gravadas.'}
            </p>
            {onStartImport && (
              <button type="button" className="btn btn--primary" onClick={onStartImport}>
                <Upload aria-hidden="true" />
                Ir para a importação
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {dailyEvolution.length > 0 && (
            <section className="data-panel" aria-labelledby="daily-volume-title">
              <header className="data-panel__header">
                <h2 id="daily-volume-title">Novos indicadores por dia</h2>
                <span>{dailyEvolution.reduce((acc, w) => acc + w.added, 0)} nos últimos {dailyEvolution.length} {dailyEvolution.length === 1 ? 'dia com importação' : 'dias com importação'}</span>
              </header>
              <div className="week-bars">
                {dailyEvolution.map((item) => {
                  const pct = Math.round((item.added / Math.max(1, maxAdded)) * 100);
                  return (
                    <div key={item.day} className="week-bars__item">
                      <span className="week-bars__value">+{item.added}</span>
                      <span className="week-bars__track" aria-hidden="true">
                        <i style={{ height: `${Math.max(6, pct)}%` }} />
                      </span>
                      <span className="week-bars__label">{item.day.slice(8, 10)}/{item.day.slice(5, 7)}</span>
                      <span className="week-bars__discarded">{item.discarded} descartados</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="data-panel">
            <div className="overflow-x-auto">
              <table className="data-table" style={{ minWidth: 980 }}>
                <colgroup>
                  <col style={{ width: '136px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '70px' }} />
                  <col style={{ width: '104px' }} />
                  <col style={{ width: '84px' }} />
                  <col style={{ width: '110px' }} />
                  <col />
                  <col style={{ width: '86px' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Cliente</th>
                    <th>Por</th>
                    <th className="text-right">Novos</th>
                    <th className="text-right">Descartados</th>
                    <th className="text-right">Inválidos</th>
                    <th>Ticket</th>
                    <th>Observações</th>
                    <th className="text-right">Relatório</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono whitespace-nowrap">{new Date(r.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="font-mono font-semibold text-white">{r.clientName}</td>
                      <td className="truncate" title={r.importedBy}>{r.importedBy || '—'}</td>
                      <td className="text-right font-mono tabular-nums text-emerald-400">+{r.addedCount}</td>
                      <td className="text-right font-mono tabular-nums">{r.duplicatesDiscarded + (r.coveredByCidrDiscarded || 0)}</td>
                      <td className="text-right font-mono tabular-nums">{r.invalidsDiscarded}</td>
                      <td className="font-mono">{r.sourceTicket || '—'}</td>
                      <td><span className="data-table__clamp" title={r.notes}>{r.notes || '—'}</span></td>
                      <td className="text-right">
                        <button type="button" className="btn btn--sm btn--quiet" onClick={() => requestImportReport(r.id)} title="O que entrou, repetidos, dentro de CIDR, inválidos e o resto">
                          <FileSearch aria-hidden="true" /> Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
