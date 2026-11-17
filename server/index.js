import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, resolve, sep } from 'node:path';
import { createRehearsalService } from '../discord-bot/rehearsal.js';
import { handleRehearsalRequest } from '../discord-bot/rehearsal-http.js';
import { createLiveAudioTransport } from '../discord-bot/live-audio-transport.js';
import { createRehearsalStore } from '../discord-bot/rehearsal-store.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
const mime = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
]);

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`${key} is required when DHEARSE_ENABLED=true`);
  return value;
}

function addressList(value, name) {
  const values = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (values.some(item => !/^0x[0-9a-f]{40}$/i.test(item))) {
    throw new Error(`${name} must be a comma-separated list of wallet addresses`);
  }
  return values;
}

function allowedOriginList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean).map(item => {
    let url;
    try { url = new URL(item); } catch { throw new Error(`Invalid rehearsal origin: ${item}`); }
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== item ||
        url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error(`Rehearsal origin must be HTTPS, or local HTTP: ${item}`);
    }
    return url.origin;
  });
}

function publicPath(pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = resolve(root, relative);
  const isPublic = target === join(root, 'index.html') ||
    target === join(root, 'dhearse.config.js') ||
    target.startsWith(join(root, 'css') + sep) ||
    target.startsWith(join(root, 'js') + sep);
  return isPublic && (mime.has(extname(target)) || target.endsWith('.html')) ? target : null;
}

export function createDhearseRuntime({ env = process.env, isEligibleHost, store: suppliedStore,
  transport: suppliedTransport, log = console } = {}) {
  if (env.DHEARSE_ENABLED !== undefined && !['true', 'false'].includes(env.DHEARSE_ENABLED)) {
    throw new Error('DHEARSE_ENABLED must be either true or false');
  }
  const enabled = env.DHEARSE_ENABLED === 'true';
  const productName = String(env.DHEARSE_PRODUCT_NAME || 'DHearse').trim();
  const namespace = String(env.DHEARSE_NAMESPACE || 'dhearse').trim();
  const allowedOrigins = allowedOriginList(env.DHEARSE_ALLOWED_ORIGINS || '');
  const ownerWallet = enabled ? required(env, 'DHEARSE_OWNER_WALLET') : env.DHEARSE_OWNER_WALLET || '';
  const engineerWallets = addressList(env.DHEARSE_ENGINEER_WALLETS, 'DHEARSE_ENGINEER_WALLETS');
  let store = suppliedStore || null;
  let transport = suppliedTransport || null;

  if (enabled) {
    const storageKey = required(env, 'DHEARSE_STORAGE_KEY');
    const pinataJwt = required(env, 'PINATA_JWT');
    const livekitUrl = required(env, 'DHEARSE_LIVEKIT_URL');
    const livekitApiKey = required(env, 'DHEARSE_LIVEKIT_API_KEY');
    const livekitApiSecret = required(env, 'DHEARSE_LIVEKIT_API_SECRET');
    if (!/^wss:\/\/[a-z0-9.-]+\.livekit\.cloud\/?$/i.test(livekitUrl)) {
      throw new Error('DHEARSE_LIVEKIT_URL must be a LiveKit Cloud wss:// URL');
    }
    store ||= createRehearsalStore({
      storageKey,
      distinctFrom: String(env.DHEARSE_DISTINCT_STORAGE_KEYS || '').split(',').map(key => key.trim()).filter(Boolean),
      pinataJwt,
      namespace,
    });
    transport ||= createLiveAudioTransport({
      url: livekitUrl, apiKey: livekitApiKey, apiSecret: livekitApiSecret, enabled: true,
      namespace, productName,
    });
    if (!transport.ready) throw new Error('DHearse LiveKit transport could not be configured');
  } else {
    transport ||= createLiveAudioTransport({ enabled: false, namespace, productName });
  }

  const service = createRehearsalService({
    ownerWallet, engineerWallets, isEligibleHost, productName, transport, store,
  });
  const clientScriptPath = require.resolve('livekit-client');
  let clientScript;
  const handler = async (request, response) => {
    if (await handleRehearsalRequest(request, response, { service, allowedOrigins })) return;
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/live-audio/client.js') {
      clientScript ||= await readFile(clientScriptPath);
      response.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'access-control-allow-origin': '*',
        'x-content-type-options': 'nosniff',
      });
      response.end(clientScript);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD', 'content-length': '0' });
      response.end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch {
      response.writeHead(400, { 'content-length': '0' });
      response.end();
      return;
    }
    const path = publicPath(pathname);
    if (!path) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'content-length': '9' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    const body = await readFile(path);
    response.writeHead(200, {
      'content-type': mime.get(extname(path)),
      'cache-control': path.endsWith('index.html') || path.endsWith('dhearse.config.js')
        ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin',
      'content-length': body.length,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  const server = createServer((request, response) => {
    void handler(request, response).catch(error => {
      log.error('[dhearse] Request failed:', error.name || 'Error');
      if (response.headersSent) { response.destroy(); return; }
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'content-length': '21' });
      response.end('Internal server error');
    });
  });
  const timer = service.configured ? setInterval(() => {
    void service.tick().catch(error => log.error('[dhearse] Rehearsal cleanup failed:', error.name || 'Error'));
  }, 30_000) : null;

  return {
    server,
    service,
    async listen({ port = Number(env.DHEARSE_PORT || env.PORT || 8080),
      host = env.DHEARSE_HOST || '127.0.0.1' } = {}) {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError('DHearse port must be between 1 and 65535');
      await new Promise((resolveListen, reject) => {
        const onError = error => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolveListen(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      if (timer) clearInterval(timer);
      await service.shutdown();
      if (server.listening) {
        await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
      }
      await store?.close?.();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createDhearseRuntime();
  const address = await runtime.listen();
  console.info(`[dhearse] Listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`);
  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await runtime.close();
      console.info(`[dhearse] Stopped after ${signal}`);
    } catch (error) {
      console.error('[dhearse] Shutdown failed:', error.name || 'Error');
      process.exitCode = 1;
    }
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
}
