import React, { useState } from 'react';
import {
  Plus,
  Search,
  FileText,
  Pencil,
  Trash2,
  RotateCcw,
  Star,
  Lock,
  X,
} from 'lucide-react';
import type { SecretNote } from '../types/vault';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';

interface SecretNotesViewProps {
  notes: SecretNote[];
  onSaveNote: (
    note: Omit<SecretNote, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onMoveNoteToTrash?: (id: string) => Promise<void>;
  onRestoreNoteFromTrash?: (id: string) => Promise<void>;
  onNotify?: (burst: string, title: string, tone?: 'success' | 'info' | 'warning' | 'danger') => void;
}

const COLOR_STYLES: Record<SecretNote['colorTint'], string> = {
  yellow: 'bg-[#FEF08A] text-[#09090B]',
  pink: 'bg-[#FCE7F3] text-[#09090B]',
  blue: 'bg-[#E0F2FE] text-[#09090B]',
  mint: 'bg-[#DCFCE7] text-[#09090B]',
};

export function SecretNotesView({
  notes,
  onSaveNote,
  onDeleteNote,
  onMoveNoteToTrash,
  onRestoreNoteFromTrash,
  onNotify,
}: SecretNotesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<SecretNote | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Geral');
  const [content, setContent] = useState('');
  const [colorTint, setColorTint] = useState<SecretNote['colorTint']>('yellow');
  const [favorite, setFavorite] = useState(false);

  const activeNotesCount = notes.filter((n) => !n.deletedAt).length;
  const trashedNotesCount = notes.filter((n) => Boolean(n.deletedAt)).length;

  const uniqueCategories = Array.from(
    new Set(notes.filter((n) => !n.deletedAt).map((n) => n.category))
  );

  const displayedNotes = notes
    .filter((n) => (showTrash ? Boolean(n.deletedAt) : !n.deletedAt))
    .filter((n) => {
      if (!showTrash && selectedCategory !== 'ALL') {
        if (n.category !== selectedCategory) return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  const openCreate = () => {
    setEditingNote(null);
    setTitle('');
    setCategory('Geral');
    setContent('');
    setColorTint('yellow');
    setFavorite(false);
    setIsModalOpen(true);
  };

  const openEdit = (note: SecretNote) => {
    setEditingNote(note);
    setTitle(note.title);
    setCategory(note.category);
    setContent(note.content);
    setColorTint(note.colorTint);
    setFavorite(note.favorite);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    await onSaveNote({
      id: editingNote?.id,
      title: title.trim(),
      category: category.trim() || 'Geral',
      content: content.trim(),
      colorTint,
      favorite,
      deletedAt: null,
    });
    onNotify?.(
      'SECRETO!',
      `Nota "${title.trim()}" salva.`,
      'success'
    );
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              Notas seguras
            </h1>
            <ComicActionCallout
              text={`${activeNotesCount} NOTAS`}
              tone="pink"
            />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-slate-400 mt-1">
            Guarde códigos de recuperação, chaves de licença e outros segredos. Tudo cifrado neste aparelho.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={showTrash ? 'pink' : 'neutral'}
            size="sm"
            onClick={() => setShowTrash((v) => !v)}
          >
            <Trash2 className="w-4 h-4" />
            <span>
              {showTrash
                ? 'Voltar para Notas Ativas'
                : `Lixeira de Notas (${trashedNotesCount})`}
            </span>
          </Button>

          <Button type="button" variant="default" onClick={openCreate}>
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Nova Nota Secreta</span>
          </Button>
        </div>
      </div>

      {/* Pesquisa e Filtro por Categoria de Notas Neobrutal-UI */}
      <Card className="py-4">
        <CardContent className="px-4 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar em notas secretas por título, conteúdo ou categoria..."
              aria-label="Pesquisar notas secretas"
              className="pl-10"
            />
          </div>

          {!showTrash && uniqueCategories.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={selectedCategory === 'ALL' ? 'default' : 'neutral'}
                size="xs"
                onClick={() => setSelectedCategory('ALL')}
              >
                Todas Categorias ({activeNotesCount})
              </Button>
              {uniqueCategories.map((cat) => (
                <Button
                  key={cat}
                  type="button"
                  variant={selectedCategory === cat ? 'default' : 'neutral'}
                  size="xs"
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {displayedNotes.length === 0 ? (
        <Card className="p-8 text-center items-center">
          <FileText className="w-10 h-10 text-pink mx-auto" />
          <ComicSpeechBubble speaker="CADERNINHO DO BARNABY" tone="yellow" tailDirection="top">
            {showTrash
              ? 'Nenhuma nota secreta está na lixeira no momento!'
              : 'Nenhuma nota secreta encontrada! Guarde receitas de cobertura rosa ou códigos de recuperação aqui.'}
          </ComicSpeechBubble>
          {!showTrash && (
            <Button type="button" variant="default" onClick={openCreate}>
              Criar Primeira Nota Secreta
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayedNotes.map((note) => (
            <Card
              key={note.id}
              className={`${COLOR_STYLES[note.colorTint]} justify-between py-5`}
            >
              <CardContent className="px-5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-lg font-black leading-snug">
                    {note.title}
                  </h3>
                  {note.favorite && (
                    <Star className="w-4 h-4 fill-pink text-pink shrink-0 mt-1" />
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs font-extrabold opacity-80">
                  <Lock className="w-3.5 h-3.5" />
                  <span>{note.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {new Date(note.updatedAt).toLocaleDateString('pt-BR')}
                  </span>
                </div>

                <pre className="font-sans text-xs sm:text-sm font-semibold whitespace-pre-wrap leading-relaxed pt-2 border-t-2 border-black/20">
                  {note.content}
                </pre>
              </CardContent>

              <div className="px-5 pt-3 border-t-2 border-black/20 flex items-center justify-end gap-2">
                {showTrash ? (
                  <>
                    <Button
                      type="button"
                      variant="emerald"
                      size="xs"
                      onClick={() => onRestoreNoteFromTrash?.(note.id)}
                      aria-label={`Restaurar nota ${note.title}`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restaurar</span>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={() => onDeleteNote(note.id)}
                      aria-label={`Excluir permanentemente nota ${note.title}`}
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
                      size="xs"
                      onClick={() => openEdit(note)}
                      aria-label={`Editar nota ${note.title}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={() =>
                        onMoveNoteToTrash
                          ? onMoveNoteToTrash(note.id)
                          : onDeleteNote(note.id)
                      }
                      aria-label={`Mover nota ${note.title} para lixeira`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Neobrutal-UI de Criar / Editar Nota Secreta */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-modal-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="bg-secondary-background border-4 border-border rounded-base max-w-lg w-full p-6 space-y-4 shadow-[8px_8px_0px_0px_var(--border)] animate-comic-pop">
            <div className="flex items-center justify-between border-b-3 border-border pb-3">
              <h2 id="note-modal-title" className="font-display text-xl font-black">
                {editingNote ? 'Editar Nota Secreta' : 'Nova Nota Secreta'}
              </h2>
              <Button
                type="button"
                variant="neutral"
                size="icon-sm"
                onClick={() => setIsModalOpen(false)}
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="note-title" className="block text-xs font-extrabold uppercase mb-1">
                  Título da Nota *
                </label>
                <Input
                  id="note-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Receita Secreta da Cobertura Rosa"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="note-cat" className="block text-xs font-extrabold uppercase mb-1">
                    Categoria
                  </label>
                  <Input
                    id="note-cat"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="note-color" className="block text-xs font-extrabold uppercase mb-1">
                    Cor do Cartão Comic
                  </label>
                  <select
                    id="note-color"
                    value={colorTint}
                    onChange={(e) =>
                      setColorTint(e.target.value as SecretNote['colorTint'])
                    }
                    className="w-full h-11 px-3 text-sm font-bold bg-background border-3 border-border rounded-base"
                  >
                    <option value="yellow">Amarelo</option>
                    <option value="pink">Rosa Rosquinha</option>
                    <option value="blue">Azul Celeste</option>
                    <option value="mint">Verde</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="note-content" className="block text-xs font-extrabold uppercase mb-1">
                  Conteúdo Criptografado *
                </label>
                <textarea
                  id="note-content"
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Digite suas anotações ultrassecretas..."
                  className="w-full px-3.5 py-2 text-sm font-semibold bg-background border-3 border-border rounded-base shadow-[2px_2px_0px_0px_var(--border)]"
                  required
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-extrabold cursor-pointer">
                <input
                  type="checkbox"
                  checked={favorite}
                  onChange={(e) => setFavorite(e.target.checked)}
                  className="w-4 h-4 accent-pink"
                />
                <span>Marcar nota como favorita</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="neutral"
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="default">
                  Salvar Nota Criptografada
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
