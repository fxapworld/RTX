// Discord OAuth — RTX storefront

// Check authentication status
function checkAuthStatus() {
    const user = getUser();
    const userBtn = document.getElementById('userBtn');
    const userText = document.getElementById('userText');
    
    if (user) {
        userText.textContent = user.username;
        userBtn.onclick = logout;
    } else {
        userText.textContent = 'Login';
        userBtn.onclick = handleAuth;
    }
    
    // Check for OAuth callback
    handleOAuthCallback();
}

// Handle auth button click
function handleAuth() {
    const user = getUser();
    if (user) {
        logout();
    } else {
        showAuthModal();
    }
}

// Show authentication modal
function showAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.add('active');
}

// Close authentication modal
function closeAuthModal() {
    const modal = document.getElementById('authModal');
    modal.classList.remove('active');
}

// Login with Discord
function loginWithDiscord() {
    const { clientId, redirectUri, scope } = CONFIG.discord;
    
    // Generate random state for security
    const state = generateRandomState();
    sessionStorage.setItem('oauth_state', state);
    
    // Build Discord OAuth URL
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&state=${state}`;
    
    // Redirect to Discord
    window.location.href = authUrl;
}

// Handle OAuth callback
function handleOAuthCallback() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;
    
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const state = params.get('state');
    
    // Verify state
    const savedState = sessionStorage.getItem('oauth_state');
    if (state !== savedState) {
        console.error('Invalid state parameter');
        return;
    }
    
    if (accessToken) {
        // Fetch user info from Discord
        fetchDiscordUser(accessToken);
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
        sessionStorage.removeItem('oauth_state');
    }
}

// Fetch Discord user information
async function fetchDiscordUser(accessToken) {
    try {
        const response = await fetch('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });
        
        if (!response.ok) throw new Error('Failed to fetch user');
        
        const userData = await response.json();
        
        // Save user data
        const user = {
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar,
            accessToken: accessToken
        };
        
        saveUser(user);
        
        // Try to join Discord server
        await joinDiscordServer(user);
        
        // Update UI
        checkAuthStatus();
        closeAuthModal();
        showNotification(`Welcome, ${user.username}!`);
        
    } catch (error) {
        console.error('Error fetching Discord user:', error);
        showNotification('Failed to login with Discord', 'error');
    }
}

// Join Discord server (requires bot)
async function joinDiscordServer(user) {
    // Note: This requires a backend server with bot token
    // This is a placeholder for the frontend implementation
    
    try {
        // In production, you would call your backend API here
        // Example:
        // await fetch('YOUR_BACKEND_URL/api/discord/join', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({
        //         userId: user.id,
        //         accessToken: user.accessToken
        //     })
        // });
        
        console.log('Discord server join would be handled by backend');
        showNotification('Please join our Discord server to complete setup!');
        
        // Open Discord server invite in new tab
        // Replace with your actual Discord invite link
        // window.open('https://discord.gg/YOUR_INVITE', '_blank');
        
    } catch (error) {
        console.error('Error joining Discord server:', error);
    }
}

function saveUser(user) {
    localStorage.setItem('rtxUser', JSON.stringify(user));
}

function getUser() {
    let userStr = localStorage.getItem('rtxUser');
    if (!userStr && localStorage.getItem('fxapUser')) {
        userStr = localStorage.getItem('fxapUser');
        localStorage.setItem('rtxUser', userStr);
        localStorage.removeItem('fxapUser');
    }
    return userStr ? JSON.parse(userStr) : null;
}

function logout() {
    localStorage.removeItem('rtxUser');
    checkAuthStatus();
    showNotification('Logged out successfully');
}

// Generate random state for OAuth
function generateRandomState() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('authModal');
    if (e.target === modal) {
        closeAuthModal();
    }
});

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
});
