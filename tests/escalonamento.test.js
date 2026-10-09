import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALGORITHMS, SchedulingError, compareAll, countContextSwitches, schedule, validateProcesses,
} from '../src/escalonamento.js';

const gantt = (r) => r.timeline.map((s) => `${s.id ?? '-'}:${s.start}-${s.end}`).join(' ');
const col = (r, k) => r.processes.map((p) => p[k]);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const P = (id, arrival, burst, priority = 0) => ({ id, arrival, burst, priority });

// Exemplos calculados à mão (os três primeiros são clássicos do livro do Silberschatz).
const THREE = [P('P1', 0, 24), P('P2', 0, 3), P('P3', 0, 3)];
const ARRIVALS = [P('P1', 0, 8), P('P2', 1, 4), P('P3', 2, 9), P('P4', 3, 5)];
const PRIORITY = [P('P1', 0, 10, 3), P('P2', 0, 1, 1), P('P3', 0, 2, 4), P('P4', 0, 1, 5), P('P5', 0, 5, 2)];

test('FCFS: espera média 17 na ordem P1, P2, P3 e 3 na ordem P2, P3, P1', () => {
  const r = schedule(THREE, 'fcfs');
  assert.equal(gantt(r), 'P1:0-24 P2:24-27 P3:27-30');
  assert.deepEqual(col(r, 'waiting'), [0, 24, 27]);
  assert.deepEqual(col(r, 'turnaround'), [24, 27, 30]);
  close(r.averages.waiting, 17);
  close(r.averages.turnaround, 27);
  assert.equal(r.contextSwitches, 2);
  const r2 = schedule([THREE[1], THREE[2], THREE[0]], 'fcfs');
  close(r2.averages.waiting, 3);
});

test('SJF com todos chegando juntos: P2, P3, P1 e espera média 3', () => {
  const r = schedule(THREE, 'sjf');
  assert.equal(gantt(r), 'P2:0-3 P3:3-6 P1:6-30');
  close(r.averages.waiting, 3);
});

test('Round Robin com quantum 4: espera média 17/3', () => {
  const r = schedule(THREE, 'rr', { quantum: 4 });
  assert.equal(gantt(r), 'P1:0-4 P2:4-7 P3:7-10 P1:10-30');
  assert.deepEqual(col(r, 'waiting'), [6, 4, 7]);
  assert.deepEqual(col(r, 'response'), [0, 4, 7]);
  close(r.averages.waiting, 17 / 3);
  assert.equal(r.contextSwitches, 3);
});

test('SRTF (SJF preemptivo): espera média 6,5', () => {
  const r = schedule(ARRIVALS, 'srtf');
  assert.equal(gantt(r), 'P1:0-1 P2:1-5 P4:5-10 P1:10-17 P3:17-26');
  assert.deepEqual(col(r, 'completion'), [17, 5, 26, 10]);
  assert.deepEqual(col(r, 'waiting'), [9, 0, 15, 2]);
  assert.deepEqual(col(r, 'response'), [0, 0, 15, 2]);
  close(r.averages.waiting, 6.5);
  close(r.averages.turnaround, 13);
  close(r.averages.response, 4.25);
  assert.equal(r.contextSwitches, 4);
});

test('SJF não preemptivo no mesmo conjunto: espera média 7,75', () => {
  const r = schedule(ARRIVALS, 'sjf');
  assert.equal(gantt(r), 'P1:0-8 P2:8-12 P4:12-17 P3:17-26');
  assert.deepEqual(col(r, 'waiting'), [0, 7, 15, 9]);
  close(r.averages.waiting, 7.75);
});

test('prioridade não preemptiva: espera média 8,2', () => {
  const r = schedule(PRIORITY, 'prio');
  assert.equal(gantt(r), 'P2:0-1 P5:1-6 P1:6-16 P3:16-18 P4:18-19');
  assert.deepEqual(col(r, 'waiting'), [6, 0, 16, 18, 1]);
  close(r.averages.waiting, 8.2);
});

test('prioridade preemptiva (calculado à mão)', () => {
  // P1 começa; P2 (prioridade 1) chega em 1 e interrompe; P4 (2) vem antes de P1 (3) e P3 (4)
  const procs = [P('P1', 0, 5, 3), P('P2', 1, 3, 1), P('P3', 2, 2, 4), P('P4', 3, 1, 2)];
  const r = schedule(procs, 'prioP');
  assert.equal(gantt(r), 'P1:0-1 P2:1-4 P4:4-5 P1:5-9 P3:9-11');
  assert.deepEqual(col(r, 'completion'), [9, 4, 11, 5]);
  assert.deepEqual(col(r, 'waiting'), [4, 0, 7, 1]);
  assert.deepEqual(col(r, 'response'), [0, 0, 7, 1]);
  close(r.averages.waiting, 3);
  close(r.averages.turnaround, 5.75);
  assert.equal(r.contextSwitches, 4);
});

test('Round Robin com chegadas: quem chega no fim do quantum entra antes do interrompido', () => {
  // Calculado à mão, quantum 2:
  // t=0 fila [P1]; P1 roda 0-2; chegam P2 (1) e P3 (2); P1 volta: [P2, P3, P1]
  // P2 2-4; chegam P4 (3) e P5 (4): [P3, P1, P4, P5, P2]; P3 4-5 termina;
  // P1 5-7; P4 7-9 termina; P5 9-11; P2 11-12 termina; P1 12-13 termina; P5 13-14 termina.
  const procs = [P('P1', 0, 5), P('P2', 1, 3), P('P3', 2, 1), P('P4', 3, 2), P('P5', 4, 3)];
  const r = schedule(procs, 'rr', { quantum: 2 });
  assert.equal(gantt(r), 'P1:0-2 P2:2-4 P3:4-5 P1:5-7 P4:7-9 P5:9-11 P2:11-12 P1:12-13 P5:13-14');
  assert.deepEqual(col(r, 'completion'), [13, 12, 5, 9, 14]);
  assert.deepEqual(col(r, 'turnaround'), [13, 11, 3, 6, 10]);
  assert.deepEqual(col(r, 'waiting'), [8, 8, 2, 4, 7]);
  assert.deepEqual(col(r, 'response'), [0, 1, 2, 4, 5]);
  close(r.averages.waiting, 5.8);
  close(r.averages.turnaround, 8.6);
  close(r.averages.response, 2.4);
  assert.equal(r.contextSwitches, 8);
  const queueLog = r.log.find((e) => e.kind === 'quantum' && e.time === 4);
  assert.deepEqual(queueLog.queue, ['P3', 'P1', 'P4', 'P5', 'P2']);
});

test('CPU ociosa entre chegadas e troca de contexto atravessando o ócio', () => {
  const r = schedule([P('P1', 0, 2), P('P2', 5, 3)], 'fcfs');
  assert.equal(gantt(r), 'P1:0-2 -:2-5 P2:5-8');
  assert.deepEqual(col(r, 'waiting'), [0, 0]);
  assert.equal(r.contextSwitches, 1);
  close(r.utilization, 5 / 8);
  const rr = schedule([P('P1', 2, 3)], 'rr', { quantum: 1 });
  assert.equal(gantt(rr), '-:0-2 P1:2-5');
  assert.equal(rr.contextSwitches, 0);
});

test('desempates: empate não interrompe e vale a ordem de chegada e da lista', () => {
  const tie = schedule([P('P1', 0, 4), P('P2', 1, 3)], 'srtf');
  assert.equal(gantt(tie), 'P1:0-4 P2:4-7');
  const sjf = schedule([P('A', 0, 1), P('B', 1, 3), P('C', 1, 3), P('D', 0, 3)], 'sjf');
  // em t=1 os prontos com duração 3 são D (chegou em 0), B e C: D vence pela chegada, depois B pela lista
  assert.equal(gantt(sjf), 'A:0-1 D:1-4 B:4-7 C:7-10');
  const pr = schedule([P('X', 0, 2, 1), P('Y', 1, 2, 1)], 'prioP');
  assert.equal(gantt(pr), 'X:0-2 Y:2-4');
});

test('contagem de trocas de contexto', () => {
  assert.equal(countContextSwitches([{ id: 'A' }, { id: null }, { id: 'A' }, { id: 'B' }]), 1);
  assert.equal(countContextSwitches([{ id: null }, { id: 'A' }]), 0);
});

test('validação em português', () => {
  assert.throws(() => validateProcesses([]), /pelo menos um processo/);
  assert.throws(() => validateProcesses([P('P1', 0, 2), P('P1', 1, 2)]), /mais de uma vez/);
  assert.throws(() => validateProcesses([P('P1', 0, 0)]), /duração/);
  assert.throws(() => validateProcesses([P('P1', -1, 3)]), /chegada/);
  assert.throws(() => validateProcesses([P('P1', 0, 2.5)]), /inteiro/);
  assert.throws(() => validateProcesses([P('', 0, 2)]), /sem nome/);
  assert.throws(() => validateProcesses([P('P1', 0, 2, 1.5)]), /prioridade/);
  assert.throws(() => schedule([P('P1', 0, 2)], 'rr', { quantum: 0 }), SchedulingError);
  assert.throws(() => schedule([P('P1', 0, 2)], 'xyz'), /desconhecido/);
  assert.throws(() => validateProcesses([P('P1', 0, 1500), P('P2', 0, 600)]), /2000/);
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

test('invariantes em cargas aleatórias (semente fixa)', () => {
  const rand = rng(2026);
  for (let k = 0; k < 120; k++) {
    const n = 1 + Math.floor(rand() * 7);
    const procs = Array.from({ length: n }, (_, i) => P(`P${i + 1}`, Math.floor(rand() * 12), 1 + Math.floor(rand() * 9), Math.floor(rand() * 5)));
    const quantum = 1 + Math.floor(rand() * 4);
    const results = compareAll(procs, { quantum });
    for (const r of results) {
      // cada processo roda exatamente a sua duração, sem sobreposição e nunca antes de chegar
      let last = 0;
      const ran = Object.fromEntries(procs.map((p) => [p.id, 0]));
      for (const s of r.timeline) {
        assert.ok(s.start >= last && s.end > s.start, `${r.algorithm}: linha do tempo contínua`);
        last = s.end;
        if (s.id !== null) {
          ran[s.id] += s.end - s.start;
          assert.ok(s.start >= procs.find((p) => p.id === s.id).arrival, 'não roda antes de chegar');
        }
      }
      for (const p of procs) assert.equal(ran[p.id], p.burst, `${r.algorithm}: ${p.id} roda ${p.burst}`);
      for (const p of r.processes) {
        assert.ok(p.waiting >= 0 && p.response >= 0 && p.response <= p.waiting);
        assert.equal(p.turnaround, p.completion - p.arrival);
      }
      if (r.algorithm === 'fcfs' || r.algorithm === 'sjf' || r.algorithm === 'prio') {
        // não preemptivos: cada processo aparece num bloco só
        const blocks = r.timeline.filter((s) => s.id !== null).map((s) => s.id);
        assert.equal(new Set(blocks).size, blocks.length, `${r.algorithm} sem preempção`);
      }
    }
    // SRTF minimiza o tempo médio de retorno entre todas as políticas
    const srtf = results.find((r) => r.algorithm === 'srtf').averages.turnaround;
    for (const r of results) assert.ok(srtf <= r.averages.turnaround + 1e-9, `SRTF ≤ ${r.algorithm}`);
  }
  assert.deepEqual(Object.keys(ALGORITHMS), ['fcfs', 'sjf', 'srtf', 'prio', 'prioP', 'rr']);
});

test('SJF minimiza a espera média quando todos chegam juntos', () => {
  const rand = rng(77);
  for (let k = 0; k < 60; k++) {
    const procs = Array.from({ length: 2 + (k % 6) }, (_, i) => P(`P${i}`, 0, 1 + Math.floor(rand() * 20), Math.floor(rand() * 4)));
    const sjf = schedule(procs, 'sjf').averages.waiting;
    for (const alg of ['fcfs', 'prio', 'rr']) assert.ok(sjf <= schedule(procs, alg).averages.waiting + 1e-9);
  }
});
