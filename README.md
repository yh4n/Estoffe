# Estoffe 🛋️

> **Projeto de Conclusão de Curso (TCC)** > O **Estoffe** é uma plataforma web desenvolvida para o segmento de estofaria, focada em modernizar o atendimento ao cliente, exibição de portfólio e gestão de serviços.

---

## 📌 Sobre o Projeto

O Estoffe nasceu como um Projeto de Conclusão de Curso com o objetivo de digitalizar os processos de uma estofaria tradicional. A plataforma permite que clientes conheçam os serviços, solicitem orçamentos e acompanhem de forma prática o status de suas ordens de serviço, trazendo inovação para o setor.

## 🚀 Funcionalidades Principais

* 💻 **Apresentação Gráfica:** Vitrine digital para exposição de trabalhos realizados (portfólio).
* 📝 **Solicitação de Orçamentos:** Formulário intuitivo para captação de novos pedidos de clientes.
* 📊 **Painel Administrativo:** Gerenciamento de pedidos, contatos e serviços por parte do administrador.

## 🛠️ Tecnologias Utilizadas

* **Frontend:** HTML5, CSS3, JavaScript
* **Backend:** Node.js, EJS
* **Banco de Dados:** MySQL

## Testar sem cobrança

Para simular a aprovação do pagamento durante testes locais, configure `SIMULAR_PAGAMENTO=true` no `.env` e reinicie o servidor. O pedido será marcado como pago e o estoque dos produtos será atualizado, sem chamar o Asaas. A simulação é desativada automaticamente quando `NODE_ENV=production`.

Para voltar ao pagamento real, remova a variável ou defina `SIMULAR_PAGAMENTO=false` e reinicie o servidor.

## Produção, coletas e entregas

O painel administrativo em `/admin/producao` permite atribuir pedidos em produção a um estofador, acompanhar a carga por funcionário e agendar datas de coleta e entrega. O cliente recebe e-mail quando as datas são salvas e quando o status do pedido muda. Para o envio funcionar, configure `EMAIL_USER` e `EMAIL_PASS` no `.env`; falhas de envio são informadas no painel e registradas no log.

Em bases existentes, as colunas de agendamento são criadas automaticamente na inicialização. A migração correspondente está em `migrations/20261023_agendamento_producao.sql`; em instalações novas, as colunas também estão na estrutura de `estoffe.sql`.

## Assistente de orçamentos

Configure `GEMINI_API_KEY` no `.env` para habilitar a geração de rascunhos no detalhe de um orçamento administrativo. Opcionalmente, defina `GEMINI_MODEL`; o padrão é `gemini-2.5-flash`. A IA recebe somente itens, quantidades, detalhes do pedido e valores propostos, sem nome, e-mail ou código do cliente. O rascunho é editável e nunca é enviado sem revisão do administrador.

O sistema calcula o custo conhecido dos materiais a partir da composição dos produtos e de `material.custo`; se faltarem composições ou custos cadastrados, a estimativa é identificada como parcial. O frete pré-verificado por CEP no carrinho é salvo junto ao pedido, exibido na lista e na análise administrativa, e enviado à IA como estimativa de referência. O administrador informa mão de obra/margem e confirma ou ajusta o frete; o total enviado é calculado com base nos itens + mão de obra/margem + frete. O cliente recebe a prévia por e-mail e também pode consultá-la no painel; o valor final é comunicado no orçamento. A configuração `GEMINI_MODEL` aceita o identificador do modelo (por exemplo, `gemini-2.5-flash`); o prefixo opcional `models/` é removido. Se o modelo configurado não estiver disponível ou só aceitar áudio, a aplicação consulta os modelos habilitados para a chave, ignora modelos de áudio/TTS e tenta até 10 alternativas de texto que suportem `generateContent`. Se a consulta falhar, verifique `GEMINI_API_KEY` e o acesso à Gemini API no Google AI Studio.

Em bases existentes, a inicialização prepara as novas colunas automaticamente; as migrações relacionadas estão em `migrations/20261023_orcamento_ia.sql` e `migrations/20261023_previsao_frete.sql`.

---

## 🧑‍💻 Autores

* **Yohan Dias Eduardo** - [yohan-dias-eduardo](https://www.linkedin.com/in/yohan-dias-eduardo-7a2ab0325/) / [diaseduardoyo@gmail.com](mailto:diaseduardoyo@gmail.com)
* **Rayssa da Silva Maciel** - [rayssamaciel234@gmail.com](mailto:rayssamaciel234@gmail.com)
