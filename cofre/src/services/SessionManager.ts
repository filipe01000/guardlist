import { CryptoEngine } from './CryptoEngine';

/**
 * SessionManager:
 * Gerencia o ciclo de vida da sessão desbloqueada na memória RAM, a chave de dados (DEK),
 * o contador monotônico de geração de sessão (`sessionGeneration` para abortar operações
 * pendentes caso o cofre seja bloqueado durante execução assíncrona), sincronização de bloqueio
 * entre múltiplas abas via `BroadcastChannel` (sem tráfego de chaves) e o temporizador de inatividade.
 *
 * Limitações conhecidas de memória no navegador (documentadas para transparência):
 * - A chave DEK de 256 bits é mantida exclusivamente em um `Uint8Array` privado na instância e sobrescrita
 *   com zeros (`fill(0)`) imediatamente ao bloquear o cofre (manualmente, por inatividade ou via outra aba).
 * - Em motores JavaScript (V8/JavaScriptCore/SpiderMonkey), strings UTF-16 são imutáveis e coletadas pelo
 *   Garbage Collector assincronamente; portanto, não se deve declarar limpeza física garantida de strings no heap JS.
 */
export class SessionManager {
  private sessionDek: Uint8Array | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLockMs: number = 5 * 60 * 1000;
  private onLockListeners = new Set<() => void>();
  private generation = 0;
  private broadcastChannel: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel('donutvault_session_sync');
        this.broadcastChannel.onmessage = (event) => {
          if (event?.data?.action === 'LOCK_VAULT' && this.isUnlocked()) {
            this.lock(false);
          }
        };
      } catch {
        this.broadcastChannel = null;
      }
    }
  }

  /**
   * Inicia uma sessão autenticada armazenando uma cópia isolada da DEK em memória.
   */
  startSession(dek: Uint8Array, autoLockMinutes = 5): number {
    this.clearDek();
    this.generation += 1;
    this.sessionDek = new Uint8Array(dek);
    this.setAutoLockMinutes(autoLockMinutes);
    this.touchActivity();
    return this.generation;
  }

  /**
   * Retorna o identificador da geração atual da sessão para validar se um `lock()`
   * ocorreu enquanto uma operação assíncrona estava em andamento.
   */
  getGeneration(): number {
    return this.generation;
  }

  /**
   * Retorna uma cópia de trabalho da DEK ativa ou lança erro caso o cofre esteja bloqueado.
   */
  getActiveDek(): Uint8Array {
    if (!this.sessionDek || this.sessionDek.length !== 32) {
      throw new Error(
        'Acesso negado: O cofre está bloqueado. Desbloqueie com sua Senha Mestra primeiro.'
      );
    }
    return new Uint8Array(this.sessionDek);
  }

  /**
   * Verifica se há uma sessão desbloqueada ativa.
   */
  isUnlocked(): boolean {
    return this.sessionDek !== null && this.sessionDek.length === 32;
  }

  /**
   * Configura o tempo de bloqueio automático em minutos.
   */
  setAutoLockMinutes(minutes: number): void {
    this.autoLockMs = Math.max(100, minutes * 60 * 1000);
    if (this.isUnlocked()) {
      this.touchActivity();
    }
  }

  /**
   * Configura o tempo de bloqueio diretamente em milissegundos (útil para testes automatizados).
   */
  setAutoLockMilliseconds(ms: number): void {
    this.autoLockMs = Math.max(20, ms);
    if (this.isUnlocked()) {
      this.touchActivity();
    }
  }

  /**
   * Reinicia o cronômetro de inatividade a cada interação do usuário.
   */
  touchActivity(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    if (!this.isUnlocked()) return;

    this.inactivityTimer = setTimeout(() => {
      this.lock(true);
    }, this.autoLockMs);
  }

  /**
   * Tranca o cofre imediatamente, incrementando a geração (invalidando operações pendentes),
   * sobrescrevendo a DEK com zeros na memória e notificando ouvintes e outras abas.
   */
  lock(broadcastToOtherTabs = true): void {
    this.generation += 1;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    this.clearDek();

    if (broadcastToOtherTabs && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ action: 'LOCK_VAULT' });
      } catch {
        // Ignora se o canal já estiver fechado
      }
    }

    for (const listener of this.onLockListeners) {
      listener();
    }
  }

  /**
   * Encerra recursos de sincronização entre abas (útil ao desmontar ou encerrar testes).
   */
  dispose(): void {
    this.lock(false);
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {
        // Ignora erro ao fechar
      }
      this.broadcastChannel = null;
    }
  }

  /**
   * Registra um callback invocado sempre que o cofre é bloqueado (manual ou automaticamente).
   */
  onLock(listener: () => void): () => void {
    this.onLockListeners.add(listener);
    return () => {
      this.onLockListeners.delete(listener);
    };
  }

  private clearDek(): void {
    if (this.sessionDek) {
      CryptoEngine.zeroize(this.sessionDek);
      this.sessionDek = null;
    }
  }
}
