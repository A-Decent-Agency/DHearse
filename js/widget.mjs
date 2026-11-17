const SAFE_ORIGIN_PROTOCOLS = new Set(['https:', 'http:']);
const THEME_KEYS = ['accent', 'background', 'panel', 'text', 'control', 'focus'];

function safeTheme(theme = {}) {
  return Object.fromEntries(THEME_KEYS.flatMap(key => {
    const value = theme?.[key];
    return typeof value === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(value)
      ? [[key, value]] : [];
  }));
}

function safeHeight(height) {
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) return `${height}px`;
  if (typeof height === 'string' && /^(?:\d+(?:\.\d+)?(?:px|rem|vh|dvh|%))$/.test(height)) return height;
  throw new TypeError('Widget height must be a positive number or a CSS px, rem, vh, dvh, or % value.');
}

export async function mount(target, {
  src = new URL('../index.html', import.meta.url),
  title = 'DHearse private rehearsal',
  height = '760px',
  theme = {},
  namespace = 'dhearse',
  getWalletAddress,
  signMessage,
  getSigner,
  onRoom,
  onError,
  readyTimeoutMs = 20_000,
} = {}) {
  if (!target?.ownerDocument?.createElement || typeof target.append !== 'function') {
    throw new TypeError('Mount DHearse into a DOM element.');
  }
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(namespace)) throw new TypeError('Widget message namespace is invalid.');
  const document = target.ownerDocument;
  const hostOrigin = document.location?.origin || globalThis.location?.origin;
  if (!hostOrigin || hostOrigin === 'null') throw new Error('DHearse requires an HTTP or HTTPS host page.');
  const url = new URL(src, document.baseURI);
  if (!SAFE_ORIGIN_PROTOCOLS.has(url.protocol) || url.origin === 'null' ||
      url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('The DHearse widget URL must use HTTPS, or local HTTP during development.');
  }
  const widgetOrigin = url.origin;
  url.searchParams.set('embedded', '1');
  url.searchParams.set('hostOrigin', hostOrigin);
  url.searchParams.set('messageNamespace', namespace);

  const frame = document.createElement('iframe');
  frame.title = title;
  frame.src = url.toString();
  frame.loading = 'eager';
  frame.referrerPolicy = 'strict-origin';
  frame.allow = 'microphone; autoplay';
  frame.style.width = '100%';
  frame.style.height = safeHeight(height);
  frame.style.border = '0';
  frame.style.display = 'block';

  let readyTimer;
  let readySettled = false;
  let disposed = false;
  let closePending = null;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const message = (type, payload = {}) => ({ type: `${namespace}:${type}`, ...payload });
  const send = payload => frame.contentWindow?.postMessage(payload, widgetOrigin);
  const reportError = error => {
    if (typeof onError === 'function') onError(error);
  };
  const resolveSigner = async () => {
    const signer = typeof getSigner === 'function' ? await getSigner() : null;
    const address = typeof getWalletAddress === 'function'
      ? await getWalletAddress()
      : await signer?.getAddress?.();
    if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address)) {
      throw new Error('Connect a wallet in the host application first.');
    }
    return { address, signer };
  };
  const handleMessage = async event => {
    if (disposed || event.source !== frame.contentWindow || event.origin !== widgetOrigin) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === `${namespace}:rehearsal-ready`) {
      if (!readySettled) {
        readySettled = true;
        clearTimeout(readyTimer);
        resolveReady();
      }
      send(message('theme', { theme: safeTheme(theme) }));
      return;
    }
    if (data.type === `${namespace}:rehearsal-room` && typeof data.roomId === 'string') {
      onRoom?.(data.roomId);
      return;
    }
    if (data.type === `${namespace}:wallet-request` && typeof data.requestId === 'string') {
      try {
        const { address } = await resolveSigner();
        send(message('wallet-response', { requestId: data.requestId, address }));
      } catch (error) {
        reportError(error);
        send(message('wallet-response', { requestId: data.requestId, error: 'Connect a wallet in the host application first.' }));
      }
      return;
    }
    if (data.type === `${namespace}:sign-message-request` && typeof data.requestId === 'string' &&
        typeof data.message === 'string' && typeof data.wallet === 'string') {
      try {
        const { address, signer } = await resolveSigner();
        if (address.toLowerCase() !== data.wallet.toLowerCase()) {
          throw new Error('The connected wallet changed. Sign in again.');
        }
        const signature = typeof signMessage === 'function'
          ? await signMessage(data.message, address)
          : await signer?.signMessage?.(data.message);
        if (typeof signature !== 'string' || !/^0x[0-9a-f]+$/i.test(signature)) {
          throw new Error('The host wallet could not sign the rehearsal consent.');
        }
        send(message('sign-message-response', { requestId: data.requestId, address, signature }));
      } catch (error) {
        reportError(error);
        send(message('sign-message-response', {
          requestId: data.requestId, error: 'Wallet request failed or was declined.',
        }));
      }
      return;
    }
    if (closePending && data.requestId === closePending.requestId &&
        data.type === `${namespace}:rehearsal-closed`) {
      closePending.resolve({ roomId: data.roomId || '', warning: data.warning || '' });
      cleanup();
      return;
    }
    if (closePending && data.requestId === closePending.requestId &&
        data.type === `${namespace}:rehearsal-close-failed`) {
      closePending.reject(new Error('The rehearsal did not close. Retry before removing the widget.'));
    }
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(readyTimer);
    globalThis.removeEventListener('message', handleMessage);
    frame.remove();
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error('The DHearse widget was removed before it became ready.'));
    }
  };
  globalThis.addEventListener('message', handleMessage);
  readyTimer = setTimeout(() => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new Error('The DHearse widget did not become ready in time.'));
  }, readyTimeoutMs);
  target.append(frame);

  return {
    frame,
    ready,
    setTheme(nextTheme) {
      theme = nextTheme;
      if (readySettled && !disposed) send(message('theme', { theme: safeTheme(theme) }));
    },
    walletChanged() {
      if (!disposed) send(message('rehearsal-wallet-changed'));
    },
    async unmount({ handoff = false, timeoutMs = 10_000 } = {}) {
      if (disposed) return { roomId: '', warning: '' };
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Unmount timeout must be positive.');
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          closePending = null;
          reject(new Error('DHearse did not confirm shutdown. The widget remains mounted; retry before removing it.'));
        }, timeoutMs);
        closePending = {
          requestId,
          resolve: value => { clearTimeout(timer); closePending = null; resolve(value); },
          reject: error => { clearTimeout(timer); closePending = null; reject(error); },
        };
      });
      send(message('close-rehearsal', { requestId, handoff }));
      return result;
    },
  };
}
