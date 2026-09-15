// Module-private, per-frame communication inside the extension's isolated world.
// Do not attach this bus, its listeners, or dispatch functions to DOM/window.
const listeners = new Set();

export function subscribeInternalMessage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitInternalMessage(message) {
  for (const listener of Array.from(listeners)) listener(message);
}
