import React, { useEffect } from 'react';

// Cofre de senhas (DonutVault) dentro da área de conteúdo. O cofre é servido por este mesmo servidor em
// /cofre e roda num quadro da mesma origem: ele esconde o menu e o fundo próprios e segue o tema do GuardList.
// O servidor só entrega /cofre para administradores liberados pelo master.
export const VaultView: React.FC = () => {
  useEffect(() => {
    // Uso dentro do quadro não chega aos eventos desta janela: o cofre avisa e isso conta como atividade.
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type === 'cofre-activity') {
        window.dispatchEvent(new Event('guardlist-activity'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      src="/cofre/"
      title="Cofre de senhas"
      className="vault-frame"
      allow="clipboard-write; publickey-credentials-get; publickey-credentials-create"
    />
  );
};
