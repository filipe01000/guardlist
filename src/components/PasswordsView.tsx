import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Copy,
  Check,
  Eye,
  EyeOff,
  Star,
  Pencil,
  Trash2,
  RotateCcw,
  ExternalLink,
  Dices,
  X,
  KeyRound,
  FolderOpen,
  LayoutGrid,
  Table as TableIcon,
} from 'lucide-react';
import type { CategoryId, CredentialItem } from '../types/vault';
import { VAULT_CATEGORIES } from '../utils/seedData';
import {
  evaluatePasswordStrength,
  generateSecurePassword,
} from '../utils/generator';
import {
  copySecretToClipboardWithAutoClear,
  normalizeCredentialUrlForStorage,
  sanitizePlainText,
  sanitizeSafeExternalUrl,
} from '../utils/security';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';

interface PasswordsViewProps {
  mode: 'all' | 'favorites' | 'categories' | 'trash';
  credentials: CredentialItem[];
  selectedCategoryId: string;
  onSelectCategoryId: (id: string) => void;
  onSaveCredential: (
    item: Omit<CredentialItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onToggleFavorite: (id: string) => Promise<void>;
  onMoveToTrash: (id: string) => Promise<void>;
  onRestoreFromTrash: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  externalModalOpen: boolean;
  onCloseExternalModal: () => void;
  prefilledPassword?: string;
  onNotify?: (burst: string, title: string, tone?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export function PasswordsView({
  mode,
  credentials,
  selectedCategoryId,
  onSelectCategoryId,
  onSaveCredential,
  onToggleFavorite,
  onMoveToTrash,
  onRestoreFromTrash,
  onPermanentDelete,
  onEmptyTrash,
  externalModalOpen,
  onCloseExternalModal,
  prefilledPassword,
  onNotify,
}: PasswordsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>(
    mode === 'categories' ? selectedCategoryId || 'all' : 'all'
  );
  const [onlyFavoritesFilter, setOnlyFavoritesFilter] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'cards' | 'table'>('cards');
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Estado do Modal de Criação / Edição
  const [editingItem, setEditingItem] = useState<CredentialItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [serviceName, setServiceName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState<CategoryId>('outros');
  const [tagsText, setTagsText] = useState('');
  const [notes, setNotes] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [showModalPassword, setShowModalPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const modalVisible = isFormOpen || externalModalOpen;

  const openCreateModal = (initialPwd = '') => {
    setEditingItem(null);
    setServiceName('');
    setUrl('');
    setUsername('');
    setEmail('');
    setPassword(
      initialPwd ||
        generateSecurePassword({
          mode: 'random',
          length: 20,
          uppercase: true,
          lowercase: true,
          numbers: true,
          symbols: true,
          avoidAmbiguous: true,
          wordCount: 4,
          wordSeparator: '-',
          capitalizeWords: true,
          includeNumberInPassphrase: true,
        })
    );
    setCategory(
      mode === 'categories' && selectedCategoryId && selectedCategoryId !== 'all'
        ? (selectedCategoryId as CategoryId)
        : 'trabalho-usina'
    );
    setTagsText('');
    setNotes('');
    setFavorite(mode === 'favorites');
    setFormError(null);
    setIsFormOpen(true);
  };

  const openEditModal = (cred: CredentialItem) => {
    setEditingItem(cred);
    setServiceName(cred.serviceName);
    setUrl(cred.url);
    setUsername(cred.username);
    setEmail(cred.email);
    setPassword(cred.password);
    setCategory(cred.category);
    setTagsText(cred.tags.join(', '));
    setNotes(cred.notes);
    setFavorite(cred.favorite);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeModal = () => {
    setIsFormOpen(false);
    setEditingItem(null);
    onCloseExternalModal();
  };

  React.useEffect(() => {
    if (externalModalOpen && !isFormOpen) {
      openCreateModal(prefilledPassword || '');
    }
  }, [externalModalOpen, prefilledPassword]);

  const effectiveCategory =
    mode === 'categories' ? selectedCategoryId || 'all' : categoryFilter;

  const filteredCredentials = useMemo(() => {
    return credentials
      .filter((c) => {
        if (mode === 'trash') {
          return Boolean(c.deletedAt);
        }
        if (c.deletedAt) return false;
        if (mode === 'favorites' && !c.favorite) return false;
        if (onlyFavoritesFilter && !c.favorite) return false;
        if (effectiveCategory !== 'all' && c.category !== effectiveCategory) {
          return false;
        }
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          c.serviceName.toLowerCase().includes(q) ||
          c.url.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.notes.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [
    credentials,
    mode,
    onlyFavoritesFilter,
    effectiveCategory,
    searchQuery,
  ]);

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = async (value: string, key: string, label: string) => {
    try {
      await copySecretToClipboardWithAutoClear(value, 30_000);
      setCopiedField(key);
      onNotify?.(
        'COPIADO!',
        `Senha de "${label}" copiada (limpeza automática em 30s)!`,
        'info'
      );
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Ignora erro
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceName.trim()) {
      setFormError('Informe o nome do serviço (ex: Painel Setor 7G, Netflix, Banco).');
      return;
    }
    if (!password) {
      setFormError('A senha não pode ficar em branco!');
      return;
    }

    let safeUrl = '';
    try {
      safeUrl = normalizeCredentialUrlForStorage(url);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'URL inválida ou protocolo bloqueado.'
      );
      return;
    }

    const parsedTags = tagsText
      .split(',')
      .map((t) => sanitizePlainText(t, 64).trim())
      .filter(Boolean);

    await onSaveCredential({
      id: editingItem?.id,
      serviceName: sanitizePlainText(serviceName, 200).trim(),
      url: safeUrl,
      username: sanitizePlainText(username, 256).trim(),
      email: sanitizePlainText(email, 256).trim(),
      password: sanitizePlainText(password, 1024),
      category,
      tags: parsedTags,
      notes: sanitizePlainText(notes, 8000).trim(),
      favorite,
      deletedAt: null,
    });

    onNotify?.(
      'WOO-HOO!',
      editingItem
        ? `Credencial "${serviceName.trim()}" atualizada com novo nonce AES-256-GCM!`
        : `Nova senha de "${serviceName.trim()}" criptografada no cofre!`,
      'success'
    );
    closeModal();
  };

  const strength = evaluatePasswordStrength(password, [serviceName, username, email]);

  const getCategoryMeta = (catId: CategoryId) =>
    VAULT_CATEGORIES.find((c) => c.id === catId) || VAULT_CATEGORIES[VAULT_CATEGORIES.length - 1];

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              {mode === 'favorites'
                ? '🍩 Rosquinhas Favoritas'
                : mode === 'categories'
                  ? '📁 Categorias de Springfield'
                  : mode === 'trash'
                    ? '🗑️ Lixeira do Cofre'
                    : '🔐 Minhas Senhas'}
            </h1>
            <ComicActionCallout
              text={`${filteredCredentials.length} ITENS`}
              tone="yellow"
            />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-slate-400 mt-1">
            {mode === 'trash'
              ? 'Credenciais excluídas podem ser restauradas ou destruídas permanentemente.'
              : 'Todas as credenciais e metadados são criptografados com AES-256-GCM antes de salvar.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {mode === 'trash' ? (
            filteredCredentials.length > 0 && (
              <Button
                type="button"
                variant="destructive"
                onClick={onEmptyTrash}
              >
                <Trash2 className="w-4 h-4" />
                <span>Esvaziar Lixeira ({filteredCredentials.length})</span>
              </Button>
            )
          ) : (
            <Button
              type="button"
              variant="default"
              onClick={() => openCreateModal()}
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Guardar nova senha</span>
            </Button>
          )}
        </div>
      </div>

      {/* Se estiver no modo Categorias, mostra os cards de categorias Neobrutal-UI */}
      {mode === 'categories' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <button
            type="button"
            onClick={() => onSelectCategoryId('all')}
            className={`p-4 text-left rounded-base border-3 border-border transition-all cursor-pointer ${
              effectiveCategory === 'all'
                ? 'bg-main text-main-foreground shadow-shadow -translate-y-0.5'
                : 'bg-secondary-background hover:bg-amber-50/60 dark:hover:bg-slate-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <FolderOpen className="w-5 h-5" />
              <span className="font-mono text-xs font-black tabular-nums">
                {credentials.filter((c) => !c.deletedAt).length} itens
              </span>
            </div>
            <p className="font-display font-black text-sm mt-2">
              Todas as Categorias
            </p>
          </button>

          {VAULT_CATEGORIES.map((cat) => {
            const count = credentials.filter(
              (c) => !c.deletedAt && c.category === cat.id
            ).length;
            const active = effectiveCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategoryId(cat.id)}
                className={`p-4 text-left rounded-base border-3 border-border transition-all cursor-pointer ${
                  active
                    ? 'bg-sky text-sky-foreground shadow-shadow -translate-y-0.5'
                    : 'bg-secondary-background hover:bg-sky-50/50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 border-border"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="font-mono text-xs font-black tabular-nums">
                    {count} {count === 1 ? 'senha' : 'senhas'}
                  </span>
                </div>
                <p className="font-display font-black text-sm mt-2 truncate">
                  {cat.name}
                </p>
                <p className="text-xs font-semibold opacity-75 truncate">
                  {cat.description}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Barra de Pesquisa e Controles Neobrutal-UI */}
      <Card className="py-4">
        <CardContent className="px-4 flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar por serviço, site, usuário, e-mail ou tag..."
              aria-label="Pesquisar credenciais"
              className="pl-10"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {mode === 'all' && (
              <>
                <select
                  aria-label="Filtrar por categoria"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-10 px-3 text-xs font-extrabold bg-background border-3 border-border rounded-base shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer"
                >
                  <option value="all">Todas as categorias</option>
                  {VAULT_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  variant={onlyFavoritesFilter ? 'pink' : 'neutral'}
                  size="sm"
                  onClick={() => setOnlyFavoritesFilter((f) => !f)}
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>Favoritos</span>
                </Button>
              </>
            )}

            {/* Alternador de Visualização: Cards vs Tabela Neobrutal-UI */}
            <div className="flex items-center border-3 border-border rounded-base overflow-hidden bg-background">
              <button
                type="button"
                onClick={() => setLayoutMode('cards')}
                aria-label="Visualização em Cartões"
                className={`px-3 py-2 text-xs font-extrabold flex items-center gap-1 cursor-pointer ${
                  layoutMode === 'cards'
                    ? 'bg-main text-main-foreground'
                    : 'text-foreground hover:bg-stone-100 dark:hover:bg-slate-800'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('table')}
                aria-label="Visualização em Tabela"
                className={`px-3 py-2 text-xs font-extrabold flex items-center gap-1 border-l-3 border-border cursor-pointer ${
                  layoutMode === 'table'
                    ? 'bg-main text-main-foreground'
                    : 'text-foreground hover:bg-stone-100 dark:hover:bg-slate-800'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Tabela</span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estado Vazio em Estilo Comic */}
      {filteredCredentials.length === 0 ? (
        <Card className="p-8 text-center items-center">
          <KeyRound className="w-12 h-12 text-pink" />
          <ComicSpeechBubble speaker="DETETIVE BARNABY" tone="yellow" tailDirection="top" className="max-w-md">
            <p className="font-display text-lg font-black">
              {mode === 'trash'
                ? 'A lixeira está mais limpa que prato de rosquinha!'
                : searchQuery
                  ? 'D’oh! Nenhuma senha encontrada para essa busca!'
                  : 'Nenhuma credencial guardada aqui ainda!'}
            </p>
            <p className="text-xs font-semibold mt-1">
              {mode === 'trash'
                ? 'Quando você excluir uma senha, ela ficará guardada aqui caso mude de ideia.'
                : 'Clique no botão abaixo para estrear seu cofre criptografado!'}
            </p>
          </ComicSpeechBubble>
          {mode !== 'trash' && (
            <Button
              type="button"
              variant="default"
              onClick={() => openCreateModal()}
            >
              Guardar nova senha
            </Button>
          )}
        </Card>
      ) : layoutMode === 'table' ? (
        /* Visualização em Tabela Neobrutal-UI */
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Serviço</TableHead>
              <TableHead className="hidden md:table-cell">Usuário / E-mail</TableHead>
              <TableHead className="hidden lg:table-cell">Categoria</TableHead>
              <TableHead className="hidden sm:table-cell">Senha</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCredentials.map((cred) => {
              const isRevealed = Boolean(revealedIds[cred.id]);
              const catMeta = getCategoryMeta(cred.category);
              return (
                <TableRow key={cred.id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-display font-extrabold">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(cred.id)}
                        aria-label={`Favoritar ${cred.serviceName}`}
                        className="cursor-pointer shrink-0"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            cred.favorite ? 'fill-pink text-pink' : 'text-stone-400'
                          }`}
                        />
                      </button>
                      <div className="min-w-0">
                        <span className="block truncate">{cred.serviceName}</span>
                        <span className="block md:hidden text-xs font-semibold text-stone-500 truncate">
                          {cred.username || cred.email}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs font-bold">
                    {cred.username || cred.email}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs font-bold text-[#0284C7] dark:text-sky">
                    {catMeta.name}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      <span>{isRevealed ? cred.password : '••••••••••••'}</span>
                      <button
                        type="button"
                        onClick={() => toggleReveal(cred.id)}
                        aria-label={isRevealed ? 'Esconder senha' : 'Mostrar senha'}
                        className="p-1 hover:text-pink cursor-pointer"
                      >
                        {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        onClick={() =>
                          handleCopy(cred.password, `pwd-${cred.id}`, cred.serviceName)
                        }
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copiar</span>
                      </Button>
                      {mode !== 'trash' && (
                        <Button
                          type="button"
                          variant="neutral"
                          size="xs"
                          onClick={() => openEditModal(cred)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        /* Visualização em Cards Neobrutal-UI */
        <div className="grid grid-cols-1 gap-4">
          {filteredCredentials.map((cred) => {
            const isRevealed = Boolean(revealedIds[cred.id]);
            const catMeta = getCategoryMeta(cred.category);
            const pwdEval = evaluatePasswordStrength(cred.password, [
              cred.serviceName,
              cred.username,
            ]);

            return (
              <Card key={cred.id} className="py-4">
                <CardContent className="px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => onToggleFavorite(cred.id)}
                        aria-label={
                          cred.favorite
                            ? `Remover ${cred.serviceName} dos favoritos`
                            : `Adicionar ${cred.serviceName} aos favoritos`
                        }
                        className="text-stone-400 hover:text-pink transition-colors cursor-pointer shrink-0"
                      >
                        <Star
                          className={`w-5 h-5 ${
                            cred.favorite ? 'fill-pink text-pink' : ''
                          }`}
                        />
                      </button>

                      <h3 className="font-display text-lg font-black text-foreground truncate">
                        {cred.serviceName}
                      </h3>

                      {sanitizeSafeExternalUrl(cred.url) && (
                        <a
                          href={sanitizeSafeExternalUrl(cred.url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Abrir site de ${cred.serviceName}`}
                          className="text-stone-500 hover:text-[#0284C7] shrink-0"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>

                    {/* Metadados limpos separados por ponto */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-stone-600 dark:text-slate-300">
                      {cred.username && <span>Usuário: {cred.username}</span>}
                      {cred.username && cred.email && <span aria-hidden="true">·</span>}
                      {cred.email && <span>{cred.email}</span>}
                      <span aria-hidden="true">·</span>
                      <span className="font-extrabold text-[#0284C7] dark:text-sky">
                        {catMeta.name}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-black ${
                          pwdEval.level === 'strong'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : pwdEval.level === 'medium'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        Força: {pwdEval.label}
                      </span>
                      {cred.tags.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-stone-500 dark:text-slate-400">
                            Tags: {cred.tags.join(', ')}
                          </span>
                        </>
                      )}
                    </div>

                    {cred.notes && (
                      <p className="text-xs text-stone-600 dark:text-slate-400 italic line-clamp-1 pt-0.5">
                        &ldquo;{cred.notes}&rdquo;
                      </p>
                    )}
                  </div>

                  {/* Campo de Senha + Botões Neobrutal-UI */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="flex items-center bg-background border-3 border-border rounded-base px-3 py-1.5 shadow-[2px_2px_0px_0px_var(--border)]">
                      <span className="font-mono text-xs sm:text-sm font-bold select-all tracking-wider pr-2">
                        {isRevealed ? cred.password : '••••••••••••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleReveal(cred.id)}
                        aria-label={
                          isRevealed
                            ? `Esconder senha de ${cred.serviceName}`
                            : `Mostrar senha de ${cred.serviceName}`
                        }
                        className="p-1 text-stone-600 dark:text-slate-400 hover:text-foreground cursor-pointer"
                      >
                        {isRevealed ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    <Button
                      type="button"
                      variant={copiedField === `pwd-${cred.id}` ? 'emerald' : 'default'}
                      size="sm"
                      onClick={() =>
                        handleCopy(cred.password, `pwd-${cred.id}`, cred.serviceName)
                      }
                      aria-label={`Copiar senha de ${cred.serviceName}`}
                    >
                      {copiedField === `pwd-${cred.id}` ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copiada!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </Button>

                    {mode === 'trash' ? (
                      <>
                        <Button
                          type="button"
                          variant="emerald"
                          size="sm"
                          onClick={() => onRestoreFromTrash(cred.id)}
                          aria-label={`Restaurar ${cred.serviceName}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restaurar</span>
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onPermanentDelete(cred.id)}
                          aria-label={`Excluir permanentemente ${cred.serviceName}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Destruir</span>
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="sky"
                          size="icon-sm"
                          onClick={() => openEditModal(cred)}
                          aria-label={`Editar ${cred.serviceName}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          onClick={() => onMoveToTrash(cred.id)}
                          aria-label={`Mover ${cred.serviceName} para a lixeira`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal Neobrutal-UI de Adicionar / Editar Credencial */}
      {modalVisible && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="credential-modal-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-secondary-background border-4 border-border rounded-base max-w-xl w-full p-6 sm:p-7 shadow-[8px_8px_0px_0px_var(--border)] space-y-5 my-8 animate-comic-pop">
            <div className="flex items-center justify-between border-b-3 border-border pb-3">
              <div className="flex items-center gap-2">
                <ComicActionCallout text={editingItem ? 'EDITAR' : 'NOVA!'} tone="pink" />
                <h2
                  id="credential-modal-title"
                  className="font-display text-2xl font-black"
                >
                  {editingItem ? 'Editar Credencial' : 'Guardar Nova Senha'}
                </h2>
              </div>
              <Button
                type="button"
                variant="neutral"
                size="icon-sm"
                onClick={closeModal}
                aria-label="Fechar janela"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="cred-service"
                    className="block text-xs font-extrabold uppercase mb-1"
                  >
                    Nome do Serviço *
                  </label>
                  <Input
                    id="cred-service"
                    type="text"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder="Ex: Painel Nuclear, Banco, Netflix"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="cred-category"
                    className="block text-xs font-extrabold uppercase mb-1"
                  >
                    Categoria
                  </label>
                  <select
                    id="cred-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CategoryId)}
                    className="w-full h-11 px-3 text-sm font-bold bg-background border-3 border-border rounded-base shadow-[2px_2px_0px_0px_var(--border)]"
                  >
                    {VAULT_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cred-username" className="block text-xs font-extrabold uppercase mb-1">
                    Usuário
                  </label>
                  <Input
                    id="cred-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ex: inspetor_barnaby"
                  />
                </div>

                <div>
                  <label htmlFor="cred-email" className="block text-xs font-extrabold uppercase mb-1">
                    E-mail
                  </label>
                  <Input
                    id="cred-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="barnaby@donutvault.com.br"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="cred-url" className="block text-xs font-extrabold uppercase mb-1">
                  Site ou URL
                </label>
                <Input
                  id="cred-url"
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              {/* Senha + Gerador Rápido Integrado */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="cred-password" className="text-xs font-extrabold uppercase">
                    Senha *
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setPassword(
                        generateSecurePassword({
                          mode: 'random',
                          length: 20,
                          uppercase: true,
                          lowercase: true,
                          numbers: true,
                          symbols: true,
                          avoidAmbiguous: true,
                          wordCount: 4,
                          wordSeparator: '-',
                          capitalizeWords: true,
                          includeNumberInPassphrase: true,
                        })
                      )
                    }
                    className="text-xs font-black text-pink hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Dices className="w-3.5 h-3.5" />
                    <span>Sortear senha forte (20 chars)</span>
                  </button>
                </div>

                <div className="relative">
                  <Input
                    id="cred-password"
                    type={showModalPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10 font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowModalPassword((s) => !s)}
                    aria-label={showModalPassword ? 'Esconder senha' : 'Mostrar senha'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-600 cursor-pointer"
                  >
                    {showModalPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>

                <div className="mt-1.5 flex items-center justify-between text-xs font-extrabold">
                  <span
                    className={
                      strength.level === 'strong'
                        ? 'text-emerald-600'
                        : strength.level === 'medium'
                          ? 'text-amber-600'
                          : 'text-rose-600'
                    }
                  >
                    Robustez: {strength.label}
                  </span>
                  <span className="text-stone-600 dark:text-slate-400">
                    {strength.funnyMessage}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="cred-tags" className="block text-xs font-extrabold uppercase mb-1">
                    Tags (separadas por vírgula)
                  </label>
                  <Input
                    id="cred-tags"
                    type="text"
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="trabalho, urgente, familia"
                  />
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm font-extrabold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={favorite}
                      onChange={(e) => setFavorite(e.target.checked)}
                      className="w-4 h-4 accent-pink"
                    />
                    <span>🍩 Marcar como Favorito</span>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="cred-notes" className="block text-xs font-extrabold uppercase mb-1">
                  Notas Criptografadas
                </label>
                <textarea
                  id="cred-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observações secretas, perguntas de segurança..."
                  className="w-full px-3.5 py-2 text-sm font-semibold bg-background border-3 border-border rounded-base shadow-[2px_2px_0px_0px_var(--border)]"
                />
              </div>

              {formError && (
                <p className="text-xs font-black text-rose-600">{formError}</p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="neutral"
                  onClick={closeModal}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="default">
                  Salvar no Cofre Criptografado
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
