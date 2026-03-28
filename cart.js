let cart = [];

function loadCart() {
    let savedCart = localStorage.getItem('rtxCart');
    if (!savedCart && localStorage.getItem('fxapCart')) {
        savedCart = localStorage.getItem('fxapCart');
        localStorage.setItem('rtxCart', savedCart);
        localStorage.removeItem('fxapCart');
    }
    if (savedCart) cart = JSON.parse(savedCart);
}

function saveCart() {
    localStorage.setItem('rtxCart', JSON.stringify(cart));
}

// Add item to cart
function addToCart(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    
    // Check if product already in cart
    const existingItem = cart.find(item => item.id === productId);
    if (existingItem) {
        showNotification('Item already in cart!', 'error');
        return;
    }
    
    cart.push({
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        category: product.category,
        subcategory: product.subcategory
    });
    
    saveCart();
    updateCartDisplay();
    showNotification(`${product.name} added to cart!`);
}

// Remove item from cart
function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
    updateCartDisplay();
    showNotification('Item removed from cart');
}

// Update cart display
function updateCartDisplay() {
    const cartCount = document.getElementById('cartCount');
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    
    // Update cart count
    cartCount.textContent = cart.length;
    
    // Update cart items
    if (cart.length === 0) {
        cartItems.innerHTML = `
            <div class="empty-cart">
                <svg fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                </svg>
                <p>Your cart is empty</p>
            </div>
        `;
    } else {
        cartItems.innerHTML = cart.map(item => `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.name}" class="cart-item-image">
                <div class="cart-item-details">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-price">$${item.price.toFixed(2)}</div>
                    <button class="remove-item-btn" onclick="removeFromCart('${item.id}')">Remove</button>
                </div>
            </div>
        `).join('');
    }
    
    // Update total
    const total = cart.reduce((sum, item) => sum + item.price, 0);
    cartTotal.textContent = `$${total.toFixed(2)}`;
}

// Toggle cart sidebar
function toggleCart() {
    const cartSidebar = document.getElementById('cartSidebar');
    cartSidebar.classList.toggle('active');
}

// Close cart when clicking outside
document.addEventListener('click', (e) => {
    const cartSidebar = document.getElementById('cartSidebar');
    const cartBtn = document.querySelector('.cart-btn');
    
    if (cartSidebar.classList.contains('active') && 
        !cartSidebar.contains(e.target) && 
        !cartBtn.contains(e.target)) {
        cartSidebar.classList.remove('active');
    }
});

// Proceed to checkout
function proceedToCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }
    
    // Check if user is logged in
    const user = getUser();
    if (!user) {
        showAuthModal();
        return;
    }
    
    // Close cart sidebar
    toggleCart();
    
    // Open checkout modal
    openCheckout();
}

// Get cart total
function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price, 0);
}

// Clear cart
function clearCart() {
    cart = [];
    saveCart();
    updateCartDisplay();
}

// Initialize cart on page load
document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    updateCartDisplay();
});
