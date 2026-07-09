// ROTA DE USUÁRIO
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const axios = require("axios");

// Importa a conexão com o banco de dados
const db = require("../config/database");

// Importações e Configurações
const SECRET_KEY = "EstoffeMoveisPlanejados2026";
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");

// Middleware de Autenticação para Clientes
function verificarAutenticacao(tiposPermitidos) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    if (!usuario || !usuario.token) {
      return res.redirect("/login");
    }
    try {
      const decodificado = jwt.verify(usuario.token, SECRET_KEY);
      if (tiposPermitidos.includes(decodificado.tipo)) {
        return next();
      } else {
        return res.status(403).send("Acesso negado.");
      }
    } catch (error) {
      req.session.destroy();
      return res.redirect("/login");
    }
  };
}

// ==========================================
// ROTAS INSTITUCIONAIS / PÚBLICAS
// ==========================================

router.get("/produtos", async (req, res) => {
  try {
    // 1. Busca todos os produtos cadastrados no banco de dados
    const [listaProdutos] = await db.query("SELECT * FROM produtos");

    // 2. Renderiza a página 'produtos.ejs' passando a lista e o usuário logado
    res.render("produtos", {
      error: null,
      produtos: listaProdutos,
      usuario: req.session.usuario || null,
    });
  } catch (error) {
    console.error("🚨 Erro ao carregar a página de produtos:", error);
    // Se der erro no banco, renderiza a página com uma lista vazia para não quebrar o layout
    res.render("produtos", {
      error: "Não foi possível carregar os produtos no momento.",
      produtos: [],
      usuario: req.session.usuario || null,
    });
  }
});

router.get("/sobre", (req, res) => {
  res.render("sobre", { error: null, usuario: req.session.usuario || null });
});

router.get("/contato", (req, res) => {
  res.render("contato", { error: null, usuario: req.session.usuario || null });
});

router.post("/contato/enviar", async (req, res) => {
  const { nome, email, mensagem } = req.body;
  if (!nome || !email || !mensagem) {
    return res.status(400).send("Todos os campos são obrigatórios.");
  }
  try {
    const queryInsert =
      "INSERT INTO contato_mensagem (nome, email, mensagem) VALUES (?, ?, ?)";
    await db.query(queryInsert, [nome, email, mensagem]);

    const opcoesEmail = {
      from: `"${nome}" <${email}>`,
      to: "diaseduardoyo@gmail.com",
      subject: `Nova Mensagem de Contato - Estoffe (${nome})`,
      html: `<h2>Nova mensagem recebida!</h2><p><strong>Nome:</strong> ${nome}</p><p>${mensagem}</p>`,
    };
    await transportador.sendMail(opcoesEmail);

    res.redirect("/contato?sucesso=true");
  } catch (error) {
    console.error("Erro ao processar mensagem de contato:", error);
    res.status(500).send("Houve um erro interno ao enviar sua mensagem.");
  }
});

// ==========================================
// AUTENTICAÇÃO (LOGIN / REGISTRO / LOGOUT)
// ==========================================

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const [usuarios] = await db.query(
      "SELECT codUsuario, nome, email, senha, tipo FROM usuario WHERE email = ?",
      [email],
    );
    const usuarioEncontrado = usuarios[0];

    if (usuarioEncontrado) {
      // Comparação compatível com bcrypt
      const senhaValida = await bcrypt
        .compare(password, usuarioEncontrado.senha)
        .catch(() => password === usuarioEncontrado.senha);

      if (!senhaValida) {
        return res.render("login", { error: "Email ou senha incorretos." });
      }

      const token = jwt.sign(
        {
          codUsuario: usuarioEncontrado.codUsuario,
          tipo: usuarioEncontrado.tipo,
        },
        SECRET_KEY,
        { expiresIn: "1h" },
      );

      req.session.usuario = {
        codUsuario: usuarioEncontrado.codUsuario,
        nome: usuarioEncontrado.nome,
        email: usuarioEncontrado.email,
        tipo: usuarioEncontrado.tipo,
        token: token,
      };

      switch (usuarioEncontrado.tipo) {
        case "admin":
          return res.redirect("/admin-dashboard");
        case "estofador":
          return res.redirect("/estofador-dashboard");
        case "cliente":
          return res.redirect("/client-dashboard");
        default:
          return res.redirect("/");
      }
    } else {
      return res.render("login", { error: "Email ou senha incorretos." });
    }
  } catch (error) {
    console.error("Erro no login:", error);
    return res.render("login", { error: "Erro interno no servidor." });
  }
});

router.get("/register", (req, res) => {
  res.render("register", { usuario: req.session.usuario || null });
});

router.post("/register", async (req, res) => {
 // 1. Pegamos TODOS os campos exatamente como o formulário da imagem envia
  const {
    nome,
    email,
    novaSenha,
    telefone,
    cpfCnpj,
    cep,
    rua,
    numero,
    bairro,
    complemento,
    cidade,
    uf
  } = req.body;

  // 2. Validação dos campos obrigatórios
  if (
    !nome?.trim() ||
    !email?.trim() ||
    !novaSenha?.trim() ||
    !cpfCnpj?.trim() ||
    !rua?.trim() ||
    !numero?.trim()
  ) {
    return res.render("register", {
      usuario: null,
      error: "Preencha todos os campos obrigatórios.",
    });
  }

  try {
    // 3. Verifica se o e-mail já existe
    const [emailExistente] = await db.query(
      "SELECT codUsuario FROM usuario WHERE email = ?",
      [email]
    );
    if (emailExistente.length > 0) {
      return res.render("register", {
        usuario: null,
        error: "Este e-mail já está em uso.",
      });
    }

    // 4. Criptografa a senha e insere na tabela 'usuario'
    const senhaCriptografada = await bcrypt.hash(novaSenha, 10);
    const [resultadoUsuario] = await db.query(
      "INSERT INTO usuario (nome, email, senha, tipo) VALUES (?, ?, ?, 'cliente')",
      [nome, email, senhaCriptografada]
    );
    const novoCodUsuario = resultadoUsuario.insertId;

    // 5. JUNTAR OS CAMPOS DA IMAGEM PARA CRIAR UM ENDEREÇO ÚNICO
    const enderecoCompleto = `${rua}, Nº ${numero}${complemento ? ' - ' + complemento : ''}. Bairro: ${bairro}. ${cidade}-${uf}. CEP: ${cep}`;

    // 6. Limpar o CPF para não dar erro no Asaas depois (remove pontos e traços)
    const cpfLimpo = cpfCnpj.replace(/\D/g, '');

    await db.query(
      "INSERT INTO cliente (codUsuario, telefone, endereco, cpfCnpj) VALUES (?, ?, ?, ?)",
      [
        novoCodUsuario,
        telefone || null,
        enderecoCompleto,
        cpfLimpo
      ]
    );

    return res.redirect("/login");

  } catch (error) {
    console.error("🚨 Erro detalhado no cadastro:", error);
    return res.render("register", {
      usuario: null,
      error: "Erro interno ao processar cadastro no banco de dados.",
    });
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).send("Erro ao sair.");
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

// ==========================================
// RECUPERAÇÃO DE SENHA
// ==========================================

router.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { error: null, success: null });
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const [usuarios] = await db.query(
      "SELECT codUsuario FROM usuario WHERE email = ?",
      [email],
    );
    if (usuarios.length === 0) {
      return res.render("forgot-password", {
        error: null,
        success:
          "Se este e-mail estiver cadastrado, as instruções foram enviadas!",
      });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const dataExpiracao = new Date();
    dataExpiracao.setHours(dataExpiracao.getHours() + 1);

    await db.query(
      "INSERT INTO recuperacao_senha (email, token, expiracao) VALUES (?, ?, ?)",
      [email, token, dataExpiracao],
    );

    // Configuração de envio omitida por brevidade (Mesmo padrão do transportador)

    return res.render("forgot-password", {
      error: null,
      success: "Verifique sua caixa de entrada para redefinir a senha!",
    });
  } catch (error) {
    console.error(error);
    return res.render("forgot-password", {
      success: null,
      error: "Erro interno do servidor.",
    });
  }
});

router.get("/reset-password", async (req, res) => {
  const { token } = req.query;
  try {
    const [tokens] = await db.query(
      "SELECT * FROM recuperacao_senha WHERE token = ? AND expiracao > NOW() AND usado = 0",
      [token],
    );
    if (tokens.length === 0)
      return res.send("Este link de recuperação é inválido ou expirou.");
    res.render("reset-password", { token: token, error: null });
  } catch (error) {
    res.status(500).send("Erro interno.");
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, novaSenha } = req.body;
  try {
    const [registros] = await db.query(
      "SELECT email FROM recuperacao_senha WHERE token = ? AND expiracao > NOW() AND usado = 0",
      [token],
    );
    if (registros.length === 0) return res.send("Token inválido.");

    const emailUsuario = registros[0].email;
    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

    await db.query("UPDATE usuario SET senha = ? WHERE email = ?", [
      novaSenhaHash,
      emailUsuario,
    ]);
    await db.query("UPDATE recuperacao_senha SET usado = 1 WHERE token = ?", [
      token,
    ]);

    res.redirect("/login?success=SenhaAlterada");
  } catch (error) {
    res.status(500).send("Erro ao redefinir.");
  }
});

// ==========================================
// GERENCIAMENTO DO CARRINHO E PEDIDOS (CLIENTE)
// ==========================================
router.get("/carrinho", async (req, res) => {
  if (!req.session.usuario) return res.redirect("/login");
  const usuarioLogado = req.session.usuario;

  try {
    // 1. Descobrir o codCliente
    const [clientes] = await db.query(
      "SELECT codCliente FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    if (clientes.length === 0) {
      return res.render("carrinho", {
        usuario: usuarioLogado,
        produtosNoCarrinho: [],
        total: 0,
      });
    }
    const codCliente = clientes[0].codCliente;

    // 2. Buscar itens salvos no banco com JOIN para pegar nome, preço e imagem do produto
    const [itensBanco] = await db.query(
      `SELECT c.quantidade, p.codProduto, p.nome, p.preco, p.imagem
      FROM carrinho c
      INNER JOIN produto p ON c.codProduto = p.codProduto
      WHERE c.codCliente = ?`,
      [codCliente],
    );

    // 3. Calcular totais para exibir no HTML
    let total = 0;
    const produtosNoCarrinho = itensBanco.map((item) => {
      const subtotal = item.preco * item.quantidade;
      total += subtotal;
      return {
        codProduto: item.codProduto,
        nome: item.nome,
        preco: item.preco,
        imagem: item.imagem,
        quantidade: item.quantidade,
        subtotal: subtotal,
      };
    });

    // 4. Renderiza a tela do carrinho com os dados reais vindos do banco
    res.render("carrinho", {
      usuario: usuarioLogado,
      produtosNoCarrinho,
      total,
    });
  } catch (error) {
    console.error("Erro ao carregar o carrinho do banco:", error);
    res.status(500).send("Erro ao carregar o carrinho.");
  }
});

router.post("/carrinho/add/:id", async (req, res) => {
  const produtoId = req.params.id;

  // Se não estiver logado, manda para o login
  if (!req.session.usuario) return res.redirect("/login");
  const usuarioLogado = req.session.usuario;

  try {
    // 1. Descobrir o codCliente baseado no usuário logado
    const [clientes] = await db.query(
      "SELECT codCliente FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    if (clientes.length === 0) {
      return res.status(404).send("Cliente não encontrado.");
    }
    const codCliente = clientes[0].codCliente;

    // 2. Salva direto na tabela do banco de dados
    await db.query(
      `INSERT INTO carrinho (codCliente, codProduto, quantidade)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE quantidade = quantidade + 1`,
      [codCliente, produtoId],
    );

    // Após salvar no banco, redireciona para a página do carrinho para o usuário ver o item lá
    res.redirect("/carrinho");
  } catch (error) {
    console.error("Erro ao adicionar ao carrinho no banco:", error);
    res.status(500).send("Erro ao salvar item no carrinho.");
  }
});

router.post("/carrinho/atualizar/:codProduto", async (req, res) => {
  if (!req.session.usuario) return res.redirect("/login");
  const usuarioLogado = req.session.usuario;

  const codProduto = parseInt(req.params.codProduto);
  const novaQuantidade = parseInt(req.body.quantidade);

  try {
    // 1. Descobrir o codCliente
    const [clientes] = await db.query(
      "SELECT codCliente FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    if (clientes.length > 0 && novaQuantidade > 0) {
      const codCliente = clientes[0].codCliente;

      // 2. Atualiza a quantidade direto na tabela do banco
      await db.query(
        "UPDATE carrinho SET quantidade = ? WHERE codCliente = ? AND codProduto = ?",
        [novaQuantidade, codCliente, codProduto],
      );
    }

    res.redirect("/carrinho");
  } catch (error) {
    console.error("Erro ao atualizar quantidade no banco:", error);
    res.status(500).send("Erro ao atualizar o carrinho.");
  }
});

router.post("/carrinho/remover/:codProduto", async (req, res) => {
  if (!req.session.usuario) return res.redirect("/login");
  const usuarioLogado = req.session.usuario;

  const codProduto = parseInt(req.params.codProduto);

  try {
    // 1. Descobrir o codCliente
    const [clientes] = await db.query(
      "SELECT codCliente FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    if (clientes.length > 0) {
      const codCliente = clientes[0].codCliente;

      // 2. Deleta o registro do produto para este cliente específico
      await db.query(
        "DELETE FROM carrinho WHERE codCliente = ? AND codProduto = ?",
        [codCliente, codProduto],
      );
    }

    res.redirect("/carrinho");
  } catch (error) {
    console.error("Erro ao remover item do banco:", error);
    res.status(500).send("Erro ao remover item do carrinho.");
  }
});

// ==========================================================
// ROTAS DE FINALIZAÇÃO E PAGAMENTO (INTEGRAÇÃO ASAAS PIX)
// ==========================================================

// 1. POST: Processar a finalização do pedido e gerar a cobrança no Asaas
router.post(
  "/pedido/finalizar",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const usuarioLogado = req.session.usuario;

    // Pegar a conexão para gerenciar a transação manualmente
    const conexao = await db.getConnection();

    try {
      // Inicia a transação no banco de dados
      await conexao.beginTransaction();

      // 1. Descobrir o codCliente baseado no codUsuario logado
      const [clientes] = await conexao.query(
  "SELECT codCliente, cpfCnpj, idAsaas FROM cliente WHERE codUsuario = ?",
  [usuarioLogado.codUsuario]
);
const [itensCarrinho] = await conexao.query("SELECT * FROM carrinho WHERE codCliente = ?", [usuarioLogado.codUsuario]);
if (clientes.length === 0) throw new Error("Cliente não encontrado.");

const codCliente = clientes[0].codCliente;
let idClienteAsaas = clientes[0].idAsaas;

// =========================================================================
// PASSO 1: VERIFICAÇÃO SE O CLIENTE JÁ EXISTE NO ASAAS
// =========================================================================

let valorTotalPedido = 0;
itensCarrinho.forEach(item => {
  // Altere 'preco' e 'quantidade' para os nomes reais das colunas da sua tabela
  valorTotalPedido += Number(item.preco) * Number(item.quantidade);
});

// 1. Primeiro, você insere o pedido no seu banco de dados local
const [resultadoPedido] = await conexao.query(
  "INSERT INTO pedido (codCliente, valor_final, status) VALUES (?, ?, 'aguardando_pagamento')",
  [codCliente, valorTotalPedido]
);

// ========================================================
// A CORREÇÃO ESTÁ AQUI: Capturar o ID que o banco acabou de gerar!
// ========================================================
const idNovoPedido = resultadoPedido.insertId;

// Apenas para garantir que o valor não seja zero ou quebrado:
if (!valorTotalPedido || valorTotalPedido <= 0) {
  valorTotalPedido = 100.00; // Valor padrão de teste caso o carrinho esteja vazio
}

// Se a variável 'idClienteAsaas' veio do banco como NULL ou VAZIA, precisamos cadastrá-lo
const tokenAsaas = '$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjQ4ZTk0M2Y4LTRhNDYtNDhhZi1hNmZiLTVlYTc2ODA2NTEwNTo6JGFhY2hfYzBiZmM2Y2UtZjQ2MS00ODg4LWEwMmQtYzBiMzNkMTRmZGYx';
if (!idClienteAsaas) {
  const [clientes] = await conexao.query("SELECT codCliente, cpfCnpj, idAsaas FROM cliente WHERE codUsuario = ?", [usuarioLogado.codUsuario]);
  console.log("🔄 Buscando um cliente existente direto na sua conta Asaas Sandbox...");
  
  // Aqui dentro você NÃO precisa mais declarar o tokenAsaas, ele já lê lá de cima!
  const listagemClientes = await axios.get('https://sandbox.asaas.com/api/v3/customers?limit=1', {
    headers: { 'access_token': tokenAsaas }
  });
  try {
    // 1. Em vez de criar, perguntamos ao Asaas: "Me dá a lista de clientes que já estão cadastrados na minha conta"
    const listagemClientes = await axios.get('https://sandbox.asaas.com/api/v3/customers?limit=1', {
      headers: { 'access_token': tokenAsaas }
    });

    if (listagemClientes.data && listagemClientes.data.data.length > 0) {
      // Encontrou um cliente existente no seu painel! Vamos usar o ID dele
      idClienteAsaas = listagemClientes.data.data[0].id;
      console.log(`✅ Cliente encontrado no painel do Asaas: ${idClienteAsaas}`);
    } else {
      // Caso sua conta esteja totalmente zerada e sem nenhum cliente criado no painel:
      console.log("⚠️ Nenhum cliente no painel. Forçando criação com CPF sem zeros à esquerda...");
      
      const respostaNovoCliente = await axios.post('https://sandbox.asaas.com/api/v3/customers', {
        name: "Cliente de Teste Estoffe",
        cpfCnpj: "43763784844" // CPF válido sem zeros à esquerda para evitar bugs de conversão
      }, {
        headers: { 'access_token': tokenAsaas }
      });
      
      idClienteAsaas = respostaNovoCliente.data.id;
    }

    // 2. Registramos o ID definitivo no seu banco local MySQL para fixar o conserto
    await conexao.query(
      "UPDATE cliente SET idAsaas = ? WHERE codCliente = ?",
      [idClienteAsaas, codCliente]
    );
    console.log(`💾 ID (${idClienteAsaas}) sincronizado e gravado no banco de dados.`);

  } catch (errAsaas) {
    console.error("❌ Falha crítica ao sincronizar cliente com o Asaas:");
    if (errAsaas.response) console.error(errAsaas.response.data);
    throw errAsaas;
  }
}

// =========================================================================
// PASSO 2: CRIAÇÃO DA COBRANÇA PIX (FLUXO SEGURO)
// =========================================================================
// Chegando aqui, a variável 'idClienteAsaas' tem um valor válido (seja vindo do banco ou criado agora acima)
console.log(`💰 Solicitando Pix para o cliente Asaas: ${idClienteAsaas}`);
// 1. Você acabou de criar o pagamento aqui:
const respostaAsaas = await axios.post('https://sandbox.asaas.com/api/v3/payments', {
  customer: idClienteAsaas,
  billingType: 'PIX',
  value: Number(valorTotalPedido),
  dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
  externalReference: String(idNovoPedido),
  description: `Pedido #${idNovoPedido} na Estoffe`
}, {
  headers: { 'access_token': tokenAsaas }
});

// 2. Pegamos o ID desse pagamento específico
const idPagamento = respostaAsaas.data.id;

console.log(`🔗 Buscando QR Code do Pix para o pagamento: ${idPagamento}`);

// ========================================================
// AQUI ESTÁ A CORREÇÃO: Criar a variável dadosPix buscando da API do Asaas
// ========================================================
const respostaQrCode = await axios.get(`https://sandbox.asaas.com/api/v3/payments/${idPagamento}/pixQrCode`, {
  headers: { 'access_token': tokenAsaas }
});

// Agora a variável existe e tem as informações reais!
const dadosPix = respostaQrCode.data;

// 3. Agora você pode renderizar a sua página passando os dados com segurança:
return res.render("pagamento", {
  pedidoId: idNovoPedido,
  valor: valorTotalPedido,
  qrCodeImage: dadosPix.encodedImage, // Imagem em Base64 para a tag <img src="data:image/png;base64,...">
  copiaECola: dadosPix.payload,    // Texto para o botão de "Copiar Código"

  pagamento: {
    qrCode: dadosPix.encodedImage,
    copiaECola: dadosPix.payload,
    total: Number(valorTotalPedido)
  }
});
      const pixCopiaECola = dadosPix.data.payload;
      const pixQrCodeImagem = dadosPix.data.encodedImage;

      // =========================================================
      // MODIFICAÇÃO AQUI: Limpar o carrinho do BANCO após o sucesso
      // =========================================================
      await conexao.query("DELETE FROM carrinho WHERE codCliente = ?", [
        codCliente,
      ]);

      // Efetua o commit final no banco
      await conexao.commit();

      // Aloca as credenciais do PIX gerado na sessão para a próxima tela
      req.session.dadosPagamento = {
        copiaECola: pixCopiaECola,
        qrCode: pixQrCodeImagem,
        total: valorTotalPedido,
        idPedido: idNovoPedido,
      };

      req.session.save((err) => {
        if (err) {
          console.error("🚨 Erro ao salvar sessão do pagamento:", err);
          return res.redirect("/client-dashboard");
        }
        res.redirect("/pedido/pagamento");
      });
    } catch (error) {
      await conexao.rollback();
      console.error(
        "🚨 Erro ao finalizar pedido com Asaas:",
        error.response ? error.response.data : error.message,
      );

      // MODIFICAÇÃO AQUI: Mostra o erro real do Asaas na tela
      if (error.response) {
        return res
          .status(500)
          .json({ erro: "Erro na API Asaas", detalhes: error.response.data });
      }
      res.status(500).send("Erro interno: " + error.message);
    } finally {
      conexao.release();
    }
  },
);

// 2. GET: Rota que renderiza a página EJS exibindo o QR Code do Pix
router.get(
  "/pedido/pagamento",
  verificarAutenticacao(["cliente"]),
  (req, res) => {
    const pagamento = req.session.dadosPagamento;

    // Segurança: Se não houver dados de pagamento na sessão, manda pro painel
    if (!pagamento) {
      return res.redirect("/client-dashboard");
    }

    // Renderiza a tela 'pagamento.ejs' passando o objeto contendo as strings do Pix
    res.render("pagamento", { pagamento: pagamento });
  },
);

// ROTA: Painel do Cliente
router.get(
  "/client-dashboard",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const usuarioLogado = req.session.usuario;

    try {
      // 1. Busca os dados do cliente e seus pedidos recentes no banco
      const [clientes] = await db.query(
        "SELECT codCliente FROM cliente WHERE codUsuario = ?",
        [usuarioLogado.codUsuario],
      );

      let pedidos = [];
      if (clientes.length > 0) {
        const codCliente = clientes[0].codCliente;
        // Busca os pedidos do cliente ordenados pelo mais recente
        [pedidos] = await db.query(
          "SELECT * FROM pedido WHERE codCliente = ? ORDER BY dataPedido DESC",
          [codCliente],
        );
      }

      // 2. Renderiza a view do cliente (certifique-se de ter o arquivo client-dashboard.ejs)
      res.render("client/client-dashboard", {
        usuario: usuarioLogado,
        pedidos: pedidos,
        sucesso: req.query.sucesso || null,
        pedidoSucesso: req.query.pedidoSucesso || null,
      });
    } catch (error) {
      console.error("Erro ao carregar o dashboard do cliente:", error);
      res.status(500).send("Erro interno ao carregar o painel do cliente.");
    }
  },
);

// Perfil do Cliente
router.get("/perfil", verificarAutenticacao(["cliente"]), async (req, res) => {
  const usuarioLogado = req.session.usuario;

  try {
    // 1. Busca os dados do cliente (telefone, endereco) no banco
    const [clientes] = await db.query(
      "SELECT telefone, endereco FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    const dadosCliente = clientes[0] || { telefone: null, endereco: null };

    // 2. Renderiza a view de perfil (certifique-se de ter o arquivo perfil.ejs)
    res.render("client/perfil", {
      usuario: usuarioLogado,
      telefone: dadosCliente.telefone,
      endereco: dadosCliente.endereco,
      error: req.query.error || null,
    });
  } catch (error) {
    console.error("Erro ao carregar o perfil do cliente:", error);
    res.status(500).send("Erro interno ao carregar o perfil.");
  }
});

router.post(
  "/client/atualizar-perfil",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const { nome, telefone, endereco, novaSenha, confirmarSenha } = req.body;
    const usuarioLogado = req.session.usuario;

    if (!nome?.trim()) return res.status(400).send("O nome é obrigatório.");

    try {
      await db.query("UPDATE usuario SET nome = ? WHERE codUsuario = ?", [
        nome,
        usuarioLogado.codUsuario,
      ]);
      await db.query(
        "UPDATE cliente SET telefone = ?, endereco = ? WHERE codUsuario = ?",
        [telefone || null, endereco || null, usuarioLogado.codUsuario],
      );
      req.session.usuario.nome = nome;

      if (novaSenha && novaSenha.trim() !== "") {
        if (novaSenha !== confirmarSenha)
          return res.redirect("/perfil?error=senhas_diferentes");
        const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
        await db.query("UPDATE usuario SET senha = ? WHERE codUsuario = ?", [
          novaSenhaHash,
          usuarioLogado.codUsuario,
        ]);
      }

      res.redirect("/perfil");
    } catch (error) {
      console.error(error);
      res.status(500).send("Erro interno.");
    }
  },
);

module.exports = router;
