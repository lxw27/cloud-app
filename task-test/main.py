from enum import Enum
from fastapi import FastAPI, HTTPException, Response, Request, Cookie, Depends
from fastapi.security import HTTPBasicCredentials, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore, initialize_app, auth
import firebase_admin
from pydantic import BaseModel
import secrets
import uuid
from typing import Optional, List
import jwt
import os
from datetime import datetime, timedelta
import requests
from firebase_admin import auth as firebase_auth

# Initialize Firebase Admin SDK with credentials
cred = credentials.Certificate("cloud-c8d3a-firebase-adminsdk-fbsvc-f03dced741.json")
firebase_admin.initialize_app(cred)

# Initialize Firestore
db = firestore.client()

# Create FastAPI app
app = FastAPI()
security = HTTPBearer()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000", "http://localhost"],  # In production, replace with specific domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secret key for JWT token
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-fallback-secret-key")  # Add fallback
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Pydantic models for request validation
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
    
# Helper functions
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Cookie(None)):
    if token is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        # Verify the token
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        
        # Get user from Firestore
        user_doc = db.collection('users').document(user_id).get()
        if not user_doc.exists:
            raise HTTPException(status_code=401, detail="User not found")
        
        return user_doc.to_dict()
    except jwt.JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

@app.get("/")
def read_root():
    return {"message": "SubTrack API - User Authentication Service"}

@app.post("/auth/login")
async def login(user_data: UserLogin, response: Response):
    try:
        # Use Firebase Admin SDK to get the user
        user = auth.get_user_by_email(user_data.email)
        
        # For password verification, you need to use the Firebase Auth REST API
        # since the Admin SDK doesn't have a direct password verification method
        import requests
        
        # Firebase Auth REST API endpoint
        firebase_auth_url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        api_key = "AIzaSyDtUAf_vVUdR_sknDbFqdAG3lu6Zo0jp9o"  # Get this from Firebase console
        
        payload = {
            "email": user_data.email,
            "password": user_data.password,
            "returnSecureToken": True
        }
        
        auth_response = requests.post(
            f"{firebase_auth_url}?key={api_key}", 
            json=payload
        )
        
        if not auth_response.ok:
            raise HTTPException(status_code=401, detail="Invalid login credentials")
        
        # If we're here, the password was correct
        # Get user data from Firestore
        user_doc = db.collection('users').document(user.uid).get()
        if not user_doc.exists:
            raise HTTPException(status_code=404, detail="User record not found")
        
        # Create access token
        expires = timedelta(days=30 if user_data.remember_me else 1)
        access_token = create_access_token(
            data={"sub": user.uid, "email": user_data.email},
            expires_delta=expires
        )
        
        # Set the token as a cookie
        response.set_cookie(
            key="token",
            value=access_token,
            httponly=True,
            max_age=expires.total_seconds() if user_data.remember_me else None,
            expires=expires.total_seconds() if user_data.remember_me else None,
            samesite="lax",
            secure=False  # Set to True in production with HTTPS
        )
        
        return {"access_token": access_token, "token_type": "bearer", "user_id": user.uid}
    
    except auth.UserNotFoundError:
        raise HTTPException(status_code=401, detail="Invalid user credentials")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")

@app.post("/auth/google")
async def google_login(request: GoogleLoginRequest, response: Response):
    try:
        # Verify the Google ID token
        decoded_token = firebase_auth.verify_id_token(request.token)
        uid = decoded_token['uid']
        
        # Check if user exists in Firestore
        user_doc = db.collection('users').document(uid).get()
        
        if not user_doc.exists:
            # Create new user record if this is their first time signing in
            user_data = {
                'uid': uid,
                'email': decoded_token.get('email'),
                'name': decoded_token.get('name'),
                'photo_url': decoded_token.get('picture'),
                'created_at': datetime.utcnow().isoformat()
            }
            db.collection('users').document(uid).set(user_data)
        
        # Create access token
        expires = timedelta(days=30)  # You can adjust this as needed
        access_token = create_access_token(
            data={"sub": uid, "email": decoded_token.get('email')},
            expires_delta=expires
        )
        
        # Set the token as a cookie
        response.set_cookie(
            key="token",
            value=access_token,
            httponly=True,
            max_age=expires.total_seconds(),
            expires=expires.total_seconds(),
            samesite="lax",
            secure=False  # Set to True in production with HTTPS
        )
        
        return {"access_token": access_token, "token_type": "bearer", "user_id": uid}
    
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Google login failed: {str(e)}")

@app.post("/auth/register")
async def signup(user_data: UserCreate):
    try:
        # Create the user in Firebase Authentication
        user = auth.create_user(
            email=user_data.email,
            password=user_data.password
        )
        
        # Store user data in Firestore
        user_data_dict = {
            'uid': user.uid, 
            'email': user_data.email
        }
        
        db.collection('users').document(user.uid).set(user_data_dict)
        
        return {
            "message": "User created successfully",
            "user_id": user.uid,
            "email": user_data.email
        }
        
    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key="token")
    return {"message": "Logged out successfully"}

@app.get("/auth/me")
async def get_me(current_user = Depends(get_current_user)):
    # Remove sensitive information
    if 'password' in current_user:
        del current_user['password']
    return current_user

@app.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    try:
        email = request.email
        
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")

        # Firebase REST API endpoint
        url = f"https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=AIzaSyDtUAf_vVUdR_sknDbFqdAG3lu6Zo0jp9o"
        
        payload = {
            "requestType": "PASSWORD_RESET",
            "email": email
        }
        
        response = requests.post(url, json=payload)
        
        if not response.ok:
            error_data = response.json()
            raise HTTPException(status_code=400, detail=error_data.get("error", {}).get("message", "Failed to send reset email"))
        
        return {"message": "Password reset email sent"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")
    
@app.get("/api/subscriptions")
async def get_subscriptions(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        # Verify Firebase token
        decoded_token = auth.verify_id_token(credentials.credentials)
        user_id = decoded_token['uid']
        
        # Rest of your subscription logic
        subscriptions = []
        docs = db.collection('subscriptions').where('user_id', '==', user_id).stream()
        for doc in docs:
            sub = doc.to_dict()
            sub['subscription_id'] = doc.id
            subscriptions.append(sub)
        return subscriptions
        
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

@app.get("/api/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def get_subscription(subscription_id: str):
    doc = db.collection('subscriptions').document(subscription_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Subscription not found")
    sub = doc.to_dict()
    sub['subscription_id'] = doc.id
    return sub

@app.post("/api/subscriptions", response_model=SubscriptionResponse)
async def create_subscription(subscription: Subscription, credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        # Verify Firebase ID token
        decoded_token = auth.verify_id_token(credentials.credentials)
        if decoded_token['uid'] != subscription.user_id:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Add to Firestore
        doc_ref = db.collection('subscriptions').document()
        now = datetime.now()
        subscription_data = subscription.dict()
        subscription_data['created_at'] = now
        subscription_data['updated_at'] = now
        doc_ref.set(subscription_data)
        
        # Return created subscription
        created_sub = subscription_data.copy()
        created_sub['subscription_id'] = doc_ref.id
        return created_sub
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.put("/api/subscriptions/{subscription_id}", response_model=SubscriptionResponse)
async def update_subscription(
    subscription_id: str, 
    subscription: Subscription,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    try:
        # Verify Firebase ID token
        decoded_token = auth.verify_id_token(credentials.credentials)
        if decoded_token['uid'] != subscription.user_id:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Update in Firestore
        doc_ref = db.collection('subscriptions').document(subscription_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Subscription not found")
        
        update_data = subscription.dict()
        update_data['updated_at'] = datetime.now()
        doc_ref.update(update_data)
        
        # Return updated subscription
        updated_sub = doc_ref.get().to_dict()
        updated_sub['subscription_id'] = subscription_id
        return updated_sub
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/subscriptions/{subscription_id}")
async def delete_subscription(
    subscription_id: str,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    try:
        # Verify Firebase ID token
        decoded_token = auth.verify_id_token(credentials.credentials)
        
        # Check if subscription belongs to user
        doc_ref = db.collection('subscriptions').document(subscription_id)
        doc = doc_ref.get()
        if not doc.exists:
            raise HTTPException(status_code=404, detail="Subscription not found")
        if doc.to_dict()['user_id'] != decoded_token['uid']:
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Delete subscription
        doc_ref.delete()
        return {"message": "Subscription deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/subscriptions/total/{user_id}")
async def get_monthly_total(user_id: str):
    try:
        # Calculate total monthly cost
        monthly_total = 0.0
        docs = db.collection('subscriptions').where('user_id', '==', user_id).where('status', '==', 'Active').stream()
        
        for doc in docs:
            sub = doc.to_dict()
            if sub['billing_cycle'] == 'Monthly':
                monthly_total += sub['cost']
            else:  # Yearly
                monthly_total += sub['cost'] / 12
                
        return {"total": round(monthly_total, 2)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))