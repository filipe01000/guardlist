import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

// Cabeçalho único de página: título em sentence case, descrição curta e ações à direita.
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => (
  <header className="page-header">
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>
);
