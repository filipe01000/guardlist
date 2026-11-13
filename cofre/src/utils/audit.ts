import type { CredentialItem } from '../types/vault';
import { evaluatePasswordStrength } from './generator';

export interface AuditedCredential {
  credential: CredentialItem;
  strengthLevel: 'weak' | 'medium' | 'strong';
  zxcvbnScore: 0 | 1 | 2 | 3 | 4;
  isWeak: boolean;
  isReused: boolean;
  reusedCount: number;
  isOld: boolean;
  ageDays: number;
  needsReview: boolean;
  reasons: string[];
  recommendations: string[];
}

export interface VaultSecurityAuditReport {
  totalActiveCredentials: number;
  strongCount: number;
  mediumCount: number;
  weakCount: number;
  reusedCount: number;
  oldCount: number;
  needsReviewCount: number;
  overallScore: number; // 0 to 100
  healthStatus: 'excellent' | 'good' | 'warning' | 'critical';
  healthHeadline: string;
  auditedItems: AuditedCredential[];
  globalRecommendations: string[];
}

const OLD_PASSWORD_THRESHOLD_DAYS = 90;

/**
 * Executa auditoria local completa sobre as credenciais ativas do cofre.
 * Nenhuma senha sai do navegador.
 */
export function runVaultSecurityAudit(
  credentials: CredentialItem[],
  nowTimestamp: number = Date.now()
): VaultSecurityAuditReport {
  const activeCredentials = credentials.filter((c) => !c.deletedAt);

  if (activeCredentials.length === 0) {
    return {
      totalActiveCredentials: 0,
      strongCount: 0,
      mediumCount: 0,
      weakCount: 0,
      reusedCount: 0,
      oldCount: 0,
      needsReviewCount: 0,
      overallScore: 100,
      healthStatus: 'excellent',
      healthHeadline: 'Cofre limpinho! Adicione sua primeira senha para começar.',
      auditedItems: [],
      globalRecommendations: [
        'Use o Gerador de Senhas para criar credenciais únicas de 16+ caracteres.',
      ],
    };
  }

  // Contabiliza repetição de senhas exatas
  const passwordFrequency = new Map<string, number>();
  for (const item of activeCredentials) {
    const pwd = item.password || '';
    passwordFrequency.set(pwd, (passwordFrequency.get(pwd) || 0) + 1);
  }

  let strongCount = 0;
  let mediumCount = 0;
  let weakCount = 0;
  let reusedCount = 0;
  let oldCount = 0;
  let needsReviewCount = 0;

  const auditedItems: AuditedCredential[] = activeCredentials.map((cred) => {
    const analysis = evaluatePasswordStrength(cred.password, [
      cred.serviceName,
      cred.username,
      cred.email,
    ].filter(Boolean));

    const isWeak = analysis.level === 'weak';
    if (analysis.level === 'strong') strongCount++;
    else if (analysis.level === 'medium') mediumCount++;
    else weakCount++;

    const reusedOccurrences = passwordFrequency.get(cred.password) || 1;
    const isReused = reusedOccurrences > 1;
    if (isReused) reusedCount++;

    const updatedMs = Date.parse(cred.updatedAt || cred.createdAt);
    const ageDays = Number.isNaN(updatedMs)
      ? 0
      : Math.max(0, Math.floor((nowTimestamp - updatedMs) / (1000 * 60 * 60 * 24)));
    const isOld = ageDays >= OLD_PASSWORD_THRESHOLD_DAYS;
    if (isOld) oldCount++;

    const reasons: string[] = [];
    const recommendations: string[] = [];

    if (isWeak) {
      reasons.push('Senha fraca');
      recommendations.push(
        `Substitua a senha de "${cred.serviceName}" por uma senha gerada de pelo menos 16 caracteres.`
      );
    }
    if (isReused) {
      reasons.push(`Reutilizada em ${reusedOccurrences} contas`);
      recommendations.push(
        `Gere uma senha exclusiva para "${cred.serviceName}": se uma senha vazar, as outras contas que a usam ficam expostas.`
      );
    }
    if (isOld) {
      reasons.push(`Sem atualização há ${ageDays} dias`);
      recommendations.push(
        `Atualize a senha de "${cred.serviceName}" (última alteração há ${ageDays} dias).`
      );
    }

    const needsReview = isWeak || isReused || isOld || analysis.level === 'medium';
    if (needsReview) {
      needsReviewCount++;
      if (!isWeak && !isReused && !isOld && analysis.level === 'medium') {
        reasons.push('Força média');
        recommendations.push(
          `Fortaleça "${cred.serviceName}" adicionando mais comprimento ou símbolos.`
        );
      }
    }

    return {
      credential: cred,
      strengthLevel: analysis.level,
      zxcvbnScore: analysis.score,
      isWeak,
      isReused,
      reusedCount: reusedOccurrences,
      isOld,
      ageDays,
      needsReview,
      reasons,
      recommendations,
    };
  });

  // Cálculo ponderado do score geral de segurança (0..100)
  const total = activeCredentials.length;
  const baseStrengthPoints =
    ((strongCount * 100 + mediumCount * 65 + weakCount * 15) / total);
  const reusedPenalty = (reusedCount / total) * 30;
  const oldPenalty = (oldCount / total) * 12;

  const overallScore = Math.max(
    5,
    Math.min(100, Math.round(baseStrengthPoints - reusedPenalty - oldPenalty))
  );

  let healthStatus: VaultSecurityAuditReport['healthStatus'] = 'excellent';
  let healthHeadline = 'Suas senhas estão em dia.';

  if (overallScore < 50 || weakCount > 0 && weakCount >= total / 2) {
    healthStatus = 'critical';
    healthHeadline = 'Várias senhas precisam ser trocadas logo.';
  } else if (overallScore < 75 || weakCount > 0 || reusedCount > 0) {
    healthStatus = 'warning';
    healthHeadline = 'Algumas senhas precisam de atenção. Veja abaixo o que trocar.';
  } else if (overallScore < 90) {
    healthStatus = 'good';
    healthHeadline = 'Mandou bem! Cofre bem protegido, só faltam pequenos ajustes.';
  }

  const globalRecommendations: string[] = [];
  if (weakCount > 0) {
    globalRecommendations.push(
      `Troque imediatamente ${weakCount} ${weakCount === 1 ? 'senha fraca' : 'senhas fracas'} usando o Gerador de Senhas.`
    );
  }
  if (reusedCount > 0) {
    globalRecommendations.push(
      `Elimine as ${reusedCount} credenciais com senhas repetidas para evitar efeito dominó em vazamentos.`
    );
  }
  if (oldCount > 0) {
    globalRecommendations.push(
      `Renove ${oldCount} ${oldCount === 1 ? 'credencial que não é atualizada' : 'credenciais que não são atualizadas'} há mais de 90 dias.`
    );
  }
  if (globalRecommendations.length === 0) {
    globalRecommendations.push(
      'Nenhuma vulnerabilidade crítica detectada! Continue exportando backups criptografados periodicamente.'
    );
  }

  return {
    totalActiveCredentials: total,
    strongCount,
    mediumCount,
    weakCount,
    reusedCount,
    oldCount,
    needsReviewCount,
    overallScore,
    healthStatus,
    healthHeadline,
    auditedItems,
    globalRecommendations,
  };
}
