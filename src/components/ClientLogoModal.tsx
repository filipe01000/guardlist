import React, { useEffect, useRef, useState } from 'react';
import { Globe, ImageUp, Loader2, Trash2 } from 'lucide-react';
import type { Client } from '../types';
import { fetchLogoFromSite, setClientLogo } from '../db/store';
import { imageToCover } from '../utils/imageToCover';
import { Modal } from './Modal';

interface Props {
  client: Client | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

/** Capa do cliente: busca a logo no site dele ou recebe um arquivo; mostra antes de gravar. */
export const ClientLogoModal: React.FC<Props> = ({ client, onClose, onSaved }) => {
  const [site, setSite] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState<'fetch' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSite('');
    setPreview(client?.logo ?? null);
    setSource(null);
    setError(null);
  }, [client]);

  const fromSite = async () => {
    setBusy('fetch');
    setError(null);
    try {
      const found = await fetchLogoFromSite(site);
      setPreview(await imageToCover(found.dataUrl));
      setSource(found.source);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível buscar a logo.');
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setPreview(await imageToCover(file));
      setSource(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler a imagem.');
    }
  };

  const save = async (value: string | null) => {
    if (!client) return;
    setBusy('save');
    setError(null);
    try {
      await setClientLogo(client.id, value);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível gravar.');
    } finally {
      setBusy(null);
    }
  };

  const changed = preview !== (client?.logo ?? null);

  return (
    <Modal
      open={Boolean(client)}
      onClose={onClose}
      size="md"
      title={client ? `Capa de ${client.name}` : 'Capa do cliente'}
      subtitle="Aparece no card do cliente no Painel geral."
      footer={
        <>
          {client?.logo && (
            <button type="button" className="btn btn--quiet btn--danger" onClick={() => save(null)} disabled={busy !== null}>
              <Trash2 aria-hidden="true" /> Remover capa
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn--primary" onClick={() => save(preview)} disabled={!preview || !changed || busy !== null}>
            {busy === 'save' && <Loader2 className="animate-spin" aria-hidden="true" />} Salvar capa
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="logo-preview">
          {preview ? <img src={preview} alt={`Capa de ${client?.name ?? ''}`} /> : <span>Sem capa</span>}
        </div>
        {source && <p className="text-[11px] text-[var(--muted)] break-all">Origem: {source}</p>}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void fromSite();
          }}
        >
          <input
            className="field flex-1 min-w-0"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="site do cliente, ex.: embasa.ba.gov.br"
            aria-label="Site do cliente"
            spellCheck={false}
          />
          <button type="submit" className="btn" disabled={!site.trim() || busy !== null}>
            {busy === 'fetch' ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Globe aria-hidden="true" />}
            Buscar logo no site
          </button>
        </form>

        <div className="flex items-center gap-2">
          <button type="button" className="btn btn--sm btn--quiet" onClick={() => fileRef.current?.click()}>
            <ImageUp aria-hidden="true" /> Enviar imagem do computador
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
        </div>

        {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
      </div>
    </Modal>
  );
};
