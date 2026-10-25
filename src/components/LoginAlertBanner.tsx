import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { dismissLoginAlert, listLoginAlerts, revokeOtherSessions, type LoginAlert } from '../db/store';
import { formatDateTimeBR } from '../utils/csv';
import { describeAgent } from '../utils/device';

interface LoginAlertBannerProps {
  // "Não fui eu": depois de encerrar as outras sessões, abre Minha conta para trocar a senha.
  onNotMe: () => void;
}

// Faixa com o acesso novo mais recente à conta, vindo de outro navegador ou de outra rede.
export const LoginAlertBanner: React.FC<LoginAlertBannerProps> = ({ onNotMe }) => {
  const [alerts, setAlerts] = useState<LoginAlert[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listLoginAlerts().then((r) => setAlerts(r.alerts)).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const alert = alerts[0];
  if (!alert) return null;

  const dismiss = async (notMe: boolean) => {
    setBusy(true);
    try {
      if (notMe) await revokeOtherSessions();
      await dismissLoginAlert(alert.id);
      setAlerts((list) => list.filter((a) => a.id !== alert.id));
      if (notMe) onNotMe();
    } catch {
      // A chamada já avisa sessão expirada; nos outros casos a faixa continua para tentar de novo.
    } finally {
      setBusy(false);
    }
  };

  const what = alert.newDevice && alert.newNetwork ? 'navegador e rede novos' : alert.newDevice ? 'navegador novo' : 'rede nova';
  return (
    <div className="banner" role="alert">
      <ShieldAlert aria-hidden="true" />
      <span>
        <strong>Novo acesso à sua conta</strong> ({what}): {describeAgent(alert.userAgent).label}, IP {alert.ip || '—'}, {formatDateTimeBR(alert.createdAt)}.
        {alerts.length > 1 && ` Há mais ${alerts.length - 1}.`}
      </span>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void dismiss(false)}>Fui eu</button>
      <button type="button" className="btn btn--sm btn--danger" style={{ marginLeft: 0 }} disabled={busy} onClick={() => void dismiss(true)}>Não fui eu</button>
    </div>
  );
};
