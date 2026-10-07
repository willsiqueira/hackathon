---
inclusion: always
---

# Product: Painel unificado de expedientes (Único) - Hackathon MPF & AWS 2026

Sources of truth (read them before writing specs):
- #[[file:docs/instrucoes-hackathon.md]]
- #[[file:docs/caso-de-uso-hackathon.md]]
- Data dictionary: docs/README.md and docs/seed/gerar_seed.py

## Language
- All UI text, specs (requirements/design/tasks) and user-facing messages in Brazilian Portuguese (pt-BR).
- Code identifiers follow the dataset field names (camelCase in Portuguese, e.g. `statusPrazo`, `pontuacaoPrioridade`).

## Users
MEMBRO (titular), CHEFE (chefe de gabinete), SERVIDOR (assessor). Fictitious users come from `usuarios.csv`.

## Scope priority
- Essential: RF01, RF02, RF03, RF06, RF07, RF18
- Desired: RF04, RF05, RF09, RF11, RF12, RF13, RF15
- If time allows: RF08, RF10, RF14, RF16, RF17, RF19
- Demo path: login -> tela inicial (contadores + próximos prazos) -> painel com filtros e selos de prazo -> abrir processo e ver histórico -> receber/designar em lote.

## Business rules (must be implemented as pure, unit-tested functions)
- RN1 statusPrazo from diasRestantes: <0 VENCIDO; 0 VENCE_HOJE; 1-3 CRITICO; 4-7 ATENCAO; >7 NO_PRAZO.
- RN2 pontuação: prazo (50/45/35/20/5) + urgente 30 + novaIntimacao 10 + parado >30 dias 10 + aguardando assinatura 5. ENVIADO_NAO_RECEBIDO counts half. Faixas: CRITICA >=60, ALTA >=35, MEDIA >=20, else BAIXA.
- RN3 queue order: dataPrazo asc, then pontuação desc (GSI2).
- RN4 receber only from A_RECEBER; designar/movimentar/arquivar only from NO_SETOR. Ignored items show the reason in the preview.
- RN5 never archive with qtdMinutasPendentes > 0.
- RN6 user only sees own setor; sigiloso content only visible to SERVIDOR if responsável. Enforced in the backend.
- RN7 BAIXADO is history: dashboards only, never in painel or contadores.
- Reference date: 2026-10-07T17:00-03:00.

## Out of scope
Integration with Único or internal databases, real signing/protocol, official documents, real data.
