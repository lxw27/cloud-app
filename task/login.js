document.getElementById('loginForm').addEventListener('submit', async function(event) {
  event.preventDefault();

  // Get input values
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  // const rememberMe = document.getElementById('remember-me').checked;
  
  const loginButton = document.querySelector('.btn-login');
  const originalButtonText = loginButton.textContent;
  
  try {
    // Show loading state for login button
    loginButton.innerHTML = '<span class="button-loading"><i class="fas fa-spinner fa-spin"></i> Logging in...</span>';
    loginButton.disabled = true;
    
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Send login request to FastAPI 
    const response = await fetch('http://localhost:8000/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include', 
        body: JSON.stringify({
            email: email,
            password: password,
            // remember_me: rememberMe
        })
    });
    
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Login failed. Please check your credentials and try again.');
    }
    
    const data = await response.json();
    
    // Store token in localStorage (optional, since we're also using HTTP-only cookies)
    // if (rememberMe) {
    //     localStorage.setItem('user_id', data.user_id);
    // } else {
    //     sessionStorage.setItem('user_id', data.user_id);
    // }
    
    // Redirect to dashboard for successful login
    window.location.href = 'dashboard.html';
  } catch (error) {
    // Display error message
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = error.message;
    
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Insert error message above the form
    document.querySelector('.login-header').appendChild(errorMessage);
    
    // Fades out error message after 3 seconds
    setTimeout(() => {
        errorMessage.style.transition = 'opacity 1s ease-out';
        errorMessage.style.opacity = '0';
        
        // Remove error message after fade out 
        setTimeout(() => {
            if (errorMessage.parentNode) {
                errorMessage.parentNode.removeChild(errorMessage);
            }
        }, 1000);
    }, 3000);
    
    // Reset button state to clickable 
    loginButton.innerHTML = originalButtonText;
    loginButton.disabled = false;
  }
});
    
// Password visibility toggle
document.getElementById('togglePassword').addEventListener('click', function() {
  const passwordInput = document.getElementById('password');
  const toggleIcon = this.querySelector('i');

  // Toggle the password input type (visible or not)
  if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      toggleIcon.classList.remove('fa-eye');
      toggleIcon.classList.add('fa-eye-slash');
  } else {
      passwordInput.type = 'password';
      toggleIcon.classList.remove('fa-eye-slash');
      toggleIcon.classList.add('fa-eye');
  }
});
    
// Get input value for forget password 
const forgotPasswordLink = document.querySelector('.forgot-password');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const closeModal = document.querySelector('.close-modal');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const resetFeedback = document.getElementById('resetFeedback');

// Pop-up window for forget password
forgotPasswordLink.addEventListener('click', function(event) {
  event.preventDefault();
  const email = document.getElementById('email').value;
  if (email) {
    document.getElementById('reset-email').value = email;
  }
  forgotPasswordModal.style.display = 'block';
});

// Close pop-up window for forget password when 'X' clicked
closeModal.addEventListener('click', function() {
  forgotPasswordModal.style.display = 'none';
  resetFeedback.style.display = 'none';
});

// Close pop-up window for forget password when window is clicked
window.addEventListener('click', function(event) {
  if (event.target === forgotPasswordModal) {
    forgotPasswordModal.style.display = 'none';
    resetFeedback.style.display = 'none';
  }
});

// Forget password form submission
forgotPasswordForm.addEventListener('submit', async function(event) {
  event.preventDefault();
  
  const email = document.getElementById('reset-email').value;
  const resetButton = document.querySelector('.btn-reset');
  const originalButtonText = resetButton.innerHTML;
  
  // Validate email format
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFeedback('Please enter a valid email address', 'error');
    return;
  }
  
  try {
    // Show loading state for send email button
    resetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    resetButton.disabled = true;
    resetFeedback.style.display = 'none';
    
    const response = await fetch('http://localhost:8000/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',  
      },
      body: JSON.stringify({ email })  
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Handle specific error cases
      if (response.status === 400) {
        throw new Error(data.detail || 'Email is required');
      }
      throw new Error(data.detail || 'Failed to send reset link');
    }
    
    showFeedback(data.message || 'Password reset link sent. Please check your email.', 'success');
    
    // Close pop-up window for forget password after 3 seconds
    setTimeout(() => {
      forgotPasswordModal.style.display = 'none';
      resetFeedback.style.display = 'none';
    }, 3000);
    
  } catch (error) {
    let errorMessage = 'Failed to send reset link';
    
    // Handle different error types
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    showFeedback(errorMessage, 'error');
    
  } finally {
    // Reset button state to clickable
    resetButton.innerHTML = originalButtonText;
    resetButton.disabled = false;
  }
});

// Helper function to show feedback messages
function showFeedback(message, type) {
  resetFeedback.textContent = message;
  resetFeedback.className = 'feedback-message ' + type;
  resetFeedback.style.display = 'block';
}