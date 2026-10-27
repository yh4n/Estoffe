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
async function prepararSchemaPromocoes() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS frete_faixa_cep (
            id INT AUTO_INCREMENT PRIMARY KEY,
            cep_inicio CHAR(8) NOT NULL,
            cep_fim CHAR(8) NOT NULL,
            valor DECIMAL(10, 2) NOT NULL,
            prazo_dias INT NOT NULL DEFAULT 7,
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            UNIQUE KEY faixa_unica (cep_inicio, cep_fim)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    const [colunasCliente] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cliente' AND COLUMN_NAME = 'cep'`,
    );
    if (!colunasCliente.length) {
        await pool.query("ALTER TABLE cliente ADD COLUMN cep CHAR(8) DEFAULT NULL");
    }
    await pool.query(`
        INSERT IGNORE INTO frete_faixa_cep (cep_inicio, cep_fim, valor, prazo_dias)
        VALUES
          ('00000000', '19999999', 29.90, 5),
          ('20000000', '28999999', 39.90, 7),
          ('30000000', '39999999', 39.90, 7),
          ('40000000', '99999999', 59.90, 10)
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS codigo_promocional (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codigo VARCHAR(40) NOT NULL UNIQUE,
            percentual DECIMAL(5, 2) NOT NULL,
            frete_gratis TINYINT(1) NOT NULL DEFAULT 0,
            ativo TINYINT(1) NOT NULL DEFAULT 1,
            validade DATE DEFAULT NULL,
            criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    const [colunasCodigo] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'codigo_promocional'`,
    );
    const nomesCodigo = new Set(colunasCodigo.map((coluna) => coluna.COLUMN_NAME));
    const alteracoesCodigo = [];
    if (!nomesCodigo.has('percentual')) {
        alteracoesCodigo.push('ADD COLUMN percentual DECIMAL(5, 2) NOT NULL DEFAULT 0');
    }
    if (!nomesCodigo.has('ativo')) {
        alteracoesCodigo.push('ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1');
    }
    if (!nomesCodigo.has('frete_gratis')) {
        alteracoesCodigo.push('ADD COLUMN frete_gratis TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!nomesCodigo.has('validade')) {
        alteracoesCodigo.push('ADD COLUMN validade DATE DEFAULT NULL');
    }
    if (!nomesCodigo.has('criado_em')) {
        alteracoesCodigo.push('ADD COLUMN criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
    }
    if (alteracoesCodigo.length) {
        await pool.query(`ALTER TABLE codigo_promocional ${alteracoesCodigo.join(', ')}`);
    }

    const [colunas] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produto'
            AND COLUMN_NAME IN ('preco_promocional', 'promocao_ativa', 'sob_medida', 'galeria_imagens')`,
    );
    const nomes = new Set(colunas.map((coluna) => coluna.COLUMN_NAME));
    const alteracoes = [];
    if (!nomes.has('preco_promocional')) {
        alteracoes.push('ADD COLUMN preco_promocional DECIMAL(10, 2) DEFAULT NULL');
    }
    if (!nomes.has('promocao_ativa')) {
        alteracoes.push('ADD COLUMN promocao_ativa TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!nomes.has('sob_medida')) {
        alteracoes.push('ADD COLUMN sob_medida TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!nomes.has('galeria_imagens')) {
        alteracoes.push('ADD COLUMN galeria_imagens TEXT DEFAULT NULL');
    }
    if (alteracoes.length) await pool.query(`ALTER TABLE produto ${alteracoes.join(', ')}`);

    await pool.query(
        `INSERT IGNORE INTO codigo_promocional (codigo, percentual, ativo)
         VALUES ('ESTOFFE10', 10.00, 1)`,
    );
    await pool.query(
        `INSERT IGNORE INTO codigo_promocional (codigo, percentual, frete_gratis, ativo)
         VALUES ('FRETEGRATIS', 0.00, 1, 1)`,
    );
    await pool.query(
        `INSERT IGNORE INTO codigo_promocional (codigo, percentual, frete_gratis, ativo)
         VALUES ('ESTOFFE15FRETE', 15.00, 1, 1)`,
    );
}

async function prepararSchemaEstoque() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS estoque_materiais (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome_material VARCHAR(100) NOT NULL,
            descricao TEXT NULL,
            quantidade DECIMAL(10, 2) NOT NULL DEFAULT 0,
            unidade_medida VARCHAR(30) NOT NULL,
            data_ultima_atualizacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS estoque_produtos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            codProduto INT DEFAULT NULL,
            nome_produto VARCHAR(100) NOT NULL,
            descricao TEXT NULL,
            quantidade_disponivel INT UNSIGNED NOT NULL DEFAULT 0,
            preco_unitario DECIMAL(10, 2) NOT NULL DEFAULT 0,
            data_ultima_atualizacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_estoque_produtos_codProduto (codProduto),
            CONSTRAINT fk_estoque_produtos_produto
                FOREIGN KEY (codProduto) REFERENCES produto(codProduto) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    const [colunasEstoqueProdutos] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estoque_produtos'
            AND COLUMN_NAME = 'codProduto'`,
    );
    if (!colunasEstoqueProdutos.length) {
        await pool.query('ALTER TABLE estoque_produtos ADD COLUMN codProduto INT DEFAULT NULL AFTER id');
    }

    const [indicesEstoqueProdutos] = await pool.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estoque_produtos'
            AND COLUMN_NAME = 'codProduto' AND NON_UNIQUE = 0`,
    );
    if (!indicesEstoqueProdutos.length) {
        await pool.query(
            'ALTER TABLE estoque_produtos ADD UNIQUE KEY uq_estoque_produtos_codProduto (codProduto)',
        );
    }

    const [chavesEstoqueProdutos] = await pool.query(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estoque_produtos'
            AND COLUMN_NAME = 'codProduto' AND REFERENCED_TABLE_NAME = 'produto'`,
    );
    if (!chavesEstoqueProdutos.length) {
        await pool.query(
            `ALTER TABLE estoque_produtos
             ADD CONSTRAINT fk_estoque_produtos_produto
             FOREIGN KEY (codProduto) REFERENCES produto(codProduto) ON DELETE SET NULL`,
        );
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS movimentacao_estoque (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tipo_item ENUM('MATERIAL', 'PRODUTO') NOT NULL,
            item_id INT NOT NULL,
            tipo_movimentacao ENUM('ENTRADA', 'SAIDA') NOT NULL,
            quantidade DECIMAL(10, 2) NOT NULL,
            data_movimentacao TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            observacao TEXT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    const [pedidoColunas] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedido'
            AND COLUMN_NAME IN ('valorFrete')`,
    );
    if (!pedidoColunas.length) {
        await pool.query(
            "ALTER TABLE pedido ADD COLUMN valorFrete DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER valorTotal",
        );
    }

    const [produtoColunas] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produto'
            AND COLUMN_NAME IN ('quantidadeEstoque', 'descricao')`,
    );
    const nomesProduto = new Set(produtoColunas.map((coluna) => coluna.COLUMN_NAME));
    const alteracoesProduto = [];
    if (!nomesProduto.has('quantidadeEstoque')) {
        alteracoesProduto.push('ADD COLUMN quantidadeEstoque INT UNSIGNED NOT NULL DEFAULT 0 AFTER preco');
    }
    if (!nomesProduto.has('descricao')) {
        alteracoesProduto.push('ADD COLUMN descricao TEXT DEFAULT NULL AFTER quantidadeEstoque');
    }
    if (alteracoesProduto.length) {
        await pool.query(`ALTER TABLE produto ${alteracoesProduto.join(', ')}`);
    }

    const [[produtosCatalogo], [estoquesSemVinculo]] = await Promise.all([
        pool.query('SELECT codProduto, nome, descricao, quantidadeEstoque, preco FROM produto'),
        pool.query('SELECT id, nome_produto FROM estoque_produtos WHERE codProduto IS NULL'),
    ]);
    const normalizarNome = (nome) => String(nome).trim().toLocaleLowerCase('pt-BR');
    const quantidadePorNome = (itens, obterNome) => {
        const quantidades = new Map();
        for (const item of itens) {
            const nome = normalizarNome(obterNome(item));
            quantidades.set(nome, (quantidades.get(nome) || 0) + 1);
        }
        return quantidades;
    };
    const produtosPorNome = new Map(
        produtosCatalogo.map((produto) => [normalizarNome(produto.nome), produto]),
    );
    const contagemProdutos = quantidadePorNome(produtosCatalogo, (produto) => produto.nome);
    const contagemEstoques = quantidadePorNome(estoquesSemVinculo, (estoque) => estoque.nome_produto);
    for (const estoque of estoquesSemVinculo) {
        const nome = normalizarNome(estoque.nome_produto);
        const produto = produtosPorNome.get(nome);
        if (
            !produto ||
            contagemProdutos.get(nome) !== 1 ||
            contagemEstoques.get(nome) !== 1
        ) {
            continue;
        }
        await pool.query(
            `UPDATE estoque_produtos
                SET codProduto = ?, nome_produto = ?, descricao = ?,
                    quantidade_disponivel = ?, preco_unitario = ?
              WHERE id = ? AND codProduto IS NULL`,
            [
                produto.codProduto,
                produto.nome,
                produto.descricao || `Produto ${produto.nome} em estoque`,
                produto.quantidadeEstoque,
                produto.preco,
                estoque.id,
            ],
        );
    }
    await pool.query(`
        UPDATE estoque_produtos ep
        INNER JOIN produto p ON p.codProduto = ep.codProduto
           SET ep.nome_produto = p.nome,
               ep.descricao = COALESCE(p.descricao, CONCAT('Produto ', p.nome, ' em estoque')),
               ep.quantidade_disponivel = p.quantidadeEstoque,
               ep.preco_unitario = p.preco
    `);
    await pool.query(`
        INSERT INTO estoque_produtos
            (codProduto, nome_produto, descricao, quantidade_disponivel, preco_unitario)
        SELECT p.codProduto, p.nome,
               COALESCE(p.descricao, CONCAT('Produto ', p.nome, ' em estoque')),
               p.quantidadeEstoque, p.preco
          FROM produto p
          LEFT JOIN estoque_produtos ep ON ep.codProduto = p.codProduto
         WHERE ep.id IS NULL
    `);

    const [pagamentoColunas] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pagamento'
            AND COLUMN_NAME IN ('asaasPaymentId', 'estoqueBaixado')`,
    );
    const nomesPagamento = new Set(pagamentoColunas.map((coluna) => coluna.COLUMN_NAME));
    const alteracoesPagamento = [];
    if (!nomesPagamento.has('asaasPaymentId')) {
        alteracoesPagamento.push('ADD COLUMN asaasPaymentId VARCHAR(50) DEFAULT NULL');
    }
    if (!nomesPagamento.has('estoqueBaixado')) {
        alteracoesPagamento.push('ADD COLUMN estoqueBaixado TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (alteracoesPagamento.length) {
        await pool.query(`ALTER TABLE pagamento ${alteracoesPagamento.join(', ')}`);
    }
}

async function prepararSchemaAgenda() {
    const [colunasPedido] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedido'
              AND COLUMN_NAME IN ('dataColeta', 'dataEntrega', 'valorMaoDeObra', 'valorMateriais', 'mensagemOrcamento', 'statusOrcamento', 'valorFreteEstimado', 'prazoFreteEstimado', 'cepFreteEstimado', 'freteGratisEstimado')`,
    );
    const nomes = new Set(colunasPedido.map((coluna) => coluna.COLUMN_NAME));
    const alteracoes = [];
    if (!nomes.has('dataColeta')) {
        alteracoes.push('ADD COLUMN dataColeta DATE DEFAULT NULL AFTER dataPedido');
    }
    if (!nomes.has('dataEntrega')) {
        alteracoes.push('ADD COLUMN dataEntrega DATE DEFAULT NULL AFTER dataColeta');
    }
    if (!nomes.has('valorMaoDeObra')) {
        alteracoes.push('ADD COLUMN valorMaoDeObra DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER valorFrete');
    }
    if (!nomes.has('valorMateriais')) {
        alteracoes.push('ADD COLUMN valorMateriais DECIMAL(10, 2) DEFAULT NULL AFTER valorMaoDeObra');
    }
    if (!nomes.has('mensagemOrcamento')) {
        alteracoes.push('ADD COLUMN mensagemOrcamento TEXT DEFAULT NULL AFTER valorMateriais');
    }
    if (!nomes.has('statusOrcamento')) {
        alteracoes.push("ADD COLUMN statusOrcamento ENUM('Pendente', 'Aprovado', 'Recusado') DEFAULT NULL AFTER mensagemOrcamento");
    }
    if (!nomes.has('valorFreteEstimado')) {
        alteracoes.push('ADD COLUMN valorFreteEstimado DECIMAL(10, 2) DEFAULT NULL AFTER valorFrete');
    }
    if (!nomes.has('prazoFreteEstimado')) {
        alteracoes.push('ADD COLUMN prazoFreteEstimado INT DEFAULT NULL AFTER valorFreteEstimado');
    }
    if (!nomes.has('cepFreteEstimado')) {
        alteracoes.push('ADD COLUMN cepFreteEstimado CHAR(8) DEFAULT NULL AFTER prazoFreteEstimado');
    }
    if (!nomes.has('freteGratisEstimado')) {
        alteracoes.push('ADD COLUMN freteGratisEstimado TINYINT(1) NOT NULL DEFAULT 0 AFTER cepFreteEstimado');
    }
    if (alteracoes.length) {
        await pool.query(`ALTER TABLE pedido ${alteracoes.join(', ')}`);
    }
}

async function prepararSchemaNotificacoes() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notificacao (
            codNotificacao INT NOT NULL AUTO_INCREMENT,
            codUsuario INT NOT NULL,
            tipo VARCHAR(30) NOT NULL,
            titulo VARCHAR(120) NOT NULL,
            mensagem VARCHAR(1000) NOT NULL,
            link VARCHAR(255) DEFAULT NULL,
            codPedido INT DEFAULT NULL,
            lida TINYINT(1) NOT NULL DEFAULT 0,
            criadaEm TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (codNotificacao),
            KEY idx_notificacao_usuario_lida (codUsuario, lida, criadaEm),
            KEY idx_notificacao_pedido (codPedido)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS foto_acompanhamento (
            codFoto INT NOT NULL AUTO_INCREMENT,
            codPedido INT NOT NULL,
            codEstofador INT NOT NULL,
            caminhoImagem VARCHAR(255) NOT NULL,
            legenda VARCHAR(255) DEFAULT NULL,
            criadaEm TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (codFoto),
            KEY idx_foto_acompanhamento_pedido (codPedido, criadaEm)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);
}

pool.schemaPromocoesPronto = prepararSchemaPromocoes();
pool.schemaEstoquePronto = prepararSchemaEstoque();
pool.schemaAgendaPronto = pool.schemaEstoquePronto.then(prepararSchemaAgenda);
pool.schemaNotificacoesPronto = pool.schemaAgendaPronto.then(prepararSchemaNotificacoes);

pool.getConnection()
    .then(async (conn) => {
        console.log('Conexão com o banco MySQL realizada com sucesso!');
        conn.release();
        await Promise.all([pool.schemaPromocoesPronto, pool.schemaEstoquePronto, pool.schemaAgendaPronto, pool.schemaNotificacoesPronto]);
        console.log('Schemas de promoções, estoque, agenda e notificações verificados com sucesso.');
    })
    .catch(err => {
        console.error('Erro crítico ao conectar com o banco de dados MySQL:', err.message);
    });

// Exporta o pool para ser usado nas suas rotas e controllers do sistema
module.exports = pool;