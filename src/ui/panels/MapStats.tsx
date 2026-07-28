/*
 * ISOROGUE — bloco Estado do mapa.
 *
 * `#map-conect`, `#map-salas`, `#map-inimigos`, `#map-itens`, `#map-visiveis`
 * de `R.UI.refresh`. Formatação de percentual copiada de 60-ui.js:
 *   - fração 0..1 vira 0..100;
 *   - >= 99,995 imprime '100%'; <= 0 imprime '0%';
 *   - o resto sai com UMA casa decimal e vírgula (pt-BR);
 *   - conectividade cheia (>= 1) ganha a classe `valor-otimo`.
 *
 * Cada valor tem o seu próprio seletor primitivo: devolver um objeto aqui
 * derrubaria a aplicação em laço de render (docs/ARQUITETURA-REACT.md §4).
 */

import { useGameValue } from '../hooks/useGameStore';

/** `pctBruto` do vanilla — recebe valor JÁ em escala 0..100. */
function pctBruto(p: number, casas: number = 1): string {
  if (!Number.isFinite(p)) return '—';
  if (p >= 99.995) return '100%';
  if (p <= 0) return '0%';
  return p.toFixed(casas).replace('.', ',') + '%';
}

/** `pct` do vanilla — aceita a fração 0..1 de `map.connectivity`. */
function pct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return pctBruto(v <= 1 ? v * 100 : v);
}

export function MapStats() {
  const conectividade = useGameValue((g) => g.map.connectivity);
  const salas = useGameValue((g) => g.map.rooms.length);
  const inimigos = useGameValue((g) => {
    let n = 0;
    for (let i = 0; i < g.enemies.length; i++) {
      if (g.enemies[i].hp > 0) n++;
    }
    return n;
  });
  const itens = useGameValue((g) => g.items.length);
  const visiveis = useGameValue((g) => g.visible.size);

  return (
    <section className="bloco">
      <h2 className="titulo">Estado do mapa</h2>
      <dl className="tabela">
        <div className="tabela-linha">
          <dt>Conectividade</dt>
          <dd id="map-conect" className={conectividade >= 1 ? 'valor-otimo' : undefined}>
            {pct(conectividade)}
          </dd>
        </div>
        <div className="tabela-linha">
          <dt>Salas</dt>
          <dd id="map-salas">{salas}</dd>
        </div>
        <div className="tabela-linha">
          <dt>Inimigos</dt>
          <dd id="map-inimigos">{inimigos}</dd>
        </div>
        <div className="tabela-linha">
          <dt>Itens</dt>
          <dd id="map-itens">{itens}</dd>
        </div>
        <div className="tabela-linha">
          <dt>Tiles visíveis</dt>
          <dd id="map-visiveis">{visiveis}</dd>
        </div>
      </dl>
    </section>
  );
}
