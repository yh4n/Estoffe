# Estoffe

Plataforma web de uma estofaria para apresentar produtos, receber pedidos e orcamentos e acompanhar a producao. A interface e em portugues; clientes, administradores e estofadores possuem areas diferentes.

## Tecnologias

- Node.js e Express 5
- EJS, HTML, Tailwind CSS e JavaScript
- MySQL (conexao com `mysql2`)
- Gemini API para sugestoes de texto, opcional
- Asaas para pagamentos reais, opcional em ambiente local

## Requisitos

- Node.js compativel com as dependencias do projeto
- MySQL com permissao para criar/alterar tabelas
- Uma copia do repositorio

## Instalacao e configuracao

1. Instale as dependencias:

   ```sh
   npm install
   ```

2. Crie um banco MySQL. O dump local `estoffe.sql` nao e distribuido pelo repositorio porque pode conter dados; use somente uma exportacao de estrutura (sem dados pessoais) obtida do responsavel pelo projeto.

   ```sql
   CREATE DATABASE estoffe CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
   ```

   Importe a exportacao segura de estrutura com seu cliente MySQL antes de iniciar a aplicacao.

3. Crie um arquivo `.env` na raiz do projeto. Exemplo:

   ```dotenv
   PORT=3005
   NODE_ENV=development
   DB_HOST=localhost
   DB_USER=seu_usuario
   DB_PASSWORD=sua_senha
   DB_NAME=estoffe
   JWT_SECRET=gere-um-segredo-aleatorio-longo
   SESSION_SECRET=gere-outro-segredo-aleatorio-longo

   # Opcionais: e-mail, IA, pagamentos e login Google
   EMAIL_USER=
   EMAIL_PASS=
   EMAIL_ADMIN=
   APP_URL=http://localhost:3005
   GEMINI_API_KEY=
   GEMINI_MODEL=gemini-2.5-flash
   ASAAS_API_URL=https://api-sandbox.asaas.com/v3
   ASAAS_TOKEN=
   ASAAS_WEBHOOK_TOKEN=
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_CALLBACK_URL=http://localhost:3005/auth/google/callback
   ```

   O arquivo versionado `.env.example` contem apenas nomes de variaveis e placeholders. Nunca copie credenciais reais para esse arquivo. Se credenciais reais ja foram publicadas, revogue-as e emita novas chaves nos respectivos provedores.

   `JWT_SECRET` e obrigatoria para iniciar o servidor. Configure tambem um `SESSION_SECRET` forte, especialmente em producao. Credenciais e chaves devem ficar somente no `.env`, nunca no codigo ou em commits. O armazenamento de sessao atual e em memoria; antes de producao, substitua-o por um store persistente e configure `trust proxy` somente se a aplicacao estiver atras de um proxy confiavel.

4. Inicie o servidor:

   ```sh
   npm run dev
   ```

   Abra `http://localhost:3005`. Para iniciar sem o reinicio automatico do Nodemon, use `npm start`.

Ao iniciar, a aplicacao verifica e prepara tabelas/colunas auxiliares para estoque, promocoes, agenda, notificacoes e fotos de acompanhamento. As migracoes SQL correspondentes ficam em `migrations/`. A estrutura principal precisa ser provisionada separadamente com um dump seguro, sem dados pessoais.

## Como usar

### Visitante e cliente

1. Acesse **Produtos** para navegar pelo catalogo; produtos sob medida ficam na pagina correspondente.
2. Crie uma conta ou entre pelo menu **Login**. O carrinho permite revisar os itens, quantidades e frete estimado antes de enviar o pedido.
3. Acesse **Meu Perfil** para atualizar seus dados e **Meus pedidos** no painel para acompanhar orcamentos, pagamentos, agendamentos e status.
4. Quando uma proposta estiver disponivel, revise os valores e a mensagem e escolha aprovar ou recusar. O pagamento so e iniciado depois da aprovacao.
5. Abra **Notificacoes** para consultar ofertas, avisos de status e novas fotos publicadas pela oficina. As fotos de cada pedido tambem aparecem no painel de acompanhamento.

O fluxo de pedido sob medida pode ser iniciado na pagina de orcamento. O cliente informa os detalhes e a equipe avalia a solicitacao no painel administrativo.

### Administrador

- **Painel** (`/admin-dashboard`): veja pedidos, atribua pedidos pagos a um estofador e divulgue uma oferta. A oferta enviada aparece na central de notificacoes de todos os usuarios cadastrados.
- **Orcamentos** (`/admin/orcamentos`): abra um pedido para conferir cliente, itens, imagens, observacoes, materiais e valores; preencha mao de obra e frete, edite a mensagem e envie a proposta.
- **IA para orcamentos**: na analise do pedido, use o assistente para gerar um rascunho. Revise e edite o texto antes de enviar; a IA nao envia propostas nem define valores.
- **Produtos** (`/admin/produtos`): cadastre/edite produtos, imagens, composicao de materiais, estoque e promocoes.
- **Descricao com IA**: no formulario do produto, selecione a categoria, informe nome e, se desejar, detalhes confirmados. Clique em **Sugerir com IA**, revise a sugestao e salve normalmente. A sugestao e opcional e editavel; a IA nao substitui a revisao do administrador.
- **Producao** (`/admin/producao`): acompanhe pedidos ativos, atribua ou altere o responsavel e salve datas de coleta e entrega.
- **Estoque** (`/admin/estoque`) e **Estofadores** (`/admin/estofadores`): gerencie materiais, produtos acabados e equipe.
- **Notificacoes**: consulte os avisos da propria conta. A divulgacao de ofertas e feita pelo formulario do painel.

### Estofador

1. Entre com uma conta do tipo estofador e abra **Painel do Estofador**.
2. Selecione **Detalhes** no pedido atribuido para conferir os produtos, quantidades, observacoes e materiais previstos.
3. Durante o status **Em Producao**, use **Fotos do andamento** para tirar uma foto pelo celular ou selecionar uma imagem JPEG, PNG ou WebP (ate 5 MB). Adicione uma legenda opcional e publique. A imagem fica disponivel no acompanhamento do cliente e gera uma notificacao.
4. Registre materiais adicionais durante a producao e marque o servico como pronto quando finalizado.

As notificacoes da conta tambem podem ser acessadas pelo link **Notificacoes** no painel.

## Integracoes opcionais

### Gemini

Defina `GEMINI_API_KEY` para habilitar as sugestoes de descricao de produto e os rascunhos de orcamento. `GEMINI_MODEL` e opcional; o padrao e `gemini-2.5-flash`. Se a chave nao estiver configurada, os formularios continuam utilizaveis sem IA. O administrador deve sempre validar as sugestoes antes de salvar ou enviar.

No orcamento, a aplicacao estima materiais conhecidos a partir da composicao cadastrada e dos custos de material; custos ou composicoes ausentes tornam a estimativa parcial. O frete consultado no carrinho e uma referencia, que o administrador pode confirmar ou ajustar, exceto quando o cupom concede frete gratis, que permanece zerado. O total da proposta combina itens, mao de obra/margem e frete, e o cliente recebe uma previa por e-mail e no painel. Em bases existentes, as colunas de orcamento e frete sao preparadas na inicializacao; as alteracoes tambem estao em `migrations/20261023_orcamento_ia.sql` e `migrations/20261023_previsao_frete.sql`.

### E-mail

Configure `EMAIL_USER` e `EMAIL_PASS` para e-mails de pedidos, orcamentos e agendamentos. `EMAIL_ADMIN` define o destinatario administrativo dos formularios; se omitido, a aplicacao usa o endereco configurado como padrao no codigo. Falhas de e-mail sao registradas no log; avisos importantes tambem ficam na central de notificacoes.

### Pagamentos

Para pagamentos reais, configure `ASAAS_API_URL=https://api.asaas.com/v3`, `ASAAS_TOKEN` e os dados de webhook (`ASAAS_WEBHOOK_TOKEN`) conforme a integracao Asaas. Em desenvolvimento, a URL padrao e o sandbox (`https://api-sandbox.asaas.com/v3`). Para testes locais sem cobranca, defina `NODE_ENV=development` e `SIMULAR_PAGAMENTO=true`; isso aprova o pagamento localmente e atualiza o estoque sem chamar o Asaas. A simulacao e desativada em `production` e tambem quando `NODE_ENV` nao estiver explicitamente definido como `development` ou `test`.

### Login Google

O login Google e opcional e depende de `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_CALLBACK_URL` configurados no Google Cloud Console. Cadastre a URL de callback exatamente igual a configurada no ambiente.

## Imagens de producao e privacidade

As fotos de acompanhamento ficam em `BackEnd/uploads`, fora da pasta publica. O estofador so pode publicar fotos em pedidos atribuidos a ele que estejam em producao; a visualizacao valida a sessao e o acesso ao pedido. O cliente ve as imagens somente no proprio painel.

## Estrutura do projeto

- `server.js`: configuracao do Express, sessao, CSRF, uploads e montagem de rotas.
- `BackEnd/src/routes/`: fluxos de cliente, administrador, estofador e notificacoes.
- `BackEnd/src/config/`: conexao MySQL, autenticacao, e-mail e login social.
- `BackEnd/src/services/`: servicos compartilhados, como notificacoes.
- `FrontEnd/pages/`: paginas EJS da loja e dos paineis.
- `FrontEnd/image/`: imagens de produtos e arquivos visuais.
- `migrations/`: alteracoes incrementais do banco.

## Testes e verificacoes

O projeto ainda nao define um script de testes no `package.json`. Para verificar a sintaxe do servidor e das rotas:

```sh
node --check server.js
node --check BackEnd/src/config/database.js
node --check BackEnd/src/routes/AdminRoutes.js
node --check BackEnd/src/routes/NotificacaoRoutes.js
```

## Autores

- Yohan Dias Eduardo - [LinkedIn](https://www.linkedin.com/in/yohan-dias-eduardo-7a2ab0325/)
- Rayssa da Silva Maciel
