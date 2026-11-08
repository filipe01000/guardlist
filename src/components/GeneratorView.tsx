import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  Copy,
  Check,
  RefreshCw,
  PlusCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { PasswordGeneratorConfig } from '../types/vault';
import {
  generateSecurePassword,
  evaluatePasswordStrength,
} from '../utils/generator';
import { useStrengthEngineReady } from '../utils/strengthEngine';
import { BarnabyMascot } from './CartoonIllustrations';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { ComicSpeechBubble, ComicActionCallout } from './ui/comic';

interface GeneratorViewProps {
  onUsePasswordInNewCredential: (generatedPassword: string) => void;
  onNotify?: (burst: string, title: string, tone?: 'success' | 'info' | 'warning' | 'danger') => void;
}

export function GeneratorView({
  onUsePasswordInNewCredential,
  onNotify,
}: GeneratorViewProps) {
  const [config, setConfig] = useState<PasswordGeneratorConfig>({
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
  });

  const [generatedPassword, setGeneratedPassword] = useState(() =>
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
  const [copied, setCopied] = useState(false);

  const regenerate = (nextConfig: PasswordGeneratorConfig = config) => {
    const nextPwd = generateSecurePassword(nextConfig);
    setGeneratedPassword(nextPwd);
    setCopied(false);
  };

  useEffect(() => {
    regenerate(config);
  }, [
    config.mode,
    config.length,
    config.uppercase,
    config.lowercase,
    config.numbers,
    config.symbols,
    config.avoidAmbiguous,
    config.wordCount,
    config.wordSeparator,
    config.capitalizeWords,
    config.includeNumberInPassphrase,
  ]);

  useStrengthEngineReady();
  const strength = evaluatePasswordStrength(generatedPassword);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      onNotify?.(
        'POW!',
        'Senha gerada copiada com segurança para a área de transferência!',
        'success'
      );
      if (strength.level === 'strong') {
        try {
          confetti({
            particleCount: 28,
            spread: 55,
            origin: { y: 0.65 },
          });
        } catch {
          // Ignora
        }
      }
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-black">
              Gerador de senhas
            </h1>
            <ComicActionCallout text="ALEATÓRIO DE VERDADE" tone="sky" />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-slate-400 mt-1">
            Cada caractere é sorteado pelo gerador criptográfico do navegador, sem viés.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Coluna Esquerda: Painel Neobrutal-UI de Geração */}
        <Card className="lg:col-span-8">
          <CardContent className="space-y-6">
            {/* Visor Brutalista da Senha Gerada */}
            <div className="bg-background bg-comic-halftone border-4 border-border rounded-base p-5 shadow-shadow space-y-4">
              <div className="font-mono text-lg sm:text-2xl font-black break-all select-all text-foreground tracking-wide min-h-[3.5rem] flex items-center">
                {generatedPassword}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t-3 border-border">
                <div className="flex items-center gap-2 text-xs font-black">
                  <span
                    className={
                      strength.level === 'strong'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : strength.level === 'medium'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }
                  >
                    Força: {strength.label}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-stone-600 dark:text-slate-300 tabular-nums">
                    Tempo de quebra: {strength.crackTimeDisplay}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    type="button"
                    variant="sky"
                    size="sm"
                    onClick={() => regenerate()}
                    aria-label="Gerar novamente"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Gerar novamente</span>
                  </Button>

                  <Button
                    type="button"
                    variant={copied ? 'emerald' : 'default'}
                    size="sm"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copiada!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copiar</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="pink"
                    size="sm"
                    onClick={() => onUsePasswordInNewCredential(generatedPassword)}
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Guardar no Cofre</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Abas Neobrutal-UI: Senha de Caracteres vs Frase-Senha */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={config.mode === 'random' ? 'default' : 'neutral'}
                size="sm"
                onClick={() => setConfig((c) => ({ ...c, mode: 'random' }))}
              >
                Senha de Caracteres (8 a 128)
              </Button>
              <Button
                type="button"
                variant={config.mode === 'passphrase' ? 'default' : 'neutral'}
                size="sm"
                onClick={() => setConfig((c) => ({ ...c, mode: 'passphrase' }))}
              >
                Frase-Senha de Palavras Aleatórias
              </Button>
            </div>

            {config.mode === 'random' ? (
              <div className="space-y-5">
                {/* Controle de Comprimento (8 até 128 caracteres) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="length-slider"
                      className="text-sm font-black"
                    >
                      Comprimento da Senha:{' '}
                      <span className="font-mono text-pink tabular-nums">
                        {config.length}
                      </span>{' '}
                      caracteres
                    </label>
                    <Input
                      type="number"
                      min={8}
                      max={128}
                      value={config.length}
                      aria-label="Comprimento numérico da senha"
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          length: Math.max(8, Math.min(128, Number(e.target.value) || 8)),
                        }))
                      }
                      className="w-20 h-9 text-center font-mono font-black tabular-nums"
                    />
                  </div>
                  <input
                    id="length-slider"
                    type="range"
                    min={8}
                    max={128}
                    value={config.length}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, length: Number(e.target.value) }))
                    }
                    className="w-full accent-pink cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] font-mono font-bold text-stone-500">
                    <span>8 (Mínimo)</span>
                    <span>16 (Recomendado)</span>
                    <span>64 (Blindado)</span>
                    <span>128 (Máximo)</span>
                  </div>
                </div>

                {/* Opções de Conjuntos de Caracteres em Caixas Brutalistas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <label className="flex items-center gap-3 p-3.5 rounded-base border-3 border-border bg-background shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.uppercase}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, uppercase: e.target.checked }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-sm font-extrabold">
                      Letras Maiúsculas (A–Z)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3.5 rounded-base border-3 border-border bg-background shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.lowercase}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, lowercase: e.target.checked }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-sm font-extrabold">
                      Letras Minúsculas (a–z)
                    </span>
                  </label>

                  <label className="flex items-center gap-3 p-3.5 rounded-base border-3 border-border bg-background shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.numbers}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, numbers: e.target.checked }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-sm font-extrabold">Números (0–9)</span>
                  </label>

                  <label className="flex items-center gap-3 p-3.5 rounded-base border-3 border-border bg-background shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.symbols}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, symbols: e.target.checked }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-sm font-extrabold">
                      Símbolos (!@#$%^&*)
                    </span>
                  </label>

                  <label className="sm:col-span-2 flex items-center gap-3 p-3.5 rounded-base border-3 border-border bg-background shadow-[2px_2px_0px_0px_var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.avoidAmbiguous}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          avoidAmbiguous: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-sm font-extrabold">
                      Evitar caracteres semelhantes (0, O, 1, l, I, |)
                    </span>
                  </label>
                </div>
              </div>
            ) : (
              /* Configurações de Frase-Senha */
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="word-count-slider"
                    className="block text-sm font-black mb-1"
                  >
                    Quantidade de Palavras:{' '}
                    <span className="font-mono text-pink">{config.wordCount}</span>{' '}
                    palavras
                  </label>
                  <input
                    id="word-count-slider"
                    type="range"
                    min={3}
                    max={10}
                    value={config.wordCount}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, wordCount: Number(e.target.value) }))
                    }
                    className="w-full accent-pink cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="word-sep"
                      className="block text-xs font-extrabold uppercase mb-1"
                    >
                      Separador
                    </label>
                    <select
                      id="word-sep"
                      value={config.wordSeparator}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, wordSeparator: e.target.value }))
                      }
                      className="w-full h-10 px-3 text-sm font-bold bg-background border-3 border-border rounded-base"
                    >
                      <option value="-">Hífen (-)</option>
                      <option value=".">Ponto (.)</option>
                      <option value="_">Sublinhado (_)</option>
                      <option value="!">Exclamação (!)</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2.5 p-3 rounded-base border-3 border-border bg-background cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.capitalizeWords}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          capitalizeWords: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-xs font-extrabold">Iniciais Maiúsculas</span>
                  </label>

                  <label className="flex items-center gap-2.5 p-3 rounded-base border-3 border-border bg-background cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeNumberInPassphrase}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          includeNumberInPassphrase: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-pink"
                    />
                    <span className="text-xs font-extrabold">Incluir Número</span>
                  </label>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Coluna Direita: Reação em Quadrinhos StreamUI do Mascote Barnaby */}
        <Card className="lg:col-span-4 text-center">
          <CardContent className="space-y-4">
            <div className="mx-auto w-fit animate-float bg-[#E0F2FE] border-3 border-border rounded-2xl p-2 shadow-shadow">
              <BarnabyMascot size={136} mood={strength.mascotMood} />
            </div>

            <ComicSpeechBubble
              speaker="VEREDITO DO BARNABY"
              tone={
                strength.level === 'strong'
                  ? 'mint'
                  : strength.level === 'medium'
                    ? 'yellow'
                    : 'danger'
              }
              tailDirection="top"
            >
              <span className="font-display text-base font-black block">
                &ldquo;{strength.funnyMessage}&rdquo;
              </span>
            </ComicSpeechBubble>

            <div className="text-left space-y-2 pt-3 border-t-3 border-border text-xs font-semibold text-stone-600 dark:text-slate-300">
              <div className="flex items-center gap-1.5 font-black text-foreground">
                <ShieldCheck className="w-4 h-4 text-[#0284C7]" />
                <span>Por que este gerador é seguro?</span>
              </div>
              <p className="leading-relaxed">
                Jamais usamos <code className="font-mono">Math.random()</code>. Cada caractere é sorteado pela fonte de entropia do navegador com <strong>rejection sampling</strong> para eliminar qualquer viés estatístico.
              </p>
              {strength.level === 'strong' && (
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-black pt-1">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>WOO-HOO! Barnaby está comemorando sua senha!</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
