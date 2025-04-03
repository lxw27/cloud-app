const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

document.getElementById('signupForm').addEventListener('submit', async function(event) {
    event.preventDefault();

    // Get input values
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const signupButton = document.querySelector('.btn-signup');
    const originalButtonText = signupButton.textContent;

    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }

    // Reset button state to clickable
    signupButton.textContent = originalButtonText;
    signupButton.disabled = false;

    // Validate password field
    if (password !== confirmPassword) {
        showErrorMessage("Passwords don't match");
        return;
    }

    if (password.length < 6) {
        showErrorMessage("Password must be at least 6 characters");
        return;
    }

    try {
        // Show loading state for signup button
        signupButton.innerHTML = '<span class="button-loading"><i class="fas fa-spinner fa-spin"></i> Signing up...</span>';
        signupButton.disabled = true;
        
        // Send signup request to FastAPI
        const response = await fetch('http://localhost:8000/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Registration failed');
        }
        
        const data = await response.json();
        
        // Show success message before redirect to login page
        const successMessage = document.createElement('div');
        successMessage.className = 'error-message';
        successMessage.style.backgroundColor = '#d4edda';
        successMessage.style.color = '#155724';
        successMessage.style.borderColor = '#c3e6cb';
        successMessage.textContent = 'Registration successful! Redirecting to login...';
        document.querySelector('.signup-header').appendChild(successMessage);
        
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1500);
        
    } catch (error) {
        showErrorMessage(`Error: ${error.message}`);
    } finally {
        signupButton.innerHTML = originalButtonText;
        signupButton.disabled = false;
    }
});

// Password visibility toggle 
const togglePasswordVisibility = (inputId, toggleId) => {
    document.getElementById(toggleId).addEventListener('click', function() {
        const passwordInput = document.getElementById(inputId);
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
};

togglePasswordVisibility('password', 'togglePassword');
togglePasswordVisibility('confirmPassword', 'toggleConfirmPassword');

// Helper function to show error messages 
function showErrorMessage(message) {
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create error message element
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = message;
    
    // Insert error message above the form
    document.querySelector('.signup-header').appendChild(errorMessage);
    
    // Removes error message after fade out
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
}

// Google signup function
document.getElementById('googleSignUp')?.addEventListener('click', async function() {
  try {
    const googleButton = document.getElementById('googleSignUp');
    const originalButtonText = googleButton.innerHTML;
    
    // Show loading state of Google signup button
    googleButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing up...';
    googleButton.disabled = true;
    
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
      existingError.remove();
    }
    
    // Sign in with Google
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    
    // Send Google ID token to backend for verification
    const response = await fetch('http://localhost:8000/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        token: await user.getIdToken()
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Google sign up failed');
    }
    
    // Show success message before redirect to dashboard
    const successMessage = document.createElement('div');
    successMessage.className = 'error-message';
    successMessage.style.backgroundColor = '#d4edda';
    successMessage.style.color = '#155724';
    successMessage.style.borderColor = '#c3e6cb';
    successMessage.textContent = 'Registration successful! Redirecting...';
    document.querySelector('.signup-header').appendChild(successMessage);
    
    setTimeout(() => {
      window.location.href = 'dashboard.html'; 
    }, 1500);
    
  } catch (error) {
    showErrorMessage(`Error: ${error.message}`);
  } finally {
    // Reset button state to clickable
    const googleButton = document.getElementById('googleSignUp');
    if (googleButton) {
      googleButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.8 2.72v2.26h2.91c1.71-1.57 2.69-3.88 2.69-6.62z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.82.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z" fill="#34A853"/><path d="M3.97 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.51.45 3.44 1.3l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/></svg><span>Sign up with Google</span>';
      googleButton.disabled = false;
    }
  }
});