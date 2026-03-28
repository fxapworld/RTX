// RTX storefront

let allProducts = [];
let filteredProducts = [];
let currentCategory = null;
let currentSubcategory = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadProducts();
    displayProducts(allProducts);
    updateCartDisplay();
    checkAuthStatus();

    document.getElementById('productsGrid').addEventListener('click', (e) => {
        if (e.target.closest('.add-to-cart-btn')) return;
        const card = e.target.closest('.product-card');
        if (card && card.dataset.id) openProductModal(card.dataset.id);
    });
});

async function loadProducts() {
    try {
        const response = await fetch('products.json');
        const data = await response.json();
        allProducts = data.products;
        filteredProducts = allProducts;
    } catch (error) {
        console.error('Error loading products:', error);
        showNotification('Error loading products', 'error');
    }
}

function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/** YouTube / Vimeo → embed URL for iframe */
function getVideoEmbedUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const u = url.trim();
    const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    return null;
}

function openProductModal(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    const modal = document.getElementById('productModal');
    const body = document.getElementById('productModalBody');
    const embed = product.video ? getVideoEmbedUrl(product.video) : null;
    const desc = product.longDescription || product.description;
    const tags = (product.tags || []).map(t => `<span class="product-detail-tag">${escapeHtml(t)}</span>`).join('');

    body.innerHTML = `
        <h2 id="productModalTitle">${escapeHtml(product.name)}</h2>
        <p style="color: var(--muted); margin-bottom: 1rem;">${escapeHtml(product.category)} / ${escapeHtml(product.subcategory)}</p>
        ${embed ? `
            <div class="product-video-wrap">
                <iframe src="${escapeHtml(embed)}" title="Product video" allowfullscreen loading="lazy"></iframe>
            </div>
        ` : `<img src="${escapeHtml(product.image)}" alt="" class="product-detail-hero">`}
        <div class="product-detail-meta">${tags}</div>
        <p style="color: #ccc; line-height: 1.65;">${escapeHtml(desc)}</p>
        ${product.downloadUrl ? `<p style="margin-top: 1rem; font-size: 0.9rem; color: var(--muted);">Download is provided after purchase (configure delivery in your backend).</p>` : ''}
        <div class="product-detail-actions">
            <span class="product-price" style="font-size: 1.75rem;">$${product.price.toFixed(2)}</span>
            <button type="button" class="add-to-cart-btn" data-product-id="">Add to Cart</button>
            <button type="button" class="btn-outline" data-close-modal>Close</button>
        </div>
    `;

    const addBtn = body.querySelector('.add-to-cart-btn');
    addBtn.dataset.productId = product.id;
    addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToCart(product.id);
    });
    body.querySelector('[data-close-modal]').addEventListener('click', closeProductModal);

    modal.classList.add('active');
}

function closeProductModal() {
    document.getElementById('productModal').classList.remove('active');
}

document.addEventListener('click', (e) => {
    const modal = document.getElementById('productModal');
    if (e.target === modal) closeProductModal();
});

function displayProducts(products) {
    const grid = document.getElementById('productsGrid');
    const noResults = document.getElementById('noResults');

    if (products.length === 0) {
        grid.innerHTML = '';
        noResults.style.display = 'block';
        return;
    }

    noResults.style.display = 'none';
    grid.innerHTML = products.map(product => {
        const hasVideo = !!(product.video && getVideoEmbedUrl(product.video));
        const idAttr = escapeHtml(product.id).replace(/"/g, '&quot;');
        return `
        <div class="product-card" data-id="${idAttr}">
            ${hasVideo ? '<span class="video-badge">Video</span>' : ''}
            <img src="${escapeHtml(product.image)}" alt="" class="product-image">
            <div class="product-info">
                <div class="product-category">${escapeHtml(product.category)} / ${escapeHtml(product.subcategory)}</div>
                <h3 class="product-name">${escapeHtml(product.name)}</h3>
                <p class="product-description">${escapeHtml(product.description)}</p>
                <div class="product-footer">
                    <span class="product-price">$${product.price.toFixed(2)}</span>
                    <button type="button" class="add-to-cart-btn">
                        Add to Cart
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join('');

    grid.querySelectorAll('.product-card').forEach((card, i) => {
        const product = products[i];
        const btn = card.querySelector('.add-to-cart-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            addToCart(product.id);
        });
    });
}

function filterByCategory(category, subcategory) {
    currentCategory = category;
    currentSubcategory = subcategory;

    filteredProducts = allProducts.filter(p =>
        p.category === category && p.subcategory === subcategory
    );

    displayProducts(filteredProducts);
    updateCategoryTitle(category, subcategory);
}

function showAllProducts() {
    currentCategory = null;
    currentSubcategory = null;
    filteredProducts = allProducts;
    displayProducts(allProducts);
    document.getElementById('categoryTitle').textContent = 'All Products';
}

function updateCategoryTitle(category, subcategory) {
    const title = document.getElementById('categoryTitle');
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    const subcategoryName = subcategory.charAt(0).toUpperCase() + subcategory.slice(1);
    title.textContent = `${categoryName} > ${subcategoryName}`;
}

function searchProducts() {
    const searchInput = document.getElementById('searchInput').value.toLowerCase();

    if (searchInput.trim() === '') {
        if (currentCategory && currentSubcategory) {
            filterByCategory(currentCategory, currentSubcategory);
        } else {
            showAllProducts();
        }
        return;
    }

    filteredProducts = allProducts.filter(product => {
        const longDesc = (product.longDescription || '').toLowerCase();
        return (
            product.name.toLowerCase().includes(searchInput) ||
            product.description.toLowerCase().includes(searchInput) ||
            longDesc.includes(searchInput) ||
            product.tags.some(tag => tag.toLowerCase().includes(searchInput)) ||
            product.category.toLowerCase().includes(searchInput) ||
            product.subcategory.toLowerCase().includes(searchInput)
        );
    });

    displayProducts(filteredProducts);
    document.getElementById('categoryTitle').textContent = `Search results for "${document.getElementById('searchInput').value}"`;
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchProducts();
        });
    }
});

function showNotification(message, type = 'success') {
    const bg = type === 'success' ? '#ff2d95' : '#ff4466';
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: ${bg};
        color: white;
        padding: 1rem 2rem;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(255, 45, 149, 0.35);
        z-index: 10000;
        animation: slideIn 0.3s ease-out;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(400px); opacity: 0; }
    }
`;
document.head.appendChild(style);
