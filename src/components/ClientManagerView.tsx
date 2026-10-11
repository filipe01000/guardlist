import React, { useState } from 'react';
import { Plus, Edit2, Archive, ArchiveRestore, Check, X } from 'lucide-react';
import { Client } from '../types';
import { saveClient, updateClient, archiveClient } from '../db/store';
import { PageHeader } from './PageHeader';

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
  const [editNotesText, setEditNotesText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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

  const handleStartEdit = (client: Client) => {
    setEditingClientId(client.id);
    setEditNameText(client.name);
    setEditNotesText(client.notes || '');
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingClientId(null);
    setEditError(null);
  };

  const handleSaveEdit = async (client: Client) => {
    const name = editNameText.trim().toUpperCase();
    if (!name) return setEditError('Informe o nome do cliente.');
    const changes: { name?: string; notes?: string } = {};
    if (name !== client.name) changes.name = name;
    if (editNotesText.trim() !== (client.notes || '')) changes.notes = editNotesText;
    if (Object.keys(changes).length === 0) return handleCancelEdit();

    setSavingEdit(true);
    try {
      await updateClient(client.id, changes);
      setEditingClientId(null);
      onRefreshClients();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleArchive = async (client: Client) => {
    const next = !client.isArchived;
    const msg = next
      ? `Deseja arquivar o cliente ${client.name}? Ele sai do painel para toda a equipe, mas os dados continuam guardados.`
      : `Deseja desarquivar o cliente ${client.name}?`;

    if (window.confirm(msg)) {
      await archiveClient(client.id, next);
      onRefreshClients();
    }
  };

  const activeTotal = clients.filter(c => !c.isArchived).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gerenciar clientes"
        description="Cadastre, renomeie ou arquive clientes. Cada cliente tem a própria lista, sem mistura com as outras."
      />

      <section className="data-panel p-5" aria-labelledby="new-client-title">
        <h2 id="new-client-title" className="text-sm font-bold text-white mb-4">Novo cliente</h2>
        <form onSubmit={handleAddClient} className="grid grid-cols-1 md:grid-cols-[1fr_1.4fr_auto] gap-3 items-end">
          <div>
            <label className="field-label" htmlFor="new-client-name">Nome</label>
            <input
              id="new-client-name"
              type="text"
              required
              placeholder="HOSPITAL SANTO ANTONIO"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              className="field w-full uppercase font-mono font-semibold"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new-client-notes">Firewall ou observação <span className="text-slate-500 font-normal">(opcional)</span></label>
            <input
              id="new-client-notes"
              type="text"
              placeholder="FortiGate 100F na borda da DMZ"
              value={newClientNotes}
              onChange={(e) => setNewClientNotes(e.target.value)}
              className="field w-full"
            />
          </div>
          <button type="submit" className="btn btn--primary h-9">
            <Plus aria-hidden="true" />
            Adicionar
          </button>
        </form>
      </section>

      <section className="data-panel" aria-labelledby="client-list-title">
        <header className="data-panel__header">
          <h2 id="client-list-title">Clientes</h2>
          <span>{activeTotal} ativos{clients.length > activeTotal ? ` · ${clients.length - activeTotal} arquivados` : ''}</span>
        </header>

        <ul className="client-rows">
          {clients.map((client) => {
            const count = activeCounts[client.id] || 0;
            const isEditing = editingClientId === client.id;

            return (
              <li key={client.id} className={`client-row ${client.isArchived ? 'is-archived' : ''} ${isEditing ? 'is-editing' : ''}`}>
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <form
                      className="client-edit view-enter"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveEdit(client);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') handleCancelEdit();
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit(client);
                      }}
                    >
                      <div>
                        <label className="field-label" htmlFor={`edit-name-${client.id}`}>Nome</label>
                        <input
                          id={`edit-name-${client.id}`}
                          type="text"
                          value={editNameText}
                          autoFocus
                          onChange={(e) => setEditNameText(e.target.value)}
                          className="field w-full uppercase font-mono font-bold"
                        />
                      </div>
                      <div>
                        <label className="field-label" htmlFor={`edit-notes-${client.id}`}>Observações</label>
                        <textarea
                          id={`edit-notes-${client.id}`}
                          rows={3}
                          maxLength={1000}
                          value={editNotesText}
                          onChange={(e) => setEditNotesText(e.target.value)}
                          placeholder="Firewall, contato do cliente, janela de manutenção, particularidades da lista…"
                          className="field w-full py-2 leading-relaxed resize-y"
                        />
                      </div>
                      {editError && <p className="text-xs font-semibold text-rose-400" role="alert">{editError}</p>}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">Ctrl+Enter salva · Esc cancela</span>
                        <span className="flex gap-1.5">
                          <button type="button" onClick={handleCancelEdit} className="btn btn--sm">
                            <X aria-hidden="true" />
                            Cancelar
                          </button>
                          <button type="submit" className="btn btn--sm btn--primary" disabled={savingEdit}>
                            <Check aria-hidden="true" />
                            {savingEdit ? 'Salvando…' : 'Salvar'}
                          </button>
                        </span>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono text-sm">{client.name}</span>
                        {client.isArchived && <span className="chip">Arquivado</span>}
                      </div>
                      {client.notes ? (
                        <p className="client-row__notes" title={client.notes}>{client.notes}</p>
                      ) : (
                        <button type="button" className="client-row__add-notes" onClick={() => handleStartEdit(client)}>
                          Adicionar observação
                        </button>
                      )}
                    </>
                  )}
                </div>

                <div className={`flex items-center gap-4 ${isEditing ? 'self-start' : ''}`}>
                  <div className="text-right">
                    <strong className="block text-white font-mono tabular-nums">{count}</strong>
                    <span className="text-slate-500 text-[11px]">ativos</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => (isEditing ? handleCancelEdit() : handleStartEdit(client))}
                      className="btn btn--sm btn--icon btn--quiet"
                      title="Editar nome e observações"
                      aria-label={`Editar ${client.name}`}
                      aria-pressed={isEditing}
                    >
                      <Edit2 aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleArchive(client)}
                      className="btn btn--sm btn--icon btn--quiet"
                      title={client.isArchived ? 'Desarquivar' : 'Arquivar'}
                      aria-label={`${client.isArchived ? 'Desarquivar' : 'Arquivar'} ${client.name}`}
                    >
                      {client.isArchived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
