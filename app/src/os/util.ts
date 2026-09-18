/** Shared kernel helpers kept free of imports so os modules can avoid cycles. */
import { Result } from '../core/computer';
import { StateVector, concurrence, threeTangle } from '../core/state';

export class KernelError extends Error {}

export const isResult = (v: unknown): v is Result => !!v && typeof v === 'object' && 'counts' in (v as object) && 'apqb' in (v as object);

export interface EntanglementInfo {
  numQubits: number;
  vonNeumann: number[];
  r: number[];
  concurrence?: number;
  c2Check?: number;
  threeTangle?: number;
  tau3Check?: number;
}

export function entanglementOf(sv: StateVector): EntanglementInfo {
  const readouts = sv.apqbReadouts();
  const info: EntanglementInfo = { numQubits: sv.n, vonNeumann: readouts.map((r) => r.vonNeumann), r: readouts.map((r) => r.r) };
  if (sv.n === 2) {
    info.concurrence = concurrence(sv);
    info.c2Check = info.concurrence ** 2 + readouts[0].r ** 2;
  }
  if (sv.n === 3) {
    info.threeTangle = threeTangle(sv);
    info.tau3Check = info.threeTangle + readouts[0].r ** 2;
  }
  return info;
}
