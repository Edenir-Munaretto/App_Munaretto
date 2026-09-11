// Setup dos testes do frontend (vitest + jsdom).
import 'fake-indexeddb/auto';

// jsdom não implementa createObjectURL/revokeObjectURL (usados no cache de fotos).
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => `blob:teste-${Math.random().toString(36).slice(2)}`;
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}
