/// <reference types="vite/client" />
/**
 * ISOROGUE — bancada de revisão visual dos personagens.
 *
 *   guerreiro → docs/PERSONAGEM.md §10, gates G1..G6
 *   goblin    → docs/BESTIARIO.md   §8,  gates G1..G8
 *   slime     → docs/BESTIARIO.md   §13, gates G1..G10
 *   ogro      → docs/BESTIARIO.md   §13, gates G1..G10
 *   elenco    → docs/BESTIARIO.md   §13, gates G9 e G10 (folha só do elenco)
 *
 * Esta página NÃO faz parte do jogo. Ela existe para que um humano possa abrir
 * a folha gerada ao lado da imagem de referência do personagem e responder por
 * escrito aos gates. É a única ferramenta de revisão desta fase: se ela mentir
 * ou esconder um quadro, a revisão fica cega.
 *
 * Qual personagem é renderizado vem do FRAGMENTO da URL (`#personagem=goblin`),
 * escrito por tools/preview-personagem.mjs. Sem fragmento a folha é a do
 * guerreiro, byte a byte a mesma de antes desta fase — a bancada existente não
 * pode regredir por causa do monstro novo.
 *
 * O que a folha mostra:
 *   1. as 8 direções paradas, ampliadas (≥ 4×), rotuladas com o índice, o delta
 *      do grid e para onde aquilo aponta NA TELA (é o gate G3);
 *   2 e 3. os 4 quadros de caminhada e os 3 de ataque da direção 2;
 *   4. os 8 sprites no tamanho do jogo (1× e 2×), sentados em losangos de tile,
 *      para julgar legibilidade;
 *   4b. (só monstro) o personagem ao lado do GUERREIRO, mesma escala, sobre
 *      losangos de tile, com a altura de cada silhueta MEDIDA no atlas — G7;
 *   4c. (só monstro) o mesmo quadro em 5 níveis de luz, do pleno ao escuro
 *      total, com as cores emissivas preservadas — G8;
 *   4d. (só monstro) O ELENCO INTEIRO lado a lado, na mesma escala, sobre
 *      losangos de tile, na ordem de tamanho Slime · Goblin · Guerreiro ·
 *      Ogro, com a altura de corpo de cada um medida no atlas — G9 e G10;
 *   5. a paleta efetivamente exportada (G5);
 *   6. a lista de gates, para o revisor responder olhando;
 *   7. o atlas inteiro com cada quadro demarcado — quadro vazio salta aos olhos (G2).
 *
 * Restrições que valem aqui como valem no jogo: zero recurso externo (nenhuma
 * URL, nenhuma fonte, nenhuma imagem), zero dependência nova. Só Canvas 2D e DOM.
 *
 * Acoplamento deliberadamente frouxo: os módulos de personagem são varridos com
 * `import.meta.glob` (resolvido no BUILD, sem recurso externo) e resolvidos por
 * FORMA, não por nome de export. Um rename em `warrior.ts`/`goblin.ts` ou em
 * `spriteForge.ts` não pode apagar a bancada — no pior caso ela desenha um
 * painel de erro legível dizendo exatamente o que encontrou. E um personagem que
 * ainda não existe no disco não quebra o build: o glob só enxerga o que há.
 */

import { CONFIG, DIRS8 } from '../src/engine/core';
import * as modForge from '../src/render/spriteForge';
import * as modModel from '../src/render/model3d';

/* ------------------------------------------------------------------ *
 * 1. Formas mínimas esperadas (contrato §7 e §4.1 do PERSONAGEM.md)
 * ------------------------------------------------------------------ */

type Registro = Record<string, unknown>;

interface QuadroAtlas {
  readonly sx: number;
  readonly sy: number;
}

interface AtlasLike {
  /** Nulo quando não houve contexto 2D (§7 manda degradar sem lançar). */
  readonly canvas: HTMLCanvasElement | null;
  readonly larguraFrame: number;
  readonly alturaFrame: number;
  readonly ancoraX: number;
  readonly ancoraY: number;
  quadro(dir: number, estado: string, frame: number): QuadroAtlas;
  /* Diagnóstico opcional — a bancada mostra o que existir. */
  readonly disponivel?: boolean;
  readonly msForja?: number;
  readonly larguraArte?: number;
  readonly alturaArte?: number;
  readonly pixel?: number;
}

/** Atlas com pixels de verdade: só depois desta checagem dá para desenhar. */
interface AtlasPronto extends AtlasLike {
  readonly canvas: HTMLCanvasElement;
}

interface RigLike {
  readonly nome: string;
  readonly caixas: readonly unknown[];
  readonly filhos?: readonly unknown[];
}

interface EstadoAnim {
  readonly chave: string;
  readonly quadros: number;
  readonly descricao: string;
}

/** §6 do PERSONAGEM.md e §6 do BESTIARIO.md. 8 × (2+4+3) = 72 quadros. */
const ESTADOS: readonly EstadoAnim[] = [
  // Os rótulos são os números que `src/render/spriteForge.ts` REALMENTE aplica,
  // não os da §6. Rodada 1 (§8): eles traziam os do contrato ('±22°', 'quique
  // 0,4u', '−40° → +55°') e nenhum dos três sobreviveu à revisão do forge — o
  // quique vale 4× o rotulado e o arco do golpe mudou de eixo. Um rótulo errado
  // manda o próximo ajuste para o botão errado.
  { chave: 'parado', quadros: 2, descricao: 'respiração — 0,8u em Z, torso 1,8°, cabeça 1,2°' },
  {
    chave: 'andando',
    quadros: 4,
    descricao: 'pernas ±14° + abertura 11°/lateral 9°, braços ±14°, quique 1,6u'
  },
  {
    chave: 'atacando',
    quadros: 3,
    descricao: 'arco do braço direito em rx+ry — do personagem, se ele declarar um'
  }
];

/** Direção usada nas faixas de animação (2 = sul do grid, a pose da referência). */
const DIR_ANIMACAO = 2;

/** Nomes do grid na ORDEM FIXA de DIRS8 (core.ts) — não reordene. */
const NOMES_DIR: readonly string[] = [
  'leste',
  'sudeste',
  'sul',
  'sudoeste',
  'oeste',
  'noroeste',
  'norte',
  'nordeste'
];

/* ------------------------------------------------------------------ *
 * 1.1 Registro de personagens — a parte MULTI da bancada (§8 do BESTIARIO)
 * ------------------------------------------------------------------ */

/**
 * Nomes canônicos de export por personagem. A resolução tenta estes nomes
 * PRIMEIRO e cai para a busca por forma (§2) se nenhum bater — é o que faz a
 * bancada sobreviver a um rename sem virar tela de erro.
 */
interface NomesDeExport {
  readonly paleta: readonly string[];
  readonly rampas: readonly string[];
  readonly rampaDaCor: readonly string[];
  readonly repouso: readonly string[];
  /**
   * §1.1 do BESTIARIO — as cores EMISSIVAS: as que ignoram a modulação de luz.
   * Aqui entram nomes de CHAVE da paleta (`olhoBrasa`), não hex. O módulo do
   * personagem pode também exportar a lista pronta (`CORES_EMISSIVAS_GOBLIN`),
   * e nesse caso ela manda.
   */
  readonly emissivas: readonly string[];
  /**
   * Nomes de export da LISTA pronta de emissivas (`CORES_EMISSIVAS_SLIME`).
   * Quando um deles existir e tiver a forma certa, ele manda sobre `emissivas`.
   *
   * Isto é por personagem, e não uma lista global, por causa do Ogro: a paleta
   * dele não tem cor emissiva NENHUMA (`CORES_EMISSIVAS_OGRO = []`), e uma
   * busca por forma que aceitasse lista vazia acabaria casando com a do vizinho
   * errado. Ver `emissivaPorContrato` na ficha.
   */
  readonly listaEmissivas: readonly string[];
  /**
   * §6 — o arco do golpe PRÓPRIO do personagem, em radianos, no formato
   * `{ rx, ry }` que `forjarAtlas` aceita em `opts.arcoGolpe`. Sem ele a bancada
   * desenharia o golpe genérico do forge e a faixa "atacando" mentiria sobre o
   * que o jogo mostra.
   */
  readonly arcoGolpe: readonly string[];
}

interface Ficha {
  /** Chave aceita em `--personagem=` e no fragmento da URL. */
  readonly chave: string;
  readonly apelidos: readonly string[];
  readonly titulo: string;
  /**
   * `personagem` = a folha de um bicho só (o caso de sempre).
   * `elenco` = a folha que só tem a tira dos quatro juntos — G9 e G10.
   */
  readonly modo: 'personagem' | 'elenco';
  /** Sufixo do caminho do módulo dentro de src/render/characters/. Vazio no elenco. */
  readonly modulo: string;
  /** Onde mora o contrato deste personagem. */
  readonly doc: string;
  /** Referência curta à seção de gates, como ela já aparecia na folha. */
  readonly docGate: string;
  /** Imagem de referência, para o revisor abrir ao lado. */
  readonly referencia: string;
  readonly nomes: NomesDeExport;
  readonly gates: readonly (readonly [string, string])[];
  /** Chave do personagem com quem comparar escala (G7). `null` = não compara. */
  readonly compararCom: string | null;
  /** Mostra a tira de níveis de luz (G8). */
  readonly tiraDeLuz: boolean;
  /**
   * Mostra a tira do ELENCO INTEIRO (G9 e G10). Fica ligada nos três monstros:
   * um gate que só é julgável noutra folha não é julgado.
   */
  readonly tiraDeElenco: boolean;
  /**
   * Altura do MODELO em `u`, como o contrato a declara (§4 do BESTIARIO para o
   * Goblin, §11.3 para o Slime, §12.3 para o Ogro, §3 do PERSONAGEM.md para o
   * Guerreiro).
   *
   * Não é decoração: é o alvo contra o qual a tira de escala confere a altura
   * MEDIDA no atlas. A §4 é explícita em que a diferença de tamanho tem de vir
   * da altura real do modelo, com um `ART_POR_U` só para o projeto — se alguém
   * "resolver" o tamanho com um fator de escala no sprite, a razão medida
   * continua bonita e a perspectiva quebra. Publicar os dois números (alvo em
   * `u`, medido em px) é o que torna essa fraude visível.
   */
  readonly alturaU: number;
  /**
   * Legenda dos painéis de ANIMAÇÃO, por estado, quando a genérica de `ESTADOS`
   * mente sobre este personagem.
   *
   * Ela existe porque `ESTADOS` descreve o ciclo do forge em vocabulário
   * HUMANOIDE — "pernas ±14°, braços ±14°, arco do braço direito" —, e o Slime
   * não tem pernas nem braços: os nós `torso` e `bracoDir` dele são
   * ADAPTADORES (ver `NOS_SLIME` em src/render/characters/slime.ts) que
   * carregam o corpo e a antena. A legenda herdada dizia o que o forge faz e
   * não o que a imagem mostra, e o público desta bancada é justamente quem vai
   * decidir o próximo ajuste olhando a imagem.
   *
   * Ausente, vale a descrição genérica de `ESTADOS` — que continua correta para
   * Guerreiro, Goblin e Ogro, os três humanoides.
   */
  readonly legendasAnim?: Readonly<Record<string, string>>;
  /**
   * Prefixos de nome de cor que NÃO contam como corpo na medição de escala —
   * tipicamente a arma. `contorno` entra sempre, sem precisar ser declarado.
   * Ver `coresForaDoCorpo`, que explica por que esta lista existe.
   */
  readonly prefixosDeArma: readonly string[];
  /** Participa da tira do elenco (G9/G10) e em que cor é rotulado nela. */
  readonly corNaTira: string;
  /**
   * A paleta deste personagem não tem cor emissiva POR DECISÃO (o Ogro, §12.2),
   * e não por esquecimento. Sem esta marca a folha acusaria um defeito que não
   * existe — e o revisor procuraria um olho aceso que o contrato nunca pediu.
   */
  readonly emissivaPorContrato: boolean;
}

/** Os dois gates do §13 do BESTIARIO, iguais nos três monstros. */
const GATES_ELENCO: readonly (readonly [string, string])[] = [
  [
    'G9',
    'Os TRÊS monstros lado a lado leem como espécies diferentes — silhueta e ' +
      'saturação distintas, não três manchas verdes? (faixa do elenco)'
  ],
  [
    'G10',
    'O tamanho relativo conta a história certa: Slime < Goblin < Guerreiro < Ogro? ' +
      '(faixa do elenco, linha de veredito)'
  ]
];

const FICHA_GUERREIRO: Ficha = {
  chave: 'guerreiro',
  apelidos: ['warrior', 'atlas'],
  titulo: 'ISOROGUE — bancada do guerreiro',
  modo: 'personagem',
  modulo: 'warrior.ts',
  doc: 'docs/PERSONAGEM.md §10',
  docGate: '§10',
  referencia: 'docs/ref/guerreiro-referencia.png',
  nomes: {
    paleta: ['PALETA_GUERREIRO', 'PALETA'],
    rampas: ['RAMPAS_GUERREIRO', 'RAMPAS'],
    rampaDaCor: ['RAMPA_DA_COR_GUERREIRO', 'RAMPA_DA_COR'],
    repouso: ['POSE_PARADA', 'POSE_REPOUSO', 'POSE_NEUTRA'],
    emissivas: [],
    listaEmissivas: ['CORES_EMISSIVAS_GUERREIRO'],
    arcoGolpe: []
  },
  gates: [
    ['G1', 'A silhueta é reconhecível como ESTE guerreiro? (I1–I8)'],
    ['G2', 'As 8 direções são coerentes entre si — mesma altura, mesmo volume, sem "pular"?'],
    ['G3', 'A direção 0 (leste do grid) olha mesmo para baixo-direita na tela?'],
    ['G4', 'O contorno está contínuo, sem furos?'],
    ['G5', 'A paleta é a de §2, sem cor inventada nem gradiente contínuo?'],
    ['G6', 'A espada e o escudo estão nos lados certos e legíveis em todas as direções?']
  ],
  compararCom: null,
  tiraDeLuz: false,
  tiraDeElenco: false,
  // §3 do PERSONAGEM.md — a régua contra a qual os três monstros são medidos.
  alturaU: 18,
  prefixosDeArma: ['aco'],
  corNaTira: '#e0a43c',
  emissivaPorContrato: false
};

const FICHA_GOBLIN: Ficha = {
  chave: 'goblin',
  apelidos: ['gob'],
  titulo: 'ISOROGUE — bancada do goblin',
  modo: 'personagem',
  modulo: 'goblin.ts',
  doc: 'docs/BESTIARIO.md §8',
  docGate: '§8 e §13 do BESTIARIO.md',
  referencia: 'docs/ref/goblin-referencia.jpg',
  nomes: {
    paleta: ['PALETA_GOBLIN', 'PALETA'],
    rampas: ['RAMPAS_GOBLIN', 'RAMPAS'],
    rampaDaCor: ['RAMPA_DA_COR_GOBLIN', 'RAMPA_DA_COR'],
    repouso: ['POSE_PARADA_GOBLIN', 'POSE_PARADA', 'POSE_REPOUSO'],
    emissivas: ['olhoBrasa'],
    listaEmissivas: ['CORES_EMISSIVAS_GOBLIN'],
    arcoGolpe: ['ARCO_GOLPE_GOBLIN', 'ARCO_GOLPE']
  },
  gates: [
    ['G1', 'A silhueta lê como ESTE goblin? (I1–I8, com atenção a I2 orelhas e I6 cimitarra)'],
    ['G2', 'As 8 direções têm mesma altura e volume, sem "pular" entre elas?'],
    ['G3', 'A direção 0 (leste do grid) olha para baixo-direita na tela?'],
    ['G4', 'O contorno está contínuo, sem furos?'],
    ['G5', 'A paleta é a do §3, sem cor inventada nem gradiente contínuo?'],
    ['G6', 'As orelhas e a cimitarra são legíveis em TODAS as direções?'],
    ['G7', 'Ao lado do Guerreiro, o goblin lê claramente como MENOR? (faixa da escala)'],
    ['G8', 'Com pouca luz o corpo escurece e os OLHOS continuam acesos? (faixa de luz)'],
    ...GATES_ELENCO
  ],
  compararCom: 'guerreiro',
  tiraDeLuz: true,
  tiraDeElenco: true,
  // §4 do BESTIARIO: ALTURA_MODELO_GOBLIN = 13u contra 18u do Guerreiro.
  alturaU: 13,
  prefixosDeArma: ['aco'],
  corNaTira: '#5fb36a',
  emissivaPorContrato: false
};

const FICHA_SLIME: Ficha = {
  chave: 'slime',
  apelidos: ['gosma'],
  titulo: 'ISOROGUE — bancada do slime',
  modo: 'personagem',
  modulo: 'slime.ts',
  doc: 'docs/BESTIARIO.md §11',
  docGate: '§13 do BESTIARIO.md',
  referencia: 'docs/ref/slime-referencia.jpg',
  nomes: {
    paleta: ['PALETA_SLIME', 'PALETA'],
    rampas: ['RAMPAS_SLIME', 'RAMPAS'],
    rampaDaCor: ['RAMPA_DA_COR_SLIME', 'RAMPA_DA_COR'],
    repouso: ['POSE_PARADA_SLIME', 'POSE_PARADA', 'POSE_REPOUSO'],
    emissivas: ['luzAmbar'],
    listaEmissivas: ['CORES_EMISSIVAS_SLIME'],
    arcoGolpe: ['ARCO_GOLPE_SLIME', 'ARCO_GOLPE']
  },
  gates: [
    ['G1', 'A silhueta lê como ESTE slime? (S1–S6 — domo mais largo que alto, olhos em + e antena)'],
    ['G2', 'As 8 direções têm mesma altura e volume, sem "pular" entre elas?'],
    ['G3', 'A direção 0 (leste do grid) olha para baixo-direita na tela?'],
    ['G4', 'O contorno está contínuo, sem furos?'],
    ['G5', 'A paleta é a do §11.2, sem cor inventada nem gradiente contínuo?'],
    [
      'G6',
      'A ANTENA (S5) é legível em TODAS as direções e o rosto (S4) gira junto com ela? ' +
        'Nas costas o rosto some e só a antena aparece — §11.5 diz que isso é o certo'
    ],
    ['G7', 'Ao lado do Guerreiro, o slime lê como MUITO menor? (faixa da escala)'],
    ['G8', 'Com pouca luz o corpo escurece e os OLHOS e a BOLHA continuam acesos? (faixa de luz)'],
    ...GATES_ELENCO
  ],
  compararCom: 'guerreiro',
  tiraDeLuz: true,
  tiraDeElenco: true,
  // §11.3: ALTURA_MODELO_SLIME = 7u — a MASSA (a gota, do chão à coroa). A
  // silhueta com o arco da antena vai a ~11,8u; ver `PROPORCOES_SLIME.altura`,
  // que separa as duas medidas, e a nota da linha de veredito da tira.
  alturaU: 7,
  legendasAnim: {
    andando:
      'o slime não tem pernas — quique de 1,6u nos quadros pares (§11.4 pede salto, não passada) ' +
      '+ o ATRASO DA ANTENA: o nó `bracoDir` do rig é a haste, e o balanço de ±14° do ciclo ' +
      'chega ao extremo um quadro DEPOIS do ápice do corpo',
    atacando:
      'o BOTE (§11.4) — arco próprio do personagem em rx/ry no nó da antena (a isca chicoteia ' +
      'para a frente-esquerda), com o corpo afundando 0,8u e inclinando 7° no quadro 1, que é o de impacto'
  },
  // O slime não tem arma nenhuma: só o contorno sai da conta do corpo.
  prefixosDeArma: [],
  corNaTira: '#4fd07a',
  emissivaPorContrato: false
};

const FICHA_OGRO: Ficha = {
  chave: 'ogro',
  apelidos: ['ogre'],
  titulo: 'ISOROGUE — bancada do ogro',
  modo: 'personagem',
  modulo: 'ogre.ts',
  doc: 'docs/BESTIARIO.md §12',
  docGate: '§13 do BESTIARIO.md',
  referencia: 'docs/ref/ogro-referencia.png',
  nomes: {
    paleta: ['PALETA_OGRO', 'PALETA'],
    rampas: ['RAMPAS_OGRO', 'RAMPAS'],
    rampaDaCor: ['RAMPA_DA_COR_OGRO', 'RAMPA_DA_COR'],
    repouso: ['POSE_PARADA_OGRO', 'POSE_PARADA', 'POSE_REPOUSO'],
    emissivas: [],
    listaEmissivas: ['CORES_EMISSIVAS_OGRO'],
    arcoGolpe: ['ARCO_GOLPE_OGRO', 'ARCO_GOLPE']
  },
  gates: [
    [
      'G1',
      'A silhueta lê como ESTE ogro? (O1–O8, com atenção a O2: o ombro esquerdo tem de ' +
        'passar ACIMA da cabeça, e a silhueta NÃO pode ser simétrica)'
    ],
    ['G2', 'As 8 direções têm mesma altura e volume, sem "pular" entre elas?'],
    ['G3', 'A direção 0 (leste do grid) olha para baixo-direita na tela?'],
    ['G4', 'O contorno está contínuo, sem furos?'],
    ['G5', 'A paleta é a do §12.2, sem cor inventada nem gradiente contínuo?'],
    ['G6', 'A marreta (O5), os chifres (O3) e a ombreira espinhada (O4) são legíveis em TODAS as direções?'],
    ['G7', 'Ao lado do Guerreiro, o ogro lê claramente como MAIOR? (faixa da escala)'],
    [
      'G8',
      'Com pouca luz o corpo escurece por inteiro? O Ogro NÃO tem cor emissiva (§12.2) — ' +
        'nenhum ponto pode ficar aceso'
    ],
    ...GATES_ELENCO,
    [
      'G11',
      '§12.5 — quanto o quadro invade os tiles vizinhos? A medida está no cabeçalho ' +
        '(quadro × tile). Se ficar grotesco a saída é reduzir para ~22u e compensar com ' +
        'largura, não implementar z-buffer nesta fase'
    ]
  ],
  compararCom: 'guerreiro',
  tiraDeLuz: true,
  tiraDeElenco: true,
  // §12.3: ALTURA_MODELO_OGRO = 24u — ele INTIMIDA.
  alturaU: 24,
  // A marreta é madeira + aros de metal escuro; o OSSO (chifres, espinhos da
  // ombreira) é CORPO, não arma — a §12.3 mede os 24u até a ponta do espinho.
  prefixosDeArma: ['madeira'],
  corNaTira: '#c6dcbb',
  emissivaPorContrato: true
};

/**
 * A folha só do elenco. Ela não tem personagem "alvo": é a tira dos quatro, em
 * tamanho grande, e nada mais.
 *
 * Por que ela existe além da faixa que já entra em cada folha de monstro: as
 * folhas de monstro são densas (72 quadros, atlas, paleta, gates) e a tira do
 * elenco chega lá embaixo, pequena, entre outras dez coisas. G9 e G10 não são
 * gates de detalhe — são as duas perguntas de PRODUTO desta fase ("são espécies
 * diferentes?" e "o tamanho conta a história certa?"), e quem responde a elas é
 * o dono do jogo, olhando uma imagem só. Uma folha própria é a imagem que se
 * manda para ele; a faixa embutida é a que o escultor usa sem trocar de folha.
 */
const FICHA_ELENCO: Ficha = {
  chave: 'elenco',
  apelidos: ['todos', 'cast'],
  titulo: 'ISOROGUE — o elenco (G9 e G10)',
  modo: 'elenco',
  modulo: '',
  doc: 'docs/BESTIARIO.md §13',
  docGate: '§13 do BESTIARIO.md',
  referencia: 'docs/ref/{slime,goblin,guerreiro,ogro}-referencia.*',
  nomes: {
    paleta: [],
    rampas: [],
    rampaDaCor: [],
    repouso: [],
    emissivas: [],
    listaEmissivas: [],
    arcoGolpe: []
  },
  gates: GATES_ELENCO,
  compararCom: null,
  tiraDeLuz: false,
  tiraDeElenco: true,
  alturaU: 0,
  prefixosDeArma: [],
  corNaTira: '#c9d3de',
  emissivaPorContrato: false
};

const FICHAS: readonly Ficha[] = [
  FICHA_GUERREIRO,
  FICHA_GOBLIN,
  FICHA_SLIME,
  FICHA_OGRO,
  FICHA_ELENCO
];

/**
 * O elenco, NA ORDEM DE TAMANHO do §13/G10 — Slime < Goblin < Guerreiro < Ogro.
 *
 * A ordem é o enunciado do gate escrito na imagem: a tira desenha nesta ordem e
 * depois CONFERE que as alturas medidas crescem junto. Se alguém reordenar isto
 * para "ficar bonito", o veredito de G10 passa a comparar outra coisa.
 */
const ORDEM_ELENCO: readonly string[] = ['slime', 'goblin', 'guerreiro', 'ogro'];

/**
 * Módulos de personagem, varridos no BUILD.
 *
 * `import.meta.glob` com `eager` vira import estático no bundle — nada é
 * baixado em tempo de execução (R02 continua valendo) e a página segue 100%
 * síncrona, que é o que permite ao capturador ler o DOM sem esperar frame.
 *
 * O glob é o que deixa a bancada tolerar um personagem que AINDA não existe no
 * disco: um `import` estático de `goblin.ts` faria o build inteiro falhar e
 * levaria a bancada do guerreiro junto.
 */
const MODULOS_PERSONAGEM = import.meta.glob('../src/render/characters/*.ts', {
  eager: true
}) as Record<string, Registro>;

/* ------------------------------------------------------------------ *
 * 2. Resolução por forma dos módulos do personagem
 * ------------------------------------------------------------------ */

function ehObjeto(v: unknown): v is Registro {
  return typeof v === 'object' && v !== null;
}

function ehRig(v: unknown): v is RigLike {
  return ehObjeto(v) && typeof v['nome'] === 'string' && Array.isArray(v['caixas']);
}

/**
 * Reconhece um AtlasPersonagem pela forma. `canvas` NÃO entra no teste de
 * propósito: ele pode ser nulo por contrato (degradação sem DOM), e confundir
 * "atlas vazio" com "objeto errado" daria uma mensagem de erro mentirosa.
 */
function ehAtlas(v: unknown): v is AtlasLike {
  if (!ehObjeto(v)) return false;
  return (
    typeof v['quadro'] === 'function' &&
    typeof v['larguraFrame'] === 'number' &&
    typeof v['alturaFrame'] === 'number' &&
    typeof v['ancoraX'] === 'number' &&
    typeof v['ancoraY'] === 'number'
  );
}

function exigirPixels(atlas: AtlasLike): AtlasPronto {
  if (!atlas.canvas) {
    throw new Error(
      'o atlas foi forjado, mas sem pixels: canvas === null ' +
        `(disponivel = ${String(atlas.disponivel)}). No navegador isso só acontece ` +
        'se getContext("2d") devolveu null.'
    );
  }
  return atlas as AtlasPronto;
}

function msgDe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function chaves(mod: Registro): string {
  const ks = Object.keys(mod).filter((k) => k !== '__esModule' && k !== 'default');
  return ks.length > 0 ? ks.join(', ') : '(nenhum)';
}

/** Caminho legível do módulo de um personagem, para mensagem de erro. */
function caminhoDoModulo(ficha: Ficha): string {
  return `src/render/characters/${ficha.modulo}`;
}

/**
 * Acha o módulo do personagem dentro do glob. A falha aqui é a mais provável de
 * todas (o arquivo do monstro ainda não foi escrito), então a mensagem diz o
 * que faltou E o que existe.
 */
function resolverModulo(ficha: Ficha): Registro {
  const alvo = '/' + ficha.modulo;
  for (const caminho of Object.keys(MODULOS_PERSONAGEM)) {
    if (caminho.endsWith(alvo)) {
      const mod = MODULOS_PERSONAGEM[caminho];
      if (ehObjeto(mod)) return mod;
    }
  }
  const vistos = Object.keys(MODULOS_PERSONAGEM);
  throw new Error(
    `${caminhoDoModulo(ficha)} não existe (ou não exporta nada). ` +
      `Módulos de personagem encontrados: ${vistos.length > 0 ? vistos.join(', ') : '(nenhum)'}. ` +
      `Contrato: ${ficha.doc}.`
  );
}

/** Acha o rig do personagem: um `No` exportado direto ou devolvido por uma fábrica. */
function resolverRig(mod: Registro, ficha: Ficha): RigLike {
  for (const valor of Object.values(mod)) {
    if (ehRig(valor)) return valor;
  }
  for (const valor of Object.values(mod)) {
    if (typeof valor !== 'function') continue;
    const fabrica = valor as (...args: unknown[]) => unknown;
    if (fabrica.length > 0) continue;
    try {
      const r = fabrica();
      if (ehRig(r)) return r;
    } catch {
      /* não era fábrica de rig; segue procurando */
    }
  }
  throw new Error(
    `${caminhoDoModulo(ficha)} não exporta nenhum rig (objeto com { nome, caixas }). ` +
      `Exports vistos: ${chaves(mod)}.`
  );
}

/**
 * Acha `forjarAtlas` e chama com as opções que o personagem exige.
 *
 * A forja NÃO é chamável só com o rig: `opts.paleta` é obrigatória, e a pose de
 * repouso (a espada erguida de I4 do guerreiro, a cimitarra no ombro do goblin)
 * também vem do personagem, não do forge. Por isso montamos `opts` a partir do
 * próprio módulo do personagem e descemos uma escada de tentativas até uma
 * pegar — assim a bancada sobrevive a um `opts` que ganhe ou perca campo
 * obrigatório amanhã.
 */
function resolverForja(modForja: Registro, opts: Registro): (rig: RigLike) => AtlasLike {
  const candidatos = Object.entries(modForja).filter(
    ([nome, valor]) => typeof valor === 'function' && /forjar|atlas/i.test(nome)
  );
  const escolhido = candidatos.find(([nome]) => nome === 'forjarAtlas') ?? candidatos[0];
  if (!escolhido) {
    throw new Error(
      `src/render/spriteForge.ts não exporta uma função de forja (esperado 'forjarAtlas'). ` +
        `Exports vistos: ${chaves(modForja)}.`
    );
  }
  const fn = escolhido[1] as (...args: unknown[]) => unknown;
  const paletaSo = opts['paleta'] === undefined ? {} : { paleta: opts['paleta'] };
  return (rig: RigLike): AtlasLike => {
    let ultimo: unknown = new Error('sem tentativa');
    for (const args of [[rig, opts], [rig, paletaSo], [rig, {}], [rig]]) {
      try {
        const r = fn(...args);
        if (ehAtlas(r)) return r;
        ultimo = new Error(
          'o retorno não tem a forma de AtlasPersonagem ' +
            '{ larguraFrame, alturaFrame, ancoraX, ancoraY, quadro() }'
        );
      } catch (e) {
        ultimo = e;
      }
    }
    throw new Error(`${escolhido[0]}() não produziu um atlas: ${msgDe(ultimo)}`);
  };
}

/* ---- detectores de forma para as opções do personagem ---- */

const RE_HEX = /^#[0-9a-f]{3,8}$/i;

function ehPaleta(v: unknown): v is Record<string, string> {
  if (!ehObjeto(v)) return false;
  const pares = Object.entries(v);
  return pares.length >= 4 && pares.every(([, c]) => typeof c === 'string' && RE_HEX.test(c));
}

function ehRampas(v: unknown): boolean {
  if (!ehObjeto(v)) return false;
  const vals = Object.values(v);
  return (
    vals.length >= 1 &&
    vals.every((r) => Array.isArray(r) && r.length > 0 && r.every((c) => typeof c === 'string'))
  );
}

/** Mapa cor → nome de rampa: strings que NÃO são hex e cujas chaves são cores. */
function ehMapaDeCor(v: unknown, coresValidas: readonly string[]): boolean {
  if (!ehObjeto(v)) return false;
  const pares = Object.entries(v);
  if (pares.length < 2) return false;
  if (!pares.every(([, r]) => typeof r === 'string' && !RE_HEX.test(r))) return false;
  return pares.some(([k]) => coresValidas.includes(k));
}

/** Pose: nome do nó → { rx?, ry?, rz? } em radianos. */
function ehPose(v: unknown): boolean {
  if (!ehObjeto(v)) return false;
  const vals = Object.values(v);
  return (
    vals.length >= 1 &&
    vals.every(
      (r) =>
        ehObjeto(r) &&
        ['rx', 'ry', 'rz'].some((eixo) => typeof r[eixo] === 'number') &&
        Object.keys(r).every((k) => ['rx', 'ry', 'rz'].includes(k))
    )
  );
}

/** `{ rx, ry }` com um número por quadro de `atacando` — §6, `opts.arcoGolpe`. */
function ehArcoGolpe(v: unknown): boolean {
  if (!ehObjeto(v)) return false;
  const eixos = ['rx', 'ry'];
  if (!eixos.every((e) => Array.isArray(v[e]))) return false;
  return eixos.every((e) => {
    const a = v[e] as unknown[];
    return a.length > 0 && a.every((n) => typeof n === 'number' && Number.isFinite(n));
  });
}

/** Nome canônico primeiro; forma depois. Nunca devolve algo que não sirva. */
function acharExport(
  mod: Registro,
  nomes: readonly string[],
  forma: (v: unknown) => boolean
): unknown {
  for (const n of nomes) {
    const v = mod[n];
    if (v !== undefined && forma(v)) return v;
  }
  for (const v of Object.values(mod)) {
    if (forma(v)) return v;
  }
  return undefined;
}

/**
 * Monta o `opts` da forja a partir do módulo do personagem. Devolve também a
 * lista do que foi encontrado — ela vai para o rodapé da folha, porque uma pose
 * de repouso não aplicada muda a leitura da arma (I4 do guerreiro, I6 do
 * goblin) e o revisor precisa saber.
 */
function montarOpcoes(mod: Registro, ficha: Ficha): { opts: Registro; achados: string[] } {
  const opts: Registro = {};
  const achados: string[] = [];
  const paleta = acharExport(mod, ficha.nomes.paleta, ehPaleta);
  if (ehPaleta(paleta)) {
    opts['paleta'] = paleta;
    achados.push('paleta');
    const cores = Object.keys(paleta);
    const rampas = acharExport(mod, ficha.nomes.rampas, ehRampas);
    if (rampas !== undefined) {
      opts['rampas'] = rampas;
      achados.push('rampas');
    }
    const rampaDaCor = acharExport(mod, ficha.nomes.rampaDaCor, (v) => ehMapaDeCor(v, cores));
    if (rampaDaCor !== undefined) {
      opts['rampaDaCor'] = rampaDaCor;
      achados.push('rampaDaCor');
    }
  }
  const repouso = acharExport(mod, ficha.nomes.repouso, ehPose);
  if (repouso !== undefined) {
    opts['repouso'] = repouso;
    achados.push('repouso');
  }
  const arcoGolpe = acharExport(mod, ficha.nomes.arcoGolpe, ehArcoGolpe);
  if (arcoGolpe !== undefined) {
    opts['arcoGolpe'] = arcoGolpe;
    achados.push('arcoGolpe');
  }
  // §1.1 — os NOMES das cores emissivas. O forge usa isto para extrair a camada
  // emissiva do atlas (`AtlasPersonagem.emissivo`), que é o que o jogo recola em
  // brilho pleno por cima do quadro escurecido. Passar o mesmo canal que o jogo
  // passa é o que impede a bancada de julgar G8 sobre um atlas diferente do que
  // o jogador vai ver. Não altera um pixel do atlas base — só acrescenta a folha
  // emissiva ao lado.
  const emissivas = nomesEmissivos(mod, ficha);
  if (emissivas.length > 0) {
    opts['emissivas'] = emissivas;
    achados.push('emissivas');
  }
  return { opts, achados };
}

/** As cores da paleta, em pares, para a legenda de G5. */
function paresDaPaleta(
  ficha: Ficha,
  ...mods: readonly Registro[]
): ReadonlyArray<readonly [string, string]> {
  for (const mod of mods) {
    const p = acharExport(mod, ficha.nomes.paleta, ehPaleta);
    if (ehPaleta(p)) return Object.entries(p);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * 2.1 Cor: hex → RGB empacotado (usado pela modulação de luz)
 * ------------------------------------------------------------------ */

function lerHex(hex: string): [number, number, number] | null {
  let s = hex.trim();
  if (s.charAt(0) === '#') s = s.slice(1);
  if (s.length === 3) {
    s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
  }
  if (s.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function empacotar(c: readonly [number, number, number]): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

/**
 * As cores EMISSIVAS do personagem, já empacotadas (§1.1 do BESTIARIO).
 *
 * Prioridade: uma lista exportada pelo próprio personagem (`CORES_EMISSIVAS_*`)
 * manda; senão valem os nomes declarados na ficha. Casar por VALOR RGB exato é
 * legítimo aqui porque o sprite forge snapa todo pixel para a paleta antes de
 * colar no atlas (§2.1 de spriteForge) — no atlas não existe meio-tom.
 */
function nomesEmissivos(mod: Registro, ficha: Ficha): readonly string[] {
  // O Ogro declara `CORES_EMISSIVAS_OGRO = []` de propósito (§12.2). Buscar por
  // FORMA aqui casaria a lista vazia dele com qualquer array vazio do módulo, e
  // pior: uma checagem de forma que exigisse length ≥ 1 nunca casaria com a
  // lista vazia dele e sairia procurando a emissiva de outro personagem. Por
  // isso a procura é por NOME declarado na ficha, e só ele.
  const paleta = acharExport(mod, ficha.nomes.paleta, ehPaleta);
  if (!ehPaleta(paleta)) return [];
  const cores = Object.keys(paleta);
  for (const nome of ficha.nomes.listaEmissivas) {
    const v = mod[nome];
    if (Array.isArray(v) && v.every((n) => typeof n === 'string' && cores.includes(n))) {
      return v as readonly string[];
    }
  }
  return ficha.nomes.emissivas.filter((n) => cores.includes(n));
}

function coresEmissivas(mod: Registro, ficha: Ficha): number[] {
  const paleta = acharExport(mod, ficha.nomes.paleta, ehPaleta);
  if (!ehPaleta(paleta)) return [];
  const saida: number[] = [];
  for (const nome of nomesEmissivos(mod, ficha)) {
    const hex = paleta[nome];
    if (typeof hex !== 'string') continue;
    const rgb = lerHex(hex);
    if (rgb) saida.push(empacotar(rgb));
  }
  return saida;
}

/**
 * As cores que NÃO contam como corpo, empacotadas em `0xRRGGBB`: as de aço (a
 * arma) e a de contorno.
 *
 * Existem por causa do gate G7, e o motivo é uma medição errada que a rodada 1
 * (§8) quase transformou em ajuste de arte. O painel de escala dividia a altura
 * da silhueta do goblin pela do guerreiro e imprimia 52% contra o alvo de 72% —
 * mas os 77px do guerreiro incluem ~18px de ESPADA ERGUIDA acima do elmo, e a
 * §4 compara CORPOS (13u contra 18u), não corpo contra ponta de arma. Medindo a
 * silhueta sem os pixels de aço a razão vai a ~68%, praticamente no alvo.
 *
 * Deixar o instrumento errado era o pior dos mundos: G7 é o único gate cujo
 * veredito a bancada calcula sozinha, e um falso negativo levaria o escultor a
 * inflar o goblin atrás de um número que não existe.
 *
 * A heurística é o PREFIXO do nome da cor, DECLARADO NA FICHA — `aco` para o
 * Guerreiro e o Goblin, `madeira` para o Ogro, nenhum para o Slime, que não tem
 * arma. Ela era um `/^aco/` fixo aqui dentro, e isso já estava errado no
 * primeiro monstro novo: a arma do Ogro é `madeira` + `metalSombra`, e o `osso`
 * dos chifres e dos espinhos da ombreira é CORPO — a §12.3 mede os 24u dele
 * justamente até a PONTA DO ESPINHO, que é o ponto mais alto do modelo. Excluir
 * osso teria decapitado a medida de O2 e reprovado G10 por instrumento.
 *
 * Uma paleta sem nenhum prefixo declarado devolve só o contorno — aí a medição
 * de corpo é a silhueta inteira menos o outline, e o rótulo diz isso.
 *
 * O CONTORNO entra na lista junto com o aço, e sem ele a medição não funciona:
 * o passe de máscara do sprite forge (§2.1) repinta de `contorno` todo pixel de
 * borda, inclusive os da ponta da espada, então tirar só o aço deixava o
 * outline da arma para trás e a altura "de corpo" saía idêntica à cheia (medido:
 * 77px nas duas). Excluir o contorno mede o INTERIOR do corpo — 1px a menos em
 * cima e embaixo —, e como isso vale para os dois personagens a razão não se
 * desloca: guerreiro 57px contra goblin 42px = 74%, contra os 72% da §4.
 */
function coresForaDoCorpo(mod: Registro, ficha: Ficha): number[] {
  const paleta = acharExport(mod, ficha.nomes.paleta, ehPaleta);
  if (!ehPaleta(paleta)) return [];
  const saida: number[] = [];
  for (const [nome, hex] of Object.entries(paleta)) {
    const arma = ficha.prefixosDeArma.some((p) => nome.toLowerCase().startsWith(p.toLowerCase()));
    if (!arma && nome !== 'contorno') continue;
    const rgb = lerHex(hex);
    if (rgb) saida.push(empacotar(rgb));
  }
  return saida;
}

/* ------------------------------------------------------------------ *
 * 3. Utilidades de desenho
 * ------------------------------------------------------------------ */

interface Tela {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function novaTela(w: number, h: number): Tela {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponível — a bancada precisa de getContext("2d").');
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

/** Xadrez discreto: dá referência de fundo sem competir com a silhueta. */
function xadrez(ctx: CanvasRenderingContext2D, w: number, h: number, passo: number): void {
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const par = ((x / passo) | 0) + ((y / passo) | 0);
      ctx.fillStyle = par % 2 === 0 ? '#171c23' : '#1c222a';
      ctx.fillRect(x, y, passo, passo);
    }
  }
}

/** Losango do tile (TW×TH do jogo) — mostra se o personagem "senta" no chão. */
function losango(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tw: number,
  th: number,
  preenche: string | null,
  traco: string | null
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - th / 2);
  ctx.lineTo(cx + tw / 2, cy);
  ctx.lineTo(cx, cy + th / 2);
  ctx.lineTo(cx - tw / 2, cy);
  ctx.closePath();
  if (preenche) {
    ctx.fillStyle = preenche;
    ctx.fill();
  }
  if (traco) {
    ctx.strokeStyle = traco;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function cruz(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.strokeStyle = 'rgba(224,164,60,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r, y + 0.5);
  ctx.lineTo(x + r, y + 0.5);
  ctx.moveTo(x + 0.5, y - r);
  ctx.lineTo(x + 0.5, y + r);
  ctx.stroke();
}

/**
 * Um quadro ampliado, com xadrez de fundo, o losango do tile na âncora e a cruz
 * da âncora. A ampliação é feita no canvas com imageSmoothingEnabled=false — é o
 * mesmo caminho do jogo, então o que aparece aqui é o pixel real, não um borrão.
 */
function celulaQuadro(
  atlas: AtlasPronto,
  dir: number,
  estado: string,
  frame: number,
  zoom: number
): HTMLCanvasElement {
  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const margemBaixo = 8;
  const cw = Math.max(lw, CONFIG.TW + 8);
  const ch = lh + margemBaixo;
  const offX = Math.round((cw - lw) / 2);
  const offY = 2;

  const { cv, ctx } = novaTela(cw * zoom, ch * zoom);
  xadrez(ctx, cw * zoom, ch * zoom, Math.max(4, zoom * 2));

  const ax = (offX + atlas.ancoraX) * zoom;
  const ay = (offY + atlas.ancoraY) * zoom;
  losango(ctx, ax, ay, CONFIG.TW * zoom, CONFIG.TH * zoom, 'rgba(58,66,80,0.55)', 'rgba(201,211,222,0.16)');
  cruz(ctx, ax, ay, 5 * zoom);

  const q = atlas.quadro(dir, estado, frame);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, q.sx, q.sy, lw, lh, offX * zoom, offY * zoom, lw * zoom, lh * zoom);

  // Moldura do quadro: torna visível qualquer vazamento para fora da célula.
  ctx.strokeStyle = 'rgba(201,211,222,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(offX * zoom + 0.5, offY * zoom + 0.5, lw * zoom - 1, lh * zoom - 1);
  return cv;
}

/**
 * Os 8 sprites do jeito que o jogador vê: um por tile, sobre o losango do chão.
 * `zoom` 1 é o tamanho real; o jogo permite até 2,4× (CONFIG.ZOOM_MAX), então
 * vale olhar também um pouco ampliado antes de dar a legibilidade por boa.
 */
function tiraTamanhoReal(atlas: AtlasPronto, zoom: number): HTMLCanvasElement {
  const passo = CONFIG.TW * zoom;
  const margem = 16;
  const w = passo * 8 + margem * 2;
  const h = atlas.alturaFrame * zoom + 44;
  const baseY = h - 26;

  const { cv, ctx } = novaTela(w, h);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 8; i++) {
    const cx = margem + passo / 2 + i * passo;
    losango(ctx, cx, baseY, CONFIG.TW * zoom, CONFIG.TH * zoom, '#3a4250', 'rgba(255,255,255,0.07)');
  }

  ctx.imageSmoothingEnabled = false;
  for (let dir = 0; dir < 8; dir++) {
    const cx = margem + passo / 2 + dir * passo;
    const q = atlas.quadro(dir, 'parado', 0);
    ctx.drawImage(
      atlas.canvas,
      q.sx,
      q.sy,
      atlas.larguraFrame,
      atlas.alturaFrame,
      Math.round(cx - atlas.ancoraX * zoom),
      Math.round(baseY - atlas.ancoraY * zoom),
      atlas.larguraFrame * zoom,
      atlas.alturaFrame * zoom
    );
  }

  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7d8899';
  for (let dir = 0; dir < 8; dir++) {
    const cx = margem + passo / 2 + dir * passo;
    ctx.fillText(String(dir), cx, h - 6);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0a43c';
  ctx.fillText(`${zoom}×`, 6, 14);
  return cv;
}

/** O atlas inteiro, com cada quadro demarcado: quadro vazio ou torto salta aos olhos. */
function folhaContato(atlas: AtlasPronto, zoom: number): HTMLCanvasElement {
  const w = atlas.canvas.width * zoom;
  const h = atlas.canvas.height * zoom;
  const { cv, ctx } = novaTela(w, h);
  xadrez(ctx, w, h, 8);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, 0, 0, atlas.canvas.width, atlas.canvas.height, 0, 0, w, h);

  ctx.strokeStyle = 'rgba(224,164,60,0.28)';
  ctx.lineWidth = 1;
  for (let dir = 0; dir < 8; dir++) {
    for (const estado of ESTADOS) {
      for (let f = 0; f < estado.quadros; f++) {
        const q = atlas.quadro(dir, estado.chave, f);
        ctx.strokeRect(
          q.sx * zoom + 0.5,
          q.sy * zoom + 0.5,
          atlas.larguraFrame * zoom - 1,
          atlas.alturaFrame * zoom - 1
        );
      }
    }
  }
  return cv;
}

/* ------------------------------------------------------------------ *
 * 3.1 Medição de silhueta — o que torna G7 JULGÁVEL em número
 *
 * "O goblin lê como menor?" não pode depender só do olho: a §4 do BESTIARIO
 * manda a diferença vir da ALTURA REAL do modelo (13u contra 18u), com o mesmo
 * `ART_POR_U`. Se alguém "resolver" o tamanho com um fator de escala no sprite,
 * a razão medida continua bonita mas a perspectiva quebra — por isso a folha
 * mostra a altura em px de arte de CADA UM e a razão entre elas.
 * ------------------------------------------------------------------ */

interface Extremos {
  /** Em px do quadro (com PIXEL = 1 isto é px de arte). */
  readonly topo: number;
  readonly base: number;
  readonly esquerda: number;
  readonly direita: number;
  readonly altura: number;
  readonly largura: number;
}

/** Canvas de rascunho reaproveitado: medir 16 quadros não deve alocar 16 telas. */
let rascunho: Tela | null = null;

function telaDeRascunho(w: number, h: number): Tela {
  const atual = rascunho;
  if (!atual || atual.cv.width < w || atual.cv.height < h) {
    // Só cresce: dois personagens têm quadros de tamanhos diferentes e encolher
    // a tela entre medições apagaria a economia.
    const lw = Math.max(w, atual ? atual.cv.width : 0);
    const lh = Math.max(h, atual ? atual.cv.height : 0);
    rascunho = novaTela(lw, lh);
  }
  return rascunho as Tela;
}

/**
 * Caixa dos pixels OPACOS de um quadro. `null` quando `getImageData` não está
 * disponível (jsdom sem a lib canvas) ou quando o quadro está vazio — e quadro
 * vazio é achado, não erro: quem mostra isso é a folha de contato (G2).
 *
 * `excluir` (RGB empacotado) tira cores da conta sem tirá-las do desenho: é como
 * G7 mede o CORPO do personagem ignorando a arma. Ver `coresForaDoCorpo`.
 */
function medirSilhueta(
  atlas: AtlasPronto,
  dir: number,
  estado: string,
  frame: number,
  excluir: readonly number[] = []
): Extremos | null {
  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const q = atlas.quadro(dir, estado, frame);
  const tela = telaDeRascunho(lw, lh);
  tela.ctx.clearRect(0, 0, tela.cv.width, tela.cv.height);
  tela.ctx.imageSmoothingEnabled = false;
  tela.ctx.drawImage(atlas.canvas, q.sx, q.sy, lw, lh, 0, 0, lw, lh);
  let img: ImageData;
  try {
    img = tela.ctx.getImageData(0, 0, lw, lh);
  } catch {
    return null;
  }
  const d = img.data;
  let topo = lh;
  let base = -1;
  let esquerda = lw;
  let direita = -1;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const i = (y * lw + x) * 4;
      if (d[i + 3] === 0) continue;
      if (excluir.length > 0 && excluir.indexOf((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]) >= 0) {
        continue;
      }
      if (y < topo) topo = y;
      if (y > base) base = y;
      if (x < esquerda) esquerda = x;
      if (x > direita) direita = x;
    }
  }
  if (base < 0) return null;
  return {
    topo: topo,
    base: base,
    esquerda: esquerda,
    direita: direita,
    altura: base - topo + 1,
    largura: direita - esquerda + 1
  };
}

/**
 * Meia-largura pintada em torno da âncora, no pior caso das direções pedidas.
 * `null` quando não deu para medir (sem `getImageData`) — quem chama decide o
 * que fazer com isso.
 */
function extensaoHorizontal(atlas: AtlasPronto, dirs: readonly number[]): number | null {
  let maior = 0;
  for (const dir of dirs) {
    const m = medirSilhueta(atlas, dir, 'parado', 0);
    if (!m) return null;
    const esq = atlas.ancoraX - m.esquerda;
    const dir2 = m.direita - atlas.ancoraX;
    if (esq > maior) maior = esq;
    if (dir2 > maior) maior = dir2;
  }
  return maior > 0 ? maior : null;
}

/* ------------------------------------------------------------------ *
 * 3.2 Modulação por luz (§1 do BESTIARIO) — o gate G8
 *
 * ATENÇÃO, LEIA ANTES DE MEXER. O caminho de luz de VERDADE é o do jogo, que
 * `fund:luz` está escrevendo em src/render/ (§1): atlas forjado UMA vez com
 * brilho pleno e escurecido na hora de desenhar com `tingirQuadro(...)` /
 * `source-atop`, quantizado em ≤ 8 degraus e com cache por (quadro, degrau).
 *
 * A bancada não pode chamar aquele caminho: ele nasce como método PRIVADO de
 * `IsoRenderer` (é lá que `tingirQuadro` mora hoje). Então o que existe aqui é
 * uma reimplementação da MESMA receita, com a mesma quantização e o mesmo
 * cache, para que o revisor possa julgar G8 numa imagem. Assinatura assumida,
 * caso o módulo compartilhado apareça:
 *
 *     modularQuadro(atlas, quadro, lvl, opcoes) -> CanvasImageSource
 *
 * Se `fund:luz` publicar um helper exportado com essa forma, troque só
 * `quadroComLuz` por ele — nada mais nesta folha depende da implementação.
 *
 * Diferença deliberada em relação ao `source-atop` puro: para não escurecer as
 * cores EMISSIVAS (§1.1 — os olhos do goblin), a passada é por pixel. Um
 * `fillRect` com `source-atop` tingiria o sprite inteiro, olhos inclusive; o
 * jogo terá de tratar a emissiva do mesmo jeito (máscara ou segunda colagem),
 * e é exatamente isso que esta tira serve para conferir.
 * ------------------------------------------------------------------ */

interface OpcoesLuz {
  /** Cor da névoa para onde a peça escurece. `RGB_COLD` de src/render/palette.ts. */
  readonly corSombra: readonly [number, number, number];
  /** Alfa da sombra no escuro TOTAL (lvl = 0). Calibrado por `litEntity` do jogo. */
  readonly alfaMax: number;
  /** §1 — no máximo 8 degraus; é a chave do cache. */
  readonly degraus: number;
  /** §1.1 — cores que ignoram a modulação (RGB empacotado). */
  readonly emissivas: readonly number[];
}

const LUZ: Omit<OpcoesLuz, 'emissivas'> = {
  // #1a222f — a mesma névoa fria para onde o jogo puxa tudo que está longe.
  corSombra: [26, 34, 47],
  /*
   * O jogo escurece entidade com `mul(base, 0.5 + 0.5·b)` (palette.ts,
   * `litEntity`): no nível 0 sobra ~50% da cor, e é isso que `ALFA_SOMBRA_MAX`
   * de `src/render/spriteForge.ts` reproduz com 0,52 de alfa contra a névoa.
   *
   * Rodada 1 (§8): aqui estava 0,55. A diferença é pequena no pixel e grande no
   * significado — a bancada existe para julgar o que o JOGO faz, e um alfa
   * próprio é uma segunda fonte da verdade que diverge no primeiro ajuste. O
   * número agora é o do jogo, e o subtítulo do painel o publica, porque "alfa
   * proporcional a 1 − lvl" faz esperar quase preto no degrau 0 e parece bug
   * quando não acontece.
   */
  alfaMax: 0.52,
  degraus: 8
};

/**
 * Níveis mostrados na tira, do pleno ao ESCURO TOTAL (fração 0..1).
 *
 * Rodada 1 (§8): a tira parava em 0,14 (degrau 1/7) e G8 estava sendo julgado
 * num nível que não é o extremo. O `IsoRenderer` produz `lvl = 0` de verdade —
 * é o que um tile fora do alcance da luz vale —, então o pior caso real precisa
 * aparecer na folha. A quinta coluna é ele.
 */
const NIVEIS_LUZ: readonly number[] = [1, 0.66, 0.38, 0.14, 0];

function limitar01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** §1 — quantização em degraus inteiros; é ela que torna o cache possível. */
function degrauDeLuz(lvl: number, degraus: number): number {
  return Math.round(limitar01(lvl) * (degraus - 1));
}

/**
 * Cache por (quadro, degrau), como §1 exige. Sem ele cada célula reprocessa.
 * A chave externa é o ATLAS: dois personagens têm quadros na mesma coordenada
 * `(sx, sy)`, e uma chave puramente textual os faria colidir em silêncio — o
 * goblin apareceria com o corpo do guerreiro.
 */
const cacheLuz = new WeakMap<AtlasPronto, Map<string, HTMLCanvasElement>>();

/**
 * Escurece o buffer preservando as emissivas. Devolve `false` quando o contexto
 * não expõe `getImageData` — aí quem chama cai no `source-atop` cru, que é o
 * caminho do jogo (e perde os olhos, o que a legenda avisa).
 */
function escurecerPorPixel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cor: readonly [number, number, number],
  alfa: number,
  emissivas: readonly number[]
): boolean {
  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return false;
  }
  const d = img.data;
  const inv = 1 - alfa;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const chave = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    // §1.1 — a brasa dos olhos não recebe modulação: é ela que faz um goblin no
    // escuro virar dois pontos vermelhos encarando o jogador.
    if (emissivas.indexOf(chave) >= 0) continue;
    d[i] = Math.round(d[i] * inv + cor[0] * alfa);
    d[i + 1] = Math.round(d[i + 1] * inv + cor[1] * alfa);
    d[i + 2] = Math.round(d[i + 2] * inv + cor[2] * alfa);
  }
  ctx.putImageData(img, 0, 0);
  return true;
}

/** Um quadro do atlas, escurecido para o nível de luz pedido (§1). */
function quadroComLuz(
  atlas: AtlasPronto,
  q: QuadroAtlas,
  lvl: number,
  opcoes: OpcoesLuz
): HTMLCanvasElement {
  const degrau = degrauDeLuz(lvl, opcoes.degraus);
  const chave = `${q.sx},${q.sy},${degrau}/${opcoes.degraus}`;
  let porQuadro = cacheLuz.get(atlas);
  if (!porQuadro) {
    porQuadro = new Map<string, HTMLCanvasElement>();
    cacheLuz.set(atlas, porQuadro);
  }
  const guardado = porQuadro.get(chave);
  if (guardado) return guardado;

  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const { cv, ctx } = novaTela(lw, lh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas.canvas, q.sx, q.sy, lw, lh, 0, 0, lw, lh);

  const alfa = (1 - degrau / (opcoes.degraus - 1)) * opcoes.alfaMax;
  if (alfa > 0.002) {
    if (!escurecerPorPixel(ctx, lw, lh, opcoes.corSombra, alfa, opcoes.emissivas)) {
      const c = opcoes.corSombra;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alfa.toFixed(3)})`;
      ctx.fillRect(0, 0, lw, lh);
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  porQuadro.set(chave, cv);
  return cv;
}

/* ------------------------------------------------------------------ *
 * 3.3 As duas tiras novas do BESTIARIO (§8): escala (G7) e luz (G8)
 * ------------------------------------------------------------------ */

/** Cor da tracejada da silhueta CHEIA — a que inclui a ponta da arma (G7). */
const COR_SILHUETA_CHEIA = '#5b6472';

interface Lado {
  /** RGB de arma + contorno, para medir o CORPO em G7. Ver `coresForaDoCorpo`. */
  readonly aco?: readonly number[];
  readonly atlas: AtlasPronto;
  readonly nome: string;
  readonly cor: string;
  /** Altura do modelo em `u` (§4/§11.3/§12.3). 0 = não publica alvo. */
  readonly alturaU?: number;
}

function textoCentrado(
  ctx: CanvasRenderingContext2D,
  texto: string,
  x: number,
  y: number,
  cor: string,
  tam = 10
): void {
  ctx.font = `${tam}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
  ctx.textAlign = 'left';
}

function linhaTracejada(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  cor: string
): void {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = cor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
  ctx.restore();
}

function colarQuadro(
  ctx: CanvasRenderingContext2D,
  atlas: AtlasPronto,
  fonte: CanvasImageSource,
  sx: number,
  sy: number,
  cx: number,
  baseY: number,
  zoom: number
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    fonte,
    sx,
    sy,
    atlas.larguraFrame,
    atlas.alturaFrame,
    Math.round(cx - atlas.ancoraX * zoom),
    Math.round(baseY - atlas.ancoraY * zoom),
    atlas.larguraFrame * zoom,
    atlas.alturaFrame * zoom
  );
}

/** Ponto de referência da razão de escala: é sempre o Guerreiro (§4, §12.3). */
const CHAVE_REGUA = 'guerreiro';

/**
 * Tolerância da razão medida contra a razão de contrato, em pontos percentuais
 * RELATIVOS ao alvo.
 *
 * 14% reproduziria, para o Goblin, exatamente a janela 62–82% que a rodada 1
 * (§8) calibrou à mão em torno dos 72%. Ficou em 18% por causa de um viés que a
 * medição por altura-acima-da-âncora reduz mas não elimina: a parte de TRÁS do
 * modelo ainda sobe meio pixel por `u` de profundidade, então quanto mais fundo
 * o bicho, mais alto ele lê. Medido nos quatro (px acima do chão contra
 * `u × ART_POR_U` esperado): guerreiro +3, slime +4,5, goblin +5,5, ogro +8.
 *
 * Com 14% o Slime caía exatamente em cima da borda (44% contra 39% ± 5) e um
 * ajuste de meio `u` no rig o faria piscar entre verde e vermelho sem nada ter
 * ficado errado. Um gate que oscila é um gate que se aprende a ignorar; a janela
 * absorve o viés conhecido e continua estreita o bastante para pegar o erro que
 * ela existe para pegar — alguém escalando o sprite em vez de mudar o modelo,
 * que desloca a razão em dezenas de pontos, não em cinco.
 */
const TOLERANCIA_RAZAO = 0.18;

interface MedidaLado {
  readonly lado: Lado;
  /** Silhueta inteira, ponta de arma inclusa. */
  readonly cheia: Extremos | null;
  /** Corpo: sem os pixels de arma nem de contorno. É a medida dos gates. */
  readonly corpo: Extremos | null;
}

/** `— ` quando não deu para medir: número ausente é melhor que número inventado. */
function px(m: Extremos | null): string {
  return m ? `${m.altura}px` : '—';
}

/**
 * Quanto o corpo SOBE ACIMA DA ÂNCORA, em px de tela. É a medida de G7 e G10.
 *
 * NÃO é a altura da silhueta, e a diferença entre as duas não é detalhe: ela
 * reprovou o Slime por instrumento na primeira rodada dos três monstros.
 *
 * A projeção do jogo é `isoY = (x + y) / 2`, então a PROFUNDIDADE de um modelo
 * entra na altura da silhueta em tela: a parte de trás da peça sobe meio pixel
 * por `u` de profundidade e a da frente desce outro tanto. Para dois humanoides
 * de bitola parecida isso se cancela na razão e ninguém percebe — foi o caso do
 * Goblin contra o Guerreiro. Para o Slime não: ele tem 6,6u de altura e 9u de
 * PROFUNDIDADE (S1 — "mais largo que alto" é a identidade do bicho), e a
 * silhueta dele mede 34px onde a altura vale 16. Medido contra os 57px do
 * guerreiro isso dá 60% e o contrato pede 39% (7u/18u) — um falso negativo de 21
 * pontos que mandaria o escultor achatar um slime que está certo.
 *
 * A altura acima da âncora não tem esse problema. A âncora é a projeção da
 * origem do modelo (centro dos pés, z = 0) e o eixo Z projeta 1:1 para cima na
 * tela, então um ponto a `z` unidades do chão cai exatamente `z × ART_POR_U` px
 * acima da âncora — a mesma grandeza que as §4/§11.3/§12.3 declaram em `u`. É
 * também, sem coincidência nenhuma, a altura em que as tracejadas já eram
 * desenhadas: o desenho estava certo e o número ao lado dele é que não era.
 */
function alturaAcimaDaAncora(m: MedidaLado): number | null {
  if (!m.corpo) return null;
  const acima = m.lado.atlas.ancoraY - m.corpo.topo;
  return acima > 0 ? acima : null;
}

interface LinhaRodape {
  readonly texto: string;
  readonly cor: string;
  readonly tam: number;
}

/**
 * Largura de um texto no mesmo `font` com que ele será desenhado.
 *
 * Existe porque o rodapé desta tira é MAIS LARGO que a tira em si quando há
 * poucos personagens: com dois bonecos a zoom 3 o grupo tem ~410px e a linha de
 * veredito passa de 700, e ela saía cortada nas duas pontas — um gate ilegível é
 * um gate não julgado, que é exatamente o que esta bancada existe para impedir.
 * Medir antes de dimensionar a tela resolve para qualquer contagem.
 */
function larguraDoTexto(texto: string, tam: number): number {
  const tela = telaDeRascunho(1, 1);
  tela.ctx.font = `${tam}px ui-monospace, monospace`;
  return tela.ctx.measureText(texto).width;
}

/**
 * G7, G9 e G10 — o elenco lado a lado, MESMA escala, sobre losangos de tile.
 *
 * Nada aqui reescala nada: todos os atlas são colados com o mesmo `zoom` e com a
 * ÂNCORA (o plano z = 0 do modelo, o centro dos pés) na mesma linha de base. É
 * assim que o jogo os desenha, então a diferença de tamanho que aparece nesta
 * tira é a diferença de tamanho que o jogador vai ver — nem mais, nem menos.
 *
 * Ela nasceu com dois lados fixos (G7: monstro contra guerreiro) e recebe agora
 * uma lista, porque G9 e G10 do §13 pedem os QUATRO juntos e um par não decide
 * nenhum dos dois: "leem como espécies diferentes?" só tem resposta com todos na
 * mesma imagem, e "Slime < Goblin < Guerreiro < Ogro" é uma cadeia de três
 * comparações, não uma. Com dois elementos ela desenha o que sempre desenhou.
 *
 * Duas linhas tracejadas por personagem, e a distinção entre elas é o conserto
 * de rodada 1 (§8): a CHEIA marca o topo da silhueta inteira (para o guerreiro,
 * a ponta da espada erguida) e a de CORPO marca o topo ignorando os pixels de
 * arma — que para o guerreiro é o topo do elmo, e é contra ESSA linha que os
 * 13u/18u ≈ 72% da §4 se comparam. O rótulo publica a razão de CORPO, porque a
 * razão de silhueta compara corpo com ponta de arma e dá um falso negativo de
 * ~20 pontos (ver `coresForaDoCorpo`).
 */
function tiraComparativa(
  lados: readonly Lado[],
  dirs: readonly number[],
  zoom: number,
  rotularAltura: boolean
): HTMLCanvasElement {
  const n = Math.max(1, lados.length);
  // A célula é dimensionada pela EXTENSÃO PINTADA em torno da âncora, não pela
  // largura do quadro: o quadro do guerreiro tem 118px por causa da varredura da
  // espada nos 72 quadros, e usar isso aqui afastaria os bonecos meia tela um do
  // outro — que é justamente o que a tira precisa aproximar. Sem medição (jsdom),
  // cai na largura do quadro, que nunca corta nada.
  let extMax: number | null = 0;
  let larguraQuadroMax = CONFIG.TW + 6;
  for (const l of lados) {
    const e = extensaoHorizontal(l.atlas, dirs);
    if (e === null) extMax = null;
    else if (extMax !== null && e > extMax) extMax = e;
    if (l.atlas.larguraFrame > larguraQuadroMax) larguraQuadroMax = l.atlas.larguraFrame;
  }
  const larguraCelula =
    (extMax === null ? larguraQuadroMax : Math.max(extMax * 2 + 6, CONFIG.TW + 6)) * zoom;

  const gapGrupo = 22;
  const margem = 14;
  let ancoraMax = 0;
  // Anotado: `CONFIG` é `as const` e `TH` chega aqui como o literal 32.
  let abaixoMax: number = CONFIG.TH;
  for (const l of lados) {
    if (l.atlas.ancoraY > ancoraMax) ancoraMax = l.atlas.ancoraY;
    const sob = l.atlas.alturaFrame - l.atlas.ancoraY;
    if (sob > abaixoMax) abaixoMax = sob;
  }
  const acima = ancoraMax * zoom + 22;
  const abaixo = abaixoMax * zoom;
  const rodape = rotularAltura ? 54 : 20;

  // As medidas saem ANTES da tela: `medirSilhueta` só toca o canvas de rascunho,
  // e o rodapé precisa estar escrito para a tela poder nascer larga o bastante
  // para caber nele. Com dois personagens a zoom 3 o grupo tem ~410px e a linha
  // de veredito passa de 700 — antes desta ordem ela saía cortada nas pontas.
  const medidasPorDir: MedidaLado[][] = [];
  const rodapePorDir: LinhaRodape[][] = [];
  let larguraRodape = 0;
  for (const d of dirs) {
    const dir = d ?? 0;
    const medidas: MedidaLado[] = [];
    for (const lado of lados) {
      medidas.push({
        lado: lado,
        cheia: medirSilhueta(lado.atlas, dir, 'parado', 0),
        corpo: medirSilhueta(lado.atlas, dir, 'parado', 0, lado.aco ?? [])
      });
    }
    medidasPorDir.push(medidas);
    if (rotularAltura) {
      const linhas = linhasDeEscala(medidas);
      rodapePorDir.push(linhas);
      for (const l of linhas) {
        const lw = larguraDoTexto(l.texto, l.tam);
        if (lw > larguraRodape) larguraRodape = lw;
      }
    } else {
      rodapePorDir.push([]);
    }
  }

  const larguraGrupo = Math.max(larguraCelula * n, Math.ceil(larguraRodape) + 12);
  const w = margem * 2 + dirs.length * (larguraGrupo + gapGrupo) - gapGrupo;
  const h = acima + abaixo + rodape;
  const baseY = acima;

  const { cv, ctx } = novaTela(w, h);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i] ?? 0;
    const x0 = margem + i * (larguraGrupo + gapGrupo);
    const x1 = x0 + larguraGrupo;
    const medidas = medidasPorDir[i] ?? [];
    // O grupo pode ter ficado mais largo que as células por causa do rodapé:
    // centraliza os bonecos dentro dele, senão eles encostam na borda esquerda.
    const folga = (larguraGrupo - larguraCelula * n) / 2;

    for (let j = 0; j < n; j++) {
      const lado = lados[j];
      if (!lado) continue;
      const cx = x0 + folga + larguraCelula * (j + 0.5);
      losango(ctx, cx, baseY, CONFIG.TW * zoom, CONFIG.TH * zoom, '#3a4250', 'rgba(255,255,255,0.07)');
      const q = lado.atlas.quadro(dir, 'parado', 0);
      colarQuadro(ctx, lado.atlas, lado.atlas.canvas, q.sx, q.sy, cx, baseY, zoom);
    }

    // A tracejada FRACA (silhueta cheia) vai ANTES da forte (corpo): trocar a
    // ordem esconderia a de corpo sob a outra quando as duas coincidem.
    for (const m of medidas) {
      if (!m.cheia) continue;
      const y = Math.round(baseY - (m.lado.atlas.ancoraY - m.cheia.topo) * zoom);
      linhaTracejada(ctx, x0, x1, y, COR_SILHUETA_CHEIA);
    }
    for (const m of medidas) {
      if (!m.corpo) continue;
      const y = Math.round(baseY - (m.lado.atlas.ancoraY - m.corpo.topo) * zoom);
      linhaTracejada(ctx, x0, x1, y, m.lado.cor);
    }

    for (let j = 0; j < medidas.length; j++) {
      const m = medidas[j];
      if (!m) continue;
      const cx = x0 + folga + larguraCelula * (j + 0.5);
      textoCentrado(ctx, `${m.lado.nome} · dir ${dir}`, cx, h - (rotularAltura ? 42 : 7), m.lado.cor, 10);
    }

    if (rotularAltura) desenharRodape(ctx, rodapePorDir[i] ?? [], (x0 + x1) / 2, h);
  }
  return cv;
}

/**
 * As três linhas de veredito sob um grupo da tira: razão de corpo de cada um
 * contra o Guerreiro (G7), a cadeia de ordenação (G10) e a silhueta cheia.
 *
 * A régua é o Guerreiro, e não "o primeiro da lista", porque é ele que os três
 * contratos usam como denominador (13u/18u, 7u/18u, 24u/18u). Sem ele na tira a
 * razão não é calculável e a folha diz isso em vez de inventar um denominador.
 */
function linhasDeEscala(medidas: readonly MedidaLado[]): LinhaRodape[] {
  const regua = medidas.find((m) => m.lado.nome === CHAVE_REGUA);
  const alturaRegua = regua ? alturaAcimaDaAncora(regua) : null;
  const uRegua = regua && typeof regua.lado.alturaU === 'number' ? regua.lado.alturaU : 0;

  const partes: string[] = [];
  let tudoDentro = alturaRegua !== null && uRegua > 0;
  for (const m of medidas) {
    const acima = alturaAcimaDaAncora(m);
    if (acima === null) {
      partes.push(`${m.lado.nome} —`);
      tudoDentro = false;
      continue;
    }
    if (alturaRegua === null || uRegua <= 0 || typeof m.lado.alturaU !== 'number' || m.lado.alturaU <= 0) {
      partes.push(`${m.lado.nome} ${acima}px`);
      continue;
    }
    const razao = Math.round((acima / alturaRegua) * 100);
    const alvo = Math.round((m.lado.alturaU / uRegua) * 100);
    const tol = Math.max(4, Math.round(alvo * TOLERANCIA_RAZAO));
    const dentro = razao >= alvo - tol && razao <= alvo + tol;
    if (!dentro) tudoDentro = false;
    partes.push(
      `${m.lado.nome} ${acima}px ${razao}% (alvo ${m.lado.alturaU}u = ${alvo}%)${dentro ? '' : ' ✗'}`
    );
  }
  // G10 — a cadeia. Ela é conferida na ORDEM EM QUE A TIRA DESENHA, que é a
  // ordem do §13; um "cresce" aqui é o gate respondido por medição.
  const alturas = medidas.map((m) => alturaAcimaDaAncora(m));
  const mensuravel = alturas.every((a) => a !== null);
  let cresce = mensuravel;
  for (let i = 1; i < alturas.length && cresce; i++) {
    const ant = alturas[i - 1];
    const at = alturas[i];
    if (ant === null || at === null || at <= ant) cresce = false;
  }
  const cadeia = medidas.map((m) => m.lado.nome).join(' < ');

  return [
    {
      texto: `corpo acima do chão (sem arma nem contorno), % do guerreiro: ${partes.join(' · ')}`,
      cor: tudoDentro ? '#5fb36a' : '#d9534f',
      tam: 10
    },
    {
      texto: mensuravel
        ? cresce
          ? `G10 ok — a altura acima do chão cresce na ordem ${cadeia}`
          : `G10 REPROVADO — a altura acima do chão NÃO cresce na ordem ${cadeia}`
        : 'G10 não medível nesta folha (getImageData indisponível)',
      cor: mensuravel && cresce ? '#5fb36a' : '#d9534f',
      tam: 10
    },
    {
      texto:
        'silhueta cheia, do topo à base, com arma e com a PROFUNDIDADE dobrada pela projeção: ' +
        `${medidas.map((m) => `${m.lado.nome} ${px(m.cheia)}`).join(' · ')} — NÃO é o número dos gates`,
      cor: COR_SILHUETA_CHEIA,
      tam: 9
    }
  ];
}

/** Desenha as três linhas do rodapé, de baixo para cima a partir de `h`. */
function desenharRodape(
  ctx: CanvasRenderingContext2D,
  linhas: readonly LinhaRodape[],
  cx: number,
  h: number
): void {
  const base = [h - 29, h - 17, h - 6];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l) continue;
    textoCentrado(ctx, l.texto, cx, base[i] ?? h - 6, l.cor, l.tam);
  }
}

/**
 * G8 — o mesmo quadro em 4 níveis de luz, do pleno ao quase escuro.
 *
 * O losango do chão escurece junto, na mesma proporção: sem isso o sprite
 * escuro apareceria sobre um chão claro e a tira mentiria sobre o contraste que
 * o jogador realmente vê no limite do campo de visão.
 */
function tiraLuz(
  lado: Lado,
  dir: number,
  niveis: readonly number[],
  zoom: number,
  emissivas: readonly number[]
): HTMLCanvasElement {
  const opcoes: OpcoesLuz = {
    corSombra: LUZ.corSombra,
    alfaMax: LUZ.alfaMax,
    degraus: LUZ.degraus,
    emissivas: emissivas
  };
  const ext = extensaoHorizontal(lado.atlas, [dir]);
  const larguraCelula =
    (ext === null ? Math.max(lado.atlas.larguraFrame, CONFIG.TW + 6) : Math.max(ext * 2 + 8, CONFIG.TW + 6)) *
    zoom;
  const margem = 12;
  const acima = lado.atlas.ancoraY * zoom + 18;
  const abaixo = Math.max(lado.atlas.alturaFrame - lado.atlas.ancoraY, CONFIG.TH) * zoom;
  const w = margem * 2 + niveis.length * larguraCelula;
  const h = acima + abaixo + 34;
  const baseY = acima;

  const { cv, ctx } = novaTela(w, h);
  ctx.fillStyle = '#0d1014';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < niveis.length; i++) {
    const lvl = limitar01(niveis[i] ?? 0);
    const degrau = degrauDeLuz(lvl, opcoes.degraus);
    const cx = margem + larguraCelula * (i + 0.5);

    // O chão acompanha a luz: mesma névoa fria, mesma fração.
    const f = 0.28 + 0.72 * lvl;
    const r = Math.round(58 * f + opcoes.corSombra[0] * (1 - f));
    const g = Math.round(66 * f + opcoes.corSombra[1] * (1 - f));
    const b = Math.round(80 * f + opcoes.corSombra[2] * (1 - f));
    losango(
      ctx,
      cx,
      baseY,
      CONFIG.TW * zoom,
      CONFIG.TH * zoom,
      `rgb(${r},${g},${b})`,
      'rgba(255,255,255,0.05)'
    );

    const q = lado.atlas.quadro(dir, 'parado', 0);
    colarQuadro(ctx, lado.atlas, quadroComLuz(lado.atlas, q, lvl, opcoes), 0, 0, cx, baseY, zoom);

    textoCentrado(ctx, `luz ${lvl.toFixed(2)}`, cx, h - 20, '#c9d3de', 11);
    textoCentrado(
      ctx,
      `degrau ${degrau}/${opcoes.degraus - 1}`,
      cx,
      h - 7,
      i === niveis.length - 1 ? '#d9534f' : '#7d8899',
      10
    );
  }
  return cv;
}

/** Caixa dos pixels de cor EMISSIVA num quadro — é onde ficam os olhos. */
function caixaDasEmissivas(
  atlas: AtlasPronto,
  dir: number,
  estado: string,
  frame: number,
  emissivas: readonly number[]
): Extremos | null {
  if (emissivas.length === 0) return null;
  const lw = atlas.larguraFrame;
  const lh = atlas.alturaFrame;
  const q = atlas.quadro(dir, estado, frame);
  const tela = telaDeRascunho(lw, lh);
  tela.ctx.clearRect(0, 0, tela.cv.width, tela.cv.height);
  tela.ctx.imageSmoothingEnabled = false;
  tela.ctx.drawImage(atlas.canvas, q.sx, q.sy, lw, lh, 0, 0, lw, lh);
  let img: ImageData;
  try {
    img = tela.ctx.getImageData(0, 0, lw, lh);
  } catch {
    return null;
  }
  const d = img.data;
  let topo = lh;
  let base = -1;
  let esquerda = lw;
  let direita = -1;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const i = (y * lw + x) * 4;
      if (d[i + 3] === 0) continue;
      const chave = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (emissivas.indexOf(chave) < 0) continue;
      if (y < topo) topo = y;
      if (y > base) base = y;
      if (x < esquerda) esquerda = x;
      if (x > direita) direita = x;
    }
  }
  if (base < 0) return null;
  return {
    topo: topo,
    base: base,
    esquerda: esquerda,
    direita: direita,
    altura: base - topo + 1,
    largura: direita - esquerda + 1
  };
}

/**
 * O recorte dos OLHOS, bem ampliado, em luz plena e no nível mais escuro.
 *
 * Sem isto G8 fica no fio da navalha: a brasa tem 1 ou 2 px de arte e, na tira
 * de 3× acima, é um cisco que o revisor pode jurar ter visto. Lado a lado, a
 * pergunta vira trivial: o corpo tem de mudar entre os dois recortes e os
 * olhos NÃO.
 *
 * O recorte é achado pelas próprias cores emissivas — nada de "o terço de cima
 * é a cabeça", que a cimitarra erguida desmente. Sem emissiva no quadro devolve
 * `null`, e aí o aviso do subtítulo já disse o que houve.
 */
function detalheOlhos(
  lado: Lado,
  dir: number,
  lvlEscuro: number,
  emissivas: readonly number[]
): HTMLCanvasElement | null {
  const olhos = caixaDasEmissivas(lado.atlas, dir, 'parado', 0, emissivas);
  if (!olhos) return null;
  const opcoes: OpcoesLuz = {
    corSombra: LUZ.corSombra,
    alfaMax: LUZ.alfaMax,
    degraus: LUZ.degraus,
    emissivas: emissivas
  };
  const q = lado.atlas.quadro(dir, 'parado', 0);

  // Folga generosa em volta: os olhos sozinhos não provam nada — é o CORPO em
  // volta deles que precisa escurecer para o gate significar alguma coisa.
  const folga = 7;
  const x0 = Math.max(0, olhos.esquerda - folga);
  const y0 = Math.max(0, olhos.topo - folga);
  const x1 = Math.min(lado.atlas.larguraFrame, olhos.direita + folga + 1);
  const y1 = Math.min(lado.atlas.alturaFrame, olhos.base + folga + 1);
  const rw = Math.max(1, x1 - x0);
  const rh = Math.max(1, y1 - y0);
  const zoom = Math.max(4, Math.min(14, Math.round(150 / rw)));

  const gap = 10;
  const larguraCelula = rw * zoom;
  const w = Math.max(larguraCelula * 2 + gap, 330);
  const h = rh * zoom + 32;
  const { cv, ctx } = novaTela(w, h);
  ctx.fillStyle = '#07090c';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;

  const niveis: readonly (readonly [number, string])[] = [
    [1, 'luz plena'],
    [lvlEscuro, `luz ${lvlEscuro.toFixed(2)}`]
  ];
  const margem = Math.round((w - (larguraCelula * 2 + gap)) / 2);
  for (let i = 0; i < niveis.length; i++) {
    const par = niveis[i];
    if (!par) continue;
    const fonte = quadroComLuz(lado.atlas, q, par[0], opcoes);
    const dx = margem + i * (larguraCelula + gap);
    ctx.drawImage(fonte, x0, y0, rw, rh, dx, 0, larguraCelula, rh * zoom);
    textoCentrado(ctx, par[1], dx + larguraCelula / 2, rh * zoom + 12, '#c9d3de', 10);
  }
  textoCentrado(
    ctx,
    `detalhe ${zoom}× nos olhos — G8: o corpo muda, a brasa não`,
    w / 2,
    h - 5,
    '#d9534f',
    10
  );
  return cv;
}

/* ------------------------------------------------------------------ *
 * 4. Montagem do DOM
 * ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (classe) n.className = classe;
  if (texto !== undefined) n.textContent = texto;
  return n;
}

function secao(titulo: string, sub: string): HTMLElement {
  const s = el('section', 'secao');
  s.append(el('h2', undefined, titulo), el('p', 'sub', sub));
  return s;
}

function cartao(canvas: HTMLCanvasElement, rotulo: string, detalhe: string): HTMLElement {
  const c = el('div', 'cartao');
  c.append(canvas, el('div', 'rotulo', rotulo), el('div', 'detalhe', detalhe));
  return c;
}

function medida(rot: string, val: string, destaque = false): HTMLElement {
  const d = el('div', destaque ? 'medida destaque' : 'medida');
  d.append(el('span', 'rot', rot), el('span', 'val', val));
  return d;
}

/** Empilha canvases dentro de uma seção sem depender de classe nova no CSS. */
function pilhaDeCanvas(...nos: readonly HTMLElement[]): HTMLElement {
  const d = el('div');
  d.style.display = 'grid';
  d.style.gap = '8px';
  d.append(...nos);
  return d;
}

/**
 * Para onde a direção do grid aponta NA TELA, derivado de DIRS8 pela mesma
 * projeção do jogo (isoX = x−y, isoY = (x+y)/2). É o gate G3 escrito na imagem:
 * o revisor não precisa fazer a conta de cabeça.
 */
function rumoNaTela(dx: number, dy: number): string {
  const sx = dx - dy;
  const sy = (dx + dy) / 2;
  const vert = sy > 0.01 ? 'baixo' : sy < -0.01 ? 'cima' : '';
  const horiz = sx > 0.01 ? 'direita' : sx < -0.01 ? 'esquerda' : '';
  const partes = [vert, horiz].filter((p) => p !== '');
  return partes.length > 0 ? partes.join('-') : '—';
}

function zoomDirecoes(atlas: AtlasPronto): number {
  const maior = Math.max(atlas.larguraFrame, atlas.alturaFrame, 1);
  // ≥ 4× por contrato; sobe até 6× quando o quadro é pequeno o bastante.
  return Math.max(4, Math.min(6, Math.floor(300 / maior)));
}

/** Tudo que a folha precisa de um personagem já resolvido. */
interface Preparado {
  readonly ficha: Ficha;
  readonly mod: Registro;
  readonly rig: RigLike;
  readonly atlas: AtlasPronto;
  readonly achados: readonly string[];
  readonly ms: number;
  readonly emissivas: readonly number[];
  /** §8/G7 — RGB de arma + contorno, para medir o corpo sem eles. */
  readonly aco: readonly number[];
}

/** Resolve módulo → rig → opções → atlas. Lança com mensagem legível. */
function prepararPersonagem(ficha: Ficha): Preparado {
  const mod = resolverModulo(ficha);
  const rig = resolverRig(mod, ficha);
  const { opts, achados } = montarOpcoes(mod, ficha);
  const forjar = resolverForja(modForge as unknown as Registro, opts);
  const t0 = performance.now();
  const bruto = forjar(rig);
  const medido = performance.now() - t0;
  const atlas = exigirPixels(bruto);
  return {
    ficha: ficha,
    mod: mod,
    rig: rig,
    atlas: atlas,
    achados: achados,
    ms: atlas.msForja ?? medido,
    emissivas: coresEmissivas(mod, ficha),
    aco: coresForaDoCorpo(mod, ficha)
  };
}

/** Numera as faixas na ordem em que elas entram na folha. */
function contador(): () => string {
  let n = 0;
  return () => String(++n);
}

/** Um `Preparado` visto pela tira de escala. */
function ladoDe(p: Preparado, cor?: string): Lado {
  return {
    atlas: p.atlas,
    nome: p.ficha.chave,
    cor: cor ?? p.ficha.corNaTira,
    aco: p.aco,
    alturaU: p.ficha.alturaU
  };
}

/**
 * O elenco na ordem do §13 (Slime, Goblin, Guerreiro, Ogro), pulando quem não
 * pôde ser forjado. Um bicho ausente não pode derrubar a tira: G9 com três dos
 * quatro ainda é uma pergunta respondível, e a legenda diz quem faltou.
 */
function elencoDisponivel(cache: Map<string, Preparado | null>): Preparado[] {
  const saida: Preparado[] = [];
  for (const chave of ORDEM_ELENCO) {
    const p = cache.get(chave);
    if (p) saida.push(p);
  }
  return saida;
}

/** Quem o elenco não conseguiu forjar, para a legenda dizer em vez de omitir. */
function faltandoNoElenco(cache: Map<string, Preparado | null>): string[] {
  return ORDEM_ELENCO.filter((c) => !cache.get(c));
}

/**
 * A faixa do elenco (G9 e G10), pronta para entrar em qualquer folha.
 *
 * `zoomGrande` é a linha de julgamento — uma direção só, ampliada, com o rodapé
 * de medidas. Abaixo dela vêm as 8 direções em tamanho de jogo, em duas linhas
 * de quatro: numa linha só a tira passaria de 3000px e a folha inteira herdaria
 * essa largura, porque o `<body>` é `max-content`.
 */
function faixaDoElenco(
  elenco: readonly Preparado[],
  zoomGrande: number,
  incluirOitoDirecoes: boolean
): HTMLElement[] {
  const lados = elenco.map((p) => ladoDe(p));
  const nos: HTMLElement[] = [tiraComparativa(lados, [DIR_ANIMACAO], zoomGrande, true)];
  if (incluirOitoDirecoes) {
    nos.push(tiraComparativa(lados, [0, 1, 2, 3], 1, false));
    nos.push(tiraComparativa(lados, [4, 5, 6, 7], 1, false));
  }
  return nos;
}

/** O subtítulo da faixa do elenco, incluindo quem faltou. */
function subtituloElenco(faltando: readonly string[]): string {
  const base =
    'mesma escala, mesma âncora, mesmos losangos — nenhum fator de zoom entre eles · ' +
    'ordem de tamanho do §13: ' +
    ORDEM_ELENCO.join(' < ') +
    ' · G9 se julga pela SILHUETA e pela SATURAÇÃO (Slime vibrante, Goblin médio, ' +
    'Ogro pálido — §12.2), G10 pela linha de veredito, que compara a altura de corpo ' +
    'ACIMA DO CHÃO medida no atlas com a razão de contrato em `u` (ver ' +
    '`alturaAcimaDaAncora`: a altura da silhueta NÃO serve, porque a projeção ' +
    'isométrica soma a profundidade do bicho dentro dela)' +
    ' · O VEREDITO DE G10 É A CADEIA, NÃO A %: o `alvo` sai da altura de MASSA que ' +
    'o contrato declara em `u` (7 · 13 · 18 · 24), enquanto o MEDIDO é o pixel de corpo ' +
    'mais alto — e esse inclui crista, orelha, antena e espinho, que nenhum dos quatro ' +
    'contratos conta na altura declarada. Por isso os três monstros medem alguns pontos ' +
    'ACIMA do alvo por construção, e não por erro de âncora; quem calibrar o quinto bicho ' +
    'pela % vai achatá-lo sem motivo';
  if (faltando.length === 0) return base;
  return `${base} · ATENÇÃO: faltou forjar ${faltando.join(', ')} — a tira está incompleta`;
}

function montar(
  raiz: HTMLElement,
  alvo: Preparado,
  outros: Map<string, Preparado | null>,
  forjaMs: number
): number {
  const ficha = alvo.ficha;
  const comparado = ficha.compararCom ? (outros.get(ficha.compararCom) ?? null) : null;
  const atlas = alvo.atlas;
  const zDir = zoomDirecoes(atlas);
  const zAnim = Math.max(4, zDir - 1);
  const totalQuadros = 8 * ESTADOS.reduce((s, e) => s + e.quadros, 0);
  const n = contador();

  /* --- cabeçalho --- */
  const cab = el('header', 'cabecalho');
  const tit = el('div');
  tit.append(
    el('h1', 'titulo', ficha.titulo),
    el('p', 'subtitulo', `rig "${alvo.rig.nome}" · ${ficha.doc} · compare com ${ficha.referencia}`)
  );
  const meds = el('div', 'medidas');
  meds.append(
    // Alvo de §7: < 40 ms na inicialização. Verde = dentro.
    medida('forja', `${forjaMs.toFixed(1)} ms`, forjaMs <= 40),
    // O tempo do personagem de comparação, quando há um. Sem ele o painel
    // imprimia um estouro sem veredito: nesta bancada (Chrome headless, sem
    // GPU) o GUERREIRO também passa dos 40 ms, então o alvo é do AMBIENTE, não
    // do rig novo — e é isso que a segunda medida deixa ver de uma olhada.
    ...(comparado ? [medida(`forja ${comparado.ficha.chave}`, `${comparado.ms.toFixed(1)} ms`)] : []),
    medida('quadros', String(totalQuadros)),
    medida('quadro', `${atlas.larguraFrame}×${atlas.alturaFrame}`),
    medida('âncora', `${atlas.ancoraX},${atlas.ancoraY}`),
    medida('atlas', `${atlas.canvas.width}×${atlas.canvas.height}`)
  );
  // A resolução do buffer de ARTE é o que decide se isto é pixel art ou 3D liso
  // (§3): o modelo é rasterizado aí e só depois ampliado ×PIXEL.
  if (typeof atlas.larguraArte === 'number' && typeof atlas.alturaArte === 'number') {
    meds.append(medida('arte', `${atlas.larguraArte}×${atlas.alturaArte}`));
  }
  if (typeof atlas.pixel === 'number') meds.append(medida('pixel', `${atlas.pixel}×`));
  meds.append(medida('ampliação', `${zDir}×`));
  // §12.5 — a oclusão, medida em vez de estimada: quanto a silhueta transborda
  // do losango de 64×32 para cada lado da âncora. É o número que o Ogro (24u)
  // precisa publicar, e ele vale para todo mundo porque a pendência de z-buffer
  // é do renderer, não do bicho. O verde é a folga já conhecida do Guerreiro.
  const invasao = extensaoHorizontal(atlas, [0, 1, 2, 3, 4, 5, 6, 7]);
  if (invasao !== null) {
    const excesso = Math.max(0, Math.round(invasao - CONFIG.TW / 2));
    meds.append(
      medida('invade o tile', `${excesso}px (meia silhueta ${invasao}px · meio tile ${CONFIG.TW / 2}px)`, excesso <= 12)
    );
  }
  cab.append(tit, meds);
  raiz.append(cab);

  /* --- 1. as 8 direções paradas --- */
  const sDir = secao(
    `${n()} · as 8 direções — estado parado, quadro 0`,
    `ampliadas ${zDir}× · o losango é o tile 64×32 do jogo, a cruz âmbar é a âncora · ` +
      'G3: a direção 0 (1,0) tem de olhar para baixo-direita'
  );
  const fDir = el('div', 'faixa');
  for (let dir = 0; dir < 8; dir++) {
    const d = DIRS8[dir];
    const dx = d ? d[0] : 0;
    const dy = d ? d[1] : 0;
    fDir.append(
      cartao(
        celulaQuadro(atlas, dir, 'parado', 0, zDir),
        `${dir} (${dx},${dy}) ${NOMES_DIR[dir] ?? '?'}`,
        `na tela: ${rumoNaTela(dx, dy)}`
      )
    );
  }
  sDir.append(fDir);
  raiz.append(sDir);

  /* --- 2 e 3. as duas animações, lado a lado --- */
  const colsAnim = el('div', 'colunas');
  const dAnim = DIRS8[DIR_ANIMACAO];
  const rotuloDir = `dir ${DIR_ANIMACAO} (${dAnim ? dAnim[0] : 0},${dAnim ? dAnim[1] : 0}) ${
    NOMES_DIR[DIR_ANIMACAO] ?? '?'
  }`;
  for (const estado of ESTADOS) {
    if (estado.chave === 'parado') continue;
    const s = secao(
      `${n()} · ${estado.chave} — ${rotuloDir}`,
      `${estado.quadros} quadros · ${ficha.legendasAnim?.[estado.chave] ?? estado.descricao} · ` +
        `ampliados ${zAnim}×`
    );
    const f = el('div', 'faixa');
    for (let i = 0; i < estado.quadros; i++) {
      f.append(
        cartao(
          celulaQuadro(atlas, DIR_ANIMACAO, estado.chave, i, zAnim),
          `quadro ${i}`,
          `${estado.chave} · ${i + 1}/${estado.quadros}`
        )
      );
    }
    s.append(f);
    colsAnim.append(s);
  }

  /* --- 4, 5 e 6. tamanho de jogo, paleta e gates --- */
  const colsBaixo = el('div', 'colunas');

  const sReal = secao(
    `${n()} · como o jogador vê (1× e 2×)`,
    'um sprite por tile, sem ampliação de bancada · o jogo vai de 0,45× a 2,4× de zoom'
  );
  sReal.append(pilhaDeCanvas(tiraTamanhoReal(atlas, 1), tiraTamanhoReal(atlas, 2)));
  colsBaixo.append(sReal);

  /* --- as duas faixas exclusivas do bestiário (§8): G7 e G8 --- */
  const colsExtra = el('div', 'colunas');
  let temExtra = false;

  if (ficha.compararCom) {
    const sCmp = secao(
      `${n()} · escala contra o guerreiro (G7)`,
      comparado
        ? 'mesma escala, mesma âncora, mesmos losangos — nenhum fator de zoom entre os dois · ' +
            'tracejada COLORIDA = topo do corpo (sem arma nem contorno), tracejada cinza = ' +
            'silhueta cheia · G7 se julga pela primeira, e o número publicado é a altura ' +
            `ACIMA DO CHÃO: a §4 compara ${ficha.alturaU}u de corpo com ` +
            `${FICHA_GUERREIRO.alturaU}u de corpo, não com a ponta da espada erguida nem ` +
            'com a profundidade que a projeção isométrica dobra dentro da silhueta'
        : 'INDISPONÍVEL — ver aviso abaixo'
    );
    if (comparado) {
      // A ordem é a de tamanho do §13 quando ela é conhecida: o Ogro fica à
      // DIREITA do guerreiro e o Slime à esquerda, para a leitura da tira bater
      // com a cadeia que G10 cobra. Sem altura declarada, mantém guerreiro
      // primeiro, que é como a tira nasceu.
      const par: readonly Lado[] =
        alvo.ficha.alturaU > comparado.ficha.alturaU
          ? [ladoDe(comparado), ladoDe(alvo)]
          : [ladoDe(alvo), ladoDe(comparado)];
      sCmp.append(
        pilhaDeCanvas(
          tiraComparativa(par, [DIR_ANIMACAO], 3, true),
          tiraComparativa(par, [0, 1, 2, 3, 4, 5, 6, 7], 1, false)
        )
      );
    } else {
      const aviso = el(
        'p',
        'sub',
        `não foi possível forjar o atlas de "${ficha.compararCom}" para a comparação — ` +
          'G7 não é julgável nesta folha. O erro apareceu no console da página.'
      );
      aviso.style.color = '#d9534f';
      sCmp.append(aviso);
    }
    colsExtra.append(sCmp);
    temExtra = true;
  }

  if (ficha.tiraDeLuz) {
    const semEmissiva = alvo.emissivas.length === 0;
    const sLuz = secao(
      `${n()} · ${NIVEIS_LUZ.length} níveis de luz (G8)`,
      `atlas forjado UMA vez com brilho pleno e escurecido no desenho (§1) · ` +
        `${LUZ.degraus} degraus quantizados, cache por (quadro, degrau) · ` +
        `alfa da sombra no degrau 0 = ${LUZ.alfaMax} (ALFA_SOMBRA_MAX do forge, ` +
        'calibrado pelo `litEntity` dos inimigos geométricos — o corpo perde ~metade ' +
        'do brilho, não vira preto) · ' +
        (semEmissiva
          ? ficha.emissivaPorContrato
            ? 'este personagem NÃO tem cor emissiva, por decisão do contrato (§12.2): ' +
              'aqui G8 se julga só pelo corpo escurecendo por inteiro — nenhum ponto ' +
              'pode ficar aceso'
            : 'ATENÇÃO: nenhuma cor emissiva encontrada na paleta — os olhos vão escurecer junto'
          : `emissivas preservadas: ${ficha.nomes.emissivas.join(', ')} (§1.1)`)
    );
    const ladoLuz: Lado = { atlas: atlas, nome: ficha.chave, cor: '#5fb36a' };
    const maisEscuro = NIVEIS_LUZ[NIVEIS_LUZ.length - 1] ?? 0;
    const canvasesLuz: HTMLElement[] = [
      tiraLuz(ladoLuz, DIR_ANIMACAO, NIVEIS_LUZ, 3, alvo.emissivas)
    ];
    const detalhe = detalheOlhos(ladoLuz, DIR_ANIMACAO, maisEscuro, alvo.emissivas);
    if (detalhe) canvasesLuz.push(detalhe);
    sLuz.append(pilhaDeCanvas(...canvasesLuz));
    colsExtra.append(sLuz);
    temExtra = true;
  }

  /* --- o elenco inteiro: G9 e G10 (§13) --- */
  if (ficha.tiraDeElenco) {
    const elenco = elencoDisponivel(outros);
    const faltando = faltandoNoElenco(outros);
    const sElenco = secao(
      `${n()} · o elenco inteiro (G9 e G10)`,
      elenco.length >= 2
        ? subtituloElenco(faltando)
        : 'INDISPONÍVEL — não houve personagem suficiente para montar a tira'
    );
    if (elenco.length >= 2) {
      // Sem as 8 direções aqui: elas custam ~1500px de largura e esta folha já é
      // a do bicho. Quem precisa das oito abre `preview-elenco.png`.
      sElenco.append(pilhaDeCanvas(...faixaDoElenco(elenco, 3, false)));
      const nota = el(
        'p',
        'sub',
        'esta é a mesma tira que a folha do elenco (docs/ref/preview-elenco.png, ' +
          '`npm run preview:personagem -- elenco`) mostra em tamanho maior e nas 8 direções.'
      );
      sElenco.append(nota);
    }
    colsExtra.append(sElenco);
    temExtra = true;
  }

  const paleta = paresDaPaleta(
    ficha,
    alvo.mod,
    modModel as unknown as Registro,
    modForge as unknown as Registro
  );
  if (paleta.length > 0) {
    const sPal = secao(
      `${n()} · paleta exportada`,
      `${paleta.length} cores · G5: nenhuma cor fora desta lista pode aparecer nos sprites`
    );
    const grade = el('div', 'paleta');
    for (const [nome, cor] of paleta) {
      const a = el('div', 'amostra');
      const sw = el('i');
      sw.style.background = cor;
      a.append(sw, el('span', undefined, nome), el('b', undefined, cor));
      grade.append(a);
    }
    sPal.append(grade);
    colsBaixo.append(sPal);
  }

  const sGates = secao(`${n()} · gates da revisão (${ficha.docGate})`, 'responda por escrito, um a um');
  const lista = el('ul', 'gates');
  for (const [id, texto] of ficha.gates) {
    const li = el('li');
    li.append(el('b', undefined, `${id} `), document.createTextNode(texto));
    lista.append(li);
  }
  sGates.append(lista);
  colsBaixo.append(sGates);

  /* --- folha de contato, alta, ocupando a coluna da direita --- */
  const zAtlas = atlas.canvas.width * 2 <= 900 ? 2 : 1;
  const sAtlas = secao(
    `${n()} · atlas completo`,
    `${totalQuadros} quadros a ${zAtlas}× · cada moldura âmbar é um quadro reivindicado ` +
      'por quadro(dir, estado, i) — moldura vazia é quadro perdido'
  );
  sAtlas.append(folhaContato(atlas, zAtlas));

  const esquerda = el('div', 'pilha');
  if (temExtra) esquerda.append(colsAnim, colsExtra, colsBaixo);
  else esquerda.append(colsAnim, colsBaixo);
  const corpo = el('div', 'colunas');
  corpo.append(esquerda, sAtlas);
  raiz.append(corpo);
  raiz.append(
    el(
      'div',
      'rodape',
      `Gerado por tools/preview-personagem.mjs · opções passadas à forja: ` +
        `${alvo.achados.length > 0 ? alvo.achados.join(', ') : 'nenhuma (a forja rodou com o padrão dela)'} · ` +
        'nenhum recurso externo · reprovou em algum gate: corrige e roda de novo ' +
        '(2 a 3 rodadas é o esperado).'
    )
  );

  return totalQuadros;
}

/**
 * A folha do ELENCO — só a tira dos quatro, grande, e o que ajuda a julgá-la.
 *
 * Ela não tem atlas, nem paleta, nem 72 quadros: é a imagem de PRODUTO desta
 * fase. Quem a abre está respondendo duas perguntas — "são espécies diferentes?"
 * (G9) e "o tamanho conta a história certa?" (G10) —, e qualquer coisa a mais
 * na página só disputa a atenção com elas.
 *
 * O que entra além da tira: as quatro paletas empilhadas, porque G9 é metade
 * silhueta e metade SATURAÇÃO (§12.2: Slime vibrante, Goblin médio, Ogro
 * pálido), e essa metade não se julga olhando sprite de 60px.
 */
function montarElenco(
  raiz: HTMLElement,
  ficha: Ficha,
  cache: Map<string, Preparado | null>,
  forjaMs: number
): number {
  const elenco = elencoDisponivel(cache);
  const faltando = faltandoNoElenco(cache);
  const n = contador();

  const cab = el('header', 'cabecalho');
  const tit = el('div');
  tit.append(
    el('h1', 'titulo', ficha.titulo),
    el(
      'p',
      'subtitulo',
      `${elenco.length} de ${ORDEM_ELENCO.length} personagens forjados · ${ficha.doc} · ` +
        'compare com as quatro referências de docs/ref/'
    )
  );
  const meds = el('div', 'medidas');
  meds.append(medida('forja total', `${forjaMs.toFixed(1)} ms`));
  for (const p of elenco) {
    meds.append(medida(p.ficha.chave, `${p.ficha.alturaU}u · ${p.ms.toFixed(0)} ms`));
  }
  cab.append(tit, meds);
  raiz.append(cab);

  if (elenco.length < 2) {
    const aviso = el(
      'div',
      'erro',
      `O elenco precisa de pelo menos dois personagens forjados e só ${elenco.length} ` +
        `saiu. Faltaram: ${faltando.join(', ') || '(nenhum)'}.`
    );
    raiz.append(aviso);
    return 0;
  }

  const sTira = secao(`${n()} · o elenco (G9 e G10)`, subtituloElenco(faltando));
  sTira.append(pilhaDeCanvas(...faixaDoElenco(elenco, 4, true)));
  raiz.append(sTira);

  const colsBaixo = el('div', 'colunas');

  const sPal = secao(
    `${n()} · as paletas lado a lado (a metade de G9 que o sprite não mostra)`,
    'os três monstros são esverdeados de propósito e é a SATURAÇÃO que os separa à ' +
      'distância (§12.2) · se duas colunas destas parecerem a mesma coisa aqui, elas ' +
      'vão parecer a mesma coisa na masmorra'
  );
  for (const p of elenco) {
    const pares = paresDaPaleta(p.ficha, p.mod);
    if (pares.length === 0) continue;
    sPal.append(el('div', 'rotulo', `${p.ficha.chave} — ${pares.length} cores`));
    const grade = el('div', 'paleta');
    for (const [nome, cor] of pares) {
      const a = el('div', 'amostra');
      const sw = el('i');
      sw.style.background = cor;
      a.append(sw, el('span', undefined, nome), el('b', undefined, cor));
      grade.append(a);
    }
    sPal.append(grade);
  }
  colsBaixo.append(sPal);

  const sGates = secao(`${n()} · gates desta folha (${ficha.docGate})`, 'responda por escrito, um a um');
  const lista = el('ul', 'gates');
  for (const [id, texto] of ficha.gates) {
    const li = el('li');
    li.append(el('b', undefined, `${id} `), document.createTextNode(texto));
    lista.append(li);
  }
  sGates.append(lista);
  colsBaixo.append(sGates);
  raiz.append(colsBaixo);

  raiz.append(
    el(
      'div',
      'rodape',
      'Gerado por tools/preview-personagem.mjs -- elenco · nenhum recurso externo · ' +
        'a folha de cada bicho (preview-slime/goblin/ogro.png) traz esta mesma tira ' +
        'menor, junto dos outros oito gates.'
    )
  );

  // O "quadro" desta folha é o somatório dos atlas que ela abriu — é o número
  // que o capturador imprime, e zero aqui pareceria folha vazia.
  return elenco.length * 8 * ESTADOS.reduce((s, e) => s + e.quadros, 0);
}

function painelErro(raiz: HTMLElement, ficha: Ficha, e: unknown): void {
  const p = el('div', 'erro');
  p.append(
    el('h2', undefined, `A bancada não conseguiu forjar o atlas de "${ficha.chave}"`),
    el('p', undefined, msgDe(e)),
    el('pre', undefined, e instanceof Error && e.stack ? e.stack : 'sem pilha disponível')
  );
  raiz.append(p);
}

/* ------------------------------------------------------------------ *
 * 5. Marcação para o capturador
 * ------------------------------------------------------------------ */

/**
 * Escreve no <body> o tamanho exato da página. tools/preview-personagem.mjs lê
 * isso com `--dump-dom` e só então tira a foto com a janela do tamanho certo —
 * é o que garante uma imagem sem corte e sem tarja preta.
 *
 * A leitura de scrollWidth força o layout de forma síncrona, então isto vale
 * ainda que nada tenha sido pintado: não dependemos de requestAnimationFrame,
 * que sob `--virtual-time-budget` pode não fechar antes do dump.
 *
 * `data-personagem` fecha o circuito do fragmento: o capturador confere que a
 * página desenhou o personagem que ele pediu, em vez de fotografar o guerreiro
 * achando que é o goblin.
 */
function marcar(chave: string, forjaMs: number, quadros: number, erro?: string): void {
  const doc = document.documentElement;
  const w = Math.ceil(Math.max(doc.scrollWidth, document.body.scrollWidth));
  const h = Math.ceil(Math.max(doc.scrollHeight, document.body.scrollHeight));
  document.body.dataset['bancada'] = `${w}x${h}`;
  document.body.dataset['personagem'] = chave;
  document.body.dataset['forja'] = forjaMs.toFixed(2);
  document.body.dataset['quadros'] = String(quadros);
  if (erro) document.body.dataset['erro'] = erro.replace(/\s+/g, ' ').slice(0, 400);
}

/** Parâmetros vindos do fragmento da URL (`#personagem=goblin&forja=12.3`). */
function paramDoFragmento(nome: string): string | null {
  const frag = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  return new URLSearchParams(frag).get(nome);
}

/**
 * O relógio do Chrome headless é virtualizado por `--virtual-time-budget`, e sob
 * ele um trecho síncrono pode medir 0 ms. Por isso o capturador mede o tempo de
 * forja numa primeira passada SEM relógio virtual e devolve o número real pelo
 * fragmento da URL (#forja=12.3). Havendo esse valor, ele manda.
 */
function forjaInformada(): number | null {
  const v = paramDoFragmento('forja');
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Sem fragmento, a folha é a do guerreiro — a bancada de antes desta fase. */
function escolherFicha(): Ficha {
  const pedido = (paramDoFragmento('personagem') ?? '').trim().toLowerCase();
  if (pedido === '') return FICHA_GUERREIRO;
  for (const f of FICHAS) {
    if (f.chave === pedido || f.apelidos.indexOf(pedido) >= 0) return f;
  }
  return FICHA_GUERREIRO;
}

/**
 * Forja os personagens de apoio de uma folha, tolerando falha em cada um.
 *
 * Um bicho que não forja não pode derrubar a folha inteira: G7, G9 e G10 ficam
 * sem imagem, e os outros sete gates continuam julgáveis. O `Map` guarda também
 * o `null` do que falhou, para a legenda poder dizer QUEM faltou em vez de
 * simplesmente desenhar menos gente sem explicar.
 *
 * O cache é por chave e alimentado uma vez só, porque cada `prepararPersonagem`
 * forja 72 quadros: a folha do ogro precisa dele, do guerreiro (G7) e do elenco
 * inteiro (G9/G10), e sem cache o guerreiro seria forjado duas vezes.
 */
function prepararApoio(
  chaves: readonly string[],
  cache: Map<string, Preparado | null> = new Map<string, Preparado | null>()
): Map<string, Preparado | null> {
  for (const chave of chaves) {
    if (cache.has(chave)) continue;
    const outra = FICHAS.find((f) => f.chave === chave && f.modo === 'personagem');
    if (!outra) {
      cache.set(chave, null);
      continue;
    }
    try {
      cache.set(chave, prepararPersonagem(outra));
    } catch (e) {
      console.warn(`personagem de apoio indisponível (${chave}):`, msgDe(e));
      cache.set(chave, null);
    }
  }
  return cache;
}

/** Quem esta folha precisa forjar além do alvo. */
function apoioNecessario(ficha: Ficha): string[] {
  const chaves: string[] = [];
  if (ficha.compararCom) chaves.push(ficha.compararCom);
  if (ficha.tiraDeElenco) chaves.push(...ORDEM_ELENCO);
  return chaves;
}

function principal(): void {
  const raiz = document.getElementById('bancada');
  if (!raiz) return;
  const ficha = escolherFicha();
  document.title = ficha.titulo;
  try {
    if (ficha.modo === 'elenco') {
      const cache = prepararApoio(ORDEM_ELENCO);
      let soma = 0;
      for (const p of cache.values()) if (p) soma += p.ms;
      const forjaMs = forjaInformada() ?? soma;
      const quadros = montarElenco(raiz, ficha, cache, forjaMs);
      marcar(ficha.chave, forjaMs, quadros);
      return;
    }

    const alvo = prepararPersonagem(ficha);
    // O alvo entra no cache ANTES do apoio: ele aparece na própria lista do
    // elenco, e sem a semente `prepararApoio` o forjaria uma segunda vez.
    const semente = new Map<string, Preparado | null>([[ficha.chave, alvo]]);
    const cache = prepararApoio(apoioNecessario(ficha), semente);
    // Ordem de preferência: o número real medido pelo capturador (passada 1, sem
    // relógio virtual) > o que a própria forja cronometrou > o nosso relógio.
    const forjaMs = forjaInformada() ?? alvo.ms;
    const quadros = montar(raiz, alvo, cache, forjaMs);
    marcar(ficha.chave, forjaMs, quadros);
  } catch (e) {
    painelErro(raiz, ficha, e);
    marcar(ficha.chave, 0, 0, msgDe(e));
  }
}

principal();
