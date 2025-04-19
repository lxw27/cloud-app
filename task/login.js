import {app, auth, db, perf, firebaseConfig } from './firebase-config.js';
import { GoogleAuthProvider } from 'firebase/auth';

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const provider = new GoogleAuthProvider();
const db = firebase.firestore();

// Password validation (moved from Python)
function validatePassword(password, email) {
  // Check minimum length
  if (password.length < 6) {
    return { valid: false, message: "Password must be at least 6 characters long" };
  }
  
  // Check for at least one alphabet character
  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one letter" };
  }
  
  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }
  
  // Check for at least one special character
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return { valid: false, message: "Password must contain at least one special character" };
  }
  
  // Check if password contains email or username parts
  const emailParts = email.split('@')[0].split('.');
  for (const part of emailParts) {
    if (part.length > 3 && password.toLowerCase().includes(part.toLowerCase())) {
      return { valid: false, message: "Password should not contain parts of your email" };
    }
  }
  
  return { valid: true, message: "Password is valid" };
}

// Initialize security features
document.addEventListener('DOMContentLoaded', () => {  
  // Set security headers for API requests
  if (window.Headers) {
    const headers = new Headers();
    headers.append('X-Content-Type-Options', 'nosniff');
    headers.append('X-Frame-Options', 'DENY');
    headers.append('X-XSS-Protection', '1; mode=block');
    headers.append('Content-Security-Policy', "default-src 'self'");
  }
});

// Enhanced input sanitization with additional checks
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  
  // Remove potentially malicious content
  return input.replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/&/g, "&amp;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;")
              .replace(/\//g, "&#x2F;");
}

// Enhanced cookie handling
function setAuthCookies(tokenData) {
  const secure = window.location.protocol === 'https:';
  const cookiePrefix = secure ? '__Host-' : '';
  const expires = new Date(Date.now() + 3600 * 1000); // 1 hour
  
  document.cookie = `${cookiePrefix}access_token=${tokenData.access_token}; ` +
                   `Expires=${expires.toUTCString()}; ` +
                   `Path=/; ${secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict`;
  
  if (tokenData.refresh_token) {
    const refreshExpires = new Date(Date.now() + 7 * 24 * 3600 * 1000); // 7 days
    document.cookie = `${cookiePrefix}refresh_token=${tokenData.refresh_token}; ` +
                     `Expires=${refreshExpires.toUTCString()}; ` +
                     `Path=/auth/refresh; ${secure ? 'Secure; ' : ''}HttpOnly; SameSite=Strict`;
  }
}

document.getElementById('loginForm').addEventListener('submit', async function(event) {
  event.preventDefault();

  const email = sanitizeInput(document.getElementById('email').value);
  const password = document.getElementById('password').value; // Don't sanitize password
  const loginButton = document.querySelector('.btn-login');
  const originalButtonText = loginButton.textContent;

  const existingError = document.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  try {
    loginButton.innerHTML = '<span class="button-loading"><i class="fas fa-spinner fa-spin"></i> Logging in...</span>';
    loginButton.disabled = true;

    const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
    const user = userCredential.user;

    if (!user.emailVerified) {
      await firebase.auth().signOut();
      showErrorMessage('Please verify your email before logging in. Check your inbox for a verification link.');

      const resendLink = document.createElement('a');
      resendLink.textContent = "Resend verification email";
      resendLink.href = "#";
      resendLink.className = "resend-link";
      resendLink.onclick = async (e) => {
        e.preventDefault();
        try {
          await user.sendEmailVerification();
          showSuccessMessage("Verification email sent! Please check your inbox.");
        } catch (error) {
          showErrorMessage("Failed to send verification email. Please try again later.");
        }
      };

      const errorMessage = document.querySelector('.error-message');
      if (errorMessage) {
        errorMessage.appendChild(document.createElement('br'));
        errorMessage.appendChild(resendLink);
      }
      return;
    }

    // Set secure cookie with Firebase ID token
    const idToken = await user.getIdToken();
    document.cookie = `__Host-authToken=${idToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`;
    window.location.href = 'dashboard.html';
    
  } catch (error) {
    console.error('Login error:', error);
    showErrorMessage(error.message || "Login failed. Please check your credentials");
  } finally {
    loginButton.innerHTML = originalButtonText;
    loginButton.disabled = false;
  }
});

// Google sign-in with token verification
document.getElementById('googleSignIn').addEventListener('click', async function() {
  try {
    const googleButton = document.getElementById('googleSignIn');
    const originalButtonText = googleButton.innerHTML;
    googleButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
    googleButton.disabled = true;

    provider.setCustomParameters({
      prompt: 'select_account'
    });

    await auth.signOut();
    
    const result = await auth.signInWithPopup(provider).catch(error => {
      if (error.code === 'auth/popup-blocked') {
        return auth.signInWithRedirect(provider);
      }
      throw error;
    });
    
    // Handle both popup and redirect flows
    const user = result ? result.user : await auth.getRedirectResult().then(res => res.user);
    
    if (!user) throw new Error('User authentication failed');
    
    // Get ID token after successful authentication
    const idToken = await user.getIdToken();
    
    // Set secure cookie
    document.cookie = `__Host-authToken=${idToken}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600`;
    window.location.href = 'dashboard.html'; // Changed from login.html to dashboard.html
    
  } catch (error) {
    console.error('Google sign-in error:', error);
    showErrorMessage(error.message || "Google login failed");
  } finally {
    const googleButton = document.getElementById('googleSignIn');
    googleButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" class="google-logo"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.8 2.72v2.26h2.91c1.71-1.57 2.69-3.88 2.69-6.62z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.82.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z" fill="#34A853"/><path d="M3.97 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.04l3.01-2.33z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.51.45 3.44 1.3l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/></svg><span>Sign in with Google</span>';
    googleButton.disabled = false;
  }
});
    
// Password visibility toggle
document.getElementById('togglePassword').addEventListener('click', function() {
  const passwordInput = document.getElementById('password');
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

// Forgot password functionality
const forgotPasswordLink = document.querySelector('.forgot-password');
const forgotPasswordModal = document.getElementById('forgotPasswordModal');
const closeModal = document.querySelector('.close-modal');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const resetFeedback = document.getElementById('resetFeedback');

forgotPasswordLink.addEventListener('click', function(event) {
  event.preventDefault();
  const email = document.getElementById('email').value;
  if (email) {
    document.getElementById('reset-email').value = email;
  }
  forgotPasswordModal.style.display = 'block';
});

closeModal.addEventListener('click', function() {
  forgotPasswordModal.style.display = 'none';
  resetFeedback.style.display = 'none';
});

window.addEventListener('click', function(event) {
  if (event.target === forgotPasswordModal) {
    forgotPasswordModal.style.display = 'none';
    resetFeedback.style.display = 'none';
  }
});

forgotPasswordForm.addEventListener('submit', async function(event) {
  event.preventDefault();

  const email = sanitizeInput(document.getElementById('reset-email').value);
  const resetButton = document.querySelector('.btn-reset');
  const originalButtonText = resetButton.innerHTML;
  
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFeedback('Please enter a valid email address', 'error');
    return;
  }
  
  try {
    resetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    resetButton.disabled = true;
    resetFeedback.style.display = 'none';
    
    await auth.sendPasswordResetEmail(email);
    showFeedback('Password reset link sent. Please check your email.', 'success');
    
    setTimeout(() => {
      forgotPasswordModal.style.display = 'none';
      resetFeedback.style.display = 'none';
    }, 3000);
     
  } catch (error) {
    let errorMessage = 'Failed to send reset link';
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }
    
    showFeedback(errorMessage, 'error');
    
  } finally {
    resetButton.innerHTML = originalButtonText;
    resetButton.disabled = false;
  }
});

// Helper functions
function showFeedback(message, type) {
  resetFeedback.textContent = message;
  resetFeedback.className = 'feedback-message ' + type;
  resetFeedback.style.display = 'block';
}

function showErrorMessage(message) {
  const existingError = document.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  const errorMessage = document.createElement('div');
  errorMessage.className = 'error-message';
  errorMessage.textContent = message;
  document.querySelector('.login-header').appendChild(errorMessage);
  
  setTimeout(() => {
    errorMessage.style.transition = 'opacity 1s ease-out';
    errorMessage.style.opacity = '0';
    setTimeout(() => {
      if (errorMessage.parentNode) {
        errorMessage.parentNode.removeChild(errorMessage);
      }
    }, 1000);
  }, 5000);
}

function showSuccessMessage(message) {
  const existingError = document.querySelector('.error-message');
  if (existingError) existingError.remove();
  
  const successMessage = document.createElement('div');
  successMessage.className = 'error-message success';
  successMessage.style.backgroundColor = '#d4edda';
  successMessage.style.color = '#155724';
  successMessage.style.borderColor = '#c3e6cb';
  successMessage.textContent = message;
  document.querySelector('.login-header').appendChild(successMessage);
  
  setTimeout(() => {
    successMessage.style.transition = 'opacity 1s ease-out';
    successMessage.style.opacity = '0';
    setTimeout(() => {
      if (successMessage.parentNode) {
        successMessage.parentNode.removeChild(successMessage);
      }
    }, 1000);
  }, 5000);
}