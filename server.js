const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const csrf = require("csurf");

// Importações de config
const db = require(
  path.join(__dirname, "BackEnd", "src", "config", "database.js"),
);
const transportador = require(
  path.join(__dirname, "BackEnd", "src", "config", "mailer.js"),
);
const passport = require(
  path.join(__dirname, "BackEnd", "src", "config", "passport.js"),
);

if (!process.env.JWT_SECRET) {
  console.error("CRÍTICO: JWT_SECRET não definida no arquivo .env!");
  process.exit(1);
}

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  port: process.env.PORT || 3005,
};
// Inicializar app
const app = express();

// ==========================================
// 1. CONFIGURAÇÕES E MIDDLEWARES BÁSICOS
// ==========================================

app.set("views", path.join(__dirname, "FrontEnd", "pages"));
app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "FrontEnd")));
app.use(cookieParser());

// ==========================================
// 2. CONFIGURAÇÃO DE SESSÃO E AUTENTICAÇÃO
// ==========================================

app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

// Passport precisa ser inicializado APÓS a sessão
app.use(passport.initialize());

// CSRF Protection (Configurado após express-session e cookie-parser)
const csrfProtection = csrf({ cookie: true });
app.use((req, res, next) => {
  const uploadMultipartAutenticado =
    req.method === "POST" &&
    req.is("multipart/form-data") &&
    (req.path === "/admin/produtos/salvar" ||
      /^\/admin\/produtos\/\d+\/editar$/.test(req.path) ||
      /^\/estofador\/pedido\/\d+\/fotos$/.test(req.path));
  if (req.path === "/webhooks/asaas" || uploadMultipartAutenticado) {
    return next();
  }
  csrfProtection(req, res, (error) => {
    if (!error) return next();
    return next(error);
  });
});

// Disponibiliza o token CSRF pra todas as views
app.use((req, res, next) => {
  if (typeof req.csrfToken === "function") {
    res.locals.csrfToken = req.csrfToken();
  }
  res.locals.currentPath = req.path;
  next();
});

// O banco inicializa o contador uma vez; as rotas do carrinho mantêm a sessão atualizada.
app.use(async (req, res, next) => {
  if (req.session?.usuario?.tipo !== "cliente") {
    res.locals.cartCount = 0;
    return next();
  }

  if (!Number.isFinite(Number(req.session.cartCount))) {
    try {
      const [[{ codCliente } = {}]] = await db.query(
        "SELECT codCliente FROM cliente WHERE codUsuario = ?",
        [req.session.usuario.codUsuario],
      );
      if (codCliente) {
        const [[{ total } = { total: 0 }]] = await db.query(
          "SELECT COALESCE(SUM(quantidade),0) AS total FROM carrinho WHERE codCliente = ?",
          [codCliente],
        );
        req.session.cartCount = Number(total);
      } else {
        req.session.cartCount = 0;
      }
    } catch (e) {
      console.error("Erro ao calcular cartCount:", e);
      req.session.cartCount = 0;
    }
  }
  res.locals.cartCount = Number(req.session.cartCount) || 0;
  next();
});

// ==========================================
// 3. ROTAS PÚBLICAS (GET)
// ==========================================

app.get("/", (req, res) => {
  res.render("index", { usuario: req.session?.usuario || null });
});

function normalizarCaminhoImagem(caminho) {
  const valor = String(caminho || "").trim();
  if (!valor || /^(https?:|data:)/i.test(valor) || valor.startsWith("/")) {
    return valor;
  }
  return `/${valor.replace(/^(\.\.\/|\.\/)+/, "")}`;
}

app.get("/produtos", async (req, res) => {
  try {
    const categoriaParam = Number.parseInt(req.query.categoria, 10);
    const categoriaAtiva =
      Number.isInteger(categoriaParam) && categoriaParam > 0
        ? categoriaParam
        : null;
    const consultaProdutos = categoriaAtiva
      ? [
          `SELECT p.*, c.nome AS nome_categoria,
                  CASE WHEN p.promocao_ativa = 1
                         AND p.preco_promocional IS NOT NULL
                         AND p.preco_promocional > 0
                         AND p.preco_promocional < p.preco
                       THEN p.preco_promocional ELSE p.preco END AS preco_atual
             FROM produto p
             LEFT JOIN categoria c ON c.codCategoria = p.codCategoria
             WHERE p.codCategoria = ? AND p.sob_medida = 0`,
          [categoriaAtiva],
        ]
      : [
          `SELECT p.*, c.nome AS nome_categoria,
                  CASE WHEN p.promocao_ativa = 1
                         AND p.preco_promocional IS NOT NULL
                         AND p.preco_promocional > 0
                         AND p.preco_promocional < p.preco
                       THEN p.preco_promocional ELSE p.preco END AS preco_atual
             FROM produto p
             LEFT JOIN categoria c ON c.codCategoria = p.codCategoria
             WHERE p.sob_medida = 0`,
        ];
    const [listaProdutos] = await db.query(...consultaProdutos);
    listaProdutos.forEach((produto) => {
      produto.imagem = normalizarCaminhoImagem(produto.imagem);
    });
    const [listaCategorias] = await db.query(
      "SELECT codCategoria, nome FROM categoria ORDER BY nome",
    );

    res.render("produtos", {
      produtos: listaProdutos,
      categorias: listaCategorias,
      categoriaAtiva,
      usuario: req.session?.usuario || null,
    });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).send("Erro no servidor");
  }
});

app.get("/produtos-sob-medida", async (req, res) => {
  try {
    const [produtosSobMedida] = await db.query(
      `SELECT p.*, c.nome AS nome_categoria,
              CASE WHEN p.promocao_ativa = 1
                     AND p.preco_promocional IS NOT NULL
                     AND p.preco_promocional > 0
                     AND p.preco_promocional < p.preco
                   THEN p.preco_promocional ELSE p.preco END AS preco_atual
       FROM produto p
       LEFT JOIN categoria c ON c.codCategoria = p.codCategoria
       WHERE p.sob_medida = 1
       ORDER BY p.nome ASC`,
    );
    produtosSobMedida.forEach((produto) => {
      produto.imagem = normalizarCaminhoImagem(produto.imagem);
    });

    res.render("produtos-sob-medida", {
      produtos: produtosSobMedida,
      usuario: req.session?.usuario || null,
    });
  } catch (error) {
    console.error("Erro ao buscar produtos sob medida:", error);
    res.status(500).send("Erro no servidor");
  }
});

app.get("/produtos/:id", async (req, res) => {
  try {
    const idProduto = Number(req.params.id);

    if (!Number.isInteger(idProduto) || idProduto < 1) {
      return res
        .status(404)
        .render("404", { usuario: req.session?.usuario || null });
    }

    const [produtos] = await db.query(
      `SELECT p.*, c.nome AS nome_categoria,
              CASE WHEN p.promocao_ativa = 1
                     AND p.preco_promocional IS NOT NULL
                     AND p.preco_promocional > 0
                     AND p.preco_promocional < p.preco
                   THEN p.preco_promocional ELSE p.preco END AS preco_atual
       FROM produto p
       LEFT JOIN categoria c ON c.codCategoria = p.codCategoria
       WHERE p.codProduto = ?`,
      [idProduto],
    );

    const imagensProduto = [];
    const produto = produtos[0];
    if (produto) {
      produto.imagem = normalizarCaminhoImagem(produto.imagem);
      const imagens = String(produto.galeria_imagens || "")
        .split(";")
        .map(normalizarCaminhoImagem)
        .filter(Boolean);
      imagens.unshift(produto.imagem || "");
      const imagensUnicas = [...new Set(imagens.filter(Boolean))];
      produto.galeria = imagensUnicas;
    }

    if (!produtos.length) {
      return res
        .status(404)
        .render("404", { usuario: req.session?.usuario || null });
    }

    const [materiais] = await db.query(
      `SELECT m.nome, pm.quantidadeUsada
       FROM produtomaterial pm
       INNER JOIN material m ON m.codMaterial = pm.codMaterial
       WHERE pm.codProduto = ?
       ORDER BY m.nome ASC`,
      [idProduto],
    );

    res.render("produto-detalhe", {
      produto,
      materiais,
      usuario: req.session?.usuario || null,
    });
  } catch (error) {
    console.error("Erro ao carregar detalhe do produto:", error);
    res.status(500).send("Erro ao carregar o produto.");
  }
});

app.get("/sobre", (req, res) => {
  res.render("sobre", { usuario: req.session?.usuario || null });
});

app.get("/contato", (req, res) => {
  res.render("contato", { usuario: req.session?.usuario || null });
});

app.get("/orcamento-sob-medida", (req, res) => {
  res.render("orcamento-sob-medida", {
    usuario: req.session?.usuario || null,
    produto: String(req.query.produto || ""),
    sucesso: req.query.sucesso === "true",
  });
});

// ==========================================
// 4. IMPORTAÇÃO DE ROTAS EXTERNAS
// ==========================================

const UsuarioRoutes = require(
  path.join(__dirname, "BackEnd", "src", "routes", "UsuarioRoutes"),
);
app.use("/", UsuarioRoutes);

const AdminRoutes = require(
  path.join(__dirname, "BackEnd", "src", "routes", "AdminRoutes"),
);
app.use("/", AdminRoutes);

const EstofadorRoutes = require(
  path.join(__dirname, "BackEnd", "src", "routes", "EstofadorRoutes"),
);
app.use("/", EstofadorRoutes);

const NotificacaoRoutes = require(
  path.join(__dirname, "BackEnd", "src", "routes", "NotificacaoRoutes"),
);
app.use("/", NotificacaoRoutes);

const CarrinhoRoutes = require(
  path.join(__dirname, "BackEnd", "src", "routes", "CarrinhoRoutes.js"),
);
app.use("/", CarrinhoRoutes);

const WebhookController = require(
  path.join(__dirname, "BackEnd", "src", "controllers", "WebhookController.js"),
);
app.use("/", WebhookController);

// ==========================================
// 5. TRATAMENTO DE ERROS 404
// ==========================================

app.use((req, res) => {
  if (req.path.startsWith("/admin/api/")) {
    return res.status(404).json({ error: "Endpoint da API não encontrado." });
  }
  res.status(404).render("404", { usuario: req.session?.usuario || null });
});

// ==========================================
// 6. TRATAMENTO DE ERROS GLOBAL
// ==========================================

app.use((err, req, res, next) => {
  if (req.path.startsWith("/admin/api/")) {
    if (err.code === "EBADCSRFTOKEN") {
      return res
        .status(403)
        .json({
          error: "Sua sessão expirou. Atualize a página e tente novamente.",
        });
    }
    console.error("Erro na API administrativa:", err);
    return res
      .status(500)
      .json({ error: "Erro interno na API administrativa." });
  }
  if (err.code === "EBADCSRFTOKEN") {
    return res
      .status(403)
      .send("Formulário expirado ou inválido. Recarregue a página.");
  }
  next(err);
});

app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err);
  res.status(500).render("500", {
    usuario: req.session?.usuario || null,
    mensagem: "Ocorreu um erro interno no servidor.",
  });
});

// ==========================================
// 7. INICIALIZAÇÃO DO SERVIDOR
// ==========================================

app.listen(module.exports.port, () => {
  console.log(`=================================`);
  console.log(`Servidor Estoffe iniciado!`);
  console.log(`Acesse: http://localhost:${module.exports.port}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || "desenvolvimento"}`);
  console.log(`=================================`);
});
