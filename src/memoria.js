// Alocação contígua de memória: first, best, worst e next fit.
//   - Partições variáveis (split = true): o processo ocupa o começo da lacuna e o resto vira
//     uma lacuna menor; ao liberar, lacunas vizinhas se juntam (coalescência).
//   - Partições fixas (split = false): cada partição recebe um processo inteiro e a sobra
//     dentro dela é fragmentação interna.
// Entre as partições iniciais há uma "barreira" (memória de outro dono), então lacunas de
// partições diferentes nunca se juntam.

export const FIT_ALGORITHMS = Object.freeze({
  first: 'First fit',
  best: 'Best fit',
  worst: 'Worst fit',
  next: 'Next fit',
});

export class MemoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MemoryError';
  }
}

/** Lê tamanhos como "100, 500, 200" ou "100 500 200". */
export function parseSizes(text) {
  const tokens = String(text).trim().split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) throw new MemoryError('Informe os tamanhos das partições.');
  if (tokens.length > 30) throw new MemoryError('Use no máximo 30 partições.');
  return tokens.map((t) => {
    if (!/^\d+$/.test(t) || Number(t) < 1) throw new MemoryError(`"${t}" não é um tamanho válido (inteiro positivo).`);
    return Number(t);
  });
}

/**
 * Operações, uma por linha:
 *   P1 212       aloca 212 unidades para P1 (também "P1: 212" ou "P1 = 212 KB")
 *   liberar P1   libera (também "-P1", "free P1" ou "sai P1")
 */
export function parseOperations(text) {
  const ops = [];
  String(text).split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const free = /^(?:(?:liberar|libera|free|sai)\s+|-\s*)([A-Za-z_]\w*)$/i.exec(line);
    if (free) {
      ops.push({ type: 'free', name: free[1], line: idx + 1 });
      return;
    }
    const alloc = /^([A-Za-z_]\w*)(?:\s+|\s*[:=]\s*)(\d+)\s*(?:kb|k|b|mb)?$/i.exec(line);
    if (!alloc) throw new MemoryError(`Linha ${idx + 1}: não entendi "${line}". Use "P1 212" para alocar e "liberar P1" para liberar.`);
    const size = Number(alloc[2]);
    if (size < 1) throw new MemoryError(`Linha ${idx + 1}: o tamanho precisa ser positivo.`);
    ops.push({ type: 'alloc', name: alloc[1], size, line: idx + 1 });
  });
  if (ops.length === 0) throw new MemoryError('Informe pelo menos uma operação (por exemplo, "P1 212").');
  if (ops.length > 60) throw new MemoryError('Use no máximo 60 operações.');
  return ops;
}

function initialLayout({ partitions, total }) {
  if (partitions) {
    const segs = [];
    let at = 0;
    partitions.forEach((size, i) => {
      if (i > 0) segs.push({ kind: 'barrier', start: at, size: 0 });
      segs.push({ kind: 'free', start: at, size, partition: i });
      at += size;
    });
    return segs;
  }
  if (!Number.isInteger(total) || total < 1) throw new MemoryError('O tamanho total precisa ser um inteiro positivo.');
  return [{ kind: 'free', start: 0, size: total, partition: 0 }];
}

const clone = (segs) => segs.map((s) => ({ ...s }));

/** Junta lacunas livres vizinhas (sem barreira entre elas). */
function coalesce(segs) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.kind === 'free' && s.kind === 'free' && last.start + last.size === s.start) {
      last.size += s.size;
    } else out.push({ ...s });
  }
  return out;
}

/** Estatísticas: livre total, maior lacuna, fragmentação externa (1 - maior/livre) e interna. */
export function memoryStats(segs) {
  const holes = segs.filter((s) => s.kind === 'free');
  const totalFree = holes.reduce((a, h) => a + h.size, 0);
  const largest = holes.reduce((a, h) => Math.max(a, h.size), 0);
  const used = segs.filter((s) => s.kind === 'used');
  const internal = used.reduce((a, s) => a + (s.size - s.request), 0);
  return {
    totalFree,
    largestHole: largest,
    holes: holes.length,
    externalFragmentation: totalFree ? 1 - largest / totalFree : 0,
    internalFragmentation: internal,
    usedSize: used.reduce((a, s) => a + s.request, 0),
  };
}

/** Escolhe a lacuna conforme o algoritmo. `holes` está em ordem de endereço. */
function pick(holes, size, algorithm, nextPos) {
  const fits = holes.filter((h) => h.size >= size);
  if (fits.length === 0) return null;
  if (algorithm === 'first') return fits[0];
  if (algorithm === 'best') return fits.reduce((a, h) => (h.size < a.size ? h : a));
  if (algorithm === 'worst') return fits.reduce((a, h) => (h.size > a.size ? h : a));
  // next fit: começa na lacuna que contém (ou vem depois de) onde parou a última alocação
  let i0 = holes.findIndex((h) => h.start + h.size > nextPos);
  if (i0 === -1) i0 = 0;
  for (let k = 0; k < holes.length; k++) {
    const h = holes[(i0 + k) % holes.length];
    if (h.size >= size) return h;
  }
  return null;
}

/**
 * Executa as operações. Cada passo traz a operação, as lacunas avaliadas, a escolha,
 * a memória depois do passo e um texto explicando a decisão.
 */
export function simulateMemory({ partitions = null, total = null, ops, algorithm, split = true }) {
  if (!FIT_ALGORITHMS[algorithm]) throw new MemoryError(`Algoritmo desconhecido: ${algorithm}.`);
  if (!partitions && !split) throw new MemoryError('Partições fixas precisam de uma lista de partições.');
  let segs = initialLayout({ partitions, total });
  const steps = [];
  const failed = [];
  let nextPos = 0;
  for (const op of ops) {
    if (op.type === 'free') {
      const idx = segs.findIndex((s) => s.kind === 'used' && s.name === op.name);
      if (idx === -1) {
        steps.push({ op, ok: false, layout: clone(segs), text: `${op.name} não está na memória: nada a liberar.` });
        continue;
      }
      const seg = segs[idx];
      segs[idx] = { kind: 'free', start: seg.start, size: seg.size, partition: seg.partition };
      const before = segs.length;
      if (split) segs = coalesce(segs);
      const merged = segs.length < before;
      steps.push({ op, ok: true, layout: clone(segs), text: `${op.name} sai e libera ${seg.size}${merged ? '; a lacuna se junta às vizinhas livres' : ''}.` });
      continue;
    }
    if (segs.some((s) => s.kind === 'used' && s.name === op.name)) {
      steps.push({ op, ok: false, layout: clone(segs), text: `${op.name} já está na memória.` });
      continue;
    }
    const holes = segs.filter((s) => s.kind === 'free');
    const candidates = holes.map((h) => ({ start: h.start, size: h.size, fits: h.size >= op.size }));
    const chosen = pick(holes, op.size, algorithm, nextPos);
    if (!chosen) {
      const st = memoryStats(segs);
      const external = split && st.totalFree >= op.size;
      const why = external
        ? `por fragmentação externa (há ${st.totalFree} livres no total, mas a maior lacuna tem ${st.largestHole})`
        : split ? `(só há ${st.totalFree} livres)` : '(nenhuma partição livre é grande o bastante)';
      failed.push(op.name);
      steps.push({ op, ok: false, external, candidates, layout: clone(segs), text: `${op.name} (${op.size}) não coube ${why} e não foi alocado.` });
      continue;
    }
    const idx = segs.indexOf(chosen);
    const left = chosen.size - op.size;
    if (split) {
      const parts = [{ kind: 'used', start: chosen.start, size: op.size, request: op.size, name: op.name, partition: chosen.partition }];
      if (left > 0) parts.push({ kind: 'free', start: chosen.start + op.size, size: left, partition: chosen.partition });
      segs.splice(idx, 1, ...parts);
      nextPos = chosen.start + op.size;
    } else {
      segs[idx] = { kind: 'used', start: chosen.start, size: chosen.size, request: op.size, name: op.name, partition: chosen.partition };
      nextPos = chosen.start + chosen.size;
    }
    const why = {
      first: 'primeira lacuna, em ordem de endereço, onde cabe',
      best: 'menor lacuna onde cabe',
      worst: 'maior lacuna disponível',
      next: 'primeira onde cabe, a partir de onde parou a última alocação',
    }[algorithm];
    const rest = split
      ? (left > 0 ? `sobra uma lacuna de ${left}` : 'a lacuna é ocupada inteira')
      : (left > 0 ? `fragmentação interna de ${left}` : 'sem sobra');
    steps.push({
      op,
      ok: true,
      candidates,
      chosenStart: chosen.start,
      chosenSize: chosen.size,
      layout: clone(segs),
      text: `${op.name} (${op.size}) vai para a lacuna de ${chosen.size} no endereço ${chosen.start} (${why}); ${rest}.`,
    });
  }
  return { algorithm, split, steps, layout: segs, stats: memoryStats(segs), failed };
}

/** Roda os quatro algoritmos com a mesma entrada. */
export function compareFits(input) {
  return Object.keys(FIT_ALGORITHMS).map((algorithm) => simulateMemory({ ...input, algorithm }));
}
