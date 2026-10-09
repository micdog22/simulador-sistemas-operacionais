import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareFits, memoryStats, parseOperations, parseSizes, simulateMemory,
} from '../src/memoria.js';

const BOOK = { partitions: [100, 500, 200, 300, 600], ops: parseOperations('P1 212\nP2 417\nP3 112\nP4 426') };
const choices = (r) => r.steps.map((s) => (s.ok ? `${s.chosenSize}->${s.chosenSize - s.op.size}` : 'X'));

test('exemplo do livro, partições variáveis (calculado à mão)', () => {
  // first: 212 na de 500 (sobra 288), 417 na de 600 (183), 112 na sobra de 288 (176), 426 não cabe
  assert.deepEqual(choices(simulateMemory({ ...BOOK, algorithm: 'first' })), ['500->288', '600->183', '288->176', 'X']);
  // best: 300 (88), 500 (83), 200 (88), 600 (174): todos cabem
  assert.deepEqual(choices(simulateMemory({ ...BOOK, algorithm: 'best' })), ['300->88', '500->83', '200->88', '600->174']);
  // worst: 600 (388), 500 (83), 388 (276), 426 não cabe
  assert.deepEqual(choices(simulateMemory({ ...BOOK, algorithm: 'worst' })), ['600->388', '500->83', '388->276', 'X']);
  // next: 500 (288), continua: 600 (183), continua na sobra de 183 (71), 426 não cabe
  assert.deepEqual(choices(simulateMemory({ ...BOOK, algorithm: 'next' })), ['500->288', '600->183', '183->71', 'X']);
  const first = simulateMemory({ ...BOOK, algorithm: 'first' });
  assert.deepEqual(first.failed, ['P4']);
  assert.equal(first.steps[3].external, true);
  assert.match(first.steps[3].text, /fragmentação externa \(há 959 livres no total, mas a maior lacuna tem 300\)/);
  assert.deepEqual(first.stats, {
    totalFree: 959, largestHole: 300, holes: 5, externalFragmentation: 1 - 300 / 959, internalFragmentation: 0, usedSize: 741,
  });
});

test('exemplo do livro, partições fixas: fragmentação interna', () => {
  const fixed = { ...BOOK, split: false };
  const sizes = (alg) => simulateMemory({ ...fixed, algorithm: alg }).steps.map((s) => (s.ok ? s.chosenSize : 'X'));
  assert.deepEqual(sizes('first'), [500, 600, 200, 'X']);
  assert.deepEqual(sizes('best'), [300, 500, 200, 600]);
  assert.deepEqual(sizes('worst'), [600, 500, 300, 'X']);
  assert.deepEqual(sizes('next'), [500, 600, 200, 'X']);
  // 288 + 183 + 88 = 559 de sobra dentro das partições no first fit
  assert.equal(simulateMemory({ ...fixed, algorithm: 'first' }).stats.internalFragmentation, 559);
  assert.equal(simulateMemory({ ...fixed, algorithm: 'best' }).stats.internalFragmentation, 88 + 83 + 88 + 174);
  assert.equal(simulateMemory({ ...fixed, algorithm: 'worst' }).stats.internalFragmentation, 388 + 83 + 188);
  assert.throws(() => simulateMemory({ total: 100, ops: [], algorithm: 'first', split: false }), /Partições fixas/);
});

test('liberações juntam lacunas e expõem a fragmentação externa', () => {
  const ops = parseOperations('P1 300\nP2 200\nP3 250\nP4 150\nliberar P2\nliberar P4\nP5 320\nP6 100');
  const r = simulateMemory({ total: 1000, ops, algorithm: 'first' });
  // P4 sai e a lacuna dele se junta aos 100 livres do fim: 250 contínuos
  const afterFree = r.steps[5].layout.filter((s) => s.kind === 'free').map((s) => [s.start, s.size]);
  assert.deepEqual(afterFree, [[300, 200], [750, 250]]);
  assert.equal(r.steps[6].ok, false);
  assert.equal(r.steps[6].external, true, 'há 450 livres, mas nenhuma lacuna de 320');
  assert.equal(r.steps[7].chosenStart, 300);
  assert.deepEqual(r.failed, ['P5']);
  assert.equal(r.stats.totalFree, 350);
  assert.equal(r.stats.largestHole, 250);
  assert.ok(Math.abs(r.stats.externalFragmentation - (1 - 250 / 350)) < 1e-12);
});

test('next fit continua de onde parou; first fit volta ao começo', () => {
  const ops = parseOperations('P1 100\nP2 100\nliberar P1\nP3 50');
  const next = simulateMemory({ total: 1000, ops, algorithm: 'next' });
  const first = simulateMemory({ total: 1000, ops, algorithm: 'first' });
  assert.equal(next.steps[3].chosenStart, 200);
  assert.equal(first.steps[3].chosenStart, 0);
});

test('operações inválidas não quebram a simulação', () => {
  const r = simulateMemory({ total: 100, ops: parseOperations('P1 50\nP1 10\nliberar P9\n-P1'), algorithm: 'best' });
  assert.deepEqual(r.steps.map((s) => s.ok), [true, false, false, true]);
  assert.match(r.steps[1].text, /já está na memória/);
  assert.match(r.steps[2].text, /não está na memória/);
  assert.deepEqual(r.layout, [{ kind: 'free', start: 0, size: 100, partition: 0 }]);
});

test('leitura das operações e dos tamanhos', () => {
  assert.deepEqual(parseOperations('P1 212\nP2: 100 KB\n# comentário\nliberar P1\nfree P2\n-P3\nsai P4'), [
    { type: 'alloc', name: 'P1', size: 212, line: 1 },
    { type: 'alloc', name: 'P2', size: 100, line: 2 },
    { type: 'free', name: 'P1', line: 4 },
    { type: 'free', name: 'P2', line: 5 },
    { type: 'free', name: 'P3', line: 6 },
    { type: 'free', name: 'P4', line: 7 },
  ]);
  assert.throws(() => parseOperations('P1'), /não entendi/);
  assert.throws(() => parseOperations('P1 0'), /positivo/);
  assert.throws(() => parseOperations('\n\n'), /pelo menos uma/);
  assert.deepEqual(parseSizes('100, 500 200;300'), [100, 500, 200, 300]);
  assert.throws(() => parseSizes('100, -5'), /válido/);
  assert.throws(() => parseSizes(''), /Informe/);
});

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('invariantes com operações aleatórias (semente fixa)', () => {
  const rand = rng(5);
  for (let k = 0; k < 80; k++) {
    const usePartitions = k % 2 === 0;
    const parts = Array.from({ length: 3 + Math.floor(rand() * 5) }, () => 50 + Math.floor(rand() * 400));
    const total = 1000;
    const lines = [];
    const live = [];
    for (let i = 0; i < 25; i++) {
      if (live.length && rand() < 0.35) {
        const j = Math.floor(rand() * live.length);
        lines.push(`liberar ${live[j]}`);
        live.splice(j, 1);
      } else {
        const name = `P${i}`;
        lines.push(`${name} ${10 + Math.floor(rand() * 300)}`);
        live.push(name);
      }
    }
    const input = usePartitions ? { partitions: parts, ops: parseOperations(lines.join('\n')) } : { total, ops: parseOperations(lines.join('\n')) };
    const memSize = usePartitions ? parts.reduce((a, b) => a + b, 0) : total;
    for (const split of usePartitions ? [true, false] : [true]) {
      for (const r of compareFits({ ...input, split })) {
        for (const step of r.steps) {
          const segs = step.layout;
          // tudo somado dá o tamanho da memória, sem buracos nem sobreposição
          assert.equal(segs.reduce((a, s) => a + s.size, 0), memSize);
          let at = 0;
          for (const s of segs) {
            assert.equal(s.start, at);
            at += s.size;
          }
          // com divisão, nunca sobram duas lacunas livres encostadas
          if (split) for (let i = 1; i < segs.length; i++) assert.ok(!(segs[i].kind === 'free' && segs[i - 1].kind === 'free'));
          const st = memoryStats(segs);
          assert.ok(st.externalFragmentation >= 0 && st.externalFragmentation < 1);
        }
      }
    }
  }
});

test('palavras de liberar pedem um nome separado por espaço', () => {
  assert.throws(() => parseOperations('liberar'), /não entendi/);
  assert.deepEqual(parseOperations('-P1'), [{ type: 'free', name: 'P1', line: 1 }]);
  assert.deepEqual(parseOperations('liberar P1')[0].type, 'free');
});

test('a mensagem de liberação só fala em junção quando ela acontece', () => {
  const r = simulateMemory({ total: 300, ops: parseOperations('P1 100\nP2 100\nP3 100\nliberar P2\nliberar P1'), algorithm: 'first' });
  assert.ok(!/se junta/.test(r.steps[3].text), 'P2 sai entre dois ocupados');
  assert.match(r.steps[4].text, /se junta às vizinhas livres/);
  const fail = simulateMemory({ total: 100, ops: parseOperations('P1 200'), algorithm: 'first' });
  assert.match(fail.steps[0].text, /não foi alocado/);
});
