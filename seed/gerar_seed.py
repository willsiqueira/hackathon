"""Gera base SINTÉTICA para o hackathon (gerenciadores de expedientes / painel unificado).

Nenhum dado real é usado: apenas os VOLUMES por setor/gerenciador/caixa extraídos da
consulta de perfil agregado em homologação. Etiquetas, pessoas, datas e textos são
fictícios. Semente fixa + mesma data de referência = mesma base.

Uso:
	python3 gerar_seed.py                                # CSVs + DynamoDB JSON em ./saida (hoje = dia do evento)
	python3 gerar_seed.py --data-referencia agora        # usa o momento atual como "hoje"
	python3 gerar_seed.py --carregar --criar-tabela --tabela Expedientes --regiao us-east-1
"""

import argparse
import csv
import json
import random
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

SEMENTE = 42
FUSO = timezone(timedelta(hours=-3))
DATA_EVENTO = "2026-10-07"  # dia do hackathon: padrão de --data-referencia
DIAS_INDICADORES = 90
PROPORCAO_BAIXADOS = 0.35

SETORES = {
	"GABSUB3-DVT": {"idUnidade": 787, "idConcentrador": 2624122, "tipo": "GABINETE",
		"nome": "GABSUB3-DVT - Gabinete de Subprocurador(a)-Geral", "oficio": "Ofício SUB3 - Matéria Criminal"},
	"CIVINT/STIC": {"idUnidade": 34325, "idConcentrador": 17513136, "tipo": "COORDENADORIA",
		"nome": "CIVINT/STIC - Coordenadoria de Interoperabilidade", "oficio": "Coordenadoria de Interoperabilidade"},
}

# Perfil agregado real (coluna QTD) de homologação: só volumes, nenhum dado pessoal.
PERFIL = {
	("CIVINT/STIC", "DOCUMENTO", "A_RECEBER"): 669,
	("CIVINT/STIC", "DOCUMENTO", "ENVIADO_NAO_RECEBIDO"): 550,
	("CIVINT/STIC", "DOCUMENTO", "NO_SETOR"): 1402,
	("CIVINT/STIC", "EXTRAJUDICIAL", "ENVIADO_NAO_RECEBIDO"): 2,
	("CIVINT/STIC", "EXTRAJUDICIAL", "NO_SETOR"): 6,
	("GABSUB3-DVT", "DOCUMENTO", "A_RECEBER"): 2,
	("GABSUB3-DVT", "DOCUMENTO", "ENVIADO_NAO_RECEBIDO"): 4,
	("GABSUB3-DVT", "DOCUMENTO", "NO_SETOR"): 350,
	("GABSUB3-DVT", "JUDICIAL", "A_RECEBER"): 17,
	("GABSUB3-DVT", "JUDICIAL", "ENVIADO_NAO_RECEBIDO"): 1,
	("GABSUB3-DVT", "JUDICIAL", "NO_SETOR"): 38,
	("GABSUB3-DVT", "EXTRAJUDICIAL", "A_RECEBER"): 1,
	("GABSUB3-DVT", "EXTRAJUDICIAL", "NO_SETOR"): 1,
}

GERENCIADORES = {"JUDICIAL": "JUD", "DOCUMENTO": "DOC", "EXTRAJUDICIAL": "EXT"}
CAIXAS_COM_ACAO = ("A_RECEBER", "NO_SETOR")

USUARIOS_SETOR = {
	"GABSUB3-DVT": [("MEMBRO", "Subprocurador(a)-Geral da República"), ("CHEFE", "Chefe de Gabinete"),
		("SERVIDOR", "Assessor(a) Jurídico(a)"), ("SERVIDOR", "Assessor(a) Jurídico(a)"),
		("SERVIDOR", "Analista do MPU"), ("SERVIDOR", "Técnico(a) do MPU")],
	"CIVINT/STIC": [("CHEFE", "Coordenador(a)"), ("SERVIDOR", "Analista de TI"), ("SERVIDOR", "Analista de TI"),
		("SERVIDOR", "Analista de TI"), ("SERVIDOR", "Analista de TI"), ("SERVIDOR", "Técnico(a) de TI"),
		("SERVIDOR", "Técnico(a) de TI"), ("SERVIDOR", "Estagiário(a)")],
}
# Nomes claramente fictícios (sobrenomes "Exemplo", "Teste"...) para não sugerir pessoas reais
NOMES_FICTICIOS = ["Ana Exemplo", "Bruno Teste", "Carla Modelo", "Diego Fictício", "Elisa Amostra", "Fábio Demo",
	"Gabriela Simulada", "Heitor Protótipo", "Isabela Piloto", "João Rascunho", "Karina Ensaio", "Lucas Esboço",
	"Marina Maquete", "Nelson Mock"]


CLASSES = {
	"JUDICIAL": [("RESP", "Recurso Especial"), ("ARESP", "Agravo em Recurso Especial"), ("HC", "Habeas Corpus"),
		("RHC", "Recurso em Habeas Corpus"), ("AGINT", "Agravo Interno"), ("EDCL", "Embargos de Declaração"),
		("MS", "Mandado de Segurança"), ("CC", "Conflito de Competência"), ("APN", "Ação Penal")],
	"DOCUMENTO": [("OFICIO", "Ofício"), ("MEMORANDO", "Memorando"), ("DESPACHO", "Despacho"),
		("INFORMACAO", "Informação"), ("NOTA_TECNICA", "Nota Técnica"), ("REQUERIMENTO", "Requerimento"),
		("ANEXO", "Anexo")],
	"EXTRAJUDICIAL": [("NF", "Notícia de Fato"), ("PP", "Procedimento Preparatório"), ("IC", "Inquérito Civil"),
		("PA", "Procedimento Administrativo"), ("PIC", "Procedimento Investigatório Criminal")],
}
PRAZO_CLASSE_EXTRAJUDICIAL = {"NF": 30, "PP": 90, "IC": 365, "PA": 365, "PIC": 90}
TIPO_PRAZO = {"JUDICIAL": "PROCESSUAL", "DOCUMENTO": "RESPOSTA", "EXTRAJUDICIAL": "TRAMITACAO"}
DIAS_AUTUACAO = {"JUDICIAL": (30, 1500), "DOCUMENTO": (0, 20), "EXTRAJUDICIAL": (0, 1800)}
TIPO_MINUTA = {"JUDICIAL": "manifestação", "DOCUMENTO": "ofício de resposta", "EXTRAJUDICIAL": "despacho"}
# (assunto, tema): o tema é derivado do assunto para manter a combinação coerente
ASSUNTOS = {
	"JUDICIAL": [("Tráfico de drogas", "Criminal"), ("Crimes contra a administração pública", "Criminal"),
		("Lavagem de dinheiro", "Criminal"), ("Execução penal", "Criminal"),
		("Improbidade administrativa", "Administrativo"), ("Benefício previdenciário", "Previdenciário"),
		("Tributos federais", "Tributário"), ("Dano moral", "Cível"), ("Contrato bancário", "Consumidor")],
	"DOCUMENTO": [("Solicitação de informações", "Institucional"), ("Integração de sistemas", "Tecnologia da Informação"),
		("Acesso a dados", "Tecnologia da Informação"), ("Contratação de solução de TI", "Orçamento e Finanças"),
		("Pedido de providências", "Administrativa"), ("Relatório de atividades", "Institucional"),
		("Consulta jurídica", "Administrativa"), ("Lotação de servidores", "Gestão de Pessoas"),
		("Encaminhamento de documentação", "Administrativa")],
	"EXTRAJUDICIAL": [("Saúde pública", "1ª CCR - Direitos Sociais"), ("Educação", "1ª CCR - Direitos Sociais"),
		("Licitações e contratos", "5ª CCR - Combate à Corrupção"), ("Patrimônio público", "5ª CCR - Combate à Corrupção"),
		("Desmatamento", "4ª CCR - Meio Ambiente"), ("Acessibilidade", "PFDC - Direitos do Cidadão"),
		("Direito do consumidor", "3ª CCR - Consumidor e Ordem Econômica"), ("Crime de fronteira", "2ª CCR - Criminal")],
}
ORGAOS_ORIGEM = {
	"JUDICIAL": ["STJ - Primeira Turma", "STJ - Segunda Turma", "STJ - Quinta Turma", "STJ - Sexta Turma",
		"STJ - Terceira Seção", "STJ - Corte Especial"],
	"DOCUMENTO": ["Tribunal de Contas da União", "Procuradoria da República em Goiás",
		"Secretaria de Tecnologia da Informação", "Conselho Nacional do Ministério Público",
		"Departamento de Polícia Federal", "Sala de Atendimento ao Cidadão", "Secretaria-Geral do MPF"],
	"EXTRAJUDICIAL": ["Representação de cidadão", "Ofício de órgão público", "Instauração de ofício",
		"Declínio de outra unidade", "Auditoria do TCU"],
}
TIPOS_ENTRADA = {
	"JUDICIAL": ["Intimação eletrônica", "Vista", "Remessa"],
	"DOCUMENTO": ["Protocolo eletrônico", "Malote digital", "E-mail institucional"],
	"EXTRAJUDICIAL": ["Autuação", "Redistribuição", "Retorno de diligência"],
}
SETORES_ORIGEM = ["PROTOCOLO/PGR", "SECAD/PGR", "STJ (integração)", "PR-GO", "PR-RJ", "STIC/DTI", "GABSUB5"]
SETORES_DESTINO = ["SECAD/PGR", "STIC/DTI", "PR-DF", "GABSUB5", "CGU (externo)", "PR-SP"]
UFS = ["GO", "RJ", "SP", "DF", "MG", "RS", "BA", "PE"]

# (situação, ação pendente, peso) para expedientes que estão no setor
SITUACOES_NO_SETOR = {
	"JUDICIAL": [("EM_ANALISE", "Analisar intimação", 30), ("MINUTA_EM_ELABORACAO", "Elaborar manifestação", 30),
		("AGUARDANDO_ASSINATURA", "Assinar manifestação", 15), ("AGUARDANDO_CIENCIA", "Dar ciência", 15),
		("PRONTO_PARA_ENVIO", "Movimentar", 10)],
	"DOCUMENTO": [("EM_ANALISE", "Analisar documento", 30), ("MINUTA_EM_ELABORACAO", "Elaborar resposta", 25),
		("AGUARDANDO_ASSINATURA", "Assinar documento", 15), ("AGUARDANDO_RESPOSTA_EXTERNA", "Cobrar resposta", 15),
		("PRONTO_PARA_ENVIO", "Encaminhar", 15)],
	"EXTRAJUDICIAL": [("EM_ANALISE", "Despachar", 35), ("EM_DILIGENCIA", "Acompanhar diligência", 25),
		("PRAZO_A_PRORROGAR", "Prorrogar prazo", 15), ("MINUTA_EM_ELABORACAO", "Elaborar promoção", 15),
		("PRONTO_PARA_ENVIO", "Movimentar", 10)],
}
SITUACAO_POR_CAIXA = {"A_RECEBER": ("AGUARDANDO_RECEBIMENTO", "Receber"),
	"ENVIADO_NAO_RECEBIDO": ("ENVIADO", "Aguardar recebimento pelo destino")}
SITUACOES_COM_MINUTA = {"MINUTA_EM_ELABORACAO", "AGUARDANDO_ASSINATURA", "PRONTO_PARA_ENVIO"}
CHANCE_DESIGNACAO = {"NO_SETOR": 0.65, "ENVIADO_NAO_RECEBIDO": 0.5, "BAIXADO": 0.5}

# (peso, dias restantes mín, máx): distribuição de urgência de prazo dos expedientes ativos
FAIXAS_PRAZO = [(12, -45, -1), (5, 0, 0), (12, 1, 3), (16, 4, 7), (55, 8, 90)]

MARCADORES = {
	"JUDICIAL": [("Acompanhar", "#8BD17C"), ("Apelação", "#E57373"), ("Atenção", "#F48FB1"), ("Ciência", "#AED581"),
		("Homologação", "#C2185B"), ("Pendência", "#BCAAA4"), ("Repercussão geral", "#DCE775"), ("Relatório", "#80CBC4")],
	"DOCUMENTO": [("Responder", "#64B5F6"), ("Arquivar", "#B0BEC5"), ("Urgente", "#E57373"), ("Aguardando TI", "#9575CD")],
	"EXTRAJUDICIAL": [("Para parecer", "#80CBC4"), ("Diligência", "#FFB74D"), ("Prorrogar", "#F06292")],
}
TEXTOS_ANOTACAO = ["Aguardando manifestação da área técnica.", "Verificar prazo com a chefia.",
	"Minuta revisada, pendente de assinatura.", "Solicitadas informações complementares ao remetente.",
	"Prioridade definida em reunião de equipe.", "Relacionado a expediente anterior do mesmo interessado.",
	"Conferir anexos antes de movimentar.", "Aguardando retorno de diligência."]
TIPOS_ACAO_LOTE = [("RECEBER", "A_RECEBER"), ("DESIGNAR", "NO_SETOR"), ("INCLUIR_MARCADOR", "NO_SETOR"),
	("MOVIMENTAR", "NO_SETOR"), ("DAR_CIENCIA", "NO_SETOR"), ("ASSINAR", "NO_SETOR"), ("ARQUIVAR", "BAIXADO")]
QTD_LOTES = {"GABSUB3-DVT": 15, "CIVINT/STIC": 40}
COLUNAS_PAINEL = ["etiqueta", "gerenciador", "caixa", "situacao", "acaoPendente", "classe", "assunto", "dataChegada",
	"dataPrazo", "diasRestantes", "statusPrazo", "prioridade", "nomeResponsavel", "marcadores", "tempoParadoDias"]
FILTROS_MODELO = [
	("Vencidos e críticos", {"statusPrazo": ["VENCIDO", "VENCE_HOJE", "CRITICO"]}, "dataPrazo:asc"),
	("Meus designados", {"idResponsavel": "$USUARIO", "tipoResponsabilidade": "DESIGNADO"}, "dataPrazo:asc"),
	("Urgentes judiciais", {"gerenciador": ["JUDICIAL"], "urgente": True}, "pontuacaoPrioridade:desc"),
	("Parados há mais de 30 dias", {"tempoParadoDiasMin": 30}, "tempoParadoDias:desc"),
	("Aguardando assinatura", {"situacao": ["AGUARDANDO_ASSINATURA"]}, "dataChegada:asc"),
	("Novos nas últimas 24h", {"novo": True}, "dataChegada:desc"),
	("Integração de sistemas", {"assunto": ["Integração de sistemas"]}, "dataPrazo:asc"),
]
NOTICIAS = [("Nova versão do painel de expedientes", "SISTEMA", 1, True),
	("Manutenção programada no fim de semana", "MANUTENCAO", 2, False),
	("Treinamento: marcadores e designações", "CAPACITACAO", 3, False),
	("Novo prazo de tramitação para Notícias de Fato", "NORMATIVO", 2, True)]

TABELAS = ["setores", "usuarios", "expedientes", "movimentacoes", "prazos", "designacoes", "anotacoes", "marcadores",
	"marcadores_expedientes", "favoritos", "notificacoes", "acoes_lote", "preferencias_usuario", "filtros_salvos",
	"contadores", "estoque_diario", "produtividade_diaria", "noticias", "catalogos"]

COLUNAS_EXPEDIENTE = [
	"idExpediente", "gerenciador", "siglaSetor", "caixa", "situacao", "acaoPendente", "requerAcao",
	"etiqueta", "numeroReferencia", "classe", "descricaoClasse", "tema", "assunto", "resumo", "orgaoOrigem",
	"tipoEntrada", "setorOrigem", "setorDestino", "dataAutuacao", "dataChegada", "dataRecebimento",
	"dataUltimaMovimentacao", "diasNoSetor", "tempoParadoDias", "tipoPrazo", "dataInicioPrazo", "dataPrazo",
	"duracaoPrazoDias", "diasRestantes", "statusPrazo", "prioridade", "pontuacaoPrioridade", "urgente",
	"motivoUrgencia", "reuPreso", "idoso", "novaIntimacao", "novo", "idResponsavel", "nomeResponsavel",
	"tipoResponsabilidade", "oficioResponsavel", "designado", "eletronico", "nivelSigilo", "sigiloso", "favorito",
	"marcadores", "qtdMarcadores", "qtdAnotacoes", "qtdMinutasPendentes", "qtdMovimentacoes",
]

COLUNA_PRODUTIVIDADE = {"RECEBIMENTO": "recebimentos", "DESIGNACAO": "designacoes", "MARCADOR_INCLUIDO": "marcadores",
	"ANOTACAO_INCLUIDA": "anotacoes", "MINUTA_CRIADA": "minutas", "ASSINATURA": "assinaturas",
	"PRAZO_PRORROGADO": "prorrogacoes", "ENVIO_PELO_SETOR": "envios", "ARQUIVAMENTO": "arquivamentos"}
TIPOS_ALTERACAO = {"MARCADOR_INCLUIDO", "ANOTACAO_INCLUIDA", "PRAZO_PRORROGADO"}

CATALOGO_SIMPLES = {
	"GERENCIADOR": ["JUDICIAL", "DOCUMENTO", "EXTRAJUDICIAL"],
	"CAIXA": ["A_RECEBER", "NO_SETOR", "ENVIADO_NAO_RECEBIDO", "BAIXADO"],
	"STATUS_PRAZO": ["VENCIDO", "VENCE_HOJE", "CRITICO", "ATENCAO", "NO_PRAZO", "CUMPRIDO", "CUMPRIDO_COM_ATRASO"],
	"PRIORIDADE": ["CRITICA", "ALTA", "MEDIA", "BAIXA"],
	"SEVERIDADE": ["CRITICO", "ATENCAO", "INFO"],
	"TIPO_MOVIMENTACAO": ["CADASTRO", "ENVIO_AO_SETOR", "RECEBIMENTO", "DESIGNACAO", "MARCADOR_INCLUIDO",
		"ANOTACAO_INCLUIDA", "MINUTA_CRIADA", "ASSINATURA", "PRAZO_PRORROGADO", "ENVIO_PELO_SETOR", "ARQUIVAMENTO"],
	"TIPO_NOTIFICACAO": ["NOVO_EXPEDIENTE", "NOVA_INTIMACAO", "PRAZO_VENCIDO", "PRAZO_VENCE_HOJE", "PRAZO_PROXIMO",
		"DESIGNACAO", "DEVOLUCAO_VENCIDA", "ALTERACAO", "ENVIO_PENDENTE"],
	"TIPO_ACAO_LOTE": [tipo for tipo, _ in TIPOS_ACAO_LOTE],
	"TIPO_PRAZO": sorted(set(TIPO_PRAZO.values())),
}
DESCRICOES = {"VENCIDO": "Prazo vencido", "VENCE_HOJE": "Vence hoje", "CRITICO": "Vence em até 3 dias",
	"ATENCAO": "Vence em até 7 dias", "NO_PRAZO": "No prazo", "CUMPRIDO": "Cumprido no prazo",
	"CUMPRIDO_COM_ATRASO": "Cumprido com atraso", "A_RECEBER": "A receber", "NO_SETOR": "No setor",
	"ENVIADO_NAO_RECEBIDO": "Enviados não recebidos", "BAIXADO": "Baixados (histórico)",
	"CRITICA": "Crítica", "MEDIA": "Média", "DESIGNACAO": "Designação", "MARCADOR_INCLUIDO": "Marcador incluído",
	"ANOTACAO_INCLUIDA": "Anotação incluída", "NOVA_INTIMACAO": "Nova intimação", "PRAZO_PROXIMO": "Prazo próximo",
	"DEVOLUCAO_VENCIDA": "Devolução vencida", "ALTERACAO": "Alteração", "DAR_CIENCIA": "Dar ciência",
	"TRAMITACAO": "Tramitação", "AGUARDANDO_CIENCIA": "Aguardando ciência",
	"CONCLUIDO_ARQUIVADO": "Concluído (arquivado)", "CONCLUIDO_ENVIADO": "Concluído (enviado)",
	"EM_ANALISE": "Em análise", "EM_DILIGENCIA": "Em diligência", "MINUTA_EM_ELABORACAO": "Minuta em elaboração"}
# Códigos repetidos entre domínios (ex.: CRITICO em STATUS_PRAZO e SEVERIDADE) com significado próprio.
DESCRICOES_POR_DOMINIO = {"SEVERIDADE": {"CRITICO": "Crítico", "ATENCAO": "Atenção", "INFO": "Informativo"}}
CORES_POR_DOMINIO = {"SEVERIDADE": {"CRITICO": "#C62828", "ATENCAO": "#EF6C00", "INFO": "#1565C0"}}
CORES = {"VENCIDO": "#C62828", "VENCE_HOJE": "#E65100", "CRITICO": "#F9A825", "ATENCAO": "#FDD835",
	"NO_PRAZO": "#2E7D32", "CUMPRIDO": "#546E7A", "CUMPRIDO_COM_ATRASO": "#8D6E63", "CRITICA": "#C62828",
	"ALTA": "#EF6C00", "MEDIA": "#F9A825", "BAIXA": "#2E7D32", "INFO": "#1565C0", "JUDICIAL": "#6A1B9A",
	"DOCUMENTO": "#2E7D32", "EXTRAJUDICIAL": "#EF6C00"}
COR_PADRAO = "#607D8B"


def gerenciadores_do_setor(sigla):
	presentes = {gerenciador for (sigla_perfil, gerenciador, _) in PERFIL if sigla_perfil == sigla}
	return [gerenciador for gerenciador in GERENCIADORES if gerenciador in presentes]


def classificar_prazo(dias_restantes):
	if dias_restantes < 0:
		return "VENCIDO"
	if dias_restantes == 0:
		return "VENCE_HOJE"
	if dias_restantes <= 3:
		return "CRITICO"
	if dias_restantes <= 7:
		return "ATENCAO"
	return "NO_PRAZO"

PONTOS_STATUS_PRAZO = {"VENCIDO": 50, "VENCE_HOJE": 45, "CRITICO": 35, "ATENCAO": 20, "NO_PRAZO": 5}


def pontuar_prioridade(expediente):
	"""Pontuação 0-100 combinando prazo, urgência legal, intimação nova e tempo parado."""
	if expediente["caixa"] == "BAIXADO":
		return 0
	pontos = PONTOS_STATUS_PRAZO[expediente["statusPrazo"]]
	pontos += 30 if expediente["urgente"] else 0
	pontos += 10 if expediente["novaIntimacao"] else 0
	pontos += 10 if expediente["tempoParadoDias"] > 30 else 0
	pontos += 5 if expediente["situacao"] == "AGUARDANDO_ASSINATURA" else 0
	if expediente["caixa"] == "ENVIADO_NAO_RECEBIDO":
		pontos //= 2
	return min(pontos, 100)


def nivel_prioridade(pontos):
	if pontos >= 60:
		return "CRITICA"
	if pontos >= 35:
		return "ALTA"
	if pontos >= 20:
		return "MEDIA"
	return "BAIXA"


def as_sete_horas(dia):
	return datetime.combine(dia, time(7, 0), tzinfo=FUSO)


def slug(sigla):
	return sigla.replace("/", "-")


class GeradorBase:
	"""Gera todas as tabelas de forma determinística a partir da semente e do instante de referência."""

	def __init__(self, semente, agora):
		self.rnd = random.Random(semente)
		self.agora = agora
		self.hoje = agora.date()
		self.tabelas = {nome: [] for nome in TABELAS}
		self.sequencias = Counter()
		self.usuarios = {}
		self.marcadores = {}
		self.etiquetas = set()

	def gerar(self):
		for sigla in SETORES:
			self._gerar_setor(sigla)
			self._gerar_usuarios(sigla)
			self._gerar_expedientes(sigla)
			self._gerar_favoritos(sigla)
			self._gerar_acoes_lote(sigla)
		self._gerar_notificacoes()
		self._gerar_personalizacao()
		self._gerar_contadores()
		self._gerar_estoque_diario()
		self._gerar_produtividade()
		self._gerar_noticias()
		self._gerar_catalogos()
		return self.tabelas

	def _novo_id(self, prefixo):
		self.sequencias[prefixo] += 1
		return f"{prefixo}{self.sequencias[prefixo]:06d}"

	def _entre(self, inicio, fim):
		segundos = int((fim - inicio).total_seconds())
		if segundos <= 0:
			return inicio
		return inicio + timedelta(seconds=self.rnd.randint(0, segundos))

	# ---------- setor, usuários, marcadores ----------

	def _gerar_setor(self, sigla):
		setor = SETORES[sigla]
		gerenciadores = gerenciadores_do_setor(sigla)
		self.tabelas["setores"].append({"siglaSetor": sigla, "idUnidadeOrganica": setor["idUnidade"],
			"idConcentrador": setor["idConcentrador"], "nome": setor["nome"], "tipoSetor": setor["tipo"],
			"oficio": setor["oficio"], "gerenciadores": ";".join(gerenciadores),
			"qtdUsuarios": len(USUARIOS_SETOR[sigla])})
		for gerenciador in gerenciadores:
			lista = []
			for indice, (descricao, cor) in enumerate(MARCADORES[gerenciador], start=1):
				marcador = {"idRotulo": f"ROT{setor['idUnidade']}{GERENCIADORES[gerenciador]}{indice:02d}",
					"siglaSetor": sigla, "gerenciador": gerenciador, "descricao": descricao, "cor": cor,
					"finalizarNaSaida": indice % 3 == 0, "qtdExpedientes": 0}
				lista.append(marcador)
				self.tabelas["marcadores"].append(marcador)
			self.marcadores[(sigla, gerenciador)] = lista

	def _gerar_usuarios(self, sigla):
		usuarios = []
		for indice, (perfil, cargo) in enumerate(USUARIOS_SETOR[sigla], start=1):
			numero = len(self.tabelas["usuarios"]) + 1
			usuario = {"idUsuario": f"{slug(sigla)}-U{indice:02d}", "nome": NOMES_FICTICIOS[numero - 1],
				"siglaSetor": sigla, "perfil": perfil, "cargo": cargo, "email": f"usuario{numero:02d}@exemplo.org",
				"ativo": True,
				"dataUltimoAcesso": self.agora - timedelta(minutes=self.rnd.randint(5, 5 * 24 * 60))}
			usuarios.append(usuario)
			self.tabelas["usuarios"].append(usuario)
		self.usuarios[sigla] = usuarios

	def _chefia(self, sigla):
		return next(usuario for usuario in self.usuarios[sigla] if usuario["perfil"] == "CHEFE")

	# ---------- expedientes ----------

	def _gerar_expedientes(self, sigla):
		totais = Counter()
		for (sigla_perfil, gerenciador, caixa), quantidade in PERFIL.items():
			if sigla_perfil != sigla:
				continue
			totais[gerenciador] += quantidade
			for _ in range(quantidade):
				self._criar_expediente(sigla, gerenciador, caixa)
		# Baixados: histórico recente (enviados e recebidos pelo destino ou arquivados) para dashboards
		for gerenciador, total in totais.items():
			for _ in range(max(1, round(total * PROPORCAO_BAIXADOS))):
				self._criar_expediente(sigla, gerenciador, "BAIXADO")

	def _criar_expediente(self, sigla, gerenciador, caixa):
		motivo_baixa = self.rnd.choices(["ENVIADO", "ARQUIVADO"], [70, 30])[0] if caixa == "BAIXADO" else None
		chegada, recebimento, saida = self._linha_do_tempo(caixa)
		expediente = {"idExpediente": self._novo_id("EXP"), "gerenciador": gerenciador, "siglaSetor": sigla,
			"caixa": caixa}
		expediente.update(self._situacao(gerenciador, caixa, motivo_baixa))
		expediente.update(self._classificacao(gerenciador, chegada))
		expediente["setorOrigem"] = self.rnd.choice(SETORES_ORIGEM)
		expediente["setorDestino"] = self._destino(sigla, saida, motivo_baixa)
		expediente["dataChegada"] = chegada
		expediente["dataRecebimento"] = recebimento
		expediente.update(self._prazo(gerenciador, expediente["classe"], recebimento or chegada, caixa, saida))
		expediente.update(self._urgencia(gerenciador, caixa))
		expediente.update({"eletronico": self.rnd.random() < 0.93, "marcadores": "", "qtdMarcadores": 0,
			"qtdAnotacoes": 0, "qtdMinutasPendentes": 0, "favorito": False, "designado": False})
		nivel_sigilo = self.rnd.choices([0, 1, 2], [92, 5, 3])[0]
		expediente.update({"nivelSigilo": nivel_sigilo, "sigiloso": nivel_sigilo > 0})
		self._registrar_prazo(expediente, saida)
		self._registrar_historico(expediente, recebimento, saida, motivo_baixa)
		self._calcular_indicadores(expediente, saida)
		self.tabelas["expedientes"].append(expediente)

	def _linha_do_tempo(self, caixa):
		"""Retorna (chegada ao setor, recebimento, saída) coerentes com a caixa atual."""
		if caixa == "A_RECEBER":
			return self.agora - timedelta(minutes=self.rnd.randint(5, 10 * 24 * 60)), None, None
		if caixa == "BAIXADO":
			chegada = self.agora - timedelta(days=self.rnd.randint(10, 120), minutes=self.rnd.randint(0, 1440))
			recebimento = min(chegada + timedelta(minutes=self.rnd.randint(10, 48 * 60)), self.agora)
			saida = recebimento + timedelta(days=self.rnd.randint(1, 45), minutes=self.rnd.randint(0, 1440))
			return chegada, recebimento, min(saida, self.agora - timedelta(hours=1))
		idade_dias = min(self.rnd.expovariate(1 / 35), 400) + self.rnd.random()
		chegada = self.agora - timedelta(days=idade_dias)
		recebimento = min(chegada + timedelta(minutes=self.rnd.randint(10, 48 * 60)), self.agora)
		if caixa != "ENVIADO_NAO_RECEBIDO":
			return chegada, recebimento, None
		saida = self.agora - timedelta(minutes=self.rnd.randint(30, 20 * 24 * 60))
		return chegada, recebimento, min(max(saida, recebimento + timedelta(hours=1)), self.agora)

	def _situacao(self, gerenciador, caixa, motivo_baixa):
		if caixa == "NO_SETOR":
			opcoes = SITUACOES_NO_SETOR[gerenciador]
			situacao, acao, _ = self.rnd.choices(opcoes, [peso for _, _, peso in opcoes])[0]
		elif caixa == "BAIXADO":
			situacao, acao = f"CONCLUIDO_{motivo_baixa}", "Nenhuma"
		else:
			situacao, acao = SITUACAO_POR_CAIXA[caixa]
		return {"situacao": situacao, "acaoPendente": acao, "requerAcao": caixa in CAIXAS_COM_ACAO}

	def _destino(self, sigla, saida, motivo_baixa):
		if saida is None:
			return sigla
		if motivo_baixa == "ARQUIVADO":
			return "ARQUIVO"
		return self.rnd.choice(SETORES_DESTINO)

	def _classificacao(self, gerenciador, chegada):
		classe, descricao = self.rnd.choice(CLASSES[gerenciador])
		minimo, maximo = DIAS_AUTUACAO[gerenciador]
		autuacao = chegada - timedelta(days=self.rnd.randint(minimo, maximo), minutes=self.rnd.randint(1, 1440))
		etiqueta, numero = self._numeracao(gerenciador, classe, descricao, autuacao.year)
		assunto, tema = self.rnd.choice(ASSUNTOS[gerenciador])
		orgao = self.rnd.choice(ORGAOS_ORIGEM[gerenciador])
		return {"etiqueta": etiqueta, "numeroReferencia": numero, "classe": classe, "descricaoClasse": descricao,
			"tema": tema, "assunto": assunto,
			"resumo": f"{descricao} sobre {assunto.lower()}, com origem em {orgao}.", "orgaoOrigem": orgao,
			"tipoEntrada": self.rnd.choice(TIPOS_ENTRADA[gerenciador]), "dataAutuacao": autuacao}

	def _numeracao(self, gerenciador, classe, descricao, ano):
		"""Gera etiqueta única no formato visual de cada gerenciador do Único."""
		while True:
			numero = self.rnd.randint(1, 2999999)
			if gerenciador == "JUDICIAL":
				uf = self.rnd.choice(UFS)
				etiqueta = f"STJ-{classe}-{numero + 1000000}"
				referencia = f"{classe} {numero + 1000000:,}/{uf}".replace(",", ".")
			elif gerenciador == "DOCUMENTO":
				etiqueta = f"PGR-{numero % 100000:08d}/{ano}"
				referencia = f"{descricao} nº {numero % 100000}/{ano}"
			else:
				etiqueta = (f"1.{self.rnd.randint(10, 36)}.{self.rnd.randint(0, 999):03d}."
					f"{numero % 1000000:06d}/{ano}-{self.rnd.randint(10, 99)}")
				referencia = f"{classe} {etiqueta}"
			if etiqueta not in self.etiquetas:
				self.etiquetas.add(etiqueta)
				return etiqueta, referencia

	def _duracao_prazo(self, gerenciador, classe):
		if gerenciador == "EXTRAJUDICIAL":
			return PRAZO_CLASSE_EXTRAJUDICIAL[classe]
		return self.rnd.randint(5, 30) if gerenciador == "JUDICIAL" else self.rnd.randint(10, 30)

	def _dias_restantes_sorteados(self, gerenciador, classe):
		_, minimo, maximo = self.rnd.choices(FAIXAS_PRAZO, [peso for peso, _, _ in FAIXAS_PRAZO])[0]
		if minimo >= 8 and gerenciador == "EXTRAJUDICIAL":
			maximo = max(8, PRAZO_CLASSE_EXTRAJUDICIAL[classe])
		return self.rnd.randint(minimo, maximo)

	def _prazo(self, gerenciador, classe, inicio_prazo, caixa, saida):
		inicio = inicio_prazo.date()
		if caixa == "BAIXADO":
			data_prazo = inicio + timedelta(days=self._duracao_prazo(gerenciador, classe))
			dias = (data_prazo - saida.date()).days
			status = "CUMPRIDO" if dias >= 0 else "CUMPRIDO_COM_ATRASO"
		else:
			alvo = self.hoje + timedelta(days=self._dias_restantes_sorteados(gerenciador, classe))
			data_prazo = max(alvo, inicio + timedelta(days=1))
			dias = (data_prazo - self.hoje).days
			status = classificar_prazo(dias)
		return {"tipoPrazo": TIPO_PRAZO[gerenciador], "dataInicioPrazo": inicio, "dataPrazo": data_prazo,
			"duracaoPrazoDias": (data_prazo - inicio).days, "diasRestantes": dias, "statusPrazo": status}

	def _urgencia(self, gerenciador, caixa):
		sorteio = self.rnd.random()
		motivo = "Nenhum"
		if gerenciador == "JUDICIAL":
			if sorteio < 0.07:
				motivo = "Réu preso"
			elif sorteio < 0.12:
				motivo = "Idoso"
			elif sorteio < 0.15:
				motivo = "Liminar/tutela de urgência"
		elif gerenciador == "DOCUMENTO":
			if sorteio < 0.05:
				motivo = "Pedido de urgência"
		elif sorteio < 0.05:
			motivo = "Idoso"
		elif sorteio < 0.08:
			motivo = "Risco de dano ao patrimônio público"
		nova_intimacao = gerenciador == "JUDICIAL" and caixa in CAIXAS_COM_ACAO and self.rnd.random() < 0.2
		return {"urgente": motivo != "Nenhum", "motivoUrgencia": motivo, "reuPreso": motivo == "Réu preso",
			"idoso": motivo == "Idoso", "novaIntimacao": nova_intimacao}

	def _registrar_prazo(self, expediente, saida, situacao=None, data_prazo=None, encerramento=None):
		data_prazo = data_prazo or expediente["dataPrazo"]
		if situacao is None:
			if expediente["caixa"] == "BAIXADO":
				cumprido = expediente["statusPrazo"] == "CUMPRIDO"
				situacao = "CUMPRIDO_NO_PRAZO" if cumprido else "CUMPRIDO_COM_ATRASO"
				encerramento = saida
			else:
				situacao = "ABERTO"
		referencia = encerramento.date() if encerramento else self.hoje
		self.tabelas["prazos"].append({"idPrazo": self._novo_id("PRZ"), "idExpediente": expediente["idExpediente"],
			"etiqueta": expediente["etiqueta"], "gerenciador": expediente["gerenciador"],
			"siglaSetor": expediente["siglaSetor"], "tipoPrazo": expediente["tipoPrazo"],
			"dataInicio": expediente["dataInicioPrazo"], "dataPrazo": data_prazo,
			"duracaoDias": (data_prazo - expediente["dataInicioPrazo"]).days, "situacao": situacao,
			"dataEncerramento": encerramento,
			"diasAtraso": 0 if situacao == "PRORROGADO" else max(0, (referencia - data_prazo).days)})

	# ---------- histórico ----------

	def _evento(self, eventos, expediente, data_hora, tipo, usuario, descricao, origem=None, destino=None):
		eventos.append({"idMovimentacao": None, "idExpediente": expediente["idExpediente"],
			"etiqueta": expediente["etiqueta"], "gerenciador": expediente["gerenciador"],
			"siglaSetor": expediente["siglaSetor"], "dataHora": data_hora, "tipoMovimentacao": tipo,
			"idUsuario": usuario["idUsuario"] if usuario else "EXTERNO",
			"nomeUsuario": usuario["nome"] if usuario else "Usuário externo",
			"setorOrigem": origem or expediente["siglaSetor"], "setorDestino": destino or expediente["siglaSetor"],
			"descricao": descricao})

	def _definir_responsavel(self, expediente, usuario, tipo):
		expediente.update({"idResponsavel": usuario["idUsuario"], "nomeResponsavel": usuario["nome"],
			"tipoResponsabilidade": tipo, "oficioResponsavel": SETORES[expediente["siglaSetor"]]["oficio"]})

	def _registrar_historico(self, expediente, recebimento, saida, motivo_baixa):
		sigla = expediente["siglaSetor"]
		usuarios = self.usuarios[sigla]
		eventos = []
		origem = expediente["setorOrigem"]
		self._evento(eventos, expediente, expediente["dataAutuacao"], "CADASTRO", None,
			f"Cadastrado em {origem} ({expediente['orgaoOrigem']})", origem, origem)
		self._evento(eventos, expediente, expediente["dataChegada"], "ENVIO_AO_SETOR", None,
			f"Enviado de {origem} para {sigla}", origem, sigla)
		self._definir_responsavel(expediente, usuarios[0], "TITULAR")
		if recebimento is not None:
			fim = saida or self.agora
			self._evento(eventos, expediente, recebimento, "RECEBIMENTO", self.rnd.choice(usuarios),
				f"Recebido em {sigla}")
			self._designar(expediente, eventos, recebimento, fim, saida)
			if expediente["caixa"] != "BAIXADO":
				self._marcar(expediente, eventos, recebimento, fim)
				self._prorrogar_prazo(expediente, eventos, recebimento, fim)
			self._anotar(expediente, eventos, recebimento, fim)
			self._minutar(expediente, eventos, recebimento, fim)
			if saida is not None:
				self._encerrar(expediente, eventos, saida, motivo_baixa)
		eventos.sort(key=lambda evento: evento["dataHora"])
		for evento in eventos:
			evento["idMovimentacao"] = self._novo_id("MOV")
		self.tabelas["movimentacoes"].extend(eventos)
		expediente["dataUltimaMovimentacao"] = eventos[-1]["dataHora"]
		expediente["qtdMovimentacoes"] = len(eventos)

	def _designar(self, expediente, eventos, inicio, fim, saida):
		if self.rnd.random() >= CHANCE_DESIGNACAO.get(expediente["caixa"], 0):
			return
		sigla = expediente["siglaSetor"]
		designador = self._chefia(sigla)
		designado = self.rnd.choice(self.usuarios[sigla][1:])
		data = self._entre(inicio, min(inicio + timedelta(hours=72), fim))
		prazo_devolucao = data.date() + timedelta(days=self.rnd.randint(3, 15))
		ativa = saida is None
		dias = (prazo_devolucao - (self.hoje if ativa else saida.date())).days
		if ativa:
			status = "VENCIDA" if dias < 0 else "NO_PRAZO"
		else:
			status = "DEVOLVIDA_COM_ATRASO" if dias < 0 else "DEVOLVIDA_NO_PRAZO"
		self.tabelas["designacoes"].append({"idDesignacao": self._novo_id("DES"),
			"idExpediente": expediente["idExpediente"], "etiqueta": expediente["etiqueta"],
			"gerenciador": expediente["gerenciador"], "siglaSetor": sigla,
			"idUsuarioDesignado": designado["idUsuario"], "nomeDesignado": designado["nome"],
			"idUsuarioDesignador": designador["idUsuario"], "nomeDesignador": designador["nome"],
			"dataDesignacao": data, "prazoDevolucao": prazo_devolucao, "diasParaDevolucao": dias,
			"situacao": "ATIVA" if ativa else "ENCERRADA", "statusDevolucao": status, "dataFim": saida})
		self._evento(eventos, expediente, data, "DESIGNACAO", designador, f"Designado para {designado['nome']}")
		if ativa:
			expediente["designado"] = True
			self._definir_responsavel(expediente, designado, "DESIGNADO")

	def _marcar(self, expediente, eventos, inicio, fim):
		if self.rnd.random() >= 0.35:
			return
		disponiveis = self.marcadores[(expediente["siglaSetor"], expediente["gerenciador"])]
		escolhidos = self.rnd.sample(disponiveis, k=min(len(disponiveis), self.rnd.choice([1, 1, 1, 2, 3])))
		for marcador in escolhidos:
			usuario = self.rnd.choice(self.usuarios[expediente["siglaSetor"]])
			data = self._entre(inicio, fim)
			self.tabelas["marcadores_expedientes"].append({"idRotulo": marcador["idRotulo"],
				"descricao": marcador["descricao"], "cor": marcador["cor"], "idExpediente": expediente["idExpediente"],
				"etiqueta": expediente["etiqueta"], "gerenciador": expediente["gerenciador"],
				"siglaSetor": expediente["siglaSetor"], "idUsuario": usuario["idUsuario"], "dataInclusao": data})
			marcador["qtdExpedientes"] += 1
			self._evento(eventos, expediente, data, "MARCADOR_INCLUIDO", usuario,
				f"Marcador '{marcador['descricao']}' incluído")
		expediente["marcadores"] = ";".join(marcador["descricao"] for marcador in escolhidos)
		expediente["qtdMarcadores"] = len(escolhidos)

	def _anotar(self, expediente, eventos, inicio, fim):
		quantidade = self.rnd.choice([0, 0, 1, 1, 1, 2, 3])
		for _ in range(quantidade):
			usuario = self.rnd.choice(self.usuarios[expediente["siglaSetor"]])
			data = self._entre(inicio, fim)
			self.tabelas["anotacoes"].append({"idAnotacao": self._novo_id("ANO"),
				"idExpediente": expediente["idExpediente"], "etiqueta": expediente["etiqueta"],
				"gerenciador": expediente["gerenciador"], "siglaSetor": expediente["siglaSetor"],
				"idUsuario": usuario["idUsuario"], "nomeUsuario": usuario["nome"], "dataHora": data,
				"texto": self.rnd.choice(TEXTOS_ANOTACAO)})
			self._evento(eventos, expediente, data, "ANOTACAO_INCLUIDA", usuario, "Anotação incluída")
		expediente["qtdAnotacoes"] = quantidade

	def _minutar(self, expediente, eventos, inicio, fim):
		caixa = expediente["caixa"]
		com_minuta = (expediente["situacao"] in SITUACOES_COM_MINUTA
			or (caixa == "ENVIADO_NAO_RECEBIDO" and self.rnd.random() < 0.6)
			or (expediente["situacao"] == "CONCLUIDO_ENVIADO" and self.rnd.random() < 0.7))
		if not com_minuta:
			return
		usuarios = self.usuarios[expediente["siglaSetor"]]
		tipo_minuta = TIPO_MINUTA[expediente["gerenciador"]]
		criacao = self._entre(inicio, fim)
		self._evento(eventos, expediente, criacao, "MINUTA_CRIADA", self.rnd.choice(usuarios),
			f"Minuta de {tipo_minuta} criada")
		assinada = expediente["situacao"] == "PRONTO_PARA_ENVIO" or caixa in ("ENVIADO_NAO_RECEBIDO", "BAIXADO")
		if assinada:
			self._evento(eventos, expediente, self._entre(criacao, fim), "ASSINATURA", usuarios[0],
				f"{tipo_minuta.capitalize()} assinada")
		else:
			expediente["qtdMinutasPendentes"] = 1

	def _prorrogar_prazo(self, expediente, eventos, inicio, fim):
		if self.rnd.random() >= 0.08:
			return
		prazo_atual = expediente["dataPrazo"]
		prazo_anterior = max(expediente["dataInicioPrazo"] + timedelta(days=1),
			prazo_atual - timedelta(days=self.rnd.randint(5, 20)))
		if prazo_anterior >= prazo_atual:
			return
		data = self._entre(inicio, fim)
		self._registrar_prazo(expediente, None, "PRORROGADO", prazo_anterior, data)
		self._evento(eventos, expediente, data, "PRAZO_PRORROGADO", self.usuarios[expediente["siglaSetor"]][0],
			f"Prazo prorrogado de {prazo_anterior:%d/%m/%Y} para {prazo_atual:%d/%m/%Y}")

	def _encerrar(self, expediente, eventos, saida, motivo_baixa):
		usuario = self.rnd.choice(self.usuarios[expediente["siglaSetor"]])
		destino = expediente["setorDestino"]
		if motivo_baixa == "ARQUIVADO":
			self._evento(eventos, expediente, saida, "ARQUIVAMENTO", usuario, "Expediente arquivado", destino=destino)
		else:
			self._evento(eventos, expediente, saida, "ENVIO_PELO_SETOR", usuario, f"Enviado para {destino}",
				destino=destino)

	def _calcular_indicadores(self, expediente, saida):
		fim = saida or self.agora
		expediente["diasNoSetor"] = (fim - expediente["dataChegada"]).days
		expediente["tempoParadoDias"] = (self.agora - expediente["dataUltimaMovimentacao"]).days
		expediente["novo"] = (expediente["caixa"] != "BAIXADO"
			and self.agora - expediente["dataChegada"] <= timedelta(hours=24))
		expediente["pontuacaoPrioridade"] = pontuar_prioridade(expediente)
		expediente["prioridade"] = nivel_prioridade(expediente["pontuacaoPrioridade"])
		expediente["_saida"] = saida

	# ---------- favoritos e ações em lote ----------

	def _expedientes_do_setor(self, sigla, ativos=False):
		return [expediente for expediente in self.tabelas["expedientes"]
			if expediente["siglaSetor"] == sigla and (not ativos or expediente["caixa"] != "BAIXADO")]

	def _gerar_favoritos(self, sigla):
		candidatos = self._expedientes_do_setor(sigla, ativos=True)
		quantidade = min(30, max(3, len(candidatos) // 100), len(candidatos))
		for expediente in self.rnd.sample(candidatos, k=quantidade):
			usuario = self.rnd.choice(self.usuarios[sigla])
			expediente["favorito"] = True
			self.tabelas["favoritos"].append({"siglaSetor": sigla, "idExpediente": expediente["idExpediente"],
				"etiqueta": expediente["etiqueta"], "gerenciador": expediente["gerenciador"],
				"idUsuario": usuario["idUsuario"], "nomeUsuario": usuario["nome"],
				"dataInclusao": self._entre(expediente["dataChegada"], self.agora)})

	def _parametros_lote(self, tipo, sigla):
		if tipo == "DESIGNAR":
			return f"designado={self.rnd.choice(self.usuarios[sigla][1:])['idUsuario']}"
		if tipo == "INCLUIR_MARCADOR":
			gerenciador = self.rnd.choice(gerenciadores_do_setor(sigla))
			return f"marcador={self.rnd.choice(self.marcadores[(sigla, gerenciador)])['descricao']}"
		if tipo == "MOVIMENTAR":
			return f"destino={self.rnd.choice(SETORES_DESTINO)}"
		return {"RECEBER": "confirmarRecebimento=true", "DAR_CIENCIA": "tipo=ciência simples",
			"ASSINAR": "certificado=ICP-Brasil", "ARQUIVAR": "motivo=conclusão"}[tipo]

	def _gerar_acoes_lote(self, sigla):
		expedientes = self._expedientes_do_setor(sigla)
		for _ in range(QTD_LOTES[sigla]):
			tipo, caixa_alvo = self.rnd.choice(TIPOS_ACAO_LOTE)
			candidatos = [expediente for expediente in expedientes if expediente["caixa"] == caixa_alvo
				and (tipo != "DAR_CIENCIA" or expediente["gerenciador"] == "JUDICIAL")]
			if len(candidatos) < 2:
				continue
			selecionados = self.rnd.sample(candidatos, k=self.rnd.randint(2, min(25, len(candidatos))))
			falhas = min(self.rnd.choices([0, 1, 2], [85, 10, 5])[0], len(selecionados) - 1)
			usuario = self.rnd.choice(self.usuarios[sigla])
			self.tabelas["acoes_lote"].append({"idLote": self._novo_id("LOT"), "siglaSetor": sigla,
				"idUsuario": usuario["idUsuario"], "nomeUsuario": usuario["nome"], "tipoAcao": tipo,
				"parametros": self._parametros_lote(tipo, sigla),
				"dataHora": self.agora - timedelta(minutes=self.rnd.randint(10, 60 * 24 * 60)),
				"qtdExpedientes": len(selecionados), "qtdSucesso": len(selecionados) - falhas, "qtdFalhas": falhas,
				"resultado": "SUCESSO" if falhas == 0 else "PARCIAL",
				"gerenciadores": ";".join(sorted({expediente["gerenciador"] for expediente in selecionados})),
				"idsExpedientes": ";".join(expediente["idExpediente"] for expediente in selecionados)})

	# ---------- notificações ----------

	def _notificar(self, id_usuario, expediente, tipo, severidade, titulo, mensagem, data_hora):
		data_hora = min(data_hora, self.agora - timedelta(minutes=1))
		antiga = self.agora - data_hora > timedelta(days=3)
		self.tabelas["notificacoes"].append({"idNotificacao": None, "idUsuario": id_usuario,
			"siglaSetor": expediente["siglaSetor"], "idExpediente": expediente["idExpediente"],
			"etiqueta": expediente["etiqueta"], "gerenciador": expediente["gerenciador"],
			"tipoNotificacao": tipo, "severidade": severidade, "titulo": titulo, "mensagem": mensagem,
			"dataHora": data_hora, "lida": self.rnd.random() < (0.85 if antiga else 0.3),
			"link": f"/expedientes/{expediente['idExpediente']}"})

	def _notificacoes_do_expediente(self, expediente):
		sigla = expediente["siglaSetor"]
		etiqueta = expediente["etiqueta"]
		responsavel = expediente["idResponsavel"]
		data_prazo = expediente["dataPrazo"]
		if expediente["caixa"] == "A_RECEBER":
			severidade = "ATENCAO" if expediente["urgente"] else "INFO"
			for id_usuario in {self.usuarios[sigla][0]["idUsuario"], self._chefia(sigla)["idUsuario"]}:
				self._notificar(id_usuario, expediente, "NOVO_EXPEDIENTE", severidade, "Novo expediente a receber",
					f"{etiqueta} ({expediente['descricaoClasse']}) chegou de {expediente['setorOrigem']}.",
					expediente["dataChegada"])
		if expediente["novaIntimacao"]:
			self._notificar(responsavel, expediente, "NOVA_INTIMACAO", "ATENCAO", "Nova intimação",
				f"Nova intimação no processo {etiqueta}.", expediente["dataRecebimento"] or expediente["dataChegada"])
		if expediente["requerAcao"]:
			self._notificacoes_de_prazo(expediente, responsavel, etiqueta, data_prazo)
		parado = (self.agora - expediente["dataUltimaMovimentacao"]).days
		if expediente["caixa"] == "ENVIADO_NAO_RECEBIDO" and parado >= 5:
			self._notificar(responsavel, expediente, "ENVIO_PENDENTE", "ATENCAO", "Envio ainda não recebido",
				f"{etiqueta} foi enviado a {expediente['setorDestino']} há {parado} dias e não foi recebido.",
				as_sete_horas(expediente["dataUltimaMovimentacao"].date() + timedelta(days=5)))

	def _notificacoes_de_prazo(self, expediente, responsavel, etiqueta, data_prazo):
		status = expediente["statusPrazo"]
		data_formatada = f"{data_prazo:%d/%m/%Y}"
		if status == "VENCIDO":
			self._notificar(responsavel, expediente, "PRAZO_VENCIDO", "CRITICO", "Prazo vencido",
				f"O prazo de {etiqueta} venceu em {data_formatada}.", as_sete_horas(data_prazo + timedelta(days=1)))
		elif status == "VENCE_HOJE":
			self._notificar(responsavel, expediente, "PRAZO_VENCE_HOJE", "CRITICO", "Prazo vence hoje",
				f"O prazo de {etiqueta} vence hoje.", as_sete_horas(self.hoje))
		elif status in ("CRITICO", "ATENCAO"):
			antecedencia = 3 if status == "CRITICO" else 7
			self._notificar(responsavel, expediente, "PRAZO_PROXIMO", "ATENCAO" if status == "CRITICO" else "INFO",
				"Prazo próximo do vencimento",
				f"O prazo de {etiqueta} vence em {expediente['diasRestantes']} dia(s) ({data_formatada}).",
				as_sete_horas(data_prazo - timedelta(days=antecedencia)))

	def _gerar_notificacoes(self):
		expedientes = {expediente["idExpediente"]: expediente for expediente in self.tabelas["expedientes"]}
		for expediente in expedientes.values():
			if expediente["caixa"] != "BAIXADO":
				self._notificacoes_do_expediente(expediente)
		for designacao in self.tabelas["designacoes"]:
			if designacao["situacao"] != "ATIVA":
				continue
			expediente = expedientes[designacao["idExpediente"]]
			self._notificar(designacao["idUsuarioDesignado"], expediente, "DESIGNACAO", "INFO",
				"Expediente designado a você",
				f"{designacao['nomeDesignador']} designou {expediente['etiqueta']} a você.", designacao["dataDesignacao"])
			if designacao["statusDevolucao"] == "VENCIDA":
				data = as_sete_horas(designacao["prazoDevolucao"] + timedelta(days=1))
				for id_usuario in {designacao["idUsuarioDesignado"], designacao["idUsuarioDesignador"]}:
					self._notificar(id_usuario, expediente, "DEVOLUCAO_VENCIDA", "ATENCAO",
						"Devolução de designação vencida",
						f"A devolução de {expediente['etiqueta']} venceu em {designacao['prazoDevolucao']:%d/%m/%Y}.", data)
		limite = self.agora - timedelta(days=30)
		for movimentacao in self.tabelas["movimentacoes"]:
			expediente = expedientes[movimentacao["idExpediente"]]
			relevante = (movimentacao["tipoMovimentacao"] in TIPOS_ALTERACAO and movimentacao["dataHora"] >= limite
				and expediente["caixa"] != "BAIXADO" and movimentacao["idUsuario"] != expediente["idResponsavel"])
			if relevante:
				self._notificar(expediente["idResponsavel"], expediente, "ALTERACAO", "INFO", "Alteração em expediente",
					f"{movimentacao['nomeUsuario']}: {movimentacao['descricao']} em {expediente['etiqueta']}.",
					movimentacao["dataHora"])
		self.tabelas["notificacoes"].sort(key=lambda notificacao: notificacao["dataHora"])
		for notificacao in self.tabelas["notificacoes"]:
			notificacao["idNotificacao"] = self._novo_id("NOT")

	# ---------- personalização ----------

	def _gerar_personalizacao(self):
		for usuario in self.tabelas["usuarios"]:
			sigla = usuario["siglaSetor"]
			for contexto in ["PAINEL_UNIFICADO"] + gerenciadores_do_setor(sigla):
				extras = self.rnd.sample(COLUNAS_PAINEL[1:], k=self.rnd.randint(6, 10))
				colunas = ["etiqueta"] + sorted(extras, key=COLUNAS_PAINEL.index)
				self.tabelas["preferencias_usuario"].append({"idUsuario": usuario["idUsuario"], "siglaSetor": sigla,
					"contexto": contexto, "colunasVisiveis": ";".join(colunas),
					"ordenacaoCampo": self.rnd.choice(["dataPrazo", "pontuacaoPrioridade", "dataChegada", "tempoParadoDias"]),
					"ordenacaoDirecao": self.rnd.choice(["asc", "desc"]), "itensPorPagina": self.rnd.choice([25, 50, 100]),
					"caixaInicial": self.rnd.choice(["A_RECEBER", "NO_SETOR"]),
					"agruparPor": self.rnd.choice(["NENHUM", "gerenciador", "statusPrazo", "nomeResponsavel", "prioridade"]),
					"densidade": self.rnd.choice(["COMPACTA", "CONFORTAVEL"]), "tema": self.rnd.choice(["CLARO", "ESCURO", "AUTO"]),
					"notificarPorEmail": self.rnd.random() < 0.5, "antecedenciaAlertaPrazoDias": self.rnd.choice([3, 5, 7])})
			self._gerar_filtros(usuario)

	def _gerar_filtros(self, usuario):
		modelos = self.rnd.sample(FILTROS_MODELO, k=self.rnd.randint(2, 3))
		for indice, (nome, criterios, ordenacao) in enumerate(modelos):
			criterios_usuario = {chave: usuario["idUsuario"] if valor == "$USUARIO" else valor
				for chave, valor in criterios.items()}
			self.tabelas["filtros_salvos"].append({"idFiltro": self._novo_id("FIL"), "idUsuario": usuario["idUsuario"],
				"siglaSetor": usuario["siglaSetor"], "nome": nome,
				"criterios": json.dumps(criterios_usuario, ensure_ascii=False), "ordenacao": ordenacao,
				"padrao": indice == 0, "compartilhadoComSetor": self.rnd.random() < 0.3,
				"dataCriacao": self.agora - timedelta(days=self.rnd.randint(1, 120))})

	# ---------- indicadores ----------

	def _gerar_contadores(self):
		designacoes = Counter((designacao["siglaSetor"], designacao["gerenciador"])
			for designacao in self.tabelas["designacoes"] if designacao["situacao"] == "ATIVA")
		favoritos = Counter((favorito["siglaSetor"], favorito["gerenciador"]) for favorito in self.tabelas["favoritos"])
		limite_baixa = self.agora - timedelta(days=30)
		for sigla in SETORES:
			gerenciadores = gerenciadores_do_setor(sigla)
			for grupo in gerenciadores + ["TODOS"]:
				alvo = gerenciadores if grupo == "TODOS" else [grupo]
				todos = [e for e in self._expedientes_do_setor(sigla) if e["gerenciador"] in alvo]
				ativos = [e for e in todos if e["caixa"] != "BAIXADO"]
				com_acao = [e for e in ativos if e["requerAcao"]]
				por_caixa = Counter(e["caixa"] for e in ativos)
				por_prazo = Counter(e["statusPrazo"] for e in com_acao)
				self.tabelas["contadores"].append({"siglaSetor": sigla, "gerenciador": grupo,
					"aReceber": por_caixa["A_RECEBER"], "noSetor": por_caixa["NO_SETOR"],
					"enviadosNaoRecebidos": por_caixa["ENVIADO_NAO_RECEBIDO"],
					"designados": sum(designacoes[(sigla, g)] for g in alvo),
					"favoritos": sum(favoritos[(sigla, g)] for g in alvo),
					"vencidos": por_prazo["VENCIDO"], "venceHoje": por_prazo["VENCE_HOJE"],
					"criticos": por_prazo["CRITICO"], "atencao": por_prazo["ATENCAO"],
					"urgentes": sum(1 for e in com_acao if e["urgente"]),
					"prioridadeCritica": sum(1 for e in com_acao if e["prioridade"] == "CRITICA"),
					"novos24h": sum(1 for e in ativos if e["novo"]),
					"parados30dias": sum(1 for e in com_acao if e["tempoParadoDias"] > 30),
					"minutasPendentes": sum(e["qtdMinutasPendentes"] for e in ativos),
					"baixados30dias": sum(1 for e in todos
						if e["caixa"] == "BAIXADO" and e["dataUltimaMovimentacao"] >= limite_baixa)})

	def _gerar_estoque_diario(self):
		"""Série diária do estoque por setor/gerenciador, derivada das datas de chegada, recebimento e saída."""
		grupos = defaultdict(list)
		for expediente in self.tabelas["expedientes"]:
			recebimento = expediente["dataRecebimento"]
			saida = expediente["_saida"]
			grupos[(expediente["siglaSetor"], expediente["gerenciador"])].append((expediente["dataChegada"].date(),
				recebimento.date() if recebimento else None, saida.date() if saida else None, expediente["dataPrazo"]))
		inicio = self.hoje - timedelta(days=DIAS_INDICADORES - 1)
		for (sigla, gerenciador), datas in grupos.items():
			for deslocamento in range(DIAS_INDICADORES):
				dia = inicio + timedelta(days=deslocamento)
				linha = Counter()
				for chegada, recebimento, saida, data_prazo in datas:
					linha["entradas"] += chegada == dia
					linha["recebimentos"] += recebimento == dia
					linha["saidas"] += saida == dia
					a_receber = chegada <= dia and (recebimento is None or recebimento > dia)
					no_setor = recebimento is not None and recebimento <= dia and (saida is None or saida > dia)
					linha["aReceber"] += a_receber
					linha["noSetor"] += no_setor
					linha["vencidos"] += (a_receber or no_setor) and data_prazo < dia
				self.tabelas["estoque_diario"].append({"data": dia, "siglaSetor": sigla, "gerenciador": gerenciador,
					**{coluna: linha[coluna] for coluna in
						("entradas", "recebimentos", "saidas", "aReceber", "noSetor", "vencidos")}})

	def _gerar_produtividade(self):
		"""Ações por usuário/dia agregadas a partir do histórico de movimentações."""
		expedientes = {expediente["idExpediente"]: expediente for expediente in self.tabelas["expedientes"]}
		inicio = self.hoje - timedelta(days=DIAS_INDICADORES - 1)
		agregado = defaultdict(Counter)
		nomes = {}
		for movimentacao in self.tabelas["movimentacoes"]:
			dia = movimentacao["dataHora"].date()
			if movimentacao["idUsuario"] == "EXTERNO" or dia < inicio:
				continue
			chave = (dia, movimentacao["siglaSetor"], movimentacao["gerenciador"], movimentacao["idUsuario"])
			nomes[movimentacao["idUsuario"]] = movimentacao["nomeUsuario"]
			tipo = movimentacao["tipoMovimentacao"]
			agregado[chave][COLUNA_PRODUTIVIDADE[tipo]] += 1
			expediente = expedientes[movimentacao["idExpediente"]]
			if tipo in ("ENVIO_PELO_SETOR", "ARQUIVAMENTO") and expediente["caixa"] == "BAIXADO":
				no_prazo = expediente["statusPrazo"] == "CUMPRIDO"
				agregado[chave]["prazosCumpridosNoPrazo" if no_prazo else "prazosCumpridosComAtraso"] += 1
		colunas = list(COLUNA_PRODUTIVIDADE.values())
		for chave in sorted(agregado):
			dia, sigla, gerenciador, id_usuario = chave
			contagem = agregado[chave]
			self.tabelas["produtividade_diaria"].append({"data": dia, "siglaSetor": sigla, "gerenciador": gerenciador,
				"idUsuario": id_usuario, "nomeUsuario": nomes[id_usuario],
				**{coluna: contagem[coluna] for coluna in colunas},
				"prazosCumpridosNoPrazo": contagem["prazosCumpridosNoPrazo"],
				"prazosCumpridosComAtraso": contagem["prazosCumpridosComAtraso"],
				"totalAcoes": sum(contagem[coluna] for coluna in colunas)})

	# ---------- conteúdo auxiliar ----------

	def _gerar_noticias(self):
		for indice, (titulo, categoria, prioridade, destaque) in enumerate(NOTICIAS, start=1):
			inicio = self.agora - timedelta(days=self.rnd.randint(0, 10), hours=self.rnd.randint(0, 12))
			self.tabelas["noticias"].append({"idNoticia": indice, "titulo": titulo, "categoria": categoria,
				"conteudo": f"Texto fictício do informe '{titulo}'.", "prioridade": prioridade, "destaque": destaque,
				"dataInicioExibicao": inicio, "dataFimExibicao": (inicio + timedelta(days=30)).date()})

	def _gerar_catalogos(self):
		for dominio, codigos in CATALOGO_SIMPLES.items():
			for ordem, codigo in enumerate(codigos, start=1):
				descricao = DESCRICOES_POR_DOMINIO.get(dominio, {}).get(codigo) \
					or DESCRICOES.get(codigo, codigo.replace("_", " ").capitalize())
				self._catalogo(dominio, codigo, descricao, ordem)
		situacoes = sorted({expediente["situacao"] for expediente in self.tabelas["expedientes"]})
		for ordem, situacao in enumerate(situacoes, start=1):
			self._catalogo("SITUACAO", situacao, DESCRICOES.get(situacao, situacao.replace("_", " ").capitalize()), ordem)
		for gerenciador in GERENCIADORES:
			for ordem, (codigo, descricao) in enumerate(CLASSES[gerenciador], start=1):
				self._catalogo(f"CLASSE_{gerenciador}", codigo, descricao, ordem)
			for ordem, (assunto, _) in enumerate(ASSUNTOS[gerenciador], start=1):
				self._catalogo(f"ASSUNTO_{gerenciador}", f"A{ordem:02d}", assunto, ordem)
			temas = sorted({tema for _, tema in ASSUNTOS[gerenciador]})
			for ordem, tema in enumerate(temas, start=1):
				self._catalogo(f"TEMA_{gerenciador}", f"T{ordem:02d}", tema, ordem)

	def _catalogo(self, dominio, codigo, descricao, ordem):
		self.tabelas["catalogos"].append({"dominio": dominio, "codigo": codigo, "descricao": descricao,
			"ordem": ordem, "cor": CORES_POR_DOMINIO.get(dominio, {}).get(codigo) or CORES.get(codigo, COR_PADRAO)})


# ---------- exportação ----------

def serializar(valor):
	if isinstance(valor, datetime):
		return valor.isoformat(timespec="seconds")
	if isinstance(valor, date):
		return valor.isoformat()
	return valor


def valor_csv(valor):
	valor = serializar(valor)
	if valor is None:
		return ""
	if isinstance(valor, bool):
		return "true" if valor else "false"
	return str(valor)


def colunas_da_tabela(nome, linhas):
	if nome == "expedientes":
		return COLUNAS_EXPEDIENTE
	colunas = {}
	for linha in linhas:
		for coluna in linha:
			if not coluna.startswith("_"):
				colunas[coluna] = None
	return list(colunas)


def exportar_csv(tabelas, pasta):
	pasta.mkdir(parents=True, exist_ok=True)
	for nome, linhas in tabelas.items():
		colunas = colunas_da_tabela(nome, linhas)
		with (pasta / f"{nome}.csv").open("w", encoding="utf-8", newline="") as arquivo:
			escritor = csv.writer(arquivo)
			escritor.writerow(colunas)
			for linha in linhas:
				escritor.writerow([valor_csv(linha.get(coluna)) for coluna in colunas])
		print(f"  {nome}.csv: {len(linhas)} linhas")


# ---------- DynamoDB (single-table: PK/SK + GSI1 + GSI2) ----------

def _s(valor):
	return serializar(valor)


def chaves_expediente(linha):
	id_expediente = linha["idExpediente"]
	sigla = linha["siglaSetor"]
	abreviacao = GERENCIADORES[linha["gerenciador"]]
	if linha["caixa"] == "BAIXADO":
		gsi1 = f"HIST#{abreviacao}#{_s(linha['dataUltimaMovimentacao'])}#{id_expediente}"
		gsi2_pk = f"SETOR#{sigla}#HIST"
	else:
		gsi1 = f"ATIVO#{abreviacao}#{linha['caixa']}#{_s(linha['dataChegada'])}#{id_expediente}"
		gsi2_pk = f"SETOR#{sigla}"
	return {"PK": f"EXP#{id_expediente}", "SK": "META", "GSI1PK": f"SETOR#{sigla}", "GSI1SK": gsi1,
		"GSI2PK": gsi2_pk, "GSI2SK": f"PRAZO#{_s(linha['dataPrazo'])}#{100 - linha['pontuacaoPrioridade']:03d}#{id_expediente}"}


def chaves_movimentacao(linha):
	chaves = {"PK": f"EXP#{linha['idExpediente']}", "SK": f"MOV#{_s(linha['dataHora'])}#{linha['idMovimentacao']}"}
	if linha["idUsuario"] != "EXTERNO":
		chaves.update({"GSI1PK": f"USR#{linha['idUsuario']}", "GSI1SK": f"MOV#{_s(linha['dataHora'])}"})
	return chaves


CHAVES = {
	"setores": lambda l: {"PK": f"SETOR#{l['siglaSetor']}", "SK": "PERFIL"},
	"usuarios": lambda l: {"PK": f"USR#{l['idUsuario']}", "SK": "PERFIL", "GSI1PK": f"SETOR#{l['siglaSetor']}",
		"GSI1SK": f"USR#{l['idUsuario']}"},
	"expedientes": chaves_expediente,
	"movimentacoes": chaves_movimentacao,
	"prazos": lambda l: {"PK": f"EXP#{l['idExpediente']}", "SK": f"PRZ#{l['idPrazo']}"},
	"designacoes": lambda l: {"PK": f"EXP#{l['idExpediente']}", "SK": f"DES#{l['idDesignacao']}",
		"GSI1PK": f"USR#{l['idUsuarioDesignado']}",
		"GSI1SK": f"DES#{l['situacao']}#{_s(l['prazoDevolucao'])}#{l['idExpediente']}"},
	"anotacoes": lambda l: {"PK": f"EXP#{l['idExpediente']}", "SK": f"ANO#{_s(l['dataHora'])}#{l['idAnotacao']}"},
	"marcadores": lambda l: {"PK": f"SETOR#{l['siglaSetor']}", "SK": f"ROT#{l['gerenciador']}#{l['idRotulo']}"},
	"marcadores_expedientes": lambda l: {"PK": f"EXP#{l['idExpediente']}", "SK": f"ROT#{l['idRotulo']}",
		"GSI1PK": f"ROT#{l['idRotulo']}", "GSI1SK": f"{_s(l['dataInclusao'])}#{l['idExpediente']}"},
	"favoritos": lambda l: {"PK": f"SETOR#{l['siglaSetor']}", "SK": f"FAV#{l['gerenciador']}#{l['idExpediente']}"},
	"notificacoes": lambda l: {"PK": f"USR#{l['idUsuario']}", "SK": f"NOT#{_s(l['dataHora'])}#{l['idNotificacao']}"},
	"acoes_lote": lambda l: {"PK": f"USR#{l['idUsuario']}", "SK": f"LOTE#{_s(l['dataHora'])}#{l['idLote']}",
		"GSI1PK": f"SETOR#{l['siglaSetor']}", "GSI1SK": f"LOTE#{_s(l['dataHora'])}#{l['idLote']}"},
	"preferencias_usuario": lambda l: {"PK": f"USR#{l['idUsuario']}", "SK": f"PREF#{l['contexto']}"},
	"filtros_salvos": lambda l: {"PK": f"USR#{l['idUsuario']}", "SK": f"FILTRO#{l['idFiltro']}"},
	"contadores": lambda l: {"PK": f"SETOR#{l['siglaSetor']}", "SK": f"CONT#{l['gerenciador']}"},
	"estoque_diario": lambda l: {"PK": f"SETOR#{l['siglaSetor']}", "SK": f"EST#{l['gerenciador']}#{_s(l['data'])}"},
	"produtividade_diaria": lambda l: {"PK": f"SETOR#{l['siglaSetor']}",
		"SK": f"PROD#{_s(l['data'])}#{l['gerenciador']}#{l['idUsuario']}", "GSI1PK": f"USR#{l['idUsuario']}",
		"GSI1SK": f"PROD#{_s(l['data'])}#{l['gerenciador']}"},
	"noticias": lambda l: {"PK": "NOTICIA", "SK": f"{l['prioridade']:02d}#{_s(l['dataInicioExibicao'])}#{l['idNoticia']}"},
	"catalogos": lambda l: {"PK": f"CATALOGO#{l['dominio']}", "SK": f"{l['ordem']:03d}#{l['codigo']}"},
}


def montar_itens_dynamo(tabelas):
	itens = []
	for nome, linhas in tabelas.items():
		for linha in linhas:
			item = CHAVES[nome](linha)
			item["entidade"] = nome
			for coluna, valor in linha.items():
				if not coluna.startswith("_") and valor is not None:
					item[coluna] = serializar(valor)
			itens.append(item)
	return itens


def para_dynamodb_json(valor):
	if isinstance(valor, bool):
		return {"BOOL": valor}
	if isinstance(valor, (int, float)):
		return {"N": str(valor)}
	return {"S": str(valor)}


def exportar_dynamodb_json(itens, caminho):
	"""Formato 'DynamoDB JSON' (uma linha por item) aceito pelo Import from S3, preservando tipos."""
	caminho.parent.mkdir(parents=True, exist_ok=True)
	with caminho.open("w", encoding="utf-8") as arquivo:
		for item in itens:
			linha = {"Item": {chave: para_dynamodb_json(valor) for chave, valor in item.items()}}
			arquivo.write(json.dumps(linha, ensure_ascii=False) + "\n")
	print(f"  {caminho.name}: {len(itens)} itens")


def criar_tabela(dynamodb, nome_tabela):
	atributos = ["PK", "SK", "GSI1PK", "GSI1SK", "GSI2PK", "GSI2SK"]
	indices = [{"IndexName": nome, "Projection": {"ProjectionType": "ALL"},
		"KeySchema": [{"AttributeName": f"{nome}PK", "KeyType": "HASH"}, {"AttributeName": f"{nome}SK", "KeyType": "RANGE"}]}
		for nome in ("GSI1", "GSI2")]
	tabela = dynamodb.create_table(TableName=nome_tabela, BillingMode="PAY_PER_REQUEST",
		KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
		AttributeDefinitions=[{"AttributeName": nome, "AttributeType": "S"} for nome in atributos],
		GlobalSecondaryIndexes=indices)
	tabela.wait_until_exists()
	print(f"Tabela {nome_tabela} criada.")


def carregar(itens, nome_tabela, regiao, deve_criar_tabela):
	import boto3  # importado só aqui: a geração dos arquivos não depende do boto3

	dynamodb = boto3.resource("dynamodb", region_name=regiao)
	if deve_criar_tabela:
		criar_tabela(dynamodb, nome_tabela)
	with dynamodb.Table(nome_tabela).batch_writer(overwrite_by_pkeys=["PK", "SK"]) as lote:
		for item in itens:
			lote.put_item(Item=item)
	print(f"{len(itens)} itens gravados em {nome_tabela} ({regiao}).")


def momento_referencia(texto):
	if texto == "agora":
		return datetime.now(FUSO).replace(microsecond=0)
	return datetime.combine(date.fromisoformat(texto), time(17, 0), tzinfo=FUSO)


def main():
	parser = argparse.ArgumentParser(description="Base sintética dos gerenciadores de expedientes")
	parser.add_argument("--saida", default=str(Path(__file__).parent / "saida"))
	parser.add_argument("--data-referencia", default=DATA_EVENTO,
		help=f"AAAA-MM-DD usado como 'hoje' às 17h, ou 'agora' (padrão: {DATA_EVENTO}, dia do evento)")
	parser.add_argument("--carregar", action="store_true", help="grava os itens no DynamoDB")
	parser.add_argument("--criar-tabela", action="store_true", help="cria a tabela (com GSI1 e GSI2) antes de carregar")
	parser.add_argument("--tabela", default="Expedientes")
	parser.add_argument("--regiao", default="us-east-1")
	args = parser.parse_args()

	agora = momento_referencia(args.data_referencia)
	tabelas = GeradorBase(SEMENTE, agora).gerar()
	pasta = Path(args.saida)
	print(f"Referência: {agora.isoformat()}\nCSVs em {pasta / 'csv'}:")
	exportar_csv(tabelas, pasta / "csv")
	itens = montar_itens_dynamo(tabelas)
	print(f"DynamoDB JSON em {pasta / 'dynamodb'}:")
	exportar_dynamodb_json(itens, pasta / "dynamodb" / "itens.json")
	if args.carregar:
		carregar(itens, args.tabela, args.regiao, args.criar_tabela)


if __name__ == "__main__":
	main()
