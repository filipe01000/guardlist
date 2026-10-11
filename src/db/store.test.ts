import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllClients, getNotifications, SESSION_EXPIRED_EVENT } from './store.ts';

const responses = [
  { name: 'sessão expirada', status: 401, body: { error: 'Sessão expirada.' }, events: 1 },
  { name: 'permissão negada', status: 403, body: { error: 'Apenas administradores.' }, events: 0 },
  { name: 'troca de senha obrigatória', status: 403, body: { error: 'Troque sua senha.', code: 'PASSWORD_CHANGE_REQUIRED' }, events: 1 }
];

for (const [operation, request] of [['dados', getAllClients], ['notificações', getNotifications]] as const) {
  for (const response of responses) {
    test(`${operation}: ${response.name}`, async (t) => {
      const events: CustomEvent[] = [];
      const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { dispatchEvent: (event: CustomEvent) => { events.push(event); return true; } }
      });
      t.after(() => {
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
      });
      t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response.body), { status: response.status }));
      await assert.rejects(request(), { message: response.body.error });
      assert.equal(events.length, response.events);
      if (response.events) {
        assert.equal(events[0].type, SESSION_EXPIRED_EVENT);
        assert.equal(events[0].detail, response.body.error);
      }
    });
  }
}
