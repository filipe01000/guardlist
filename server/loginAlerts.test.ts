import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { describeAgent, networkOf } from '../src/utils/device.ts';
import { openMemoryDatabase } from './db.ts';
import { createLoginAlerts } from './loginAlerts.ts';
import type { Actor } from './storeCore.ts';
import { createUsers, SESSION_IDLE_MS } from './users.ts';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const admin: Actor = { username: 'chefe', displayName: 'Chefe', role: 'admin' };

test('rede do IP: /24 no IPv4, /48 no IPv6', () => {
  assert.equal(networkOf('200.10.5.7'), '200.10.5.0/24');
  assert.equal(networkOf('::ffff:200.10.5.99'), '200.10.5.0/24');
  assert.equal(networkOf('2804:14c:1a2b:9::1'), '2804:14c:1a2b::/48');
  assert.equal(networkOf('2804:14c::1'), '2804:14c:0::/48');
  assert.equal(networkOf(null), null);
  assert.equal(networkOf('lixo'), null);
});

test('dispositivo: navegador e sistema', () => {
  assert.equal(describeAgent(CHROME_WIN).label, 'Chrome · Windows');
  assert.equal(describeAgent(FIREFOX_WIN).label, 'Firefox · Windows');
});

async function setup(t: TestContext) {
  const db = await openMemoryDatabase();
  t.after(() => db.close?.());
  const users = createUsers(db);
  const alerts = createLoginAlerts(db);
  const ana = await users.create(admin, { username: 'ana', displayName: 'Ana', role: 'analyst', password: 'senha-forte-456', mustChangePassword: false });
  const row = (await users.byId(ana.id))!;
  // Abre uma sessão como o servidor faz e devolve o id gravado na tabela.
  const login = async (ip: string, ua: string) => {
    const sid = await users.createSession(row, ip, ua);
    const session = (await users.bySession(sid))!;
    await alerts.record(row.id, session.session_id, ip, ua);
    return { sid, id: session.session_id };
  };
  return { db, users, alerts, ana, login };
}

test('aviso: primeira sessão e acesso conhecido não avisam; navegador ou rede nova avisam', async (t) => {
  const s = await setup(t);
  const casa = await s.login('200.10.5.7', CHROME_WIN);
  assert.equal((await s.alerts.listFor(s.ana.id, casa.id)).length, 0, 'primeira sessão');
  await s.login('200.10.5.80', CHROME_WIN);
  assert.equal((await s.alerts.listFor(s.ana.id, casa.id)).length, 0, 'mesma rede e navegador');

  const outroNavegador = await s.login('200.10.5.7', FIREFOX_WIN);
  const outraRede = await s.login('187.33.1.2', CHROME_WIN);
  const seen = await s.alerts.listFor(s.ana.id, casa.id);
  assert.equal(seen.length, 2);
  const byDevice = seen.find((a) => a.newDevice && !a.newNetwork)!;
  const byNetwork = seen.find((a) => a.newNetwork && !a.newDevice)!;
  assert.equal(byDevice.ip, '200.10.5.7');
  assert.equal(byNetwork.ip, '187.33.1.2');

  // A sessão que gerou o aviso não vê o próprio aviso.
  assert.equal((await s.alerts.listFor(s.ana.id, outraRede.id)).some((a) => a.ip === '187.33.1.2'), false);
  assert.equal((await s.alerts.listFor(s.ana.id, outroNavegador.id)).length, 1);

  await s.alerts.dismiss(s.ana.id, byDevice.id);
  assert.deepEqual((await s.alerts.listFor(s.ana.id, casa.id)).map((a) => a.id), [byNetwork.id]);
  const audit = await s.db.query<{ action: string }>("SELECT action FROM audit_log WHERE action = 'login.new_access'");
  assert.equal(audit.length, 2);
});

test('dispensar só vale para os avisos da própria pessoa', async (t) => {
  const s = await setup(t);
  const casa = await s.login('200.10.5.7', CHROME_WIN);
  await s.login('187.33.1.2', CHROME_WIN);
  const [alert] = await s.alerts.listFor(s.ana.id, casa.id);
  await assert.rejects(s.alerts.dismiss(s.ana.id + 99, alert.id));
  assert.equal((await s.alerts.listFor(s.ana.id, casa.id)).length, 1);
});

test('inatividade: sessão parada além do limite deixa de valer; atividade renova', async (t) => {
  const s = await setup(t);
  const a = await s.login('200.10.5.7', CHROME_WIN);
  const idleSecs = SESSION_IDLE_MS / 1000;
  await s.db.query('UPDATE sessions SET last_seen_at = now() - make_interval(secs => $2::double precision) WHERE id = $1', [a.id, idleSecs - 120]);
  assert.ok(await s.users.bySession(a.sid), 'ainda dentro do limite');
  await s.users.touchSession(a.id);
  await s.db.query('UPDATE sessions SET last_seen_at = now() - make_interval(secs => $2::double precision) WHERE id = $1', [a.id, idleSecs + 5]);
  assert.equal(await s.users.bySession(a.sid), null, 'parada demais');
  assert.equal((await s.users.listSessions(s.ana.id)).length, 0);
});

test('consultar a sessão não conta como atividade', async (t) => {
  const s = await setup(t);
  const a = await s.login('200.10.5.7', CHROME_WIN);
  await s.db.query("UPDATE sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = $1", [a.id]);
  await s.users.bySession(a.sid);
  const [row] = await s.db.query<{ idle: number }>('SELECT extract(epoch FROM now() - last_seen_at)::int AS idle FROM sessions WHERE id = $1', [a.id]);
  assert.ok(row.idle >= 590);
});

test('encerrar as outras sessões mantém a atual', async (t) => {
  const s = await setup(t);
  const a = await s.login('200.10.5.7', CHROME_WIN);
  const b = await s.login('187.33.1.2', FIREFOX_WIN);
  await s.users.revokeOtherSessions(s.ana.id, a.id, 'ana');
  assert.ok(await s.users.bySession(a.sid));
  assert.equal(await s.users.bySession(b.sid), null);
});
