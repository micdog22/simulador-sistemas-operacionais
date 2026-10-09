// Substituição de páginas: FIFO, LRU, OPT (ótimo) e Relógio (segunda chance).
// Os quadros são posições fixas; numa falta com quadro livre, ocupa o primeiro livre.

export const PAGE_ALGORITHMS = Object.freeze({
  fifo: 'FIFO',
  lru: 'LRU',
  opt: 'OPT (ótimo)',
  clock: 'Relógio (segunda chance)',
});

export const BELADY_STRING = Object.freeze([1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]);
export const SILBERSCHATZ_STRING = Object.freeze([7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1]);

export class PagingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PagingError';
  }
}

/** Lê "7 0 1 2", "7,0,1,2" ou "7-0-1" como lista de páginas (inteiros não negativos). */
export function parseReferenceString(text) {
  const tokens = String(text).trim().split(/[\s,;-]+/).filter(Boolean);
  if (tokens.length === 0) throw new PagingError('Digite a sequência de referências (números de página).');
  if (tokens.length > 200) throw new PagingError('Use no máximo 200 referências.');
  return tokens.map((t) => {
    if (!/^\d+$/.test(t)) throw new PagingError(`"${t}" não é um número de página válido.`);
    const n = Number(t);
    if (n > 9999) throw new PagingError(`Página ${t} grande demais (máximo 9999).`);
    return n;
  });
}

/**
 * Simula a sequência e devolve o estado dos quadros depois de cada referência.
 * Cada passo: { ref, frames, fault, evicted, slot, hand, bits, note }.
 */
export function simulatePaging(refs, frameCount, algorithm) {
  if (!PAGE_ALGORITHMS[algorithm]) throw new PagingError(`Algoritmo desconhecido: ${algorithm}.`);
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 12) throw new PagingError('Use de 1 a 12 quadros.');
  const frames = new Array(frameCount).fill(null);
  const loadedAt = new Array(frameCount).fill(-1);
  const lastUse = new Array(frameCount).fill(-1);
  const bits = new Array(frameCount).fill(0);
  let hand = 0;
  const steps = [];
  let faults = 0;

  refs.forEach((page, t) => {
    const slot = frames.indexOf(page);
    if (slot !== -1) {
      lastUse[slot] = t;
      let note = `Página ${page} já está no quadro ${slot + 1}: acerto.`;
      if (algorithm === 'clock') {
        note += bits[slot] ? ' O bit de referência já era 1.' : ' O bit de referência volta a 1.';
        bits[slot] = 1;
      }
      if (algorithm === 'lru') note += ' Ela passa a ser a usada mais recentemente.';
      steps.push({ ref: page, frames: frames.slice(), fault: false, evicted: null, slot, hand, bits: bits.slice(), note });
      return;
    }
    faults++;
    let victim = frames.indexOf(null);
    let evicted = null;
    let note;
    if (victim !== -1) {
      note = `Falta de página: ${page} vai para o quadro livre ${victim + 1}.`;
      if (algorithm === 'clock') hand = (victim + 1) % frameCount;
    } else if (algorithm === 'fifo') {
      victim = argMin(loadedAt);
      note = `Falta de página: sai ${frames[victim]}, a que está há mais tempo na memória (entrou na referência ${loadedAt[victim] + 1}).`;
    } else if (algorithm === 'lru') {
      victim = argMin(lastUse);
      note = `Falta de página: sai ${frames[victim]}, a usada há mais tempo (última vez na referência ${lastUse[victim] + 1}).`;
    } else if (algorithm === 'opt') {
      const nextUse = frames.map((p) => {
        const k = refs.indexOf(p, t + 1);
        return k === -1 ? Infinity : k;
      });
      const far = Math.max(...nextUse);
      // empate (várias nunca mais usadas): sai a que entrou primeiro
      const tied = nextUse.map((v, i) => (v === far ? i : -1)).filter((i) => i >= 0);
      victim = tied.reduce((a, b) => (loadedAt[b] < loadedAt[a] ? b : a));
      note = far === Infinity
        ? `Falta de página: sai ${frames[victim]}, que não será mais usada.`
        : `Falta de página: sai ${frames[victim]}, cujo próximo uso (referência ${far + 1}) é o mais distante.`;
    } else {
      const cleared = [];
      while (bits[hand] === 1) {
        bits[hand] = 0;
        cleared.push(frames[hand]);
        hand = (hand + 1) % frameCount;
      }
      victim = hand;
      hand = (hand + 1) % frameCount;
      note = `Falta de página: ${cleared.length ? `o ponteiro dá segunda chance a ${cleared.join(', ')} (bit 1 vira 0) e ` : 'o ponteiro '}encontra ${frames[victim]} com bit 0, que sai.`;
    }
    if (frames[victim] !== null) evicted = frames[victim];
    frames[victim] = page;
    loadedAt[victim] = t;
    lastUse[victim] = t;
    bits[victim] = 1;
    steps.push({ ref: page, frames: frames.slice(), fault: true, evicted, slot: victim, hand, bits: bits.slice(), note });
  });
  return {
    algorithm,
    frameCount,
    steps,
    faults,
    hits: refs.length - faults,
    faultRate: refs.length ? faults / refs.length : 0,
  };
}

function argMin(arr) {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] < arr[best]) best = i;
  return best;
}

/** Faltas de cada algoritmo para 1, 2, ..., maxFrames quadros (curva usada no gráfico). */
export function faultCurve(refs, maxFrames) {
  const out = {};
  for (const alg of Object.keys(PAGE_ALGORITHMS)) {
    out[alg] = [];
    for (let f = 1; f <= maxFrames; f++) out[alg].push(simulatePaging(refs, f, alg).faults);
  }
  return out;
}

/** Pontos em que mais quadros deram mais faltas (anomalia de Belady). */
export function beladyPoints(curve) {
  const pts = [];
  for (let i = 1; i < curve.length; i++) if (curve[i] > curve[i - 1]) pts.push({ from: i, to: i + 1, faults: [curve[i - 1], curve[i]] });
  return pts;
}
