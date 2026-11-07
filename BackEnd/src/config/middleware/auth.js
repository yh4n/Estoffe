const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.JWT_SECRET || process.env.SECRET_KEY;
if (!SECRET_KEY) {
  throw new Error("JWT_SECRET não definido no .env — defina um segredo forte antes de subir o servidor.");
}

/**
 * Middleware reutilizável para verificar autenticação por tipo de usuário
 * @param {Array} tiposPermitidos - Array com os tipos de usuário permitidos ['admin', 'estofador', 'cliente']
 */
function verificarAutenticacao(tiposPermitidos) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    const respostaJson =
      req.xhr || req.accepts(["html", "json"]) === "json";

    if (!usuario || !usuario.token) {
      if (respostaJson) {
        return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
      }
      return res.redirect("/login");
    }

    try {
      const decodificado = jwt.verify(usuario.token, SECRET_KEY);
      const expiraEm = Number(decodificado.exp || 0) * 1000 - Date.now();

      if (expiraEm <= 5 * 60 * 1000 && decodificado.codUsuario && decodificado.tipo) {
        req.session.usuario.token = jwt.sign(
          {
            codUsuario: decodificado.codUsuario,
            tipo: decodificado.tipo,
          },
          SECRET_KEY,
          { expiresIn: "1h" },
        );
      }

      if (tiposPermitidos.includes(decodificado.tipo)) {
        return next();
      } else {
        if (respostaJson) {
          return res.status(403).json({ error: "Você não tem permissão para esta ação." });
        }
        return res.status(403).send("Acesso negado: Você não tem permissão para acessar esta página.");
      }
    } catch (error) {
      req.session.destroy();
      if (respostaJson) {
        return res.status(401).json({ error: "Sua sessão expirou. Entre novamente." });
      }
      return res.redirect("/login");
    }
  };
}

const apenasAdmin = (req, res, next) => {
  if (req.session.usuario && req.session.usuario.tipo === "admin") {
    return next();
  }
  if (req.xhr || req.accepts(["html", "json"]) === "json") {
    return res.status(403).json({ error: "Acesso permitido somente para administradores." });
  }
  return res.redirect("/client-dashboard");
};


const apenasEstofador = (req, res, next) => {
  if (req.session.usuario && req.session.usuario.tipo === "estofador") {
    return next();
  }
  return res.redirect("/client-dashboard");
};

module.exports = {
  verificarAutenticacao,
  apenasEstofador,
  apenasAdmin,
  SECRET_KEY,
};
