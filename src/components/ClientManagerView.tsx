import React, { useState } from 'react';
import { Plus, Edit2, Archive, ArchiveRestore, Check, X, Trash2, ImageIcon } from 'lucide-react';
import { ClientLogoModal } from './ClientLogoModal';
import { Client } from '../types';
import { saveClient, updateClient, archiveClient, deleteClient } from '../db/store';
import { PageHeader } from './PageHeader';

interface ClientManagerViewProps {
  clients: Client[];
  activeCounts: Record<string, number>;
  onRefreshClients: () => void;
  isAdmin: boolean;
}

export const ClientManagerView: React.FC<ClientManagerViewProps> = ({
  clients,
  activeCounts,
  onRefreshClients,
  isAdmin
}) => {
  const [newClientName, setNewClientName] = useState('');
  const [newClientNotes, setNewClientNotes] = useState('');
  const [logoClient, setLogoClient] = useState<Client | null>(null);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editNameText, setEditNameText] = useState('');
  const [editNotesText, setEditNotesText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const openDelete = (client: Client) => {
    setDeleteTarget(client);
    setDeleteConfirm('');
    setDeleteError(null);
  };

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const removed = await deleteClient(deleteTarget.id, deleteConfirm);
      setNotice(`${deleteTarget.name} foi apagado, com ${removed.entries} indicadores, ${removed.history} importações no histórico e ${removed.snapshots} versões.`);
      setDeleteTarget(null);
      if (editingClientId === deleteTarget.id) setEditingClientId(null);
      onRefreshClients();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Não foi possível apagar o cliente.');
    } finally {
      setDeleting(false);
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
        description="Cadastre, edite ou arquive clientes. Cada cliente tem a própria lista, sem mistura com as outras."
      />

      {notice && (
        <div className="notice notice--ok" role="status">
          <Check aria-hidden="true" />
          <p>{notice}</p>
          <button type="button" className="btn btn--sm btn--quiet" onClick={() => setNotice(null)} aria-label="Fechar aviso">
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-client-title"
            className="data-panel w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setDeleteTarget(null)}
            onSubmit={handleDelete}
          >
            <div>
              <h2 id="delete-client-title" className="text-base font-bold text-white">
                Apagar <span className="font-mono">{deleteTarget.name}</span>?
              </h2>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Isso apaga, para toda a equipe, a lista de indicadores, as versões salvas e o histórico de importações deste cliente.
                Não dá para desfazer pelo app. Se a ideia é só tirar o cliente do painel, use <strong>Arquivar</strong>.
              </p>
              <p className="text-xs text-slate-400 mt-2">Se precisar de uma cópia, baixe um backup antes em Backup e ajustes.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="delete-client-confirm">
                Digite <span className="font-mono text-white">{deleteTarget.name}</span> para confirmar
              </label>
              <input
                id="delete-client-confirm"
                className="field w-full font-mono uppercase"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                autoComplete="off"
                autoFocus
              />
            </div>
            {deleteError && <p className="text-xs font-semibold text-rose-400" role="alert">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button
                type="submit"
                className="btn btn--danger"
                disabled={deleting || deleteConfirm.trim().toUpperCase() !== deleteTarget.name.toUpperCase()}
              >
                <Trash2 aria-hidden="true" />
                {deleting ? 'Apagando…' : 'Apagar cliente'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                <button type="button" className="client-row__cover" onClick={() => setLogoClient(client)} title="Trocar a capa" aria-label={`Capa de ${client.name}`}>
                  {client.logo ? <img src={client.logo} alt="" /> : <span>{client.name.slice(0, 2)}</span>}
                </button>
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
                      onClick={() => setLogoClient(client)}
                      className="btn btn--sm btn--icon btn--quiet"
                      title="Capa do cliente (logo)"
                      aria-label={`Capa de ${client.name}`}
                    >
                      <ImageIcon aria-hidden="true" />
                    </button>
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
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => openDelete(client)}
                        className="btn btn--sm btn--icon btn--quiet btn--danger"
                        title="Apagar cliente definitivamente"
                        aria-label={`Apagar ${client.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <ClientLogoModal client={logoClient} onClose={() => setLogoClient(null)} onSaved={onRefreshClients} />
    </div>
  );
};
