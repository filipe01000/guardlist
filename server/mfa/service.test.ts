import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { openMemoryDatabase } from '../db.ts';
import type { Actor } from '../store.ts';
import { createUsers } from '../users.ts';
import { createMfa } from './service.ts';
import { totpAt } from './totp.ts';

const env = { MFA_SECRET_KEY: Buffer.alloc(32, 6).toString('base64') };
const admin: Actor = { username: 'chefe', displayName: 'Chefe', role: 'admin' };

async function setup(t: TestContext, mfaEnv: NodeJS.ProcessEnv = env) {
  const db = await openMemoryDatabase();
  t.after(() => db.close?.());
  const users = createUsers(db);
  const boss = await users.create(admin, { username: 'chefe', displayName: 'Chefe', role: 'admin', password: 'senha-forte-123', mustChangePassword: false });
  const ana = await users.create(admin, { username: 'ana', displayName: 'Ana', role: 'analyst', password: 'senha-forte-456', mustChangePassword: false });
  const clock = { now: 1_800_000_000_000 };
  const mfa = createMfa(db, { env: mfaEnv, now: () => clock.now });
  // Cadastra e confirma o MFA de um usuário; devolve o segredo e os códigos de recuperação.
  const enroll = async (id: number, account: string) => {
    const { secret } = await mfa.startSetup(id, account);
    const codes = await mfa.confirmSetup(id, totpAt(secret, Math.floor(clock.now / 30_000)));
    clock.now += 30_000;
    return { secret, codes: codes! };
  };
  const code = (secret: string) => totpAt(secret, Math.floor(clock.now / 30_000));
  return { db, users, mfa, clock, boss, ana, enroll, code };
}

test('cadastro: QR code, confirmação e 10 códigos de recuperação', async (t) => {
  const s = await setup(t);
  const setup1 = await s.mfa.startSetup(s.ana.id, 'ana');
  assert.match(setup1.qrSvg, /^<svg/);
  assert.match(setup1.uri, /^otpauth:\/\/totp\/GuardList:ana\?secret=/);
  assert.equal(await s.mfa.confirmSetup(s.ana.id, '000000'), null);
  const codes = await s.mfa.confirmSetup(s.ana.id, s.code(setup1.secret));
  assert.equal(codes?.length, 10);
  const row = (await s.db.query<any>('SELECT * FROM users WHERE id = $1', [s.ana.id]))[0];
  assert.ok(row.mfa_enabled_at);
  assert.equal(row.mfa_pending_secret, null);
  assert.equal(String(row.mfa_secret).includes(setup1.secret), false);
});

test('verificação: código certo, repetido e de recuperação', async (t) => {
  const s = await setup(t);
  const { secret, codes } = await s.enroll(s.ana.id, 'ana');
  const c = s.code(secret);
  assert.equal(await s.mfa.verify(s.ana.id, { code: c }), 'ok');
  assert.equal(await s.mfa.verify(s.ana.id, { code: c }), 'bad');
  assert.equal(await s.mfa.verify(s.ana.id, { recoveryCode: codes[0] }), 'ok');
  assert.equal(await s.mfa.verify(s.ana.id, { recoveryCode: codes[0] }), 'bad');
});

test('erros de código contam no bloqueio da conta', async (t) => {
  const s = await setup(t);
  await s.enroll(s.ana.id, 'ana');
  let last: unknown;
  for (let i = 0; i < 5; i++) last = await s.mfa.verify(s.ana.id, { code: '000000' });
  assert.ok(typeof last === 'object' && last !== null && 'lockedUntil' in last);
  assert.ok(typeof (await s.mfa.verify(s.ana.id, { code: '111111' })) === 'object');
});

test('exigência: só liga com chave e com o cadastro do próprio administrador', async (t) => {
  const s = await setup(t);
  await assert.rejects(s.mfa.setRequired(admin, s.boss.id, true), /cadastr/i);
  await s.enroll(s.boss.id, 'chefe');
  await s.mfa.setRequired(admin, s.boss.id, true);
  assert.equal(await s.mfa.isRequired(), true);
  assert.deepEqual(await s.mfa.stats(), { enrolled: 1, total: 2 });
  const noKey = await setup(t, {});
  assert.equal(noKey.mfa.available(), false);
  await assert.rejects(noKey.mfa.setRequired(admin, noKey.boss.id, true), /MFA_SECRET_KEY/);
});

test('desligar o próprio MFA só sem exigência e com código', async (t) => {
  const s = await setup(t);
  const { secret } = await s.enroll(s.boss.id, 'chefe');
  await s.mfa.setRequired(admin, s.boss.id, true);
  await assert.rejects(s.mfa.disable(s.boss.id, s.code(secret)), /exig/i);
  await s.mfa.setRequired(admin, s.boss.id, false);
  assert.equal(await s.mfa.disable(s.boss.id, '000000'), false);
  assert.equal(await s.mfa.disable(s.boss.id, s.code(secret)), true);
});

test('novos códigos de recuperação invalidam os anteriores', async (t) => {
  const s = await setup(t);
  const { secret, codes } = await s.enroll(s.ana.id, 'ana');
  const fresh = await s.mfa.regenerateRecovery(s.ana.id, s.code(secret));
  assert.equal(fresh?.length, 10);
  assert.equal(await s.mfa.verify(s.ana.id, { recoveryCode: codes[1] }), 'bad');
  assert.equal(await s.mfa.verify(s.ana.id, { recoveryCode: fresh![1] }), 'ok');
});

test('zerar o MFA de um usuário encerra as sessões dele', async (t) => {
  const s = await setup(t);
  await s.enroll(s.ana.id, 'ana');
  const before = (await s.db.query<any>('SELECT session_version FROM users WHERE id = $1', [s.ana.id]))[0].session_version;
  await s.mfa.reset(admin, s.ana.id);
  const row = (await s.db.query<any>('SELECT * FROM users WHERE id = $1', [s.ana.id]))[0];
  assert.equal(row.mfa_enabled_at, null);
  assert.equal(row.mfa_secret, null);
  assert.equal(row.session_version, before + 1);
  const audits = await s.db.query<any>("SELECT action FROM audit_log WHERE action LIKE 'mfa.%'");
  assert.ok(audits.some((a) => a.action === 'mfa.reset'));
});
