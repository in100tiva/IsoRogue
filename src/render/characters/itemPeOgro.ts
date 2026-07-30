/*
 * ISOROGUE — src/render/characters/itemPeOgro.ts
 *
 * O rig do PÉ DE OGRO: o despojo do Brutamontes (`./ogre`), a pata decepada que
 * fica caída no chão da masmorra depois do abate e que depois vira ícone de
 * bolsa — moeda de venda e entrega de missão.
 *
 * Mesmo molde dos rigs de personagem (`./warrior`, `./goblin`, `./slime`,
 * `./ogre`) e exatamente os mesmos limites:
 *   - é a fonte da verdade da FORMA (árvore de nós, pivôs, caixas);
 *   - é a fonte da verdade da COR (`PALETA_PE_OGRO` + rampas de material);
 *   - guarda a "pose" de repouso, que aqui é vazia de propósito
 *     (`POSE_PARADA_PE_OGRO`).
 *
 * O que ele NÃO é: não projeta, não rasteriza, não anima, não conhece Canvas,
 * não conhece inventário, não conhece preço, não conhece missão. Projeção e
 * faces são de `../model3d`; atlas é de `../spriteForge`; quem decide que um
 * ogro morto larga isto é outra camada inteiramente. Um despojo é APARÊNCIA.
 *
 * AUTONOMIA DELIBERADA — este arquivo NÃO importa nada de `./ogre`, nem a
 * paleta. Os hexes de pele foram COPIADOS de `PALETA_OGRO` (§12.2 do
 * docs/BESTIARIO.md) e a cópia é a decisão certa aqui, pelo mesmo motivo que
 * `./xpTexto` não importa a paleta do Guerreiro: um item de chão é forjado num
 * atlas próprio, com o seu próprio registro de paleta, e não pode arrastar o
 * módulo mais pesado do bestiário (1300 linhas, `MODELO_OGRO` construído no
 * import) para dentro do bundle só para ler oito strings. O acoplamento que
 * importa — "a pele do despojo é a pele do bicho" — está preservado no VALOR,
 * e o dia em que a pele do Ogro mudar, muda aqui também: é uma linha de
 * `rg -n "peleBase" src/render/characters/`, e o comentário de cada cor abaixo
 * diz de onde ela veio.
 *
 * OS TRÊS TRAÇOS DE IDENTIDADE (o inventário deste item; perder um deles é
 * perder o item, não é acabamento):
 *
 *   I1  TAMANHO desproporcional — é pé de bicho GRANDE: atarracado, pesado,
 *       largo. Ele é o maior dos despojos do jogo (ver `PROPORCOES_PE_OGRO`);
 *   I2  DEDOS GROSSOS com unhas claras na frente — três prongas separadas por
 *       vão de fundo, cada uma com uma tampa de `osso` na ponta. É o que
 *       distingue "pé" de "pedra";
 *   I3  TORNOZELO CORTADO atrás — o coto que sobe acima da massa do pé e
 *       termina num corte escuro com a medula à mostra. É o traço que faz o
 *       objeto ler como DESPOJO e não como pegada, casco ou seixo.
 *
 * Invariantes:
 *   - Determinístico: zero `Math.random`, zero relógio, zero DOM.
 *   - `criarModeloPeOgro()` devolve uma árvore NOVA a cada chamada — nenhum
 *     array é compartilhado entre instâncias.
 *   - A SOLA assenta em z = 0. O plano do chão é a âncora do sprite (§3 do
 *     docs/PERSONAGEM.md): um item que nasce com a base em z > 0 flutua sobre o
 *     losango do tile, e num objeto cuja silhueta tem ~15px de arte de altura,
 *     1u de flutuação (2,5px) é um sexto do item no ar.
 */

import type { Caixa, No, Pose } from '../model3d';

/* ------------------------------------------------------------------ *
 * 1. Paleta — herdada do Ogro, sem uma cor nova
 * ------------------------------------------------------------------ */

/**
 * As oito cores do despojo. Todos os hexes são CÓPIA LITERAL de `PALETA_OGRO`
 * (§12.2 do docs/BESTIARIO.md) — nenhum tom novo foi inventado.
 *
 * Por que a herança é o requisito e não a conveniência: o jogador precisa
 * ligar o objeto no chão ao bicho que ele acabou de matar, e o único canal
 * disponível para isso num sprite de ~20×15px de arte é a COR. Um verde
 * "parecido" não serve — depois do snap de paleta de §2.1 do `../spriteForge`
 * cada pixel é forçado para o degrau mais próximo, então pele copiada cai
 * EXATAMENTE nos mesmos quatro degraus do corpo do Ogro, e pele "quase igual"
 * cai em degraus vizinhos e lê como outro material. A dessaturação também é
 * herdada de propósito (§12.2: Slime vibrante, Goblin médio, Ogro pálido) — um
 * despojo mais saturado que o dono viraria um terceiro verde no chão.
 *
 * A UNHA/GARRA não precisou de cor nova: o Ogro já declara `osso` (#e8e0cc,
 * espinhos, chifres e a caveira do saiote), que é o tom mais claro da paleta
 * dele e é exatamente o marfim que uma garra pede. Reaproveitar `osso` em vez
 * de acrescentar um `unha` mantém o gate G5 (nenhum pixel fora da paleta)
 * verde de graça e ainda amarra a leitura: a mesma cor que faz os chifres do
 * bicho faz as garras do despojo dele.
 *
 * O QUE FOI DESCARTADO, para a próxima rodada não refazer a discussão: um tom
 * de CARNE/sangue no corte (I3). Ele seria a segunda cor nova do arquivo, e o
 * corte já tem três degraus de contraste sem ele — `peleBase` no coto,
 * `vazio` na tampa do corte e `osso` na medula, que é a maior distância de
 * luminância que a paleta do Ogro consegue produzir (178,5 → 31,4 → 224,1).
 * Vermelho aqui compraria "gore" e venderia coerência de família: o bestiário
 * inteiro é dessaturado e nenhum dos quatro bichos tem uma cor quente. Se a
 * revisão visual pedir sangue, o lugar é este bloco (uma entrada, uma rampa
 * própria) e não um retoque no `vazio`, que é compartilhado.
 */
export const PALETA_PE_OGRO = {
  peleLuz: '#c6dcbb', // ← PALETA_OGRO.peleLuz  — topo do coto e do peito do pé
  peleBase: '#a3c096', // ← PALETA_OGRO.peleBase — massa do pé, dedos, coto
  peleMeio: '#7d9a72', // ← PALETA_OGRO.peleMeio — calcanhar e arco (o "meio" escuro)
  peleSombra: '#576d50', // ← PALETA_OGRO.peleSombra — vãos, faces afastadas
  osso: '#e8e0cc', // ← PALETA_OGRO.osso      — unhas (I2) e medula do corte (I3)
  ossoSombra: '#9c9078', // ← PALETA_OGRO.ossoSombra — face afastada do osso
  vazio: '#1a2416', // ← PALETA_OGRO.vazio     — a tampa do corte (I3)
  contorno: '#111a0e' // ← PALETA_OGRO.contorno  — outline (o forge o lê pela chave)
} as const;

/** Nome de cor válido para uma peça do rig. Casa com `Caixa['cor']` de `../model3d`. */
export type CorPeOgro = keyof typeof PALETA_PE_OGRO;

/**
 * Rampas de quantização por material (§4.3 do PERSONAGEM.md): o fator de luz da
 * face escolhe um destes quatro degraus, do mais claro ao mais escuro. A rampa
 * é propriedade do MATERIAL — por isso ela mora no modelo e não no forge.
 *
 * Medido com as constantes canônicas de `../model3d` (`GANHO_SOMBRA` 1,15 e
 * `REALCE_TOPO` 1,25), uma caixa declarada `peleBase` sai igualzinha à do corpo
 * do Ogro — que é o ponto:
 *
 * | face   | normal | alvo  | degrau     |
 * |--------|--------|-------|------------|
 * | topo   | +Z     | 223,2 | `peleLuz`  |
 * | frente | +Y     | 177,0 | `peleBase` |
 * | lado   | +X     | 141,0 | `peleMeio` |
 *
 * — e uma peça declarada `peleMeio` (calcanhar e arco) desce um degrau em cada
 * face (176,0 `peleBase` · 139,5 `peleMeio` · 111,2 `peleSombra`), o que põe os
 * quatro tons da rampa na tela num objeto de doze caixas.
 *
 * `osso` fecha em dois degraus úteis (topo e frente em `osso`, lado em
 * `ossoSombra`), como no Ogro: `osso` já é o tom mais claro da paleta e o
 * `REALCE_TOPO` não tem para onde subir. Os dois degraus finais da rampa
 * (`peleSombra`, `vazio`) são inalcançáveis pela geometria deste rig — o alvo
 * mais escuro possível numa peça `osso` é 177,0 (face +X pura), que ainda
 * escolhe `ossoSombra` (144,9) contra `peleSombra` (99,1). Eles estão ali para
 * fechar os quatro degraus que o contrato pede SEM inventar cor; nenhuma unha
 * vai sair verde.
 *
 * `vazio` repete o próprio tom nos dois primeiros degraus e cai no `contorno`
 * nos dois últimos — é a mesma rampa do Ogro e serve ao mesmo propósito: a
 * tampa do corte precisa continuar preta em TODAS as orientações, senão o
 * "buraco" do tornozelo ganha volume e vira um botão.
 */
export const RAMPAS_PE_OGRO = {
  pele: ['peleLuz', 'peleBase', 'peleMeio', 'peleSombra'],
  osso: ['osso', 'ossoSombra', 'peleSombra', 'vazio'],
  vazio: ['vazio', 'vazio', 'contorno', 'contorno']
} as const satisfies Record<string, readonly CorPeOgro[]>;

/**
 * Rampa a que cada cor pertence — é por esta tabela que a quantização de §4.3
 * encontra os degraus do material de cada peça.
 *
 * `contorno` aponta para `vazio` pelo mesmo motivo que no Ogro: ele não é
 * material de peça nenhuma (quem o usa é o traço de silhueta e o passe de
 * máscara do forge), mas precisa de uma rampa declarada para não cair no
 * caminho de rampa DERIVADA de `../model3d`, que inventaria quatro tons novos
 * a partir dele e furaria o gate G5.
 */
export const RAMPA_DA_COR_PE_OGRO = {
  peleLuz: 'pele',
  peleBase: 'pele',
  peleMeio: 'pele',
  peleSombra: 'pele',
  osso: 'osso',
  ossoSombra: 'osso',
  vazio: 'vazio',
  contorno: 'vazio'
} as const satisfies Record<CorPeOgro, keyof typeof RAMPAS_PE_OGRO>;

/**
 * §1.1 do BESTIARIO — cores que ignoram a modulação de luz. O despojo NÃO TEM
 * nenhuma, e a lista vazia é a declaração explícita disso (o Ogro também não
 * tem: um pedaço dele não pode brilhar mais que ele).
 *
 * Existe como export para que quem forja passe `emissivas: CORES_EMISSIVAS_PE_OGRO`
 * sem `if`: com a lista vazia `forjarAtlas` não aloca camada extra e cai no
 * caminho de tingimento simples.
 */
export const CORES_EMISSIVAS_PE_OGRO: readonly CorPeOgro[] = [];

/* ------------------------------------------------------------------ *
 * 2. Escala — a conta que decide se isto é um item ou uma criatura
 * ------------------------------------------------------------------ */

/**
 * As medidas da silhueta, em `u` (espaço local: +X direita, +Y frente, +Z cima,
 * z = 0 no plano do chão). Todas conferidas contra o blockout da §5 abaixo.
 *
 * A ESCALA, que é o número mais fácil de errar num item. `ART_POR_U` é UMA para
 * o jogo inteiro (2,5px de arte por `u`, §3 do PERSONAGEM.md) — tamanho na tela
 * é consequência do tamanho do MODELO, nunca de um fator aplicado no sprite.
 * O elenco, para calibrar:
 *
 * | ente               | maior eixo | px de arte |
 * |--------------------|-----------:|-----------:|
 * | Ogro (§12)         |      25,5u |      63,8  |
 * | Guerreiro          |      20,9u |      52,3  |
 * | Goblin             |      13,3u |      33,1  |
 * | Slime (massa)      |       7,0u |      17,5  |
 * | **pé de ogro**     |  **4,90u** |  **12,3**  |
 *
 * A faixa de item de chão é 3 a 5u, e o pé fica no TETO dela (4,90u), que é a
 * tradução direta de I1: ele é o despojo do maior bicho do elenco, então tem
 * de ser o maior despojo — a comparação que o jogador faz não é com o Ogro (o
 * dono já morreu; não há nada ao lado para comparar), é com os OUTROS itens no
 * chão da mesma sala. Um pé de 3u leria como orelha de goblin grande.
 *
 * O limite superior é duro e não é estético: acima de ~5u um objeto no chão
 * começa a ocupar fração relevante do losango do tile (64×32px de tela) e a
 * disputar a antidiagonal da ordem do pintor com o personagem que pisa nele —
 * a mesma pendência de oclusão que obrigou a erguer a marreta do Ogro
 * (`./ogre`, §2). Medido no rig montado, nas 8 direções: o extremo em `artX`
 * é ±11,0px contra os 32px de meio tile, e o quadro inteiro fecha em 20,4 ×
 * 15,1px de arte (o Ogro gasta 130 × 103). Folga de sobra.
 *
 * HONESTIDADE SOBRE A ANATOMIA: o próprio rig do Ogro declara o pé dele como
 * uma caixa de 5,0 × 6,0 × 1,6u (`criarPerna` em `./ogre`). O despojo é MENOR
 * que o pé do dono (4,90 de comprimento contra 6,0) — cortado no tornozelo ele
 * perde a parte que era canela, e o resto foi comprimido para caber na faixa de
 * item. Isto é desvio consciente de fidelidade a favor de legibilidade, que é a
 * lição registrada em obsidian/06 - Aprendizados/legibilidade-em-40px.md.
 *
 * A LARGURA (4,50u) é 92% do comprimento, e essa razão atarracada é escolha,
 * não descuido — ela é I1 (pé de bicho pesado, não pé humano) e é imposta por
 * I2: o vão de fundo entre os três dedos custa bitola, e cada 0,1u que se tira
 * daí some com o vão antes de somar com a impressão de "pé". A conta está em
 * `criarDedos`, com a medição das 8 direções.
 */
export const PROPORCOES_PE_OGRO = {
  /** Maior eixo: do fundo do calcanhar (y −2,45) à ponta da unha central (y +2,45). */
  comprimento: 4.9,
  /** Bitola no antepé, ponta a ponta dos dedos externos (x ±2,25). É a maior largura. */
  largura: 4.5,
  /** Do chão ao alto da medula exposta (z 2,77). 57% do comprimento: deitado, não em pé. */
  altura: 2.77,
  /** Altura da massa do PÉ sozinha (topo da almofada do antepé); o corte fecha em 2,2× isto. */
  alturaDoPe: 1.25,
  /** y do pivô do nó `tornozelo` — o coto vive todo atrás da massa do pé. */
  yTornozelo: -1.45,
  /** y do pivô do nó `dedos` — a frente do antepé, de onde as prongas saem. */
  yDedos: 1.55
} as const;

/* ------------------------------------------------------------------ *
 * 3. Utilitários locais (nada disto escapa do módulo)
 * ------------------------------------------------------------------ */

type Vec3 = [number, number, number];

/**
 * Monta uma caixa na mesma notação das tabelas de blockout do bestiário:
 * `peca(cor, [sx, sy, sz], [cx, cy, cz])`. O centro é relativo ao pivô do nó e é
 * opcional (padrão: no próprio pivô). O contorno de silhueta (§4.5) fica LIGADO.
 */
function peca(cor: CorPeOgro, dim: Vec3, centro?: Vec3): Caixa {
  const [sx, sy, sz] = dim;
  const [cx, cy, cz] = centro ?? [0, 0, 0];
  return { cx, cy, cz, sx, sy, sz, cor };
}

/**
 * Igual a `peca`, mas SEM contorno próprio.
 *
 * O critério, medido no Guerreiro (rodada 3, §10 do PERSONAGEM.md) e válido em
 * todo rig: o traço tem 1px de ARTE e é aceso nas DUAS bordas da peça, então
 * uma peça de 2u de travessia (5px de arte) perde 2 e fica com 3. Numa peça de
 * 1u (2,5px) não sobra interior nenhum — ela vira uma mancha da cor do
 * contorno, que é o modo de falha que o cofre chama de "outline demais vira
 * mancha preta a 40px".
 *
 * Neste item isso é a regra e não a exceção: das 12 caixas, 8 são menores que
 * 2u no eixo em que seriam contornadas (os três dedos, as três unhas, a tampa
 * do corte e a medula). Elas se leem por COR — `osso` contra `peleBase` são
 * 224,1 contra 178,5 de luminância, e `vazio` contra `peleBase` são 31,4 contra
 * 178,5; as duas diferenças sobrevivem ao snap de paleta sem precisar de linha
 * preta.
 *
 * E a silhueta EXTERNA continua fechada de qualquer jeito, inclusive nos
 * ENTALHES entre os dedos: quem a desenha é o passe de máscara de alpha do
 * `../spriteForge` (§2.1 — todo pixel opaco com vizinho-4 transparente vira
 * `contorno`), não o traço por peça daqui. É por isso que um dedo sem
 * `contorno` continua tendo borda escura contra o fundo, mas não perde o miolo.
 */
function detalhe(cor: CorPeOgro, dim: Vec3, centro?: Vec3): Caixa {
  const c = peca(cor, dim, centro);
  c.contorno = false;
  return c;
}

/* ------------------------------------------------------------------ *
 * 4. Nomes dos nós — chaves estáveis de `Pose`
 * ------------------------------------------------------------------ */

/**
 * Um nome errado é SILENCIOSO (`../model3d`: o nó simplesmente não gira), então
 * use estas constantes em vez de string literal solta — vale também para quem
 * um dia quiser uma pose de "item saltando ao ser coletado".
 *
 * Três nós de corpo, na ordem em que o objeto se lê de trás para a frente:
 * `tornozelo` (I3) → `planta` (I1) → `dedos` (I2). Cada dedo NÃO ganhou nó
 * próprio: nó existe para dar grau de liberdade a uma animação, e nenhuma
 * animação deste item mexe dedo. Três nós a mais custariam três multiplicações
 * de matriz por quadro e três nomes a mais para errar em silêncio, em troca de
 * nada.
 */
export const NOS_PE_OGRO = {
  raiz: 'raiz',
  tornozelo: 'tornozelo',
  planta: 'planta',
  dedos: 'dedos'
} as const;

export type NomeNoPeOgro = (typeof NOS_PE_OGRO)[keyof typeof NOS_PE_OGRO];

/* ------------------------------------------------------------------ *
 * 5. O blockout
 *
 * ORDEM DE DECLARAÇÃO — ela é o desempate determinístico da ordem do pintor
 * (§4.4 de `../model3d`: profundidade `wx+wy+wz` primeiro, ordem de declaração
 * depois, índice de face por último). Este arquivo declara SEMPRE do fundo para
 * a frente — `tornozelo` antes de `planta` antes de `dedos`, e dentro de cada
 * nó a peça mais recuada primeiro. Trocar a ordem dos filhos não muda o sprite
 * enquanto a profundidade decidir sozinha, mas muda no instante em que duas
 * faces empatarem, e aí muda em silêncio, num quadro só, numa direção só.
 *
 * DEITADO — o comprimento do objeto se estende no PLANO DO CHÃO (X/Y) e a
 * altura em Z é baixa (2,77 contra 4,90 de comprimento). Não há rotação
 * envolvida em nada disso: `Caixa` não tem rotação e a pose de repouso é vazia
 * (ver §6), então "deitado" é a própria declaração das caixas. É o que garante
 * que o item saia correto mesmo se quem forja esquecer de passar `repouso`.
 * ------------------------------------------------------------------ */

const P = PROPORCOES_PE_OGRO;

/**
 * tornozelo — o coto decepado (I3). É o nó que faz este objeto ser um DESPOJO.
 *
 * A ARMADILHA QUE DITOU A FORMA, e o motivo de o corte ser para CIMA: §4.3 de
 * `../model3d` descarta toda face cuja normal tenha produto escalar ≤ 0 com
 * `DIR_VISAO = (1,1,1)`. Em repouso, as únicas faces desenhadas são +X, +Y e
 * +Z. A face −Y — a de trás, que é onde o senso comum manda pôr um corte de
 * tornozelo "atrás" — É INVISÍVEL, sempre, em metade das direções do atlas, e
 * um traço de identidade pintado nela simplesmente não existe na tela.
 *
 * A saída não é truque de render, é anatomia: a perna do bicho era VERTICAL, o
 * golpe que separou o pé foi transversal a ela, logo a secção do corte é
 * HORIZONTAL e olha para +Z — a única face que nenhuma direção do atlas
 * descarta. O coto sobe atrás da massa do pé e termina numa tampa plana. Assim
 * I3 se lê nas 8 direções, e de graça.
 *
 * As quatro caixas, do chão para cima:
 *
 *   `calcanhar`  a base que toca o chão (z 0..1,05), 2,60 × 2,00u, em
 *                `peleMeio` — um degrau mais escura que a massa do pé para o
 *                conjunto não virar uma coluna única do chão ao topo. É ela que
 *                segura a traseira em z = 0;
 *   `coto`       o toco do tornozelo (z 1,00..1,95), 2,20 × 1,90u, estreitado
 *                em relação ao calcanhar para que o degrau entre os dois seja
 *                visível na face +Z e o conjunto leia como "tubo saindo do
 *                calcanhar" em vez de bloco;
 *   `corte`      a tampa em `vazio` (#1a2416, quase preto), z 1,88..2,18. Ela
 *                SOBE 0,23u acima do coto em vez de ser coplanar com ele: faces
 *                coplanares EMPATAM na ordem do pintor (§4.4) e o resultado é
 *                cintilação entre duas peças, não uma tampa. Recuada 0,20u de
 *                cada lado (1,80 contra 2,20), o que deixa a lateral escura dela
 *                visível como espessura do corte;
 *   `medula`     o osso exposto no centro do corte (z 1,87..2,77), 0,90 × 0,80u.
 *                Ela ultrapassa a tampa em 0,59u (1,5px de arte) — abaixo disso
 *                a rasterização a comeria junto com a borda da tampa e sobraria
 *                um corte só preto, que lê como buraco e não como osso.
 *
 * Medido nas 8 direções, sem a pose mexer em nada: a medula aparece com 12 a
 * 16px de arte e a tampa com 8 a 15px — as duas em TODAS as direções, nenhuma
 * zerada. I3 não depende de o item ser olhado de um lado.
 *
 * O CONTORNO fica no `calcanhar` e no `coto` e em mais nada aqui: os dois são
 * silhueta externa (a traseira e o topo do objeto) e têm 6,5 e 5,5px de arte de
 * travessia, largura de sobra para pagar 1px de traço em cada borda. Tampa e
 * medula têm 4,5 e 2,3px e são justamente as duas peças cujo CONTRASTE é a
 * informação — contorná-las apagaria o corte em vez de defini-lo.
 */
function criarTornozelo(): No {
  return {
    nome: NOS_PE_OGRO.tornozelo,
    pivo: [0, P.yTornozelo, 0],
    caixas: [
      peca('peleMeio', [2.6, 2.0, 1.05], [0, 0, 0.525]), //  calcanhar        ← I3
      peca('peleBase', [2.2, 1.9, 0.95], [0, 0, 1.475]), //  coto do tornozelo ← I3
      detalhe('vazio', [1.8, 1.5, 0.3], [0, 0, 2.03]), //  tampa do corte    ← I3
      detalhe('osso', [0.9, 0.8, 0.9], [0, 0, 2.32]) //  medula exposta    ← I3
    ]
  };
}

/**
 * planta — a massa do pé (I1): o arco no meio e a almofada do antepé.
 *
 * Duas caixas e não uma, e a diferença é a única coisa que impede este item de
 * ser um tijolo: o `arco` é 0,75u mais ESTREITO que a `almofada` (2,95 contra
 * 3,70) e 0,25u mais baixo. Essa cintura no meio do objeto é o que a silhueta
 * usa para dizer "calcanhar, meio, antepé" — três larguras em sequência leem
 * como pé; uma largura só lê como pedra. É o mesmo recurso que dá volume ao
 * cabo da marreta do Ogro por escalonamento de caixas em vez de por rotação.
 *
 * A cor reforça a mesma leitura sem gastar geometria: `arco` em `peleMeio` (um
 * degrau abaixo) contra `almofada` em `peleBase`. Como as duas rampas são a
 * mesma, o degrau é exatamente 1 na quantização — visível, mas sem virar
 * "dois materiais".
 *
 * A almofada é a peça mais LARGA do modelo (3,70u, 9,25px de arte) e é ela quem
 * responde por I1 na silhueta: massa baixa e larga, plantada no chão. Ela é
 * também a única peça cuja face de topo é grande o bastante para mostrar o
 * `peleLuz` do degrau de topo em área, e é esse claro no meio do objeto que
 * impede o despojo de virar uma mancha escura uniforme no piso da masmorra.
 *
 * A SOLA (face −Z) nunca é desenhada — normal (0,0,−1) contra `DIR_VISAO`
 * (1,1,1) dá produto negativo e o culling a descarta em todas as direções. Por
 * isso não há peça nenhuma detalhando a planta do pé: seria geometria paga e
 * nunca vista. O que a sola precisa fazer, ela faz por assentar em z = 0.
 *
 * As duas têm contorno: são a silhueta externa nas laterais e no meio do
 * objeto, e com 7,4 e 9,25px de travessia sobra miolo de sobra.
 */
function criarPlanta(): No {
  return {
    nome: NOS_PE_OGRO.planta,
    pivo: [0, 0, 0],
    caixas: [
      peca('peleMeio', [2.95, 1.7, 1.0], [0, -0.55, 0.5]), //  arco (cintura)      ← I1
      peca('peleBase', [3.7, 1.5, 1.25], [0, 0.55, 0.625]) //  almofada do antepé  ← I1
    ]
  };
}

/**
 * dedos — três prongas grossas com unha clara na ponta (I2). É o nó que
 * transforma uma massa no chão em PÉ.
 *
 * POR QUE TRÊS, e não cinco: a 2,5px de arte por `u`, cinco dedos no antepé de
 * 4,5u dariam 0,6u de dedo (1,5px) e 0,35u de vão (0,9px). Depois da
 * rasterização isso não é um pé com cinco dedos, é uma borda serrilhada com
 * ruído, e o cofre já registrou esse modo de falha
 * (obsidian/06 - Aprendizados/legibilidade-em-40px.md: "área não é
 * legibilidade"). Três prongas gordas leem como pé de bicho grande, e ainda
 * reforçam I1: dedo grosso é dedo de coisa pesada. Dois leriam como casco
 * fendido, que é outro bicho.
 *
 * A SEPARAÇÃO É GEOMÉTRICA, e é a armadilha registrada no cofre: separar dedos
 * por ORDEM DE DESENHO — encostar as caixas e confiar que a peça da frente é
 * pintada depois — funciona na direção em que o atlas foi autorado e falha nas
 * outras sete. Sem z-buffer quem decide é a antidiagonal, e num giro de 45° dois
 * dedos encostados viram uma massa só. Aqui há 0,80u de espaço VAZIO entre a
 * caixa do dedo central (x ±0,45) e a de cada lateral (x 1,25..2,25), mais
 * 0,10u de deslocamento do centro em Y — os laterais terminam 0,175u antes do
 * central, como dedos abertos em leque. Nenhuma caixa deste nó toca outra.
 *
 * O QUE ISSO ENTREGA, MEDIDO — porque vão em `u` não é vão em pixel. Máscaras
 * rasterizadas nas 8 direções, distância entre as máscaras de dedos vizinhos
 * (dedo + a sua unha), em px de arte:
 *
 *   | direção        | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
 *   |----------------|---|---|---|---|---|---|---|---|
 *   | px de fundo    | 1 | 0 | 3 | 4 | 3 | 0 | 1 | 2 |
 *
 * Seis das oito direções têm FUNDO de verdade entre os dedos. Em 1 e 5 as
 * máscaras encostam (sem se sobrepor: nenhum dedo desaparece, os três medem 4 a
 * 6px cada) e quem separa é a unha — ver abaixo.
 *
 * POR QUE 1 E 5 SÃO IMPOSSÍVEIS, para ninguém tentar "consertar" isto de novo:
 * nessas duas direções o eixo X do modelo cai exatamente sobre a diagonal da
 * projeção e `artX = (x − y)·2,5` ZERA a componente horizontal da separação —
 * ela vira inteiramente vertical, e o eixo vertical rende 1,77px por `u` contra
 * os 3,54px/u das direções 3 e 7, onde a distância entre as máscaras chega a
 * 2,8px de arte (o maior vão do atlas). Empurrar os dedos externos até que sobre
 * 1px de fundo também em 1 e 5 exige x ±2,25 — bitola de 5,50u, mais LARGA do
 * que o pé é comprido, medido. O preço é perder o formato de pé para ganhar um
 * pixel em duas direções de oito.
 *
 * A cura certa é a redundância, não a bitola: DEDO CHATO e UNHA ALTA.
 *   - chato: 0,50u de altura nos laterais e 0,55 no central (1,25 e 1,4px)
 *     contra 1,25u da almofada atrás. Não é só anatomia — a altura da caixa é
 *     o que mais atrapalha a separação vertical, que é a única disponível nas
 *     direções 1 e 5; com os dedos altos (0,85u) as máscaras não encostavam, se
 *     SOBREPUNHAM, e o vão de fundo caía para 2 direções de 8;
 *   - unha alta: a tampa de `osso` sobe 0,15u ACIMA do topo do dedo. Assim ela
 *     quebra a silhueta pelo alto e sobrevive inclusive quando o pé aponta para
 *     longe da câmera. Medido: as três unhas aparecem nas 8 direções, com 2 a
 *     9px cada e 8 a 22px somadas. Três manchas de osso separadas por pele leem
 *     como três dedos mesmo onde o fundo não passa entre eles.
 *
 * É a unha, e só ela, que sustenta I2 nas direções 2, 3 e 4: ali o pé aponta
 * para longe do observador e o CORPO de um ou dois dedos fica 100% oculto atrás
 * da almofada (0px medidos), enquanto a unha correspondente continua com 2 a
 * 4px espiando por cima da linha dela. A comparação que fixou o número, no
 * mesmo rig, mudando só a altura da unha:
 *
 *   | unha                    | dir 2 | dir 3 | dir 4 |
 *   |-------------------------|-------|-------|-------|
 *   | afundada no dedo (−0,15)| 0/3/1 | 0/0/0 | 3/0/1 |
 *   | rasa, topo nivelado     | 1/3/3 | 0/0/2 | 3/1/3 |
 *   | **alta (+0,15u)**       | 2/4/4 | 3/3/2 | 4/2/4 |
 *
 * — com a garra ao rés do dedo, que era o desenho intuitivo ("unha na ponta,
 * junto do chão"), o item perde I2 inteiro na direção 3 e quase inteiro em 2 e
 * 4. Os 0,15u custam nada e compram três direções.
 *
 * AS UNHAS, o resto da geometria: 0,75 × 0,60 × 0,55u, avançadas 0,35u ALÉM da
 * face frontal do dedo (0,25u ficam encaixados dentro dele — unha solta vira
 * lasca flutuando). Os 0,35u não são folga de modelador: peça coplanar com a
 * vizinha empata na ordem do pintor (§4.4), e avançada ela também passa a ser a
 * coisa mais à frente do objeto (maior `wx+wy+wz`), o que a põe por cima sem
 * depender de sorte. Cada unha é mais estreita que o próprio dedo (0,125u de
 * cada lado nos laterais, 0,075 no central) — se fosse da mesma largura, as
 * faces laterais ficariam coplanares e voltaria o empate.
 *
 * Elas são o único ponto CLARO do objeto junto com a medula, e as duas estão em
 * pontas opostas: unhas à frente (+Y), medula atrás e em cima (−Y, +Z). Essa
 * distribuição é o que dá orientação ao item a distância — o olho encontra dois
 * pontos brilhantes e lê o eixo entre eles como o eixo do pé. É a mesma função
 * que a testeira `metalLuz` cumpre na cabeça do Ogro.
 *
 * Nenhuma peça deste nó tem contorno: dedo tem 2,25 a 2,5px de travessia e
 * unha, 1,9px — o traço nas duas bordas não deixaria miolo. O entalhe entre
 * eles é desenhado pela máscara de alpha do forge (ver `detalhe`).
 */
function criarDedos(): No {
  return {
    nome: NOS_PE_OGRO.dedos,
    pivo: [0, P.yDedos, 0],
    caixas: [
      // Laterais primeiro (mais recuados em Y = mais ao fundo), central depois.
      detalhe('peleBase', [1.0, 0.95, 0.5], [-1.75, -0.1, 0.25]), //  dedo esquerdo ← I2
      detalhe('peleBase', [1.0, 0.95, 0.5], [1.75, -0.1, 0.25]), //  dedo direito  ← I2
      detalhe('peleBase', [0.9, 1.1, 0.55], [0, 0, 0.275]), //  dedo central  ← I2
      detalhe('osso', [0.75, 0.6, 0.55], [-1.75, 0.425, 0.375]), //  unha esquerda ← I2
      detalhe('osso', [0.75, 0.6, 0.55], [1.75, 0.425, 0.375]), //  unha direita  ← I2
      detalhe('osso', [0.75, 0.6, 0.55], [0, 0.6, 0.425]) //  unha central  ← I2
    ]
  };
}

/**
 * Monta uma árvore NOVA do despojo. Chame isto (e não mute `MODELO_PE_OGRO`)
 * sempre que precisar de um rig próprio — variantes, testes, previews, o ícone
 * de bolsa forjado em outra escala.
 *
 * A raiz não tem caixa nenhuma, como a dos outros rigs: ela é só o ponto de
 * ancoragem em (0,0,0) — o centro da pegada do item no plano do chão, que é a
 * âncora com que o `IsoRenderer` assenta o sprite no losango do tile.
 */
export function criarModeloPeOgro(): No {
  return {
    nome: NOS_PE_OGRO.raiz,
    pivo: [0, 0, 0],
    caixas: [],
    filhos: [criarTornozelo(), criarPlanta(), criarDedos()]
  };
}

/** O rig canônico do pé de ogro, pronto para o sprite forge (§7). Não mute. */
export const MODELO_PE_OGRO: No = criarModeloPeOgro();

/* ------------------------------------------------------------------ *
 * 6. "Pose" de repouso
 * ------------------------------------------------------------------ */

/**
 * Um objeto SEM MEMBROS: repouso vazio, e isso é uma declaração, não um
 * esquecimento.
 *
 * Um pé decepado no chão não tem articulação, não respira e não tem ângulo
 * autoral escondido em pose nenhuma — toda a forma dele está na declaração das
 * caixas (§5). A consequência prática é a que interessa: quem forjar este
 * modelo sem passar `opts.repouso` obtém EXATAMENTE o mesmo sprite de quem
 * passar. Um item cuja aparência dependesse de uma pose externa seria um item
 * que sai errado no dia em que alguém integrar o atlas de despojos sem ler este
 * arquivo — e sairia errado em silêncio, que é o modo de falha caro.
 *
 * O tipo é `Pose` (e não um literal mais estreito) de propósito: é o contrato
 * que `forjarAtlas` e `montarModelo` aceitam, e é assim que este export encaixa
 * no mesmo lugar em que `POSE_PARADA_OGRO` encaixa.
 */
export const POSE_PARADA_PE_OGRO: Pose = {};
