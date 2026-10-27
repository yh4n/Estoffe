const express = require("express");
const router = express.Router();
const db = require("../config/database");
const { verificarAutenticacao } = require("../config/middleware/auth");

router.get(
  "/notificacoes",
  verificarAutenticacao(["admin", "cliente"]),
  async (req, res) => {
    try {
      await db.schemaNotificacoesPronto;
      const codUsuario = req.session.usuario.codUsuario;
      const [notificacoes] = await db.query(
        `SELECT codNotificacao, tipo, titulo, mensagem, link, codPedido, lida, criadaEm
           FROM notificacao
          WHERE codUsuario = ?
          ORDER BY criadaEm DESC, codNotificacao DESC
          LIMIT 100`,
        [codUsuario],
      );
      res.render("notificacoes", {
        usuario: req.session.usuario,
        notificacoes,
      });
    } catch (error) {
      console.error("Erro ao carregar notificações:", error);
      res.status(500).send("Não foi possível carregar suas notificações.");
    }
  },
);

router.post(
  "/notificacoes/:id/lida",
  verificarAutenticacao(["admin", "cliente"]),
  async (req, res) => {
    const codNotificacao = Number(req.params.id);
    if (!Number.isSafeInteger(codNotificacao) || codNotificacao <= 0) {
      return res.status(400).send("Notificação inválida.");
    }
    try {
      await db.schemaNotificacoesPronto;
      await db.query(
        "UPDATE notificacao SET lida = 1 WHERE codNotificacao = ? AND codUsuario = ?",
        [codNotificacao, req.session.usuario.codUsuario],
      );
      res.redirect("/notificacoes");
    } catch (error) {
      console.error("Erro ao marcar notificação como lida:", error);
      res.status(500).send("Não foi possível atualizar a notificação.");
    }
  },
);

router.post(
  "/notificacoes/lidas",
  verificarAutenticacao(["admin", "cliente"]),
  async (req, res) => {
    try {
      await db.schemaNotificacoesPronto;
      await db.query(
        "UPDATE notificacao SET lida = 1 WHERE codUsuario = ? AND lida = 0",
        [req.session.usuario.codUsuario],
      );
      res.redirect("/notificacoes");
    } catch (error) {
      console.error("Erro ao marcar notificações como lidas:", error);
      res.status(500).send("Não foi possível atualizar suas notificações.");
    }
  },
);

module.exports = router;
