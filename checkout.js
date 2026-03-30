// RTX checkout — Stripe Checkout (optional PayPal if enabled in config)

let paypalButtonsRendered = false;

/** Production API when GitHub Pages serves a cached old config.js */
const RTX_DEFAULT_API = 'https://rtx-api.onrender.com';

function getApiBase() {
    let url = typeof CONFIG !== 'undefined' && CONFIG.apiBaseUrl ? CONFIG.apiBaseUrl : '';
    if (!url || url === 'YOUR_API_URL') {
        if (typeof location !== 'undefined' && /\.github\.io$/i.test(location.hostname)) {
            return RTX_DEFAULT_API.replace(/\/$/, '');
        }
        return '';
    }
    return url.replace(/\/$/, '');
}

function displayCheckoutItems() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutTotal = document.getElementById('checkoutTotal');
    const total = getCartTotal();

    checkoutItems.innerHTML = cart.map(item => `
        <div class="checkout-item">
            <span>${escapeCheckoutHtml(item.name)}</span>
            <span>$${item.price.toFixed(2)}</span>
        </div>
    `).join('');

    checkoutTotal.textContent = `$${total.toFixed(2)}`;
}

function escapeCheckoutHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function openCheckout() {
    const modal = document.getElementById('checkoutModal');
    modal.classList.add('active');
    displayCheckoutItems();
    updatePaymentUI();
    setupPayPalIfConfigured();
}

function closeCheckout() {
    document.getElementById('checkoutModal').classList.remove('active');
}

function updatePaymentUI() {
    const api = getApiBase();
    const stripeConfigured = !!api;
    const pp = CONFIG.paypal || {};
    const paypalConfigured =
        api &&
        pp.enabled === true &&
        pp.clientId &&
        pp.clientId !== 'YOUR_PAYPAL_CLIENT_ID';

    const stripeBtn = document.getElementById('stripe-checkout-btn');
    const paypalSection = document.getElementById('paypal-section');
    const paypalWrap = document.getElementById('paypal-button-container');
    const hint = document.getElementById('payment-config-hint');

    if (stripeBtn) {
        stripeBtn.disabled = !stripeConfigured;
        stripeBtn.style.opacity = stripeConfigured ? '1' : '0.5';
    }
    if (hint) {
        hint.style.display = !api ? 'block' : 'none';
    }
    if (paypalSection) {
        paypalSection.style.display = paypalConfigured ? 'block' : 'none';
    }
    if (paypalWrap && !paypalConfigured) {
        paypalWrap.innerHTML = '';
        paypalButtonsRendered = false;
    }
}

async function startStripeCheckout() {
    const api = getApiBase();
    if (!api) {
        showNotification('Set apiBaseUrl in config.js to your payment API URL.', 'error');
        return;
    }

    const user = getUser();
    const btn = document.getElementById('stripe-checkout-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Redirecting…';
    }

    try {
        const res = await fetch(`${api}/api/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: cart.map(i => ({
                    id: i.id,
                    name: i.name,
                    price: i.price,
                    downloadUrl: i.downloadUrl || ''
                })),
                userId: user ? user.id : '',
                username: user ? user.username : ''
            })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || res.statusText || 'Checkout failed');
        }
        if (data.url) {
            window.location.href = data.url;
            return;
        }
        throw new Error('No checkout URL returned');
    } catch (e) {
        console.error(e);
        showNotification(e.message || 'Could not start Stripe checkout', 'error');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Pay with card & more (Stripe)';
        }
    }
}

function loadPayPalScript() {
    const pp = CONFIG.paypal || {};
    const clientId = pp.clientId;
    if (!pp.enabled || !clientId || clientId === 'YOUR_PAYPAL_CLIENT_ID') {
        return Promise.reject(new Error('no client id'));
    }

    if (window.paypal) return Promise.resolve();

    return new Promise((resolve, reject) => {
        if (document.querySelector('script[data-rtx-paypal]')) {
            const t = setInterval(() => {
                if (window.paypal) {
                    clearInterval(t);
                    resolve();
                }
            }, 50);
            setTimeout(() => {
                clearInterval(t);
                if (window.paypal) resolve();
                else reject(new Error('PayPal SDK timeout'));
            }, 10000);
            return;
        }
        const s = document.createElement('script');
        s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD`;
        s.async = true;
        s.setAttribute('data-rtx-paypal', '1');
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('PayPal SDK failed to load'));
        document.body.appendChild(s);
    });
}

function setupPayPalIfConfigured() {
    const api = getApiBase();
    const pp = CONFIG.paypal || {};
    if (!pp.enabled) return;
    const clientId = pp.clientId;
    if (!api || !clientId || clientId === 'YOUR_PAYPAL_CLIENT_ID') return;
    if (paypalButtonsRendered) return;

    const container = document.getElementById('paypal-button-container');
    if (!container) return;

    loadPayPalScript()
        .then(() => {
            if (!window.paypal || paypalButtonsRendered) return;
            paypalButtonsRendered = true;
            container.innerHTML = '';

            window.paypal.Buttons({
                style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
                createOrder: async () => {
                    const res = await fetch(`${api}/api/paypal/create-order`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            items: cart.map(i => ({
                                id: i.id,
                                name: i.name,
                                price: i.price
                            }))
                        })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'PayPal order failed');
                    return data.id;
                },
                onApprove: async (data) => {
                    const res = await fetch(`${api}/api/paypal/capture-order`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderID: data.orderID })
                    });
                    const result = await res.json();
                    if (!res.ok || !result.success) {
                        showNotification(result.error || 'PayPal capture failed', 'error');
                        return;
                    }
                    const user = getUser();
                    const order = {
                        orderId: generateOrderId(),
                        userId: user ? user.id : '',
                        username: user ? user.username : '',
                        items: cart,
                        total: getCartTotal(),
                        date: new Date().toISOString(),
                        status: 'completed',
                        provider: 'paypal'
                    };
                    saveOrder(order);
                    closeCheckout();
                    clearCart();
                    showPaymentSuccess(order);
                },
                onError: (err) => {
                    console.error(err);
                    showNotification('PayPal error', 'error');
                }
            }).render(container);
        })
        .catch((e) => {
            console.warn('PayPal:', e.message);
        });
}

function handleCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const sessionId = params.get('session_id');

    if (checkout === 'success' && sessionId) {
        const seen = sessionStorage.getItem('rtx_stripe_ok_' + sessionId);
        if (seen) {
            window.history.replaceState({}, '', window.location.pathname + (window.location.hash || ''));
            return;
        }
        sessionStorage.setItem('rtx_stripe_ok_' + sessionId, '1');

        const user = getUser();
        const order = {
            orderId: 'RTX-' + sessionId.slice(-12).toUpperCase(),
            userId: user ? user.id : '',
            username: user ? user.username : '',
            items: [...cart],
            total: getCartTotal(),
            date: new Date().toISOString(),
            status: 'completed',
            provider: 'stripe',
            stripeSessionId: sessionId
        };
        saveOrder(order);
        clearCart();
        showPaymentSuccess(order);
        window.history.replaceState({}, '', window.location.pathname + (window.location.hash || ''));
        return;
    }

    if (checkout === 'cancel') {
        showNotification('Stripe checkout was cancelled.', 'error');
        window.history.replaceState({}, '', window.location.pathname + (window.location.hash || ''));
    }
}

function showPaymentSuccess(order) {
    const successMessage = `
        <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: #1a1a1a;
            border: 2px solid #ff2d95;
            border-radius: 8px;
            padding: 2rem;
            max-width: 500px;
            z-index: 10000;
            text-align: center;
        ">
            <h2 style="color: #ff2d95; margin-bottom: 1rem;">Payment successful</h2>
            <p style="color: #fff; margin-bottom: 1rem;">Order #${escapeCheckoutHtml(order.orderId)}</p>
            <p style="color: #ccc; margin-bottom: 1.5rem;">
                Download links were sent to the email you entered in Stripe. If you signed in with Discord, check your DMs and your new server role.
            </p>
            <button type="button" onclick="this.closest('[data-rtx-overlay]').remove()" style="
                background-color: #ff2d95;
                color: #0a0a0a;
                border: none;
                padding: 0.7rem 2rem;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 600;
            ">Close</button>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.setAttribute('data-rtx-overlay', '1');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 9999;
    `;
    overlay.innerHTML = successMessage;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

function generateOrderId() {
    return 'RTX-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

function saveOrder(order) {
    const orders = getOrders();
    orders.push(order);
    localStorage.setItem('rtxOrders', JSON.stringify(orders));
}

function getOrders() {
    let ordersStr = localStorage.getItem('rtxOrders');
    if (!ordersStr && localStorage.getItem('fxapOrders')) {
        ordersStr = localStorage.getItem('fxapOrders');
        localStorage.setItem('rtxOrders', ordersStr);
        localStorage.removeItem('fxapOrders');
    }
    return ordersStr ? JSON.parse(ordersStr) : [];
}

document.addEventListener('click', (e) => {
    const modal = document.getElementById('checkoutModal');
    if (e.target === modal) closeCheckout();
});

document.addEventListener('DOMContentLoaded', () => {
    handleCheckoutReturn();

    const stripeBtn = document.getElementById('stripe-checkout-btn');
    if (stripeBtn) {
        stripeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            startStripeCheckout();
        });
    }
});
