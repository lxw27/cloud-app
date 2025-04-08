// Enhanced authentication module with comprehensive security
const AUTH_API_BASE = window.location.protocol + '//' + window.location.host + '/api/auth';

// Session timeout for 30 minutes inactivity
const SESSION_TIMEOUT = 30 * 60 * 1000;
const AUTH_CHECK_TIMEOUT = 5000;
let inactivityTimer;

// Secure cookie handling
function clearAuthCookies() {
  const cookies = document.cookie.split(';');
  cookies.forEach(cookie => {
    const [name] = cookie.trim().split('=');
    // Clear all variants of auth cookies
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}; secure; samesite=strict`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; secure; samesite=strict`;
  });
}

// Secure storage clearing
function clearUserData() {
  clearTimeout(inactivityTimer);
  
  // Clear storage
  localStorage.clear();
  sessionStorage.clear();
  
  // Clear cookies securely
  clearAuthCookies();
}

// Enhanced authentication check with retry limit
let authCheckAttempts = 0;
const MAX_AUTH_CHECK_ATTEMPTS = 3;

async function checkAuth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_CHECK_TIMEOUT);

    const response = await fetch(`${AUTH_API_BASE}/me`, {
      method: 'GET',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': getCsrfToken() || ''
      }
    });

    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        authCheckAttempts++;
        if (authCheckAttempts >= MAX_AUTH_CHECK_ATTEMPTS) {
          throw new Error('Max authentication attempts reached');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        return checkAuth();
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    authCheckAttempts = 0;
    const userData = await response.json();
    resetInactivityTimer();
    return userData;
    
  } catch (error) {
    console.error('Authentication check failed:', error);
    clearUserData();
    redirectToLogin();
    return null;
  }
}

// Enhanced logout with verification
async function logout() {
  try {
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
      throw new Error('CSRF token missing');
    }

    const response = await fetch(`${AUTH_API_BASE}/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      }
    });

    if (!response.ok) {
      throw new Error(`Logout failed with status ${response.status}`);
    }

    clearUserData();
    redirectToLogin();
  } catch (error) {
    console.error('Logout failed:', error);
    clearUserData();
    redirectToLogin();
  }
}

// Secure redirect with origin validation
function redirectToLogin() {
  const loginUrl = new URL('login.html', window.location.origin);
  loginUrl.hash = '';
  
  // Prevent open redirect vulnerabilities
  if (loginUrl.origin !== window.location.origin) {
    console.error('Invalid redirect URL');
    loginUrl.pathname = 'login.html';
  }
  
  window.location.href = loginUrl.toString();
}

// CSRF token handling with fallback
function getCsrfToken() {
  const metaTag = document.querySelector('meta[name="csrf-token"]');
  if (!metaTag || !metaTag.content) {
    console.error('CSRF token meta tag missing or empty');
    return null;
  }
  return metaTag.content;
}

// Activity monitoring with debounce
let activityDebounce;
function resetInactivityTimer() {
  clearTimeout(activityDebounce);
  activityDebounce = setTimeout(() => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      console.log('Session expired due to inactivity');
      logout();
    }, SESSION_TIMEOUT);
  }, 300); // 300ms debounce to avoid rapid firing
}

// Secure event listeners
function setupActivityMonitoring() {
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
  events.forEach(event => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
  });
}

// Initialize auth module
function initAuth() {
  setupActivityMonitoring();
  resetInactivityTimer();
}

// User info loading with sanitization
async function loadUserInfo() {
  const userData = await checkAuth();
  if (!userData) return;
  
  const sanitize = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  document.querySelectorAll('.user-name').forEach(el => {
    el.textContent = sanitize(userData.name || 'User');
  });
  
  document.querySelectorAll('.user-email').forEach(el => {
    el.textContent = sanitize(userData.email || '');
  });
}

// Logout button setup with confirmation
function setupLogoutButtons() {
  document.querySelectorAll('.logout-button').forEach(button => {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to log out?')) {
        logout();
      }
    });
  });
}

// Dashboard initialization with error boundary
function initDashboard() {
  try {
    loadUserInfo();
    setupLogoutButtons();
  } catch (error) {
    console.error('Dashboard initialization failed:', error);
    redirectToLogin();
  }
}

export { 
  checkAuth, 
  logout, 
  clearUserData, 
  initAuth,
  loadUserInfo, 
  setupLogoutButtons, 
  initDashboard 
};