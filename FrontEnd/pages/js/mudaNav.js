document.addEventListener("DOMContentLoaded", () => {
  // 1. Verifica se o usuário está logado como cliente
  // (Pode buscar de um Cookie, do LocalStorage ou de uma API)
  const isCliente =
    localStorage.getItem("userRole") === "cliente" ||
    document.cookie.includes("isLoggedIn=true");

  if (isCliente) {
    const loginItem = document.getElementById("login-item");

    if (loginItem) {
      // Substitui o botão de Login por opções do Cliente (Minha Conta + Sair)
      loginItem.outerHTML = `
                <li>
                    <a href="/cliente/perfil" class="nav-link-item text-gray-300 hover:text-white transition-colors duration-300">
                        <i class="bi bi-person-circle mr-1"></i>Minha Conta
                    </a>
                </li>
                <li>
                    <button id="logout-btn" class="nav-link-item text-gray-300 hover:text-white transition-colors duration-300 uppercase tracking-widest text-sm font-medium focus:outline-none">
                        <i class="bi bi-box-arrow-right mr-1"></i>Sair
                    </button>
                </li>
            `;

      // Adiciona a função de Logout ao botão que acabou de ser criado
      document.getElementById("logout-btn").addEventListener("click", () => {
        // Limpa as credenciais (exemplo)
        localStorage.removeItem("userRole");
        document.cookie =
          "isLoggedIn=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";

        // Redireciona para a home deslogada
        window.location.href = "/";
      });
    }
  }
});
