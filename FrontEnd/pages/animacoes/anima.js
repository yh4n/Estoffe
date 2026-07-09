// --- ANIMAÇÃO PARA O DESKTOP DA NAVBAR ---
window.addEventListener('scroll', function () {
    const header = document.getElementById('main-header');
    const logo = document.getElementById('logo-img');
    const links = document.querySelectorAll('.nav-link-item');
    const menuBtn = document.getElementById('menu-btn');

    if (window.scrollY > 50) {
        // --- QUANDO ROLA PARA BAIXO ---
        // Header fica transparente
        header.classList.remove('bg-green-950', 'p-4', 'shadow-md');
        header.classList.add('bg-transparent', 'p-6');

        // Logo cresce e perde o efeito branco (volta para a cor original/escura)
        logo.classList.remove('h-16', 'md:h-19');
        logo.classList.add('h-19', 'md:h-20', 'brightness-0');

        // Letras mudam de claro para verde escuro para dar leitura no fundo branco do site
        links.forEach(link => {
            link.classList.remove('text-gray-300', 'text-white');
            link.classList.add('text-black');
        });

        // Mudar a cor do BOTÃO (ex: muda de branco para o verde escuro)
        menuBtn.classList.remove('text-white');
        menuBtn.classList.add('text-green-950');
    } else {
        // --- QUANDO VOLTA AO TOPO ---
        // Header volta a ficar preenchido em verde escuro
        header.classList.remove('bg-transparent', 'p-6');
        header.classList.add('bg-green-950', 'p-4', 'shadow-md');

        // Logo diminui e volta a ficar branca
        logo.classList.remove('h-19', 'md:h-20', 'brightness-0');
        logo.classList.add('h-16', 'md:h-19');

        // Letras voltam a ser claras para contrastar com o fundo verde escuro
        links.forEach(link => {
            link.classList.remove('text-black');
            // Mantém o link ativo como branco total e os outros cinzas
            if (link.getAttribute('data-active') === 'true') {
                link.classList.add('text-white');
            } else {
                link.classList.add('text-gray-300');
            }
        });

        // Volta o BOTÃO para branco
        menuBtn.classList.remove('text-green-950');
        menuBtn.classList.add('text-white');
    }
});

// --- ANIMAÇÃO PARA O MOBILE DA NAVBAR ---
const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');

menuBtn.addEventListener('click', () => {
  if (menu.classList.contains('-top-full')) {
    menu.classList.remove('-top-full');
    menu.classList.add('top-0');
  } else {
    menu.classList.remove('top-0');
    menu.classList.add('-top-full');
  }
});

