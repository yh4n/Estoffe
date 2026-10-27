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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS foto_acompanhamento (
  codFoto INT NOT NULL AUTO_INCREMENT,
  codPedido INT NOT NULL,
  codEstofador INT NOT NULL,
  caminhoImagem VARCHAR(255) NOT NULL,
  legenda VARCHAR(255) DEFAULT NULL,
  criadaEm TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (codFoto),
  KEY idx_foto_acompanhamento_pedido (codPedido, criadaEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
