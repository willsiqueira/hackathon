"""Gera prototipos/dados-gabsub3.js a partir do seed (seed/saida/csv) para o protótipo da tela de trabalho.

Uso: python3 prototipos/gerar_dados.py
Somente dados sintéticos do kit. No MVP estes dados vêm da API (com RN6 aplicada no backend).
"""
import csv
import json
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CSV = RAIZ / "seed" / "saida" / "csv"
SETOR = "GABSUB3-DVT"
REF = "2026-10-07"


def ler(nome):
    with open(CSV / f"{nome}.csv", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if r.get("siglaSetor", SETOR) == SETOR]


def conv(v):
    if v == "true":
        return True
    if v == "false":
        return False
    if v.lstrip("-").isdigit():
        return int(v)
    return v


CAMPOS = """idExpediente gerenciador caixa situacao acaoPendente requerAcao etiqueta numeroReferencia classe
descricaoClasse tema assunto resumo orgaoOrigem setorOrigem setorDestino dataChegada dataUltimaMovimentacao
tempoParadoDias tipoPrazo dataPrazo diasRestantes statusPrazo prioridade pontuacaoPrioridade urgente motivoUrgencia
reuPreso idoso novaIntimacao novo idResponsavel nomeResponsavel tipoResponsabilidade nivelSigilo sigiloso favorito
marcadores qtdMinutasPendentes qtdAnotacoes""".split()

linhas = [[conv(r[k]) for k in CAMPOS] for r in ler("expedientes")]
ids = {l[0] for l in linhas}
expedientes = {"campos": CAMPOS, "linhas": linhas}  # formato colunar para reduzir o arquivo

movs = [
    [m["idExpediente"], m["dataHora"], m["tipoMovimentacao"], m["nomeUsuario"], m["setorOrigem"], m["setorDestino"], m["descricao"]]
    for m in ler("movimentacoes")
    if m["idExpediente"] in ids
]

usuarios = [{k: conv(u[k]) for k in ("idUsuario", "nome", "perfil", "cargo")} for u in ler("usuarios")]

des = ler("designacoes")
ativas = Counter(d["idUsuarioDesignado"] for d in des if d["situacao"] == "ATIVA")
atrasadas = Counter(d["idUsuarioDesignado"] for d in des if d["situacao"] == "ATIVA" and int(d["diasParaDevolucao"] or 0) < 0)
prod = Counter()
for p in ler("produtividade_diaria"):
    if "2026-09-30" <= p["data"] <= REF:
        prod[p["idUsuario"]] += int(p["totalAcoes"])
for u in usuarios:
    u["designacoesAtivas"] = ativas[u["idUsuario"]]
    u["devolucoesAtrasadas"] = atrasadas[u["idUsuario"]]
    u["acoes7dias"] = prod[u["idUsuario"]]

notificacoes, por_usuario = [], Counter()
for n in sorted(ler("notificacoes"), key=lambda n: n["dataHora"], reverse=True):
    if por_usuario[n["idUsuario"]] < 12:  # só as mais recentes de cada usuário
        por_usuario[n["idUsuario"]] += 1
        notificacoes.append({k: conv(n[k]) for k in ("idUsuario", "idExpediente", "tipoNotificacao", "severidade", "titulo", "mensagem", "dataHora", "lida")})
nao_lidas = Counter(n["idUsuario"] for n in ler("notificacoes") if n["lida"] == "false")
for u in usuarios:
    u["alertasNaoLidos"] = nao_lidas[u["idUsuario"]]

dados = {
    "dataReferencia": "2026-10-07T17:00:00-03:00",
    "setor": SETOR,
    "usuarios": usuarios,
    "expedientes": expedientes,
    "movimentacoes": movs,
    "marcadores": [{k: m[k] for k in ("idRotulo", "gerenciador", "descricao", "cor")} for m in ler("marcadores")],
    "filtrosSalvos": [
        {"idUsuario": f["idUsuario"], "nome": f["nome"], "criterios": json.loads(f["criterios"]), "ordenacao": f["ordenacao"],
         "padrao": f["padrao"] == "true", "compartilhado": f["compartilhadoComSetor"] == "true"}
        for f in ler("filtros_salvos")
    ],
    "notificacoes": notificacoes,
    "anotacoes": [[a["idExpediente"], a["dataHora"], a["nomeUsuario"], a["texto"]] for a in ler("anotacoes") if a["idExpediente"] in ids],
}

saida = Path(__file__).with_name("dados-gabsub3.js")
saida.write_text(
    "// Gerado por gerar_dados.py a partir do seed sintético. Não editar à mão.\n"
    "// No MVP, o backend aplica RN6 (setor e sigilo) antes de devolver estes campos.\n"
    "window.DADOS = " + json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n",
    encoding="utf-8",
)
print(f"{saida.name}: {len(linhas)} expedientes, {len(movs)} movimentações, {saida.stat().st_size // 1024} KB")
