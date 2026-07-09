// Função para atualizar a bolinha vermelha do menu
function atualizarContadorCarrinho() {
    const carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];
    
    // Soma a quantidade total de todos os itens no carrinho
    const totalItens = carrinho.reduce((total, item) => total + item.quantidade, 0);
    
    const elementoContador = document.getElementById('cart-count');
    if (elementoContador) {
        elementoContador.innerText = totalItens;
        
        // Esconde a bolinha se o carrinho estiver vazio (opcional, fica mais elegante)
        if (totalItens === 0) {
            elementoContador.classList.add('hidden');
        } else {
            elementoContador.classList.remove('hidden');
        }
    }
}

// Executa assim que a página carrega para mostrar o número atual
document.addEventListener('DOMContentLoaded', atualizarContadorCarrinho);

function adicionarAoCarrinho(idProduto, nomeProduto, precoProduto) {
    let carrinho = JSON.parse(localStorage.getItem('carrinho')) || [];

    // Verifica se o produto já está no carrinho
    const index = carrinho.findIndex(item => item.id === idProduto);

    if (index !== -1) {
        // Se já existe, só aumenta a quantidade
        carrinho[index].quantidade += 1;
    } else {
        // Se é novo, adiciona o objeto completo
        carrinho.push({
            id: idProduto,
            nome: nomeProduto,
            preco: precoProduto,
            quantidade: 1
        });
    }

    // Salva de volta no localStorage
    localStorage.setItem('carrinho', JSON.stringify(carrinho));

    // Atualiza a bolinha do menu na mesma hora!
    atualizarContadorCarrinho();
}