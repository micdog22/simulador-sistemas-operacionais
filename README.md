# Simulador de Sistemas Operacionais

Simulador para estudar os quatro assuntos que mais caem na prova de Sistemas Operacionais: escalonamento de CPU, substituição de páginas, deadlock e alocação de memória. Cada decisão do algoritmo aparece explicada, e os exemplos clássicos dos livros batem com os números das listas de exercícios.

**Acesse online:** https://micdog22.github.io/simulador-sistemas-operacionais/

## Recursos

- **Escalonamento de CPU:** FCFS, SJF, SRTF, prioridade com e sem preempção e Round Robin com quantum configurável.
  - Gráfico de Gantt com os instantes de cada troca, inclusive períodos de CPU ociosa.
  - Tempos de espera, retorno (turnaround) e resposta por processo, com as médias.
  - Trocas de contexto, uso da CPU e um registro de cada decisão (no Round Robin, com o estado da fila).
  - Tabela comparando os seis algoritmos com a mesma entrada.
- **Substituição de páginas:** FIFO, LRU, OPT e Relógio (segunda chance).
  - Tabela dos quadros animada (reproduzir, pausar, avançar e voltar), com a explicação de cada falta e os bits de referência e o ponteiro do Relógio.
  - Gráfico de faltas por número de quadros para os quatro algoritmos, marcando onde aparece a **anomalia de Belady**, com um botão que monta o exemplo clássico: `1 2 3 4 1 2 5 1 2 3 4 5` dá 9 faltas com 3 quadros e 10 com 4 no FIFO.
- **Deadlock:**
  - Algoritmo do banqueiro com a matriz Need, cada comparação do algoritmo de segurança e a sequência segura.
  - Simulação de pedidos (concede, espera ou nega por estado inseguro), com opção de aplicar o pedido às matrizes.
  - Grafo de alocação de recursos desenhado a partir de um texto simples, com ciclos destacados e o algoritmo de detecção para recursos com várias instâncias.
- **Alocação de memória:** first fit, best fit, worst fit e next fit.
  - Lista de partições (como nos exercícios) ou memória contínua com alocações e liberações.
  - Partições variáveis (com coalescência das lacunas) ou fixas (com fragmentação interna).
  - Barra da memória passo a passo, fragmentação externa e comparação dos quatro algoritmos.
- Funciona no celular, tem tema claro e escuro, abas navegáveis pelo teclado e lembra o que você digitou.

## Como usar

Escolha a aba e clique em um dos exemplos, ou digite os seus dados. Alguns resultados dos exemplos:

| Exemplo | Resultado |
|---|---|
| P1 = 24, P2 = 3, P3 = 3, todos em 0, FCFS | espera média 17 (e 3 com SJF) |
| mesmo conjunto, Round Robin com quantum 4 | Gantt `P1 0-4, P2 4-7, P3 7-10, P1 10-30`, espera média 5,67 |
| P1 (0, 8), P2 (1, 4), P3 (2, 9), P4 (3, 5), SRTF | espera média 6,5 |
| referências `7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1`, 3 quadros | FIFO 15, LRU 12, OPT 9 e Relógio 14 faltas |
| banqueiro com 5 processos e recursos A, B, C (exemplo clássico) | estado seguro, sequência P1, P3, P4, P0, P2 |
| partições 100, 500, 200, 300, 600 e processos 212, 417, 112, 426 | best fit aloca os quatro; first, worst e next fit deixam o de 426 esperando |

No grafo de alocação, cada linha é uma aresta:

```
R1: 2          # R1 tem duas instâncias (sem declarar, vale 1)
P1 -> R1       # P1 pede uma instância de R1
R1 -> P2       # uma instância de R1 está com P2
R2 -> P3 x2    # duas instâncias de R2 estão com P3
```

Na memória, as operações são `P1 212` para alocar e `liberar P1` (ou `-P1`) para liberar.

## Como rodar localmente

Os módulos ES não carregam via `file://`, então sirva a pasta:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`; não há dependências para instalar). Os testes usam exemplos de livro-texto com os valores esperados calculados à mão e escritos no próprio teste: os cenários de FCFS, SJF, SRTF, prioridade e Round Robin (inclusive um com chegadas no meio do quantum), a sequência de 20 referências com 3 quadros nos quatro algoritmos, a anomalia de Belady, o banqueiro clássico com os três pedidos do livro, o algoritmo de detecção do livro e o exemplo de partições 100, 500, 200, 300, 600. Também há invariantes em cargas aleatórias com semente fixa: cada processo roda exatamente a sua duração, o SRTF nunca perde no tempo médio de retorno, o OPT nunca tem mais faltas que os outros, LRU e OPT nunca mostram a anomalia de Belady e a memória nunca tem buracos nem lacunas vizinhas sem juntar.

## Como funciona

### Escalonamento

A simulação avança de unidade em unidade de tempo (no Round Robin, de fatia em fatia). Em cada instante, o algoritmo escolhe entre os processos prontos:

- **FCFS:** quem chegou primeiro, até terminar.
- **SJF:** o de menor duração, até terminar. Com todos chegando juntos, minimiza a espera média.
- **SRTF:** o de menor tempo **restante**; quem chega com menos trabalho interrompe quem está rodando. Minimiza o tempo médio de retorno entre todas as políticas possíveis.
- **Prioridade:** o de menor número; na versão preemptiva, uma chegada mais prioritária interrompe. Processos de baixa prioridade podem sofrer *starvation* (inanição).
- **Round Robin:** fila circular; cada processo roda no máximo um quantum e volta para o fim da fila. Quantum grande vira FCFS; quantum pequeno demais gasta tudo em trocas de contexto.

Regras de desempate (as listas de exercício variam, por isso ficam explícitas): vence quem chegou primeiro e, depois, quem está mais acima na lista; nos preemptivos, empate não interrompe quem está rodando; no Round Robin, um processo que chega exatamente quando o quantum acaba entra na fila **antes** do processo interrompido.

As métricas: **retorno** = término - chegada; **espera** = retorno - duração; **resposta** = primeira vez na CPU - chegada. A troca de contexto é contada quando a CPU passa a executar um processo diferente do último que executou (a primeira carga não conta).

### Substituição de páginas

Numa falta com quadro livre, a página ocupa o primeiro livre. Sem quadro livre:

- **FIFO** tira a que entrou há mais tempo.
- **LRU** tira a que foi usada há mais tempo.
- **OPT** tira a que vai demorar mais para ser usada de novo (ou nunca mais). É o mínimo teórico, mas exige conhecer o futuro.
- **Relógio** percorre os quadros em círculo: página com bit de referência 1 ganha uma segunda chance (o bit vira 0 e o ponteiro avança); a primeira com bit 0 sai. Aqui o bit vai para 1 quando a página é carregada e a cada acerto.

**Anomalia de Belady:** no FIFO, aumentar o número de quadros pode aumentar as faltas. LRU e OPT são *algoritmos de pilha*: as páginas na memória com `n` quadros são sempre um subconjunto das páginas com `n + 1`, então mais memória nunca piora. O FIFO não tem essa propriedade.

### Deadlock

O **algoritmo do banqueiro** evita deadlock negando pedidos que levariam a um estado inseguro. Com `Need = Máximo - Alocação`, o algoritmo de segurança começa com `Work = Disponível` e procura um processo com `Need ≤ Work`: ele pode terminar mesmo pedindo tudo o que declarou, e ao terminar devolve o que tem (`Work += Alocação`). Se todos conseguem terminar em alguma ordem, o estado é seguro. Para um pedido, o banqueiro confere se ele cabe no Need e no Disponível, finge que concedeu e roda o algoritmo de segurança: se o estado ficar inseguro, o processo espera.

No **grafo de alocação de recursos**, uma busca em profundidade lista os ciclos simples. Se todo recurso tem uma instância só, ciclo é o mesmo que deadlock. Com várias instâncias, ciclo é necessário mas não suficiente, e quem decide é o **algoritmo de detecção**: igual ao de segurança, mas com os pedidos atuais no lugar de Need, e começando com os processos que não seguram nada já marcados como terminados. Quem nunca consegue terminar está em deadlock.

### Alocação de memória

A memória é uma lista de segmentos ocupados e lacunas, em ordem de endereço. Para cada pedido:

- **First fit:** a primeira lacuna onde cabe.
- **Best fit:** a menor lacuna onde cabe (sobra o mínimo, mas surgem lacunas minúsculas).
- **Worst fit:** a maior lacuna (a sobra tende a ser reaproveitável).
- **Next fit:** como o first fit, mas começando de onde parou a última alocação.

Com partições variáveis, o processo ocupa o começo da lacuna e o resto vira uma lacuna menor; ao liberar, lacunas vizinhas se juntam. **Fragmentação externa** é quando há memória livre suficiente no total, mas picada em lacunas que sozinhas não comportam o pedido; a página mede isso como `1 - maior lacuna / livre total`. Com partições fixas, cada partição recebe um processo inteiro e a sobra dentro dela é **fragmentação interna**.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
