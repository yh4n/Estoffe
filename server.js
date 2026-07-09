require("dotenv").config();
const express = require("express");
const path = require("path");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

const db = require(path.join(__dirname, "BackEnd","src", "config", "database.js"));

// Configuração do nodemailer usando variáveis de ambiente
const transportador = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const app = express();
const PORT = process.env.PORT || 3005;

// ==========================================
// 1. CONFIGURAÇÕES E MIDDLEWARES
// ==========================================

// Configuração de Views (EJS)
app.use(express.static(path.join(__dirname, "FrontEnd")));
app.set("views", path.join(__dirname, "FrontEnd", "pages"));
app.set("view engine", "ejs");

// Parsers para ler dados de formulários e JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Servir arquivos estáticos (CSS, Imagens, JS do Front)
app.use(express.static(path.join(__dirname, "FrontEnd")));

// Configuração da Sessão
app.use(
  session({
    secret: process.env.SESSION_SECRET || "EstoffeMoveisPlanejados2026",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }),
);

// ==========================================
// 2. ROTA GET
// ==========================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.render("index", { usuario: req.session.usuario || null });
});

app.get("/produtos", async (req, res) => {
  try {
    const [listaProdutos] = await db.query("SELECT * FROM produto");
    const [listaCategorias] = await db.query("SELECT codCategoria FROM categoria");

    res.render("produtos", {
      produtos: listaProdutos,
      categorias: listaCategorias,
      categoriaAtiva: null
    });
  } catch (error) {
    console.error("Erro ao buscar produtos:", error);
    res.status(500).send("Erro no servidor");
  }
});

app.get("/sobre", (req, res) => {
  res.render("sobre", { usuario: req.session.usuario || null });
});

app.get("/contato", (req, res) => {
  res.render("contato", { usuario: req.session.usuario || null });
});

// ==========================================
// 3. IMPORTAÇÃO DE ROTAS EXTERNAS
// ==========================================
const clientRoutes = require("./BackEnd/src/routes/UsuarioRoutes");
app.use("/", clientRoutes);

const AdminRoutes = require("./BackEnd/src/routes/AdminRoutes");
app.use("/admin", AdminRoutes);

const EstofadorRoutes = require("./BackEnd/src/routes/EstofadorRoutes");
app.use("/estofador", EstofadorRoutes);

// ==========================================
// 4. INICIALIZAÇÃO DO SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 Servidor rodando com sucesso!`);
  console.log(`🔗 Acesse: http://localhost:${PORT}`);
  console.log(`=================================`);
});
