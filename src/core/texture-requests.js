export class TextureRequests {
 constructor(THREE, concurrency = 2) {
  this.THREE = THREE;
  this.loader = new THREE.TextureLoader();
  this.ktx2Loader = null;
  this.ktx2Unavailable = false;
  this.transcoderPath = './vendor/basis/';
  this.limit = concurrency;
  this.active = 0;
  this.queue = [];
  this.versions = new Map();
  this.inflight = new Set();
 }
 record(type, url, error) {
  try {
   const root = globalThis;
   const item = { time: Date.now(), type, url: url || '', message: String(error?.message || error || '') };
   const list = root.__solisterTextureErrors || (root.__solisterTextureErrors = []);
   list.push(item);
   if (list.length > 120) list.splice(0, list.length - 120);
   if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('solister-texture-error', { detail: item }));
  } catch (e) {}
 }
 attachRenderer(renderer, options = {}) {
  if (options.transcoderPath) this.transcoderPath = options.transcoderPath;
  if (this.ktx2Loader) return true;
  if (this.ktx2Unavailable) return false;
  const Loader = this.THREE.KTX2Loader || globalThis.KTX2Loader;
  if (!Loader) { this.ktx2Unavailable = true; this.record('ktx2-loader-missing', '', 'KTX2Loader is not installed'); return false; }
  try {
   const root = globalThis;
   let shared = root.__solisterSharedKtx2Loader;
   if (!shared || !shared.loader || shared.THREE !== this.THREE || shared.transcoderPath !== this.transcoderPath) {
    const loader = new Loader();
    if (loader.setTranscoderPath) loader.setTranscoderPath(this.transcoderPath);
    if (loader.setWorkerLimit) loader.setWorkerLimit(Math.max(1, Math.min(4, this.limit)));
    if (renderer && loader.detectSupport) loader.detectSupport(renderer);
    shared = { loader, THREE: this.THREE, transcoderPath: this.transcoderPath, renderer };
    root.__solisterSharedKtx2Loader = shared;
   } else if (renderer && shared.renderer !== renderer && shared.loader.detectSupport) {
    shared.loader.detectSupport(renderer);
    shared.renderer = renderer;
   }
   this.ktx2Loader = shared.loader;
   return true;
  } catch (error) {
   this.ktx2Unavailable = true;
   this.record('ktx2-loader-init-failed', '', error);
   return false;
  }
 }
 compressedUrl(url) {
  return /\.ktx2([?#].*)?$/i.test(url);
 }
 loaderFor(url) {
  if (!this.compressedUrl(url)) return this.loader;
  if (!this.ktx2Loader) throw new Error('KTX2Loader is not installed for ' + url);
  return this.ktx2Loader;
 }
 cancel(q) {
  if (q.cancelled || q.delivered) return;
  q.cancelled = true;
  try { q.onCancel?.(); } catch (error) { this.record('texture-cancel-callback-failed', q.url, error); }
 }
 batch(channel) {
  const version = (this.versions.get(channel) || 0) + 1;
  this.versions.set(channel, version);
  const obsolete = this.queue.filter(q => q.channel === channel);
  this.queue = this.queue.filter(q => q.channel !== channel);
  for (const q of obsolete) this.cancel(q);
  for (const q of this.inflight) if (q.channel === channel && q.version < version) this.cancel(q);
  return { load: (url, onLoad, onProgress, onError, onCancel) => {
   const q = { channel, version, url, onLoad, onProgress, onError, onCancel, cancelled: false };
   if (!this.current(q)) { this.cancel(q); return; }
   this.queue.push(q);
   this.pump();
  } };
 }
 current(q) {
  return !q.cancelled && this.versions.get(q.channel) === q.version;
 }
 pump() {
  while (this.active < this.limit && this.queue.length) {
   const q = this.queue.shift();
   if (!this.current(q)) { this.cancel(q); continue; }
   this.active++;
   this.inflight.add(q);
   let ended = false;
   const finish = () => {
    if (ended) return;
    ended = true;
    this.inflight.delete(q);
    this.active--;
    this.pump();
   };
   let loader;
   try { loader = this.loaderFor(q.url); }
   catch (error) {
    try {
     if (this.current(q)) { q.delivered = true; this.record('texture-loader-unavailable', q.url, error); q.onError?.(error); }
     else this.cancel(q);
    } catch (callbackError) { this.record('texture-error-callback-failed', q.url, callbackError); }
    finally { finish(); }
    continue;
   }
   try {
    loader.load(q.url, texture => {
     try {
      if (this.current(q)) {
       if (this.compressedUrl(q.url) && texture?.repeat && texture?.offset) {
        texture.repeat.y = -1;
        texture.offset.y = 1;
        texture.updateMatrix();
       }
       q.delivered = true;
       q.onLoad?.(texture);
      }
      else { texture.dispose(); this.cancel(q); }
     } catch (error) {
      this.record('texture-apply-callback-failed', q.url, error);
      try { texture.dispose(); } catch (disposeError) { this.record('texture-dispose-failed', q.url, disposeError); }
     } finally { finish(); }
    }, q.onProgress, error => {
     try {
      if (this.current(q)) { q.delivered = true; this.record('texture-load-failed', q.url, error); q.onError?.(error); }
      else this.cancel(q);
     } catch (callbackError) { this.record('texture-error-callback-failed', q.url, callbackError); }
     finally { finish(); }
    });
   } catch (error) {
    try {
     if (this.current(q)) { q.delivered = true; this.record('texture-request-failed', q.url, error); q.onError?.(error); }
     else this.cancel(q);
    } catch (callbackError) { this.record('texture-error-callback-failed', q.url, callbackError); }
    finally { finish(); }
   }
  }
 }
}