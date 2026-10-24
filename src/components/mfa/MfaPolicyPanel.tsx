import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getMfaPolicy, setMfaPolicy, type MfaPolicy } from '../../db/store';

// Administração: liga e desliga a exigência da verificação em duas etapas para toda a equipe.
export const MfaPolicyPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [policy, setPolicy] = useState<MfaPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMfaPolicy().then(setPolicy).catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar.'));
  }, []);
  useEffect(load, [load]);

  const toggle = async () => {
    if (!policy) return;
    const on = !policy.required;
    if (on && !window.confirm(`Exigir a verificação em duas etapas para toda a equipe? ${policy.total - policy.enrolled} pessoa(s) ainda sem cadastro vão cadastrar no próximo login.`)) return;
    setBusy(true);
    setError(null);
    try {
      await setMfaPolicy(on);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível alterar.');
    } finally {
      setBusy(false);
    }
  };

  const blocked = policy && !policy.required && (!policy.available || !policy.selfEnrolled);
  return (
    <section className="data-panel p-5 mb-4" aria-labelledby="mfa-policy-title">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <ShieldCheck className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          <h2 id="mfa-policy-title" className="text-sm font-bold text-white">Verificação em duas etapas</h2>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            {policy
              ? `${policy.required ? 'Exigida para toda a equipe.' : 'Desligada: o login pede só usuário e senha.'} ${policy.enrolled} de ${policy.total} pessoas já cadastraram o autenticador.`
              : 'Carregando…'}
            {policy && !policy.available && ' Para ligar, defina MFA_SECRET_KEY no servidor.'}
            {policy && policy.available && !policy.selfEnrolled && !policy.required && ' Para ligar, cadastre antes a sua em Minha conta.'}
          </p>
          {error && <p className="text-xs text-rose-400 mt-2" role="alert">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={policy?.required ?? false}
          className={policy?.required ? 'btn' : 'btn btn--primary'}
          disabled={!policy || busy || Boolean(blocked)}
          onClick={toggle}
        >
          {policy?.required ? 'Desligar exigência' : 'Exigir para a equipe'}
        </button>
      </div>
    </section>
  );
};
