const db = require("../config/database");

async function criarNotificacao(codUsuario, notificacao) {
  await db.schemaNotificacoesPronto;
  await db.query(
    `INSERT INTO notificacao (codUsuario, tipo, titulo, mensagem, link, codPedido)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      codUsuario,
      notificacao.tipo,
      String(notificacao.titulo).slice(0, 120),
      String(notificacao.mensagem).slice(0, 1000),
      notificacao.link || null,
      notificacao.codPedido || null,
    ],
  );
}

async function notificarClientePedido(codPedido, titulo, mensagem) {
  await db.schemaNotificacoesPronto;
  const [clientes] = await db.query(
    `SELECT c.codUsuario
       FROM pedido p
       INNER JOIN cliente c ON c.codCliente = p.codCliente
      WHERE p.codPedido = ?`,
    [codPedido],
  );
  if (!clientes.length) return false;

  await criarNotificacao(clientes[0].codUsuario, {
    tipo: "pedido",
    titulo,
    mensagem,
    link: "/client-dashboard#pedidos",
    codPedido,
  });
  return true;
}

async function notificarClientes(titulo, mensagem) {
  await db.schemaNotificacoesPronto;
  const [resultado] = await db.query(
    `INSERT INTO notificacao (codUsuario, tipo, titulo, mensagem, link)
     SELECT codUsuario, 'oferta', ?, ?, '/produtos'
       FROM usuario
      WHERE tipo = 'cliente'`,
    [titulo, mensagem],
  );
  return resultado.affectedRows;
}

module.exports = {
  criarNotificacao,
  notificarClientePedido,
  notificarClientes,
};
