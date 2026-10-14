import type { LucideIcon } from 'lucide-react';
import { Database, Fingerprint, Globe2, Network, Radar, ScanEye, ShieldAlert } from 'lucide-react';
import type { Client, IndicatorType } from '../types';
import { classifyIndicator, normalizeIndicator } from '../utils/validator';
import type { ActionMenuEntry } from './ActionMenu';

// ---------- Pedidos de ação vindos de qualquer tela (ex.: menu de uma linha) ----------

export const INDICATOR_ACTION_EVENT = 'guardlist:indicator-action';
export type IndicatorAction = 'dossier' | 'where' | 'block' | 'exception' | 'ai';

/** Se o assistente de IA está ligado neste servidor (definido pelo App ao carregar). */
export const aiAvailability = { enabled: false };

/** Pede ao app uma ação sobre um indicador (abre a janela certa, onde quer que o usuário esteja). */
export function requestIndicatorAction(action: IndicatorAction, indicator: string) {
  window.dispatchEvent(new CustomEvent(INDICATOR_ACTION_EVENT, { detail: { action, indicator } }));
}

// ---------- O que está sob o cursor ----------

export type ContextEntity =
  | { kind: 'indicator'; value: string; type: IndicatorType }
  | { kind: 'client'; client: Client };

export const TYPE_LABEL: Partial<Record<IndicatorType, string>> = {
  IPv4: 'IPv4',
  IPv6: 'IPv6',
  CIDR_v4: 'CIDR v4',
  CIDR_v6: 'CIDR v6',
  Domain: 'Domínio'
};

// Palavras com ponto que parecem domínio mas são arquivos ou números da tela.
const NOT_DOMAIN = /\.(?:txt|csv|json|pdf|png|jpe?g|svg|css|js|tsx?|html?|xlsx?|docx?|zip)$/i;

/** Primeiro indicador válido (IP, CIDR ou domínio) dentro de um texto. */
export function findIndicator(text: string): { value: string; type: IndicatorType } | null {
  for (const raw of text.split(/[\s,;|"'()[\]{}<>]+/)) {
    const token = raw.replace(/^[^0-9a-z:]+/i, '').replace(/[.,;:!?…→·]+$/, '');
    if (token.length < 3 || token.length > 120) continue;
    const value = normalizeIndicator(token);
    if (!value) continue;
    const { type, isValid } = classifyIndicator(value);
    if (!isValid || !TYPE_LABEL[type]) continue;
    if (type === 'Domain' && (NOT_DOMAIN.test(value) || !/[a-z]/i.test(value.split('.').pop() || ''))) continue;
    return { value, type };
  }
  return null;
}

/** Palavra sob o cursor (sem precisar selecionar), para textos longos. */
function wordAtPoint(x: number, y: number): string {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    node = p?.offsetNode ?? null;
    offset = p?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    node = r?.startContainer ?? null;
    offset = r?.startOffset ?? 0;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return '';
  const text = node.textContent || '';
  const isWordChar = (c: string) => /[0-9a-z.:/_-]/i.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end);
}

/**
 * Descobre o que foi clicado: texto selecionado, atributos data-indicator / data-client-id,
 * o texto curto do elemento (célula, selo, botão) ou a palavra exata sob o cursor.
 * Retorna 'native' quando o melhor é deixar o menu do navegador (texto selecionado comum).
 */
export function detectEntity(e: MouseEvent, target: HTMLElement, clients: Client[]): ContextEntity | 'native' | null {
  const selection = window.getSelection()?.toString().trim();
  if (selection) {
    const found = findIndicator(selection);
    return found ? { kind: 'indicator', ...found } : 'native';
  }

  const tagged = target.closest<HTMLElement>('[data-indicator]')?.dataset.indicator;
  if (tagged) {
    const found = findIndicator(tagged);
    if (found) return { kind: 'indicator', ...found };
  }
  const clientId = target.closest<HTMLElement>('[data-client-id]')?.dataset.clientId;
  const tagClient = clientId ? clients.find((c) => c.id === clientId) : undefined;
  if (tagClient) return { kind: 'client', client: tagClient };

  const ownText = (target.innerText || target.textContent || '').trim();
  if (ownText && ownText.length <= 80) {
    const byName = clients.find((c) => c.name.toLowerCase() === ownText.toLowerCase());
    if (byName) return { kind: 'client', client: byName };
    if (ownText.length <= 60) {
      const found = findIndicator(ownText);
      if (found) return { kind: 'indicator', ...found };
    }
  }

  const word = wordAtPoint(e.clientX, e.clientY);
  if (word) {
    const found = findIndicator(word);
    if (found) return { kind: 'indicator', ...found };
  }
  return null;
}

// ---------- Consultas em fontes externas (abre em nova aba) ----------

const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
const enc = encodeURIComponent;

/** Submenu "Consultar fora": fontes públicas de reputação, conforme o tipo do indicador. */
export function externalLookupEntries(value: string, type: IndicatorType): ActionMenuEntry[] {
  const v = enc(value);
  const item = (label: string, icon: LucideIcon, url: string): ActionMenuEntry => ({ label, icon, hint: '↗', title: `Abrir ${label} em nova aba`, onSelect: () => open(url) });

  if (type === 'IPv4' || type === 'IPv6') {
    const otxKind = type === 'IPv4' ? 'ip' : 'IPv6';
    return [
      item('AbuseIPDB', ShieldAlert, `https://www.abuseipdb.com/check/${v}`),
      item('VirusTotal', ScanEye, `https://www.virustotal.com/gui/ip-address/${v}`),
      item('GreyNoise', Radar, `https://viz.greynoise.io/ip/${v}`),
      item('AlienVault OTX', Fingerprint, `https://otx.alienvault.com/indicator/${otxKind}/${v}`),
      item('Shodan', Database, `https://www.shodan.io/host/${v}`),
      { type: 'divider' },
      item('Whois do IP', Globe2, `https://who.is/whois-ip/ip-address/${v}`)
    ];
  }
  if (type === 'CIDR_v4' || type === 'CIDR_v6') {
    const [net] = value.split('/');
    return [
      item('AbuseIPDB (faixa)', ShieldAlert, `https://www.abuseipdb.com/check-block/${value}`),
      item('Shodan (net:)', Database, `https://www.shodan.io/search?query=${enc(`net:${value}`)}`),
      item('Hurricane Electric BGP', Network, `https://bgp.he.net/net/${value}`),
      { type: 'divider' },
      item('Whois da rede', Globe2, `https://who.is/whois-ip/ip-address/${enc(net)}`)
    ];
  }
  return [
    item('VirusTotal', ScanEye, `https://www.virustotal.com/gui/domain/${v}`),
    item('AlienVault OTX', Fingerprint, `https://otx.alienvault.com/indicator/domain/${v}`),
    item('urlscan.io', Radar, `https://urlscan.io/search/#${enc(`domain:${value}`)}`),
    item('Certificados (crt.sh)', ShieldAlert, `https://crt.sh/?q=${v}`),
    { type: 'divider' },
    item('Whois do domínio', Globe2, `https://who.is/whois/${v}`)
  ];
}
