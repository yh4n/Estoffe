require("dotenv").config();
const bcrypt = require("bcrypt");
const db = require("./BackEnd/src/config/database");

// Regex que identifica um hash bcrypt válido ($2a$, $2b$ ou $2y$ + custo + salt/hash)
const REGEX_BCRYPT = /^\$2[aby]\$\d{2}\$.{53}$/;

async function criptografarSenhasEmTextoPuro() {
  console.log("Buscando usuários no banco de dados...");

  try {
    const [usuarios] = await db.query(
      "SELECT codUsuario, nome, senha FROM usuario"
    );

    console.log(`Total de usuários encontrados: ${usuarios.length}`);

    let atualizados = 0;
    let jaCriptografados = 0;

    for (const usuario of usuarios) {
      const { codUsuario, nome, senha } = usuario;

      // Se já é um hash bcrypt válido, pula
      if (senha && REGEX_BCRYPT.test(senha)) {
        jaCriptografados++;
        continue;
      }

      if (!senha) {
        console.warn(`Usuário #${codUsuario} (${nome}) não possui senha definida. Pulando.`);
        continue;
      }

      // Criptografa a senha em texto puro
      const senhaCriptografada = await bcrypt.hash(senha, 10);

      await db.query("UPDATE usuario SET senha = ? WHERE codUsuario = ?", [
        senhaCriptografada,
        codUsuario,
      ]);

      console.log(`Senha do usuário #${codUsuario} (${nome}) foi criptografada.`);
      atualizados++;
    }

    console.log("\n===== RESUMO =====");
    console.log(`Já estavam criptografadas: ${jaCriptografados}`);
    console.log(`Foram criptografadas agora: ${atualizados}`);
    console.log("===================\n");
    console.log("Concluído com sucesso!");
  } catch (error) {
    console.error("Erro ao criptografar senhas:", error);
  } finally {
    process.exit(0);
  }
}

criptografarSenhasEmTextoPuro();
