document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".toggle-senha").forEach((botao) => {
    botao.addEventListener("click", () => {
      const idAlvo = botao.getAttribute("data-target");
      const input = document.getElementById(idAlvo);
      const icone = botao.querySelector("i");

      if (!input) return;

      const estaEscondida = input.type === "password";
      input.type = estaEscondida ? "text" : "password";

      if (icone) {
        icone.classList.toggle("bi-eye", !estaEscondida);
        icone.classList.toggle("bi-eye-slash", estaEscondida);
      }

      botao.setAttribute(
        "aria-label",
        estaEscondida ? "Ocultar senha" : "Mostrar senha"
      );
    });
  });
});
