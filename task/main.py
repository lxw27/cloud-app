from enum import Enum
from datetime import datetime, timedelta
from typing import Optional, List
import os
from fastapi.responses import JSONResponse
import jwt
import secrets
import uuid
import requests
from dotenv import load_dotenv
import re 
from typing import Tuple 
from fastapi import FastAPI, HTTPException, Response, Request, Cookie, Depends, status, Header 
from fastapi.security import HTTPBasicCredentials, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, constr 
from firebase_admin import credentials, firestore, auth, initialize_app
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.middleware import Middleware 
from starlette.middleware.base import BaseHTTPMiddleware

# Configuration
load_dotenv()

# Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)

# Firebase
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY")
firebase_cred = credentials.Certificate({
    "type": os.getenv("FIREBASE_TYPE"),
    "project_id": os.getenv("FIREBASE_PROJECT_ID"),
    "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
    "private_key": os.getenv("FIREBASE_PRIVATE_KEY").replace('\\n', '\n'),
    "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
    "client_id": os.getenv("FIREBASE_CLIENT_ID"),
    "auth_uri": os.getenv("FIREBASE_AUTH_URI"),
    "token_uri": os.getenv("FIREBASE_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("FIREBASE_AUTH_PROVIDER_CERT_URL"),
    "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_CERT_URL"),
    "universe_domain": os.getenv("FIREBASE_UNIVERSE_DOMAIN")
})
firebase_app = initialize_app(firebase_cred)
db = firestore.client()

# JWT
SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise ValueError("JWT_SECRET_KEY must be at least 32 characters long")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Security Headers Middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

# FastAPI setup with middleware
middleware = [
    Middleware(SecurityHeadersMiddleware),
    Middleware(
        CORSMiddleware,
        allow_origins=os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000").split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
]

# FastAPI setup
app = FastAPI(middleware=middleware)
security = HTTPBearer()

if os.getenv("ENVIRONMENT") == "production":
    app.add_middleware(HTTPSRedirectMiddleware)

# # CORS configuration
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000").split(","),
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# Rate limiting for auth endpoints
@app.exception_handler(RateLimitExceeded)
async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests"
    )

# Helper functions
def create_custom_token(uid: str) -> str:
    """Create a custom Firebase token for the user"""
    return auth.create_custom_token(uid).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def set_auth_cookies(response: Response, access_token: str, refresh_token: str, expires: timedelta) -> None:
    secure = os.getenv("ENVIRONMENT") == "production"
    cookie_prefix = "__Host-" if secure else ""
    
    response.set_cookie(
        key=f"{cookie_prefix}access_token",
        value=access_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=expires.total_seconds(),
        path="/"
    )
    
    response.set_cookie(
        key=f"{cookie_prefix}refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/auth/refresh"
    )

async def get_current_user(token: str = Cookie(None)) -> dict:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"}
        )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"}
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"}
        )

async def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        return auth.verify_id_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")

def get_user_data(user_id: str) -> Optional[dict]:
    user_doc = db.collection('users').document(user_id).get()
    return user_doc.to_dict() if user_doc.exists else None

def verify_firebase_password(email: str, password: str) -> dict:
    auth_url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    payload = {"email": email, "password": password, "returnSecureToken": True}
    response = requests.post(f"{auth_url}?key={FIREBASE_API_KEY}", json=payload)
    
    if not response.ok:
        error_data = response.json()
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return response.json()

def validate_password(password: str, email: str) -> Tuple[bool, str]:
    """Validate password meets security requirements."""
    # Check minimum length
    if len(password) < 6:
        return False, "Password must be at least 6 characters long"
    
    # Check for at least one alphabet character
    if not re.search(r'[a-zA-Z]', password):
        return False, "Password must contain at least one letter"
    
    # Check for at least one number
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
    
    # Check for at least one special character
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character"
    
    # Check if password contains email or username parts
    email_parts = email.split('@')[0].split('.')
    for part in email_parts:
        if part.lower() in password.lower() and len(part) > 3:
            return False, "Password should not contain parts of your email"
    
    return True, "Password is valid"

async def verify_csrf_token(
    request: Request,
    csrf_token: str = Header(None, alias="X-CSRF-Token")
):
    if not csrf_token or csrf_token != request.cookies.get("csrf_token"):
        raise HTTPException(status_code=403, detail="Invalid CSRF token")


# Models
class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    
class ForgotPasswordRequest(BaseModel):
    email: str

class GoogleLoginRequest(BaseModel):
    token: str

class BillingCycle(str, Enum):
    monthly = "Monthly"
    yearly = "Yearly"

class Status(str, Enum):
    active = "Active"
    cancelled = "Cancelled"

class Subscription(BaseModel):
    service_name: str
    cost: float
    billing_cycle: BillingCycle
    next_renewal_date: str
    status: Status
    user_id: str

class SubscriptionResponse(Subscription):
    subscription_id: str
    created_at: datetime
    updated_at: datetime

# Authentication endpoints
@app.get("/")
def read_root():
    return {"message": "SubTrack API - User Authentication Service"}

@app.post("/auth/login")
@limiter.limit("5/minute")
async def login(
    request: Request,
    user_data: UserLogin, 
    response: Response
):
    try:
        auth_result = verify_firebase_password(user_data.email, user_data.password)
        user = auth.get_user_by_email(user_data.email)

        access_token = create_access_token(
            data={"sub": user.uid, "email": user_data.email, "scope": "user"}
        )
        refresh_token = create_refresh_token(
            data={"sub": user.uid}
        )
        
        set_auth_cookies(response, access_token, refresh_token, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token
        )
    
    except Exception:
        # Generic error message to prevent information leakage
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
@app.post("/auth/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    refresh_token: str = Cookie(None)
):
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required"
        )
    
    try:
        payload = jwt.decode(refresh_token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )
        
        # Get user data
        user = auth.get_user(payload["sub"])
        
        # Create new tokens
        access_token = create_access_token(
            data={"sub": user.uid, "email": user.email, "scope": "user"}
        )
        new_refresh_token = create_refresh_token(
            data={"sub": user.uid}
        )
        
        set_auth_cookies(response, access_token, new_refresh_token, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
        return TokenPair(
            access_token=access_token,
            refresh_token=new_refresh_token
        )
    
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired"
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token"
        )

@app.post("/auth/google")
async def google_login(request: GoogleLoginRequest, response: Response):
    try:
        decoded_token = auth.verify_id_token(request.token)
        uid = decoded_token['uid']
        
        if not get_user_data(uid):
            user_data = {
                'uid': uid,
                'email': decoded_token.get('email'),
                'name': decoded_token.get('name'),
                'photo_url': decoded_token.get('picture'),
                'created_at': datetime.utcnow().isoformat()
            }
            db.collection('users').document(uid).set(user_data)
        
        expires = timedelta(days=30)
        access_token = create_access_token(
            data={"sub": uid, "email": decoded_token.get('email')},
            expires_delta=expires
        )
        set_auth_cookies(response, access_token, "", expires)
        
        return {"access_token": access_token, "token_type": "bearer", "user_id": uid}
    
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")

@app.post("/auth/register")
async def signup(user_data: UserCreate, request: Request):
    try:
        # Validate password
        is_valid, message = validate_password(user_data.password, user_data.email)
        if not is_valid:
            raise HTTPException(status_code=400, detail=message)
        
        # Create the user in Firebase Authentication
        user = auth.create_user(
            email=user_data.email,
            password=user_data.password,
            email_verified=False
        )
        
        # Store user info in Firestore
        db.collection('users').document(user.uid).set({
            'uid': user.uid, 
            'email': user_data.email,
            'email_verified': False,
            'created_at': datetime.utcnow().isoformat()
        })

        # Generate verification link
        verification_link = auth.generate_email_verification_link(
            user_data.email,
            action_code_settings=auth.ActionCodeSettings(
                url=f"{request.base_url}dashboard",
                handle_code_in_app=True
            )
        )
        
        # Send email via Firebase Authentication REST API
        # Note: Firebase Admin SDK doesn't directly send emails, 
        # you need to use the Auth REST API or a third-party email service
        auth_url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={FIREBASE_API_KEY}"
        response = requests.post(auth_url, json={
            "requestType": "VERIFY_EMAIL",
            "idToken": create_custom_token(user.uid)  # You'll need to get a token for the user
        })
        
        if not response.ok:
            # Log the error but don't fail registration
            print(f"Error sending verification email: {response.text}")
        
        return {
            "message": "User registered successfully. Verification email sent.",
            "user_id": user.uid,
            "email_verified": False
        }

    except auth.EmailAlreadyExistsError:
        raise HTTPException(
            status_code=400,
            detail="Email already exists. Please use a different email or login."
        )
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Registration failed: {str(e)}"
        )

@app.post("/auth/logout")
async def logout(response: Response):
    secure = os.getenv("ENVIRONMENT") == "production"
    
    response.delete_cookie(
        key="access_token",
        path="/",
        secure=secure,
        samesite="strict"
    )
    response.delete_cookie(
        key="refresh_token",
        path="/auth/refresh",
        secure=secure,
        samesite="strict"
    )
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {k: v for k, v in current_user.items() if k != 'password'}

@app.post("/auth/send-verification-email")
async def send_verification_email(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    try:
        # Get the Firebase user
        user = auth.get_user(current_user["sub"])
        
        # Generate the email verification link
        action_code_settings = auth.ActionCodeSettings(
            url=f"{request.base_url}dashboard",  # Redirect after verification
            handle_code_in_app=True
        )
        link = auth.generate_email_verification_link(
            user.email,
            action_code_settings=action_code_settings
        )
        
        return {"verification_link": link}
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    try:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={FIREBASE_API_KEY}"
        response = requests.post(url, json={
            "requestType": "PASSWORD_RESET",
            "email": request.email
        })
        
        return {"message": "If the email exists, a reset link has been sent"}
    except Exception:
        raise HTTPException(status_code=500, detail="Request failed")

# Subscription endpoints
@app.get("/api/subscriptions")
async def get_subscriptions(decoded_token: dict = Depends(verify_firebase_token)):
    subscriptions = []
    docs = db.collection('subscriptions').where('user_id', '==', decoded_token['uid']).stream()
    for doc in docs:
        sub = doc.to_dict()
        sub['subscription_id'] = doc.id
        subscriptions.append(sub)
    return subscriptions

@app.get("/api/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def get_subscription(subscription_id: str, decoded_token: dict = Depends(verify_firebase_token)):
    doc = db.collection('subscriptions').document(subscription_id).get()
    if not doc.exists or doc.to_dict()['user_id'] != decoded_token['uid']:
        raise HTTPException(status_code=404, detail="Resource not found")
    return {**doc.to_dict(), "subscription_id": doc.id}

@app.post("/api/subscriptions", response_model=SubscriptionResponse)
async def create_subscription(
    subscription: Subscription,
    decoded_token: dict = Depends(verify_firebase_token)
):
    if decoded_token['uid'] != subscription.user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    now = datetime.now()
    doc_ref = db.collection('subscriptions').document()
    subscription_data = {
        **subscription.dict(),
        "created_at": now,
        "updated_at": now
    }
    doc_ref.set(subscription_data)
    return {**subscription_data, "subscription_id": doc_ref.id}

@app.put("/api/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def update_subscription(
    subscription_id: str,
    subscription: Subscription,
    decoded_token: dict = Depends(verify_firebase_token)
):
    doc_ref = db.collection('subscriptions').document(subscription_id)
    doc = doc_ref.get()
    
    if not doc.exists or doc.to_dict()['user_id'] != decoded_token['uid']:
        raise HTTPException(status_code=404, detail="Resource not found")
    if decoded_token['uid'] != subscription.user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    update_data = {
        **subscription.dict(),
        "updated_at": datetime.now()
    }
    doc_ref.update(update_data)
    return {**doc_ref.get().to_dict(), "subscription_id": subscription_id}

@app.delete("/api/subscriptions/{subscription_id}")
async def delete_subscription(
    subscription_id: str,
    decoded_token: dict = Depends(verify_firebase_token)
):
    doc_ref = db.collection('subscriptions').document(subscription_id)
    doc = doc_ref.get()
    
    if not doc.exists or doc.to_dict()['user_id'] != decoded_token['uid']:
        raise HTTPException(status_code=404, detail="Subscription not found")
    
    doc_ref.delete()
    return {"message": "Subscription deleted successfully"}

@app.get("/api/subscriptions/total/{user_id}")
async def get_monthly_total(
    user_id: str,
    decoded_token: dict = Depends(verify_firebase_token)
):
    if decoded_token['uid'] != user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    monthly_total = 0.0
    docs = db.collection('subscriptions') \
        .where('user_id', '==', user_id) \
        .where('status', '==', 'Active').stream()
    
    for doc in docs:
        sub = doc.to_dict()
        monthly_total += sub['cost'] / (12 if sub['billing_cycle'] == 'Yearly' else 1)
            
    return {"total": round(monthly_total, 2)}

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    response = JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )
    if exc.status_code == 401:
        response.headers["WWW-Authenticate"] = "Bearer"
    return response 