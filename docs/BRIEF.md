# ISOROGUE — Requisitos do pedido (checklist de aceitação)

Cada item é verificável. O entregável é **um único arquivo HTML** (`index.html`).

## Render / mundo
- R01 — Roguelike 3D isométrico por turnos, um único arquivo HTML.
- R02 — Sem bibliotecas, imagens ou recursos externos. Renderizado em Canvas.
- R03 — Grade lógica 2D convertida para perspectiva isométrica.
- R04 — Pisos em losango.
- R05 — Paredes com altura (volume, faces laterais).
- R06 — Sombras.
- R07 — Iluminação.
- R08 — Personagens feitos com formas geométricas.
- R09 — Câmera acompanha o jogador.
- R10 — Zoom.
- R11 — Destaque do tile sob o mouse.

## Geração procedural
- R12 — Masmorra gerada proceduralmente com BSP.
- R13 — Salas variadas.
- R14 — Corredores entre folhas irmãs.
- R15 — BFS ao final garantindo 100% dos tiles caminháveis conectados.
- R16 — Áreas isoladas são conectadas ou o mapa é regenerado.
- R17 — Percentual de conectividade exibido na interface.

## Semente
- R18 — Campo de seed na interface.
- R19 — Mesma seed ⇒ exatamente o mesmo mapa, inimigos, itens, escada e detalhes visuais.
- R20 — `Math.random()` proibido nos sistemas procedurais (aqui: em todo o arquivo).
- R21 — Botões: gerar, criar seed aleatória, copiar a seed atual.

## Distribuição
- R22 — Inimigos e itens distribuídos proporcionalmente ao tamanho das salas.
- R23 — Sem sobreposição entre si.
- R24 — Não sobre a escada, nem sobre o jogador.
- R25 — Área segura inicial respeitada.

## Campo de visão
- R26 — Shadowcasting recursivo por octantes (raycasting por amostragem proibido).
- R27 — Visão simétrica.
- R28 — Tecla `V` desenha o FOV a partir do tile sob o cursor e destaca inconsistências.
- R29 — Áreas nunca vistas ficam ocultas.
- R30 — Áreas exploradas permanecem apagadas, mostrando só a estrutura estática.
- R31 — Inimigos, itens e efeitos só aparecem dentro do FOV atual.

## Turnos e IA
- R32 — Jogo por turnos; mover, atacar, esperar, usar item e interagir consomem um turno.
- R33 — Após a ação do jogador: processa todos os inimigos e atualiza o FOV.
- R34 — Um único mapa de Dijkstra recalculado a partir do jogador (A\* individual proibido).
- R35 — Perseguidores escolhem tiles de menor valor.
- R36 — Feridos podem fugir pelo gradiente invertido (valores maiores).
- R37 — Arquétipo Perseguidor: avança sempre, ataca corpo a corpo.
- R38 — Arquétipo Sentinela: mantém distância, recua, ataca à distância com linha de visão.
  - *Emenda 2026-07-29: o arquétipo `sentinel` foi redefinido — agora é o **Brutamontes**,
    corpo a corpo (alcance 1, ideal 1), sem recuo nem ataque à distância. R38 passa a ler:
    "avança sempre, esmaga corpo a corpo".*
- R39 — Arquétipo Vinculador: só ataca com outro aliado adjacente ao jogador.
- R40 — Inimigos nunca ocupam o mesmo tile.
- R41 — Conflitos de movimento resolvidos de forma determinística.

## Sistemas de jogo
- R42 — Pontos de vida e ataque simples.
- R43 — Dano com pequena variação determinística.
- R44 — Itens de cura.
- R45 — Escada para o próximo nível.
- R46 — Dificuldade crescente.
- R47 — Morte permanente.
- R48 — Resumo de morte: seed, nível, turnos, inimigos derrotados, dano causado, dano
  recebido, itens usados, exploração e causa da morte.

## Interface
- R49 — Log lateral rolável com ataques, dano, cura, movimentação, comportamento dos
  inimigos, progressão e mensagens de conectividade.
- R50 — Painel de debug na tecla `D` com valores do Dijkstra sobre o piso.
- R51 — Debug exibe: seed, FPS, posição do jogador, tile sob o cursor, conectividade,
  quantidade de inimigos, itens e tiles visíveis.
- R52 — Tooltip ao passar o mouse sobre criatura visível: vida, arquétipo, distância,
  valor de Dijkstra, estado e ação planejada.

## Garantias
- R53 — Mesma seed + mesma sequência de comandos ⇒ exatamente o mesmo resultado.
- R54 — Animações não interferem na lógica do jogo.
- R55 — Arquivo HTML completo, jogável, responsivo.
- R56 — Sem dependências externas e sem requisições de rede.
- R57 — Sem erros no console.
- R58 — Salvamento local (localStorage). Sem Supabase por ora.
