from fastapi import FastAPI, HTTPException, Response, Request, Cookie, Depends
from fastapi.security import HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore, initialize_app, auth
import firebase_admin
from pydantic import BaseModel
import secrets
import uuid
from typing import Optional
import jwt
import os
from datetime import datetime, timedelta

# Initialize Firebase Admin SDK with credentials
cred = credentials.Certificate("cloud-c8d3a-firebase-adminsdk-fbsvc-f03dced741.json")
firebase_admin.initialize_app(cred)

# Initialize Firestore
db = firestore.client()

# Create FastAPI app
app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Secret key for JWT token
SECRET_KEY = os.environ.get("JWT_SECRET_KEY")
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
    name: str

class Token(BaseModel):
    access_token: str
    token_type: str
    
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
        # Authenticate with Firebase
        user = auth.get_user_by_email(user_data.email)
        
        # In a real app, you would verify the password with Firebase Auth
        # For this example, we'll check against Firestore
        user_doc = db.collection('users').document(user.uid).get()
        if not user_doc.exists:
            raise HTTPException(status_code=401, detail="Invalid login credentials")
        
        user_dict = user_doc.to_dict()
        # WARNING: This is just for demonstration
        # In a real app, you should NEVER store plain passwords or do the comparison this way
        # Use Firebase Authentication instead
        print(user_dict.get('password_hash'))
        print(user_data.password)
        if user_dict.get('password_hash') != user_data.password:
            raise HTTPException(status_code=401, detail="Invalid password credentials")
        
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

@app.post("/auth/register")
async def register(user_data: UserCreate):
    try:
        # Check if user already exists
        try:
            existing_user = auth.get_user_by_email(user_data.email)
            if existing_user:
                raise HTTPException(status_code=400, detail="Email already registered")
        except auth.UserNotFoundError:
            pass  # This is expected if the user doesn't exist
        
        # Create user in Firebase Auth
        user = auth.create_user(
            email=user_data.email,
            password=user_data.password
        )
        
        # Store additional user data in Firestore
        user_ref = db.collection('users').document(user.uid)
        user_ref.set({
            'email': user_data.email,
            'name': user_data.name,
            'password': user_data.password,  # WARNING: In a real app, NEVER store plain passwords
            'created_at': firestore.SERVER_TIMESTAMP,
            'subscriptions': []
        })
        
        return {"message": "User registered successfully", "user_id": user.uid}
    
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
async def forgot_password(email: str):
    try:
        # Generate password reset link
        link = auth.generate_password_reset_link(email)
        # In a real app, you would send this link via email
        return {"message": "Password reset link sent", "link": link}
    except auth.UserNotFoundError:
        # Don't reveal if email exists or not for security
        return {"message": "If your email is registered, you will receive a password reset link"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password reset failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)