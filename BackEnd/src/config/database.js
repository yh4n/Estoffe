const mysql = require('mysql2/promise');
require('dotenv').config();

// Cria o pool de conexões utilizando os dados que você colocou no .env
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Testa a conexão ao iniciar para garantir que as credenciais estão certas
pool.getConnection()
    .then(conn => {
        console.log('✅ Conexão com o banco MySQL realizada com sucesso!');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Erro crítico ao conectar com o banco de dados MySQL:', err.message);
    });

// Exporta o pool para ser usado nas suas rotas e controllers do sistema
module.exports = pool;