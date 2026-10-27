// --- ANIMAÇÃO PARA O DESKTOP DA NAVBAR ---
window.addEventListener('scroll', function () {
    const header = document.getElementById('main-header');
    const logo = document.getElementById('logo-img');
    const links = document.querySelectorAll('.nav-link-item');
    const menuBtn = document.getElementById('menu-btn');

    if (!header || !logo) return;

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
        if (menuBtn) {
            menuBtn.classList.remove('text-white');
            menuBtn.classList.add('text-green-950');
        }
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
        if (menuBtn) {
            menuBtn.classList.remove('text-green-950');
            menuBtn.classList.add('text-white');
        }
    }
});

// --- ANIMAÇÃO PARA O MOBILE DA NAVBAR ---
const menuBtn = document.getElementById('menu-btn');
const menu = document.getElementById('menu');

if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
        if (menu.classList.contains('-top-full')) {
            menu.classList.remove('-top-full');
            menu.classList.add('top-0');
        } else {
            menu.classList.remove('top-0');
            menu.classList.add('-top-full');
        }
    });
}

let estiloTransicaoEstoffe;

function iniciarTransicaoEstoffe(alvo) {
    if (!alvo || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
    }

    if (!estiloTransicaoEstoffe) {
        estiloTransicaoEstoffe = document.createElement('style');
        estiloTransicaoEstoffe.textContent = `
            @keyframes estoffe-wave-purchase {
                from { transform: translate3d(0, 100%, 0); }
                to { transform: translate3d(0, -110%, 0); }
            }

            .estoffe-purchase-scope {
                position: relative;
                isolation: isolate;
                overflow: hidden;
            }

            .estoffe-purchase-wave {
                position: absolute;
                inset: 0;
                z-index: 30;
                pointer-events: none;
                will-change: transform;
                animation: estoffe-wave-purchase 0.45s cubic-bezier(.77, 0, .20, 1) both;
            }

            .estoffe-purchase-wave svg {
                display: block;
                width: 100%;
                height: 100%;
            }
        `;
        document.head.appendChild(estiloTransicaoEstoffe);
    }

    const jaTinhaEscopo = alvo.classList.contains('estoffe-purchase-scope');
    alvo.classList.add('estoffe-purchase-scope');

    const transicaoAnterior = alvo.querySelector('.estoffe-purchase-wave');
    transicaoAnterior?.remove();

    const transicao = document.createElement('div');
    transicao.className = 'estoffe-purchase-wave';
    transicao.setAttribute('aria-hidden', 'true');

    const intervalo = 100 / 6;
    const bordaOndulada = Array.from({ length: 6 }, (_, indice) => {
        const x = 1000 - (indice + 1) * intervalo;
        return `A${intervalo / 2} 55 0 0 0 ${x} 1000`;
    }).join(' ');
    const caminho = `M0 0 H1000 V1000 ${bordaOndulada} H0 Z`;

    transicao.innerHTML = `<svg viewBox="0 0 1000 1100" preserveAspectRatio="none" focusable="false"><path d="${caminho}" fill="#05190d"></path></svg>`;
    alvo.appendChild(transicao);
    transicao.addEventListener('animationend', () => {
        transicao.remove();
        if (!jaTinhaEscopo) alvo.classList.remove('estoffe-purchase-scope');
    }, { once: true });

    return true;
}

document.addEventListener('submit', (event) => {
    const formulario = event.target.closest('form[data-offline-cart-form]');
    if (!formulario) return;

    const areaCompra = formulario.closest('.group, [data-purchase-card]')
        || formulario.closest('[data-purchase-container]')
        || formulario;
    iniciarTransicaoEstoffe(areaCompra);
}, true);

document.addEventListener('click', (event) => {
    const link = event.target instanceof Element
        ? event.target.closest('a[data-purchase-animation]')
        : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const areaCompra = link.closest('.group, [data-purchase-card]')
        || link.closest('[data-purchase-container]')
        || link.parentElement;
    if (!iniciarTransicaoEstoffe(areaCompra)) return;

    event.preventDefault();
    window.setTimeout(() => window.location.assign(link.href), 700);
}, true);

