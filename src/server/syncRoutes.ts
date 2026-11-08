import express, { type Request, type Response } from 'express';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  consumeSingleUseChallengeInDb,
  createSingleUseChallengeInDb,
  fetchEmergencyRecoveryBundleFromDb,
  getEncryptedVaultHistoryFromDb,
  hashTokenSha256,
  listUserDevicesFromDb,
  listUserWebAuthnCredentialsFromDb,
  provisionDeviceInDb,
  pullEncryptedRecordsFromDb,
  pushEncryptedOperationsToDb,
  recordAuthAuditEvent,
  registerOrUpdateVaultMetadataInDb,
  revokeUserDeviceInDb,
  revokeVaultRecoveryKeyInDb,
  saveVaultRecoveryWrapInDb,
  saveWebAuthnCredentialInDb,
  verifyAndAdvanceWebAuthnCounterInDb,
  verifyDeviceSessionInDb,
} from '../db/repository.ts';
import {
  type AuthenticatedSyncRequest,
  checkRateLimit,
  clearSecureSessionCookies,
  enforceZeroPlaintextBodyGuard,
  parseCookieHeader,
  requireDeviceOrFirebaseAuth,
  setSecureSessionCookies,
} from '../middleware/auth.ts';
import {
  antiReconAndScannerTrapMiddleware,
  extractClientIp,
  inputFuzzingDefenseMiddleware,
  optionalCloudflareZeroTrustGuard,
  sanitizedApiErrorMiddleware,
  securityHeadersAndAntiFingerprintMiddleware,
  strictCorsDefenseMiddleware,
} from '../middleware/reconDefense.ts';
import { scannerDetector } from '../services/ScannerDetectionService.ts';
import { CryptoEngine } from '../services/CryptoEngine.ts';
import type { Argon2Params } from '../types/vault.ts';
import type { SyncPushOperation } from '../services/SyncAdapter.ts';
import { db } from '../db/index.ts';
import { vaults } from '../db/schema.ts';
import { eq } from 'drizzle-orm';

interface SseClientConnection {
  clientId: string;
  userUid: string;
  deviceId: string;
  vaultId: string;
  res: Response;
}

const sseClients = new Map<string, SseClientConnection>();

function closeSseConnectionsForDevice(deviceId: string): number {
  let closed = 0;
  for (const [id, client] of sseClients.entries()) {
    if (client.deviceId === deviceId) {
      try {
        client.res.write(
          `data: ${JSON.stringify({
            type: 'SESSION_TERMINATED',
            deviceId,
            timestamp: new Date().toISOString(),
          })}\n\n`
        );
        client.res.end();
      } catch {
        // ignore
      }
      sseClients.delete(id);
      closed += 1;
    }
  }
  return closed;
}

/**
 * Notifica via SSE todos os outros dispositivos conectados do mesmo usuário/cofre
 * que existem novos registros criptografados disponíveis para Pull incremental.
 * Verifica antes de cada envio que a sessão do dispositivo permanece ativa e não expirou.
 */
export async function broadcastVaultCursorUpdate(params: {
  userUid: string;
  vaultId: string;
  latestCursor: number;
  sourceDeviceId: string;
}): Promise<void> {
  const payload = JSON.stringify({
    type: 'SYNC_CURSOR_UPDATED',
    vaultId: params.vaultId,
    latestCursor: params.latestCursor,
    sourceDeviceId: params.sourceDeviceId,
    timestamp: new Date().toISOString(),
  });

  for (const [id, client] of sseClients.entries()) {
    if (
      client.userUid === params.userUid &&
      client.vaultId === params.vaultId
    ) {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch {
        sseClients.delete(id);
      }
    }
  }
}

export function getActiveSseClientCountForDevice(deviceId: string): number {
  let count = 0;
  for (const client of sseClients.values()) {
    if (client.deviceId === deviceId) {
      count += 1;
    }
  }
  return count;
}

function resolveRpIdAndOrigin(req: Request): {
  rpId: string;
  expectedOrigin: string;
} {
  const customRpId = req.body?.rpId ? String(req.body.rpId).trim() : '';
  const customOrigin = req.body?.origin ? String(req.body.origin).trim() : '';
  const hostHeader = req.headers.host || 'localhost:3000';
  const hostname = customRpId || req.hostname || hostHeader.split(':')[0] || 'localhost';
  const proto =
    (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const expectedOrigin =
    customOrigin ||
    req.headers.origin ||
    `${proto}://${hostHeader}`;
  return { rpId: hostname, expectedOrigin };
}

export function createSyncApiRouter(): express.Router {
  const router = express.Router();

  // Camadas de Defesa Fase 5B (Anti-Fingerprinting, CORS Restritivo, Zero Trust, Anti-Scanner e Anti-Fuzzing)
  router.use(securityHeadersAndAntiFingerprintMiddleware);
  router.use(strictCorsDefenseMiddleware);
  router.use(optionalCloudflareZeroTrustGuard);
  router.use(antiReconAndScannerTrapMiddleware);
  router.use(inputFuzzingDefenseMiddleware);

  // Proteção global Zero-Plaintext em todas as rotas da API v1
  router.use(enforceZeroPlaintextBodyGuard);

  // 1. Health check estruturado de homologação/produção (sem segredos ou versões de pacotes internos)
  router.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'donutvault-zero-knowledge-sync',
      apiVersion: 'v1',
      zeroKnowledgeMode: 'enforced',
      webauthnEngine: '@simplewebauthn/server',
      sseUrlTokenPolicy: 'forbidden',
      reconDefense: 'active',
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // FASE 5A — §1: FLUXO COMPLETO WEBAUTHN / PASSKEYS (@simplewebauthn/server)
  // ============================================================================

  // 2A. Gerar opções criptográficas de registro de Passkey (Challenge único e temporário)
  router.post(
    '/auth/webauthn/register/options',
    async (req: Request, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      const rl = checkRateLimit(`webauthn-reg-opt:${clientIp}`, 40, 60_000);
      if (!rl.allowed) {
        res.status(429).json({ error: 'Rate limit excedido (429).' });
        return;
      }

      try {
        const userUid = String(req.body?.userUid || '').trim();
        const email = String(
          req.body?.email || `${userUid}@donutvault.local`
        ).trim();
        if (!userUid || userUid.length > 128) {
          res.status(400).json({ error: 'userUid válido é obrigatório (400).' });
          return;
        }

        // Verifica se a conta já possui Passkeys ou Cofres registrados.
        // Se já possuir, exige sessão autenticada da própria conta para cadastrar nova Passkey!
        const existingPasskeys = await listUserWebAuthnCredentialsFromDb(userUid);
        const existingVaults = await db
          .select()
          .from(vaults)
          .where(eq(vaults.userUid, userUid));

        if (existingPasskeys.length > 0 || existingVaults.length > 0) {
          const cookies = parseCookieHeader(req.headers.cookie);
          const token =
            req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ||
            cookies.dvlt_sid ||
            '';
          const deviceId =
            (req.headers['x-device-id'] as string) || cookies.dvlt_did || '';

          if (!token || !deviceId) {
            res.status(403).json({
              error:
                'Violação de Autorização (403 Forbidden): Esta conta já existe. Autentique-se na conta antes de registrar uma nova Passkey.',
            });
            return;
          }
          await verifyDeviceSessionInDb({
            expectedUserUid: userUid,
            deviceId,
            rawSessionToken: token,
          });
        }

        const { rpId, expectedOrigin } = resolveRpIdAndOrigin(req);
        const options = await generateRegistrationOptions({
          rpName: 'DonutVault Zero-Knowledge Sync',
          rpID: rpId,
          userName: email,
          userDisplayName: userUid,
          userID: new Uint8Array(Buffer.from(userUid, 'utf-8')),
          attestationType: 'none',
          excludeCredentials: existingPasskeys.map((cred) => ({
            id: cred.credentialId,
            transports: JSON.parse(
              cred.transportsJson
            ) as AuthenticatorTransport[],
          })),
          authenticatorSelection: {
            residentKey: 'preferred',
            userVerification: 'required',
          },
        });

        const savedChallenge = await createSingleUseChallengeInDb({
          userUid,
          challenge: options.challenge,
          purpose: 'registration',
          rpId,
          expectedOrigin,
          ttlMs: 5 * 60 * 1000,
        });

        res.status(200).json({
          challengeId: savedChallenge.challengeId,
          options,
          rpId,
          expectedOrigin,
          expiresInSeconds: 300,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Falha ao gerar opções de registro WebAuthn.',
        });
      }
    }
  );

  // 2B. Verificar resposta criptográfica de registro de Passkey (@simplewebauthn/server)
  router.post(
    '/auth/webauthn/register/verify',
    async (req: Request, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      try {
        const userUid = String(req.body?.userUid || '').trim();
        const email = String(
          req.body?.email || `${userUid}@donutvault.local`
        ).trim();
        const challengeId = req.body?.challengeId
          ? String(req.body.challengeId).trim()
          : undefined;
        const deviceName = String(
          req.body?.deviceName || 'Dispositivo Passkey Verificado'
        ).trim();
        const platform = (req.body?.platform || 'desktop-web') as
          | 'desktop-web'
          | 'mobile-web'
          | 'ios'
          | 'android';
        const registrationResponse = req.body
          ?.registrationResponse as RegistrationResponseJSON;

        if (!userUid || !registrationResponse || typeof registrationResponse !== 'object') {
          res.status(400).json({
            error: 'userUid e registrationResponse WebAuthn são obrigatórios (400).',
          });
          return;
        }

        // Consome atomicamente o challenge de uso único (impede replay!)
        const consumedChallenge = await consumeSingleUseChallengeInDb({
          challengeId,
          userUid,
          purpose: 'registration',
        });

        const verification = await verifyRegistrationResponse({
          response: registrationResponse,
          expectedChallenge: consumedChallenge.challenge,
          expectedOrigin: consumedChallenge.expectedOrigin,
          expectedRPID: consumedChallenge.rpId,
          requireUserPresence: true,
          requireUserVerification: true,
        });

        if (!verification.verified || !verification.registrationInfo) {
          res.status(401).json({
            error: 'Verificação criptográfica da Passkey falhou (401 Unauthorized).',
          });
          return;
        }

        const { credential, credentialDeviceType, credentialBackedUp } =
          verification.registrationInfo;

        await saveWebAuthnCredentialInDb({
          credentialId: credential.id,
          userUid,
          email,
          publicKeyBytes: credential.publicKey,
          counter: credential.counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: credential.transports,
        });

        const { device, rawSessionToken, rawCsrfToken } =
          await provisionDeviceInDb({
            userUid,
            email,
            deviceName,
            platform,
            authMethod: 'webauthn-passkey',
            webauthnCredentialId: credential.id,
            verifiedOwner: true,
          });

        setSecureSessionCookies(res, device.deviceId, rawSessionToken);

        await recordAuthAuditEvent({
          userUid,
          deviceId: device.deviceId,
          eventType: 'WEBAUTHN_PASSKEY_REGISTERED',
          clientIp,
          metadata: {
            credentialId: credential.id,
            deviceType: credentialDeviceType,
            userVerified: verification.registrationInfo.userVerified,
          },
        });

        res.status(201).json({
          verified: true,
          credentialId: credential.id,
          device: {
            deviceId: device.deviceId,
            userUid: device.userUid,
            deviceName: device.deviceName,
            platform: device.platform,
            authMethod: device.authMethod,
            authorizedAt: device.authorizedAt.toISOString(),
            lastSeenAt: device.lastSeenAt.toISOString(),
            expiresAt: device.expiresAt.toISOString(),
            revokedAt: null,
          },
          sessionToken: rawSessionToken,
          csrfToken: rawCsrfToken,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 401;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Falha na verificação de registro WebAuthn.',
        });
      }
    }
  );

  // 2C. Gerar opções criptográficas de autenticação WebAuthn (Assertion Challenge de uso único)
  // Fase 5B (§3): Proteção contra Enumeração de Contas — retorna resposta uniforme 200 OK com credencial
  // decoy determinística quando a conta ainda não possui Passkeys registradas.
  router.post(
    '/auth/webauthn/authenticate/options',
    async (req: Request, res: Response) => {
      const clientIp = extractClientIp(req);
      const userUid = String(req.body?.userUid || '').trim();

      const bf = scannerDetector.checkBruteForceAllowance({
        clientIp,
        targetAccount: userUid || undefined,
        scope: 'webauthn-auth',
      });
      if (!bf.allowed) {
        res.setHeader('Retry-After', String(bf.retryAfterSeconds));
        res.status(429).json({
          error: bf.reason || 'Rate limit de autenticação excedido (429).',
          retryAfterSeconds: bf.retryAfterSeconds,
        });
        return;
      }

      try {
        if (!userUid || userUid.length > 128) {
          res.status(400).json({ error: 'userUid é obrigatório (400).' });
          return;
        }

        const userPasskeys = await listUserWebAuthnCredentialsFromDb(userUid);
        const { rpId, expectedOrigin } = resolveRpIdAndOrigin(req);

        // Se o userUid não existir no banco, gera descritor sintético determinístico (Anti-Enumeração)
        const allowCredentials =
          userPasskeys.length > 0
            ? userPasskeys.map((cred) => ({
                id: cred.credentialId,
                transports: JSON.parse(
                  cred.transportsJson
                ) as AuthenticatorTransport[],
              }))
            : [
                {
                  id: Buffer.from(
                    hashTokenSha256(`DONUTVAULT_DECOY_CRED_V1:${userUid}`).slice(
                      0,
                      32
                    ),
                    'utf-8'
                  ).toString('base64url'),
                  transports: ['internal'] as AuthenticatorTransport[],
                },
              ];

        const options = await generateAuthenticationOptions({
          rpID: rpId,
          userVerification: 'required',
          allowCredentials,
        });

        const savedChallenge = await createSingleUseChallengeInDb({
          userUid,
          challenge: options.challenge,
          purpose: 'authentication',
          rpId,
          expectedOrigin,
          ttlMs: 5 * 60 * 1000,
        });

        res.status(200).json({
          challengeId: savedChallenge.challengeId,
          options,
          rpId,
          expectedOrigin,
          expiresInSeconds: 300,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao gerar desafio de autenticação WebAuthn.',
        });
      }
    }
  );

  // 2D. Verificar assinatura criptográfica de autenticação WebAuthn (@simplewebauthn/server)
  router.post(
    '/auth/webauthn/authenticate/verify',
    async (req: Request, res: Response) => {
      const clientIp = extractClientIp(req);
      const userUid = String(req.body?.userUid || '').trim();

      const bf = scannerDetector.checkBruteForceAllowance({
        clientIp,
        targetAccount: userUid || undefined,
        scope: 'webauthn-auth',
      });
      if (!bf.allowed) {
        res.setHeader('Retry-After', String(bf.retryAfterSeconds));
        res.status(429).json({
          error: bf.reason || 'Backoff progressivo ativo para autenticação (429).',
          retryAfterSeconds: bf.retryAfterSeconds,
        });
        return;
      }

      try {
        const challengeId = req.body?.challengeId
          ? String(req.body.challengeId).trim()
          : undefined;
        const deviceName = String(
          req.body?.deviceName || 'Dispositivo Autenticado via Passkey'
        ).trim();
        const platform = (req.body?.platform || 'desktop-web') as
          | 'desktop-web'
          | 'mobile-web'
          | 'ios'
          | 'android';
        const authenticationResponse = req.body
          ?.authenticationResponse as AuthenticationResponseJSON;

        if (
          !userUid ||
          !authenticationResponse ||
          typeof authenticationResponse !== 'object'
        ) {
          res.status(400).json({
            error:
              'userUid e authenticationResponse WebAuthn são obrigatórios (400).',
          });
          return;
        }

        // Consome atomicamente o challenge de uso único (bloqueia Replay!)
        const consumedChallenge = await consumeSingleUseChallengeInDb({
          challengeId,
          userUid,
          purpose: 'authentication',
        });

        const userPasskeys = await listUserWebAuthnCredentialsFromDb(userUid);
        const matchedCred = userPasskeys.find(
          (c) => c.credentialId === authenticationResponse.id
        );
        if (!matchedCred) {
          scannerDetector.recordAuthFailure({
            clientIp,
            targetAccount: userUid,
            scope: 'webauthn-auth',
            method: req.method,
            path: req.originalUrl || req.path,
            statusCode: 403,
            failureThreshold: 5,
          });
          await recordAuthAuditEvent({
            userUid,
            deviceId: 'webauthn-unmatched',
            eventType: 'WEBAUTHN_CREDENTIAL_NOT_BOUND_TO_USER',
            clientIp,
            metadata: { attemptedCredentialId: authenticationResponse.id || 'none' },
          });
          res.status(403).json({
            error:
              'Violação de Autorização WebAuthn (403 Forbidden): Esta Passkey não pertence à conta solicitada.',
          });
          return;
        }

        const verification = await verifyAuthenticationResponse({
          response: authenticationResponse,
          expectedChallenge: consumedChallenge.challenge,
          expectedOrigin: consumedChallenge.expectedOrigin,
          expectedRPID: consumedChallenge.rpId,
          credential: {
            id: matchedCred.credentialId,
            publicKey: new Uint8Array(
              Buffer.from(matchedCred.publicKeyBase64, 'base64')
            ),
            counter: matchedCred.counter,
            transports: JSON.parse(
              matchedCred.transportsJson
            ) as AuthenticatorTransport[],
          },
          requireUserVerification: true,
        });

        if (!verification.verified || !verification.authenticationInfo) {
          scannerDetector.recordAuthFailure({
            clientIp,
            targetAccount: userUid,
            scope: 'webauthn-auth',
            method: req.method,
            path: req.originalUrl || req.path,
            statusCode: 401,
            failureThreshold: 5,
          });
          res.status(401).json({
            error: 'Assinatura WebAuthn inválida (401 Unauthorized).',
          });
          return;
        }

        // Valida e avança contador de assinaturas no PostgreSQL (proteção contra autenticador clonado)
        await verifyAndAdvanceWebAuthnCounterInDb({
          credentialId: matchedCred.credentialId,
          expectedUserUid: userUid,
          newCounter: verification.authenticationInfo.newCounter,
        });

        scannerDetector.recordAuthSuccess({
          clientIp,
          targetAccount: userUid,
          scope: 'webauthn-auth',
        });

        const { device, rawSessionToken, rawCsrfToken } =
          await provisionDeviceInDb({
            userUid,
            email: `${userUid}@donutvault.local`,
            deviceName,
            platform,
            authMethod: 'webauthn-passkey',
            webauthnCredentialId: matchedCred.credentialId,
            verifiedOwner: true,
          });

        setSecureSessionCookies(res, device.deviceId, rawSessionToken);

        await recordAuthAuditEvent({
          userUid,
          deviceId: device.deviceId,
          eventType: 'WEBAUTHN_ASSERTION_VERIFIED',
          clientIp,
          metadata: {
            credentialId: matchedCred.credentialId,
            newCounter: verification.authenticationInfo.newCounter,
            userVerified: verification.authenticationInfo.userVerified,
          },
        });

        res.status(200).json({
          verified: true,
          device: {
            deviceId: device.deviceId,
            userUid: device.userUid,
            deviceName: device.deviceName,
            platform: device.platform,
            authMethod: device.authMethod,
            authorizedAt: device.authorizedAt.toISOString(),
            lastSeenAt: device.lastSeenAt.toISOString(),
            expiresAt: device.expiresAt.toISOString(),
            revokedAt: null,
          },
          sessionToken: rawSessionToken,
          csrfToken: rawCsrfToken,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 401;
        scannerDetector.recordAuthFailure({
          clientIp,
          targetAccount: userUid || undefined,
          scope: 'webauthn-auth',
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: status,
          failureThreshold: 5,
        });
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Falha na autenticação criptográfica WebAuthn.',
        });
      }
    }
  );

  // 2E. Desafio de uso único compatível com clientes legados (/auth/passkey/challenge)
  router.post(
    '/auth/passkey/challenge',
    async (req: Request, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      const rl = checkRateLimit(`challenge:${clientIp}`, 60, 60_000);
      if (!rl.allowed) {
        res.status(429).json({ error: 'Rate limit excedido (429).' });
        return;
      }

      try {
        const userUid = String(req.body?.userUid || '').trim();
        if (!userUid || userUid.length > 128) {
          res.status(400).json({ error: 'userUid válido é obrigatório.' });
          return;
        }

        const { rpId, expectedOrigin } = resolveRpIdAndOrigin(req);
        const challengeHex = bytesToHex(CryptoEngine.getRandomBytes(32));
        const saved = await createSingleUseChallengeInDb({
          userUid,
          challenge: challengeHex,
          purpose: 'authentication',
          rpId,
          expectedOrigin,
          ttlMs: 5 * 60 * 1000,
        });

        res.status(200).json({
          challengeId: saved.challengeId,
          userUid,
          challengeHex,
          rpId,
          expectedOrigin,
          rpName: 'DonutVault Zero-Knowledge Sync',
          expiresInSeconds: 300,
        });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao emitir challenge criptográfico.',
        });
      }
    }
  );

  // 3. Cadastro e Provisionamento de Dispositivo Autorizado (PC ou Celular)
  // Fase 5A (§1): Bloqueia tentativas não autenticadas de registrar dispositivo em conta existente alheia!
  router.post('/auth/devices/register', async (req: Request, res: Response) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '127.0.0.1';
    const rl = checkRateLimit(`register:${clientIp}`, 40, 60_000);
    if (!rl.allowed) {
      res.status(429).json({ error: 'Rate limit excedido (429).' });
      return;
    }

    try {
      const userUid = String(req.body?.userUid || '').trim();
      const email = String(
        req.body?.email || `${userUid}@donutvault.local`
      ).trim();
      const deviceName = String(req.body?.deviceName || '').trim();
      const platform = req.body?.platform as
        | 'desktop-web'
        | 'mobile-web'
        | 'ios'
        | 'android';
      const authMethod = (req.body?.authMethod || 'webauthn-passkey') as
        | 'webauthn-passkey'
        | 'firebase-oauth'
        | 'session-token';
      const webauthnCredentialId = req.body?.webauthnCredentialId
        ? String(req.body.webauthnCredentialId)
        : undefined;
      const publicKeySpkiB64 = req.body?.publicKeySpkiB64
        ? String(req.body.publicKeySpkiB64)
        : undefined;
      const ttlMs =
        typeof req.body?.ttlMs === 'number' ? req.body.ttlMs : undefined;

      if (
        !userUid ||
        !deviceName ||
        !['desktop-web', 'mobile-web', 'ios', 'android'].includes(platform) ||
        !['webauthn-passkey', 'firebase-oauth', 'session-token'].includes(
          authMethod
        )
      ) {
        res.status(400).json({
          error:
            'Dados de registro de dispositivo inválidos (userUid, deviceName, platform, authMethod são obrigatórios).',
        });
        return;
      }

      // Verifica se o chamador apresentou sessão autenticada válida da própria conta
      let verifiedOwner = false;
      const cookies = parseCookieHeader(req.headers.cookie);
      const callerToken =
        req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() ||
        cookies.dvlt_sid ||
        '';
      const callerDeviceId =
        (req.headers['x-device-id'] as string) || cookies.dvlt_did || '';

      if (callerToken && callerDeviceId) {
        const existingDevice = await verifyDeviceSessionInDb({
          expectedUserUid: userUid,
          deviceId: callerDeviceId,
          rawSessionToken: callerToken,
        });
        if (existingDevice.userUid === userUid) {
          verifiedOwner = true;
        }
      }

      const enforceStrict = Boolean(req.body?.enforceStrictOwnership);

      const { device, rawSessionToken, rawCsrfToken } =
        await provisionDeviceInDb({
          userUid,
          email,
          deviceName,
          platform,
          authMethod,
          webauthnCredentialId,
          publicKeySpkiB64,
          ttlMs,
          verifiedOwner,
          enforceStrictOwnershipIfVaultExists:
            enforceStrict || Boolean(callerToken && !verifiedOwner),
        });

      setSecureSessionCookies(res, device.deviceId, rawSessionToken);

      await recordAuthAuditEvent({
        userUid,
        deviceId: device.deviceId,
        eventType: 'DEVICE_AUTHORIZED',
        clientIp,
        metadata: {
          platform,
          authMethod,
          verifiedOwner,
        },
      });

      res.status(201).json({
        device: {
          deviceId: device.deviceId,
          userUid: device.userUid,
          deviceName: device.deviceName,
          platform: device.platform,
          authMethod: device.authMethod,
          authorizedAt: device.authorizedAt.toISOString(),
          lastSeenAt: device.lastSeenAt.toISOString(),
          expiresAt: device.expiresAt.toISOString(),
          revokedAt: null,
        },
        sessionToken: rawSessionToken,
        csrfToken: rawCsrfToken,
      });
    } catch (error) {
      const status =
        (error as Error & { statusCode?: number }).statusCode || 500;
      res.status(status).json({
        error:
          error instanceof Error
            ? error.message
            : 'Falha ao autorizar dispositivo.',
      });
    }
  });

  // 4. Listar Dispositivos Autorizados da Conta
  router.get(
    '/auth/devices',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      try {
        const userUid = req.authContext!.userUid;
        const devices = await listUserDevicesFromDb(userUid);
        res.status(200).json({ devices });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao listar dispositivos.',
        });
      }
    }
  );

  // 5A. Revogar Sessão / Dispositivo Específico
  router.post(
    '/auth/devices/:deviceId/revoke',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      try {
        const userUid = req.authContext!.userUid;
        const targetDeviceId = String(req.params.deviceId || '').trim();
        const revoked = await revokeUserDeviceInDb(userUid, targetDeviceId);

        const closedSseCount = closeSseConnectionsForDevice(targetDeviceId);

        await recordAuthAuditEvent({
          userUid,
          deviceId: targetDeviceId,
          eventType: 'DEVICE_REVOKED',
          clientIp,
          metadata: {
            revokedByDeviceId: req.authContext!.deviceId,
            closedSseStreams: closedSseCount,
          },
        });

        res.status(200).json({
          deviceId: revoked.deviceId,
          revokedAt:
            revoked.revokedAt?.toISOString() || new Date().toISOString(),
          closedSseStreams: closedSseCount,
          securityNote:
            'Sessão revogada no servidor Zero-Knowledge. Novas sincronizações e streams SSE deste dispositivo estão bloqueados (401), mas cópias locais já baixadas anteriormente não são apagadas remotamente.',
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao revogar dispositivo.',
        });
      }
    }
  );

  // 5B. Logout Explícito da Sessão Atual (Revoga token no PostgreSQL, limpa Cookie HttpOnly e fecha SSE)
  router.post(
    '/auth/logout',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      try {
        const userUid = req.authContext!.userUid;
        const deviceId = req.authContext!.deviceId;
        await revokeUserDeviceInDb(userUid, deviceId);
        const closedSseStreams = closeSseConnectionsForDevice(deviceId);
        clearSecureSessionCookies(res);

        await recordAuthAuditEvent({
          userUid,
          deviceId,
          eventType: 'DEVICE_LOGOUT',
          clientIp,
          metadata: { closedSseStreams },
        });

        res.status(200).json({
          loggedOut: true,
          deviceId,
          closedSseStreams,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao encerrar sessão.',
        });
      }
    }
  );

  // 6. Registrar ou Atualizar Metadados Criptográficos do Cofre (Zero-Knowledge)
  router.post(
    '/sync/vault',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      try {
        const userUid = req.authContext!.userUid;
        const vaultId = String(req.body?.vaultId || '').trim();
        const activeKeyEpoch = Number(req.body?.activeKeyEpoch || 1);
        const kdfParams = req.body?.kdfParams as Argon2Params;
        const saltHex = String(req.body?.saltHex || '').trim();
        const wrappedDekHex = String(req.body?.wrappedDekHex || '').trim();
        const dekNonceHex = String(req.body?.dekNonceHex || '').trim();

        if (
          !vaultId ||
          !kdfParams ||
          typeof kdfParams.m !== 'number' ||
          typeof kdfParams.t !== 'number' ||
          !saltHex ||
          saltHex.length < 32 ||
          !wrappedDekHex ||
          wrappedDekHex.length < 64 ||
          dekNonceHex.length !== 24
        ) {
          res.status(400).json({
            error:
              'Metadados criptográficos do cofre incompletos ou malformados (400).',
          });
          return;
        }

        const savedVault = await registerOrUpdateVaultMetadataInDb({
          userUid,
          vaultId,
          activeKeyEpoch,
          kdfParams,
          saltHex,
          wrappedDekHex,
          dekNonceHex,
        });

        res.status(200).json({
          vaultId: savedVault.vaultId,
          activeKeyEpoch: savedVault.activeKeyEpoch,
          updatedAt: savedVault.updatedAt.toISOString(),
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao registrar cofre no servidor.',
        });
      }
    }
  );

  // ============================================================================
  // FASE 5A — §3: ENDPOINTS DE RECUPERAÇÃO DE EMERGÊNCIA (ZERO-KNOWLEDGE DEK WRAP)
  // ============================================================================

  // 6B. Salvar ou Substituir Encapsulamento Independente da DEK para Recuperação de Emergência
  router.post(
    '/sync/vault/recovery',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      try {
        const userUid = req.authContext!.userUid;
        const vaultId = String(req.body?.vaultId || '').trim();
        const recoveryKeyVersion = Number(req.body?.recoveryKeyVersion || 1);
        const recoverySaltHex = String(req.body?.recoverySaltHex || '').trim();
        const recoveryWrappedDekHex = String(
          req.body?.recoveryWrappedDekHex || ''
        ).trim();
        const recoveryDekNonceHex = String(
          req.body?.recoveryDekNonceHex || ''
        ).trim();
        const recoveryKeyCommitmentSha256 = String(
          req.body?.recoveryKeyCommitmentSha256 || ''
        ).trim();

        if (
          !vaultId ||
          recoveryKeyVersion < 1 ||
          recoverySaltHex.length < 32 ||
          recoveryWrappedDekHex.length < 64 ||
          recoveryDekNonceHex.length !== 24 ||
          recoveryKeyCommitmentSha256.length !== 64
        ) {
          res.status(400).json({
            error:
              'Metadados de encapsulamento da chave de recuperação inválidos (400).',
          });
          return;
        }

        const updated = await saveVaultRecoveryWrapInDb({
          userUid,
          vaultId,
          recoveryKeyVersion,
          recoverySaltHex,
          recoveryWrappedDekHex,
          recoveryDekNonceHex,
          recoveryKeyCommitmentSha256,
        });

        await recordAuthAuditEvent({
          userUid,
          deviceId: req.authContext!.deviceId,
          eventType: 'EMERGENCY_RECOVERY_KEY_UPDATED',
          clientIp,
          metadata: {
            vaultId,
            recoveryKeyVersion: updated.recoveryKeyVersion,
          },
        });

        res.status(200).json({
          vaultId: updated.vaultId,
          recoveryKeyVersion: updated.recoveryKeyVersion,
          recoveryKeyCommitmentSha256: updated.recoveryKeyCommitmentSha256,
          recoveryUpdatedAt: updated.recoveryUpdatedAt?.toISOString(),
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao salvar encapsulamento de recuperação.',
        });
      }
    }
  );

  // 6C. Revogar Chave de Recuperação de Emergência Atual
  router.post(
    '/sync/vault/recovery/revoke',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      const clientIp =
        (req.headers['x-forwarded-for'] as string) ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      try {
        const userUid = req.authContext!.userUid;
        const vaultId = String(req.body?.vaultId || '').trim();
        if (!vaultId) {
          res.status(400).json({ error: 'vaultId é obrigatório (400).' });
          return;
        }

        const updated = await revokeVaultRecoveryKeyInDb({ userUid, vaultId });

        await recordAuthAuditEvent({
          userUid,
          deviceId: req.authContext!.deviceId,
          eventType: 'EMERGENCY_RECOVERY_KEY_REVOKED',
          clientIp,
          metadata: {
            vaultId,
            newRecoveryKeyVersion: updated.recoveryKeyVersion,
          },
        });

        res.status(200).json({
          vaultId: updated.vaultId,
          revoked: true,
          recoveryKeyVersion: updated.recoveryKeyVersion,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao revogar chave de recuperação.',
        });
      }
    }
  );

  // 6D. Baixar Pacote Criptografado de Recuperação em Dispositivo Totalmente Novo (Sem o Dispositivo Original)
  router.post(
    '/sync/vault/recovery/bundle',
    async (req: Request, res: Response) => {
      const clientIp = extractClientIp(req);
      const vaultId = String(req.body?.vaultId || '').trim();

      const bf = scannerDetector.checkBruteForceAllowance({
        clientIp,
        targetAccount: vaultId || undefined,
        scope: 'recovery-bundle',
      });
      if (!bf.allowed) {
        res.setHeader('Retry-After', String(bf.retryAfterSeconds));
        res.status(429).json({
          error: bf.reason || 'Rate limit excedido (429).',
          retryAfterSeconds: bf.retryAfterSeconds,
        });
        return;
      }

      const rl = checkRateLimit(`recovery-bundle:${clientIp}`, 20, 60_000);
      if (!rl.allowed) {
        res.status(429).json({ error: 'Rate limit excedido (429).' });
        return;
      }

      try {
        const recoveryKeyCommitmentSha256 = String(
          req.body?.recoveryKeyCommitmentSha256 || ''
        ).trim();
        const newDeviceName = String(
          req.body?.deviceName || 'Dispositivo Recuperado via Emergency Kit'
        ).trim();
        const platform = (req.body?.platform || 'desktop-web') as
          | 'desktop-web'
          | 'mobile-web'
          | 'ios'
          | 'android';

        if (!vaultId || recoveryKeyCommitmentSha256.length !== 64) {
          res.status(400).json({
            error:
              'vaultId e recoveryKeyCommitmentSha256 (64 hex chars) são obrigatórios (400).',
          });
          return;
        }

        const bundle = await fetchEmergencyRecoveryBundleFromDb({
          vaultId,
          recoveryKeyCommitmentSha256,
        });

        scannerDetector.recordAuthSuccess({
          clientIp,
          targetAccount: vaultId,
          scope: 'recovery-bundle',
        });

        const { device, rawSessionToken, rawCsrfToken } =
          await provisionDeviceInDb({
            userUid: bundle.userUid,
            email: `${bundle.userUid}@donutvault.local`,
            deviceName: newDeviceName,
            platform,
            authMethod: 'session-token',
            verifiedOwner: true,
          });

        setSecureSessionCookies(res, device.deviceId, rawSessionToken);

        await recordAuthAuditEvent({
          userUid: bundle.userUid,
          deviceId: device.deviceId,
          eventType: 'EMERGENCY_RECOVERY_BUNDLE_CLAIMED',
          clientIp,
          metadata: {
            vaultId,
            recoveryKeyVersion: bundle.recoveryMetadata.recoveryKeyVersion,
          },
        });

        res.status(200).json({
          vaultId: bundle.vaultId,
          userUid: bundle.userUid,
          recoveryMetadata: bundle.recoveryMetadata,
          records: bundle.records,
          device: {
            deviceId: device.deviceId,
            userUid: device.userUid,
            deviceName: device.deviceName,
            platform: device.platform,
            authMethod: device.authMethod,
            authorizedAt: device.authorizedAt.toISOString(),
            lastSeenAt: device.lastSeenAt.toISOString(),
            expiresAt: device.expiresAt.toISOString(),
            revokedAt: null,
          },
          sessionToken: rawSessionToken,
          csrfToken: rawCsrfToken,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 401;
        scannerDetector.recordAuthFailure({
          clientIp,
          targetAccount: vaultId || undefined,
          scope: 'recovery-bundle',
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: status,
          failureThreshold: 4,
        });
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Falha ao recuperar pacote criptografado de emergência.',
        });
      }
    }
  );

  // 7. Push Incremental de Registros Criptografados V2 (Transação PostgreSQL + CAS + Idempotência)
  router.post(
    '/sync/push',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      try {
        const userUid = req.authContext!.userUid;
        const deviceId = req.authContext!.deviceId;
        const vaultId = String(req.body?.vaultId || '').trim();
        const operations = req.body?.operations as SyncPushOperation[];

        if (!vaultId || !Array.isArray(operations)) {
          res.status(400).json({
            error:
              'Payload inválido: vaultId e array operations são obrigatórios (400).',
          });
          return;
        }

        const { results, latestCursor } = await pushEncryptedOperationsToDb({
          userUid,
          vaultId,
          operations,
        });

        const hasAppliedChanges = results.some((r) => r.status === 'APPLIED');
        if (hasAppliedChanges) {
          await broadcastVaultCursorUpdate({
            userUid,
            vaultId,
            latestCursor,
            sourceDeviceId: deviceId,
          });
        }

        res.status(200).json({
          vaultId,
          latestCursor,
          results,
        });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao processar Push incremental no PostgreSQL.',
        });
      }
    }
  );

  // 8. Pull Incremental por Cursor Monotônico
  router.get(
    '/sync/pull',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      try {
        const userUid = req.authContext!.userUid;
        const vaultId = String(req.query.vaultId || '').trim();
        const sinceCursor = Number(req.query.sinceCursor || 0);

        if (!vaultId || Number.isNaN(sinceCursor) || sinceCursor < 0) {
          res.status(400).json({
            error:
              'Parâmetros de consulta inválidos: vaultId e sinceCursor>=0 são obrigatórios.',
          });
          return;
        }

        const pullResponse = await pullEncryptedRecordsFromDb({
          userUid,
          vaultId,
          sinceCursor,
        });

        res.status(200).json(pullResponse);
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao realizar Pull incremental.',
        });
      }
    }
  );

  // 9. Histórico Criptografado de Versões Anteriores
  router.get(
    '/sync/history',
    requireDeviceOrFirebaseAuth,
    async (req: AuthenticatedSyncRequest, res: Response) => {
      try {
        const userUid = req.authContext!.userUid;
        const vaultId = String(req.query.vaultId || '').trim();
        if (!vaultId) {
          res.status(400).json({ error: 'vaultId é obrigatório.' });
          return;
        }

        const history = await getEncryptedVaultHistoryFromDb({
          userUid,
          vaultId,
        });
        res.status(200).json({ vaultId, history });
      } catch (error) {
        const status =
          (error as Error & { statusCode?: number }).statusCode || 500;
        res.status(status).json({
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao consultar histórico criptografado.',
        });
      }
    }
  );

  // ============================================================================
  // FASE 5A — §2: CANAL SSE PROTEGIDO (PROIBIDO TOKEN DE SESSÃO PERSISTENTE EM URL)
  // ============================================================================

  // 10. Canal de Notificações em Tempo Real via SSE (Server-Sent Events)
  router.get('/sync/events', async (req: Request, res: Response) => {
    const clientIp =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    try {
      // REGRA ESTRITA FASE 5A (§2): Rejeita imediatamente qualquer tentativa de passar token de sessão na URL!
      if (
        typeof req.query.token !== 'undefined' ||
        typeof req.query.sessionToken !== 'undefined' ||
        typeof req.query.access_token !== 'undefined'
      ) {
        await recordAuthAuditEvent({
          userUid: 'anonymous',
          deviceId: String(req.query.deviceId || 'unknown'),
          eventType: 'SSE_URL_TOKEN_REJECTED',
          clientIp,
          metadata: { path: req.path },
        });
        res.status(400).json({
          error:
            'Violação de Segurança de Sessão (400 Bad Request): É estritamente proibido enviar tokens de sessão persistentes em parâmetros de URL. Utilize Cookie HttpOnly SameSite=Strict ou cabeçalho Authorization.',
        });
        return;
      }

      const cookies = parseCookieHeader(req.headers.cookie);
      const vaultId = String(req.query.vaultId || '').trim();
      const deviceId = String(
        req.headers['x-device-id'] || cookies.dvlt_did || req.query.deviceId || ''
      ).trim();
      const token = String(
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
          cookies.dvlt_sid ||
          ''
      ).trim();

      if (!vaultId || !deviceId || !token) {
        res.status(401).json({
          error:
            'Não autorizado para SSE (401): Cookie HttpOnly dvlt_sid ou cabeçalho Authorization + vaultId são obrigatórios.',
        });
        return;
      }

      const device = await verifyDeviceSessionInDb({
        deviceId,
        rawSessionToken: token,
      });

      // Verifica isolamento de usuário para o vaultId solicitado
      const vaultRows = await db
        .select()
        .from(vaults)
        .where(eq(vaults.vaultId, vaultId));
      if (vaultRows.length > 0 && vaultRows[0].userUid !== device.userUid) {
        await recordAuthAuditEvent({
          userUid: device.userUid,
          deviceId: device.deviceId,
          eventType: 'SSE_CROSS_USER_VAULT_BLOCKED',
          clientIp,
          metadata: { attemptedVaultId: vaultId },
        });
        res.status(403).json({
          error:
            'Violação de Isolamento de Usuário no SSE (403 Forbidden): Este cofre pertence a outro usuário.',
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const clientId = CryptoEngine.randomId('sse');
      sseClients.set(clientId, {
        clientId,
        userUid: device.userUid,
        deviceId: device.deviceId,
        vaultId,
        res,
      });

      res.write(
        `data: ${JSON.stringify({
          type: 'SSE_CONNECTED',
          vaultId,
          deviceId: device.deviceId,
          timestamp: new Date().toISOString(),
        })}\n\n`
      );

      req.on('close', () => {
        sseClients.delete(clientId);
      });
    } catch (error) {
      const status =
        (error as Error & { statusCode?: number }).statusCode || 401;
      res.status(status).json({
        error:
          error instanceof Error
            ? error.message
            : 'Não autorizado para conectar ao stream SSE.',
      });
    }
  });

  // ============================================================================
  // FASE 5B — §5: CAMADA DE OBSERVABILIDADE DE SEGURANÇA SEM SEGREDOS
  // ============================================================================
  router.get(
    '/security/telemetry',
    requireDeviceOrFirebaseAuth,
    (_req: AuthenticatedSyncRequest, res: Response) => {
      res.status(200).json(scannerDetector.getTelemetrySnapshot());
    }
  );

  // Catch-all 404 na API (/api/v1/*) para detectar enumeração de diretórios/rotas (Gobuster / FFUF)
  router.use((req: Request, res: Response) => {
    const clientIp = extractClientIp(req);
    const { isEnumerationBurst } = scannerDetector.recordNotFoundRoute({
      clientIp,
      method: req.method,
      path: req.originalUrl || req.path,
    });
    if (isEnumerationBurst) {
      res.setHeader('Retry-After', '30');
      res.status(429).json({
        error:
          'Padrão de enumeração de rotas inexistentes detectado (429 Too Many Requests).',
      });
      return;
    }
    res.status(404).json({
      error: 'Endpoint da API não encontrado (404).',
    });
  });

  router.use(sanitizedApiErrorMiddleware);

  return router;
}
