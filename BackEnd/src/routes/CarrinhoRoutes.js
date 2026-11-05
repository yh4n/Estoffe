const express = require("express");
const router = express.Router();

// Importa a conexão com o banco de dados
const db = require("../config/database");

// Importa middleware centralizado de autenticação
const { verificarAutenticacao } = require("../config/middleware/auth");

// ==========================================
// FUNÇÃO AUXILIAR: Busca o codCliente vinculado ao usuário logado
// ==========================================
async function buscarCodCliente(codUsuario) {
  const [clientes] = await db.query(
    "SELECT codCliente FROM cliente WHERE codUsuario = ?",
    [codUsuario],
  );
  return clientes.length > 0 ? clientes[0].codCliente : null;
}

async function atualizarCartCount(req, codCliente) {
  const [[{ total } = { total: 0 }]] = await db.query(
    "SELECT COALESCE(SUM(quantidade), 0) AS total FROM carrinho WHERE codCliente = ?",
    [codCliente],
  );
  req.session.cartCount = Number(total);
}

async function buscarCodigoPromocional(codigo) {
  if (!codigo) return null;
  const [codigos] = await db.query(
    `SELECT codigo, percentual, frete_gratis
       FROM codigo_promocional
      WHERE codigo = ? AND ativo = 1
        AND (validade IS NULL OR validade >= CURDATE())
      LIMIT 1`,
    [String(codigo).trim().toUpperCase()],
  );
  return codigos[0] || null;
}

function normalizarCep(cep, endereco = "") {
  const enderecoSeguro = String(endereco || "");
  return String(
    cep || enderecoSeguro.match(/\b\d{5}-?\d{3}\b/)?.[0] || "",
  ).replace(/\D/g, "");
}

async function buscarFrete(cep, endereco) {
  const cepNormalizado = normalizarCep(cep, endereco);
  if (cepNormalizado.length !== 8) return null;
  const [faixas] = await db.query(
    `SELECT valor, prazo_dias
       FROM frete_faixa_cep
      WHERE ativo = 1 AND cep_inicio <= ? AND cep_fim >= ?
      ORDER BY (cep_fim - cep_inicio) ASC
      LIMIT 1`,
    [cepNormalizado, cepNormalizado],
  );
  return faixas[0] || null;
}

// ==========================================
// FUNÇÃO AUXILIAR: Monta a URL de retorno preservando a categoria ativa
// ==========================================
function montarRedirecionamento(req) {
  // Prioridade 1: campo oculto "categoria" enviado junto do formulário
  // (garante o retorno correto mesmo se o Referer não estiver disponível)
  if (req.body && req.body.categoria) {
    return `/produtos?categoria=${encodeURIComponent(req.body.categoria)}`;
  }

  // Prioridade 2: cabeçalho Referer (captura a URL de onde o form foi enviado,
  // incluindo o ?categoria= caso o usuário estivesse filtrando os produtos)
  const referer = req.get("Referer");
  if (referer && referer.includes("/produtos")) {
    try {
      const url = new URL(referer);
      return url.pathname + url.search;
    } catch (err) {
      // Referer malformado: ignora e cai no fallback abaixo
    }
  }

  // Fallback padrão
  return "/produtos";
}

// ==========================================
// GET /carrinho — Exibe o carrinho do cliente logado
// ==========================================
router.get(
  "/carrinho",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    try {
      const codCliente = await buscarCodCliente(req.session.usuario.codUsuario);

      if (!codCliente) {
        return res.status(404).send("Cliente não encontrado.");
      }

      const [[dadosCliente]] = await db.query(
        "SELECT cep, endereco FROM cliente WHERE codCliente = ?",
        [codCliente],
      );

      const [itens] = await db.query(
        `
      SELECT 
        c.codProduto,
        c.quantidade,
        p.nome,
        p.preco,
        p.preco_promocional,
        p.promocao_ativa,
        p.imagem
      FROM carrinho c
      INNER JOIN produto p ON c.codProduto = p.codProduto
      WHERE c.codCliente = ?
      ORDER BY c.codProduto ASC
      `,
        [codCliente],
      );

      const [pedidosAPagar] = await db.query(
        `SELECT p.codPedido, p.dataPedido, p.valorTotal, p.valorFrete
           FROM pedido p
          WHERE p.codCliente = ?
            AND p.status = 'Aguardando Pagamento'
            AND NOT EXISTS (
              SELECT 1 FROM pagamento pg
               WHERE pg.codPedido = p.codPedido AND pg.status = 'Aprovado'
            )
          ORDER BY p.dataPedido DESC, p.codPedido DESC`,
        [codCliente],
      );

      // Calcula subtotal de cada item e o total geral do carrinho
      let subtotalProdutos = 0;
      const produtosNoCarrinho = itens.map((item) => {
        const precoOriginal = Number(item.preco);
        const precoPromocional = Number(item.preco_promocional);
        const preco =
          item.promocao_ativa &&
          Number.isFinite(precoPromocional) &&
          precoPromocional > 0 &&
          precoPromocional < precoOriginal
            ? precoPromocional
            : precoOriginal;
        const quantidade = Number(item.quantidade);
        const subtotal = preco * quantidade;
        subtotalProdutos += subtotal;

        return {
          codProduto: item.codProduto,
          nome: item.nome,
          preco: preco,
          precoOriginal,
          imagem: item.imagem,
          quantidade: quantidade,
          subtotal: subtotal,
        };
      });

      const codigoPromocional = await buscarCodigoPromocional(
        req.session.codigoPromocional?.codigo,
      );
      const descontoCodigo = codigoPromocional
        ? Number(
            (
              (subtotalProdutos * Number(codigoPromocional.percentual)) /
              100
            ).toFixed(2),
          )
        : 0;
      const frete = await buscarFrete(
        dadosCliente?.cep,
        dadosCliente?.endereco,
      );
      const freteGratis = Boolean(codigoPromocional?.frete_gratis);
      const valorFrete = frete && !freteGratis ? Number(frete.valor) : 0;
      const total = Number(
        (subtotalProdutos - descontoCodigo + valorFrete).toFixed(2),
      );

      if (!codigoPromocional && req.session.codigoPromocional) {
        delete req.session.codigoPromocional;
      }

      res.render("carrinho", {
        usuario: req.session.usuario,
        produtosNoCarrinho: produtosNoCarrinho,
        subtotalProdutos,
        descontoCodigo,
        codigoPromocional,
        frete,
        freteGratis,
        valorFrete,
        cepEntrega: normalizarCep(dadosCliente?.cep, dadosCliente?.endereco),
        codigoStatus: req.query.codigo,
        abaAtiva: req.query.aba === "pagar" ? "pagar" : "sacola",
        pedidosAPagar,
        total: total,
      });
    } catch (error) {
      console.error("Erro ao carregar o carrinho:", error);
      res.status(500).send("Erro interno ao carregar o carrinho.");
    }
  },
);

router.post(
  "/carrinho/codigo-promocional",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const acao = req.body.acao;
    if (acao === "remover") {
      delete req.session.codigoPromocional;
      return res.redirect("/carrinho?codigo=removido");
    }

    const codigo = String(req.body.codigo || "")
      .trim()
      .toUpperCase();
    if (!codigo) return res.redirect("/carrinho?codigo=invalido");

    try {
      const codigoPromocional = await buscarCodigoPromocional(codigo);
      if (!codigoPromocional) return res.redirect("/carrinho?codigo=invalido");
      req.session.codigoPromocional = {
        codigo: codigoPromocional.codigo,
        percentual: Number(codigoPromocional.percentual),
      };
      return res.redirect("/carrinho?codigo=aplicado");
    } catch (error) {
      console.error("Erro ao aplicar código promocional:", error);
      return res.redirect("/carrinho?codigo=erro");
    }
  },
);

// ==========================================
// POST /carrinho/add/:id — Adiciona um produto ao carrinho (ou soma +1)
// ==========================================
router.post(
  "/carrinho/add/:id",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const codProduto = req.params.id;

    try {
      const codCliente = await buscarCodCliente(req.session.usuario.codUsuario);

      if (!codCliente) {
        return res.status(404).send("Cliente não encontrado.");
      }

      // Confirma que o produto existe antes de inserir (evita lixo no carrinho)
      const [produtos] = await db.query(
        "SELECT codProduto FROM produto WHERE codProduto = ?",
        [codProduto],
      );

      if (produtos.length === 0) {
        return res.status(404).send("Produto não encontrado.");
      }

      // Verifica se o produto já está no carrinho deste cliente
      const [itemExistente] = await db.query(
        "SELECT quantidade FROM carrinho WHERE codCliente = ? AND codProduto = ?",
        [codCliente, codProduto],
      );

      if (itemExistente.length > 0) {
        await db.query(
          "UPDATE carrinho SET quantidade = quantidade + 1 WHERE codCliente = ? AND codProduto = ?",
          [codCliente, codProduto],
        );
      } else {
        // Novo item no carrinho
        await db.query(
          "INSERT INTO carrinho (codCliente, codProduto, quantidade) VALUES (?, ?, 1)",
          [codCliente, codProduto],
        );
      }

      await atualizarCartCount(req, codCliente);

      if (req.xhr || req.accepts(["html", "json"]) === "json") {
        return res.json({
          sucesso: true,
          cartCount: req.session.cartCount,
        });
      }

      return res.redirect(montarRedirecionamento(req));
    } catch (error) {
      console.error("Erro ao adicionar produto ao carrinho:", error);
      res.status(500).send("Erro interno ao adicionar o produto ao carrinho.");
    }
  },
);

router.post(
  "/carrinho/atualizar/:id",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const codProduto = req.params.id;
    const novaQuantidade = parseInt(req.body.quantidade, 10);

    try {
      const codCliente = await buscarCodCliente(req.session.usuario.codUsuario);

      if (!codCliente) {
        return res.status(404).send("Cliente não encontrado.");
      }

      // Quantidade zero ou inválida remove o item do carrinho
      if (!novaQuantidade || novaQuantidade <= 0) {
        await db.query(
          "DELETE FROM carrinho WHERE codCliente = ? AND codProduto = ?",
          [codCliente, codProduto],
        );
      } else {
        await db.query(
          "UPDATE carrinho SET quantidade = ? WHERE codCliente = ? AND codProduto = ?",
          [novaQuantidade, codCliente, codProduto],
        );
      }

      await atualizarCartCount(req, codCliente);

      return res.redirect("/carrinho");
    } catch (error) {
      console.error("Erro ao atualizar quantidade do carrinho:", error);
      res.status(500).send("Erro interno ao atualizar o carrinho.");
    }
  },
);

// ==========================================
// POST /carrinho/remover/:id — Remove um item do carrinho
// ==========================================
router.post(
  "/carrinho/remover/:id",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const codProduto = req.params.id;

    try {
      const codCliente = await buscarCodCliente(req.session.usuario.codUsuario);

      if (!codCliente) {
        return res.status(404).send("Cliente não encontrado.");
      }

      await db.query(
        "DELETE FROM carrinho WHERE codCliente = ? AND codProduto = ?",
        [codCliente, codProduto],
      );

      await atualizarCartCount(req, codCliente);

      return res.redirect("/carrinho");
    } catch (error) {
      console.error("Erro ao remover produto do carrinho:", error);
      res.status(500).send("Erro interno ao remover o produto do carrinho.");
    }
  },
);

module.exports = router;
