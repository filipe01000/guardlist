import React, { useEffect, useState } from 'react';
import { FileSignature, Search, Sparkles } from 'lucide-react';
import './TopBar.css';

interface Props {
  /** Abre a consulta; com texto, já pesquisa o que foi digitado. */
  onSearch: (seed?: string) => void;
  onOpenCaseBuilder: () => void;
  /** Só existe quando o servidor tem IA configurada. */
  onOpenAssistant?: () => void;
  isAssistantOpen?: boolean;
}

/** Barra fixa no topo da área principal: consulta de IP e as ferramentas do dia a dia. */
export const TopBar: React.FC<Props> = ({ onSearch, onOpenCaseBuilder, onOpenAssistant, isAssistantOpen }) => {
  const [value, setValue] = useState('');
  // Só ganha o vidro fosco quando a página rola por baixo dela; parada no topo, deixa o fundo de cadeados aparecer.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className={`gl-topbar${stuck ? ' is-stuck' : ''}`}>
      <form
        className="gl-topbar__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(value.trim() || undefined);
          setValue('');
        }}
      >
        <Search aria-hidden="true" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Consultar IP, CIDR ou domínio…"
          aria-label="Consultar IP, CIDR ou domínio em todas as listas"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd>Ctrl K</kbd>
      </form>

      <div className="gl-topbar__actions">
        <button type="button" className="gl-topbar__btn" onClick={onOpenCaseBuilder} title="Gerar texto do caso para o cliente">
          <FileSignature aria-hidden="true" />
          <span>Gerar caso</span>
        </button>
        {onOpenAssistant && (
          <button
            type="button"
            className={`gl-topbar__btn gl-topbar__btn--ai${isAssistantOpen ? ' is-on' : ''}`}
            onClick={onOpenAssistant}
            aria-pressed={isAssistantOpen}
            title="Assistente IA (Ctrl J)"
          >
            <Sparkles aria-hidden="true" />
            <span>Assistente IA</span>
          </button>
        )}
      </div>
    </div>
  );
};
