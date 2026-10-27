(function () {
  const chaveCarrinho = "estoffe.carrinho.offline";
  const limiteQuantidade = 99;

  function lerCarrinho() {
    try {
      const itens = JSON.parse(localStorage.getItem(chaveCarrinho) || "[]");
      return Array.isArray(itens)
        ? itens.filter((item) => item && typeof item === "object")
        : [];
    } catch {
      return [];
    }
  }

  function iniciarFeedback(form) {
    const botao = form.querySelector('button[type="submit"]');
    const conteudoOriginal = botao?.innerHTML;
    const classesOriginais = botao?.className;
    if (botao) {
      botao.disabled = true;
      botao.setAttribute("aria-busy", "true");
      botao.innerHTML = '<i class="bi bi-arrow-repeat animate-spin" aria-hidden="true"></i> Processando...';
      botao.classList.add("opacity-90", "cursor-wait");
    }
    return { botao, conteudoOriginal, classesOriginais };
  }

  function restaurarFeedback({ botao, conteudoOriginal, classesOriginais }) {
    if (!botao) return;
    botao.innerHTML = conteudoOriginal;
    botao.className = classesOriginais;
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
  }

  function atualizarIndicadorCarrinho(contagem) {
    const indicador = document.getElementById("cart-count");
    if (!indicador) return;

    const quantidade = Math.max(0, Number(contagem) || 0);
    indicador.textContent = String(quantidade);
    indicador.classList.toggle("hidden", quantidade === 0);
  }

  function confirmarAdicao(form, feedback) {
    const { botao } = feedback;
    if (botao) {
      botao.innerHTML = '<i class="bi bi-check-lg" aria-hidden="true"></i> Adicionado';
      botao.classList.replace("bg-green-950", "bg-green-600");
      botao.classList.replace("hover:bg-green-800", "hover:bg-green-500");
      botao.classList.remove("opacity-90", "cursor-wait");
      botao.removeAttribute("aria-busy");
    }
    const grupoProduto = form.closest(".group");
    grupoProduto?.classList.add("produto-adicionado");
    window.setTimeout(() => grupoProduto?.classList.remove("produto-adicionado"), 600);
    window.setTimeout(() => restaurarFeedback(feedback), 1500);
  }

  document.querySelectorAll("[data-offline-cart-form]").forEach((form) => {
    const autenticado = form.dataset.authenticated === "true";

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (autenticado) {
        const feedback = iniciarFeedback(form);
        const dados = new URLSearchParams(new FormData(form));
        fetch(form.action, {
          method: form.method || "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            Accept: "application/json",
          },
          body: dados,
        })
          .then(async (response) => {
            if (
              !response.ok ||
              new URL(response.url).pathname === "/login"
            ) {
              throw new Error("Falha ao adicionar produto.");
            }
            const resultado = await response.json();
            atualizarIndicadorCarrinho(resultado.cartCount);
            confirmarAdicao(form, feedback);
          })
          .catch((error) => {
            console.error(error);
            restaurarFeedback(feedback);
            window.alert(
              "Não foi possível adicionar o produto ao carrinho. Tente novamente.",
            );
          });
        return;
      }

      const codProduto = Number(form.dataset.productId);
      if (!Number.isSafeInteger(codProduto) || codProduto <= 0) return;

      const carrinho = lerCarrinho();
      const itemExistente = carrinho.find(
        (item) => Number(item.codProduto) === codProduto,
      );
      if (itemExistente) {
        const quantidadeAtual = Number(itemExistente.quantidade);
        itemExistente.quantidade = Math.min(
          limiteQuantidade,
          (Number.isSafeInteger(quantidadeAtual) && quantidadeAtual > 0
            ? quantidadeAtual
            : 0) + 1,
        );
      } else {
        carrinho.push({ codProduto, quantidade: 1 });
      }

      const feedback = iniciarFeedback(form);
      window.setTimeout(() => {
        try {
          localStorage.setItem(chaveCarrinho, JSON.stringify(carrinho));
        } catch {
          restaurarFeedback(feedback);
          window.alert("Não foi possível salvar o carrinho neste navegador.");
          return;
        }

        confirmarAdicao(form, feedback);
        atualizarIndicadorCarrinho(
          carrinho.reduce((total, item) => total + Number(item.quantidade || 0), 0),
        );
      }, 600);
    });
  });

  const formularioLogin = document.querySelector('form[action="/login"]');
  const campoCarrinho = document.getElementById("cartOffline");
  if (formularioLogin && campoCarrinho) {
    formularioLogin.addEventListener("submit", () => {
      campoCarrinho.value = JSON.stringify(lerCarrinho());
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("sincronizarOffline") === "1") {
    const csrfToken = document.querySelector(
      'meta[name="csrf-token"]',
    )?.content;
    if (csrfToken) {
      fetch("/carrinho/sincronizar-offline", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          _csrf: csrfToken,
          cartOffline: JSON.stringify(lerCarrinho()),
        }),
      })
        .then((response) => {
          if (!response.ok)
            throw new Error("Falha na sincronização do carrinho.");
          localStorage.removeItem(chaveCarrinho);
          window.location.replace("/carrinho?offline=merged");
        })
        .catch((error) => {
          console.error(error);
          window.alert(
            "Não foi possível sincronizar o carrinho. Tente novamente.",
          );
        });
    }
  }

  if (params.get("offline") === "merged") {
    localStorage.removeItem(chaveCarrinho);
  }
})();
