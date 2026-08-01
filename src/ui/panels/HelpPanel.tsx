/*
 * ISOROGUE — bloco Ajuda.
 *
 * Lista estática, copiada tecla a tecla e texto a texto de
 * legacy/src-vanilla/shell.html. Não lê estado e não assina nada.
 */

interface LinhaAjuda {
  teclas: string[];
  acao: string;
}

const LINHAS: readonly LinhaAjuda[] = [
  { teclas: ['W', 'A', 'S', 'D'], acao: 'Mover ou atacar' },
  { teclas: ['Q', 'E', 'Z', 'C'], acao: 'Diagonais' },
  { teclas: ['.', 'Espaço'], acao: 'Esperar um turno' },
  { teclas: ['H', '1'], acao: 'Usar poção' },
  /* A ação diz ONDE a escada está porque a lista de teclas é o lugar em que o
   * jogador procura quando não sabe o que fazer — e "não achei a escada" foi
   * exatamente a queixa que criou o bloco "Saída do andar" (ExitPanel.tsx). */
  { teclas: ['>', 'Enter'], acao: 'Descer a escada (veja Saída do andar)' },
  { teclas: ['V'], acao: 'Sonda de visão no cursor' },
  { teclas: ['Shift', 'D', 'F3'], acao: 'Painel de depuração' },
  { teclas: ['F'], acao: 'Câmera segue o jogador' },
  { teclas: ['+', '-', 'roda'], acao: 'Aproximar e afastar' },
  { teclas: ['N'], acao: 'Nova expedição' }
];

export function HelpPanel() {
  return (
    <section className="bloco">
      <h2 className="titulo">Ajuda</h2>
      <ul className="ajuda">
        {LINHAS.map((linha) => (
          <li key={linha.acao}>
            <span className="teclas">
              {linha.teclas.map((tecla) => <kbd key={tecla}>{tecla}</kbd>)}
            </span>
            <span className="acao">{linha.acao}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
