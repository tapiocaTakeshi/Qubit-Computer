/** Deliberately small shell grammar. Unsupported syntax fails instead of being simulated. */
type Part = { text: string; expand: boolean };
export type Word = Part[];
type Token = { word: Word } | { op: string };
export interface Command { words: Word[]; redirects: { op: string; path: Word }[] }
export interface Pipeline { commands: Command[]; when: ';' | '&&' | '||' }

export function expandWord(word: Word, env: Record<string, string>, status: number): string {
  return word.map(p => p.expand ? p.text.replace(/\$(?:\{([A-Za-z_]\w*|\?)\}|([A-Za-z_]\w*|\?))/g,
    (_, a, b) => (a ?? b) === '?' ? String(status) : env[a ?? b] ?? '') : p.text).join('');
}

export function parseShell(source: string): Pipeline[] {
  if (source.length > 100000) throw new Error('command exceeds 100 KB');
  const tokens: Token[] = [];
  let word: Word = [], started = false, quote = '';
  const add = (text: string, expand: boolean) => { word.push({ text, expand }); started = true; };
  const flush = () => { if (started) tokens.push({ word }); word = []; started = false; };
  // Merge adjacent fragments so variables spanning characters expand together.
  const char = (text: string, expand: boolean) => {
    if (word.length && word[word.length - 1].expand === expand) word[word.length - 1].text += text;
    else add(text, expand);
    started = true;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote === "'") { if (c === quote) quote = ''; else char(c, false); continue; }
    if (c === '\\') {
      if (i + 1 === source.length) throw new Error('trailing escape');
      const next = source[++i];
      if (next === '\n') continue;
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) char('\\', false);
      char(next, false); continue;
    }
    if (c === '`' || (c === '$' && source[i + 1] === '(')) throw new Error('command substitution is not supported by qsh');
    if (quote === '"') { if (c === quote) { quote = ''; add('', true); } else char(c, true); continue; }
    if (c === '"' || c === "'") { quote = c; started = true; add('', c === '"'); continue; }
    if (c === '#' && !started) { while (i < source.length && source[i] !== '\n') i++; if (i === source.length) break; }
    const token = source[i];
    if (token === '\n' || token === ';' || /[|&<>]/.test(token)) {
      flush();
      let op = token === '\n' ? ';' : token;
      if (['&', '|', '>'].includes(token) && source[i + 1] === token) { op += token; i++; }
      if (op === '&') throw new Error('background jobs (&) are unsupported; use spawn / sched');
      tokens.push({ op });
    } else if (/\s/.test(token)) flush();
    else char(token, true);
  }
  if (quote) throw new Error('unterminated quote');
  flush();
  const result: Pipeline[] = [];
  let current: Pipeline = { commands: [], when: ';' };
  let cmd: Command = { words: [], redirects: [] };
  const finishCommand = () => {
    if (!cmd.words.length) throw new Error('missing command');
    current.commands.push(cmd); cmd = { words: [], redirects: [] };
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ('word' in t) { cmd.words.push(t.word); continue; }
    if (['>', '>>', '<'].includes(t.op)) {
      const target = tokens[++i];
      if (!target || !('word' in target)) throw new Error('missing redirection path');
      cmd.redirects.push({ op: t.op, path: target.word }); continue;
    }
    if (t.op === ';' && !cmd.words.length && !current.commands.length) continue;
    finishCommand();
    if (t.op === '|') continue;
    result.push(current);
    current = { commands: [], when: t.op as Pipeline['when'] };
  }
  if (cmd.words.length) { finishCommand(); result.push(current); }
  else if (current.commands.length || current.when !== ';' || cmd.redirects.length) throw new Error('incomplete command');
  return result;
}
