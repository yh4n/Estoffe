const express = require("express");
const crypto = require("crypto");
const db = require("../config/database");
const transportador = require("../config/mailer");

const router = express.Router();

function tokenWebhookValido(tokenRecebido, tokenEsperado) {
  if (!tokenRecebido || !tokenEsperado) return false;

  const recebido = Buffer.from(tokenRecebido);
  const esperado = Buffer.from(tokenEsperado);
  return (
    recebido.length === esperado.length &&
    crypto.timingSafeEqual(recebido, esperado)
  );
}

// Configure este caminho como webhook no painel Asaas.
router.post("/webhooks/asaas", async (req, res) => {
  const tokenEsperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!tokenEsperado) {
    console.error("ASAAS_WEBHOOK_TOKEN não está configurado.");
    return res.status(500).json({ erro: "Webhook não configurado." });
  }

  if (!tokenWebhookValido(req.get("asaas-access-token"), tokenEsperado)) {
    return res.status(401).json({ erro: "Token do webhook inválido." });
  }

  const { event, payment } = req.body || {};
  if (!new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]).has(event)) {
    return res.status(200).json({ recebido: true, ignorado: true });
  }

  const codPedido = Number(payment?.externalReference);
  if (!Number.isSafeInteger(codPedido) || codPedido <= 0) {
    return res.status(400).json({ erro: "Referência de pedido inválida." });
  }

  const connection = await db.getConnection();
  let pedidoParaEmail;

  try {
    await db.schemaAgendaPronto;
    await connection.beginTransaction();

    const [pedidos] = await connection.query(
      `SELECT p.codPedido, p.valorTotal, p.status, p.statusOrcamento,
              u.nome, u.email
         FROM pedido p
         INNER JOIN cliente c ON c.codCliente = p.codCliente
         INNER JOIN usuario u ON u.codUsuario = c.codUsuario
        WHERE p.codPedido = ?
        FOR UPDATE`,
      [codPedido],
    );
    if (!pedidos.length) {
      await connection.rollback();
      return res.status(404).json({ erro: "Pedido não encontrado." });
    }

    const [pagamentos] = await connection.query(
      `SELECT codPagamento, estoqueBaixado, asaasPaymentId
         FROM pagamento
        WHERE codPedido = ?
        ORDER BY codPagamento DESC
        LIMIT 1
        FOR UPDATE`,
      [codPedido],
    );
    if (!pagamentos.length) {
      await connection.rollback();
      return res.status(404).json({ erro: "Pagamento não encontrado." });
    }

    const pedido = pedidos[0];
    const pagamento = pagamentos[0];
    if (
      pedido.statusOrcamento === "Pendente" ||
      pedido.statusOrcamento === "Recusado"
    ) {
      await connection.rollback();
      return res.status(409).json({
        erro: "O orçamento precisa ser aprovado antes da confirmação do pagamento.",
      });
    }
    if (
      pagamento.asaasPaymentId &&
      payment?.id &&
      String(pagamento.asaasPaymentId) !== String(payment.id)
    ) {
      await connection.rollback();
      return res
        .status(409)
        .json({ erro: "Pagamento não corresponde ao pedido." });
    }
    const valorRecebido = Number(payment?.value);
    if (
      Number.isFinite(valorRecebido) &&
      Math.round(valorRecebido * 100) !==
        Math.round(Number(pedido.valorTotal) * 100)
    ) {
      await connection.rollback();
      return res
        .status(409)
        .json({ erro: "Valor recebido não corresponde ao pedido." });
    }

    if (!pagamento.estoqueBaixado) {
      const [itens] = await connection.query(
        `SELECT ip.codProduto, SUM(ip.quantidade) AS quantidade, p.sob_medida
           FROM itempedido ip
           INNER JOIN produto p ON p.codProduto = ip.codProduto
          WHERE ip.codPedido = ?
          GROUP BY ip.codProduto, p.sob_medida
          ORDER BY ip.codProduto`,
        [codPedido],
      );
      if (!itens.length) {
        throw new Error("O pedido não possui itens para baixar do estoque.");
      }

      for (const item of itens) {
        if (Number(item.sob_medida) === 1) continue;

        const [resultado] = await connection.query(
          `UPDATE produto p
           INNER JOIN estoque_produtos ep ON ep.codProduto = p.codProduto
              SET p.quantidadeEstoque = p.quantidadeEstoque - ?,
                  ep.quantidade_disponivel = ep.quantidade_disponivel - ?
            WHERE p.codProduto = ?
              AND p.quantidadeEstoque >= ?
              AND ep.quantidade_disponivel >= ?`,
          [
            item.quantidade,
            item.quantidade,
            item.codProduto,
            item.quantidade,
            item.quantidade,
          ],
        );
        if (resultado.affectedRows === 0) {
          const erroEstoque = new Error(
            `Estoque insuficiente para o produto ${item.codProduto}.`,
          );
          erroEstoque.code = "ESTOQUE_INSUFICIENTE";
          throw erroEstoque;
        }
      }

      await connection.query(
        "UPDATE pagamento SET status = 'Aprovado', estoqueBaixado = 1 WHERE codPagamento = ?",
        [pagamento.codPagamento],
      );
      await connection.query(
        "UPDATE pedido SET status = 'Pago' WHERE codPedido = ?",
        [codPedido],
      );
      pedidoParaEmail = pedido;
    } else {
      await connection.query(
        "UPDATE pagamento SET status = 'Aprovado' WHERE codPagamento = ?",
        [pagamento.codPagamento],
      );
    }

    await connection.commit();

    if (pedidoParaEmail?.email) {
      try {
        await transportador.sendMail({
          from: process.env.EMAIL_USER,
          to: pedidoParaEmail.email,
          subject: `Pagamento confirmado - Pedido #${pedidoParaEmail.codPedido}`,
          text: `Olá, ${pedidoParaEmail.nome}. Confirmamos o pagamento do pedido #${pedidoParaEmail.codPedido}, no valor de R$ ${Number(pedidoParaEmail.valorTotal).toFixed(2)}. Obrigado por comprar na Estoffe!`,
        });
      } catch (erroEmail) {
        console.error("Erro ao enviar confirmação de pagamento:", erroEmail);
      }
    }

    return res.status(200).json({ recebido: true });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ESTOQUE_INSUFICIENTE") {
      console.error(
        "Pagamento recebido sem estoque suficiente:",
        error.message,
      );
      return res.status(409).json({ erro: error.message });
    }
    console.error("Erro ao processar webhook do Asaas:", error);
    return res.status(500).json({ erro: "Erro ao processar o pagamento." });
  } finally {
    connection.release();
  }
});

module.exports = router;
