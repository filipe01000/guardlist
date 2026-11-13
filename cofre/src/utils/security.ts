/**
 * Utilitários de Hardening de Segurança Web (OWASP ASVS):
 * - Sanitização e validação estrita de URLs contra XSS (`javascript:`, `data:`, `vbscript:`, `file:`)
 * - Normalização de strings e remoção de caracteres de controle / null bytes
 * - Proteção de área de transferência (Clipboard) com limpeza automática temporizada
 */

const ALLOWED_URL_PROTOCOLS = new Set(['https:', 'http:']);

/**
 * Valida uma URL fornecida pelo usuário ou importada de backup para uso seguro em links `<a href="...">`.
 * Retorna a URL normalizada apenas se o protocolo for `https:` ou `http:`.
 * Caso contrário (ex: `javascript:alert(1)`, `data:text/html,...`, `vbscript:...`), retorna `null`.
 */
export function sanitizeSafeExternalUrl(rawUrl: string | undefined | null): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Bloqueia esquemas perigosos mesmo com espaços ou caracteres de controle
  const normalizedCheck = trimmed.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '').toLowerCase();
  if (
    normalizedCheck.startsWith('javascript:') ||
    normalizedCheck.startsWith('data:') ||
    normalizedCheck.startsWith('vbscript:') ||
    normalizedCheck.startsWith('file:') ||
    normalizedCheck.startsWith('blob:')
  ) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Sanitiza um campo de URL ao salvar uma credencial:
 * - Se for vazia, mantém `""`.
 * - Se tentar injetar `javascript:`, `data:`, `vbscript:` ou `file:`, rejeita ou limpa para `""`.
 * - Se não possuir protocolo mas for um domínio válido (ex: `banco.com.br`), prefixa `https://` se válido.
 */
export function normalizeCredentialUrlForStorage(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = sanitizePlainText(rawUrl, 2048).trim();
  if (!trimmed) return '';

  const normalizedCheck = trimmed.replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '').toLowerCase();
  if (
    normalizedCheck.startsWith('javascript:') ||
    normalizedCheck.startsWith('data:') ||
    normalizedCheck.startsWith('vbscript:') ||
    normalizedCheck.startsWith('file:')
  ) {
    throw new Error(
      'URL bloqueada por política de segurança: protocolo não permitido (apenas https:// ou http://).'
    );
  }

  // Se já tem protocolo http/https, valida via URL parser
  if (/^https?:\/\//i.test(trimmed)) {
    const safe = sanitizeSafeExternalUrl(trimmed);
    if (!safe) {
      throw new Error('URL inválida ou protocolo inseguro.');
    }
    return safe;
  }

  // Rejeita qualquer outro esquema desconhecido (ex: customscheme:...)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    throw new Error(
      'URL bloqueada por política de segurança: apenas protocolos https:// e http:// são permitidos.'
    );
  }

  return trimmed;
}

/**
 * Remove caracteres nulos (\0) e caracteres de controle invisíveis (exceto \n, \r, \t)
 * e aplica limite máximo de tamanho para prevenir ataques de exaustão de memória (DoS).
 */
export function sanitizePlainText(input: string, maxLength = 10000): string {
  if (typeof input !== 'string') return '';
  // Remove null bytes e controles C0/C1 exceto \t (0x09), \n (0x0A), \r (0x0D)
  const cleaned = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * Escapa caracteres especiais HTML para contextos fora do JSX ou validação de segurança.
 */
export function escapeHtmlEntities(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copia um segredo para a área de transferência do navegador e agenda a limpeza automática
 * após `clearAfterMs` (padrão: 30 segundos) para reduzir a janela de exposição na área de transferência.
 */
export async function copySecretToClipboardWithAutoClear(
  secret: string,
  clearAfterMs = 30_000
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return;
  }
  await navigator.clipboard.writeText(secret);

  if (clipboardClearTimer) {
    clearTimeout(clipboardClearTimer);
  }

  clipboardClearTimer = setTimeout(async () => {
    try {
      await navigator.clipboard.writeText('');
    } catch {
      // O navegador pode recusar writeText('') se a aba estiver em segundo plano sem foco
    } finally {
      clipboardClearTimer = null;
    }
  }, clearAfterMs);
}
