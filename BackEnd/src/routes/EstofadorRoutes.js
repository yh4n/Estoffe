const express = require('express');
const router = express.Router();

// Importa a conexão com o banco de dados
const db = require("../config/database");

// Middleware de autenticação específico para o Router do Estofador
function verificarAutenticacao(tiposPermitidos) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    if (!usuario || !usuario.token) {
      return res.redirect("/login");
    }
    try {
      const jwt = require("jsonwebtoken");
      const SECRET_KEY = "EstoffeMoveisPlanejados2026";
      const decodificado = jwt.verify(usuario.token, SECRET_KEY);

      if (tiposPermitidos.includes(decodificado.tipo)) {
        return next();
      } else {
        return res.status(403).send("Acesso negado: Você não tem permissão para ver esta página.");
      }
    } catch (error) {
      req.session.destroy();
      return res.redirect("/login");
    }
  };
}

// ==========================================
// ROTAS DO ESTOFADOR (OFICINA)
// ==========================================

// Rota Principal Dinâmica do Estofador
router.get("/estofador-dashboard", verificarAutenticacao(["estofador"]), async (req, res) => {
  if (req.session.usuario.tipo !== "estofador") {
    return res.redirect("/login");
  }

  const idEstofador = req.session.usuario.codUsuario;

  try {
    // 1. Contador de pedidos em produção
    const [[{ totalIniciados }]] = await db.query(
      "SELECT COUNT(*) AS totalIniciados FROM pedido WHERE codEstofador = ? AND status = 'Em Produção'",
      [idEstofador],
    );

    // 2. Contador de pedidos concluídos/entregues
    const [[{ totalConcluidos }]] = await db.query(
      "SELECT COUNT(*) AS totalConcluidos FROM pedido WHERE codEstofador = ? AND status IN ('Pronto', 'Entregue')",
      [idEstofador],
    );

    // 3. Contador de pedidos cancelados
    const [[{ totalCancelados }]] = await db.query(
      "SELECT COUNT(*) AS totalCancelados FROM pedido WHERE codEstofador = ? AND status = 'Cancelado'",
      [idEstofador],
    );

    // 4. Lista de ordens vinculadas a este estofador
    const [ordens] = await db.query(
      `
      SELECT 
          p.codPedido,
          u_cli.nome AS nomeCliente,
          p.dataPedido,
          p.status
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u_cli ON c.codUsuario = u_cli.codUsuario
      WHERE p.codEstofador = ?
      ORDER BY p.codPedido DESC
    `,
      [idEstofador],
    );

    // Renderiza a página passando os indicadores reais buscados no banco
    res.render("estofador/estofador-dashboard", {
      usuario: req.session.usuario,
      indicadores: {
        iniciados: totalIniciados,
        concluidos: totalConcluidos,
        cancelados: totalCancelados,
      },
      ordens: ordens,
    });
  } catch (error) {
    console.error("Erro ao carregar painel do estofador:", error);
    res.status(500).send("Erro interno ao carregar o painel.");
  }
});

// Redirecionamento preventivo caso o sistema tente acessar a URL com a barra "/estofador/dashboard"
router.get("/estofador/dashboard", verificarAutenticacao(["estofador"]), (req, res) => {
  res.redirect("/estofador-dashboard");
});

module.exports = router;