import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword } from '../auth.ts';
import { openMemoryDatabase } from './db.ts';
import type { Actor } from './store.ts';
import { canOpenVault, createUsers } from './users.ts';

// Usuário master único e acesso ao cofre de senhas (/cofre).

async function setup() {
  const db = await openMemoryDatabase();
  const users = createUsers(db);
  const add = async (username: string, role: 'admin' | 'analyst', extra = '') => {
    const rows = await db.query<{ id: number }>(
      `INSERT INTO users (username, display_name, password_hash, role${extra ? ', must_change_password' : ''}) VALUES ($1, $1, $2, $3${extra ? ', TRUE' : ''}) RETURNING id`,
      [username, hashPassword('senha-segura-123'), role]
    );
    return rows[0].id;
  };
  const actor = (username: string, role: 'admin' | 'analyst' = 'admin'): Actor => ({ username, displayName: username, role });
  const get = async (id: number) => (await users.byId(id))!;
  return { db, users, add, actor, get };
}

test('sem master, o usuário "admin" vira master com acesso ao cofre; com master, nada muda', async () => {
  const { users, add, get } = await setup();
  const outro = await add('outro', 'admin');
  const admin = await add('admin', 'admin');
  assert.equal(await users.ensureMaster(), 'admin');
  assert.equal((await get(admin)).is_master, true);
  assert.equal(canOpenVault(await get(admin)), true);
  assert.equal((await get(outro)).is_master, false);
  assert.equal(canOpenVault(await get(outro)), false);
  assert.equal(await users.ensureMaster(), null);
});

test('só o master libera o cofre, e só para administradores', async () => {
  const { users, add, actor, get } = await setup();
  await add('admin', 'admin');
  const outroAdmin = await add('filipe_admin', 'admin');
  const analista = await add('analista', 'analyst');
  await users.ensureMaster();

  await assert.rejects(users.update(actor('filipe_admin'), outroAdmin, { vaultAccess: true }), /Só o usuário master/);
  await assert.rejects(users.update(actor('admin'), analista, { vaultAccess: true }), /Só administradores/);
  await users.update(actor('admin'), outroAdmin, { vaultAccess: true });
  assert.equal(canOpenVault(await get(outroAdmin)), true);

  // Deixar de ser administrador tira o cofre junto.
  await users.update(actor('admin'), outroAdmin, { role: 'analyst' });
  assert.equal((await get(outroAdmin)).vault_access, false);
});

test('só o master muda papéis, cria administradores e redefine senha de administrador', async () => {
  const { users, add, actor } = await setup();
  await add('admin', 'admin');
  await add('outro', 'admin');
  const terceiroAdmin = await add('terceiro', 'admin');
  const analista = await add('analista', 'analyst');
  await users.ensureMaster();

  await assert.rejects(users.update(actor('outro'), analista, { role: 'admin' }), /Só o usuário master/);
  await assert.rejects(users.create(actor('outro'), { username: 'novo', role: 'admin', password: 'senha-segura-123' }), /Só o usuário master/);
  await users.create(actor('outro'), { username: 'novo-analista', role: 'analyst', password: 'senha-segura-123' });
  await assert.rejects(users.resetPassword(actor('outro'), terceiroAdmin, 'nova-senha-segura-1'), /Só o usuário master/);
  await users.resetPassword(actor('outro'), analista, 'nova-senha-segura-1');
});

test('o master não perde o papel, o cofre nem a conta; só sai transferindo', async () => {
  const { users, add, actor, get } = await setup();
  const admin = await add('admin', 'admin');
  const filipe = await add('filipe_admin', 'admin');
  const provisorio = await add('provisorio', 'admin', 'must_change');
  await users.ensureMaster();

  await assert.rejects(users.update(actor('admin'), admin, { role: 'analyst' }), /master/);
  await assert.rejects(users.update(actor('filipe_admin'), admin, { active: false }), /master/);
  await assert.rejects(users.update(actor('admin'), admin, { vaultAccess: false }), /sempre tem acesso/);
  await assert.rejects(users.remove(actor('filipe_admin'), admin), /não pode ser apagado/);

  await assert.rejects(users.transferMaster(actor('filipe_admin'), filipe), /Só o usuário master/);
  await assert.rejects(users.transferMaster(actor('admin'), provisorio), /administrador ativo/);
  await users.transferMaster(actor('admin'), filipe);
  assert.equal((await get(filipe)).is_master, true);
  assert.equal(canOpenVault(await get(filipe)), true);
  assert.equal((await get(admin)).is_master, false);
  // O antigo master segue administrador e mantém o acesso que tinha.
  assert.equal(canOpenVault(await get(admin)), true);
});

test('troca de senha pendente ou conta desativada não abre o cofre', () => {
  assert.equal(canOpenVault({ role: 'admin', active: true, vault_access: true, must_change_password: true }), false);
  assert.equal(canOpenVault({ role: 'admin', active: false, vault_access: true }), false);
  assert.equal(canOpenVault({ role: 'analyst', active: true, vault_access: true }), false);
});
