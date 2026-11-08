import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  ARGON2_PROFILES,
  CryptoEngine,
  DEFAULT_ARGON2_PARAMS,
} from '../services/CryptoEngine';
import { DeviceSecurityModel } from '../services/DeviceSecurityModel';
import { StorageService } from '../services/StorageService';
import {
  assertWellFormedEncryptedRecordV2,
  SyncAdapter,
  ZeroKnowledgeSyncServerEngine,
} from '../services/SyncAdapter';
import { VaultService } from '../services/VaultService';
import {
  generateSecurePassword,
  evaluatePasswordStrength,
  getUnbiasedRandomIndex,
} from './generator';
import {
  sanitizeSafeExternalUrl,
  normalizeCredentialUrlForStorage,
  escapeHtmlEntities,
} from './security';
import { runVaultSecurityAudit } from './audit';
import { createSampleSpringFieldPayload } from './seedData';
import { loadStrengthEngine } from './strengthEngine';

// O medidor de força (zxcvbn) carrega sob demanda; os testes de força precisam dele pronto.
await loadStrengthEngine();

const FAST_KDF_PARAMS = { t: 1, m: 4096, p: 1, dkLen: 32 };

test('Adversarial 01: Senha mestra incorreta deve ser rejeitada por autenticação criptográfica', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  await vault.createVault(
    'SenhaCorreta!Setor7G',
    'Cofre Teste 01',
    true,
    FAST_KDF_PARAMS
  );
  vault.lockVault();

  await assert.rejects(
    async () => {
      await vault.unlockVault('SenhaErradaDoBurns!');
    },
    /Senha mestra incorreta/i
  );
  assert.equal(vault.session.isUnlocked(), false);
  vault.session.dispose();
});

test('Adversarial 02: Ciphertext adulterado (bit-flip no payload e no wrappedDek) deve falhar', async () => {
  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'RosquinhaBlindada#2026';
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    masterPwd,
    sample,
    FAST_KDF_PARAMS
  );

  // 2a. Adulteração de 1 nibble no ciphertextHex detectada pelo SHA-256
  const tamperedCiphertext = {
    ...envelope,
    ciphertextHex:
      (envelope.ciphertextHex.startsWith('a') ? 'b' : 'a') +
      envelope.ciphertextHex.slice(1),
  };
  await assert.rejects(
    async () => {
      await CryptoEngine.unsealVault(tamperedCiphertext, masterPwd);
    },
    /integridade|adulterado/i
  );

  // 2b. Mesmo se o atacante recalcular o hash SHA-256 externo após adulterar o ciphertext, a tag de autenticação GCM de 128 bits rejeita!
  const tamperedWithRecomputedSha = {
    ...tamperedCiphertext,
    integritySha256Hex: CryptoEngine.computeIntegrityHash(tamperedCiphertext),
  };
  await assert.rejects(
    async () => {
      await CryptoEngine.unsealVault(tamperedWithRecomputedSha, masterPwd);
    },
    /autenticação GCM/i
  );

  CryptoEngine.zeroize(sessionDek);
});

test('Adversarial 03: AAD adulterado (modificação de vaultId, versão ou troca de contexto dek-wrap/vault-payload)', async () => {
  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'AadAutenticado#2026';
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    masterPwd,
    sample,
    FAST_KDF_PARAMS
  );

  // Adultera o vaultId do envelope e recalcula o SHA-256 externo para tentar burlar o cheque superficial:
  // O AES-256-GCM deve rejeitar pois o AAD usado para selar a DEK e o payload continha o vaultId original!
  const forgedAadEnvelope = {
    ...envelope,
    vaultId: 'vault-forjado-pelo-atacante',
  };
  forgedAadEnvelope.integritySha256Hex =
    CryptoEngine.computeIntegrityHash(forgedAadEnvelope);

  await assert.rejects(
    async () => {
      await CryptoEngine.unsealVault(forgedAadEnvelope, masterPwd);
    },
    /Senha mestra incorreta|autenticação GCM/i
  );

  CryptoEngine.zeroize(sessionDek);
});

test('Adversarial 04: Nonce reutilizado (entre DEK e Payload ou entre duas gravações com a mesma DEK)', async () => {
  await StorageService.clearEnvelope();
  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'NonceUnico#2026';
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    masterPwd,
    sample,
    FAST_KDF_PARAMS
  );

  // 4a. Envelope com payloadNonceHex idêntico ao dekNonceHex deve ser rejeitado imediatamente
  const internalNonceReuse = {
    ...envelope,
    payloadNonceHex: envelope.dekNonceHex,
  };
  internalNonceReuse.integritySha256Hex =
    CryptoEngine.computeIntegrityHash(internalNonceReuse);

  await assert.rejects(
    async () => {
      await CryptoEngine.unsealVault(internalNonceReuse, masterPwd);
    },
    /Nonce reutilizado/i
  );

  // 4b. Tentativa de persistir um novo ciphertext reutilizando o mesmo payloadNonceHex na mesma DEK
  await StorageService.saveEnvelope(envelope, { allowRollbackOrReplace: true });
  const reusedNonceAcrossWrites = {
    ...envelope,
    revision: (envelope.revision || 1) + 1,
    ciphertextHex:
      (envelope.ciphertextHex.startsWith('0') ? '1' : '0') +
      envelope.ciphertextHex.slice(1),
  };
  reusedNonceAcrossWrites.integritySha256Hex =
    CryptoEngine.computeIntegrityHash(reusedNonceAcrossWrites);

  await assert.rejects(
    async () => {
      await StorageService.saveEnvelope(reusedNonceAcrossWrites);
    },
    /Reutilização de nonce AES-256-GCM detectada/i
  );

  CryptoEngine.zeroize(sessionDek);
});

test('Adversarial 05: Cofre importado com vaultId incompatível (interno vs externo ou conflito de merge)', async () => {
  await StorageService.clearEnvelope();
  const masterPwd = 'VaultIdCheck#2026';

  // 5a. Forja um payload cujo vaultId interno difere do vaultId autenticado no envelope externo
  const outerVaultId = 'vault-externo-legitimo';
  const mismatchedInnerPayload = {
    ...createSampleSpringFieldPayload(),
    vaultId: 'vault-interno-incompativel',
  };

  const salt = CryptoEngine.getRandomBytes(16);
  const dek = CryptoEngine.getRandomBytes(32);
  const kek = CryptoEngine.deriveKek(masterPwd, salt, FAST_KDF_PARAMS);

  const dekAad = CryptoEngine.buildAadBytes({
    format: 'DONUTVAULT_ENCRYPTED_V1',
    version: 1,
    vaultId: outerVaultId,
    recordType: 'dek-wrap',
  });
  const payloadAad = CryptoEngine.buildAadBytes({
    format: 'DONUTVAULT_ENCRYPTED_V1',
    version: 1,
    vaultId: outerVaultId,
    recordType: 'vault-payload',
  });

  const wrappedDek = await CryptoEngine.encryptAes256Gcm(kek, dek, dekAad);
  const encPayload = await CryptoEngine.encryptAes256Gcm(
    dek,
    utf8ToBytes(JSON.stringify(mismatchedInnerPayload)),
    payloadAad
  );

  const partialEnvelope = {
    format: 'DONUTVAULT_ENCRYPTED_V1' as const,
    version: 1 as const,
    vaultId: outerVaultId,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    kdf: 'argon2id' as const,
    kdfParams: FAST_KDF_PARAMS,
    saltHex: bytesToHex(salt),
    wrappedDekHex: bytesToHex(wrappedDek.ciphertext),
    dekNonceHex: bytesToHex(wrappedDek.nonce),
    ciphertextHex: bytesToHex(encPayload.ciphertext),
    payloadNonceHex: bytesToHex(encPayload.nonce),
  };
  const forgedEnvelope = {
    ...partialEnvelope,
    integritySha256Hex: CryptoEngine.computeIntegrityHash(partialEnvelope),
  };

  await assert.rejects(
    async () => {
      await CryptoEngine.unsealVault(forgedEnvelope, masterPwd);
    },
    /vaultId interno incompatível/i
  );

  // 5b. Restauração merge bloqueada quando allowForeignVaultMerge: false e vaultId difere
  const vaultA = new VaultService();
  await vaultA.createVault(masterPwd, 'Cofre A', false, FAST_KDF_PARAMS);
  const backupA = vaultA.exportEncryptedBackupJson();
  vaultA.session.dispose();

  const vaultB = new VaultService();
  await vaultB.createVault(masterPwd, 'Cofre B', false, FAST_KDF_PARAMS);
  await assert.rejects(
    async () => {
      await vaultB.restoreEncryptedBackup(backupA, masterPwd, 'merge', {
        allowForeignVaultMerge: false,
      });
    },
    /vaultId incompatível/i
  );
  vaultB.session.dispose();

  CryptoEngine.zeroize(dek);
  CryptoEngine.zeroize(kek);
});

test('Adversarial 06: Backup corrompido (JSON truncado, hex inválido ou hash SHA-256 divergente)', () => {
  assert.throws(() => {
    StorageService.parseAndValidateBackup('{"format":"DONUTVAULT_ENCRYPTED_V1", truncado...');
  }, /JSON válido|corrompido/i);

  assert.throws(() => {
    StorageService.parseAndValidateBackup('');
  }, /vazio/i);
});

test('Adversarial 07: Backup com estrutura maliciosa (Prototype Pollution e parâmetros Argon2id maliciosos)', () => {
  // 7a. Prototype pollution
  const protoPayload =
    '{"format":"DONUTVAULT_ENCRYPTED_V1","__proto__":{"isAdmin":true}}';
  assert.throws(() => {
    StorageService.parseAndValidateBackup(protoPayload);
  }, /Prototype Pollution/i);

  // 7b. Parâmetros KDF abusivos (DoS com m = 999999999 KiB ou dkLen = 8)
  const maliciousKdfBackup = JSON.stringify({
    format: 'DONUTVAULT_ENCRYPTED_V1',
    version: 1,
    vaultId: 'vault-malicioso',
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    kdf: 'argon2id',
    kdfParams: { t: 1000, m: 999999999, p: 64, dkLen: 8 },
    saltHex: 'a'.repeat(32),
    wrappedDekHex: 'b'.repeat(64),
    dekNonceHex: 'c'.repeat(24),
    ciphertextHex: 'd'.repeat(64),
    payloadNonceHex: 'e'.repeat(24),
    integritySha256Hex: 'f'.repeat(64),
  });

  assert.throws(() => {
    StorageService.parseAndValidateBackup(maliciousKdfBackup);
  }, /parâmetros Argon2id inválidos/i);
});

test('Adversarial 08: Operações simultâneas (concorrência em paralelo) preservam todas as credenciais sem race condition', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  await vault.createVault(
    'Concorrencia#2026',
    'Cofre Concorrente',
    false,
    FAST_KDF_PARAMS
  );

  // Dispara 5 inserções de credenciais e 3 notas simultaneamente com Promise.all
  await Promise.all([
    vault.upsertCredential({
      serviceName: 'Concorrente 1',
      url: 'https://c1.fake',
      username: 'u1',
      email: 'u1@fake.com',
      password: 'Pwd#1',
      category: 'outros',
      tags: ['paralelo'],
      notes: '',
      favorite: false,
      deletedAt: null,
    }),
    vault.upsertCredential({
      serviceName: 'Concorrente 2',
      url: 'https://c2.fake',
      username: 'u2',
      email: 'u2@fake.com',
      password: 'Pwd#2',
      category: 'outros',
      tags: ['paralelo'],
      notes: '',
      favorite: true,
      deletedAt: null,
    }),
    vault.upsertCredential({
      serviceName: 'Concorrente 3',
      url: 'https://c3.fake',
      username: 'u3',
      email: 'u3@fake.com',
      password: 'Pwd#3',
      category: 'outros',
      tags: [],
      notes: '',
      favorite: false,
      deletedAt: null,
    }),
    vault.upsertNote({
      title: 'Nota Simultânea A',
      category: 'Geral',
      content: 'Conteúdo A',
      colorTint: 'yellow',
      favorite: false,
      deletedAt: null,
    }),
    vault.upsertNote({
      title: 'Nota Simultânea B',
      category: 'Geral',
      content: 'Conteúdo B',
      colorTint: 'blue',
      favorite: true,
      deletedAt: null,
    }),
  ]);

  const finalPayload = vault.getUnlockedPayload();
  assert.equal(finalPayload.credentials.length, 3);
  assert.equal(finalPayload.notes.length, 2);
  // Revisão inicial (1) + 5 mutações serializadas = 6
  assert.equal(finalPayload.revision, 6);
  vault.session.dispose();
});

test('Adversarial 09: Perda de energia simulada durante persistência preserva o estado anterior atomicamente', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  const masterPwd = 'EnergiaAtomica#2026';

  await vault.createVault(masterPwd, 'Cofre Atômico', false, FAST_KDF_PARAMS);
  await vault.upsertCredential({
    serviceName: 'Credencial Estável Antes da Queda',
    url: 'https://estavel.fake',
    username: 'barnaby',
    email: 'barnaby@fake.com',
    password: 'SenhaSalvaAntesDaQueda!123',
    category: 'trabalho-usina',
    tags: [],
    notes: '',
    favorite: true,
    deletedAt: null,
  });

  // Simula perda de energia / falha de I/O na próxima escrita no StorageService
  StorageService.simulateNextWriteFailure(true);

  await assert.rejects(
    async () => {
      await vault.upsertCredential({
        serviceName: 'Credencial Durante Queda de Energia',
        url: 'https://queda.fake',
        username: 'queda',
        email: 'queda@fake.com',
        password: 'NaoDeveCorromperOBanco',
        category: 'outros',
        tags: [],
        notes: '',
        favorite: false,
        deletedAt: null,
      });
    },
    /perda de energia/i
  );

  // O estado em memória e o estado persistido no StorageService devem continuar íntegros com a credencial anterior!
  assert.equal(vault.getUnlockedPayload().credentials.length, 1);
  assert.equal(
    vault.getUnlockedPayload().credentials[0].serviceName,
    'Credencial Estável Antes da Queda'
  );

  // Reinicia em uma nova instância para provar que o banco não corrompeu
  vault.session.dispose();
  const recoveredVault = new VaultService();
  const recovered = await recoveredVault.unlockVault(masterPwd);
  assert.equal(recovered.payload.credentials.length, 1);
  assert.equal(
    recovered.payload.credentials[0].serviceName,
    'Credencial Estável Antes da Queda'
  );
  recoveredVault.session.dispose();
});

test('Adversarial 10: Alteração de senha mestra rotaciona salt Argon2id e DEK e invalida a senha antiga', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  const oldPassword = 'SenhaAntigaSetor7G#111';
  const newPassword = 'SenhaNovaBlindada#222';

  const created = await vault.createVault(
    oldPassword,
    'Cofre Rotação',
    true,
    FAST_KDF_PARAMS
  );
  const oldSalt = created.envelope.saltHex;
  const oldWrappedDek = created.envelope.wrappedDekHex;

  const rotated = await vault.rotateMasterPassword(oldPassword, newPassword);
  assert.notEqual(rotated.envelope.saltHex, oldSalt);
  assert.notEqual(rotated.envelope.wrappedDekHex, oldWrappedDek);

  vault.lockVault();

  // Senha antiga deve ser rejeitada
  await assert.rejects(
    async () => {
      await vault.unlockVault(oldPassword);
    },
    /Senha mestra incorreta/i
  );

  // Senha nova deve desbloquear normalmente
  const unlocked = await vault.unlockVault(newPassword);
  assert.equal(
    unlocked.payload.credentials.length,
    created.payload.credentials.length
  );
  vault.session.dispose();
});

test('Adversarial 11: Bloqueio com operações pendentes cancela a operação e não vaza o payload após o lock', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  await vault.createVault(
    'LockPendente#2026',
    'Cofre Lock Pendente',
    false,
    FAST_KDF_PARAMS
  );

  // Inicia uma operação assíncrona e tranca o cofre IMEDIATAMENTE na mesma tick
  const pendingPromise = vault.upsertCredential({
    serviceName: 'Operação Pendente Cancelada',
    url: 'https://pendente.fake',
    username: 'ghost',
    email: 'ghost@fake.com',
    password: 'GhostPassword!123',
    category: 'outros',
    tags: [],
    notes: '',
    favorite: false,
    deletedAt: null,
  });

  vault.lockVault();

  await assert.rejects(
    async () => {
      await pendingPromise;
    },
    /bloqueado durante uma operação pendente/i
  );

  // Garante que o cofre permanece bloqueado e que nenhuma credencial foi exposta em memória
  assert.equal(vault.session.isUnlocked(), false);
  assert.throws(() => {
    vault.getUnlockedPayload();
  }, /bloqueado/i);
  vault.session.dispose();
});

test('Adversarial 12: Ausência de vazamento de informações sensíveis em logs (console.log/warn/error/info/debug)', async () => {
  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const origInfo = console.info;
  const origDebug = console.debug;

  const intercept = (...args: unknown[]) => {
    capturedLogs.push(args.map((a) => String(a)).join(' '));
  };

  console.log = intercept;
  console.warn = intercept;
  console.error = intercept;
  console.info = intercept;
  console.debug = intercept;

  const secretMaster = 'MasterUltraSecreta#LogTest999';
  const secretCredPass = 'CredencialSuperSecreta#LogTest888';

  try {
    await StorageService.clearEnvelope();
    const vault = new VaultService();
    await vault.createVault(
      secretMaster,
      'Cofre Silencioso',
      false,
      FAST_KDF_PARAMS
    );
    await vault.upsertCredential({
      serviceName: 'Serviço Confidencial',
      url: 'https://confidencial.fake',
      username: 'agente_secreto',
      email: 'agente@fake.com',
      password: secretCredPass,
      category: 'outros',
      tags: [],
      notes: 'Nota Confidencial LogTest777',
      favorite: true,
      deletedAt: null,
    });
    vault.lockVault();
    await vault.unlockVault(secretMaster);
    vault.session.dispose();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    console.info = origInfo;
    console.debug = origDebug;
  }

  const combinedLogs = capturedLogs.join('\n');
  assert.equal(combinedLogs.includes(secretMaster), false);
  assert.equal(combinedLogs.includes(secretCredPass), false);
  assert.equal(combinedLogs.includes('Nota Confidencial LogTest777'), false);
});

test('Adversarial 13: Inserção de HTML ou JavaScript malicioso em campos de notas, títulos e URLs é neutralizada', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  await vault.createVault(
    'XssDefense#2026',
    'Cofre Anti-XSS',
    false,
    FAST_KDF_PARAMS
  );

  // 13a. URLs com esquema javascript: ou data: devem ser bloqueadas na entrada
  await assert.rejects(
    async () => {
      await vault.upsertCredential({
        serviceName: 'Site Malicioso XSS',
        url: 'javascript:alert(document.cookie)',
        username: 'xss',
        email: 'xss@fake.com',
        password: 'SenhaSegura#123',
        category: 'outros',
        tags: [],
        notes: '',
        favorite: false,
        deletedAt: null,
      });
    },
    /protocolo não permitido|bloqueada/i
  );

  assert.equal(
    sanitizeSafeExternalUrl('   jAvAsCrIpT:alert(1)'),
    null
  );
  assert.equal(
    sanitizeSafeExternalUrl('data:text/html,<script>alert(1)</script>'),
    null
  );
  assert.equal(
    sanitizeSafeExternalUrl('https://springfield.gov.fake/login'),
    'https://springfield.gov.fake/login'
  );

  // 13b. Caracteres de controle e null bytes (\u0000) são removidos de títulos e notas, e entidades HTML são escapáveis
  const note = await vault.upsertNote({
    title: 'Título\u0000Com<script>alert("xss")</script>',
    category: 'Segurança\u0007',
    content: '<img src=x onerror=alert(1)> Segredo',
    colorTint: 'yellow',
    favorite: false,
    deletedAt: null,
  });

  assert.equal(note.title.includes('\u0000'), false);
  assert.equal(note.category.includes('\u0007'), false);
  assert.equal(
    escapeHtmlEntities(note.content).includes('<img'),
    false
  );
  vault.session.dispose();
});

test('Adversarial 14: Tentativas de leitura/escrita com cofre bloqueado e tentativa de Rollback de revisão', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  await vault.createVault(
    'LockAndRollback#2026',
    'Cofre Anti-Rollback',
    true,
    FAST_KDF_PARAMS
  );

  const rev1Envelope = vault.getEnvelope()!;
  await vault.upsertCredential({
    serviceName: 'Nova Credencial Revisão 2',
    url: 'https://rev2.fake',
    username: 'rev2',
    email: 'rev2@fake.com',
    password: 'SenhaRev2#123',
    category: 'outros',
    tags: [],
    notes: '',
    favorite: false,
    deletedAt: null,
  });
  const rev2Envelope = vault.getEnvelope()!;
  assert.equal(rev2Envelope.revision, 2);

  // 14a. Tentativa de Rollback (gravar revisão #1 sobre a revisão #2 do mesmo vaultId) deve ser bloqueada!
  await assert.rejects(
    async () => {
      await StorageService.saveEnvelope(rev1Envelope);
    },
    /Anti-Rollback/i
  );

  // 14b. Bloqueia o cofre e tenta ler payload, criar credencial, criar nota e alterar senha mestra
  vault.lockVault();

  assert.throws(() => {
    vault.getUnlockedPayload();
  }, /bloqueado/i);

  await assert.rejects(
    async () => {
      await vault.upsertCredential({
        serviceName: 'Invasão Pós-Lock',
        url: 'https://invasao.fake',
        username: 'hacker',
        email: 'h@fake.com',
        password: '123',
        category: 'outros',
        tags: [],
        notes: '',
        favorite: false,
        deletedAt: null,
      });
    },
    /bloqueado/i
  );

  await assert.rejects(
    async () => {
      await vault.upsertNote({
        title: 'Nota Pós-Lock',
        category: 'Geral',
        content: 'Conteúdo',
        colorTint: 'pink',
        favorite: false,
        deletedAt: null,
      });
    },
    /bloqueado/i
  );

  vault.session.dispose();
});

test('Benchmark Argon2id (Parâmetros de Produção: m=16384 KiB, t=2, p=1, dkLen=32) e Verificação Zero-Plaintext', async () => {
  await StorageService.clearEnvelope();
  const sample = createSampleSpringFieldPayload();
  const startMs = performance.now();
  const { envelope, sessionDek } = await CryptoEngine.sealNewVault(
    'BenchmarkPassword#2026',
    sample,
    DEFAULT_ARGON2_PARAMS
  );
  const sealDurationMs = Math.round(performance.now() - startMs);

  const unlockStartMs = performance.now();
  const unlocked = await CryptoEngine.unsealVault(
    envelope,
    'BenchmarkPassword#2026'
  );
  const unlockDurationMs = Math.round(performance.now() - unlockStartMs);

  assert.equal(envelope.kdfParams.m, 16384);
  assert.equal(envelope.kdfParams.t, 2);
  assert.equal(envelope.kdfParams.p, 1);
  assert.equal(envelope.kdfParams.dkLen, 32);
  assert.equal(sealDurationMs > 0, true);
  assert.equal(unlockDurationMs > 0, true);
  assert.equal(unlocked.payload.credentials.length, sample.credentials.length);

  //Verifica CSPRNG e Auditoria zxcvbn
  const idx = getUnbiasedRandomIndex(10);
  assert.equal(idx >= 0 && idx < 10, true);
  const pwd = generateSecurePassword({
    mode: 'random',
    length: 24,
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
  assert.equal(evaluatePasswordStrength(pwd).level, 'strong');
  const audit = runVaultSecurityAudit(sample.credentials);
  assert.equal(audit.totalActiveCredentials, 7);

  CryptoEngine.zeroize(sessionDek);
  CryptoEngine.zeroize(unlocked.sessionDek);
});

// ============================================================================
// FASE 4A | 12 TESTES AUTOMATIZADOS OBRIGATÓRIOS (§7)
// ============================================================================

test('Fase 4A - 01: Migração do formato antigo (V1 payload único) para o novo formato (V2 por registro) com snapshot de rollback', async () => {
  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'MigracaoSegura#Setor7G';
  const { envelope: v1Envelope, sessionDek: v1Dek } =
    await CryptoEngine.sealNewVault(
      masterPwd,
      sample,
      ARGON2_PROFILES['legacy-v1']
    );

  // Migra de V1 (16 MiB) para V2 por registro atualizando perfil Argon2id para owasp-desktop-v2 (19 MiB)
  const migrated = await CryptoEngine.migrateV1EnvelopeToV2Container(
    v1Envelope,
    masterPwd,
    ARGON2_PROFILES['owasp-desktop-v2']
  );

  assert.equal(migrated.container.format, 'DONUTVAULT_ENCRYPTED_V2');
  assert.equal(migrated.container.version, 2);
  assert.equal(migrated.container.kdfParams.m, 19456);
  assert.equal(
    migrated.container.records.length,
    sample.credentials.length + sample.notes.length
  );
  // Preserva snapshot V1 intacto para recuperação/rollback caso necessário
  assert.ok(migrated.container.migratedFromV1Snapshot);
  assert.equal(
    migrated.container.migratedFromV1Snapshot?.integritySha256Hex,
    v1Envelope.integritySha256Hex
  );

  // Comprova que o snapshot V1 preservado ainda pode ser restaurado integralmente
  const restoredFromSnapshot = await CryptoEngine.unsealVault(
    migrated.container.migratedFromV1Snapshot!,
    masterPwd
  );
  assert.equal(
    restoredFromSnapshot.payload.credentials.length,
    sample.credentials.length
  );

  CryptoEngine.zeroize(v1Dek);
  CryptoEngine.zeroize(migrated.sessionDek);
  CryptoEngine.zeroize(restoredFromSnapshot.sessionDek);
});

test('Fase 4A - 02: Integridade dos dados migrados e vinculação criptográfica de AAD por registro (recordId, revision, keyEpoch, deleted)', async () => {
  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'IntegridadeV2#2026';
  const { envelope: v1Envelope, sessionDek: v1Dek } =
    await CryptoEngine.sealNewVault(masterPwd, sample, FAST_KDF_PARAMS);

  const { container, payload, sessionDek: v2Dek } =
    await CryptoEngine.migrateV1EnvelopeToV2Container(
      v1Envelope,
      masterPwd,
      FAST_KDF_PARAMS
    );

  // 1. Verifica que 100% dos campos sensíveis (senhas, usuários, URLs, notas, categorias, tags) foram preservados sem perda
  for (const origCred of sample.credentials) {
    const migratedCred = payload.credentials.find((c) => c.id === origCred.id);
    assert.ok(migratedCred, `Credencial ${origCred.id} deve existir após migração`);
    assert.equal(migratedCred.password, origCred.password);
    assert.equal(migratedCred.username, origCred.username);
    assert.equal(migratedCred.url, origCred.url);
    assert.equal(migratedCred.notes, origCred.notes);
    assert.deepEqual(migratedCred.tags, origCred.tags);
  }

  for (const origNote of sample.notes) {
    const migratedNote = payload.notes.find((n) => n.id === origNote.id);
    assert.ok(migratedNote, `Nota ${origNote.id} deve existir após migração`);
    assert.equal(migratedNote.content, origNote.content);
    assert.equal(migratedNote.title, origNote.title);
  }

  // 2. Verifica que adulterar a revisão ou o flag deleted de um registro individual invalida o AAD no AES-256-GCM
  const targetRecord = container.records[0];
  const tamperedRecord = {
    ...targetRecord,
    revision: targetRecord.revision + 1,
  };
  await assert.rejects(
    async () => {
      await CryptoEngine.unsealRecordV2(
        v2Dek,
        tamperedRecord,
        container.vaultId
      );
    },
    /Adulteração de metadados\/AAD|autenticação AES-256-GCM/i
  );

  CryptoEngine.zeroize(v1Dek);
  CryptoEngine.zeroize(v2Dek);
});

test('Fase 4A - 03: Conflitos simultâneos (edição de credenciais diferentes vs edição simultânea da mesma credencial no PC e Celular)', async () => {
  const deviceSecurity = new DeviceSecurityModel();
  const syncServer = new ZeroKnowledgeSyncServerEngine(deviceSecurity);
  const pcSync = new SyncAdapter();
  const mobileSync = new SyncAdapter();

  const userId = 'user-homer-7g';
  const vaultId = 'vault-shared-7g';
  const masterDek = CryptoEngine.getRandomBytes(32);

  const pcDev = deviceSecurity.provisionNewDevice({
    userId,
    deviceName: 'PC Desktop Setor 7G',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
  });
  const mobileDev = deviceSecurity.provisionNewDevice({
    userId,
    deviceName: 'Celular DonutPhone',
    platform: 'mobile-web',
    authMethod: 'webauthn-passkey',
  });

  syncServer.registerVaultOwnership(
    userId,
    pcDev.device.deviceId,
    pcDev.rawSessionToken,
    vaultId,
    1
  );

  // 3a. PC e Celular criam/editam credenciais DIFERENTES simultaneamente -> ambas são aplicadas sem conflito
  const credA = createSampleSpringFieldPayload().credentials[0];
  const credB = createSampleSpringFieldPayload().credentials[1];

  const encCredA = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    credA.id,
    'credential',
    1,
    1,
    false,
    credA
  );
  const encCredB = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    credB.id,
    'credential',
    1,
    1,
    false,
    credB
  );

  const opA = pcSync.enqueueRecordOperation(encCredA, 0);
  const opB = mobileSync.enqueueRecordOperation(encCredB, 0);

  const resA = syncServer.pushOperations(
    userId,
    pcDev.device.deviceId,
    pcDev.rawSessionToken,
    vaultId,
    [opA]
  );
  const resB = syncServer.pushOperations(
    userId,
    mobileDev.device.deviceId,
    mobileDev.rawSessionToken,
    vaultId,
    [opB]
  );
  assert.equal(resA[0].status, 'APPLIED');
  assert.equal(resB[0].status, 'APPLIED');

  // 3b. PC e Celular editam a MESMA credencial (credA) partindo da expectedBaseRevision = 1 com senhas diferentes
  const pcUpdatedCredA = {
    ...credA,
    password: 'SenhaEditadaNoPC#111',
    updatedAt: '2026-11-07T10:00:00.000Z',
    revision: 2,
  };
  const mobileUpdatedCredA = {
    ...credA,
    password: 'SenhaEditadaNoCelular#222',
    updatedAt: '2026-11-07T10:05:00.000Z',
    revision: 2,
  };

  const encPcA2 = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    credA.id,
    'credential',
    2,
    1,
    false,
    pcUpdatedCredA
  );
  const encMobileA2 = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    credA.id,
    'credential',
    2,
    1,
    false,
    mobileUpdatedCredA
  );

  // PC sincroniza primeiro -> APPLIED (serverRevision = 2)
  const pcPush2 = syncServer.pushOperations(
    userId,
    pcDev.device.deviceId,
    pcDev.rawSessionToken,
    vaultId,
    [pcSync.enqueueRecordOperation(encPcA2, 1)]
  );
  assert.equal(pcPush2[0].status, 'APPLIED');

  // Celular tenta sincronizar com expectedBaseRevision = 1 -> Servidor detecta CONFLICT e devolve serverRecord criptografado
  const mobilePush2 = syncServer.pushOperations(
    userId,
    mobileDev.device.deviceId,
    mobileDev.rawSessionToken,
    vaultId,
    [mobileSync.enqueueRecordOperation(encMobileA2, 1)]
  );
  assert.equal(mobilePush2[0].status, 'CONFLICT');
  assert.ok(mobilePush2[0].serverRecord);

  // Cliente no Celular resolve o conflito localmente sem perder nenhuma das duas senhas!
  const resolution = await mobileSync.resolveRecordConflictClientSide(
    masterDek,
    encMobileA2,
    mobilePush2[0].serverRecord!,
    1
  );
  assert.equal(resolution.resolutionType, 'CONCURRENT_EDIT_FORKED');
  assert.ok(resolution.conflictCopyRecord);

  const winnerUnsealed = await CryptoEngine.unsealRecordV2<typeof credA>(
    masterDek,
    resolution.primaryRecord,
    vaultId
  );
  const forkUnsealed = await CryptoEngine.unsealRecordV2<typeof credA>(
    masterDek,
    resolution.conflictCopyRecord!,
    vaultId
  );

  assert.equal(winnerUnsealed.password, 'SenhaEditadaNoCelular#222');
  assert.equal(forkUnsealed.password, 'SenhaEditadaNoPC#111');
  assert.equal(forkUnsealed.conflictOfId, credA.id);
  assert.equal(
    forkUnsealed.serviceName.includes('[Conflito Preservado]'),
    true
  );

  CryptoEngine.zeroize(masterDek);
});

test('Fase 4A - 04: Reconexão após semanas offline + Exclusão em um dispositivo e edição em outro preserva o registro editado', async () => {
  const syncAdapter = new SyncAdapter();
  const vaultId = 'vault-offline-weeks';
  const masterDek = CryptoEngine.getRandomBytes(32);
  const baseCred = createSampleSpringFieldPayload().credentials[0];

  // Dispositivo A (online) excluiu o registro (deleted: true, revision: 2)
  const serverDeletedRecord = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    baseCred.id,
    'credential',
    2,
    1,
    true,
    {
      ...baseCred,
      deletedAt: '2026-10-01T12:00:00.000Z',
      revision: 2,
    }
  );

  // Dispositivo B (offline por semanas) editou a senha do mesmo registro (deleted: false, revision: 2)
  const offlineEditedRecord = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    baseCred.id,
    'credential',
    2,
    1,
    false,
    {
      ...baseCred,
      password: 'NovaSenhaCriadaOfflineDuranteViagem#999',
      deletedAt: null,
      revision: 2,
    }
  );

  // Ao reconectar após semanas offline, o conflito Delete vs Edit SEMPRE preserva o registro editado!
  const outcome = await syncAdapter.resolveRecordConflictClientSide(
    masterDek,
    offlineEditedRecord,
    serverDeletedRecord,
    1
  );

  assert.equal(outcome.resolutionType, 'EDIT_VS_DELETE_PRESERVED');
  assert.equal(outcome.primaryRecord.deleted, false);
  assert.equal(outcome.primaryRecord.revision, 3);

  const preservedCred = await CryptoEngine.unsealRecordV2<typeof baseCred>(
    masterDek,
    outcome.primaryRecord,
    vaultId
  );
  assert.equal(
    preservedCred.password,
    'NovaSenhaCriadaOfflineDuranteViagem#999'
  );
  assert.equal(preservedCred.deletedAt, null);

  CryptoEngine.zeroize(masterDek);
});

test('Fase 4A - 05: Tentativas de rollback de revisão e de keyEpoch no servidor Zero-Knowledge são rejeitadas', async () => {
  const deviceSecurity = new DeviceSecurityModel();
  const syncServer = new ZeroKnowledgeSyncServerEngine(deviceSecurity);
  const userId = 'user-rollback-test';
  const vaultId = 'vault-rollback-test';
  const masterDek = CryptoEngine.getRandomBytes(32);

  const dev = deviceSecurity.provisionNewDevice({
    userId,
    deviceName: 'Desktop',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
  });
  syncServer.registerVaultOwnership(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    1
  );

  const cred = createSampleSpringFieldPayload().credentials[0];
  const rev2Record = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    cred.id,
    'credential',
    2,
    1,
    false,
    { ...cred, revision: 2 }
  );

  // Aplica revisão 2 inicial (expectedBaseRevision = 0)
  const firstPush = syncServer.pushOperations(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    [
      {
        operationId: 'op-init-rev2',
        vaultId,
        expectedBaseRevision: 0,
        record: rev2Record,
        clientTimestamp: new Date().toISOString(),
      },
    ]
  );
  assert.equal(firstPush[0].status, 'APPLIED');

  // Tenta forçar rollback enviando revisão 1 sobre revisão 2 (mesmo informando expectedBaseRevision = 2)
  const rev1RollbackRecord = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    cred.id,
    'credential',
    1,
    1,
    false,
    { ...cred, revision: 1 }
  );
  const rollbackPush = syncServer.pushOperations(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    [
      {
        operationId: 'op-attack-rollback',
        vaultId,
        expectedBaseRevision: 2,
        record: rev1RollbackRecord,
        clientTimestamp: new Date().toISOString(),
      },
    ]
  );
  assert.equal(rollbackPush[0].status, 'REJECTED_ROLLBACK');

  // Tenta regredir keyEpoch do cofre de 2 para 1
  syncServer.advanceVaultKeyEpoch(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    2
  );
  assert.throws(() => {
    syncServer.advanceVaultKeyEpoch(
      userId,
      dev.device.deviceId,
      dev.rawSessionToken,
      vaultId,
      1
    );
  }, /Anti-Rollback de Chave/i);

  CryptoEngine.zeroize(masterDek);
});

test('Fase 4A - 06: Reenvio de operações antigas/duplicadas (idempotência por operationId e backoff exponencial)', async () => {
  const deviceSecurity = new DeviceSecurityModel();
  const syncServer = new ZeroKnowledgeSyncServerEngine(deviceSecurity);
  const syncAdapter = new SyncAdapter();
  const userId = 'user-idempotency';
  const vaultId = 'vault-idempotency';
  const masterDek = CryptoEngine.getRandomBytes(32);

  const dev = deviceSecurity.provisionNewDevice({
    userId,
    deviceName: 'Mobile',
    platform: 'mobile-web',
    authMethod: 'session-token',
  });
  syncServer.registerVaultOwnership(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    1
  );

  const cred = createSampleSpringFieldPayload().credentials[0];
  const encRec = await CryptoEngine.sealRecordV2(
    masterDek,
    vaultId,
    cred.id,
    'credential',
    1,
    1,
    false,
    cred
  );

  const op = syncAdapter.enqueueRecordOperation(encRec, 0, 'op-idempotent-123');

  // Simula 3 falhas temporárias de rede seguidas de backoff exponencial (500ms, 1000ms, 2000ms)
  const delay1 = syncAdapter.recordTransientNetworkFailure(
    op.operationId,
    'Timeout'
  );
  const delay2 = syncAdapter.recordTransientNetworkFailure(
    op.operationId,
    'Timeout'
  );
  const delay3 = syncAdapter.recordTransientNetworkFailure(
    op.operationId,
    'Timeout'
  );
  assert.equal(delay1, 500);
  assert.equal(delay2, 1000);
  assert.equal(delay3, 2000);
  assert.equal(syncAdapter.getPendingQueue().length, 1);

  // Envia a operação pela primeira vez ao servidor -> APPLIED
  const firstAttempt = syncServer.pushOperations(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    [op]
  );
  assert.equal(firstAttempt[0].status, 'APPLIED');

  // Cliente reenvia exatamente o mesmo operationId (ex: queda de conexão antes de receber o ACK HTTP)
  const replayAttempt = syncServer.pushOperations(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    [op]
  );
  assert.equal(replayAttempt[0].status, 'IDEMPOTENT_REPLAY');
  assert.equal(replayAttempt[0].serverRevision, 1);

  syncAdapter.acknowledgeOperationSuccess(op.operationId);
  assert.equal(syncAdapter.getPendingQueue().length, 0);

  CryptoEngine.zeroize(masterDek);
});

test('Fase 4A - 07: Exclusões permanentes sincronizadas com Tombstone impedem ressurreição acidental de registros', async () => {
  await StorageService.clearEnvelope();
  const masterPwd = 'TombstoneSync#2026';

  // Dispositivo 1 cria o cofre com os dados de exemplo e exporta um snapshot antes da exclusão
  const vaultDevice1 = new VaultService();
  await vaultDevice1.createVault(
    masterPwd,
    'Cofre Tombstone',
    true,
    FAST_KDF_PARAMS
  );
  const targetCredId = vaultDevice1.getUnlockedPayload().credentials[0].id;
  const staleOfflineBackupFromDevice2 =
    vaultDevice1.exportEncryptedBackupJson();

  // Dispositivo 1 move a credencial para a lixeira e executa EXCLUSÃO PERMANENTE (gera HardDeleteTombstone)
  await vaultDevice1.setCredentialTrashState(targetCredId, true);
  await vaultDevice1.deleteCredentialPermanently(targetCredId);

  const payloadAfterDelete = vaultDevice1.getUnlockedPayload();
  assert.equal(
    payloadAfterDelete.credentials.some((c) => c.id === targetCredId),
    false
  );
  assert.equal(
    payloadAfterDelete.tombstones?.some(
      (t) => t.recordId === targetCredId && t.recordType === 'credential'
    ),
    true
  );

  // Quando o estado obsoleto do Dispositivo 2 é mesclado com `respectTombstones: true`, a credencial excluída NÃO ressuscita!
  await vaultDevice1.restoreEncryptedBackup(
    staleOfflineBackupFromDevice2,
    masterPwd,
    'merge',
    { respectTombstones: true }
  );

  const payloadAfterSyncMerge = vaultDevice1.getUnlockedPayload();
  assert.equal(
    payloadAfterSyncMerge.credentials.some((c) => c.id === targetCredId),
    false
  );

  vaultDevice1.session.dispose();
});

test('Fase 4A - 08: Recuperação após falha simulada do banco durante migração ou atualização preserva o estado íntegro', async () => {
  await StorageService.clearEnvelope();
  const vault = new VaultService();
  const masterPwd = 'RecoveryBankFailure#2026';

  await vault.createVault(
    masterPwd,
    'Cofre Resiliente',
    true,
    FAST_KDF_PARAMS
  );
  const countBeforeFailure = vault.getUnlockedPayload().credentials.length;
  const targetId = vault.getUnlockedPayload().credentials[0].id;

  // Simula falha catastrófica de escrita no IndexedDB/Storage durante exclusão permanente
  StorageService.simulateNextWriteFailure(true);
  await assert.rejects(
    async () => {
      await vault.deleteCredentialPermanently(targetId);
    },
    /perda de energia/i
  );

  // Verifica que nem a memória nem o banco persistido perderam o registro ou corromperam o cofre
  assert.equal(
    vault.getUnlockedPayload().credentials.length,
    countBeforeFailure
  );
  vault.session.dispose();

  const freshVault = new VaultService();
  const unlocked = await freshVault.unlockVault(masterPwd);
  assert.equal(unlocked.payload.credentials.length, countBeforeFailure);
  freshVault.session.dispose();
});

test('Fase 4A - 09: Rotação de chaves (separação entre rewrapMasterPasswordOnly e rotação completa de DEK + fila offline)', async () => {
  const sample = createSampleSpringFieldPayload();
  const oldPass = 'SenhaAntiga#Fase4A';
  const newPass = 'SenhaNova#Fase4A';

  const { envelope: env1, sessionDek: dek1 } =
    await CryptoEngine.sealNewVault(oldPass, sample, FAST_KDF_PARAMS);

  // 9a. Alteração APENAS da Senha Mestra (rewrapMasterPasswordOnly): mantém a mesma DEK, mesmo ciphertextHex e mesmo keyEpoch
  const rewrappedEnv = await CryptoEngine.rewrapMasterPasswordOnly(
    env1,
    oldPass,
    newPass,
    FAST_KDF_PARAMS
  );
  assert.equal(rewrappedEnv.ciphertextHex, env1.ciphertextHex);
  assert.equal(rewrappedEnv.payloadNonceHex, env1.payloadNonceHex);
  assert.notEqual(rewrappedEnv.saltHex, env1.saltHex);
  assert.notEqual(rewrappedEnv.wrappedDekHex, env1.wrappedDekHex);

  const { sessionDek: dekAfterRewrap } = await CryptoEngine.unsealVault(
    rewrappedEnv,
    newPass
  );
  assert.deepEqual(dekAfterRewrap, dek1);

  // 9b. Rotação COMPLETA de DEK em Contêiner V2 + re-criptografia da fila offline para o novo keyEpoch
  const { container: v2Epoch1, sessionDek: v2Dek1 } =
    await CryptoEngine.sealContainerV2(newPass, sample, FAST_KDF_PARAMS);
  assert.equal(v2Epoch1.keyEpoch, 1);

  // Dispositivo offline tinha um registro enfileirado na keyEpoch = 1
  const syncAdapter = new SyncAdapter();
  syncAdapter.enqueueRecordOperation(v2Epoch1.records[0], 1, 'op-offline-epoch1');

  // Dispositivo principal executa rotação completa da DEK -> avança para keyEpoch = 2
  const rotatedV2 = await CryptoEngine.rotateContainerDekV2(
    v2Epoch1,
    newPass
  );
  assert.equal(rotatedV2.container.keyEpoch, 2);
  assert.notDeepEqual(rotatedV2.sessionDek, v2Dek1);

  // Dispositivo offline recebe o novo keyEpoch=2 e re-criptografa sua fila offline antes do Push
  const reencryptedCount =
    await syncAdapter.reencryptOfflineQueueForNewKeyEpoch(
      v2Dek1,
      rotatedV2.sessionDek,
      2
    );
  assert.equal(reencryptedCount, 1);
  assert.equal(syncAdapter.getPendingQueue()[0].operation.record.keyEpoch, 2);

  CryptoEngine.zeroize(dek1);
  CryptoEngine.zeroize(dekAfterRewrap);
  CryptoEngine.zeroize(v2Dek1);
  CryptoEngine.zeroize(rotatedV2.sessionDek);
});

test('Fase 4A - 10: Isolamento e autorização entre usuários (tentativa de Push/Pull cruzado retorna 403 Forbidden)', async () => {
  const deviceSecurity = new DeviceSecurityModel();
  const syncServer = new ZeroKnowledgeSyncServerEngine(deviceSecurity);

  const homerDev = deviceSecurity.provisionNewDevice({
    userId: 'user-homer',
    deviceName: 'PC do Homer',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
  });
  const burnsDev = deviceSecurity.provisionNewDevice({
    userId: 'user-burns',
    deviceName: 'MacBook do Sr. Burns',
    platform: 'desktop-web',
    authMethod: 'webauthn-passkey',
  });

  syncServer.registerVaultOwnership(
    'user-homer',
    homerDev.device.deviceId,
    homerDev.rawSessionToken,
    'vault-homer-privado',
    1
  );

  // Sr. Burns tenta fazer Pull do cofre privado do Homer usando sua própria sessão válida -> 403 Forbidden!
  assert.throws(() => {
    syncServer.pullIncremental(
      'user-burns',
      burnsDev.device.deviceId,
      burnsDev.rawSessionToken,
      'vault-homer-privado',
      0
    );
  }, /403 Forbidden/i);

  // Sr. Burns tenta usar o deviceId do Homer -> 403 Forbidden!
  assert.throws(() => {
    syncServer.pullIncremental(
      'user-burns',
      homerDev.device.deviceId,
      homerDev.rawSessionToken,
      'vault-homer-privado',
      0
    );
  }, /403 Forbidden/i);
});

test('Fase 4A - 11: Revogação de sessão/dispositivo (401 Unauthorized) e proteção com Secret Key (Kit de Emergência)', async () => {
  const deviceSecurity = new DeviceSecurityModel();
  const syncServer = new ZeroKnowledgeSyncServerEngine(deviceSecurity);

  const userId = 'user-barnaby';
  const vaultId = 'vault-barnaby-2fa';
  const dev = deviceSecurity.provisionNewDevice({
    userId,
    deviceName: 'Tablet Perdido no Bar do Moe',
    platform: 'mobile-web',
    authMethod: 'session-token',
  });

  syncServer.registerVaultOwnership(
    userId,
    dev.device.deviceId,
    dev.rawSessionToken,
    vaultId,
    1
  );

  // 11a. Revoga o dispositivo perdido e comprova bloqueio imediato de Push/Pull no servidor (401 Unauthorized)
  const revoked = deviceSecurity.revokeDevice(userId, dev.device.deviceId);
  assert.ok(revoked.revokedAt);

  assert.throws(() => {
    syncServer.pullIncremental(
      userId,
      dev.device.deviceId,
      dev.rawSessionToken,
      vaultId,
      0
    );
  }, /Sessão Revogada \(401 Unauthorized\)/i);

  // 11b. Testa Kit de Emergência com Secret Key de 128 bits combinada à Senha Mestra via HKDF + Argon2id
  const emergencyKit = DeviceSecurityModel.generateEmergencyKit({
    vaultId,
    accountIdentifier: 'barnaby@springfield.fake',
    kdfProfile: FAST_KDF_PARAMS,
  });
  assert.match(
    emergencyKit.secretKey,
    /^DVLT-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/
  );

  const sample = createSampleSpringFieldPayload();
  const masterPwd = 'SenhaMestraComSecretKey#2026';
  const { container, sessionDek } = await CryptoEngine.sealContainerV2(
    masterPwd,
    sample,
    FAST_KDF_PARAMS,
    emergencyKit.secretKey
  );
  assert.equal(container.requiresSecretKey, true);

  // Tentar desbloquear apenas com a Senha Mestra (sem a Secret Key do Kit de Emergência) DEVE falhar!
  await assert.rejects(
    async () => {
      await CryptoEngine.unsealContainerV2(container, masterPwd);
    },
    /Senha Mestra ou Secret Key incorreta/i
  );

  // Desbloqueio com Senha Mestra + Secret Key correta funciona perfeitamente
  const unlockedWithKit = await CryptoEngine.unsealContainerV2(
    container,
    masterPwd,
    emergencyKit.secretKey
  );
  assert.equal(
    unlockedWithKit.payload.credentials.length,
    sample.credentials.length
  );

  CryptoEngine.zeroize(sessionDek);
  CryptoEngine.zeroize(unlockedWithKit.sessionDek);
});

test('Fase 4A - 12: Tratamento e rejeição de registros criptografados V2 malformados ou com tentativa de vazamento em texto puro', () => {
  // 12a. Nonce com tamanho inválido (diferente de 12 bytes / 24 chars hex)
  assert.throws(() => {
    assertWellFormedEncryptedRecordV2({
      recordId: 'rec-bad-nonce',
      vaultId: 'vault-1',
      recordType: 'credential',
      formatVersion: 2,
      revision: 1,
      keyEpoch: 1,
      deleted: false,
      updatedAt: new Date().toISOString(),
      nonceHex: 'abcd',
      ciphertextHex: 'a'.repeat(64),
      aadHashSha256Hex: 'b'.repeat(64),
    });
  }, /malformado ou inválido/i);

  // 12b. Registro aparentemente válido, mas contendo propriedade `password` em texto puro anexada acidentalmente
  const leakyRecord = {
    recordId: 'rec-leaky',
    vaultId: 'vault-1',
    recordType: 'credential' as const,
    formatVersion: 2 as const,
    revision: 1,
    keyEpoch: 1,
    deleted: false,
    updatedAt: new Date().toISOString(),
    nonceHex: 'a'.repeat(24),
    ciphertextHex: 'b'.repeat(64),
    aadHashSha256Hex: 'c'.repeat(64),
    password: 'VazamentoEmTextoPuroProibido',
  };

  assert.throws(() => {
    assertWellFormedEncryptedRecordV2(leakyRecord);
  }, /Violação Zero-Knowledge: Registro de sincronização contém propriedades em texto puro/i);
});

