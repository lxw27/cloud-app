from enum import Enum
from fastapi import FastAPI, HTTPException, Response, Request, Cookie, Depends
from fastapi.security import HTTPBasicCredentials, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore, auth, initialize_app
from pydantic import BaseModel
import secrets
import uuid
from typing import Optional, List
import jwt
import os
from datetime import datetime, timedelta
import requests

# Initialize Firebase Admin SDK with credentials
firebase_cred = credentials.Certificate("cloud-c8d3a-firebase-adminsdk-fbsvc-f03dced741.json")
firebase_app = initialize_app(firebase_cred)
db = firestore.client()

# Create FastAPI app
app = FastAPI()
security = HTTPBearer()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security configuration
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-fallback-secret-key")
ALGORITHM = "HS256"
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY", "your-firebase-api-key")
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Helper functions
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def set_auth_cookie(response: Response, token: str, expires: timedelta) -> None:
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        max_age=expires.total_seconds(),
        expires=expires.total_seconds(),
        samesite="lax",
        secure=False  # Set to True if production in HTTPS
    )

async def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        return auth.verify_id_token(credentials.credentials)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

async def get_current_user(token: str = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        user = get_user_data(user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def get_user_data(user_id: str):
    user_doc = db.collection('users').document(user_id).get()
    return user_doc.to_dict() if user_doc.exists else None

def verify_firebase_password(email: str, password: str) -> dict:
    auth_url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
    payload = {"email": email, "password": password, "returnSecureToken": True}
    response = requests.post(f"{auth_url}?key={FIREBASE_API_KEY}", json=payload)
    
    if not response.ok:
        error_data = response.json()
        raise HTTPException(
            status_code=401,
            detail=error_data.get("error", {}).get("message", "Invalid credentials")
        )
    return response.json()

# Models
class UserLogin(BaseModel):
    email: str
    password: str
    remember_me: bool = False

class UserCreate(BaseModel):
    email: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    
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
async def login(user_data: UserLogin, response: Response):
    try:
        # Verify user credentials with Firebase
        auth_result = verify_firebase_password(user_data.email, user_data.password)
        user = auth.get_user_by_email(user_data.email)

        # Create access token
        expires = timedelta(days=30 if user_data.remember_me else 1)
        access_token = create_access_token(
            data={"sub": user.uid, "email": user_data.email},
            expires_delta=expires
        )
        
        set_auth_cookie(response, access_token, expires)
        return {"access_token": access_token, "token_type": "bearer", "user_id": user.uid}
    
    except auth.UserNotFoundError:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auth/google")
async def google_login(request: GoogleLoginRequest, response: Response):
    try:
        decoded_token = auth.verify_id_token(request.token)
        uid = decoded_token['uid']
        
        if not get_user_data(uid):
            # Create new user record
            user_data = {
                'uid': uid,
                'email': decoded_token.get('email'),
                'name': decoded_token.get('name'),
                'photo_url': decoded_token.get('picture'),
                'created_at': datetime.utcnow().isoformat()
            }
            db.collection('users').document(uid).set(user_data)
        
        # Create and set access token
        expires = timedelta(days=30)
        access_token = create_access_token(
            data={"sub": uid, "email": decoded_token.get('email')},
            expires_delta=expires
        )
        set_auth_cookie(response, access_token, expires)
        
        return {"access_token": access_token, "token_type": "bearer", "user_id": uid}
    
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auth/register")
async def signup(user_data: UserCreate):
    try:
        user = auth.create_user(email=user_data.email, password=user_data.password)
        db.collection('users').document(user.uid).set({
            'uid': user.uid, 
            'email': user_data.email,
            'created_at': datetime.utcnow().isoformat()
        })
        return {"message": "User created successfully", "user_id": user.uid}
        
    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="token")
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    return {k: v for k, v in current_user.items() if k != 'password'}

@app.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    try:
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={FIREBASE_API_KEY}"
        response = requests.post(url, json={
            "requestType": "PASSWORD_RESET",
            "email": request.email
        })
        
        if not response.ok:
            error_data = response.json()
            raise HTTPException(
                status_code=400,
                detail=error_data.get("error", {}).get("message", "Failed to send reset email")
            )
        return {"message": "Password reset email sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {**doc.to_dict(), "subscription_id": doc.id}

@app.post("/api/subscriptions", response_model=SubscriptionResponse)
async def create_subscription(
    subscription: Subscription,
    decoded_token: dict = Depends(verify_firebase_token)
):
    if decoded_token['uid'] != subscription.user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
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
        raise HTTPException(status_code=404, detail="Subscription not found")
    if decoded_token['uid'] != subscription.user_id:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
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