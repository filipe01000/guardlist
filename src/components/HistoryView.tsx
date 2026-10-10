import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, 
  Calendar, 
  Building2, 
  TrendingUp, 
  Layers, 
  Filter, 
  Tag, 
  Clock, 
  CheckCircle2,
  FileSpreadsheet
} from 'lucide-react';
import { Client, ImportHistoryRecord } from '../types';
import { getHistoryRecords } from '../db/indexedDb';

interface HistoryViewProps {
  clients: Client[];
}

export const HistoryView: React.FC<HistoryViewProps> = ({ clients }) => {
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
      {/* Cabeçalho */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
              <History className="w-5 h-5 text-emerald-400" />
            </span>
            <h2 className="text-lg font-bold text-white">
              Histórico de Importações Semanais
            </h2>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Registro detalhado de cada ciclo de atualização com auditoria de novos IPs gravados e duplicatas descartadas.
          </p>
        </div>

        {/* Filtro por Cliente */}
        <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs">
          <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-slate-400">Cliente:</span>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="bg-slate-900 text-white rounded-lg px-2.5 py-1 border border-slate-700 focus:outline-none font-semibold"
          >
            <option value="ALL">Todos os Clientes</option>
            {clients.filter(c => !c.isArchived).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Gráfico Simples de Evolução por Semana */}
      {weeklyEvolution.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Volume de Novos Indicadores por Semana
            </h3>
            <span className="text-xs text-slate-400">
              Total de {weeklyEvolution.reduce((acc, w) => acc + w.added, 0)} novos IPs adicionados
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-2">
            {weeklyEvolution.map((item) => {
              const heightPct = Math.round((item.added / maxAdded) * 100);
              return (
                <div key={item.week} className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col justify-between">
                  <div className="text-[11px] font-mono text-slate-400 font-semibold mb-2 flex items-center justify-between">
                    <span>{item.week}</span>
                    <span className="text-emerald-400 font-bold">+{item.added}</span>
                  </div>

                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden my-1">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(10, heightPct)}%` }}
                    />
                  </div>

                  <div className="text-[10px] text-slate-500 mt-1 flex justify-between">
                    <span>Descartados:</span>
                    <span className="text-amber-400 font-mono">{item.discarded}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabela de Registros Históricos */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-3 px-4 w-40">Data &amp; Hora</th>
                <th className="py-3 px-3 w-28">Semana ISO</th>
                <th className="py-3 px-3 w-32">Cliente</th>
                <th className="py-3 px-3 w-28">Novos Adicionados</th>
                <th className="py-3 px-3 w-32">Duplicados Descartados</th>
                <th className="py-3 px-3 w-28">Inválidos</th>
                <th className="py-3 px-3 w-32">Fonte / Ticket</th>
                <th className="py-3 px-4">Observações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60 font-sans text-slate-300">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-500">
                    Nenhum registro de importação encontrado.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition">
                    {/* Data */}
                    <td className="py-3 px-4 font-mono text-slate-200 text-xs">
                      {new Date(r.date).toLocaleString('pt-BR')}
                    </td>

                    {/* Semana ISO */}
                    <td className="py-3 px-3 font-mono font-bold text-slate-300">
                      <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                        {r.isoWeek}
                      </span>
                    </td>

                    {/* Cliente */}
                    <td className="py-3 px-3 font-bold text-white">
                      {r.clientName}
                    </td>

                    {/* Novos */}
                    <td className="py-3 px-3 font-mono font-bold text-emerald-400">
                      +{r.addedCount}
                    </td>

                    {/* Duplicados Descartados */}
                    <td className="py-3 px-3 font-mono text-amber-400">
                      {r.duplicatesDiscarded + (r.coveredByCidrDiscarded || 0)}
                    </td>

                    {/* Inválidos */}
                    <td className="py-3 px-3 font-mono text-slate-400">
                      {r.invalidsDiscarded}
                    </td>

                    {/* Ticket */}
                    <td className="py-3 px-3 text-slate-300 font-mono">
                      {r.sourceTicket || '-'}
                    </td>

                    {/* Observações */}
                    <td className="py-3 px-4 text-slate-400 truncate max-w-xs" title={r.notes}>
                      {r.notes || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
