---
tipo: changelog
atualizado: 2026-07-31
tags: [changelog, tileset, parede, agua, alinhamento, render]
---

# 📆 31/07/2026 — A muralha viva, as enseadas e o alinhamento consertado

Três coisas, todas nascidas de relato do dono com foto.

## 1. O alinhamento: eu tinha quebrado, e a medição provou

O dono viu herói, monstros, mercador e mobília **descentralizados**, visual bugado e passagens
travadas em cantos abertos. Os três sintomas eram **um erro só**, e era meu: caçando o bug do
"sprite por baixo do chão" eu troquei a colagem do terreno de `ancoraX/ancoraY` para "centro
do quadro + correção". A âncora original estava certa.

A medição (sonda descartável, forjando os atlas em Node cru):

| peça | quadro | âncora | erro da colagem que estava no código |
|---|---|---|---|
| piso grama | 68×57 | (34, 27) | **Δy = +14 px** |
| parede terra | 68×83 | (34, 63) | **Δy = +32 px** |
| água | 68×52 | (34, 14) | **Δy = +10 px** |

O erro era **diferente por peça**, porque a distância âncora↔centro depende de quanto cada rig
sobe e desce. Daí tudo de uma vez: o elenco flutuando sobre um chão 14px abaixo, a parede 32px
fora cobrindo quem estava atrás, e piso/água/adereço do mesmo tile desalinhados entre si.

E o mais cruel: a parede colada +32px = 2·hh é **exatamente o losango do tile (x+1,y+1)** — ela
era pintada na casa da diagonal seguinte. **Era isso que fazia canto aberto parecer travado**:
a parede de um tile aparecia noutro. ~80% das recusas eram corte de canto legítimo ficando
invisível; nenhuma era bug de engine (BFS de 4 vizinhos do mapgen é mais fraca que a regra do
jogador, então o corte de canto **não pode** isolar nada — verificado em 4 sementes).

O bug original, medido de verdade: o bloco de piso sobe **exatamente 16px** acima do centro do
próprio losango — o vértice N, nem um pixel além. Nenhum pixel de entidade com z ≥ 0 pode ser
coberto. O que é coberto é o que o rig modelou **abaixo** do plano do chão, e aí a oclusão está
certa: aquilo está enterrado (sobram 3,6px no slime e 9,6px no ogro — conserto de rig, anotado).
Ficou um **teste geométrico** travando o limite: nenhum bloco sobe acima do vértice N.

## 2. A muralha viva

A parede do andar 1 deixou de ser barranco de terra e virou **sebe**. Quatro variantes das oito
da referência — sebe de folhas arredondadas, capim alto, folhagem grande e suculentas —,
escolhidas por se separarem em **três eixos ao mesmo tempo**: matiz, direção da textura e
tamanho do motivo. As outras quatro colapsam entre si depois do snap da paleta.

Helper que virou o cofre da rodada: `folhaDeCoroa`, que trava footprint **e** teto na
construção — nenhuma folha escolhe a própria altura final, e por isso nenhuma estoura o vértice
N (auditado: `sobe = 52,00px` exato nos quatro rigs, zero caixas fora do quadrado do tile).

Dois achados que valem para o código já existente: pela ordem do pintor (soma `x+y+z`, sem
z-buffer), **a fiada de baixo do tijolo e duas das três faixas de estrato nunca chegam à
imagem** — caixa paga e não entregue. Fica anotado.

## 3. As enseadas

A água virou **elemento de ambiente**: canais que nascem na costa do vazio e avançam para
dentro, comendo tiles que seriam parede. Em 180 andares medidos, **100% ganharam ao menos um
canal**, todos ancorados no vazio, todos com margem seca; 1 a 3 corpos por andar.

A decisão que sustenta tudo: **o canal só come `WALL`**. Mexer no que é piso moveria todo
inimigo e todo item de todo andar; comendo só o que já barrava, a barreira troca de *visual*
com o conjunto caminhável intacto — provado comparando 90 andares contra o HEAD anterior, com
zero divergência em inimigos, itens, paradas e missões.

A conectividade é gate, não torcida: o leito inteiro é revertido se a BFS não recontar todos os
tiles secos. Mutação de verificação (deixar o canal comer piso) derruba 4 dos 5 testes novos.

Oracle regenerado deliberadamente — a água mudou; o formato não (continua v6).

---

Vizinhos: [[tilesets-por-nivel]] · [[projecao-isometrica]] · [[geracao-de-masmorra-bsp]]
