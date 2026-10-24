import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { disableMfa, getMfaStatus, regenerateMfaRecovery, type MfaStatus } from '../../db/store';
import { MfaCode, type VerifyResult } from './MfaCode';
import { MfaSetup, RecoveryCodes } from './MfaSetup';
import './Mfa.css';

// Minha conta: cadastrar o autenticador, gerar novos códigos de recuperação e (sem exigência) desligar.
type Mode = 'view' | 'setup' | 'recovery' | 'disable' | 'codes';

export const MfaAccount: React.FC = () => {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMfaStatus().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível carregar.'));
  }, []);
  useEffect(load, [load]);

  const withCode = (fn: (code: string) => Promise<void>) => async (code: string): Promise<VerifyResult> => {
    try {
      await fn(code);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Código incorreto.' };
    }
  };

  if (error) return <div className="notice notice--danger"><p>{error}</p></div>;
  if (!status) return <p className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Carregando…</p>;

  if (mode === 'setup') {
    return (
      <div className="space-y-3">
        <MfaSetup onDone={() => { setMode('view'); load(); }} />
        <button type="button" className="btn btn--quiet" onClick={() => setMode('view')}>Cancelar</button>
      </div>
    );
  }
  if (mode === 'codes') return <RecoveryCodes codes={codes} continueLabel="Concluir" onContinue={() => { setMode('view'); load(); }} />;
  if (mode === 'recovery' || mode === 'disable') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-300">
          {mode === 'recovery'
            ? 'Digite um código do aplicativo para gerar 10 novos códigos de recuperação. Os anteriores deixam de valer.'
            : 'Digite um código do aplicativo para desligar a verificação em duas etapas da sua conta.'}
        </p>
        <MfaCode
          plain
          verify={withCode(async (code) => {
            if (mode === 'recovery') {
              setCodes((await regenerateMfaRecovery(code)).recoveryCodes);
              setMode('codes');
            } else {
              await disableMfa(code);
              setMode('view');
              load();
            }
          })}
        />
        <button type="button" className="btn btn--quiet" onClick={() => setMode('view')}>Cancelar</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {status.enrolled ? <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" /> : <ShieldOff className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />}
        <div>
          <p className="text-sm font-semibold text-white">{status.enrolled ? 'Ativada nesta conta' : 'Não ativada'}</p>
          <p className="text-xs text-slate-400 mt-1">
            {status.enrolled
              ? `Desde ${new Date(status.enrolledAt!).toLocaleDateString('pt-BR')}. ${status.recoveryLeft} códigos de recuperação disponíveis.`
              : 'Além da senha, o login pede um código de 6 dígitos do aplicativo autenticador do seu celular.'}
            {status.required && ' O administrador exige a verificação para toda a equipe.'}
          </p>
        </div>
      </div>
      {!status.available ? (
        <p className="text-xs text-amber-300">Indisponível neste servidor: falta MFA_SECRET_KEY.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={status.enrolled ? 'btn' : 'btn btn--primary'} onClick={() => setMode('setup')}>
            {status.enrolled ? 'Cadastrar outro celular' : 'Ativar'}
          </button>
          {status.enrolled && <button type="button" className="btn" onClick={() => setMode('recovery')}>Gerar novos códigos de recuperação</button>}
          {status.enrolled && !status.required && <button type="button" className="btn btn--danger" onClick={() => setMode('disable')}>Desligar</button>}
        </div>
      )}
    </div>
  );
};
