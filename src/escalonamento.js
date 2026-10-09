// Escalonamento de CPU: FCFS, SJF, SRTF, prioridade (com e sem preempção) e Round Robin.
// Tempos inteiros. Desempates documentados:
//   - entre candidatos iguais, vence quem chegou primeiro e, depois, quem vem antes na lista;
//   - nos preemptivos, empate não interrompe quem está rodando;
//   - no Round Robin, quem chega até o fim do quantum entra na fila antes do processo interrompido.

export const ALGORITHMS = Object.freeze({
  fcfs: 'FCFS',
  sjf: 'SJF',
  srtf: 'SRTF',
  prio: 'Prioridade',
  prioP: 'Prioridade preemptiva',
  rr: 'Round Robin',
});

export const ALGORITHM_NAMES = Object.freeze({
  fcfs: 'FCFS: primeiro a chegar, primeiro a ser atendido',
  sjf: 'SJF: menor job primeiro (não preemptivo)',
  srtf: 'SRTF: menor tempo restante primeiro (preemptivo)',
  prio: 'Prioridade não preemptiva',
  prioP: 'Prioridade preemptiva',
  rr: 'Round Robin (fatia de tempo)',
});

export const MAX_PROCESSES = 20;
export const MAX_TIME = 2000;

export class SchedulingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchedulingError';
  }
}

/** Confere e normaliza a lista de processos. Menor número de prioridade = mais prioritário. */
export function validateProcesses(list) {
  if (!Array.isArray(list) || list.length === 0) throw new SchedulingError('Cadastre pelo menos um processo.');
  if (list.length > MAX_PROCESSES) throw new SchedulingError(`No máximo ${MAX_PROCESSES} processos.`);
  const seen = new Set();
  const out = list.map((p, order) => {
    const id = String(p.id ?? '').trim();
    if (!id) throw new SchedulingError(`O processo da linha ${order + 1} está sem nome.`);
    if (seen.has(id)) throw new SchedulingError(`O nome ${id} aparece mais de uma vez.`);
    seen.add(id);
    const num = (v, what, min) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < min) {
        throw new SchedulingError(`${id}: ${what} precisa ser um inteiro ${min === 0 ? 'maior ou igual a 0' : `a partir de ${min}`}.`);
      }
      return x;
    };
    const arrival = num(p.arrival ?? 0, 'a chegada', 0);
    const burst = num(p.burst, 'a duração (surto de CPU)', 1);
    const priority = p.priority === undefined || p.priority === '' ? 0 : Number(p.priority);
    if (!Number.isInteger(priority)) throw new SchedulingError(`${id}: a prioridade precisa ser um número inteiro.`);
    return { id, arrival, burst, priority, order };
  });
  const total = out.reduce((s, p) => s + p.burst, 0) + Math.max(...out.map((p) => p.arrival));
  if (total > MAX_TIME) throw new SchedulingError(`A simulação passaria de ${MAX_TIME} unidades de tempo; use números menores.`);
  return out;
}

function pushSlice(timeline, id, start, end) {
  const last = timeline[timeline.length - 1];
  if (last && last.id === id && last.end === start) last.end = end;
  else timeline.push({ id, start, end });
}

/** Quantas vezes a CPU passa a executar um processo diferente do último que executou. */
export function countContextSwitches(timeline) {
  let last = null;
  let count = 0;
  for (const seg of timeline) {
    if (seg.id === null) continue;
    if (last !== null && seg.id !== last) count++;
    last = seg.id;
  }
  return count;
}

const keyOf = {
  fcfs: (p) => [p.arrival, p.order],
  sjf: (p) => [p.burst, p.arrival, p.order],
  srtf: (p) => [p.remaining, p.arrival, p.order],
  prio: (p) => [p.priority, p.arrival, p.order],
  prioP: (p) => [p.priority, p.arrival, p.order],
};

const lexLess = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

function describeReady(ready, alg) {
  const v = (p) => {
    if (alg === 'sjf') return `${p.id} (duração ${p.burst})`;
    if (alg === 'srtf') return `${p.id} (${p.remaining === 1 ? 'resta 1' : `restam ${p.remaining}`})`;
    if (alg === 'prio' || alg === 'prioP') return `${p.id} (prioridade ${p.priority})`;
    return `${p.id} (chegou em ${p.arrival})`;
  };
  return ready.map(v).join(', ');
}

const REASON = {
  fcfs: 'chegou primeiro',
  sjf: 'menor duração',
  srtf: 'menor tempo restante',
  prio: 'maior prioridade (menor número)',
  prioP: 'maior prioridade (menor número)',
};

/** Simulação unidade a unidade dos algoritmos que não são Round Robin. */
function simulateByUnits(procs, alg) {
  const preemptive = alg === 'srtf' || alg === 'prioP';
  const ps = procs.map((p) => ({ ...p, remaining: p.burst, start: null, completion: null }));
  const timeline = [];
  const log = [];
  let t = 0;
  let done = 0;
  let current = null;
  const key = keyOf[alg];
  while (done < ps.length) {
    const ready = ps.filter((p) => p.arrival <= t && p.remaining > 0);
    for (const p of ps) if (p.arrival === t) log.push({ time: t, kind: 'chegada', text: `${p.id} chega (duração ${p.burst}${alg.startsWith('prio') ? `, prioridade ${p.priority}` : ''}).` });
    if (ready.length === 0) {
      const next = Math.min(...ps.filter((p) => p.remaining > 0).map((p) => p.arrival));
      pushSlice(timeline, null, t, next);
      log.push({ time: t, kind: 'ocioso', text: `Nenhum processo pronto: CPU ociosa até ${next}.` });
      t = next;
      current = null;
      continue;
    }
    let chosen;
    if (current && !preemptive) chosen = current;
    else {
      chosen = ready.reduce((best, p) => (lexLess(key(p), key(best)) ? p : best));
      // nos preemptivos, empate não tira quem está rodando
      if (current && preemptive && current.remaining > 0) {
        const kc = key(current)[0];
        const kb = key(chosen)[0];
        if (kc === kb) chosen = current;
      }
    }
    if (chosen !== current) {
      const others = ready.length > 1 ? ` Prontos: ${describeReady(ready, alg)}.` : '';
      if (current && current.remaining > 0) {
        log.push({ time: t, kind: 'preempcao', text: `${chosen.id} interrompe ${current.id} (${REASON[alg]}).${others}` });
      } else {
        log.push({ time: t, kind: 'despacho', text: `${chosen.id} assume a CPU${ready.length > 1 ? ` (${REASON[alg]})` : ''}.${others}` });
      }
    }
    if (chosen.start === null) chosen.start = t;
    pushSlice(timeline, chosen.id, t, t + 1);
    chosen.remaining -= 1;
    t += 1;
    if (chosen.remaining === 0) {
      chosen.completion = t;
      done++;
      current = null;
      log.push({ time: t, kind: 'fim', text: `${chosen.id} termina.` });
    } else {
      current = chosen;
    }
  }
  return { ps, timeline, log };
}

function simulateRoundRobin(procs, quantum) {
  if (!Number.isInteger(quantum) || quantum < 1) throw new SchedulingError('O quantum precisa ser um inteiro a partir de 1.');
  const ps = procs.map((p) => ({ ...p, remaining: p.burst, start: null, completion: null }));
  const byArrival = [...ps].sort((a, b) => a.arrival - b.arrival || a.order - b.order);
  const queue = [];
  const timeline = [];
  const log = [];
  let next = 0;
  let t = 0;
  let done = 0;
  const admit = (upTo) => {
    while (next < byArrival.length && byArrival[next].arrival <= upTo) {
      const p = byArrival[next++];
      queue.push(p);
      log.push({ time: p.arrival, kind: 'chegada', text: `${p.id} chega (duração ${p.burst}) e entra na fila.`, queue: queue.map((q) => q.id) });
    }
  };
  admit(0);
  while (done < ps.length) {
    if (queue.length === 0) {
      const at = byArrival[next].arrival;
      pushSlice(timeline, null, t, at);
      log.push({ time: t, kind: 'ocioso', text: `Fila vazia: CPU ociosa até ${at}.`, queue: [] });
      t = at;
      admit(t);
      continue;
    }
    const p = queue.shift();
    const run = Math.min(quantum, p.remaining);
    if (p.start === null) p.start = t;
    log.push({ time: t, kind: 'despacho', text: `${p.id} sai da fila e roda ${run} ${run === 1 ? 'unidade' : 'unidades'}${run < quantum ? ' (termina antes do fim do quantum)' : ''}.`, queue: queue.map((q) => q.id) });
    pushSlice(timeline, p.id, t, t + run);
    t += run;
    p.remaining -= run;
    admit(t); // quem chegou durante a fatia entra antes de quem foi interrompido
    if (p.remaining > 0) {
      queue.push(p);
      log.push({ time: t, kind: 'quantum', text: `Fim do quantum: ${p.id} (${p.remaining === 1 ? 'resta 1' : `restam ${p.remaining}`}) volta para o fim da fila.`, queue: queue.map((q) => q.id) });
    } else {
      p.completion = t;
      done++;
      log.push({ time: t, kind: 'fim', text: `${p.id} termina.`, queue: queue.map((q) => q.id) });
    }
  }
  return { ps, timeline, log };
}

/**
 * Executa o algoritmo e calcula, por processo: início, término, tempo de retorno
 * (término - chegada), espera (retorno - duração) e resposta (primeira execução - chegada).
 */
export function schedule(list, algorithm, { quantum = 2 } = {}) {
  if (!ALGORITHMS[algorithm]) throw new SchedulingError(`Algoritmo desconhecido: ${algorithm}.`);
  const procs = validateProcesses(list);
  const sim = algorithm === 'rr' ? simulateRoundRobin(procs, Number(quantum)) : simulateByUnits(procs, algorithm);
  const processes = sim.ps
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const turnaround = p.completion - p.arrival;
      return {
        id: p.id,
        arrival: p.arrival,
        burst: p.burst,
        priority: p.priority,
        start: p.start,
        completion: p.completion,
        turnaround,
        waiting: turnaround - p.burst,
        response: p.start - p.arrival,
      };
    });
  const avg = (k) => processes.reduce((s, p) => s + p[k], 0) / processes.length;
  const end = Math.max(...processes.map((p) => p.completion));
  const busy = processes.reduce((s, p) => s + p.burst, 0);
  return {
    algorithm,
    quantum: algorithm === 'rr' ? Number(quantum) : null,
    timeline: sim.timeline,
    processes,
    averages: { waiting: avg('waiting'), turnaround: avg('turnaround'), response: avg('response') },
    contextSwitches: countContextSwitches(sim.timeline),
    makespan: end,
    utilization: busy / end,
    throughput: processes.length / end,
    log: sim.log,
  };
}

/** Roda todos os algoritmos com a mesma entrada (para a tabela de comparação). */
export function compareAll(list, { quantum = 2 } = {}) {
  return Object.keys(ALGORITHMS).map((alg) => schedule(list, alg, { quantum }));
}
