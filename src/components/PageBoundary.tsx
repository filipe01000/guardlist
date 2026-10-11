import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// Protege a navegação quando um módulo não carrega ou uma página falha ao renderizar.
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error) { console.error('Erro ao abrir a página:', error); }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="data-panel p-6" role="alert">
        <h1 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle aria-hidden="true" />Não foi possível abrir esta página</h1>
        <p className="mt-2 mb-4" style={{ color: 'var(--text-soft)' }}>Verifique a conexão e recarregue o GuardList para tentar novamente.</p>
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Recarregar GuardList</button>
      </section>
    );
  }
}
