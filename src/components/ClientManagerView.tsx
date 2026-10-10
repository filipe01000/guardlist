import React, { useState } from 'react';
import { Building2, Plus, Edit2, Archive, ArchiveRestore, Check, X, Shield } from 'lucide-react';
import { Client } from '../types';
import { saveClient, renameClient, archiveClient } from '../db/indexedDb';

interface ClientManagerViewProps {
  clients: Client[];
  activeCounts: Record<string, number>;
  onRefreshClients: () => void;
}

export const ClientManagerView: React.FC<ClientManagerViewProps> = ({
  clients,
  activeCounts,
  onRefreshClients
}) => {
  const [newClientName, setNewClientName] = useState('');
  const [newClientNotes, setNewClientNotes] = useState('');
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editNameText, setEditNameText] = useState('');

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newClientName.trim().toUpperCase();
    if (!cleanName) return;

    const exists = clients.some(c => c.name.toUpperCase() === cleanName);
    if (exists) {
      alert('Já existe um cliente com este nome cadastrado.');
      return;
    }

    const newClient: Client = {
      id: `client-${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_')}-${Date.now()}`,
      name: cleanName,
      isArchived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastUpdateDate: null,
      notes: newClientNotes.trim() || undefined
    };

    await saveClient(newClient);
    setNewClientName('');
    setNewClientNotes('');
    onRefreshClients();
  };

  const handleStartRename = (client: Client) => {
    setEditingClientId(client.id);
    setEditNameText(client.name);
  };

  const handleSaveRename = async (clientId: string) => {
    const clean = editNameText.trim().toUpperCase();
    if (!clean) return;
    await renameClient(clientId, clean);
    setEditingClientId(null);
    onRefreshClients();
  };

  const handleToggleArchive = async (client: Client) => {
    const next = !client.isArchived;
    const msg = next
      ? `Deseja arquivar o cliente ${client.name}? Ele ficará oculto do painel ativo, mas seus dados permanecerão salvos no IndexedDB.`
      : `Deseja desarquivar o cliente ${client.name}?`;

    if (window.confirm(msg)) {
      await archiveClient(client.id, next);
      onRefreshClients();
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              Gerenciamento de Clientes
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Cadastre novos clientes, renomeie ou arquive contratos mantendo a integridade isolada de cada blocklist.
            </p>
          </div>
        </div>
      </div>

      {/* Formulário de Adicionar Cliente */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-400" />
          Cadastrar Novo Cliente
        </h3>
        <form onSubmit={handleAddClient} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-300 font-medium mb-1">
              Nome do Cliente:
            </label>
            <input
              type="text"
              required
              placeholder="Ex: HOSPITAL SANTO ANTONIO"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="w-full bg-slate-950 text-white text-xs p-2.5 rounded-xl border border-slate-700 uppercase focus:outline-none focus:border-blue-500 font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 font-medium mb-1">
              Observações / Tipo de Firewall:
            </label>
            <input
              type="text"
              placeholder="Ex: Firewall Fortigate 100F borda DMZ"
              value={newClientNotes}
              onChange={(e) => setNewClientNotes(e.target.value)}
              className="w-full bg-slate-950 text-white text-xs p-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2.5 px-4 rounded-xl shadow transition cursor-pointer"
            >
              Adicionar Cliente
            </button>
          </div>
        </form>
      </div>

      {/* Lista de Clientes */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-white">Clientes Cadastrados ({clients.length})</span>
          <span>Regra estrita: blocklists nunca se misturam</span>
        </div>

        <div className="divide-y divide-slate-800/80">
          {clients.map((client) => {
            const count = activeCounts[client.id] || 0;
            const isEditing = editingClientId === client.id;

            return (
              <div
                key={client.id}
                className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                  client.isArchived ? 'opacity-50 bg-slate-950/40' : 'hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-800 text-slate-300 rounded-lg">
                    <Shield className="w-5 h-5 text-blue-400" />
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNameText}
                        onChange={(e) => setEditNameText(e.target.value)}
                        className="bg-slate-950 text-white text-xs p-1.5 rounded-lg border border-blue-500 uppercase font-mono font-bold"
                      />
                      <button
                        onClick={() => handleSaveRename(client.id)}
                        className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500"
                        title="Salvar"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingClientId(null)}
                        className="p-1.5 bg-slate-800 text-slate-400 rounded hover:text-white"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono text-sm">
                          {client.name}
                        </span>
                        {client.isArchived && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            Arquivado
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {client.notes || 'Sem observações adicionais.'}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px]">Entradas Ativas</span>
                    <strong className="text-white font-mono">{count}</strong>
                  </div>

                  <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
                    <button
                      onClick={() => handleStartRename(client)}
                      className="p-1.5 text-slate-400 hover:text-blue-400 rounded hover:bg-slate-800 transition"
                      title="Renomear Cliente"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleToggleArchive(client)}
                      className={`p-1.5 rounded transition ${
                        client.isArchived
                          ? 'text-emerald-400 hover:bg-slate-800'
                          : 'text-slate-400 hover:text-amber-400 hover:bg-slate-800'
                      }`}
                      title={client.isArchived ? 'Desarquivar Cliente' : 'Arquivar Cliente'}
                    >
                      {client.isArchived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
