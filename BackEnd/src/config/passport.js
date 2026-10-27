const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const db = require("./database");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;
        const nome = profile.displayName || "Usuário Google";

        if (!email) {
          // Nunca deixe a função terminar sem chamar done() —
          // isso é o que causava o travamento e o reenvio do
          // código OAuth (invalid_grant em cascata).
          return done(null, false, { message: "Google não retornou um e-mail válido." });
        }

        // 1. Verifica se já existe um usuário com esse e-mail
        const [usuariosExistentes] = await db.query(
          "SELECT codUsuario, nome, email, tipo FROM usuario WHERE email = ?",
          [email],
        );

        if (usuariosExistentes.length > 0) {
          // Usuário já cadastrado — apenas autentica
          return done(null, usuariosExistentes[0]);
        }

        // 2. Não existe: cria um novo usuário do tipo 'cliente'.
        // Senha aleatória (não será usada, já que o login será sempre via Google).
        const senhaAleatoria = await bcrypt.hash(
          crypto.randomBytes(16).toString("hex"),
          10,
        );

        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();

          const [resultadoUsuario] = await connection.query(
            "INSERT INTO usuario (nome, email, senha, tipo) VALUES (?, ?, ?, 'cliente')",
            [nome, email, senhaAleatoria],
          );

          const codUsuario = resultadoUsuario.insertId;

          // IMPORTANTE: só insira colunas que você tem certeza que existem
          // na sua tabela `cliente`. Login via Google não fornece telefone,
          // endereço ou CPF/CNPJ — o usuário completa isso depois no perfil.
          // Rode `DESCRIBE cliente;` no seu banco e ajuste esta query se o
          // nome real das colunas for diferente.
          await connection.query(
            "INSERT INTO cliente (codUsuario) VALUES (?)",
            [codUsuario],
          );

          await connection.commit();

          return done(null, {
            codUsuario,
            nome,
            email,
            tipo: "cliente",
          });
        } catch (erroTransacao) {
          await connection.rollback();
          console.error("Erro na transação do Google Login:", erroTransacao);
          return done(erroTransacao);
        } finally {
          connection.release();
        }
      } catch (error) {
        console.error("Erro geral na Strategy do Google:", error);
        return done(error);
      }
    },
  ),
);

// Necessário para o passport funcionar mesmo sem usar sessão própria dele.
// O projeto usa a sessão do express-session + JWT manualmente (ver rota de
// callback em UsuarioRoutes.js), então não usamos passport.session().
passport.serializeUser((usuario, done) => done(null, usuario));
passport.deserializeUser((usuario, done) => done(null, usuario));

module.exports = passport;
