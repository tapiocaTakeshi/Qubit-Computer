/** Arithmetic parser; never evaluates JavaScript supplied by an app user. */
export function calculate(source: string): number {
  if (source.length > 500) throw new Error('Expression is too long');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%]|\S/gi) ?? [];
  let pos = 0;
  const atom = (): number => {
    const t = tokens[pos++];
    if (t === '+') return atom();
    if (t === '-') return -atom();
    if (t === '(') { const n = expression(); if (tokens[pos++] !== ')') throw new Error('Missing )'); return n; }
    if (!t || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) throw new Error('Enter a number or arithmetic expression');
    return Number(t);
  };
  const product = (): number => {
    let n = atom();
    while (['*', '/', '%'].includes(tokens[pos])) {
      const op = tokens[pos++], b = atom();
      if ((op === '/' || op === '%') && b === 0) throw new Error('Cannot divide by zero');
      n = op === '*' ? n * b : op === '/' ? n / b : n % b;
    }
    return n;
  };
  const expression = (): number => {
    let n = product();
    while (['+', '-'].includes(tokens[pos])) { const op = tokens[pos++], b = product(); n = op === '+' ? n + b : n - b; }
    return n;
  };
  const result = expression();
  if (pos !== tokens.length) throw new Error('Unexpected input');
  if (!Number.isFinite(result)) throw new Error('Result is outside the supported range');
  return result;
}
