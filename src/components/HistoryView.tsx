import React, { useState, useEffect, useMemo } from 'react';
import { History, Upload } from 'lucide-react';
import { Client, ImportHistoryRecord } from '../types';
import { getHistoryRecords } from '../db/store';
import { PageHeader } from './PageHeader';

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

  // Agrupamento por semana para o gráfico de evolução
  const weeklyEvolution = useMemo(() => {
    const map = new Map<string, { week: string; added: number; discarded: number; count: number }>();

    for (const r of records) {
      const wk = r.isoWeek || 'Semana';
      if (!map.has(wk)) {
        map.set(wk, { week: wk, added: 0, discarded: 0, count: 0 });
      }
      const data = map.get(wk)!;
      data.added += r.addedCount;
      data.discarded += r.duplicatesDiscarded + r.coveredByCidrDiscarded;
      data.count += 1;
    }

    return Array.from(map.values()).slice(0, 10);
  }, [records]);

  const maxAdded = Math.max(...weeklyEvolution.map(w => w.added), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Histórico semanal"
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

      {records.length === 0 ? (
        <div className="data-panel">
          <div className="empty-state">
            <History aria-hidden="true" />
            <strong>Nenhuma importação registrada</strong>
            <p>
              {selectedClientId === 'ALL'
                ? 'Quando a primeira lista da semana for gravada, ela aparece aqui com o resumo do que entrou e do que foi descartado.'
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
          {weeklyEvolution.length > 0 && (
            <section className="data-panel" aria-labelledby="weekly-volume-title">
              <header className="data-panel__header">
                <h2 id="weekly-volume-title">Novos indicadores por semana</h2>
                <span>{weeklyEvolution.reduce((acc, w) => acc + w.added, 0)} no período</span>
              </header>
              <div className="week-bars">
                {weeklyEvolution.map((item) => {
                  const pct = Math.round((item.added / Math.max(1, maxAdded)) * 100);
                  return (
                    <div key={item.week} className="week-bars__item">
                      <span className="week-bars__value">+{item.added}</span>
                      <span className="week-bars__track" aria-hidden="true">
                        <i style={{ height: `${Math.max(6, pct)}%` }} />
                      </span>
                      <span className="week-bars__label">{item.week.replace(/^\d{4}-/, '')}</span>
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
                  <col style={{ width: '92px' }} />
                  <col style={{ width: '120px' }} />
                  <col style={{ width: '130px' }} />
                  <col style={{ width: '70px' }} />
                  <col style={{ width: '104px' }} />
                  <col style={{ width: '84px' }} />
                  <col style={{ width: '110px' }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Semana</th>
                    <th>Cliente</th>
                    <th>Por</th>
                    <th className="text-right">Novos</th>
                    <th className="text-right">Descartados</th>
                    <th className="text-right">Inválidos</th>
                    <th>Ticket</th>
                    <th>Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono whitespace-nowrap">{new Date(r.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td><span className="data-tag">{r.isoWeek}</span></td>
                      <td className="font-mono font-semibold text-white">{r.clientName}</td>
                      <td className="truncate" title={r.importedBy}>{r.importedBy || '—'}</td>
                      <td className="text-right font-mono tabular-nums text-emerald-400">+{r.addedCount}</td>
                      <td className="text-right font-mono tabular-nums">{r.duplicatesDiscarded + (r.coveredByCidrDiscarded || 0)}</td>
                      <td className="text-right font-mono tabular-nums">{r.invalidsDiscarded}</td>
                      <td className="font-mono">{r.sourceTicket || '—'}</td>
                      <td><span className="data-table__clamp" title={r.notes}>{r.notes || '—'}</span></td>
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
