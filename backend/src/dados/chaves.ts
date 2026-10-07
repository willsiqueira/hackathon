// Chaves da tabela única, no mesmo formato de seed/gerar_seed.py.

import { chavesIndice } from '../dominio/regras.js';
import type { Entidade, Expediente } from '../dominio/tipos.js';

const ATRIBUTOS_CHAVE = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK'];
const DERIVADOS_NAO_GRAVADOS = ['risco', 'conteudoRestrito'];

const CHAVES: Record<string, (e: Entidade) => Record<string, string>> = {
  expedientes: (e) => ({ PK: `EXP#${e.idExpediente}`, SK: 'META', ...chavesIndice(e as Expediente) }),
  movimentacoes: (m) => ({
    PK: `EXP#${m.idExpediente}`,
    SK: `MOV#${m.dataHora}#${m.idMovimentacao}`,
    ...(m.idUsuario !== 'EXTERNO' ? { GSI1PK: `USR#${m.idUsuario}`, GSI1SK: `MOV#${m.dataHora}` } : {}),
  }),
  designacoes: (d) => ({
    PK: `EXP#${d.idExpediente}`,
    SK: `DES#${d.idDesignacao}`,
    GSI1PK: `USR#${d.idUsuarioDesignado}`,
    GSI1SK: `DES#${d.situacao}#${d.prazoDevolucao}#${d.idExpediente}`,
  }),
  marcadores_expedientes: (r) => ({
    PK: `EXP#${r.idExpediente}`, SK: `ROT#${r.idRotulo}`, GSI1PK: `ROT#${r.idRotulo}`, GSI1SK: `${r.dataInclusao}#${r.idExpediente}`,
  }),
  notificacoes: (n) => ({ PK: `USR#${n.idUsuario}`, SK: `NOT#${n.dataHora}#${n.idNotificacao}` }),
  acoes_lote: (l) => ({
    PK: `USR#${l.idUsuario}`, SK: `LOTE#${l.dataHora}#${l.idLote}`, GSI1PK: `SETOR#${l.siglaSetor}`, GSI1SK: `LOTE#${l.dataHora}#${l.idLote}`,
  }),
  desfazer_lote: (u) => ({ PK: `LOTE#${u.idLote}`, SK: `UNDO#${String(u.sequencia).padStart(5, '0')}` }),
  preferencias_usuario: (p) => ({ PK: `USR#${p.idUsuario}`, SK: `PREF#${p.contexto}` }),
  filtros_salvos: (f) => ({ PK: `USR#${f.idUsuario}`, SK: `FILTRO#${f.idFiltro}` }),
};

/** Item pronto para gravar: atributos da entidade + chaves calculadas. */
export function paraItem(entidade: Entidade): Entidade {
  const gerar = CHAVES[entidade.entidade];
  if (!gerar) throw new Error(`Entidade sem chaves definidas: ${entidade.entidade}`);
  const limpo: Entidade = { ...entidade };
  for (const campo of [...ATRIBUTOS_CHAVE, ...DERIVADOS_NAO_GRAVADOS]) delete limpo[campo];
  return { ...limpo, ...gerar(limpo) };
}

/** Remove as chaves técnicas antes de devolver à API. */
export function semChaves<T extends Entidade | null>(item: T): T {
  if (!item) return item;
  const copia: Entidade = { ...item };
  for (const campo of ATRIBUTOS_CHAVE) delete copia[campo];
  return copia as T;
}
