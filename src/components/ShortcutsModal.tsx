import React from 'react';
import { Modal } from './Modal';

const K: React.FC<{ children: React.ReactNode }> = ({ children }) => <kbd className="key">{children}</kbd>;

export const ShortcutsModal: React.FC<{ open: boolean; onClose: () => void; isAdmin: boolean }> = ({ open, onClose, isAdmin }) => (
  <Modal open={open} onClose={onClose} title="Atalhos de teclado" subtitle="Funcionam fora de campos de texto." size="sm">
    <dl className="shortcut-list">
      <span className="shortcut-group">Geral</span>
      <dt><K>Ctrl</K><K>K</K> ou <K>/</K></dt><dd>Consultar IPs em todas as listas</dd>
      <dt><K>?</K></dt><dd>Mostrar estes atalhos</dd>
      <dt><K>Esc</K></dt><dd>Fechar janela</dd>
      <dt><K>Botão direito</K></dt><dd>Ações do que está sob o cursor (IP, CIDR, domínio, cliente ou página)</dd>
      <dt><K>Shift</K> + <K>Botão direito</K></dt><dd>Menu normal do navegador</dd>

      <span className="shortcut-group">Ir para</span>
      <dt><K>D</K></dt><dd>Painel geral</dd>
      <dt><K>I</K></dt><dd>Importação</dd>
      <dt><K>L</K></dt><dd>Listas dos clientes</dd>
      <dt><K>R</K></dt><dd>Revisão de bloqueios</dd>
      <dt><K>H</K></dt><dd>Histórico</dd>
      <dt><K>T</K></dt><dd>Inteligência de IPs</dd>
      <dt><K>P</K></dt><dd>Relatórios</dd>
      {isAdmin && (<><dt><K>A</K></dt><dd>Administração</dd></>)}

      <span className="shortcut-group">Na lista do cliente</span>
      <dt><K>N</K></dt><dd>Adicionar indicadores</dd>
      <dt><K>V</K></dt><dd>Validar lista</dd>
      <dt><K>E</K></dt><dd>Exportar NANO</dd>
      <dt><K>F</K></dt><dd>Buscar na lista</dd>

      <span className="shortcut-group">Na importação</span>
      <dt><K>Ctrl</K><K>Enter</K></dt><dd>Pré-visualizar</dd>
    </dl>
  </Modal>
);
