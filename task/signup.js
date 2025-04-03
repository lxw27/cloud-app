document.getElementById('signupForm').addEventListener('submit', async function(event) {
    event.preventDefault();

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

    // Reset button state at start
    signupButton.textContent = originalButtonText;
    signupButton.disabled = false;

    if (password !== confirmPassword) {
        showErrorMessage("Passwords don't match");
        return;
    }

    if (password.length < 6) {
        showErrorMessage("Password must be at least 6 characters");
        return;
    }

    try {
        signupButton.innerHTML = '<span class="button-loading"><i class="fas fa-spinner fa-spin"></i> Signing up...</span>';
        signupButton.disabled = true;
        
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
        
        // Show success message before redirect
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
        // This will run regardless of success or failure
        signupButton.innerHTML = originalButtonText;
        signupButton.disabled = false;
    }
});

// Password visibility toggle functions
const togglePasswordVisibility = (inputId, toggleId) => {
    document.getElementById(toggleId).addEventListener('click', function() {
        const passwordInput = document.getElementById(inputId);
        const toggleIcon = this.querySelector('i');
        
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

// Helper function to show error messages (matches login style)
function showErrorMessage(message) {
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create and style the error message element
    const errorMessage = document.createElement('div');
    errorMessage.className = 'error-message';
    errorMessage.textContent = message;
    
    // Insert error message above the form
    document.querySelector('.signup-header').appendChild(errorMessage);
    
    // Set timeout to fade out the error message after 5 seconds
    setTimeout(() => {
        errorMessage.style.transition = 'opacity 1s ease-out';
        errorMessage.style.opacity = '0';
        
        // Remove the element after fade out completes
        setTimeout(() => {
            if (errorMessage.parentNode) {
                errorMessage.parentNode.removeChild(errorMessage);
            }
        }, 1000);
    }, 3000);
}