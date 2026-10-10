import React, { useState } from 'react';
import { Building2, Plus, AlertCircle } from 'lucide-react';
import { ClientName } from '../types/blocklist';

interface ClientFilterBarProps {
  clients: ClientName[];
  selectedClient: ClientName | 'ALL';
  onSelectClient: (client: ClientName | 'ALL') => void;
  clientCounts: Record<string, { total: number; duplicates: number }>;
  onAddClient: (name: string) => void;
}

export const ClientFilterBar: React.FC<ClientFilterBarProps> = ({
  clients,
  selectedClient,
  onSelectClient,
  clientCounts,
  onAddClient
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newClientName.trim()) {
      onAddClient(newClientName.trim().toUpperCase());
      setNewClientName('');
      setIsAdding(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border-b border-slate-800 px-4 sm:px-6 lg:px-8 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 overflow-x-auto pb-1">
        <div className="flex items-center gap-1.5 flex-nowrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
            <Building2 className="w-3.5 h-3.5 text-blue-400" />
            Clientes:
          </span>

          {/* "ALL" Button */}
          <button
            onClick={() => onSelectClient('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
              selectedClient === 'ALL'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60'
            }`}
          >
            <span>Todos os Clientes</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
              selectedClient === 'ALL' ? 'bg-blue-800 text-blue-100' : 'bg-slate-700 text-slate-300'
            }`}>
              {Object.values(clientCounts).reduce((acc, curr) => acc + curr.total, 0)}
            </span>
          </button>

          {/* Client Specific Buttons */}
          {clients.map((client) => {
            const counts = clientCounts[client] || { total: 0, duplicates: 0 };
            const isSelected = selectedClient === client;
            const hasDuplicates = counts.duplicates > 0;

            return (
              <button
                key={client}
                onClick={() => onSelectClient(client)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 whitespace-nowrap ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60'
                }`}
              >
                <span>{client}</span>
                
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-semibold ${
                  isSelected ? 'bg-blue-800 text-blue-100' : 'bg-slate-700 text-slate-300'
                }`}>
                  {counts.total}
                </span>

                {hasDuplicates && (
                  <span
                    className="inline-flex items-center text-[10px] font-bold text-rose-300 bg-rose-950/80 border border-rose-800 px-1.5 py-0.2 rounded-full"
                    title={`${counts.duplicates} IP(s) duplicado(s) neste cliente!`}
                  >
                    <AlertCircle className="w-2.5 h-2.5 mr-0.5 text-rose-400" />
                    {counts.duplicates} dup
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Add client modal trigger or inline button */}
        <div className="flex items-center shrink-0">
          {isAdding ? (
            <form onSubmit={handleCreate} className="flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                placeholder="NOME DO CLIENTE"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                className="bg-slate-950 text-white text-xs px-2.5 py-1.5 rounded-md border border-blue-500 focus:outline-none uppercase"
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1.5 rounded-md font-medium"
              >
                Adicionar
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="bg-slate-800 text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded-md"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="text-xs text-slate-400 hover:text-blue-400 p-1.5 rounded-md hover:bg-slate-800 flex items-center gap-1 transition"
              title="Cadastrar novo cliente"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Novo Cliente</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
