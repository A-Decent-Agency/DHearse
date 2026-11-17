const test = require('node:test');
const assert = require('node:assert/strict');

test('standalone worker serves the widget, restricts CORS, and keeps server files private', async t => {
  const { createDhearseRuntime } = await import('../server/index.js');
  const runtime = createDhearseRuntime({
    env: { DHEARSE_ENABLED: 'false', DHEARSE_ALLOWED_ORIGINS: 'http://localhost:9000' },
  });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  t.after(() => runtime.close());
  const { port } = runtime.server.address();
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DHearse · Private rehearsal/);

  const status = await fetch(`${base}/api/private-rehearsal/status`);
  assert.equal(status.status, 503);
  assert.deepEqual(await status.json(), { configured: false });

  const preflight = await fetch(`${base}/api/private-rehearsal/challenge`, {
    method: 'OPTIONS', headers: { origin: 'http://localhost:9000' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:9000');

  const privateSource = await fetch(`${base}/discord-bot/rehearsal.js`);
  assert.equal(privateSource.status, 404);
  const client = await fetch(`${base}/api/live-audio/client.js`);
  assert.equal(client.status, 200);
  assert.match(client.headers.get('content-type'), /javascript/);
});

test('server rejects invalid origin and enabled state configuration', async () => {
  const { createDhearseRuntime } = await import('../server/index.js');
  assert.throws(() => createDhearseRuntime({
    env: { DHEARSE_ENABLED: 'yes' },
  }), /DHEARSE_ENABLED must be either true or false/);
  assert.throws(() => createDhearseRuntime({
    env: { DHEARSE_ENABLED: 'false', DHEARSE_ALLOWED_ORIGINS: '*' },
  }), /Invalid rehearsal origin/);
});
