import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { SessionUser } from '../../types';
import { MfaCode, type VerifyResult } from './MfaCode';
import './Mfa.css';

// Cadastro do aplicativo autenticador: QR code (ou a chave para digitar), confirmação com o primeiro código
// e, por fim, os 10 códigos de recuperação, mostrados uma única vez.

interface Setup { secret: string; uri: string; qrSvg: string }

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir.'), { status: res.status, code: data.code });
  return data as T;
}

export const MfaSetup: React.FC<{ onDone: (user: SessionUser) => void; onExpired?: () => void }> = ({ onDone, onExpired }) => {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/auth/mfa/setup', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data.code === 'MFA_STEP_EXPIRED') { onExpired?.(); return; }
        if (!res.ok) throw new Error(data.error || 'Não foi possível iniciar o cadastro.');
        setSetup(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível iniciar o cadastro.'));
  }, [onExpired]);

  const confirm = async (code: string): Promise<VerifyResult> => {
    try {
      const result = await post<{ recoveryCodes: string[]; user: SessionUser }>('/api/auth/mfa/enable', { code });
      setCodes(result.recoveryCodes);
      setUser(result.user);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === 'MFA_STEP_EXPIRED') onExpired?.();
      return { ok: false, error: e instanceof Error ? e.message : 'Código incorreto.' };
    }
  };

  if (codes && user) return <RecoveryCodes codes={codes} onContinue={() => onDone(user)} />;
  if (error) return <div className="notice notice--danger"><p>{error}</p></div>;
  if (!setup) return <p className="gl-mfa__hint"><Loader2 className="gl-spin" aria-hidden="true" /> Preparando o cadastro…</p>;

  const grouped = setup.secret.match(/.{1,4}/g)!.join(' ');
  return (
    <div className="gl-mfa-setup">
      <ol className="gl-mfa-setup__steps">
        <li>Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…) e leia o QR code.</li>
        <li>Digite abaixo o código de 6 dígitos que aparecer.</li>
      </ol>
      <div className="gl-mfa-setup__qr" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} aria-label="QR code para o aplicativo autenticador" role="img" />
      <div className="gl-mfa-setup__key">
        <span>Sem câmera? Digite a chave:</span>
        <code>{grouped}</code>
        <button
          type="button"
          className="gl-mfa-link"
          onClick={() => { navigator.clipboard?.writeText(setup.secret); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? 'Copiada' : 'Copiar chave'}
        </button>
      </div>
      <MfaCode verify={confirm} plain autoFocus={false} />
    </div>
  );
};

export const RecoveryCodes: React.FC<{ codes: string[]; onContinue: () => void; continueLabel?: string }> = ({ codes, onContinue, continueLabel = 'Continuar' }) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = `GuardList · códigos de recuperação da verificação em duas etapas\nCada código vale uma vez.\n\n${codes.join('\n')}\n`;
  return (
    <div className="gl-mfa-recovery">
      <p className="gl-mfa__hint">Guarde estes códigos num lugar seguro. Cada um vale uma vez e serve para entrar se você perder o celular. Eles não aparecem de novo.</p>
      <ul className="gl-mfa-recovery__list">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="gl-mfa-recovery__actions">
        <button type="button" className="gl-mfa-link" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')); setCopied(true); }}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? 'Copiados' : 'Copiar'}
        </button>
        <button
          type="button"
          className="gl-mfa-link"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'guardlist-codigos-de-recuperacao.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download aria-hidden="true" /> Baixar .txt
        </button>
      </div>
      <label className="gl-mfa-recovery__check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Guardei os códigos
      </label>
      <button type="button" className="gl-submit gl-submit--split" disabled={!saved} onClick={onContinue}>
        <span>{continueLabel}</span>
      </button>
    </div>
  );
};
