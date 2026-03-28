// Stripe checkout — RTX

let stripe;
let elements;
let cardElement;

// Initialize Stripe
function initializeStripe() {
    if (CONFIG.stripe.publishableKey && CONFIG.stripe.publishableKey !== 'YOUR_STRIPE_PUBLISHABLE_KEY') {
        stripe = Stripe(CONFIG.stripe.publishableKey);
        elements = stripe.elements({
            appearance: {
                theme: 'night',
                variables: {
                    colorPrimary: '#ff2d95',
                    colorBackground: '#0a0a0a',
                    colorText: '#ffffff',
                    colorDanger: '#ff4444',
                    fontFamily: 'Segoe UI, sans-serif',
                    borderRadius: '4px'
                }
            }
        });
    }
}

// Open checkout modal
function openCheckout() {
    const modal = document.getElementById('checkoutModal');
    modal.classList.add('active');
    
    // Display checkout items
    displayCheckoutItems();
    
    // Initialize Stripe elements if not already done
    if (stripe && !cardElement) {
        setupStripeElements();
    }
}

// Close checkout modal
function closeCheckout() {
    const modal = document.getElementById('checkoutModal');
    modal.classList.remove('active');
}

// Display checkout items
function displayCheckoutItems() {
    const checkoutItems = document.getElementById('checkoutItems');
    const checkoutTotal = document.getElementById('checkoutTotal');
    
    const total = getCartTotal();
    
    checkoutItems.innerHTML = cart.map(item => `
        <div class="checkout-item">
            <span>${item.name}</span>
            <span>$${item.price.toFixed(2)}</span>
        </div>
    `).join('');
    
    checkoutTotal.textContent = `$${total.toFixed(2)}`;
}

// Setup Stripe card element
function setupStripeElements() {
    const cardElementContainer = document.getElementById('card-element');
    
    cardElement = elements.create('card', {
        style: {
            base: {
                color: '#ffffff',
                fontSize: '16px',
                '::placeholder': {
                    color: '#999999'
                }
            },
            invalid: {
                color: '#ff4444'
            }
        }
    });
    
    cardElement.mount('#card-element');
    
    // Handle real-time validation errors
    cardElement.on('change', (event) => {
        const displayError = document.getElementById('card-errors');
        if (event.error) {
            displayError.textContent = event.error.message;
        } else {
            displayError.textContent = '';
        }
    });
    
    // Setup payment button
    const submitButton = document.getElementById('submit-payment');
    submitButton.addEventListener('click', handlePayment);
}

// Handle payment submission
async function handlePayment(event) {
    event.preventDefault();
    
    const submitButton = document.getElementById('submit-payment');
    submitButton.disabled = true;
    submitButton.textContent = 'Processing...';
    
    // Check if Stripe is configured
    if (!stripe) {
        showNotification('Payment system not configured. Please contact support.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Pay Now';
        
        // For demo purposes, simulate successful payment
        simulatePayment();
        return;
    }
    
    try {
        // In production, you would:
        // 1. Create a PaymentIntent on your backend
        // 2. Confirm the payment with Stripe
        // 3. Process the order on your backend
        
        // Example backend call:
        // const response = await fetch('YOUR_BACKEND_URL/api/create-payment-intent', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({
        //         amount: Math.round(getCartTotal() * 100), // Amount in cents
        //         items: cart
        //     })
        // });
        // const { clientSecret } = await response.json();
        
        // const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        //     payment_method: {
        //         card: cardElement
        //     }
        // });
        
        // For now, simulate successful payment
        simulatePayment();
        
    } catch (error) {
        console.error('Payment error:', error);
        showNotification('Payment failed. Please try again.', 'error');
        submitButton.disabled = false;
        submitButton.textContent = 'Pay Now';
    }
}

// Simulate payment for demo purposes
function simulatePayment() {
    const user = getUser();
    
    // Create order object
    const order = {
        orderId: generateOrderId(),
        userId: user.id,
        username: user.username,
        items: cart,
        total: getCartTotal(),
        date: new Date().toISOString(),
        status: 'completed'
    };
    
    // Save order to localStorage (in production, save to database)
    saveOrder(order);
    
    // Show success message
    setTimeout(() => {
        closeCheckout();
        clearCart();
        showPaymentSuccess(order);
        
        const submitButton = document.getElementById('submit-payment');
        submitButton.disabled = false;
        submitButton.textContent = 'Pay Now';
    }, 1500);
}

// Show payment success message
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
            <h2 style="color: #ff2d95; margin-bottom: 1rem;">Payment Successful!</h2>
            <p style="color: #fff; margin-bottom: 1rem;">Order #${order.orderId}</p>
            <p style="color: #ccc; margin-bottom: 1.5rem;">
                Thank you for your purchase! Your FiveM resources will be delivered to your Discord DM shortly.
            </p>
            <button onclick="this.parentElement.remove()" style="
                background-color: #ff2d95;
                color: white;
                border: none;
                padding: 0.7rem 2rem;
                border-radius: 4px;
                cursor: pointer;
                font-weight: 600;
            ">Close</button>
        </div>
    `;
    
    const overlay = document.createElement('div');
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
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };
    
    document.body.appendChild(overlay);
}

// Generate random order ID
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

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('checkoutModal');
    if (e.target === modal) {
        closeCheckout();
    }
});

// Initialize Stripe on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeStripe();
});
