// --- ANIMAÇÃO PARA O DESKTOP DA NAVBAR ---
window.addEventListener('scroll', function () {
    const header = document.getElementById('main-header');
    if (!header) return;

    if (window.scrollY > 50) {
        header.classList.remove('bg-green-950');
        header.classList.add('bg-green-950/95', 'backdrop-blur-md', 'shadow-xl');
    } else {
        header.classList.remove('bg-green-950/95', 'backdrop-blur-md', 'shadow-xl');
        header.classList.add('bg-green-950');
    }
});

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
