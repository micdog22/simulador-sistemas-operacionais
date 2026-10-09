// Deadlock: algoritmo do banqueiro (estado seguro e pedidos), grafo de alocação de recursos
// (ciclos) e algoritmo de detecção para recursos com várias instâncias.

export class DeadlockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeadlockError';
  }
}

const leq = (a, b) => a.every((x, i) => x <= b[i]);
const plus = (a, b) => a.map((x, i) => x + b[i]);
const minus = (a, b) => a.map((x, i) => x - b[i]);

export const processName = (i) => `P${i}`;
export const resourceName = (j) => String.fromCharCode(65 + j);
const values = (k) => (k === 1 ? '1 valor' : `${k} valores`);

/** Confere matrizes do banqueiro e calcula Need = Max - Allocation. */
export function bankState({ allocation, max, available }) {
  const n = allocation.length;
  if (n === 0) throw new DeadlockError('Cadastre pelo menos um processo.');
  const m = available.length;
  const check = (M, name) => {
    if (M.length !== n) throw new DeadlockError(`${name} precisa ter ${n} linhas.`);
    M.forEach((row, i) => {
      if (row.length !== m) throw new DeadlockError(`${name}, linha de ${processName(i)}: esperava ${values(m)}.`);
      row.forEach((x) => {
        if (!Number.isInteger(x) || x < 0) throw new DeadlockError(`${name}, linha de ${processName(i)}: use inteiros não negativos.`);
      });
    });
  };
  check(allocation, 'Alocação');
  check(max, 'Máximo');
  available.forEach((x) => {
    if (!Number.isInteger(x) || x < 0) throw new DeadlockError('Disponível: use inteiros não negativos.');
  });
  const need = max.map((row, i) => row.map((x, j) => {
    const v = x - allocation[i][j];
    if (v < 0) throw new DeadlockError(`${processName(i)} já tem mais do recurso ${resourceName(j)} do que declarou como máximo.`);
    return v;
  }));
  return { n, m, allocation: allocation.map((r) => r.slice()), max: max.map((r) => r.slice()), available: available.slice(), need };
}

/** Disponível a partir do total de instâncias: total - soma das alocações. */
export function availableFromTotal(total, allocation) {
  const used = total.map((_, j) => allocation.reduce((s, row) => s + row[j], 0));
  const avail = minus(total, used);
  avail.forEach((x, j) => {
    if (x < 0) throw new DeadlockError(`O recurso ${resourceName(j)} tem ${used[j]} instâncias alocadas, mais que o total ${total[j]}.`);
  });
  return avail;
}

/**
 * Algoritmo de segurança: Work = Disponível; varre os processos em ordem e, quando acha um
 * ainda não terminado com Need ≤ Work, supõe que ele termina e devolve o que tem
 * (Work += Allocation). Repete as varreduras até ninguém mais conseguir avançar.
 * `check` registra cada comparação, para mostrar o passo a passo.
 */
export function safety(stateIn, { needKey = 'need', initialFinish = null } = {}) {
  const state = stateIn;
  const need = state[needKey];
  const finish = initialFinish ? initialFinish.slice() : new Array(state.n).fill(false);
  let work = state.available.slice();
  const sequence = [];
  const steps = [];
  let progress = true;
  let pass = 0;
  while (progress) {
    progress = false;
    pass++;
    for (let i = 0; i < state.n; i++) {
      if (finish[i]) continue;
      const fits = leq(need[i], work);
      const before = work.slice();
      if (fits) {
        work = plus(work, state.allocation[i]);
        finish[i] = true;
        sequence.push(i);
        progress = true;
      }
      steps.push({ pass, process: i, need: need[i].slice(), work: before, fits, workAfter: work.slice() });
    }
  }
  return { safe: finish.every(Boolean), sequence, finish, steps, work };
}

/** Confere se uma sequência dada é segura (cada processo cabe no Work acumulado). */
export function isSafeSequence(state, sequence) {
  if (sequence.length !== state.n || new Set(sequence).size !== state.n) return false;
  let work = state.available.slice();
  for (const i of sequence) {
    if (!leq(state.need[i], work)) return false;
    work = plus(work, state.allocation[i]);
  }
  return true;
}

/**
 * Pedido de recursos (algoritmo do banqueiro):
 *   1. pedido > Need: erro (pediu mais do que declarou);
 *   2. pedido > Disponível: o processo espera;
 *   3. finge que concedeu e roda o algoritmo de segurança: se ficar inseguro, nega.
 */
export function requestResources(state, i, request) {
  if (!Number.isInteger(i) || i < 0 || i >= state.n) throw new DeadlockError('Processo inválido.');
  if (request.length !== state.m || request.some((x) => !Number.isInteger(x) || x < 0)) {
    throw new DeadlockError(`O pedido precisa de ${state.m === 1 ? '1 inteiro não negativo' : `${state.m} inteiros não negativos`}.`);
  }
  if (!leq(request, state.need[i])) {
    return { granted: false, reason: 'excede', text: `${processName(i)} pediu mais do que ainda pode precisar (Need = (${state.need[i].join(', ')})): é um erro do processo.` };
  }
  if (!leq(request, state.available)) {
    return { granted: false, reason: 'espera', text: `Não há recursos disponíveis suficientes agora (Disponível = (${state.available.join(', ')})): ${processName(i)} precisa esperar.` };
  }
  const trial = {
    ...state,
    available: minus(state.available, request),
    allocation: state.allocation.map((row, k) => (k === i ? plus(row, request) : row.slice())),
    need: state.need.map((row, k) => (k === i ? minus(row, request) : row.slice())),
  };
  const res = safety(trial);
  if (!res.safe) {
    return { granted: false, reason: 'inseguro', trial, safety: res, text: `Conceder deixaria o sistema num estado inseguro: o pedido é negado e ${processName(i)} espera.` };
  }
  return { granted: true, reason: 'ok', trial, safety: res, text: `O estado continua seguro (sequência ${res.sequence.map(processName).join(', ')}): o pedido é concedido.` };
}

// ---------------------------------------------------------------------------
// Grafo de alocação de recursos

const NODE = /^[A-Za-z_][\w]*$/;

/**
 * Lê o grafo. Uma linha por aresta ou declaração:
 *   P1 -> R1        P1 pede uma instância de R1 (aresta de pedido)
 *   R1 -> P2        uma instância de R1 está com P2 (aresta de atribuição)
 *   R2 -> P3 x2     duas instâncias (multiplicidade)
 *   R2: 3           R2 tem 3 instâncias (sem declaração, 1)
 *   # comentário
 * Nomes começando com P (ou T) são processos; com R, recursos; outros nomes precisam ser
 * declarados como recurso ("A: 7").
 */
export function parseGraph(text) {
  const resources = new Map(); // nome -> instâncias declaradas
  const edges = [];
  const order = [];
  const seen = new Set();
  const see = (name) => {
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  };
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const decl = /^([A-Za-z_]\w*)\s*[:=]\s*(\d+)$/.exec(line);
    if (decl) {
      const k = Number(decl[2]);
      if (k < 1 || k > 20) throw new DeadlockError(`Linha ${idx + 1}: um recurso tem de 1 a 20 instâncias.`);
      resources.set(decl[1], k);
      see(decl[1]);
      return;
    }
    const edge = /^([A-Za-z_]\w*)\s*(?:->|→)\s*([A-Za-z_]\w*)(?:\s*[x×*]\s*(\d+))?$/.exec(line);
    if (!edge) throw new DeadlockError(`Linha ${idx + 1}: não entendi "${line}". Use "P1 -> R1", "R1 -> P2" ou "R1: 2".`);
    const count = edge[3] ? Number(edge[3]) : 1;
    if (count < 1 || count > 20) throw new DeadlockError(`Linha ${idx + 1}: multiplicidade de 1 a 20.`);
    see(edge[1]);
    see(edge[2]);
    edges.push({ from: edge[1], to: edge[2], count, line: idx + 1 });
  });
  const kindOf = (name) => {
    if (resources.has(name)) return 'recurso';
    if (/^[Pp]/.test(name) || /^[Tt]/.test(name)) return 'processo';
    if (/^[Rr]/.test(name)) return 'recurso';
    throw new DeadlockError(`Não sei se ${name} é processo ou recurso: declare "${name}: 1" se for recurso, ou use um nome começando com P.`);
  };
  for (const name of order) {
    if (!NODE.test(name)) throw new DeadlockError(`Nome inválido: ${name}.`);
    const glued = /^(\w*\d)x(\d+)$/.exec(name);
    if (glued) throw new DeadlockError(`"${name}": para indicar quantidade, deixe um espaço antes do x (por exemplo, "${glued[1]} x${glued[2]}").`);
  }
  const kinds = new Map(order.map((name) => [name, kindOf(name)]));
  const processes = order.filter((nm) => kinds.get(nm) === 'processo');
  const resList = order.filter((nm) => kinds.get(nm) === 'recurso');
  const requests = new Map();
  const assignments = new Map();
  for (const e of edges) {
    const a = kinds.get(e.from);
    const b = kinds.get(e.to);
    if (a === b) throw new DeadlockError(`Linha ${e.line}: arestas ligam processo e recurso, não ${a} com ${b}.`);
    const map = a === 'processo' ? requests : assignments;
    const key = `${e.from}>${e.to}`;
    map.set(key, (map.get(key) || 0) + e.count);
  }
  const instances = new Map();
  for (const r of resList) {
    const held = [...assignments.entries()].filter(([k]) => k.startsWith(`${r}>`)).reduce((s, [, c]) => s + c, 0);
    const declared = resources.get(r);
    if (declared !== undefined && held > declared) {
      throw new DeadlockError(`${r} tem ${declared} ${declared === 1 ? 'instância' : 'instâncias'}, mas ${held} estão atribuídas.`);
    }
    instances.set(r, declared ?? Math.max(1, held));
  }
  if (processes.length > 12 || resList.length > 12) throw new DeadlockError('Use no máximo 12 processos e 12 recursos.');
  // um processo não pode segurar e pedir, juntos, mais instâncias do que o recurso tem
  for (const p of processes) {
    for (const r of resList) {
      const held = assignments.get(`${r}>${p}`) || 0;
      const wanted = requests.get(`${p}>${r}`) || 0;
      const total = instances.get(r);
      if (held + wanted > total) {
        throw new DeadlockError(`${p} segura ${held} e pede ${wanted} de ${r}, mas ${r} só tem ${total === 1 ? '1 instância' : `${total} instâncias`}.`);
      }
    }
  }
  const edgeList = [
    ...[...requests.entries()].map(([k, count]) => {
      const [from, to] = k.split('>');
      return { from, to, count, kind: 'pedido' };
    }),
    ...[...assignments.entries()].map(([k, count]) => {
      const [from, to] = k.split('>');
      return { from, to, count, kind: 'atribuicao' };
    }),
  ];
  return { processes, resources: resList, instances, edges: edgeList };
}

/**
 * Ciclos simples do grafo (cada ciclo listado uma vez, começando pelo menor nó). Para não
 * travar em grafos densos, para em `limit` ciclos ou depois de `budget` passos da busca;
 * nesse caso, `info.truncated` fica verdadeiro.
 */
export function findCycles(graph, limit = 50, info = {}, budget = 200000) {
  const nodes = [...graph.processes, ...graph.resources];
  const index = new Map(nodes.map((n, i) => [n, i]));
  const adj = nodes.map(() => []);
  for (const e of graph.edges) adj[index.get(e.from)].push(index.get(e.to));
  adj.forEach((list) => list.sort((a, b) => a - b));
  const cycles = [];
  let steps = 0;
  info.truncated = false;
  for (let s = 0; s < nodes.length && cycles.length < limit && !info.truncated; s++) {
    const path = [s];
    const onPath = new Set([s]);
    const dfs = (u) => {
      for (const v of adj[u]) {
        if (cycles.length >= limit || ++steps > budget) {
          info.truncated = true;
          return;
        }
        if (v === s) cycles.push(path.map((i) => nodes[i]));
        else if (v > s && !onPath.has(v)) {
          path.push(v);
          onPath.add(v);
          dfs(v);
          path.pop();
          onPath.delete(v);
        }
      }
    };
    dfs(s);
  }
  return cycles;
}

/**
 * Detecção de deadlock com várias instâncias: como o algoritmo de segurança, mas com a
 * matriz de pedidos atuais no lugar de Need. Quem nunca consegue terminar está em deadlock.
 */
export function detectDeadlock(graph) {
  const P = graph.processes;
  const R = graph.resources;
  const allocation = P.map(() => R.map(() => 0));
  const request = P.map(() => R.map(() => 0));
  for (const e of graph.edges) {
    if (e.kind === 'pedido') request[P.indexOf(e.from)][R.indexOf(e.to)] += e.count;
    else allocation[P.indexOf(e.to)][R.indexOf(e.from)] += e.count;
  }
  const total = R.map((r) => graph.instances.get(r));
  const available = availableFromTotal(total, allocation);
  const state = { n: P.length, m: R.length, allocation, request, available };
  // quem não segura nenhum recurso não faz parte de um deadlock (Finish começa verdadeiro)
  const holdsNothing = allocation.map((row) => row.every((x) => x === 0));
  const res = safety(state, { needKey: 'request', initialFinish: holdsNothing });
  const deadlocked = P.filter((_, i) => !res.finish[i]);
  const info = {};
  const cycles = findCycles(graph, 50, info);
  const singleInstance = R.every((r) => graph.instances.get(r) === 1);
  return { allocation, request, available, total, holdsNothing, ...res, deadlocked, cycles, cyclesTruncated: info.truncated, singleInstance };
}
