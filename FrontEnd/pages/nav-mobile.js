const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');
const mobileViewport = window.matchMedia('(max-width: 767px)');

if (menuBtn && menu) {
    let menuAberto = false;

    const atualizarMenu = () => {
        const aberto = menuAberto && mobileViewport.matches;

        menu.style.transform = mobileViewport.matches
            ? (aberto ? 'translateY(0)' : 'translateY(-0.5rem)')
            : '';
        menu.style.opacity = mobileViewport.matches ? (aberto ? '1' : '0') : '';
        menu.style.pointerEvents = mobileViewport.matches ? (aberto ? 'auto' : 'none') : '';
        menu.toggleAttribute('inert', !aberto && mobileViewport.matches);
        menuBtn.setAttribute('aria-expanded', String(aberto));
        menuBtn.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    };

    menuBtn.addEventListener('click', () => {
        menuAberto = !menuAberto;
        atualizarMenu();
    });

    menu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            menuAberto = false;
            atualizarMenu();
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menuAberto && mobileViewport.matches) {
            menuAberto = false;
            atualizarMenu();
            menuBtn.focus();
        }
    });

    mobileViewport.addEventListener('change', () => {
        menuAberto = false;
        atualizarMenu();
    });

    atualizarMenu();
}
