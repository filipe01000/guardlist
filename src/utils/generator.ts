import zxcvbn from 'zxcvbn';
import type { PasswordGeneratorConfig } from '../types/vault';

const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const NUMBER_CHARS = '0123456789';
const SYMBOL_CHARS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
const AMBIGUOUS_CHARS = new Set(['0', 'O', 'o', '1', 'l', 'I', '|', '`', "'", '"']);

const SPRINGFIELD_PASSPHRASE_WORDS = [
  'rosquinha', 'cobertura', 'confeito', 'springfield', 'usina', 'nuclear',
  'sofazinho', ' televisão', 'cerveja', 'boliche', 'saxofone', 'skate',
  'churrasco', 'hamburguer', 'atomo', 'reator', ' sirene', 'inspetor',
  'seguranca', 'cofre', 'blindado', 'cadeado', 'escudo', 'misterio',
  'aventura', 'comedia', 'amarelo', 'nuvem', 'parque', 'escola',
  'lanchonete', 'sorvete', ' caramelo', 'morango', 'chocolate', 'baunilha',
  'crocante', 'quente', 'fresco', 'doce', 'padaria', 'turno',
  'soneca', 'rede', 'jardim', 'vizinho', 'garagem', 'ferramenta',
  'foguete', 'astronauta', 'espaco', 'planeta', 'estrela', 'cometa',
  'trofeu', 'campeao', 'equipe', 'estadio', 'apito', 'medalha',
  'guitarra', 'bateria', 'palco', 'festival', 'bilhete', 'pipoca',
  'cinema', 'poltrona', 'controle', 'pilha', 'antena', 'satelite'
].map((w) => w.trim());

/**
 * Seleciona um inteiro aleatório uniforme no intervalo [0, maxExclusive)
 * usando rejection sampling sobre crypto.getRandomValues() para eliminar viés estatístico (modulo bias).
 */
export function getUnbiasedRandomIndex(maxExclusive: number): number {
  if (maxExclusive <= 0 || maxExclusive > 65536) {
    throw new Error('Intervalo inválido para geração segura de índice.');
  }
  if (maxExclusive === 1) return 0;

  // Usa inteiros de 16 bits (0..65535) com limite de rejeição exato
  const range = 65536;
  const maxValid = Math.floor(range / maxExclusive) * maxExclusive;
  const buf = new Uint16Array(1);

  while (true) {
    crypto.getRandomValues(buf);
    const val = buf[0];
    if (val < maxValid) {
      return val % maxExclusive;
    }
  }
}

/**
 * Embaralha um array in-place usando Fisher-Yates com seleção sem viés via crypto.getRandomValues().
 */
function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = getUnbiasedRandomIndex(i + 1);
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
  return items;
}

function filterAmbiguous(chars: string, avoidAmbiguous: boolean): string {
  if (!avoidAmbiguous) return chars;
  return chars
    .split('')
    .filter((ch) => !AMBIGUOUS_CHARS.has(ch))
    .join('');
}

/**
 * Gera uma senha ou frase-senha segura usando exclusivamente crypto.getRandomValues() sem viés.
 */
export function generateSecurePassword(config: PasswordGeneratorConfig): string {
  if (config.mode === 'passphrase') {
    const count = Math.max(3, Math.min(10, config.wordCount || 4));
    const sep = config.wordSeparator ?? '-';
    const words: string[] = [];

    for (let i = 0; i < count; i++) {
      let word = SPRINGFIELD_PASSPHRASE_WORDS[getUnbiasedRandomIndex(SPRINGFIELD_PASSPHRASE_WORDS.length)];
      if (config.capitalizeWords) {
        word = word.charAt(0).toUpperCase() + word.slice(1);
      }
      words.push(word);
    }

    if (config.includeNumberInPassphrase) {
      const randomNum = getUnbiasedRandomIndex(900) + 100; // 100..999
      const targetWordIdx = getUnbiasedRandomIndex(words.length);
      words[targetWordIdx] = `${words[targetWordIdx]}${randomNum}`;
    }

    return words.join(sep);
  }

  // Modo caracteres aleatórios (8 até 128 caracteres)
  const length = Math.max(8, Math.min(128, Math.round(config.length || 16)));

  const pools: string[] = [];
  if (config.uppercase) pools.push(filterAmbiguous(UPPERCASE_CHARS, config.avoidAmbiguous));
  if (config.lowercase) pools.push(filterAmbiguous(LOWERCASE_CHARS, config.avoidAmbiguous));
  if (config.numbers) pools.push(filterAmbiguous(NUMBER_CHARS, config.avoidAmbiguous));
  if (config.symbols) pools.push(filterAmbiguous(SYMBOL_CHARS, config.avoidAmbiguous));

  // Fallback caso o usuário desmarque tudo
  const activePools = pools.filter((p) => p.length > 0);
  if (activePools.length === 0) {
    activePools.push(filterAmbiguous(LOWERCASE_CHARS + NUMBER_CHARS, config.avoidAmbiguous));
  }

  const combinedCharset = activePools.join('');
  const resultChars: string[] = [];

  // Garante pelo menos 1 caractere de cada pool selecionado
  for (const pool of activePools) {
    if (resultChars.length < length) {
      resultChars.push(pool[getUnbiasedRandomIndex(pool.length)]);
    }
  }

  // Preenche o restante sem viés estatístico
  while (resultChars.length < length) {
    resultChars.push(combinedCharset[getUnbiasedRandomIndex(combinedCharset.length)]);
  }

  // Embaralha para que os caracteres obrigatórios não fiquem sempre nas primeiras posições
  return secureShuffle(resultChars).join('');
}

export interface PasswordStrengthAnalysis {
  score: 0 | 1 | 2 | 3 | 4;
  level: 'weak' | 'medium' | 'strong';
  label: string;
  funnyMessage: string;
  mascotMood: 'panic' | 'thinking' | 'celebrating';
  crackTimeDisplay: string;
  entropyGuessesLog10: number;
  suggestions: string[];
}

/**
 * Avalia localmente a robustez da senha usando zxcvbn (sem chamadas externas).
 */
export function evaluatePasswordStrength(
  password: string,
  userInputs: string[] = []
): PasswordStrengthAnalysis {
  if (!password) {
    return {
      score: 0,
      level: 'weak',
      label: 'Fraca',
      funnyMessage: 'Essa senha não protege nem uma rosquinha!',
      mascotMood: 'panic',
      crackTimeDisplay: 'Instantâneo',
      entropyGuessesLog10: 0,
      suggestions: ['Digite ou gere uma senha com pelo menos 12 caracteres.'],
    };
  }

  const ptBrCommonInputs = [
    'rosquinha',
    'senha',
    'springfield',
    'barnaby',
    'familia',
    'usina',
    'segredo',
    'donut',
    'donutvault',
    ...userInputs,
  ];
  const result = zxcvbn(password, ptBrCommonInputs);
  const score = result.score;

  // Mapeia score zxcvbn (0-4) para as 3 faixas com as mensagens exatas pedidas
  if (score <= 1) {
    return {
      score,
      level: 'weak',
      label: 'Fraca',
      funnyMessage: 'Essa senha não protege nem uma rosquinha!',
      mascotMood: 'panic',
      crackTimeDisplay: 'Segundos a minutos',
      entropyGuessesLog10: Math.round(result.guesses_log10 * 10) / 10,
      suggestions: [
        'Aumente o comprimento para pelo menos 14 caracteres.',
        'Misture letras maiúsculas, números e símbolos ou use uma frase-senha.',
      ],
    };
  }

  if (score === 2) {
    return {
      score,
      level: 'medium',
      label: 'Média',
      funnyMessage: 'Hmm... dá para melhorar isso aí!',
      mascotMood: 'thinking',
      crackTimeDisplay: 'Alguns dias ou meses',
      entropyGuessesLog10: Math.round(result.guesses_log10 * 10) / 10,
      suggestions: [
        'Adicione mais caracteres ou símbolos para blindar contra força bruta.',
      ],
    };
  }

  return {
    score,
    level: 'strong',
    label: 'Forte',
    funnyMessage: 'Excelente! O cofre está bem protegido!',
    mascotMood: 'celebrating',
    crackTimeDisplay: score === 4 ? 'Séculos (Inquebrável!)' : 'Décadas',
    entropyGuessesLog10: Math.round(result.guesses_log10 * 10) / 10,
    suggestions: [],
  };
}

export const MASTER_PASSWORD_MIN_LENGTH = 12;

/**
 * Regra mínima para a Senha Mestra. Ela protege a chave do cofre, que fica no servidor
 * quando a sincronização está ligada: uma senha fraca pode ser quebrada fora do ar por quem
 * tiver acesso ao banco, então exigimos comprimento e força (zxcvbn >= 3).
 */
export function checkMasterPasswordPolicy(
  password: string
): { ok: true } | { ok: false; reason: string } {
  if (password.length < MASTER_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `A Senha Mestra precisa ter pelo menos ${MASTER_PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (evaluatePasswordStrength(password).level !== 'strong') {
    return {
      ok: false,
      reason:
        'A Senha Mestra ainda é fácil de adivinhar. Use uma frase com várias palavras ou misture letras, números e símbolos.',
    };
  }
  return { ok: true };
}
