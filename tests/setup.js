/**
 * Vitest setup — provides minimal browser globals so that game modules
 * can be imported in a Node environment without crashing.
 */

// Minimal window/document stubs
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

if (typeof globalThis.document === 'undefined') {
  const makeElement = () => ({
    getContext: () => ({
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      arc() {}, fill() {}, stroke() {}, clearRect() {},
      fillRect() {}, strokeRect() {}, save() {}, restore() {},
      translate() {}, scale() {}, rotate() {}, drawImage() {},
      measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      canvas: { width: 800, height: 600 },
    }),
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    insertBefore() {},
    setAttribute() {},
    getAttribute: () => null,
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollTop: 0,
    scrollHeight: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelectorAll: () => [],
    querySelector: () => null,
    children: [],
    parentElement: null,
    display: '',
  });

  globalThis.document = {
    getElementById: () => makeElement(),
    querySelector: () => makeElement(),
    querySelectorAll: () => [],
    createElement: () => makeElement(),
    body: makeElement(),
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

if (typeof globalThis.Image === 'undefined') {
  globalThis.Image = class Image {
    constructor() {
      this.src = '';
      this.crossOrigin = '';
    }
  };
}

if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = { now: () => Date.now() };
}

if (typeof globalThis.confirm === 'undefined') {
  globalThis.confirm = () => true;
}

if (typeof globalThis.alert === 'undefined') {
  globalThis.alert = () => {};
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

if (typeof globalThis.devicePixelRatio === 'undefined') {
  globalThis.devicePixelRatio = 1;
}

// location stub
if (!globalThis.location) {
  globalThis.location = { hostname: 'localhost', href: 'http://localhost:8000' };
}
