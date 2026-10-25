import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { sendActivity } from '../db/store';

// Sessão por inatividade: mouse, teclado, toque e rolagem contam como uso e viram um sinal ao servidor (no máximo a cada
// HEARTBEAT_MS). O relógio conta a partir do último sinal enviado, o mesmo que o servidor usa: contar pela última atividade
// local deixava o servidor encerrar a sessão até um sinal antes, durante o aviso. O último sinal fica no localStorage,
// compartilhado entre abas, para uma aba esquecida não derrubar a sessão de outra em uso.

const KEY = 'guardlist-last-activity';
const HEARTBEAT_MS = 30_000;
const WARN_MS = 60_000;
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

function readShared(): number {
  try {
    return Number(window.localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(at: number) {
  try {
    window.localStorage.setItem(KEY, String(at));
  } catch {
    // Sem armazenamento, cada aba conta a própria atividade.
  }
}

interface IdleGuardProps {
  timeoutMs: number;
  onExpire: () => void;
}

export const IdleGuard: React.FC<IdleGuardProps> = ({ timeoutMs, onExpire }) => {
  const lastSent = useRef(0);
  const warningRef = useRef(false);
  const [left, setLeft] = useState<number | null>(null);

  // Último sinal enviado por qualquer aba desta sessão.
  const lastBeat = () => Math.max(lastSent.current, readShared());

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastBeat() < HEARTBEAT_MS) return;
    lastSent.current = now;
    writeShared(now);
    sendActivity().catch(() => undefined);
  }, []);

  useEffect(() => {
    // Abrir ou recarregar a página também é uso.
    markActive(true);
    // Com o aviso aberto, só o botão renova: mexer o mouse por acaso não deve esconder o aviso.
    const onActivity = () => { if (!warningRef.current) markActive(); };
    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const tick = window.setInterval(() => {
      const idle = Date.now() - lastBeat();
      if (idle >= timeoutMs) {
        window.clearInterval(tick);
        onExpire();
      } else if (idle >= timeoutMs - WARN_MS) {
        warningRef.current = true;
        setLeft(Math.ceil((timeoutMs - idle) / 1000));
      } else if (warningRef.current) {
        // Outra aba renovou a sessão.
        warningRef.current = false;
        setLeft(null);
      }
    }, 1000);
    return () => {
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(tick);
    };
  }, [timeoutMs, onExpire, markActive]);

  const stay = () => {
    warningRef.current = false;
    setLeft(null);
    markActive(true);
  };

  return (
    <Modal
      open={left !== null}
      onClose={stay}
      size="sm"
      title="Sua sessão vai encerrar"
      footer={<button type="button" className="btn btn--primary" onClick={stay}>Continuar conectado</button>}
    >
      <p className="text-sm text-slate-300" role="timer" aria-live="polite">
        Por segurança, a sessão encerra depois de {Math.round(timeoutMs / 60_000)} min sem uso. Saída em <strong>{left ?? 0} s</strong>.
      </p>
    </Modal>
  );
};
