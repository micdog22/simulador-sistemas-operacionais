import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableFromTotal, bankState, detectDeadlock, findCycles, isSafeSequence, parseGraph, requestResources, safety,
} from '../src/deadlock.js';

// Exemplo clássico do banqueiro: 5 processos, recursos A (10), B (5) e C (7).
const CLASSIC = {
  allocation: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
  max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
  available: [3, 3, 2],
};

test('banqueiro clássico: Need e sequência segura P1, P3, P4, P0, P2', () => {
  const st = bankState(CLASSIC);
  assert.deepEqual(st.need, [[7, 4, 3], [1, 2, 2], [6, 0, 0], [0, 1, 1], [4, 3, 1]]);
  const res = safety(st);
  assert.equal(res.safe, true);
  assert.deepEqual(res.sequence, [1, 3, 4, 0, 2]);
  assert.deepEqual(res.work, [10, 5, 7]);
  // duas varreduras: na primeira passam P1, P3 e P4; na segunda, P0 e P2
  assert.deepEqual(res.steps.filter((s) => s.fits).map((s) => [s.pass, s.process]), [[1, 1], [1, 3], [1, 4], [2, 0], [2, 2]]);
  // a sequência do livro também é segura; uma ordem qualquer não
  assert.equal(isSafeSequence(st, [1, 3, 4, 2, 0]), true);
  assert.equal(isSafeSequence(st, [0, 1, 2, 3, 4]), false);
  assert.equal(isSafeSequence(st, [1, 3, 4, 0]), false);
});

test('disponível a partir do total', () => {
  assert.deepEqual(availableFromTotal([10, 5, 7], CLASSIC.allocation), [3, 3, 2]);
  assert.throws(() => availableFromTotal([5, 5, 7], CLASSIC.allocation), /mais que o total/);
});

test('pedidos: P1 (1, 0, 2) é concedido; depois P4 (3, 3, 0) espera e P0 (0, 2, 0) é negado', () => {
  const st = bankState(CLASSIC);
  const r1 = requestResources(st, 1, [1, 0, 2]);
  assert.equal(r1.granted, true);
  assert.deepEqual(r1.trial.available, [2, 3, 0]);
  assert.deepEqual(r1.trial.allocation[1], [3, 0, 2]);
  assert.deepEqual(r1.trial.need[1], [0, 2, 0]);
  assert.deepEqual(r1.safety.sequence, [1, 3, 4, 0, 2]);
  const after = { ...st, ...r1.trial };
  const r4 = requestResources(after, 4, [3, 3, 0]);
  assert.equal(r4.granted, false);
  assert.equal(r4.reason, 'espera');
  const r0 = requestResources(after, 0, [0, 2, 0]);
  assert.equal(r0.granted, false);
  assert.equal(r0.reason, 'inseguro');
  assert.equal(r0.safety.safe, false);
  const tooMuch = requestResources(st, 3, [1, 0, 0]);
  assert.equal(tooMuch.reason, 'excede');
});

test('estado inseguro e validação', () => {
  const st = bankState({ allocation: [[1, 0], [0, 1]], max: [[2, 1], [1, 2]], available: [0, 0] });
  const res = safety(st);
  assert.equal(res.safe, false);
  assert.deepEqual(res.sequence, []);
  assert.throws(() => bankState({ allocation: [[3]], max: [[2]], available: [0] }), /mais do recurso A/);
  assert.throws(() => bankState({ allocation: [[1, 2]], max: [[2]], available: [0] }), /esperava 1 valor\./);
  assert.throws(() => bankState({ allocation: [[1]], max: [[2]], available: [-1] }), /não negativos/);
  assert.throws(() => requestResources(st, 0, [1]), /2 inteiros/);
});

test('leitura do grafo de alocação de recursos', () => {
  const g = parseGraph('# comentário\nR2: 2\nP1 -> R1\nR1 -> P2\nR2 -> P1 x2\nP2 → R2');
  assert.deepEqual(g.processes, ['P1', 'P2']);
  assert.deepEqual(g.resources, ['R2', 'R1']);
  assert.equal(g.instances.get('R2'), 2);
  assert.equal(g.instances.get('R1'), 1);
  assert.deepEqual(g.edges.find((e) => e.from === 'R2'), { from: 'R2', to: 'P1', count: 2, kind: 'atribuicao' });
  assert.throws(() => parseGraph('P1 -> P2'), /processo e recurso/);
  assert.throws(() => parseGraph('X -> P1'), /Não sei se X/);
  assert.throws(() => parseGraph('R1: 1\nR1 -> P1\nR1 -> P2'), /1 instância, mas 2/);
  assert.throws(() => parseGraph('P1 => R1'), /não entendi/);
  assert.throws(() => parseGraph('R1: 0'), /1 a 20/);
});

test('ciclos: nenhum, um e dois', () => {
  assert.deepEqual(findCycles(parseGraph('R1 -> P1\nP2 -> R1\nR2 -> P2')), []);
  assert.deepEqual(findCycles(parseGraph('R1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1')), [['P1', 'R2', 'P2', 'R1']]);
  // grafo com deadlock do livro: dois ciclos
  const g = parseGraph('R2: 2\nP1 -> R1\nR1 -> P2\nP2 -> R3\nR3 -> P3\nP3 -> R2\nR2 -> P1\nR2 -> P2');
  const cycles = findCycles(g).map((c) => c.join(' '));
  assert.deepEqual(cycles.sort(), ['P1 R1 P2 R3 P3 R2', 'P2 R3 P3 R2']);
});

test('instância única: ciclo é deadlock', () => {
  const d = detectDeadlock(parseGraph('R1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1'));
  assert.equal(d.singleInstance, true);
  assert.deepEqual(d.deadlocked, ['P1', 'P2']);
  assert.equal(d.cycles.length, 1);
});

test('várias instâncias: ciclo sem deadlock', () => {
  const g = parseGraph('R1: 2\nR2: 2\nP1 -> R1\nR1 -> P2\nR1 -> P3\nP3 -> R2\nR2 -> P1\nR2 -> P4');
  const d = detectDeadlock(g);
  assert.equal(d.cycles.length, 1);
  assert.deepEqual(d.deadlocked, []);
  assert.deepEqual(d.sequence.map((i) => g.processes[i]), ['P2', 'P4', 'P1', 'P3']);
});

test('grafo do livro com dois ciclos: P1, P2 e P3 em deadlock', () => {
  const d = detectDeadlock(parseGraph('R2: 2\nP1 -> R1\nR1 -> P2\nP2 -> R3\nR3 -> P3\nP3 -> R2\nR2 -> P1\nR2 -> P2'));
  assert.deepEqual(d.deadlocked, ['P1', 'P2', 'P3']);
});

test('algoritmo de detecção do livro (A = 7, B = 2, C = 6)', () => {
  const text = [
    'A: 7', 'B: 2', 'C: 6',
    'B -> P0',
    'A -> P1 x2',
    'A -> P2 x3', 'C -> P2 x3',
    'A -> P3 x2', 'B -> P3', 'C -> P3',
    'C -> P4 x2',
    'P1 -> A x2', 'P1 -> C x2',
    'P3 -> A',
    'P4 -> C x2',
  ].join('\n');
  const g = parseGraph(text);
  assert.deepEqual(g.processes, ['P0', 'P1', 'P2', 'P3', 'P4']);
  const d = detectDeadlock(g);
  assert.deepEqual(d.available, [0, 0, 0]);
  assert.deepEqual(d.allocation, [[0, 1, 0], [2, 0, 0], [3, 0, 3], [2, 1, 1], [0, 0, 2]]);
  assert.deepEqual(d.request, [[0, 0, 0], [2, 0, 2], [0, 0, 0], [1, 0, 0], [0, 0, 2]]);
  assert.deepEqual(d.deadlocked, []);
  assert.deepEqual(d.sequence.map((i) => g.processes[i]), ['P0', 'P2', 'P3', 'P4', 'P1']);
  // se P2 pedir mais uma instância de C, P1, P2, P3 e P4 ficam em deadlock
  const d2 = detectDeadlock(parseGraph(`${text}\nP2 -> C`));
  assert.deepEqual(d2.deadlocked, ['P1', 'P2', 'P3', 'P4']);
});

test('quem não segura recurso não entra no deadlock', () => {
  const d = detectDeadlock(parseGraph('R1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1\nP3 -> R1'));
  assert.deepEqual(d.deadlocked, ['P1', 'P2']);
  assert.deepEqual(d.holdsNothing, [false, false, true]);
});

test('pedido acima do número de instâncias e multiplicidade grudada são recusados', () => {
  assert.throws(() => parseGraph('R1: 1\nR2 -> P1\nP1 -> R1 x2'), /P1 segura 0 e pede 2 de R1, mas R1 só tem 1 instância/);
  assert.throws(() => parseGraph('R1: 2\nR1 -> P1 x2\nP1 -> R1'), /segura 2 e pede 1/);
  assert.throws(() => parseGraph('R2: 3\nR2 -> P3x2'), /deixe um espaço antes do x/);
  assert.doesNotThrow(() => parseGraph('R2: 3\nR2 -> P3 x2'));
});

test('busca de ciclos tem limite de trabalho em grafos densos', () => {
  const lines = [];
  for (let i = 1; i <= 7; i++) for (let j = 1; j <= 7; j++) lines.push(`P${i} -> R${j}`, `R${j} -> P${i}`);
  lines.unshift(...Array.from({ length: 7 }, (_, j) => `R${j + 1}: 7`));
  const g = parseGraph(lines.join('\n'));
  const info = {};
  const t0 = Date.now();
  const cycles = findCycles(g, 50, info, 20000);
  assert.ok(Date.now() - t0 < 1000, 'termina rápido');
  assert.equal(info.truncated, true);
  assert.ok(cycles.length <= 50);
});
