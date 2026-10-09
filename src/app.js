// Interface do simulador: quatro abas ligadas aos módulos de lógica.
import { ALGORITHMS, ALGORITHM_NAMES, schedule } from './escalonamento.js';
import {
  BELADY_STRING, PAGE_ALGORITHMS, SILBERSCHATZ_STRING, beladyPoints, faultCurve, parseReferenceString, simulatePaging,
} from './paginacao.js';
import {
  availableFromTotal, bankState, detectDeadlock, parseGraph, processName, requestResources, safety,
} from './deadlock.js';
import { FIT_ALGORITHMS, compareFits, parseOperations, parseSizes, simulateMemory } from './memoria.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const num = (x) => (Number.isInteger(x) ? String(x) : x.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (x) => `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const seriesColor = (i) => (i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--idle)');
const STORAGE_KEY = 'simulador-sistemas-operacionais:v1';
const RES_NAMES = ['A', 'B', 'C', 'D', 'E'];

function debounce(fn, ms) {
  let id = 0;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg || '';
  el.hidden = !msg;
}

// ---------------------------------------------------------------------------
// Estado e armazenamento

const state = {
  tab: 'tab-cpu',
  procs: [],
  cpuAlg: 'fcfs',
  quantum: '2',
  refs: SILBERSCHATZ_STRING.join(' '),
  frames: '3',
  pagAlg: 'fifo',
  bank: null,
  rag: '',
  memMode: 'parts',
  memParts: '100, 500, 200, 300, 600',
  memTotal: '1000',
  memAlg: 'first',
  memFixed: false,
  memOps: 'P1 212\nP2 417\nP3 112\nP4 426',
};

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // armazenamento indisponível: segue sem salvar
  }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && typeof s === 'object') {
      for (const k of Object.keys(state)) {
        if (!(k in s)) continue;
        // só aceita valores do mesmo tipo do padrão (texto, booleano) ou estruturas conferidas abaixo
        if (k === 'procs' || k === 'bank' || typeof s[k] === typeof state[k]) state[k] = s[k];
      }
    }
  } catch {
    // dados antigos ou inválidos: usa o padrão
  }
  if (!ALGORITHMS[state.cpuAlg]) state.cpuAlg = 'fcfs';
  if (!PAGE_ALGORITHMS[state.pagAlg]) state.pagAlg = 'fifo';
  if (!FIT_ALGORITHMS[state.memAlg]) state.memAlg = 'first';
  if (state.memMode !== 'parts' && state.memMode !== 'total') state.memMode = 'parts';
  if (!['tab-cpu', 'tab-pag', 'tab-dead', 'tab-mem'].includes(state.tab)) state.tab = 'tab-cpu';
  state.procs = Array.isArray(state.procs)
    ? state.procs.filter((p) => p && typeof p === 'object').slice(0, 20).map((p) => ({
      id: String(p.id ?? ''), arrival: String(p.arrival ?? '0'), burst: String(p.burst ?? '1'), priority: String(p.priority ?? '0'),
    }))
    : [];
  if (!validBank(state.bank)) state.bank = null;
}

function validBank(b) {
  if (!b || typeof b !== 'object') return false;
  const okSize = Number.isInteger(b.n) && b.n >= 1 && b.n <= 8 && Number.isInteger(b.m) && b.m >= 1 && b.m <= 5;
  const okMatrix = (M) => Array.isArray(M) && M.length === b.n && M.every((r) => Array.isArray(r) && r.length === b.m);
  const okVec = (v) => Array.isArray(v) && v.length === b.m;
  return okSize && okMatrix(b.allocation) && okMatrix(b.max) && okVec(b.available) && okVec(b.total);
}

// ---------------------------------------------------------------------------
// Abas

const TAB_HASH = { cpu: 'tab-cpu', paginacao: 'tab-pag', deadlock: 'tab-dead', memoria: 'tab-mem' };

function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    if (tab.id === 'tab-cpu' && state.tab !== 'tab-cpu') runCpu(); // a escala do Gantt depende da largura visível
    state.tab = tab.id;
    const hash = Object.keys(TAB_HASH).find((k) => TAB_HASH[k] === tab.id);
    history.replaceState(null, '', `#${hash}`);
    stopPlayer();
    save();
  };
  tabs.forEach((t) => t.addEventListener('click', () => select(t)));
  document.querySelector('[role="tablist"]').addEventListener('keydown', (ev) => {
    const i = tabs.indexOf(document.activeElement);
    if (i === -1) return;
    let j = null;
    if (ev.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (ev.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = tabs.length - 1;
    if (j === null) return;
    ev.preventDefault();
    select(tabs[j], true);
  });
  const fromHash = TAB_HASH[location.hash.slice(1)];
  select($(fromHash || state.tab) || tabs[0]);
}

// ---------------------------------------------------------------------------
// Escalonamento

const CPU_EXAMPLES = [
  { alg: 'fcfs', procs: [['P1', 0, 24, 0], ['P2', 0, 3, 0], ['P3', 0, 3, 0]] },
  { alg: 'srtf', procs: [['P1', 0, 8, 0], ['P2', 1, 4, 0], ['P3', 2, 9, 0], ['P4', 3, 5, 0]] },
  { alg: 'prio', procs: [['P1', 0, 10, 3], ['P2', 0, 1, 1], ['P3', 0, 2, 4], ['P4', 0, 1, 5], ['P5', 0, 5, 2]] },
  { alg: 'rr', quantum: 2, procs: [['P1', 0, 5, 0], ['P2', 1, 3, 0], ['P3', 2, 1, 0], ['P4', 3, 2, 0], ['P5', 4, 3, 0]] },
];

function setCpuExample(i) {
  const ex = CPU_EXAMPLES[i];
  state.procs = ex.procs.map(([id, arrival, burst, priority]) => ({ id, arrival: String(arrival), burst: String(burst), priority: String(priority) }));
  state.cpuAlg = ex.alg;
  if (ex.quantum) state.quantum = String(ex.quantum);
  $('cpu-alg').value = state.cpuAlg;
  $('cpu-quantum').value = state.quantum;
  renderProcTable();
  runCpu();
}

function renderProcTable() {
  const rows = state.procs.map((p, i) => `<tr>
      <td><input class="pid" type="text" data-i="${i}" data-k="id" value="${esc(p.id)}" aria-label="Nome do processo ${i + 1}"></td>
      <td><input type="number" min="0" data-i="${i}" data-k="arrival" value="${esc(p.arrival)}" aria-label="Chegada de ${esc(p.id)}"></td>
      <td><input type="number" min="1" data-i="${i}" data-k="burst" value="${esc(p.burst)}" aria-label="Duração de ${esc(p.id)}"></td>
      <td><input type="number" data-i="${i}" data-k="priority" value="${esc(p.priority)}" aria-label="Prioridade de ${esc(p.id)}"></td>
      <td><button type="button" class="icon-btn" data-remove="${i}" aria-label="Remover ${esc(p.id)}">✕</button></td>
    </tr>`);
  $('proc-table').querySelector('tbody').innerHTML = rows.join('');
}

function ganttHTML(result, ids) {
  const end = result.makespan;
  // escala pela largura disponível; abaixo de 8 px por unidade, o gráfico rola na horizontal
  const avail = Math.max(260, ($('cpu-result').clientWidth || 880) - 30);
  const unit = Math.max(8, Math.min(56, Math.floor(avail / end)));
  const segs = result.timeline.map((s) => {
    const idx = ids.indexOf(s.id);
    const w = (s.end - s.start) * unit;
    const label = s.id === null ? 'ocioso' : s.id;
    const style = `left:${s.start * unit}px;width:${w}px;${s.id !== null ? `--c:${seriesColor(idx % 8)}` : ''}`;
    const text = w >= 30 || (s.id !== null && w >= 18 && label.length <= 2) ? esc(label) : '';
    return `<div class="seg${s.id === null ? ' idle' : ''}" style="${style}" title="${esc(label)}: de ${s.start} a ${s.end}">${text}</div>`;
  });
  const times = [...new Set(result.timeline.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  let lastShown = -Infinity;
  const ticks = times.map((t) => {
    const x = t * unit;
    if (x - lastShown < 20 && t !== end) return '';
    lastShown = x;
    return `<span class="tick" style="left:${x}px">${t}</span>`;
  });
  const sr = result.timeline.map((s) => `${s.id === null ? 'CPU ociosa' : s.id} de ${s.start} a ${s.end}`).join('; ');
  return `<div class="gantt-wrap"><div class="gantt" style="width:${end * unit + 12}px" aria-hidden="true">${segs.join('')}${ticks.join('')}</div></div><p class="sr-only">Gráfico de Gantt: ${esc(sr)}.</p>`;
}

function runCpu() {
  const box = $('cpu-result');
  let res;
  let all;
  const quantum = Number(state.quantum);
  const quantumOk = String(state.quantum).trim() !== '' && Number.isInteger(quantum) && quantum >= 1;
  try {
    const list = state.procs.map((p) => ({ id: p.id, arrival: p.arrival, burst: p.burst, priority: p.priority }));
    if (state.cpuAlg === 'rr' && !quantumOk) throw new Error('O quantum precisa ser um inteiro a partir de 1.');
    res = schedule(list, state.cpuAlg, { quantum: quantumOk ? quantum : 2 });
    // o Round Robin só entra na comparação com um quantum válido
    all = Object.keys(ALGORITHMS).filter((a) => a !== 'rr' || quantumOk).map((a) => schedule(list, a, { quantum }));
    showError('cpu-error', '');
  } catch (err) {
    showError('cpu-error', err.message);
    box.innerHTML = '<p class="muted">Corrija os dados para ver a simulação.</p>';
    $('cpu-compare').innerHTML = '';
    $('cpu-live').textContent = '';
    save();
    return;
  }
  const ids = state.procs.map((p) => p.id.trim());
  const usesPrio = state.cpuAlg === 'prio' || state.cpuAlg === 'prioP';
  const head = `<tr><th scope="col">Processo</th><th scope="col">Chegada</th><th scope="col">Duração</th>${usesPrio ? '<th scope="col">Prioridade</th>' : ''}<th scope="col">Início</th><th scope="col">Término</th><th scope="col">Retorno</th><th scope="col">Espera</th><th scope="col">Resposta</th></tr>`;
  const rows = res.processes.map((p) => `<tr><th scope="row">${esc(p.id)}</th><td>${p.arrival}</td><td>${p.burst}</td>${usesPrio ? `<td>${p.priority}</td>` : ''}<td>${p.start}</td><td>${p.completion}</td><td>${p.turnaround}</td><td>${p.waiting}</td><td>${p.response}</td></tr>`).join('');
  const span = usesPrio ? 6 : 5;
  const foot = `<tr><th scope="row" colspan="${span}">Média</th><td>${num(res.averages.turnaround)}</td><td>${num(res.averages.waiting)}</td><td>${num(res.averages.response)}</td></tr>`;
  const logItems = res.log.map((e) => `<li><span class="t">t = ${e.time}</span> ${esc(e.text)}${e.queue ? ` <span class="queue">fila: [${esc(e.queue.join(', '))}]</span>` : ''}</li>`).join('');
  box.innerHTML = `
    <p><strong>${esc(ALGORITHM_NAMES[state.cpuAlg])}</strong>${state.cpuAlg === 'rr' ? `, quantum ${res.quantum}` : ''}.</p>
    ${ganttHTML(res, ids)}
    <div class="metrics">
      <div class="metric"><b>${num(res.averages.waiting)}</b><span>espera média</span></div>
      <div class="metric"><b>${num(res.averages.turnaround)}</b><span>tempo de retorno médio</span></div>
      <div class="metric"><b>${num(res.averages.response)}</b><span>tempo de resposta médio</span></div>
      <div class="metric"><b>${res.contextSwitches}</b><span>trocas de contexto</span></div>
      <div class="metric"><b>${pct(res.utilization)}</b><span>uso da CPU até ${res.makespan}</span></div>
    </div>
    <div class="table-wrap"><table><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <p class="muted small">Retorno = término - chegada. Espera = retorno - duração. Resposta = primeira vez na CPU - chegada. Troca de contexto: cada vez que a CPU passa a executar um processo diferente do último que executou.</p>
    <details class="sub"${res.log.length <= 40 ? ' open' : ''}><summary>Passo a passo das decisões</summary><ol class="log">${logItems}</ol></details>`;

  const cols = ['waiting', 'turnaround', 'response'];
  const best = Object.fromEntries(cols.map((k) => [k, Math.min(...all.map((r) => r.averages[k]))]));
  const bestCs = Math.min(...all.map((r) => r.contextSwitches));
  const mark = (v, b) => (Math.abs(v - b) < 1e-9 ? `<strong class="best">${num(v)}</strong>` : num(v));
  const crow = all.map((r) => `<tr><th scope="row">${esc(ALGORITHM_NAMES[r.algorithm])}${r.algorithm === 'rr' ? ` (q = ${r.quantum})` : ''}</th>${cols.map((k) => `<td>${mark(r.averages[k], best[k])}</td>`).join('')}<td>${r.contextSwitches === bestCs ? `<strong class="best">${r.contextSwitches}</strong>` : r.contextSwitches}</td></tr>`).join('');
  $('cpu-compare').innerHTML = `<div class="table-wrap"><table><thead><tr><th scope="col">Algoritmo</th><th scope="col">Espera média</th><th scope="col">Retorno médio</th><th scope="col">Resposta média</th><th scope="col">Trocas de contexto</th></tr></thead><tbody>${crow}</tbody></table></div>${quantumOk ? '' : '<p class="muted small">O Round Robin ficou de fora: informe um quantum inteiro a partir de 1.</p>'}`;
  $('cpu-live').textContent = `${ALGORITHM_NAMES[state.cpuAlg]}: espera média ${num(res.averages.waiting)}, retorno médio ${num(res.averages.turnaround)}, ${res.contextSwitches} ${res.contextSwitches === 1 ? 'troca' : 'trocas'} de contexto.`;
  save();
}

function initCpu() {
  if (!Array.isArray(state.procs) || state.procs.length === 0) {
    setCpuExample(0);
  } else {
    $('cpu-alg').value = state.cpuAlg;
    $('cpu-quantum').value = state.quantum;
    renderProcTable();
    runCpu();
  }
  const later = debounce(runCpu, 200);
  $('proc-table').addEventListener('input', (ev) => {
    const el = ev.target.closest('input[data-i]');
    if (!el) return;
    state.procs[Number(el.dataset.i)][el.dataset.k] = el.value;
    later();
  });
  $('proc-table').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-remove]');
    if (!btn) return;
    state.procs.splice(Number(btn.dataset.remove), 1);
    renderProcTable();
    runCpu();
  });
  $('proc-add').addEventListener('click', () => {
    let k = state.procs.length + 1;
    const used = new Set(state.procs.map((p) => p.id));
    while (used.has(`P${k}`)) k++;
    state.procs.push({ id: `P${k}`, arrival: '0', burst: '1', priority: '0' });
    renderProcTable();
    runCpu();
    const inputs = $('proc-table').querySelectorAll('input[data-k="burst"]');
    inputs[inputs.length - 1].focus();
  });
  document.querySelectorAll('[data-cpu-example]').forEach((b) => b.addEventListener('click', () => setCpuExample(Number(b.dataset.cpuExample))));
  $('cpu-alg').addEventListener('change', () => {
    state.cpuAlg = $('cpu-alg').value;
    runCpu();
  });
  $('cpu-quantum').addEventListener('input', () => {
    state.quantum = $('cpu-quantum').value;
    later();
  });
}

// ---------------------------------------------------------------------------
// Paginação

const pag = { sim: null, refs: [], pos: 0, timer: 0 };

function stopPlayer() {
  clearInterval(pag.timer);
  pag.timer = 0;
  const b = $('pag-play');
  if (b) b.textContent = 'Reproduzir';
}

function runPaging() {
  stopPlayer();
  try {
    const refs = parseReferenceString(state.refs);
    const frames = Number(state.frames);
    if (!Number.isInteger(frames) || frames < 1 || frames > 12) throw new Error('Use de 1 a 12 quadros.');
    pag.refs = refs;
    pag.sim = simulatePaging(refs, frames, state.pagAlg);
    showError('pag-error', '');
  } catch (err) {
    showError('pag-error', err.message);
    pag.sim = null;
    $('pag-table').innerHTML = '';
    $('pag-summary').innerHTML = '';
    $('pag-note').textContent = '';
    $('pag-chart').innerHTML = '';
    $('pag-curve-table').innerHTML = '';
    $('pag-belady-note').innerHTML = '';
    save();
    return;
  }
  $('pag-pos').max = String(pag.refs.length);
  pag.pos = pag.refs.length;
  $('pag-pos').value = String(pag.pos);
  renderFrames();
  renderPagingSummary();
  renderFaultChart();
  save();
}

function renderFrames() {
  const sim = pag.sim;
  if (!sim) return;
  const k = pag.pos;
  const steps = sim.steps;
  const clock = sim.algorithm === 'clock';
  const head = steps.map((s, j) => `<th scope="col"${j === k - 1 ? ' class="cur"' : ''}>${s.ref}</th>`).join('');
  const rows = [];
  for (let f = 0; f < sim.frameCount; f++) {
    const cells = steps.map((s, j) => {
      if (j >= k) return '<td class="future"></td>';
      const page = s.frames[f];
      const cls = [s.fault && s.slot === f ? 'new' : '', j === k - 1 ? 'cur' : ''].filter(Boolean).join(' ');
      const bit = clock && page !== null ? `<sup>${s.bits[f]}</sup>` : '';
      return `<td${cls ? ` class="${cls}"` : ''}>${page === null ? '' : page}${bit}</td>`;
    }).join('');
    const handMark = clock && k > 0 && steps[k - 1].hand === f ? ' <span class="hand" title="ponteiro do relógio">◀ ponteiro</span>' : '';
    rows.push(`<tr><th scope="row">Quadro ${f + 1}${handMark}</th>${cells}</tr>`);
  }
  const faults = steps.map((s, j) => {
    if (j >= k) return '<td class="future"></td>';
    return s.fault ? `<td class="fault${j === k - 1 ? ' cur' : ''}" title="falta de página">F</td>` : `<td class="hit${j === k - 1 ? ' cur' : ''}" title="acerto">✓</td>`;
  }).join('');
  $('pag-table').innerHTML = `<table class="frames"><caption class="sr-only">Estado dos quadros depois de cada referência</caption><thead><tr><th scope="col">Referência</th>${head}</tr></thead><tbody>${rows.join('')}<tr><th scope="row">Falta?</th>${faults}</tr></tbody></table>`;
  const shownFaults = steps.slice(0, k).filter((s) => s.fault).length;
  $('pag-note').innerHTML = k === 0
    ? 'Início: todos os quadros vazios. Use os botões ou o controle deslizante para avançar.'
    : `<strong>Referência ${k} de ${steps.length} (página ${steps[k - 1].ref}):</strong> ${esc(steps[k - 1].note)} Faltas até aqui: ${shownFaults}.`;
  $('pag-pos').value = String(k);
}

function renderPagingSummary() {
  const sim = pag.sim;
  const rows = Object.keys(PAGE_ALGORITHMS).map((alg) => {
    const r = alg === sim.algorithm ? sim : simulatePaging(pag.refs, sim.frameCount, alg);
    return { alg, faults: r.faults, rate: r.faultRate };
  });
  const best = Math.min(...rows.map((r) => r.faults));
  $('pag-summary').innerHTML = `
    <p><strong>${esc(PAGE_ALGORITHMS[sim.algorithm])}</strong> com ${sim.frameCount} ${sim.frameCount === 1 ? 'quadro' : 'quadros'}: <strong>${sim.faults}</strong> ${sim.faults === 1 ? 'falta' : 'faltas'} e ${sim.hits} ${sim.hits === 1 ? 'acerto' : 'acertos'} em ${pag.refs.length} ${pag.refs.length === 1 ? 'referência' : 'referências'} (taxa de faltas ${pct(sim.faultRate)}).</p>
    <div class="table-wrap"><table><thead><tr><th scope="col">Algoritmo</th><th scope="col">Faltas com ${sim.frameCount} quadros</th><th scope="col">Taxa</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><th scope="row">${esc(PAGE_ALGORITHMS[r.alg])}</th><td>${r.faults === best ? `<strong class="best">${r.faults}</strong>` : r.faults}</td><td>${pct(r.rate)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">O OPT precisa conhecer o futuro, então não existe na prática: serve de referência do melhor resultado possível.</p>`;
}

const SERIES = [
  { alg: 'fifo', color: 'var(--s1)', shape: 'circle' },
  { alg: 'lru', color: 'var(--s2)', shape: 'square' },
  { alg: 'opt', color: 'var(--s3)', shape: 'triangle' },
  { alg: 'clock', color: 'var(--s4)', shape: 'diamond' },
];

function marker(shape, x, y, color, title) {
  const t = `<title>${esc(title)}</title>`;
  const common = `fill="${color}" stroke="var(--surface)" stroke-width="2"`;
  if (shape === 'circle') return `<circle cx="${x}" cy="${y}" r="5" ${common}>${t}</circle>`;
  if (shape === 'square') return `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" rx="1.5" ${common}>${t}</rect>`;
  if (shape === 'triangle') return `<path d="M${x},${y - 6} L${x + 5.5},${y + 4} L${x - 5.5},${y + 4} Z" ${common}>${t}</path>`;
  return `<path d="M${x},${y - 6} L${x + 6},${y} L${x},${y + 6} L${x - 6},${y} Z" ${common}>${t}</path>`;
}

function renderFaultChart() {
  const distinct = new Set(pag.refs).size;
  const maxF = Math.min(12, Math.max(distinct, Number(state.frames) + 1, 2));
  const curve = faultCurve(pag.refs, maxF);
  const W = 640;
  const H = 300;
  const L = 44;
  const R = 92;
  const T = 30;
  const B = 40;
  const maxY = Math.max(...Object.values(curve).flat(), 1);
  const yStep = maxY <= 10 ? 1 : maxY <= 25 ? 5 : 10;
  const top = Math.ceil(maxY / yStep) * yStep;
  const x = (f) => L + ((f - 1) / (maxF - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / top) * (H - T - B);
  const parts = [];
  for (let v = 0; v <= top; v += yStep) parts.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
  for (let f = 1; f <= maxF; f++) parts.push(`<text x="${x(f)}" y="${H - B + 18}" text-anchor="middle">${f}</text>`);
  parts.push(`<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`);
  parts.push(`<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">quadros</text>`);
  parts.push(`<text x="${L - 8}" y="14" text-anchor="end">faltas</text>`);
  const anomalies = [];
  for (const s of SERIES) {
    const pts = curve[s.alg].map((v, i) => [x(i + 1), y(v)]);
    parts.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`);
    for (const pnt of beladyPoints(curve[s.alg])) anomalies.push({ alg: s.alg, ...pnt });
  }
  // anéis nas subidas (anomalia de Belady)
  for (const a of anomalies) parts.push(`<circle cx="${x(a.to)}" cy="${y(a.faults[1])}" r="11" fill="none" stroke="var(--danger)" stroke-width="2" stroke-dasharray="3 2"/>`);
  for (const s of SERIES) {
    curve[s.alg].forEach((v, i) => parts.push(marker(s.shape, x(i + 1), y(v), s.color, `${PAGE_ALGORITHMS[s.alg]}, ${i + 1} ${i ? 'quadros' : 'quadro'}: ${v} faltas`)));
  }
  // rótulos diretos no fim de cada linha, afastados para não se sobreporem
  const ends = SERIES.map((s) => ({ s, yy: y(curve[s.alg][maxF - 1]) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
  for (const e of ends) parts.push(`<text class="lbl" x="${W - R + 10}" y="${e.yy + 4}">${esc(PAGE_ALGORITHMS[e.s.alg].split(' ')[0])}</text>`);
  const legend = SERIES.map((s) => `<li><span class="key" style="--c:${s.color}"></span>${esc(PAGE_ALGORITHMS[s.alg])}</li>`).join('');
  $('pag-chart').innerHTML = `<ul class="legend">${legend}</ul><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Faltas de página de 1 a ${maxF} quadros para cada algoritmo">${parts.join('')}</svg>`;
  const head = [...Array(maxF).keys()].map((i) => `<th scope="col">${i + 1}</th>`).join('');
  const body = SERIES.map((s) => `<tr><th scope="row">${esc(PAGE_ALGORITHMS[s.alg])}</th>${curve[s.alg].map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');
  $('pag-curve-table').innerHTML = `<table><thead><tr><th scope="col">Quadros</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const fifo = anomalies.filter((a) => a.alg === 'fifo');
  $('pag-belady-note').innerHTML = anomalies.length
    ? `<div class="callout bad"><strong>Anomalia de Belady nesta sequência:</strong> ${anomalies.map((a) => `${esc(PAGE_ALGORITHMS[a.alg])} passa de ${a.faults[0]} faltas com ${a.from} quadros para ${a.faults[1]} com ${a.to}`).join('; ')}. Mais memória, mais faltas.${fifo.length ? ' O FIFO não é um algoritmo de pilha: o conjunto de páginas na memória com n quadros nem sempre está contido no conjunto com n + 1.' : ''}</div>`
    : '<p class="muted small">Nesta sequência nenhum algoritmo apresenta a anomalia de Belady. Experimente o botão "Demonstrar a anomalia de Belady".</p>';
}

function initPaging() {
  $('pag-refs').value = state.refs;
  $('pag-frames').value = state.frames;
  $('pag-alg').value = state.pagAlg;
  const later = debounce(runPaging, 250);
  $('pag-refs').addEventListener('input', () => { state.refs = $('pag-refs').value; later(); });
  $('pag-frames').addEventListener('input', () => { state.frames = $('pag-frames').value; later(); });
  $('pag-alg').addEventListener('change', () => { state.pagAlg = $('pag-alg').value; runPaging(); });
  $('pag-example').addEventListener('click', () => {
    state.refs = SILBERSCHATZ_STRING.join(' ');
    state.frames = '3';
    $('pag-refs').value = state.refs;
    $('pag-frames').value = '3';
    runPaging();
  });
  $('pag-belady').addEventListener('click', () => {
    state.refs = BELADY_STRING.join(' ');
    state.frames = '4';
    state.pagAlg = 'fifo';
    $('pag-refs').value = state.refs;
    $('pag-frames').value = '4';
    $('pag-alg').value = 'fifo';
    runPaging();
    const three = simulatePaging(BELADY_STRING, 3, 'fifo').faults;
    const four = simulatePaging(BELADY_STRING, 4, 'fifo').faults;
    $('pag-note').innerHTML = `<strong>Anomalia de Belady:</strong> com FIFO, a sequência ${BELADY_STRING.join(', ')} dá ${three} faltas com 3 quadros e ${four} faltas com 4 quadros. A tabela mostra o caso de 4 quadros; troque para 3 e compare.`;
  });
  document.querySelector('.player').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-step]');
    if (!btn || !pag.sim) return;
    stopPlayer();
    const n = pag.refs.length;
    const to = { first: 0, prev: Math.max(0, pag.pos - 1), next: Math.min(n, pag.pos + 1), last: n }[btn.dataset.step];
    pag.pos = to;
    renderFrames();
  });
  $('pag-pos').addEventListener('input', () => {
    stopPlayer();
    pag.pos = Number($('pag-pos').value);
    renderFrames();
  });
  $('pag-play').addEventListener('click', () => {
    if (!pag.sim) return;
    if (pag.timer) {
      stopPlayer();
      return;
    }
    if (pag.pos >= pag.refs.length) pag.pos = 0;
    $('pag-play').textContent = 'Pausar';
    renderFrames();
    pag.timer = setInterval(() => {
      if (pag.pos >= pag.refs.length) {
        stopPlayer();
        return;
      }
      pag.pos++;
      renderFrames();
    }, Number($('pag-speed').value));
  });
  runPaging();
}

// ---------------------------------------------------------------------------
// Deadlock: banqueiro

const BANK_EXAMPLE = {
  n: 5,
  m: 3,
  useTotal: false,
  allocation: [[0, 1, 0], [2, 0, 0], [3, 0, 2], [2, 1, 1], [0, 0, 2]],
  max: [[7, 5, 3], [3, 2, 2], [9, 0, 2], [2, 2, 2], [4, 3, 3]],
  available: [3, 3, 2],
  total: [10, 5, 7],
};

function bankStr(b) {
  return {
    n: b.n,
    m: b.m,
    useTotal: b.useTotal,
    allocation: b.allocation.map((r) => r.map(String)),
    max: b.max.map((r) => r.map(String)),
    available: b.available.map(String),
    total: b.total.map(String),
  };
}

function resizeBank(n, m) {
  const b = state.bank;
  const grow = (rows, r, c) => Array.from({ length: r }, (_, i) => Array.from({ length: c }, (__, j) => (rows[i] && rows[i][j] !== undefined ? rows[i][j] : '0')));
  b.allocation = grow(b.allocation, n, m);
  b.max = grow(b.max, n, m);
  b.available = Array.from({ length: m }, (_, j) => b.available[j] ?? '0');
  b.total = Array.from({ length: m }, (_, j) => b.total[j] ?? '0');
  b.n = n;
  b.m = m;
}

function renderBankInputs() {
  const b = state.bank;
  const res = RES_NAMES.slice(0, b.m);
  const matrix = (key, title) => {
    const head = `<tr><th scope="col"></th>${res.map((r) => `<th scope="col">${r}</th>`).join('')}</tr>`;
    const rows = b[key].map((row, i) => `<tr><th scope="row">${processName(i)}</th>${row.map((v, j) => `<td><input type="number" min="0" data-bank="${key}" data-i="${i}" data-j="${j}" value="${esc(v)}" aria-label="${title}, ${processName(i)}, recurso ${res[j]}"></td>`).join('')}</tr>`).join('');
    return `<table><caption>${title}</caption><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  };
  const vecKey = b.useTotal ? 'total' : 'available';
  const vecTitle = b.useTotal ? 'Total' : 'Disponível';
  const vec = `<table><caption>${vecTitle}</caption><thead><tr>${res.map((r) => `<th scope="col">${r}</th>`).join('')}</tr></thead><tbody><tr>${b[vecKey].map((v, j) => `<td><input type="number" min="0" data-bank="${vecKey}" data-j="${j}" value="${esc(v)}" aria-label="${vecTitle}, recurso ${res[j]}"></td>`).join('')}</tr></tbody></table>`;
  $('bank-inputs').innerHTML = `<div class="table-wrap">${matrix('allocation', 'Alocação')}</div><div class="table-wrap">${matrix('max', 'Máximo')}</div><div class="table-wrap">${vec}</div>`;
  $('req-proc').innerHTML = [...Array(b.n).keys()].map((i) => `<option value="${i}">${processName(i)}</option>`).join('');
  $('req-inputs').innerHTML = res.map((r, j) => `<label>${r}<input type="number" min="0" value="0" data-req="${j}" aria-label="Pedido do recurso ${r}"></label>`).join('');
}

function readBank() {
  const b = state.bank;
  const toInt = (v) => {
    const x = Number(v);
    if (String(v).trim() === '' || !Number.isInteger(x) || x < 0) throw new Error('Use só inteiros maiores ou iguais a zero.');
    return x;
  };
  const allocation = b.allocation.map((r) => r.map(toInt));
  const max = b.max.map((r) => r.map(toInt));
  const available = b.useTotal ? availableFromTotal(b.total.map(toInt), allocation) : b.available.map(toInt);
  return bankState({ allocation, max, available });
}

const vecText = (v) => `(${v.join(', ')})`;

function safetyTableHTML(res, st, needLabel = 'Need') {
  const rows = res.steps.map((s, k) => {
    const first = k > 0 && s.pass !== res.steps[k - 1].pass;
    return `<tr${first ? ' class="pass-start"' : ''}><td>${s.pass}ª</td><th scope="row">${processName(s.process)}</th><td>${vecText(s.need)}</td><td>${vecText(s.work)}</td><td class="${s.fits ? 'yes' : 'no'}">${s.fits ? 'sim: termina e devolve ' + vecText(st.allocation[s.process]) : 'não: espera'}</td><td>${vecText(s.workAfter)}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="steps"><thead><tr><th scope="col">Varredura</th><th scope="col">Processo</th><th scope="col">${needLabel}</th><th scope="col">Work antes</th><th scope="col">${needLabel} ≤ Work?</th><th scope="col">Work depois</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function runBank() {
  let st;
  try {
    st = readBank();
    showError('bank-error', '');
  } catch (err) {
    showError('bank-error', err.message);
    $('bank-result').innerHTML = '';
    save();
    return null;
  }
  const res = RES_NAMES.slice(0, st.m);
  const res2 = safety(st);
  const needRows = st.need.map((row, i) => `<tr><th scope="row">${processName(i)}</th>${row.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');
  const verdict = res2.safe
    ? `<div class="callout ok"><strong>Estado seguro.</strong> Sequência segura: ${res2.sequence.map(processName).join(', ')}. Existe pelo menos uma ordem em que todos conseguem terminar, mesmo se cada um pedir o seu máximo.</div>`
    : `<div class="callout bad"><strong>Estado inseguro.</strong> ${res2.finish.map((f, i) => (f ? null : processName(i))).filter(Boolean).join(', ')} não ${res2.finish.filter((f) => !f).length === 1 ? 'consegue' : 'conseguem'} terminar no pior caso. Inseguro não quer dizer deadlock certo, mas o sistema perdeu a garantia de evitá-lo.</div>`;
  $('bank-live').textContent = res2.safe ? `Estado seguro: ${res2.sequence.map(processName).join(', ')}.` : 'Estado inseguro.';
  $('bank-result').innerHTML = `
    ${state.bank.useTotal ? `<p>Disponível = total - soma das alocações = <strong>${vecText(st.available)}</strong>.</p>` : ''}
    <h3>Necessidade (Need = Máximo - Alocação)</h3>
    <div class="table-wrap"><table><thead><tr><th scope="col"></th>${res.map((r) => `<th scope="col">${r}</th>`).join('')}</tr></thead><tbody>${needRows}</tbody></table></div>
    <h3>Algoritmo de segurança</h3>
    <p class="small">Começamos com Work = Disponível = ${vecText(st.available)} e varremos os processos em ordem. Quem tem Need ≤ Work pode terminar e devolver tudo o que tem (Work += Alocação). As varreduras se repetem até ninguém mais avançar.</p>
    ${safetyTableHTML(res2, st)}
    ${verdict}`;
  save();
  return st;
}

function runRequest() {
  const st = runBank();
  if (!st) return;
  const i = Number($('req-proc').value);
  const req = [...$('req-inputs').querySelectorAll('input')].map((el) => Number(el.value));
  let out;
  try {
    out = requestResources(st, i, req);
  } catch (err) {
    $('req-result').innerHTML = `<p class="error-line">${esc(err.message)}</p>`;
    return;
  }
  const head = `<p>${processName(i)} pede ${vecText(req)}. Need de ${processName(i)} = ${vecText(st.need[i])}; Disponível = ${vecText(st.available)}.</p>`;
  let body = `<div class="callout ${out.granted ? 'ok' : 'bad'}">${esc(out.text)}</div>`;
  if (out.safety) {
    body += `<p class="small">Fingindo que o pedido foi atendido: Disponível vira ${vecText(out.trial.available)}, Alocação de ${processName(i)} vira ${vecText(out.trial.allocation[i])} e Need vira ${vecText(out.trial.need[i])}. Rodamos o algoritmo de segurança nesse estado:</p>${safetyTableHTML(out.safety, out.trial)}`;
  }
  if (out.granted) body += '<button type="button" class="btn" id="req-apply">Aplicar o pedido às matrizes</button>';
  $('req-result').innerHTML = head + body;
  const apply = $('req-apply');
  if (apply) {
    apply.addEventListener('click', () => {
      // refaz o pedido com as matrizes de agora (podem ter mudado depois da simulação)
      let again;
      try {
        again = requestResources(readBank(), i, req);
      } catch (err) {
        $('req-result').innerHTML = `<p class="error-line">${esc(err.message)}</p>`;
        return;
      }
      if (!again.granted) {
        $('req-result').innerHTML = `<div class="callout bad">As matrizes mudaram e o pedido não pode mais ser concedido: ${esc(again.text)}</div>`;
        return;
      }
      const b = state.bank;
      b.allocation[i] = again.trial.allocation[i].map(String);
      if (!b.useTotal) b.available = again.trial.available.map(String);
      renderBankInputs();
      runBank();
      $('req-result').innerHTML = `<div class="callout ok">Pedido aplicado: ${processName(i)} agora tem ${vecText(again.trial.allocation[i])}.</div>`;
    });
  }
}

function initBank() {
  if (!state.bank || !Array.isArray(state.bank.allocation)) state.bank = bankStr(BANK_EXAMPLE);
  const nSel = $('bank-n');
  const mSel = $('bank-m');
  nSel.innerHTML = [...Array(8).keys()].map((i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  mSel.innerHTML = [...Array(5).keys()].map((i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
  const sync = () => {
    $('req-result').innerHTML = '';
    nSel.value = String(state.bank.n);
    mSel.value = String(state.bank.m);
    $('bank-total').checked = Boolean(state.bank.useTotal);
    renderBankInputs();
    runBank();
  };
  nSel.addEventListener('change', () => { resizeBank(Number(nSel.value), state.bank.m); sync(); });
  mSel.addEventListener('change', () => { resizeBank(state.bank.n, Number(mSel.value)); sync(); });
  $('bank-total').addEventListener('change', () => { state.bank.useTotal = $('bank-total').checked; sync(); });
  $('bank-example').addEventListener('click', () => { state.bank = bankStr(BANK_EXAMPLE); $('req-result').innerHTML = ''; sync(); });
  const later = debounce(runBank, 200);
  $('bank-inputs').addEventListener('input', (ev) => {
    const el = ev.target.closest('input[data-bank]');
    if (!el) return;
    const key = el.dataset.bank;
    if (key === 'available' || key === 'total') state.bank[key][Number(el.dataset.j)] = el.value;
    else state.bank[key][Number(el.dataset.i)][Number(el.dataset.j)] = el.value;
    $('req-result').innerHTML = ''; // a simulação anterior deixou de valer
    later();
  });
  $('req-go').addEventListener('click', runRequest);
  sync();
}

// ---------------------------------------------------------------------------
// Deadlock: grafo de alocação de recursos

const RAG_EXAMPLES = [
  '# P1 segura R1 e espera R2; P2 segura R2 e espera R1\nR1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1',
  '# ciclo P1 -> R1 -> P3 -> R2 -> P1, mas P2 e P4 vão liberar instâncias\nR1: 2\nR2: 2\nP1 -> R1\nR1 -> P2\nR1 -> P3\nP3 -> R2\nR2 -> P1\nR2 -> P4',
  '# P2 espera R1, que está com P1; P1 não espera ninguém\nR1 -> P1\nP2 -> R1\nR2 -> P2',
];

function ragSVG(graph, cycleEdges) {
  const W = 620;
  const H = 300;
  const procY = 60;
  const resY = 230;
  const xs = (k, total) => (total === 1 ? W / 2 : 60 + (k * (W - 120)) / (total - 1));
  const pos = new Map();
  graph.processes.forEach((p, k) => pos.set(p, { x: xs(k, graph.processes.length), y: procY, kind: 'p' }));
  graph.resources.forEach((r, k) => pos.set(r, { x: xs(k, graph.resources.length), y: resY, kind: 'r' }));
  const parts = [`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker><marker id="arr-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--danger)"/></marker></defs>`];
  const pairs = new Set(graph.edges.map((e) => `${e.from}>${e.to}`));
  for (const e of graph.edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    const both = pairs.has(`${e.to}>${e.from}`);
    const off = both ? (e.kind === 'pedido' ? -7 : 7) : 0;
    const y1 = a.kind === 'p' ? a.y + 22 : a.y - 20;
    const y2 = b.kind === 'p' ? b.y + 26 : b.y - 24;
    const bad = cycleEdges.has(`${e.from}>${e.to}`);
    const color = bad ? 'var(--danger)' : 'currentColor';
    parts.push(`<line x1="${a.x + off}" y1="${y1}" x2="${b.x + off}" y2="${y2}" stroke="${color}" stroke-width="${bad ? 2.6 : 1.6}"${e.kind === 'pedido' ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#${bad ? 'arr-bad' : 'arr'})"><title>${esc(`${e.from} → ${e.to}: ${e.kind === 'pedido' ? 'pedido' : 'atribuição'}${e.count > 1 ? ` (${e.count})` : ''}`)}</title></line>`);
    if (e.count > 1) parts.push(`<text x="${(a.x + b.x) / 2 + off + 6}" y="${(y1 + y2) / 2}" class="lbl">×${e.count}</text>`);
  }
  for (const p of graph.processes) {
    const { x, y } = pos.get(p);
    parts.push(`<circle cx="${x}" cy="${y}" r="22" fill="var(--surface)" stroke="currentColor" stroke-width="2"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="lbl">${esc(p)}</text>`);
  }
  for (const r of graph.resources) {
    const { x, y } = pos.get(r);
    const k = graph.instances.get(r);
    const w = Math.max(56, 14 * Math.min(k, 6) + 16);
    parts.push(`<rect x="${x - w / 2}" y="${y - 20}" width="${w}" height="40" rx="4" fill="var(--surface)" stroke="currentColor" stroke-width="2"/>`);
    for (let d = 0; d < Math.min(k, 6); d++) parts.push(`<circle cx="${x - ((Math.min(k, 6) - 1) * 14) / 2 + d * 14}" cy="${y + 8}" r="3.5" fill="currentColor"/>`);
    parts.push(`<text x="${x}" y="${y - 3}" text-anchor="middle" class="lbl">${esc(r)}${k > 6 ? ` (${k})` : ''}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafo de alocação de recursos: processos em círculos, recursos em retângulos com uma bolinha por instância">${parts.join('')}</svg>
    <p class="muted small">Círculos: processos. Retângulos: recursos (uma bolinha por instância). Tracejado: pedido. Contínuo: atribuição.${cycleEdges.size ? ' Em vermelho: arestas em ciclo.' : ''}</p>`;
}

function runRag() {
  let graph;
  let det;
  try {
    graph = parseGraph(state.rag);
    if (graph.processes.length === 0) throw new Error('Inclua pelo menos um processo (nomes começando com P).');
    det = detectDeadlock(graph);
    showError('rag-error', '');
  } catch (err) {
    showError('rag-error', err.message);
    $('rag-svg').innerHTML = '';
    $('rag-result').innerHTML = '';
    $('rag-live').textContent = '';
    save();
    return;
  }
  const cycleEdges = new Set();
  for (const c of det.cycles) c.forEach((node, k) => cycleEdges.add(`${node}>${c[(k + 1) % c.length]}`));
  $('rag-svg').innerHTML = ragSVG(graph, cycleEdges);
  const R = graph.resources;
  const cycles = det.cycles.length
    ? `<p>${det.cycles.length === 1 ? 'Ciclo encontrado' : `${det.cycles.length} ciclos encontrados`} (busca em profundidade)${det.cyclesTruncated ? ', listagem interrompida (há ainda mais ciclos)' : ''}:</p><ul>${det.cycles.map((c) => `<li><code>${esc([...c, c[0]].join(' → '))}</code></li>`).join('')}</ul>`
    : '<p>Nenhum ciclo no grafo (busca em profundidade).</p>';
  $('rag-live').textContent = det.deadlocked.length ? `Deadlock: ${det.deadlocked.join(', ')}.` : 'Sem deadlock.';
  let verdict;
  if (det.deadlocked.length) {
    verdict = `<div class="callout bad"><strong>Deadlock:</strong> ${esc(det.deadlocked.join(', '))} ${det.deadlocked.length === 1 ? 'está bloqueado' : 'estão bloqueados'} para sempre. ${det.singleInstance ? 'Com uma instância por recurso, ciclo no grafo é o mesmo que deadlock.' : 'O algoritmo de detecção confirma: nenhuma ordem de liberação atende esses processos.'}</div>`;
  } else if (det.cycles.length) {
    verdict = `<div class="callout ok"><strong>Há ciclo, mas não há deadlock.</strong> Com recursos de várias instâncias, ciclo é condição necessária, não suficiente. A ordem ${det.sequence.map((i) => graph.processes[i]).join(', ')} permite que todos terminem${det.holdsNothing.some(Boolean) ? ' (quem não segura recurso já começa como terminado)' : ''}.</div>`;
  } else {
    verdict = '<div class="callout ok"><strong>Sem deadlock:</strong> sem ciclo não há espera circular, uma das quatro condições de Coffman.</div>';
  }
  const mat = (M) => `<table><thead><tr><th scope="col"></th>${R.map((r) => `<th scope="col">${esc(r)}</th>`).join('')}</tr></thead><tbody>${M.map((row, i) => `<tr><th scope="row">${esc(graph.processes[i])}</th>${row.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const steps = det.steps.map((s) => `<tr><td>${s.pass}ª</td><th scope="row">${esc(graph.processes[s.process])}</th><td>${vecText(s.need)}</td><td>${vecText(s.work)}</td><td class="${s.fits ? 'yes' : 'no'}">${s.fits ? 'sim: termina e libera' : 'não'}</td><td>${vecText(s.workAfter)}</td></tr>`).join('');
  $('rag-result').innerHTML = `${cycles}${verdict}
    <details class="sub"><summary>Algoritmo de detecção (matrizes e varreduras)</summary>
      <p class="small">Instâncias: ${R.map((r) => `${esc(r)} = ${graph.instances.get(r)}`).join(', ')}. Disponível = ${vecText(det.available)}.</p>
      <div class="bank-grid"><div class="table-wrap"><p><strong>Alocação</strong></p>${mat(det.allocation)}</div><div class="table-wrap"><p><strong>Pedido</strong></p>${mat(det.request)}</div></div>
      ${det.holdsNothing.some(Boolean) ? `<p class="small">${esc(graph.processes.filter((_, i) => det.holdsNothing[i]).join(', '))} não ${det.holdsNothing.filter(Boolean).length === 1 ? 'segura' : 'seguram'} nenhum recurso: começa${det.holdsNothing.filter(Boolean).length === 1 ? '' : 'm'} como terminado${det.holdsNothing.filter(Boolean).length === 1 ? '' : 's'}.</p>` : ''}
      <div class="table-wrap"><table class="steps"><thead><tr><th scope="col">Varredura</th><th scope="col">Processo</th><th scope="col">Pedido</th><th scope="col">Work antes</th><th scope="col">Pedido ≤ Work?</th><th scope="col">Work depois</th></tr></thead><tbody>${steps || '<tr><td colspan="6">Nenhum processo precisou ser verificado.</td></tr>'}</tbody></table></div>
    </details>`;
  save();
}

function initRag() {
  if (!state.rag) state.rag = RAG_EXAMPLES[0];
  $('rag-text').value = state.rag;
  const later = debounce(runRag, 250);
  $('rag-text').addEventListener('input', () => { state.rag = $('rag-text').value; later(); });
  document.querySelectorAll('[data-rag]').forEach((b) => b.addEventListener('click', () => {
    state.rag = RAG_EXAMPLES[Number(b.dataset.rag)];
    $('rag-text').value = state.rag;
    runRag();
  }));
  runRag();
}

// ---------------------------------------------------------------------------
// Memória

const MEM_EXAMPLES = [
  { mode: 'parts', parts: '100, 500, 200, 300, 600', ops: 'P1 212\nP2 417\nP3 112\nP4 426' },
  { mode: 'total', total: '1000', ops: 'P1 300\nP2 200\nP3 250\nP4 150\nliberar P2\nliberar P4\nP5 320\nP6 100' },
];

const mem = { sim: null, initial: null, names: [], pos: 0 };

function memInput() {
  const ops = parseOperations(state.memOps);
  if (state.memMode === 'parts') {
    return { partitions: parseSizes(state.memParts), ops, split: !state.memFixed };
  }
  const total = Number(state.memTotal);
  if (!Number.isInteger(total) || total < 1 || total > 1000000) throw new Error('O tamanho total precisa ser um inteiro entre 1 e 1000000.');
  return { total, ops, split: true };
}

function membarHTML(layout) {
  const segs = layout.map((s) => {
    if (s.kind === 'barrier') return '<div class="ms barrier" title="memória de outro dono (separa as partições)"></div>';
    if (s.kind === 'free') return `<div class="ms free" style="flex:${s.size} 1 0" title="livre: ${s.size} (endereço ${s.start})"><span>livre</span><span>${s.size}</span></div>`;
    const idx = mem.names.indexOf(s.name);
    const waste = s.size > s.request ? `<div class="waste" style="width:${((s.size - s.request) / s.size) * 100}%" title="fragmentação interna: ${s.size - s.request}"></div>` : '';
    return `<div class="ms used" style="flex:${s.size} 1 0;--c:${seriesColor(idx % 8)}" title="${esc(s.name)}: ${s.request}${s.size > s.request ? ` numa partição de ${s.size}` : ''} (endereço ${s.start})">${waste}<span>${esc(s.name)}</span><span>${s.request}</span></div>`;
  }).join('');
  const sr = layout.filter((s) => s.kind !== 'barrier').map((s) => (s.kind === 'free' ? `livre ${s.size}` : `${s.name} ${s.request}`)).join(', ');
  return `<div class="mem-legend"><span><i class="k-free"></i>lacuna livre</span>${state.memMode === 'parts' ? '<span><i class="k-bar"></i>separação entre partições</span>' : ''}${state.memFixed && state.memMode === 'parts' ? '<span><i class="k-waste"></i>fragmentação interna</span>' : ''}</div><div class="membar" aria-hidden="true">${segs}</div><p class="sr-only">Memória: ${esc(sr)}.</p>`;
}

function statsHTML(stats, sim) {
  const fixed = !sim.split;
  return `<div class="metrics">
    <div class="metric"><b>${stats.totalFree}</b><span>livre no total</span></div>
    <div class="metric"><b>${stats.largestHole}</b><span>maior lacuna</span></div>
    <div class="metric"><b>${stats.holes}</b><span>lacunas</span></div>
    ${fixed ? `<div class="metric"><b>${stats.internalFragmentation}</b><span>fragmentação interna</span></div>` : `<div class="metric"><b>${pct(stats.externalFragmentation)}</b><span>fragmentação externa</span></div>`}
    <div class="metric"><b>${sim.failed.length}</b><span>não couberam</span></div>
  </div>
  <p class="muted small">${fixed ? 'Fragmentação interna: espaço desperdiçado dentro das partições ocupadas (partição maior que o processo).' : 'Fragmentação externa = 1 - maior lacuna / livre total: quanto do espaço livre está picado em lacunas menores que a maior.'}</p>`;
}

function renderMemStep() {
  const sim = mem.sim;
  if (!sim) return;
  const k = mem.pos;
  const layout = k === 0 ? mem.initial : sim.steps[k - 1].layout;
  $('mem-bar').innerHTML = membarHTML(layout);
  $('mem-note').innerHTML = k === 0
    ? 'Memória inicial, antes de qualquer operação.'
    : `<strong>Operação ${k} de ${sim.steps.length}:</strong> ${esc(sim.steps[k - 1].text)}`;
  $('mem-pos').value = String(k);
  document.querySelectorAll('#mem-steps li').forEach((li, i) => li.classList.toggle('cur', i === k - 1));
  document.querySelectorAll('#mem-steps button').forEach((b, i) => b.setAttribute('aria-current', i === k - 1 ? 'step' : 'false'));
}

function runMem() {
  let input;
  try {
    input = memInput();
    mem.sim = simulateMemory({ ...input, algorithm: state.memAlg });
    mem.initial = simulateMemory({ ...input, ops: [], algorithm: state.memAlg }).layout;
    showError('mem-error', '');
  } catch (err) {
    showError('mem-error', err.message);
    mem.sim = null;
    for (const id of ['mem-bar', 'mem-stats', 'mem-steps', 'mem-compare']) $(id).innerHTML = '';
    $('mem-note').textContent = '';
    save();
    return;
  }
  mem.names = [...new Set(input.ops.map((o) => o.name))];
  $('mem-pos').max = String(mem.sim.steps.length);
  mem.pos = mem.sim.steps.length;
  $('mem-steps').innerHTML = mem.sim.steps.map((s, i) => `<li class="${s.ok ? '' : 'fail'}"><button type="button" class="linkish" data-step="${i + 1}">${esc(s.text)}</button></li>`).join('');
  $('mem-stats').innerHTML = statsHTML(mem.sim.stats, mem.sim);
  const all = compareFits(input);
  const fixed = !input.split;
  const rows = all.map((r) => `<tr><th scope="row">${esc(FIT_ALGORITHMS[r.algorithm])}</th><td>${r.steps.filter((s) => s.ok && s.op.type === 'alloc').length}</td><td>${r.failed.length ? esc(r.failed.join(', ')) : 'nenhum'}</td><td>${r.stats.totalFree}</td><td>${r.stats.largestHole}</td><td>${fixed ? r.stats.internalFragmentation : pct(r.stats.externalFragmentation)}</td></tr>`).join('');
  $('mem-compare').innerHTML = `<div class="table-wrap"><table><thead><tr><th scope="col">Algoritmo</th><th scope="col">Alocações feitas</th><th scope="col">Não couberam</th><th scope="col">Livre</th><th scope="col">Maior lacuna</th><th scope="col">${fixed ? 'Fragmentação interna' : 'Fragmentação externa'}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">Best fit tende a deixar lacunas minúsculas; worst fit tenta deixar sobras grandes e reaproveitáveis; next fit espalha as alocações pela memória. Nenhum vence sempre: depende da sequência de pedidos.</p>`;
  renderMemStep();
  save();
}

function initMem() {
  const apply = () => {
    document.querySelectorAll('input[name="mem-mode"]').forEach((r) => { r.checked = r.value === state.memMode; });
    $('mem-parts').value = state.memParts;
    $('mem-total').value = state.memTotal;
    $('mem-alg').value = state.memAlg;
    $('mem-fixed').checked = Boolean(state.memFixed);
    $('mem-ops').value = state.memOps;
    $('mem-parts-wrap').hidden = state.memMode !== 'parts';
    $('mem-fixed-wrap').hidden = state.memMode !== 'parts';
    $('mem-total-wrap').hidden = state.memMode !== 'total';
  };
  apply();
  const later = debounce(runMem, 250);
  document.querySelectorAll('input[name="mem-mode"]').forEach((r) => r.addEventListener('change', () => {
    state.memMode = r.value;
    apply();
    runMem();
  }));
  $('mem-parts').addEventListener('input', () => { state.memParts = $('mem-parts').value; later(); });
  $('mem-total').addEventListener('input', () => { state.memTotal = $('mem-total').value; later(); });
  $('mem-ops').addEventListener('input', () => { state.memOps = $('mem-ops').value; later(); });
  $('mem-alg').addEventListener('change', () => { state.memAlg = $('mem-alg').value; runMem(); });
  $('mem-fixed').addEventListener('change', () => { state.memFixed = $('mem-fixed').checked; runMem(); });
  $('mem-pos').addEventListener('input', () => { mem.pos = Number($('mem-pos').value); renderMemStep(); });
  $('mem-steps').addEventListener('click', (ev) => {
    const li = ev.target.closest('[data-step]');
    if (!li) return;
    mem.pos = Number(li.dataset.step);
    renderMemStep();
  });
  document.querySelectorAll('[data-mem]').forEach((b) => b.addEventListener('click', () => {
    const ex = MEM_EXAMPLES[Number(b.dataset.mem)];
    state.memMode = ex.mode;
    if (ex.parts) state.memParts = ex.parts;
    if (ex.total) state.memTotal = ex.total;
    state.memOps = ex.ops;
    apply();
    runMem();
  }));
  runMem();
}

// ---------------------------------------------------------------------------

function init() {
  window.addEventListener('resize', debounce(() => { if (state.tab === 'tab-cpu') runCpu(); }, 200));
  load();
  initCpu();
  initPaging();
  initBank();
  initRag();
  initMem();
  initTabs();
}

init();
