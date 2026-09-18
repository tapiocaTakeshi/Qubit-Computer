/** Minimal complex-number helpers (no dependencies). */
export interface Complex {
  re: number;
  im: number;
}

export const C = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = { re: 0, im: 0 };
export const ONE: Complex = { re: 1, im: 0 };

export const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const csub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const cscale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });
export const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
export const cabs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cabs2 = (a: Complex): number => a.re * a.re + a.im * a.im;
export const cexp = (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) });
export const isZero = (a: Complex): boolean => a.re === 0 && a.im === 0;

export function cfmt(a: Complex, digits = 4): string {
  const tol = 1e-12;
  if (Math.abs(a.im) < tol) return (a.re >= 0 ? '+' : '') + a.re.toFixed(digits);
  if (Math.abs(a.re) < tol) return (a.im >= 0 ? '+' : '') + a.im.toFixed(digits) + 'i';
  return `(${a.re >= 0 ? '+' : ''}${a.re.toFixed(digits)}${a.im >= 0 ? '+' : ''}${a.im.toFixed(digits)}i)`;
}
