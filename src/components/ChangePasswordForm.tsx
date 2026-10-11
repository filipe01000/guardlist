import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { SessionUser } from '../types';

const MIN_PASSWORD = 10;

interface ChangePasswordFormProps {
  onDone: (user: SessionUser) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

// Troca da própria senha. Usado no primeiro acesso (obrigatório) e pelo perfil na barra lateral.
export const ChangePasswordForm: React.FC<ChangePasswordFormProps> = ({ onDone, onCancel, submitLabel = 'Salvar senha' }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < MIN_PASSWORD) return setError(`A nova senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    if (newPassword !== confirm) return setError('A confirmação não confere com a nova senha.');
    setSaving(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Não foi possível trocar a senha.');
      onDone(body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div>
        <label className="field-label" htmlFor="pw-current">Senha atual</label>
        <input id="pw-current" type="password" autoComplete="current-password" className="field w-full" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoFocus />
      </div>
      <div>
        <label className="field-label" htmlFor="pw-new">Nova senha</label>
        <input id="pw-new" type="password" autoComplete="new-password" className="field w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={MIN_PASSWORD} />
        <p className="text-[11px] text-slate-500 mt-1.5">Pelo menos {MIN_PASSWORD} caracteres. Uma frase longa é mais fácil de lembrar e mais segura.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="pw-confirm">Confirmar nova senha</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" className="field w-full" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-xs font-semibold text-rose-400" role="alert">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancelar</button>}
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {saving ? 'Salvando…' : submitLabel}
        </button>
      </div>
    </form>
  );
};
