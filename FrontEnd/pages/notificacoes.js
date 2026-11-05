(() => {
    const preferenceKey = 'estoffe-browser-notifications';
    const toggleButton = document.getElementById('browser-notifications-toggle');
    const statusMessage = document.getElementById('browser-notifications-status');
    const unreadCountText = document.querySelector('[data-notification-unread]');
    const markAllReadForm = document.querySelector('[data-mark-all-read]');
    const toastContainer = document.createElement('div');
    let browserNotificationsEnabled = false;
    let latestNotificationId = null;
    let polling = false;

    try {
        browserNotificationsEnabled = window.localStorage.getItem(preferenceKey) === 'true';
    } catch (error) {
        console.error('Não foi possível ler a preferência de avisos:', error);
    }

    toastContainer.className = 'pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-relevant', 'additions');
    document.body.append(toastContainer);

    const getSafeLink = (link) => {
        try {
            const destination = new URL(link || '/notificacoes', window.location.origin);
            return destination.origin === window.location.origin
                ? `${destination.pathname}${destination.search}${destination.hash}`
                : '/notificacoes';
        } catch (error) {
            console.error('Link de notificação inválido:', error);
            return '/notificacoes';
        }
    };

    const updateBrowserNotificationButton = () => {
        if (!toggleButton || !statusMessage) return;

        if (!('Notification' in window)) {
            toggleButton.disabled = true;
            statusMessage.textContent = 'Este navegador não oferece avisos do sistema.';
            return;
        }

        if (browserNotificationsEnabled && Notification.permission === 'granted') {
            toggleButton.textContent = 'Desativar avisos do navegador';
            statusMessage.textContent = 'Avisos ativados para quando o site estiver em segundo plano.';
            return;
        }

        toggleButton.textContent = 'Ativar avisos no navegador';
        statusMessage.textContent = Notification.permission === 'denied'
            ? 'Avisos bloqueados nas permissões do navegador.'
            : 'Você também pode receber avisos do sistema quando o site estiver em segundo plano.';
    };

    const showToast = (notification) => {
        const toast = document.createElement('article');
        toast.className = 'pointer-events-auto rounded-xl border border-green-200 bg-white p-4 text-gray-800 shadow-xl';
        toast.setAttribute('role', 'status');

        const content = document.createElement('a');
        content.href = getSafeLink(notification.link);
        content.className = 'block rounded focus:outline-none focus:ring-2 focus:ring-green-700';

        const title = document.createElement('strong');
        title.className = 'block text-sm font-bold text-green-950';
        title.textContent = notification.titulo;

        const message = document.createElement('span');
        message.className = 'mt-1 block text-sm text-gray-600';
        message.textContent = notification.mensagem;
        content.append(title, message);

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'absolute right-3 top-3 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-700';
        closeButton.setAttribute('aria-label', 'Fechar aviso');
        closeButton.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

        const closeToast = () => toast.remove();
        closeButton.addEventListener('click', closeToast);
        toast.classList.add('relative');
        toast.append(content, closeButton);
        toastContainer.append(toast);
        window.setTimeout(closeToast, 8000);
    };

    const showBrowserNotification = (notification) => {
        if (
            !browserNotificationsEnabled ||
            !('Notification' in window) ||
            Notification.permission !== 'granted'
        ) return;

        try {
            const aviso = new Notification(notification.titulo, {
                body: notification.mensagem,
                icon: '/image/LogoNavBar.png',
                tag: `estoffe-notificacao-${notification.codNotificacao}`,
            });
            aviso.addEventListener('click', () => {
                window.focus();
                window.location.assign(getSafeLink(notification.link));
            });
        } catch (error) {
            console.error('Não foi possível exibir aviso do navegador:', error);
        }
    };

    const atualizarResumo = async () => {
        if (polling) return;
        polling = true;

        try {
            const response = await fetch('/notificacoes/api/resumo', {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) {
                throw new Error(`Consulta de notificações falhou (${response.status}).`);
            }

            const resumo = await response.json();
            const count = Number(resumo.unreadCount);
            if (!Number.isSafeInteger(count) || count < 0) {
                throw new Error('O servidor retornou uma contagem de notificações inválida.');
            }

            document.querySelectorAll('[data-notification-count]').forEach((badge) => {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.classList.toggle('hidden', count === 0);
                badge.setAttribute('aria-label', `${count} notificação(ões) não lida(s)`);
            });
            if (unreadCountText) unreadCountText.textContent = String(count);
            if (markAllReadForm) markAllReadForm.classList.toggle('hidden', count === 0);

            const latest = resumo.latest;
            const latestId = Number(latest?.codNotificacao || 0);
            if (latestNotificationId !== null && latest && latestId > latestNotificationId) {
                if (document.visibilityState === 'visible') showToast(latest);
                else showBrowserNotification(latest);
            }
            if (latestNotificationId === null || latestId > latestNotificationId) {
                latestNotificationId = latestId;
            }
        } catch (error) {
            console.error('Erro ao atualizar notificações:', error);
        } finally {
            polling = false;
        }
    };

    if (toggleButton && statusMessage) {
        updateBrowserNotificationButton();

        toggleButton.addEventListener('click', async () => {
            if (browserNotificationsEnabled) {
                browserNotificationsEnabled = false;
                try {
                    window.localStorage.removeItem(preferenceKey);
                } catch (error) {
                    console.error('Não foi possível salvar a preferência de avisos:', error);
                    statusMessage.textContent = 'Não foi possível atualizar a preferência.';
                    return;
                }
                updateBrowserNotificationButton();
                return;
            }

            try {
                const permission = Notification.permission === 'default'
                    ? await Notification.requestPermission()
                    : Notification.permission;
                if (permission !== 'granted') {
                    updateBrowserNotificationButton();
                    statusMessage.textContent = permission === 'denied'
                        ? 'Avisos bloqueados. Altere a permissão nas configurações do navegador.'
                        : 'Permissão para avisos não concedida.';
                    return;
                }

                window.localStorage.setItem(preferenceKey, 'true');
                browserNotificationsEnabled = true;
                updateBrowserNotificationButton();
            } catch (error) {
                console.error('Não foi possível ativar avisos do navegador:', error);
                statusMessage.textContent = 'Não foi possível ativar os avisos do navegador.';
            }
        });
    }

    atualizarResumo();
    window.setInterval(atualizarResumo, 30000);
    document.addEventListener('visibilitychange', atualizarResumo);
})();
