const test = require('node:test');
const assert = require('node:assert/strict');

test('embedded widget verifies its frame origin and brokers host wallet requests', async t => {
  const { mount } = await import('../js/widget.mjs');
  const savedAdd = globalThis.addEventListener, savedRemove = globalThis.removeEventListener;
  const listeners = new Map(), sent = [], removed = [];
  t.after(() => {
    if (savedAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = savedAdd;
    if (savedRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = savedRemove;
  });
  globalThis.addEventListener = (name, callback) => listeners.set(name, callback);
  globalThis.removeEventListener = (name, callback) => {
    if (listeners.get(name) === callback) listeners.delete(name);
  };
  const frame = {
    style: {},
    contentWindow: { postMessage: (data, origin) => sent.push({ data, origin }) },
    remove() { removed.push(true); },
  };
  const document = {
    location: { origin: 'https://app.example' },
    baseURI: 'https://app.example/settings/',
    createElement: name => {
      assert.equal(name, 'iframe');
      return frame;
    },
  };
  const target = { ownerDocument: document, append: child => assert.equal(child, frame) };
  const address = `0x${'a'.repeat(40)}`;
  const widget = await mount(target, {
    src: 'https://widget.example/index.html',
    getWalletAddress: async () => address,
    signMessage: async message => `0x${Buffer.from(message).toString('hex')}`,
    theme: { accent: '#abc', bad: 'url(javascript:alert(1))' },
  });
  const deliver = (data, origin = 'https://widget.example', source = frame.contentWindow) => listeners.get('message')({
    source, origin, data,
  });

  deliver({ type: 'dhearse:rehearsal-ready' });
  await widget.ready;
  assert.equal(sent.at(-1).data.type, 'dhearse:theme');
  assert.deepEqual(sent.at(-1).data.theme, { accent: '#abc' });
  assert.match(frame.src, /hostOrigin=https%3A%2F%2Fapp\.example/);
  assert.equal(frame.allow, 'microphone; autoplay');

  deliver({ type: 'dhearse:wallet-request', requestId: 'wallet-1' });
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1).data, {
    type: 'dhearse:wallet-response', requestId: 'wallet-1', address,
  });

  deliver({ type: 'dhearse:sign-message-request', requestId: 'sign-1', address, wallet: address, message: 'consent' });
  await new Promise(setImmediate);
  assert.deepEqual(sent.at(-1).data, {
    type: 'dhearse:sign-message-response', requestId: 'sign-1', address,
    signature: `0x${Buffer.from('consent').toString('hex')}`,
  });

  const sentBeforeForgery = sent.length;
  deliver({ type: 'dhearse:wallet-request', requestId: 'forged' }, 'https://evil.example');
  assert.equal(sent.length, sentBeforeForgery);
  const closing = widget.unmount();
  const closeRequest = sent.findLast(entry => entry.data.type === 'dhearse:close-rehearsal')?.data;
  assert.ok(closeRequest);
  deliver({ type: 'dhearse:rehearsal-closed', requestId: closeRequest.requestId, roomId: 'room-1' });
  assert.deepEqual(await closing, { roomId: 'room-1', warning: '' });
  assert.deepEqual(removed, [true]);
});

test('widget rejects insecure external frames and invalid heights', async () => {
  const { mount } = await import('../js/widget.mjs');
  const target = { ownerDocument: {
    location: { origin: 'https://app.example' },
    baseURI: 'https://app.example/',
    createElement: () => ({ style: {} }),
  }, append() {} };
  await assert.rejects(mount(target, { src: 'http://widget.example/index.html' }), /HTTPS/);
  await assert.rejects(mount(target, { src: 'https://widget.example/', height: '100vh; display:none' }), /height/);
});
