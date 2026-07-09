const express = require('express');
const router = express.Router();

// Importa a conexão com o banco de dados (mesmo caminho corrigido)
const db = require("../config/database");

// Middleware de autenticação específico para o Router do Admin
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
        return res.status(403).send("Acesso negado: Você não tem permissão.");
      }
    } catch (error) {
      req.session.destroy();
      return res.redirect("/login");
    }
  };
}

// Middleware extra local para garantir segurança dupla de Admin nas rotas
const apenasAdmin = (req, res, next) => {
  if (req.session.usuario && req.session.usuario.tipo === "admin") {
    return next();
  }
  return res.redirect("/client-dashboard");
};

// ==========================================
// ROTAS DO ADMINISTRADOR
// ==========================================

// Painel do Admin Principal
router.get("/admin/dashboard", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  res.redirect("/admin-dashboard");
});

router.get("/admin-dashboard", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    // 1. Novos Orçamentos = Status 'Aberto'
    const [[{ totalOrcamentos }]] = await db.query(
      "SELECT COUNT(*) as totalOrcamentos FROM pedido WHERE status = 'Aberto'",
    );

    // 2. Concluídos = Status 'Pronto' ou 'Entregue'
    const [[{ totalConcluidos }]] = await db.query(
      "SELECT COUNT(*) AS totalConcluidos FROM pedido WHERE status IN ('Pronto', 'Entregue')",
    );

    // 3. Quantidade de estofadores ativos
    const [[{ totalEstofadores }]] = await db.query(
      "SELECT COUNT(*) as totalEstofadores FROM usuario WHERE tipo = 'estofador'",
    );

    // Lista dos estofadores ativos para o painel
    const [listaEstofadores] = await db.query(
      "SELECT codUsuario, nome, email FROM usuario WHERE tipo = 'estofador' ORDER BY nome ASC",
    );

    // 4. Últimas Ordens de Serviço
    const [ordensServico] = await db.query(`
      SELECT
          p.codPedido,
          u_cli.nome AS nomeCliente,
          p.dataPedido,
          u_est.nome AS nomeEstofador, p.status
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u_cli ON c.codUsuario = u_cli.codUsuario
      LEFT JOIN usuario u_est ON p.codEstofador = u_est.codUsuario
      ORDER BY p.codPedido DESC
      LIMIT 5
    `);

    // 5. Renderiza a página enviando os dados mapeados
    res.render("admin/admin-dashboard", {
      usuario: req.session.usuario,
      totalOrcamentos: totalOrcamentos || 0,
      totalConcluidos: totalConcluidos || 0,
      totalEstofadores: totalEstofadores || 0,
      ordensServico: ordensServico,
      listaEstofadores: listaEstofadores,
    });
  } catch (error) {
    console.error("ERRO DETALHADO NO TERMINAL:", error);
    res.status(500).send("Erro interno ao carregar o painel de controle.");
  }
});

// Painel admin-Estofador
router.get("/admin/estofadores", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    const [estofadores] = await db.query(
      "SELECT codUsuario, nome, email FROM usuario WHERE tipo = 'estofador' ORDER BY nome ASC",
    );

    res.render("admin/estofadores", {
      usuario: req.session.usuario,
      estofadores,
    });
  } catch (error) {
    console.error("Erro ao listagem estofadores:", error);
    res.status(500).send("Erro interno ao carregar a página de estofadores.");
  }
});

// Rota para exibir a página de cadastro de produto
router.get("/admin/produtos/novo", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    // Busca as categorias para listar no <select> do formulário
    const [categorias] = await db.query("SELECT * FROM categoria");

    res.render("admin/novo-produto", {
      usuario: req.session.usuario,
      categorias: categorias,
    });
  } catch (error) {
    console.error("Erro ao carregar tela de cadastro:", error);
    res.status(500).send("Erro interno ao carregar a página.");
  }
});

// Rota para processar o formulário e inserir no banco
router.post("/admin/produtos/salvar", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  const { nome, preco, codCategoria, imagem } = req.body;

  try {
    // Define uma imagem padrão caso o campo venha vazio
    const caminhoImagem = imagem || "image/default.jpg";

    const queryInsert = "INSERT INTO produto (nome, preco, imagem, codCategoria) VALUES (?, ?, ?, ?)";
    await db.query(queryInsert, [nome, preco, caminhoImagem, codCategoria]);

    // Após salvar, redireciona para a página de produtos ou para o painel
    res.redirect("/produtos");
  } catch (error) {
    console.error("Erro ao salvar produto:", error);
    res.status(500).send("Erro ao cadastrar o produto no banco de dados.");
  }
});

// Rota Centralizada de Orçamentos (Admin e Estofador)
router.get("/admin/orcamentos", verificarAutenticacao(["admin", "estofador"]), async (req, res) => {
  if (req.session.usuario.tipo !== "admin" && req.session.usuario.tipo !== "estofador") {
    return res.redirect("/client-dashboard");
  }

  try {
    const tipoUsuario = req.session.usuario.tipo;

    // 1. Se quem entrou for o ADMIN
    if (tipoUsuario === "admin") {
      const [orcamentos] = await db.query(`
        SELECT p.*, u.nome AS nomeCliente
        FROM pedido p
        INNER JOIN cliente c ON p.codCliente = c.codCliente
        INNER JOIN usuario u ON c.codUsuario = u.codUsuario
        WHERE p.status = 'Aberto'
        ORDER BY p.dataPedido DESC
      `);

      return res.render("admin/orcamentos", {
        usuario: req.session.usuario,
        orcamentos: orcamentos,
      });
    }

    // 2. Se quem entrou for o ESTOFADOR
    if (tipoUsuario === "estofador") {
      // *Nota: Caso precise buscar os indicadores/ordens dinamicamente por query, adicione aqui.*
      // Exemplo padrão de inicialização preventiva para não quebrar o EJS:
      let indicadores = { total: 0 };
      let ordens = [];

      return res.render("estofador/estofador-dashboard", {
        usuario: req.session.usuario,
        indicadores: indicadores,
        ordens: ordens,
      });
    }
  } catch (error) {
    console.error("Erro na rota centralizada:", error);
    res.status(500).send("Erro interno do servidor.");
  }
});

// Rota Unificada: Detalhes para Analisar um Pedido Específico (Admin)
router.get("/admin/pedido/:id/analisar", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    const idPedido = req.params.id;

    // A) Busca os dados gerais do Pedido e do Cliente
    const [pedidos] = await db.query(
      `
      SELECT p.codPedido, p.dataPedido, p.status, u.nome AS nomeCliente, u.email AS emailCliente
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u ON c.codUsuario = u.codUsuario
      WHERE p.codPedido = ?
    `,
      [idPedido],
    );

    if (pedidos.length === 0) {
      return res.status(404).send("Orçamento não encontrado no banco de dados.");
    }

    let pedido = pedidos[0];

    // B) Busca os itens vinculados a este pedido (itempedido + produto)
    const [itens] = await db.query(
      `
      SELECT ip.quantidade, ip.precoUnitario, ip.observacao AS observacaoProduto, prod.nome AS nomeProduto
      FROM itempedido ip
      INNER JOIN produto prod ON ip.codProduto = prod.codProduto
      WHERE ip.codPedido = ?
    `,
      [idPedido],
    );

    // Guarda a lista de itens dentro do objeto pedido para a view usar
    pedido.itens = itens;

    // C) Busca a lista de Estofadores ativos para preencher o <select>
    const [estofadores] = await db.query(
      "SELECT codUsuario, nome FROM usuario WHERE tipo = 'estofador' ORDER BY nome ASC"
    );

    // Renderiza a página de análise enviando todos os dados necessários
    res.render("admin/analisar-pedido", {
      usuario: req.session.usuario,
      pedido: pedido,
      estofadores: estofadores,
    });
  } catch (error) {
    console.error("Erro ao buscar detalhes do orçamento:", error);
    res.status(500).send("Erro interno do servidor.");
  }
});

// Rota para ver detalhadamente os Pedidos Concluídos / Em produção
router.get("/admin/producao", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    const [pedidosProducao] = await db.query(`
      SELECT
          p.codPedido,
          u_cli.nome AS nomeCliente,
          p.dataPedido,
          p.status,
          u_est.nome AS nomeEstofador
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u_cli ON c.codUsuario = u_cli.codUsuario
      LEFT JOIN usuario u_est ON p.codEstofador = u_est.codUsuario
      WHERE p.status IN ('Pronto', 'Entregue')
      ORDER BY p.codPedido DESC
    `);

    res.render("admin/producao", {
      usuario: req.session.usuario,
      pedidosProducao,
    });
  } catch (error) {
    console.error("Erro ao listar pedidos concluídos:", error);
    res.status(500).send("Erro interno ao carregar a página.");
  }
});

// Rota para listar os trabalhos de um estofador específico (Apenas para Admin)
router.get("/admin/estofador/:id/trabalhos", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    const idEstofador = req.params.id;

    // 1. Busca os dados do estofador para o cabeçalho
    const [dadosProfissional] = await db.query(
      "SELECT nome FROM usuario WHERE codUsuario = ? AND tipo = 'estofador'",
      [idEstofador],
    );

    if (dadosProfissional.length === 0) {
      return res.status(404).send("Profissional não encontrado.");
    }
    const estofador = dadosProfissional[0];

    // 2. Busca todas as ordens de serviço atribuídas a ele
    const [trabalhos] = await db.query(
      `
      SELECT p.codPedido, p.dataPedido, p.status, u.nome AS nomeCliente
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u ON c.codUsuario = u.codUsuario
      WHERE p.codEstofador = ?
      ORDER BY p.dataPedido DESC
    `,
      [idEstofador],
    );

    res.render("admin/estofador-trabalhos", {
      usuario: req.session.usuario,
      estofador: estofador,
      trabalhos: trabalhos,
    });
  } catch (error) {
    console.error("Erro ao buscar histórico do estofador:", error);
    res.status(500).send("Erro interno do servidor.");
  }
});

// Rota Estofador - Detalhes do Pedido para Análise
router.get("/estofador/pedido/:id/detalhes", verificarAutenticacao(["estofador"]), async (req, res) => {
  if (req.session.usuario.tipo !== "estofador") {
    return res.redirect("/login");
  }

  try {
    const idPedido = req.params.id;

    // Busca o pedido garantindo que pertença ao estofador logado
    const [pedidos] = await db.query(
      `
      SELECT p.*, u.nome AS nomeCliente, u.email AS emailCliente
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u ON c.codUsuario = u.codUsuario
      WHERE p.codPedido = ? AND p.codEstofador = ?
    `,
      [idPedido, req.session.usuario.codUsuario],
    );

    if (pedidos.length === 0) {
      return res.status(404).send("Pedido não encontrado ou não atribuído a você.");
    }
    let pedido = pedidos[0];

    // Busca os produtos vinculados ao pedido
    const [itens] = await db.query(
      `
      SELECT ip.quantidade, ip.observacao AS observacaoProduto, prod.nome AS nomeProduto
      FROM itempedido ip
      INNER JOIN produto prod ON ip.codProduto = prod.codProduto
      WHERE ip.codPedido = ?
    `,
      [idPedido],
    );
    pedido.itens = itens;

    res.render("estofador/analisa-pedido", {
      usuario: req.session.usuario,
      pedido: pedido,
    });
  } catch (error) {
    console.error("Erro ao carregar detalhes:", error);
    res.status(500).send("Erro interno do servidor.");
  }
});

// ROTA: Visão do Admin para Analisar o Trabalho do Estofador
router.get("/admin/estofador-analisa/:id", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  try {
    const idPedido = req.params.id;

    // 1. Busca os dados do pedido, do cliente e também o nome do estofador atribuído
    const [pedidos] = await db.query(
      `
      SELECT p.*,
             u_cli.nome AS nomeCliente, u_cli.email AS emailCliente,
             u_est.nome AS nomeEstofador
      FROM pedido p
      INNER JOIN cliente c ON p.codCliente = c.codCliente
      INNER JOIN usuario u_cli ON c.codUsuario = u_cli.codUsuario
      LEFT JOIN usuario u_est ON p.codEstofador = u_est.codUsuario
      WHERE p.codPedido = ?
    `,
      [idPedido],
    );

    if (pedidos.length === 0) {
      return res.status(404).send("Pedido não encontrado.");
    }

    let pedido = pedidos[0];

    // 2. Busca os produtos, quantidades e observações do pedido
    const [itens] = await db.query(
      `
      SELECT ip.quantidade, ip.observacao AS observacaoProduto, prod.nome AS nomeProduto
      FROM itempedido ip
      INNER JOIN produto prod ON ip.codProduto = prod.codProduto
      WHERE ip.codPedido = ?
    `,
      [idPedido],
    );

    pedido.itens = itens;

    // 3. Renderiza a view passando os dados
    res.render("admin/estofador-analisa", {
      usuario: req.session.usuario,
      pedido: pedido,
    });
  } catch (error) {
    console.error("Erro ao carregar estofador-analisa para o admin:", error);
    res.status(500).send("Erro interno do servidor.");
  }
});

// ==========================================================
// AÇÕES POST DO ADMINISTRADOR (GERENCIAMENTO E STATUS)
// ==========================================================

// Rota para atualizar o status do pedido
router.post("/admin/pedido/:id/status", verificarAutenticacao(["admin", "estofador"]), async (req, res) => {
  const idPedido = req.params.id;
  const { novoStatus, codEstofador } = req.body;
  const tipoUsuario = req.session.usuario.tipo;

  console.log("Dados recebidos no POST:", {
    idPedido,
    novoStatus,
    codEstofador,
    tipoUsuario,
  });

  const statusValidos = ["Aberto", "Pago", "Em Produção", "Pronto", "Entregue", "Cancelado"];
  if (!statusValidos.includes(novoStatus)) {
    return res.status(400).send("Status inválido.");
  }

  try {
    if (novoStatus === "Em Produção") {
      if (!codEstofador) {
        return res.status(400).send("É obrigatório atribuir um estofador.");
      }
      await db.query(
        "UPDATE pedido SET status = ?, codEstofador = ? WHERE codPedido = ?",
        [novoStatus, codEstofador, idPedido],
      );
    } else {
      await db.query("UPDATE pedido SET status = ? WHERE codPedido = ?", [
        novoStatus,
        idPedido,
      ]);
    }

    console.log(`📦 Pedido #${idPedido} atualizado para [${novoStatus}] por um [${tipoUsuario}].`);

    if (tipoUsuario === "estofador") {
      return res.redirect("/estofador-dashboard");
    } else if (tipoUsuario === "admin") {
      if (["Em Produção", "Pronto", "Entregue"].includes(novoStatus)) {
        return res.redirect("/admin/producao");
      } else {
        return res.redirect("/admin-dashboard");
      }
    } else {
      return res.redirect("/");
    }
  } catch (error) {
    console.error("Erro ao processar o status do pedido:", error);
    res.status(500).send("Erro interno ao atualizar o pedido.");
  }
});

// Rota para excluir um estofador (Apenas para Admin)
router.post("/admin/estofador/:id/excluir", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  const idEstofador = req.params.id;

  try {
    await db.query(
      "UPDATE pedido SET codEstofador = NULL WHERE codEstofador = ?",
      [idEstofador],
    );

    await db.query(
      "DELETE FROM usuario WHERE codUsuario = ? AND tipo = 'estofador'",
      [idEstofador],
    );

    console.log(`🗑️ Estofador ID #${idEstofador} foi removido do sistema.`);
    res.redirect("/admin/estofadores");
  } catch (error) {
    console.error("Erro ao remover estofador:", error);
    res.status(500).send("Erro interno ao tentar remover o estofador.");
  }
});

// Rota para cadastrar um Novo Estofador (Apenas para Admin)
router.post("/admin/estofador/novo", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  const { nome, email } = req.body;
  const senhaPadrao = "123456";

  try {
    await db.query(
      "INSERT INTO usuario (nome, email, senha, tipo) VALUES (?, ?, ?, 'estofador')",
      [nome, email, senhaPadrao],
    );

    console.log(`👤 Novo estofador cadastrado: ${nome}`);
    res.redirect("/admin/estofadores");
  } catch (error) {
    console.error("Erro ao cadastrar estofador:", error);
    res.status(500).send("Erro interno ao salvar estofador.");
  }
});

// Rota para Salvar a Edição do Estofador (Apenas para Admin)
router.post("/admin/estofador/:id/editar", verificarAutenticacao(["admin"]), apenasAdmin, async (req, res) => {
  const idEstofador = req.params.id;
  const { nome, email } = req.body;

  try {
    await db.query(
      "UPDATE usuario SET nome = ?, email = ? WHERE codUsuario = ? AND tipo = 'estofador'",
      [nome, email, idEstofador],
    );

    console.log(`✏️ Estofador ID #${idEstofador} atualizado para: ${nome}`);
    res.redirect("/admin/estofadores");
  } catch (error) {
    console.error("Erro ao atualizar estofador:", error);
    res.status(500).send("Erro interno ao atualizar dados do estofador.");
  }
});

module.exports = router;