// Erros de negócio com o status HTTP correspondente.

export class ErroNegocio extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export class ErroValidacao extends ErroNegocio {
  constructor(mensagem: string) {
    super(400, 'VALIDACAO', mensagem);
  }
}

export class ErroNaoAutenticado extends ErroNegocio {
  constructor(mensagem = 'Autenticação necessária.') {
    super(401, 'NAO_AUTENTICADO', mensagem);
  }
}

export class ErroProibido extends ErroNegocio {
  constructor(mensagem = 'Acesso negado.') {
    super(403, 'ACESSO_NEGADO', mensagem);
  }
}

export class ErroNaoEncontrado extends ErroNegocio {
  constructor(mensagem = 'Não encontrado.') {
    super(404, 'NAO_ENCONTRADO', mensagem);
  }
}

export class ErroConflito extends ErroNegocio {
  constructor(mensagem: string) {
    super(409, 'CONFLITO', mensagem);
  }
}
