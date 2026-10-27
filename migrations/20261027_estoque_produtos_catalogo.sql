-- Vincula cada saldo de produto acabado ao produto do catálogo.
-- Seguro para executar mesmo que a inicialização da aplicação já tenha aplicado o schema.

SET @estoque_codProduto_existe = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'estoque_produtos'
     AND COLUMN_NAME = 'codProduto'
);
SET @estoque_codProduto_ddl = IF(
  @estoque_codProduto_existe = 0,
  'ALTER TABLE estoque_produtos ADD COLUMN codProduto INT DEFAULT NULL AFTER id',
  'SELECT 1'
);
PREPARE estoque_codProduto_stmt FROM @estoque_codProduto_ddl;
EXECUTE estoque_codProduto_stmt;
DEALLOCATE PREPARE estoque_codProduto_stmt;

SET @estoque_codProduto_unico_existe = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'estoque_produtos'
     AND COLUMN_NAME = 'codProduto'
     AND NON_UNIQUE = 0
);
SET @estoque_codProduto_unico_ddl = IF(
  @estoque_codProduto_unico_existe = 0,
  'ALTER TABLE estoque_produtos ADD UNIQUE KEY uq_estoque_produtos_codProduto (codProduto)',
  'SELECT 1'
);
PREPARE estoque_codProduto_unico_stmt FROM @estoque_codProduto_unico_ddl;
EXECUTE estoque_codProduto_unico_stmt;
DEALLOCATE PREPARE estoque_codProduto_unico_stmt;

SET @estoque_codProduto_fk_existe = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'estoque_produtos'
     AND COLUMN_NAME = 'codProduto'
     AND REFERENCED_TABLE_NAME = 'produto'
);
SET @estoque_codProduto_fk_ddl = IF(
  @estoque_codProduto_fk_existe = 0,
  'ALTER TABLE estoque_produtos ADD CONSTRAINT fk_estoque_produtos_produto FOREIGN KEY (codProduto) REFERENCES produto(codProduto) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE estoque_codProduto_fk_stmt FROM @estoque_codProduto_fk_ddl;
EXECUTE estoque_codProduto_fk_stmt;
DEALLOCATE PREPARE estoque_codProduto_fk_stmt;

DROP TEMPORARY TABLE IF EXISTS estoque_produtos_unicos;
CREATE TEMPORARY TABLE estoque_produtos_unicos AS
SELECT MIN(id) AS id, nome_produto
  FROM estoque_produtos
 WHERE codProduto IS NULL
 GROUP BY nome_produto
HAVING COUNT(*) = 1;

DROP TEMPORARY TABLE IF EXISTS produtos_catalogo_unicos;
CREATE TEMPORARY TABLE produtos_catalogo_unicos AS
SELECT MIN(codProduto) AS codProduto, nome
  FROM produto
 GROUP BY nome
HAVING COUNT(*) = 1;

UPDATE estoque_produtos ep
INNER JOIN estoque_produtos_unicos eu ON eu.id = ep.id
INNER JOIN produtos_catalogo_unicos pu ON pu.nome = ep.nome_produto
INNER JOIN produto p ON p.codProduto = pu.codProduto
   SET ep.codProduto = p.codProduto,
       ep.nome_produto = p.nome,
       ep.descricao = CONCAT('Produto ', p.nome, ' em estoque'),
       ep.quantidade_disponivel = p.quantidadeEstoque,
       ep.preco_unitario = p.preco;

DROP TEMPORARY TABLE estoque_produtos_unicos;
DROP TEMPORARY TABLE produtos_catalogo_unicos;

UPDATE estoque_produtos ep
INNER JOIN produto p ON p.codProduto = ep.codProduto
   SET ep.nome_produto = p.nome,
       ep.descricao = CONCAT('Produto ', p.nome, ' em estoque'),
       ep.quantidade_disponivel = p.quantidadeEstoque,
       ep.preco_unitario = p.preco;

INSERT INTO estoque_produtos
    (codProduto, nome_produto, descricao, quantidade_disponivel, preco_unitario)
SELECT p.codProduto, p.nome, CONCAT('Produto ', p.nome, ' em estoque'),
       p.quantidadeEstoque, p.preco
  FROM produto p
  LEFT JOIN estoque_produtos ep ON ep.codProduto = p.codProduto
 WHERE ep.id IS NULL;
