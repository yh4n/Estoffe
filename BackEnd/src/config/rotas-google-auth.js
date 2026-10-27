// ==========================================
// COLE ESTE BLOCO DENTRO DO SEU UsuarioRoutes.js
// ==========================================

// No topo do arquivo, junto dos outros requires:
//
// const rateLimit = require("express-rate-limit");
// const passport = require("../config/passport");
//
// const limitadorLogin = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutos
//   max: 10,
//   message: "Muitas tentativas de login. Tente novamente em alguns minutos.",
//   standardHeaders: true,
//   legacyHeaders: false,
// });
//
// E aplique limitadorLogin no POST /login existente:
//   router.post("/login", limitadorLogin, async (req, res) => { ... })
//
// Também remova, dentro do POST /login, o fallback inseguro:
//   const senhaValida = await bcrypt
//     .compare(password, usuarioEncontrado.senha)
//     .catch(() => password === usuarioEncontrado.senha);
// Substitua por:
//   const senhaValida = await bcrypt.compare(password, usuarioEncontrado.senha);

// ==========================================
// LOGIN COM GOOGLE
// ==========================================
