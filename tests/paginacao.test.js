import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BELADY_STRING, SILBERSCHATZ_STRING, beladyPoints, faultCurve, parseReferenceString, simulatePaging,
} from '../src/paginacao.js';

const frames = (r) => r.steps.map((s) => s.frames.map((x) => (x === null ? '_' : x)).join('')).join(' ');
const faults = (refs, n, alg) => simulatePaging(refs, n, alg).faults;

test('sequência clássica com 3 quadros: FIFO 15, LRU 12, OPT 9', () => {
  const S = SILBERSCHATZ_STRING;
  const fifo = simulatePaging(S, 3, 'fifo');
  assert.equal(fifo.faults, 15);
  assert.equal(fifo.hits, 5);
  // estado depois de cada referência, como na figura do livro
  assert.equal(frames(fifo), '7__ 70_ 701 201 201 231 230 430 420 423 023 023 023 013 012 012 012 712 702 701');
  assert.equal(faults(S, 3, 'lru'), 12);
  assert.equal(faults(S, 3, 'opt'), 9);
  assert.equal(frames(simulatePaging(S, 3, 'opt')).split(' ').pop(), '701');
});

test('relógio (segunda chance) com 3 quadros: 14 faltas (calculado à mão)', () => {
  // bit 1 ao carregar e a cada acerto; o ponteiro limpa bits 1 até achar um 0
  const r = simulatePaging(SILBERSCHATZ_STRING, 3, 'clock');
  assert.equal(r.faults, 14);
  assert.equal(frames(r), '7__ 70_ 701 201 201 203 203 403 423 423 420 320 320 310 312 012 012 072 072 071');
  // depois da 4ª referência (página 2): todos os bits foram limpos e 7 saiu
  assert.deepEqual(r.steps[3].bits, [1, 0, 0]);
  assert.equal(r.steps[3].evicted, 7);
  assert.equal(r.steps[3].hand, 1);
  // acerto só liga o bit
  assert.equal(r.steps[4].fault, false);
  assert.deepEqual(r.steps[4].bits, [1, 1, 0]);
});

test('anomalia de Belady: FIFO dá 9 faltas com 3 quadros e 10 com 4', () => {
  assert.deepEqual([...BELADY_STRING], [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]);
  assert.equal(faults(BELADY_STRING, 3, 'fifo'), 9);
  assert.equal(faults(BELADY_STRING, 4, 'fifo'), 10);
  const curve = faultCurve(BELADY_STRING, 5);
  assert.deepEqual(curve.fifo, [12, 12, 9, 10, 5]);
  assert.deepEqual(beladyPoints(curve.fifo), [{ from: 3, to: 4, faults: [9, 10] }]);
  assert.deepEqual(beladyPoints(curve.lru), []);
  assert.deepEqual(beladyPoints(curve.opt), []);
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

test('OPT nunca perde para os outros; LRU e OPT não têm anomalia (aleatório)', () => {
  const rand = rng(11);
  for (let k = 0; k < 150; k++) {
    const len = 5 + Math.floor(rand() * 30);
    const pages = 2 + Math.floor(rand() * 7);
    const refs = Array.from({ length: len }, () => Math.floor(rand() * pages));
    const distinct = new Set(refs).size;
    const curve = faultCurve(refs, distinct + 1);
    for (let f = 0; f < curve.fifo.length; f++) {
      for (const alg of ['fifo', 'lru', 'clock']) assert.ok(curve.opt[f] <= curve[alg][f], `OPT ≤ ${alg}`);
      for (const alg of ['fifo', 'lru', 'opt', 'clock']) assert.ok(curve[alg][f] >= distinct, 'falta obrigatória na 1ª vez de cada página');
    }
    assert.deepEqual(beladyPoints(curve.lru), [], 'LRU é algoritmo de pilha');
    assert.deepEqual(beladyPoints(curve.opt), [], 'OPT é algoritmo de pilha');
    // com quadros suficientes para todas as páginas, só sobram as faltas obrigatórias
    for (const alg of ['fifo', 'lru', 'opt', 'clock']) assert.equal(curve[alg][distinct - 1], distinct);
  }
});

test('com 1 quadro, falta sempre que a página muda', () => {
  const refs = [1, 1, 2, 2, 1, 3, 3, 3, 1];
  const changes = refs.filter((p, i) => i === 0 || p !== refs[i - 1]).length;
  for (const alg of ['fifo', 'lru', 'opt', 'clock']) assert.equal(faults(refs, 1, alg), changes);
});

test('passos explicam a decisão', () => {
  const r = simulatePaging([1, 2, 3, 1, 4], 3, 'lru');
  assert.match(r.steps[0].note, /quadro livre 1/);
  assert.match(r.steps[3].note, /acerto/);
  assert.match(r.steps[4].note, /sai 2, a usada há mais tempo/);
  const o = simulatePaging([1, 2, 3, 4, 1, 2], 3, 'opt');
  assert.match(o.steps[3].note, /sai 3, que não será mais usada/);
});

test('leitura da sequência de referências', () => {
  assert.deepEqual(parseReferenceString('7 0 1, 2;3'), [7, 0, 1, 2, 3]);
  assert.deepEqual(parseReferenceString('1-2-3'), [1, 2, 3]);
  assert.throws(() => parseReferenceString('  '), /Digite/);
  assert.throws(() => parseReferenceString('1 a 2'), /"a"/);
  assert.throws(() => parseReferenceString('1 2.5'), /válido/);
  assert.throws(() => simulatePaging([1], 0, 'fifo'), /1 a 12/);
  assert.throws(() => simulatePaging([1], 2, 'mru'), /desconhecido/);
});
