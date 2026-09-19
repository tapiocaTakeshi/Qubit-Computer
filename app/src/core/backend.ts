/**
 * Hardware backend selection: CPU / GPU / Q-NPU.
 *
 * Mirrors `qubit_computer/backend.py`. APQB / QBNN are quantum-inspired
 * models that run on ordinary classical hardware (paper Sec. 3.3 / 7.2),
 * so "backend" means which classical device drives the state-vector /
 * QBNN math -- not a physical qubit.
 *
 * In this TypeScript/React Native app there is (yet) no device-accelerated
 * compute path, so `gpu` and `qnpu` are honestly reported as unavailable
 * and selecting either falls back to `cpu`, the engine every StateVector
 * already uses. The Python package also has NumPy CPU vectorization under
 * the legacy name `gpu`; it does not ship a physical GPU compute driver.
 */

export type Backend = 'cpu' | 'gpu' | 'qnpu';

export const BACKENDS: Backend[] = ['cpu', 'gpu', 'qnpu'];

export interface BackendInfo {
  name: Backend;
  available: boolean;
  engine: string;
  detail: string;
}

export function isBackend(name: string): name is Backend {
  return (BACKENDS as string[]).includes(name);
}

export function backendInfo(name: string): BackendInfo {
  const b = name.trim().toLowerCase();
  if (!isBackend(b)) throw new Error(`unknown backend '${name}' (choices: ${BACKENDS.join(', ')})`);
  if (b === 'cpu') {
    return { name: 'cpu', available: true, engine: 'js', detail: 'dependency-free reference state-vector engine (always available)' };
  }
  if (b === 'gpu') {
    return {
      name: 'gpu', available: false, engine: '-',
      detail: 'no GPU compute driver in this app; the Python package has NumPy CPU vectorization under the legacy name gpu',
    };
  }
  return {
    name: 'qnpu', available: false, engine: '-',
    detail: 'Q-NPU (a dedicated APQB/QBNN processor) is a planned future backend; no hardware or driver exists yet',
  };
}

export function availableBackends(): BackendInfo[] {
  return BACKENDS.map((b) => backendInfo(b));
}

export function isAvailable(name: string): boolean {
  return backendInfo(name).available;
}

/** Returns the BackendInfo that will actually run, falling back to `cpu` (reporting why via `onWarning`). */
export function resolveBackend(name: string, onWarning?: (msg: string) => void): BackendInfo {
  const info = backendInfo(name);
  if (info.available) return info;
  onWarning?.(`backend '${info.name}' unavailable (${info.detail}); falling back to 'cpu'`);
  return backendInfo('cpu');
}
