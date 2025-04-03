// auth-utils.js - Common authentication utilities

// Check if user is logged in
async function checkAuth() {
    try {
      const response = await fetch('http://localhost:8000/auth/me', {
        method: 'GET',
        credentials: 'include', // Important for cookies
      });
      
      if (!response.ok) {
        // Redirect to login if not authenticated
        window.location.href = 'login.html';
        return null;
      }
      
      return await response.json();
    } catch (error) {
      console.error('Authentication check failed:', error);
      window.location.href = 'login.html';
      return null;
    }
  }
  
  // Logout function
  async function logout() {
    try {
      await fetch('http://localhost:8000/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      
      // Clear any stored data
      localStorage.removeItem('user_id');
      sessionStorage.removeItem('user_id');
      
      // Redirect to login
      window.location.href = 'login.html';
    } catch (error) {
      console.error('Logout failed:', error);
      alert('Logout failed. Please try again.');
    }
  }
  
  // Populate user info in the dashboard
  async function loadUserInfo() {
    const userData = await checkAuth();
    if (!userData) return;
    
    // Find elements to update with user info
    const userNameElements = document.querySelectorAll('.user-name');
    const userEmailElements = document.querySelectorAll('.user-email');
    
    // Update elements with user data
    userNameElements.forEach(el => {
      el.textContent = userData.name || 'User';
    });
    
    userEmailElements.forEach(el => {
      el.textContent = userData.email || '';
    });
  }
  
  // Add logout event listeners
  function setupLogoutButtons() {
    const logoutButtons = document.querySelectorAll('.logout-button');
    logoutButtons.forEach(button => {
      button.addEventListener('click', logout);
    });
  }
  
  // Initialize dashboard
  function initDashboard() {
    // Check authentication and load user info
    loadUserInfo();
    
    // Setup logout buttons
    setupLogoutButtons();
  }
  
  // Export utilities
  export { checkAuth, logout, loadUserInfo, setupLogoutButtons, initDashboard };