/** Seeded PRNG (mulberry32) so measurements and the scheduler are reproducible. */
export class Rng {
  private s: number;

  constructor(seed?: number) {
    const base = seed === undefined ? Math.floor(Math.random() * 0xffffffff) : seed;
    this.s = (base >>> 0) || 0x9e3779b9;
  }

  random(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  choice<T>(items: T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }
}
