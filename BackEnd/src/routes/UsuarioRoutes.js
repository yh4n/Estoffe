const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const axios = require("axios");

// Importa a conexão com o banco de dados
const db = require("../config/database");

// Importa configurações centralizadas
const {
  verificarAutenticacao,
  SECRET_KEY,
} = require("../config/middleware/auth");
const jwt = require("jsonwebtoken");
const transportador = require("../config/mailer");

function pagamentoTesteAtivo() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.SIMULAR_PAGAMENTO === "true"
  );
}

async function aprovarPagamentoSimulado(executor, codPedido, valorTotal) {
  const [pagamentos] = await executor.query(
    `SELECT codPagamento, estoqueBaixado
       FROM pagamento
      WHERE codPedido = ?
      ORDER BY codPagamento DESC
      LIMIT 1
      FOR UPDATE`,
    [codPedido],
  );
  const pagamento = pagamentos[0];

  if (!Number(pagamento?.estoqueBaixado)) {
    const [itens] = await executor.query(
      `SELECT ip.codProduto, SUM(ip.quantidade) AS quantidade, p.sob_medida
         FROM itempedido ip
         INNER JOIN produto p ON p.codProduto = ip.codProduto
        WHERE ip.codPedido = ?
        GROUP BY ip.codProduto, p.sob_medida
        ORDER BY ip.codProduto`,
      [codPedido],
    );
    if (!itens.length) throw new Error("O pedido não possui itens.");

    for (const item of itens) {
      if (Number(item.sob_medida) === 1) continue;

      const [resultado] = await executor.query(
        `UPDATE produto
            SET quantidadeEstoque = quantidadeEstoque - ?
          WHERE codProduto = ? AND quantidadeEstoque >= ?`,
        [item.quantidade, item.codProduto, item.quantidade],
      );
      if (resultado.affectedRows !== 1) {
        const erroEstoque = new Error(
          `Estoque insuficiente para o produto ${item.codProduto}.`,
        );
        erroEstoque.code = "ESTOQUE_INSUFICIENTE";
        throw erroEstoque;
      }
    }
  }

  if (pagamento) {
    await executor.query(
      "UPDATE pagamento SET status = 'Aprovado', estoqueBaixado = 1 WHERE codPagamento = ?",
      [pagamento.codPagamento],
    );
  } else {
    await executor.query(
      `INSERT INTO pagamento
         (codPedido, valor, formaPagamento, status, estoqueBaixado)
       VALUES (?, ?, 'PIX', 'Aprovado', 1)`,
      [codPedido, valorTotal],
    );
  }

  await executor.query("UPDATE pedido SET status = 'Pago' WHERE codPedido = ?", [
    codPedido,
  ]);
}

function normalizarCarrinhoOffline(valor) {
  let itens;
  try {
    itens = typeof valor === "string" ? JSON.parse(valor) : valor;
  } catch {
    return [];
  }
  if (!Array.isArray(itens)) return [];

  const quantidades = new Map();
  for (const item of itens.slice(0, 100)) {
    const codProduto = Number(item?.codProduto);
    const quantidade = Number(item?.quantidade);
    if (
      !Number.isSafeInteger(codProduto) ||
      codProduto <= 0 ||
      !Number.isSafeInteger(quantidade) ||
      quantidade <= 0
    ) {
      continue;
    }
    quantidades.set(
      codProduto,
      Math.min(99, (quantidades.get(codProduto) || 0) + quantidade),
    );
  }
  return [...quantidades].map(([codProduto, quantidade]) => ({
    codProduto,
    quantidade,
  }));
}

async function mesclarCarrinhoOffline(codUsuario, itensOffline) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [clientes] = await connection.query(
      "SELECT codCliente FROM cliente WHERE codUsuario = ? FOR UPDATE",
      [codUsuario],
    );
    if (!clientes.length) {
      await connection.commit();
      return { cartCount: 0, mesclado: false };
    }

    const codCliente = clientes[0].codCliente;
    let mesclado = false;
    if (itensOffline.length) {
      const idsProduto = itensOffline.map((item) => item.codProduto);
      const [produtos] = await connection.query(
        `SELECT codProduto FROM produto WHERE codProduto IN (${idsProduto.map(() => "?").join(",")})`,
        idsProduto,
      );
      const produtosValidos = new Set(
        produtos.map((produto) => Number(produto.codProduto)),
      );

      for (const item of itensOffline) {
        if (!produtosValidos.has(item.codProduto)) continue;
        await connection.query(
          `INSERT INTO carrinho (codCliente, codProduto, quantidade)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantidade = LEAST(carrinho.quantidade + VALUES(quantidade), 99)`,
          [codCliente, item.codProduto, item.quantidade],
        );
        mesclado = true;
      }
    }

    const [[{ total }]] = await connection.query(
      "SELECT COALESCE(SUM(quantidade), 0) AS total FROM carrinho WHERE codCliente = ?",
      [codCliente],
    );
    await connection.commit();
    return { cartCount: Number(total), mesclado };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizarCep(cep, endereco = "") {
  const enderecoSeguro = String(endereco || "");
  const valor = String(
    cep || enderecoSeguro.match(/\b\d{5}-?\d{3}\b/)?.[0] || "",
  ).replace(/\D/g, "");
  return valor.length === 8 ? valor : "";
}

function formatarCep(cep) {
  const valor = normalizarCep(cep);
  return valor ? `${valor.slice(0, 5)}-${valor.slice(5)}` : "";
}

function formatarTelefone(telefone) {
  const valor = String(telefone || "").replace(/\D/g, "");
  if (valor.length === 10) {
    return `(${valor.slice(0, 2)}) ${valor.slice(2, 6)}-${valor.slice(6)}`;
  }
  if (valor.length === 11) {
    return `(${valor.slice(0, 2)}) ${valor.slice(2, 7)}-${valor.slice(7)}`;
  }
  return telefone || "";
}

function formatarCpfCnpj(documento) {
  const valor = String(documento || "").replace(/\D/g, "");
  if (valor.length === 11) {
    return `${valor.slice(0, 3)}.${valor.slice(3, 6)}.${valor.slice(6, 9)}-${valor.slice(9)}`;
  }
  if (valor.length === 14) {
    return `${valor.slice(0, 2)}.${valor.slice(2, 5)}.${valor.slice(5, 8)}/${valor.slice(8, 12)}-${valor.slice(12)}`;
  }
  return documento || "";
}

async function buscarFretePorCep(cep, endereco = "") {
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

function validarCpfCnpj(documento) {
  const numero = String(documento || "").replace(/\D/g, "");

  if (![11, 14].includes(numero.length) || /^(\d)\1+$/.test(numero)) {
    return false;
  }

  if (numero.length === 11) {
    let soma = 0;
    for (let indice = 0; indice < 9; indice += 1) {
      soma += Number(numero[indice]) * (10 - indice);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== Number(numero[9])) return false;

    soma = 0;
    for (let indice = 0; indice < 10; indice += 1) {
      soma += Number(numero[indice]) * (11 - indice);
    }
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    return resto === Number(numero[10]);
  }

  const pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let indice = 0; indice < 12; indice += 1) {
    soma += Number(numero[indice]) * pesos[indice];
  }
  let resto = soma % 11;
  const primeiroDigito = resto < 2 ? 0 : 11 - resto;
  if (primeiroDigito !== Number(numero[12])) return false;

  soma = 0;
  const pesosSegundoDigito = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (let indice = 0; indice < 13; indice += 1) {
    soma += Number(numero[indice]) * pesosSegundoDigito[indice];
  }
  resto = soma % 11;
  const segundoDigito = resto < 2 ? 0 : 11 - resto;
  return segundoDigito === Number(numero[13]);
}

// ==========================================
// ROTAS INSTITUCIONAIS / PÚBLICAS
// ==========================================
const rateLimit = require("express-rate-limit");
const passport = require("../config/passport");

const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
  standardHeaders: true,
  legacyHeaders: false,
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
      from: `"Estoffe" <${process.env.EMAIL_USER}>`,
      replyTo: email,
      to: process.env.EMAIL_ADMIN || "estoffeestofados@gmail.com",
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

router.post("/orcamento-sob-medida/enviar", async (req, res) => {
  const nome = String(req.body.nome || "").trim();
  const email = String(req.body.email || "").trim();
  const telefone = String(req.body.telefone || "").trim();
  const telefoneNumeros = telefone.replace(/\D/g, "");
  const cep = String(req.body.cep || "").replace(/\D/g, "");
  const produto = String(req.body.produto || "").trim();
  const mensagem = String(req.body.mensagem || "").trim();

  if (
    !nome || nome.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
    ![10, 11].includes(telefoneNumeros.length) ||
    cep.length !== 8 ||
    !mensagem
  ) {
    return res.status(400).send("Confira nome, e-mail, telefone, CEP e mensagem.");
  }

  const detalhes = [
    "Solicitação de orçamento sob medida",
    `Produto: ${produto || "A definir"}`,
    `Telefone: ${telefone}`,
    `CEP: ${cep}`,
    "",
    mensagem,
  ].join("\n");
  const escaparHtml = (valor) => valor.replace(/[&<>"']/g, (caractere) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[caractere]);

  try {
    await db.query(
      "INSERT INTO contato_mensagem (nome, email, mensagem) VALUES (?, ?, ?)",
      [nome, email, detalhes],
    );

    await transportador.sendMail({
      from: `"Estoffe" <${process.env.EMAIL_USER}>`,
      replyTo: email,
      to: process.env.EMAIL_ADMIN || "estoffeestofados@gmail.com",
      subject: `Orçamento sob medida - Estoffe (${nome})`,
      html: `<h2>Novo pedido de orçamento sob medida</h2><p><strong>Nome:</strong> ${escaparHtml(nome)}</p><p><strong>E-mail:</strong> ${escaparHtml(email)}</p><p><strong>Telefone:</strong> ${escaparHtml(telefone)}</p><p><strong>CEP:</strong> ${escaparHtml(cep)}</p><p><strong>Produto:</strong> ${escaparHtml(produto || "A definir")}</p><p><strong>Mensagem:</strong><br>${escaparHtml(mensagem).replace(/\n/g, "<br>")}</p>`,
    });

    res.redirect("/orcamento-sob-medida?sucesso=true");
  } catch (error) {
    console.error("Erro ao processar orçamento sob medida:", error);
    res.status(500).send("Houve um erro ao enviar sua solicitação de orçamento.");
  }
});

// ==========================================
// AUTENTICAÇÃO (LOGIN / REGISTRO / LOGOUT)
// ==========================================

router.get("/login", (req, res) => {
  res.render("login", { error: null, email: "" });
});

router.post("/login", limitadorLogin, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email : "";
  const { password } = req.body;
  const renderLoginError = (error) => res.render("login", { error, email });

  try {
    const [usuarios] = await db.query(
      "SELECT codUsuario, nome, email, senha, tipo FROM usuario WHERE email = ?",
      [email],
    );
    const usuarioEncontrado = usuarios[0];

    if (usuarioEncontrado) {
      const senhaValida = await bcrypt.compare(
        password,
        usuarioEncontrado.senha,
      );

      if (!senhaValida) {
        return renderLoginError("Email ou senha incorretos.");
      }

      let carrinhoOfflineMesclado = false;
      if (usuarioEncontrado.tipo === "cliente") {
        const resultadoCarrinho = await mesclarCarrinhoOffline(
          usuarioEncontrado.codUsuario,
          normalizarCarrinhoOffline(req.body.cartOffline),
        );
        req.session.cartCount = resultadoCarrinho.cartCount;
        carrinhoOfflineMesclado = resultadoCarrinho.mesclado;
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

      const destino =
        {
          admin: "/admin-dashboard",
          estofador: "/estofador-dashboard",
          cliente: "/",
        }[usuarioEncontrado.tipo] || "/";

      return req.session.save((erro) => {
        if (erro) {
          console.error("Erro ao salvar sessão de login:", erro);
          return renderLoginError(
            "Não foi possível concluir o login. Tente novamente.",
          );
        }

        return res.redirect(
          carrinhoOfflineMesclado ? "/carrinho?offline=merged" : destino,
        );
      });
    } else {
      return renderLoginError("Email ou senha incorretos.");
    }
  } catch (error) {
    console.error("Erro no login:", error);
    return renderLoginError("Erro interno no servidor.");
  }
});

router.post(
  "/carrinho/sincronizar-offline",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    try {
      const resultado = await mesclarCarrinhoOffline(
        req.session.usuario.codUsuario,
        normalizarCarrinhoOffline(req.body.cartOffline),
      );
      req.session.cartCount = resultado.cartCount;
      return res.json({ sincronizado: true, cartCount: resultado.cartCount });
    } catch (error) {
      console.error("Erro ao sincronizar carrinho offline:", error);
      return res
        .status(500)
        .json({ erro: "Não foi possível sincronizar o carrinho." });
    }
  },
);

// ==========================================
// LOGIN COM GOOGLE
// ==========================================

router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

router.get(
  "/auth/google/callback",
  (req, res, next) => {
    passport.authenticate(
      "google",
      { session: false },
      (err, usuarioGoogle, info) => {
        if (err) {
          console.error("Erro na autenticação Google:", err);
          return res.redirect("/login?error=google_falhou");
        }
        if (!usuarioGoogle) {
          return res.redirect("/login?error=google_sem_usuario");
        }
        req.user = usuarioGoogle;
        next();
      },
    )(req, res, next);
  },
  (req, res) => {
    const usuarioGoogle = req.user;

    const token = jwt.sign(
      { codUsuario: usuarioGoogle.codUsuario, tipo: usuarioGoogle.tipo },
      SECRET_KEY,
      { expiresIn: "1h" },
    );

    req.session.usuario = {
      codUsuario: usuarioGoogle.codUsuario,
      nome: usuarioGoogle.nome,
      email: usuarioGoogle.email,
      tipo: usuarioGoogle.tipo,
      token: token,
    };

    switch (usuarioGoogle.tipo) {
      case "admin":
        return res.redirect("/admin-dashboard");
      case "estofador":
        return res.redirect("/estofador-dashboard");
      case "cliente":
        return res.redirect("/carrinho?sincronizarOffline=1");
      default:
        return res.redirect("/");
    }
  },
);

router.get("/register", (req, res) => {
  res.render("register", {
    usuario: req.session.usuario || null,
    error: null,
    csrfToken: req.csrfToken ? req.csrfToken() : null,
  });
});

router.post("/register", async (req, res) => {
  console.log(">>> Requisição POST /register recebida com sucesso!");
  const {
    nome,
    email,
    telefone,
    cpfCnpj,
    novaSenha,
    confirmarSenha,
    cep,
    numero,
    rua,
    bairro,
    complemento,
    cidade,
    uf,
  } = req.body;

  if (!nome?.trim() || !email?.trim() || !novaSenha) {
    return res.render("register", {
      usuario: null,
      error: "Preencha todos os campos obrigatórios.",
    });
  }

  if (novaSenha !== confirmarSenha) {
    return res.render("register", {
      usuario: null,
      error: "As senhas não coincidem.",
    });
  }

  if (novaSenha.length < 8) {
    return res.render("register", {
      usuario: null,
      error: "A senha deve ter no mínimo 8 caracteres.",
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [usuariosExistentes] = await connection.query(
      "SELECT codUsuario FROM usuario WHERE email = ?",
      [email],
    );

    if (usuariosExistentes.length > 0) {
      await connection.rollback();
      connection.release();
      return res.render("register", {
        usuario: null,
        error: "Já existe uma conta cadastrada com este e-mail.",
      });
    }

    const senhaCriptografada = await bcrypt.hash(novaSenha, 10);

    const [resultadoUsuario] = await connection.query(
      "INSERT INTO usuario (nome, email, senha, tipo) VALUES (?, ?, ?, 'cliente')",
      [nome, email, senhaCriptografada],
    );

    const codUsuario = resultadoUsuario.insertId;

    const enderecoCompleto = `${rua}, Nº ${numero}${
      complemento ? " - " + complemento : ""
    }. Bairro: ${bairro}. ${cidade}-${uf}. CEP: ${cep}`;
    const cpfLimpo = cpfCnpj ? cpfCnpj.replace(/\D/g, "") : null;

    await connection.query(
      "INSERT INTO cliente (codUsuario, telefone, endereco, cpfCnpj, cep) VALUES (?, ?, ?, ?, ?)",
      [
        codUsuario,
        telefone || null,
        enderecoCompleto,
        cpfLimpo,
        String(cep || "").replace(/\D/g, "") || null,
      ],
    );

    await connection.commit();
    connection.release();

    console.log(`Novo cliente cadastrado: ${nome} (${email})`);
    return res.redirect("/login");
  } catch (error) {
    await connection.rollback();
    connection.release();

    console.error("Erro ao cadastrar novo usuário:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.render("register", {
        usuario: null,
        error: "Já existe uma conta cadastrada com este e-mail.",
      });
    }

    return res.render("register", {
      usuario: null,
      error: "Erro interno ao processar o cadastro. Tente novamente.",
    });
  }
});

router.post("/atualizar-usuario", async (req, res) => {
  const {
    codUsuario,
    nome,
    email,
    novaSenha,
    rua,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    cep,
    cpfCnpj,
    telefone,
  } = req.body;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.query(
      "UPDATE usuario SET nome = ?, email = ? WHERE codUsuario = ?",
      [nome, email, codUsuario],
    );

    if (novaSenha && novaSenha.trim() !== "") {
      const senhaCriptografada = await bcrypt.hash(novaSenha, 10);
      await connection.query(
        "UPDATE usuario SET senha = ? WHERE codUsuario = ?",
        [senhaCriptografada, codUsuario],
      );
    }

    const enderecoCompleto = `${rua || ""}, Nº ${numero || ""}${complemento ? " - " + complemento : ""}. Bairro: ${bairro || ""}. ${cidade || ""}-${uf || ""}. CEP: ${cep || ""}`;
    const cpfLimpo = cpfCnpj ? cpfCnpj.replace(/\D/g, "") : null;

    await connection.query(
      "UPDATE cliente SET telefone = ?, endereco = ?, cpfCnpj = ?, cep = ? WHERE codUsuario = ?",
      [
        telefone || null,
        enderecoCompleto,
        cpfLimpo,
        String(cep || "").replace(/\D/g, "") || null,
        codUsuario,
      ],
    );

    await connection.commit();
    connection.release();

    return res.redirect("/login");
  } catch (error) {
    await connection.rollback();
    connection.release();

    console.error("Erro detalhado na atualização:", error);
    return res.render("register", {
      usuario: null,
      error: "Erro interno ao processar atualização no banco de dados.",
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

    const linkRecuperacao = `${process.env.APP_URL || "http://localhost:3005"}/reset-password?token=${token}`;
    const linkRecuperacaoHtml = linkRecuperacao
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    await transportador.sendMail({
      from: `"Estoffe" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Recuperação de senha - Estoffe",
      text: `Olá! Recebemos uma solicitação para redefinir a senha da sua conta Estoffe.\n\nAcesse o link abaixo para criar uma nova senha (válido por 1 hora):\n${linkRecuperacao}\n\nSe você não solicitou a alteração, ignore este e-mail. Sua senha continuará a mesma.`,
      html: `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>Recuperação de senha - Estoffe</title>
</head>
<body style="margin:0; padding:0; background-color:#f3f6f3; font-family:Arial, Helvetica, sans-serif; color:#183323;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f3f6f3; padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden;">
          <tr>
            <td align="center" style="padding:28px 24px; background-color:#123b25;">
              <p style="margin:0; color:#ffffff; font-size:26px; line-height:32px; font-weight:bold; letter-spacing:1px;">ESTOFFE</p>
              <p style="margin:6px 0 0; color:#d8e8dc; font-size:13px; line-height:20px;">Conforto feito para você</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 24px;">
              <p style="margin:0 0 12px; color:#183323; font-size:22px; line-height:30px; font-weight:bold;">Vamos redefinir sua senha?</p>
              <p style="margin:0 0 24px; color:#526258; font-size:15px; line-height:24px;">Recebemos uma solicitação para criar uma nova senha para sua conta Estoffe. Clique no botão abaixo para continuar.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td align="center" bgcolor="#1d5936" style="border-radius:6px;">
                    <a href="${linkRecuperacaoHtml}" style="display:inline-block; padding:14px 28px; color:#ffffff; font-size:15px; line-height:20px; font-weight:bold; text-decoration:none; border-radius:6px;">Criar nova senha</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px; color:#526258; font-size:13px; line-height:20px;">Por segurança, este link expira em <strong>1 hora</strong>.</p>
              <p style="margin:0; color:#526258; font-size:13px; line-height:20px;">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
              <p style="margin:8px 0 0; word-break:break-all; font-size:12px; line-height:19px;"><a href="${linkRecuperacaoHtml}" style="color:#1d5936; text-decoration:underline;">${linkRecuperacaoHtml}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px; border-top:1px solid #e5ebe6;">
              <p style="margin:0 0 8px; color:#526258; font-size:13px; line-height:20px;"><strong>Não foi você?</strong> Ignore esta mensagem. Sua senha continuará a mesma.</p>
              <p style="margin:0; color:#87928a; font-size:12px; line-height:18px;">Esta é uma mensagem automática. Por favor, não responda a este e-mail.</p>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0; color:#87928a; font-size:11px; line-height:16px;">&copy; ${new Date().getFullYear()} Estoffe</p>
      </td>
    </tr>
  </table>
</body>
</html>`,
    });

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
    if (tokens.length === 0) {
      return res.render("reset-password", {
        error: "Token inválido ou expirado.",
        token: null,
      });
    }

    return res.render("reset-password", {
      error: null,
      token: token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao processar solicitação.");
  }
});

router.post("/reset-password", async (req, res) => {
  const { token, novaSenha, confirmarSenha } = req.body;

  if (novaSenha !== confirmarSenha) {
    return res.render("reset-password", {
      error: "As senhas não coincidem.",
      token: token,
    });
  }

  try {
    const [tokenData] = await db.query(
      "SELECT email FROM recuperacao_senha WHERE token = ? AND expiracao > NOW() AND usado = 0",
      [token],
    );

    if (tokenData.length === 0) {
      return res.render("reset-password", {
        error: "Token inválido ou expirado.",
        token: null,
      });
    }

    const email = tokenData[0].email;
    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

    await db.query("UPDATE usuario SET senha = ? WHERE email = ?", [
      novaSenhaHash,
      email,
    ]);

    await db.query("UPDATE recuperacao_senha SET usado = 1 WHERE token = ?", [
      token,
    ]);

    return res.render("reset-password", {
      success: "Sua senha foi atualizada com sucesso!",
      token: null,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro ao redefinir senha.");
  }
});

// ==========================================
// CARRINHO E PEDIDOS DO CLIENTE
// ==========================================

router.post(
  ["/finalizar-compra", "/pedido/finalizar"],
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const observacoes = req.body.observacoes || {};
    const metragemInformada = String(req.body.metragem || "")
      .trim()
      .replace(",", ".");
    const metragem = metragemInformada === "" ? 1 : Number(metragemInformada);
    if (
      metragemInformada !== "" &&
      (!Number.isFinite(metragem) || metragem <= 0)
    ) {
      return res
        .status(400)
        .send("Informe uma metragem válida maior que zero.");
    }

    const connection = await db.getConnection();
    try {
      await db.schemaAgendaPronto;
      await connection.beginTransaction();
      const [clientes] = await connection.query(
        `SELECT c.codCliente, c.cep, c.endereco, u.nome, u.email
           FROM cliente c
           INNER JOIN usuario u ON u.codUsuario = c.codUsuario
          WHERE c.codUsuario = ? FOR UPDATE`,
        [req.session.usuario.codUsuario],
      );
      if (!clientes.length) throw new Error("Cliente não encontrado.");
      const codCliente = clientes[0].codCliente;
      const cepFreteEstimado = normalizarCep(
        clientes[0].cep,
        clientes[0].endereco,
      );
      const fretePreVerificado = await buscarFretePorCep(
        clientes[0].cep,
        clientes[0].endereco,
      );

      const [itens] = await connection.query(
        `SELECT c.codProduto, c.quantidade, p.preco, p.preco_promocional,
                p.promocao_ativa
           FROM carrinho c
           INNER JOIN produto p ON p.codProduto = c.codProduto
          WHERE c.codCliente = ?
          ORDER BY c.codProduto
          FOR UPDATE`,
        [codCliente],
      );
      if (!itens.length) throw new Error("Seu carrinho está vazio.");

      const [codigos] = await connection.query(
        `SELECT percentual, frete_gratis FROM codigo_promocional
          WHERE codigo = ? AND ativo = 1
            AND (validade IS NULL OR validade >= CURDATE())
          LIMIT 1`,
        [req.session.codigoPromocional?.codigo || ""],
      );
      const percentualDesconto = codigos.length
        ? Number(codigos[0].percentual)
        : 0;
      const freteGratisEstimado = Boolean(codigos[0]?.frete_gratis);
      const valorFreteEstimado = freteGratisEstimado
        ? 0
        : fretePreVerificado
          ? Number(fretePreVerificado.valor)
          : null;
      let subtotal = 0;
      const itensComPreco = itens.map((item) => {
        const precoBase = Number(item.preco);
        const precoPromocional = Number(item.preco_promocional);
        const preco =
          item.promocao_ativa &&
          Number.isFinite(precoPromocional) &&
          precoPromocional > 0 &&
          precoPromocional < precoBase
            ? precoPromocional
            : precoBase;
        const quantidade = Number(item.quantidade);
        if (!Number.isFinite(preco) || quantidade <= 0) {
          throw new Error("O carrinho contém preço ou quantidade inválida.");
        }
        const precoUnitario = Number(
          (preco * metragem * (1 - percentualDesconto / 100)).toFixed(2),
        );
        subtotal += precoUnitario * quantidade;
        return { ...item, precoUnitario };
      });
      subtotal = Number(subtotal.toFixed(2));
      if (!Number.isFinite(subtotal) || subtotal <= 0) {
        throw new Error("O valor do orçamento é inválido.");
      }

      const [resultadoPedido] = await connection.query(
        `INSERT INTO pedido
           (codCliente, valorTotal, valorFrete, valorFreteEstimado,
            prazoFreteEstimado, cepFreteEstimado, freteGratisEstimado,
            dataPedido, status)
         VALUES (?, ?, 0, ?, ?, ?, ?, CURDATE(), 'Aguardando Avaliação')`,
        [
          codCliente,
          subtotal,
          valorFreteEstimado,
          fretePreVerificado?.prazo_dias ?? null,
          cepFreteEstimado || null,
          freteGratisEstimado ? 1 : 0,
        ],
      );
      for (const item of itensComPreco) {
        await connection.query(
          `INSERT INTO itempedido
             (codPedido, codProduto, quantidade, precoUnitario, observacao)
           VALUES (?, ?, ?, ?, ?)`,
          [
            resultadoPedido.insertId,
            item.codProduto,
            item.quantidade,
            item.precoUnitario,
            String(observacoes[item.codProduto] || "")
              .trim()
              .slice(0, 255),
          ],
        );
      }
      await connection.query("DELETE FROM carrinho WHERE codCliente = ?", [
        codCliente,
      ]);
      await connection.commit();

      let notificacaoFrete = "enviada";
      if (clientes[0].email) {
        try {
          const resumoFrete = freteGratisEstimado
            ? "Frete pré-estimado: grátis conforme o cupom aplicado."
            : fretePreVerificado
              ? `Frete pré-estimado para o CEP ${cepFreteEstimado}: R$ ${Number(fretePreVerificado.valor).toFixed(2)}${fretePreVerificado.prazo_dias ? `, com prazo estimado de ${fretePreVerificado.prazo_dias} dias úteis` : ""}.`
              : `Não foi possível encontrar uma faixa de frete para o CEP ${cepFreteEstimado || "cadastrado"}. Nossa equipe verificará o valor.`;
          await transportador.sendMail({
            from: process.env.EMAIL_USER,
            to: clientes[0].email,
            subject: `Solicitação recebida - Pedido #${resultadoPedido.insertId} - Estoffe`,
            text: `Olá, ${clientes[0].nome}!\n\nRecebemos sua solicitação do pedido #${resultadoPedido.insertId}.\n${resumoFrete}\n\nEsse valor é uma prévia e será confirmado pela equipe no orçamento final. Você poderá acompanhar a proposta no painel da sua conta.`,
          });
        } catch (errorEmail) {
          console.error(
            `Pedido #${resultadoPedido.insertId} salvo, mas não foi possível enviar o aviso de pré-frete ao cliente:`,
            errorEmail,
          );
          notificacaoFrete = "erro";
        }
      } else {
        console.warn(
          `Pedido #${resultadoPedido.insertId} salvo sem aviso: cliente sem e-mail cadastrado.`,
        );
        notificacaoFrete = "erro";
      }

      delete req.session.codigoPromocional;
      delete req.session.dadosPagamento;
      req.session.cartCount = 0;
      req.session.save((error) => {
        if (error) {
          console.error("Erro ao salvar sessão após gerar orçamento:", error);
          return res.redirect("/client-dashboard");
        }
        res.redirect(`/client-dashboard?pedidoSucesso=orcamento&notificacaoFrete=${notificacaoFrete}`);
      });
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao criar orçamento:", error);
      res.status(400).send(error.message || "Erro ao criar orçamento.");
    } finally {
      connection.release();
    }
  },
);

router.post(
  "/pedido/finalizar",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const usuarioLogado = req.session.usuario;
    const observacoes = req.body.observacoes || {};
    const metragemInformada = String(req.body.metragem || "")
      .trim()
      .replace(",", ".");
    const metragem = metragemInformada === "" ? 1 : Number(metragemInformada);

    if (
      metragemInformada !== "" &&
      (!Number.isFinite(metragem) || metragem <= 0)
    ) {
      return res
        .status(400)
        .send("Informe uma metragem válida maior que zero.");
    }

    const conexao = await db.getConnection();

    try {
      await conexao.beginTransaction();

      const [clientes] = await conexao.query(
        `SELECT c.codCliente, c.cpfCnpj, c.telefone, c.endereco, c.cep, c.idAsaas,
                u.nome, u.email
         FROM cliente c
         INNER JOIN usuario u ON u.codUsuario = c.codUsuario
         WHERE c.codUsuario = ?`,
        [usuarioLogado.codUsuario],
      );
      if (clientes.length === 0) {
        throw new Error("Cliente não encontrado.");
      }

      const codCliente = clientes[0].codCliente;
      let idClienteAsaas = clientes[0].idAsaas;
      const frete = await buscarFretePorCep(
        clientes[0].cep,
        clientes[0].endereco,
      );
      if (!frete) {
        throw new Error(
          "Não foi possível calcular o frete. Atualize seu CEP no perfil.",
        );
      }

      const [itensCarrinho] = await conexao.query(
        `SELECT c.*, p.preco, p.preco_promocional, p.promocao_ativa
         FROM carrinho c 
         INNER JOIN produto p ON c.codProduto = p.codProduto 
         WHERE c.codCliente = ?
         FOR UPDATE`,
        [codCliente],
      );

      if (!itensCarrinho || itensCarrinho.length === 0) {
        throw new Error("Seu carrinho está vazio.");
      }

      let subtotalPedido = 0;
      itensCarrinho.forEach((item) => {
        const precoOriginal = Number(item.preco);
        const precoPromocional = Number(item.preco_promocional);
        const precoItem =
          item.promocao_ativa &&
          Number.isFinite(precoPromocional) &&
          precoPromocional > 0 &&
          precoPromocional < precoOriginal
            ? precoPromocional
            : precoOriginal;
        const quantidade = Number(item.quantidade);
        if (
          !Number.isFinite(precoItem) ||
          !Number.isFinite(quantidade) ||
          quantidade <= 0
        ) {
          throw new Error(
            "O carrinho contém um produto com preço ou quantidade inválida.",
          );
        }
        subtotalPedido += precoItem * quantidade * metragem;
      });
      const [codigosPromocionais] = await conexao.query(
        `SELECT codigo, percentual, frete_gratis
           FROM codigo_promocional
          WHERE codigo = ? AND ativo = 1
            AND (validade IS NULL OR validade >= CURDATE())
          LIMIT 1`,
        [req.session.codigoPromocional?.codigo || ""],
      );
      const codigoPromocional = codigosPromocionais[0] || null;
      const percentualCodigo = codigoPromocional
        ? Number(codigoPromocional.percentual)
        : 0;
      const descontoCodigo = (subtotalPedido * percentualCodigo) / 100;
      const valorFrete = codigoPromocional?.frete_gratis
        ? 0
        : Number(frete.valor);
      const valorTotalPedido = Number(
        (subtotalPedido - descontoCodigo + valorFrete).toFixed(2),
      );
      if (!Number.isFinite(valorTotalPedido) || valorTotalPedido <= 0) {
        throw new Error("O valor total do pedido é inválido.");
      }

      const [resultadoPedido] = await conexao.query(
        "INSERT INTO pedido (codCliente, valorTotal, dataPedido, status) VALUES (?, ?, CURDATE(), 'Aberto')",
        [codCliente, valorTotalPedido],
      );

      const idNovoPedido = resultadoPedido.insertId;

      for (const item of itensCarrinho) {
        const observacao = String(observacoes[item.codProduto] || "")
          .trim()
          .slice(0, 255);
        const precoOriginal = Number(item.preco);
        const precoPromocional = Number(item.preco_promocional);
        const precoItem =
          item.promocao_ativa &&
          Number.isFinite(precoPromocional) &&
          precoPromocional > 0 &&
          precoPromocional < precoOriginal
            ? precoPromocional
            : precoOriginal;

        await conexao.query(
          `INSERT INTO itempedido
             (codPedido, codProduto, quantidade, precoUnitario, observacao)
           VALUES (?, ?, ?, ?, ?)`,
          [
            idNovoPedido,
            item.codProduto,
            item.quantidade,
            precoItem * metragem * (1 - percentualCodigo / 100),
            observacao,
          ],
        );
      }

      if (pagamentoTesteAtivo()) {
        await aprovarPagamentoSimulado(
          conexao,
          idNovoPedido,
          valorTotalPedido,
        );
        await conexao.query("DELETE FROM carrinho WHERE codCliente = ?", [
          codCliente,
        ]);
        await conexao.commit();
        delete req.session.codigoPromocional;
        req.session.cartCount = 0;
        return req.session.save((err) => {
          if (err) {
            console.error("Erro ao salvar sessão do pedido de teste:", err);
            return res.redirect("/client-dashboard");
          }
          return res.redirect("/client-dashboard");
        });
      }

      const tokenAsaas = process.env.ASAAS_TOKEN;
      if (!tokenAsaas) {
        throw new Error("A variável ASAAS_TOKEN não está configurada.");
      }

      if (!idClienteAsaas) {
        try {
          const cpfCnpj = clientes[0].cpfCnpj?.replace(/\D/g, "");
          if (!validarCpfCnpj(cpfCnpj)) {
            await conexao.rollback();
            return res.redirect("/perfil?error=cpf_invalido");
          }

          const respostaNovoCliente = await axios.post(
            "https://api-sandbox.asaas.com/v3/customers",
            {
              name: clientes[0].nome,
              email: clientes[0].email,
              cpfCnpj,
              phone: clientes[0].telefone || undefined,
              externalReference: String(usuarioLogado.codUsuario),
              notificationDisabled: true,
            },
            { headers: { access_token: tokenAsaas } },
          );

          idClienteAsaas = respostaNovoCliente.data.id;
          if (!idClienteAsaas) {
            throw new Error("A API Asaas não retornou o ID do cliente.");
          }

          await conexao.query(
            "UPDATE cliente SET idAsaas = ? WHERE codCliente = ?",
            [idClienteAsaas, codCliente],
          );
          console.log(`Cliente criado no Asaas com ID ${idClienteAsaas}.`);
        } catch (errAsaas) {
          console.error("Falha crítica ao sincronizar cliente com o Asaas:");
          if (errAsaas.response) console.error(errAsaas.response.data);
          throw errAsaas;
        }
      }

      console.log(`Solicitando Pix para o cliente Asaas: ${idClienteAsaas}`);
      const respostaAsaas = await axios.post(
        "https://api-sandbox.asaas.com/v3/payments",
        {
          customer: idClienteAsaas,
          billingType: "PIX",
          value: Number(valorTotalPedido),
          dueDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
          externalReference: String(idNovoPedido),
          description: `Pedido #${idNovoPedido} na Estoffe`,
        },
        {
          headers: { access_token: tokenAsaas },
        },
      );

      const idPagamento = respostaAsaas.data.id;

      console.log(`Buscando QR Code do Pix para o pagamento: ${idPagamento}`);

      const respostaQrCode = await axios.get(
        `https://api-sandbox.asaas.com/v3/payments/${idPagamento}/pixQrCode`,
        {
          headers: { access_token: tokenAsaas },
        },
      );

      const dadosPix = respostaQrCode.data;
      const pixCopiaECola = dadosPix.payload;
      const pixQrCodeImagem = dadosPix.encodedImage;

      await conexao.query(
        "INSERT INTO pagamento (codPedido, valor, formaPagamento, status) VALUES (?, ?, 'PIX', 'Pendente')",
        [idNovoPedido, valorTotalPedido],
      );

      await conexao.query("DELETE FROM carrinho WHERE codCliente = ?", [
        codCliente,
      ]);

      await conexao.commit();

      delete req.session.codigoPromocional;
      req.session.cartCount = 0;

      req.session.dadosPagamento = {
        copiaECola: pixCopiaECola,
        qrCode: pixQrCodeImagem,
        total: valorTotalPedido,
        idPedido: idNovoPedido,
      };

      req.session.save((err) => {
        if (err) {
          console.error("Erro ao salvar sessão do pagamento:", err);
          return res.redirect("/client-dashboard");
        }
        res.redirect("/pedido/pagamento");
      });
    } catch (error) {
      await conexao.rollback();
      console.error(
        "Erro ao finalizar pedido com Asaas:",
        error.response ? error.response.data : error.message,
      );

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

router.post(
  "/pedido/:id/pagar",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const codPedido = Number(req.params.id);
    if (!Number.isSafeInteger(codPedido) || codPedido <= 0) {
      return res.status(400).send("Pedido inválido.");
    }

    try {
      await db.schemaAgendaPronto;
      const [pedidos] = await db.query(
        `SELECT p.codPedido, p.valorTotal, p.status, p.statusOrcamento,
                c.codCliente, c.idAsaas,
                c.cpfCnpj, c.telefone, u.nome, u.email
           FROM pedido p
           INNER JOIN cliente c ON c.codCliente = p.codCliente
           INNER JOIN usuario u ON u.codUsuario = c.codUsuario
          WHERE p.codPedido = ? AND c.codUsuario = ?
          LIMIT 1`,
        [codPedido, req.session.usuario.codUsuario],
      );
      if (!pedidos.length)
        return res.status(404).send("Pedido não encontrado.");
      const pedido = pedidos[0];
      if (pedido.status !== "Aguardando Pagamento") {
        return res
          .status(409)
          .send("Este pedido ainda não está liberado para pagamento.");
      }
      if (pedido.statusOrcamento === "Pendente" || pedido.statusOrcamento === "Recusado") {
        return res.status(409).send("Aprove o orçamento antes de iniciar o pagamento.");
      }

      if (Number(req.session.pedidoPendentePagamento) === codPedido) {
        delete req.session.pedidoPendentePagamento;
      }

      const [pagamentos] = await db.query(
        `SELECT status, asaasPaymentId
           FROM pagamento
          WHERE codPedido = ?
          ORDER BY codPagamento DESC
          LIMIT 1`,
        [codPedido],
      );
      if (pagamentos[0]?.status === "Aprovado") {
        return res.redirect("/client-dashboard");
      }

      if (pagamentoTesteAtivo()) {
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          const [pedidosBloqueados] = await connection.query(
            "SELECT valorTotal, status, statusOrcamento FROM pedido WHERE codPedido = ? FOR UPDATE",
            [codPedido],
          );
          if (!pedidosBloqueados.length) {
            await connection.rollback();
            return res.status(404).send("Pedido não encontrado.");
          }
          if (pedidosBloqueados[0].status !== "Aguardando Pagamento") {
            await connection.rollback();
            if (pedidosBloqueados[0].status === "Pago") {
              return res.redirect("/client-dashboard");
            }
            return res.status(409).send("Este pedido não está aguardando pagamento.");
          }
          if (
            pedidosBloqueados[0].statusOrcamento === "Pendente" ||
            pedidosBloqueados[0].statusOrcamento === "Recusado"
          ) {
            await connection.rollback();
            return res.status(409).send("Aprove o orçamento antes de iniciar o pagamento.");
          }

          await aprovarPagamentoSimulado(
            connection,
            codPedido,
            pedidosBloqueados[0].valorTotal,
          );
          await connection.commit();
          delete req.session.dadosPagamento;
          return req.session.save((saveError) => {
            if (saveError) {
              console.error("Erro ao salvar sessão do pagamento de teste:", saveError);
              return res.redirect("/client-dashboard");
            }
            return res.redirect("/client-dashboard");
          });
        } catch (error) {
          await connection.rollback();
          if (error.code === "ESTOQUE_INSUFICIENTE") {
            return res.status(409).send(error.message);
          }
          console.error("Erro ao simular pagamento:", error);
          return res.status(500).send("Erro ao simular o pagamento.");
        } finally {
          connection.release();
        }
      }

      const tokenAsaas = process.env.ASAAS_TOKEN;
      if (!tokenAsaas) {
        return res
          .status(500)
          .send("A variável ASAAS_TOKEN não está configurada.");
      }

      let idAsaas = pedido.idAsaas;
      if (!idAsaas) {
        const cpfCnpj = String(pedido.cpfCnpj || "").replace(/\D/g, "");
        if (!validarCpfCnpj(cpfCnpj)) {
          req.session.pedidoPendentePagamento = codPedido;
          const erro = cpfCnpj ? "cpf_invalido" : "cpf_obrigatorio";
          return req.session.save((saveError) => {
            if (saveError) {
              console.error(
                "Erro ao salvar pedido pendente de pagamento:",
                saveError,
              );
              return res
                .status(500)
                .send("Não foi possível retomar o pagamento.");
            }
            return res.redirect(`/perfil?error=${erro}`);
          });
        }
        const respostaCliente = await axios.post(
          "https://api-sandbox.asaas.com/v3/customers",
          {
            name: pedido.nome,
            email: pedido.email,
            cpfCnpj,
            phone: pedido.telefone || undefined,
            externalReference: String(req.session.usuario.codUsuario),
            notificationDisabled: true,
          },
          { headers: { access_token: tokenAsaas } },
        );
        idAsaas = respostaCliente.data.id;
        if (!idAsaas) throw new Error("O Asaas não retornou o ID do cliente.");
        await db.query("UPDATE cliente SET idAsaas = ? WHERE codCliente = ?", [
          idAsaas,
          pedido.codCliente,
        ]);
      }

      let idPagamento = pagamentos[0]?.asaasPaymentId;
      if (!idPagamento) {
        const respostaPagamento = await axios.post(
          "https://api-sandbox.asaas.com/v3/payments",
          {
            customer: idAsaas,
            billingType: "PIX",
            value: Number(pedido.valorTotal),
            dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
            externalReference: String(codPedido),
            description: `Pedido #${codPedido} na Estoffe`,
          },
          { headers: { access_token: tokenAsaas } },
        );
        idPagamento = respostaPagamento.data.id;
        if (!idPagamento)
          throw new Error("O Asaas não retornou o ID do pagamento.");
        await db.query(
          `INSERT INTO pagamento
             (codPedido, valor, formaPagamento, status, asaasPaymentId)
           VALUES (?, ?, 'PIX', 'Pendente', ?)`,
          [codPedido, pedido.valorTotal, idPagamento],
        );
      }

      const respostaQrCode = await axios.get(
        `https://api-sandbox.asaas.com/v3/payments/${idPagamento}/pixQrCode`,
        { headers: { access_token: tokenAsaas } },
      );
      req.session.dadosPagamento = {
        copiaECola: respostaQrCode.data.payload,
        qrCode: respostaQrCode.data.encodedImage,
        total: Number(pedido.valorTotal),
        idPedido: codPedido,
      };
      req.session.save((error) => {
        if (error) {
          console.error("Erro ao salvar sessão do pagamento:", error);
          return res.status(500).send("Não foi possível iniciar o pagamento.");
        }
        return res.redirect("/pedido/pagamento");
      });
    } catch (error) {
      console.error(
        "Erro ao iniciar pagamento do pedido:",
        error.response?.data || error.message,
      );
      return res.status(500).send("Erro ao iniciar o pagamento pelo Asaas.");
    }
  },
);

router.get(
  "/pedido/pagamento",
  verificarAutenticacao(["cliente"]),
  (req, res) => {
    const pagamento = req.session.dadosPagamento;

    if (!pagamento) {
      return res.redirect("/client-dashboard");
    }

    res.render("pagamento", { pagamento: pagamento });
  },
);

router.post(
  "/pedido/:id/orcamento/resposta",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const codPedido = Number(req.params.id);
    const decisao = String(req.body.decisao || "");
    if (
      !Number.isSafeInteger(codPedido) ||
      codPedido <= 0 ||
      !["Aprovado", "Recusado"].includes(decisao)
    ) {
      return res.status(400).send("Pedido ou decisão inválida.");
    }

    const connection = await db.getConnection();
    try {
      await db.schemaAgendaPronto;
      await connection.beginTransaction();
      const [pedidos] = await connection.query(
        `SELECT p.status, p.statusOrcamento, u.email
           FROM pedido p
           INNER JOIN cliente c ON c.codCliente = p.codCliente
           INNER JOIN usuario u ON u.codUsuario = c.codUsuario
          WHERE p.codPedido = ? AND c.codUsuario = ?
          FOR UPDATE`,
        [codPedido, req.session.usuario.codUsuario],
      );
      if (!pedidos.length) {
        await connection.rollback();
        return res.status(404).send("Pedido não encontrado.");
      }
      if (
        pedidos[0].statusOrcamento !== "Pendente" ||
        pedidos[0].status !== "Aguardando Pagamento"
      ) {
        await connection.rollback();
        return res.status(409).send("Este orçamento não está aguardando uma resposta.");
      }

      await connection.query(
        "UPDATE pedido SET statusOrcamento = ?, status = ? WHERE codPedido = ?",
        [decisao, decisao === "Recusado" ? "Cancelado" : "Aguardando Pagamento", codPedido],
      );
      await connection.commit();

      let notificacao = "enviada";
      try {
        await transportador.sendMail({
          from: process.env.EMAIL_USER,
          to: pedidos[0].email,
          subject: `Orçamento ${decisao.toLowerCase()} - Pedido #${codPedido}`,
          text: decisao === "Aprovado"
            ? `Sua aprovação do orçamento do pedido #${codPedido} foi registrada. Agora você pode efetuar o pagamento pelo seu painel Estoffe.`
            : `Sua recusa do orçamento do pedido #${codPedido} foi registrada. Se desejar, entre em contato com a Estoffe para conversar sobre a proposta.`,
        });
      } catch (error) {
        console.error(`Erro ao confirmar decisão do orçamento #${codPedido} por e-mail:`, error);
        notificacao = "erro";
      }
      return res.redirect(`/client-dashboard?orcamento=${decisao.toLowerCase()}&notificacao=${notificacao}`);
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao registrar decisão do orçamento:", error);
      return res.status(500).send("Erro interno ao registrar sua decisão.");
    } finally {
      connection.release();
    }
  },
);

// ROTA: Painel do Cliente
router.get(
  "/client-dashboard",
  verificarAutenticacao(["cliente"]),
  async (req, res) => {
    const usuarioLogado = req.session.usuario;

    try {
      await db.schemaNotificacoesPronto;
      const [clientes] = await db.query(
        "SELECT codCliente FROM cliente WHERE codUsuario = ?",
        [usuarioLogado.codUsuario],
      );

      let pedidos = [];
      if (clientes.length > 0) {
        const codCliente = clientes[0].codCliente;
        [pedidos] = await db.query(
          `SELECT p.*, p.valorTotal AS valor_final,
                  DATE_FORMAT(p.dataPedido, '%Y-%m-%d') AS dataPedidoFormatada,
                  DATE_FORMAT(p.dataColeta, '%Y-%m-%d') AS dataColetaFormatada,
                  DATE_FORMAT(p.dataEntrega, '%Y-%m-%d') AS dataEntregaFormatada,
                  pg.status AS statusPagamento
           FROM pedido p
           LEFT JOIN pagamento pg ON pg.codPedido = p.codPedido
           WHERE p.codCliente = ?
           ORDER BY p.dataPedido DESC, p.codPedido DESC`,
          [codCliente],
        );
        pedidos.forEach((pedido) => {
          pedido.fotosAcompanhamento = [];
        });
        if (pedidos.length) {
          const codigosPedidos = pedidos.map((pedido) => pedido.codPedido);
          const [fotos] = await db.query(
            `SELECT codPedido, codFoto, caminhoImagem, legenda, criadaEm
               FROM foto_acompanhamento
              WHERE codPedido IN (?)
              ORDER BY criadaEm DESC, codFoto DESC`,
            [codigosPedidos],
          );
          const fotosPorPedido = new Map();
          fotos.forEach((foto) => {
            if (!fotosPorPedido.has(foto.codPedido)) fotosPorPedido.set(foto.codPedido, []);
            fotosPorPedido.get(foto.codPedido).push(foto);
          });
          pedidos.forEach((pedido) => {
            pedido.fotosAcompanhamento = fotosPorPedido.get(pedido.codPedido) || [];
          });
        }
      }

      res.render("client/client-dashboard", {
        usuario: usuarioLogado,
        pedidos: pedidos,
        notificacaoOrcamento: req.query.notificacao === "erro" ? "erro" : req.query.notificacao === "enviada" ? "enviada" : null,
        decisaoOrcamento: ["aprovado", "recusado"].includes(req.query.orcamento) ? req.query.orcamento : null,
        continuarPagamento:
          req.query.retomarPagamento === "1" &&
          Number.isSafeInteger(Number(req.session.pedidoPendentePagamento))
            ? Number(req.session.pedidoPendentePagamento)
            : null,
        pagamento: req.session.dadosPagamento || null,
        sucesso: req.query.sucesso || null,
        pedidoSucesso: req.query.pedidoSucesso || null,
        notificacaoFrete:
          req.query.notificacaoFrete === "erro" ? "erro" : "enviada",
      });
    } catch (error) {
      console.error("Erro ao carregar o dashboard do cliente:", error);
      res.status(500).send("Erro interno ao carregar o painel do cliente.");
    }
  },
);

router.get("/perfil", verificarAutenticacao(["cliente"]), async (req, res) => {
  const usuarioLogado = req.session.usuario;

  try {
    const [clientes] = await db.query(
      "SELECT codCliente, telefone, endereco, cpfCnpj, cep FROM cliente WHERE codUsuario = ?",
      [usuarioLogado.codUsuario],
    );

    const dadosCliente = clientes[0] || { telefone: null, endereco: null };
    const cepCliente = normalizarCep(dadosCliente.cep, dadosCliente.endereco);
    if (!dadosCliente.cep && cepCliente && dadosCliente.codCliente) {
      await db.query("UPDATE cliente SET cep = ? WHERE codCliente = ?", [
        cepCliente,
        dadosCliente.codCliente,
      ]);
    }

    res.render("client/perfil", {
      usuario: usuarioLogado,
      telefone: formatarTelefone(dadosCliente.telefone),
      endereco: dadosCliente.endereco,
      cpf: formatarCpfCnpj(dadosCliente.cpfCnpj),
      cep: formatarCep(cepCliente),
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
    const { nome, telefone, cpf, cep, endereco, novaSenha, confirmarSenha } =
      req.body;
    const usuarioLogado = req.session.usuario;

    if (!nome?.trim()) return res.status(400).send("O nome é obrigatório.");

    const cpfLimpo = String(cpf || "").replace(/\D/g, "");
    if (cpfLimpo && !validarCpfCnpj(cpfLimpo)) {
      return res.redirect("/perfil?error=cpf_invalido");
    }

    try {
      await db.query("UPDATE usuario SET nome = ? WHERE codUsuario = ?", [
        nome,
        usuarioLogado.codUsuario,
      ]);
      await db.query(
        "UPDATE cliente SET telefone = ?, cpfCnpj = ?, endereco = ?, cep = ? WHERE codUsuario = ?",
        [
          telefone || null,
          cpfLimpo || null,
          endereco || null,
          String(cep || "").replace(/\D/g, "") || null,
          usuarioLogado.codUsuario,
        ],
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

      if (req.session.pedidoPendentePagamento && cpfLimpo) {
        return req.session.save((erro) => {
          if (erro) {
            console.error(
              "Erro ao salvar sessão antes de retomar pagamento:",
              erro,
            );
            return res
              .status(500)
              .send(
                "Perfil atualizado, mas não foi possível retomar o pagamento.",
              );
          }
          return res.redirect("/client-dashboard?retomarPagamento=1");
        });
      }

      res.redirect("/perfil");
    } catch (error) {
      console.error(error);
      res.status(500).send("Erro interno.");
    }
  },
);

module.exports = router;
