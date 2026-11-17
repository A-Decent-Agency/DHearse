let sdkPromise;

export function loadLiveAudioSdk(serviceUrl) {
  if (globalThis.LivekitClient) return Promise.resolve(globalThis.LivekitClient);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${serviceUrl.replace(/\/$/, '')}/api/live-audio/client.js`;
      script.onload = () => globalThis.LivekitClient
        ? resolve(globalThis.LivekitClient)
        : reject(new Error('Audio client unavailable'));
      script.onerror = () => reject(new Error('Audio client unavailable'));
      document.head.append(script);
    }).catch(error => {
      sdkPromise = null;
      throw error;
    });
  }
  return sdkPromise;
}
