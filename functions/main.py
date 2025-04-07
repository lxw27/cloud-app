from enum import Enum
from datetime import datetime, timedelta
from typing import Optional, List
import os
import jwt
import secrets
import uuid
import smtplib
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response, Request, Cookie, Depends, BackgroundTasks
from fastapi.security import HTTPBasicCredentials, HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from firebase_admin import credentials, firestore, auth, initialize_app

# Configuration
load_dotenv()

# Firebase
FIREBASE_CRED_PATH = os.getenv("FIREBASE_CREDENTIAL_PATH", "cloud-c8d3a-firebase-adminsdk-fbsvc-f03dced741.json")
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY")
firebase_cred = credentials.Certificate(FIREBASE_CRED_PATH)
firebase_app = initialize_app(firebase_cred)
db = firestore.client()

# JWT
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-fallback-secret-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Email
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
EMAIL_FROM = os.getenv("EMAIL_FROM", "noreply@subtrack.com")

# FastAPI setup
app = FastAPI()
security = HTTPBearer()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        secure=os.getenv("ENVIRONMENT") == "production"
    )

async def get_current_user(token: str = Cookie(None)) -> dict:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        return auth.verify_id_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

def get_user_data(user_id: str) -> Optional[dict]:
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

async def send_notification_email(user_id: str, subscriptions: list) -> bool:
    try:
        user = auth.get_user(user_id)
        if not user.email:
            return False
        
        email_body = generate_notification_email(subscriptions)
        success = send_email(
            to_email=user.email,
            subject=f"Renewal Reminder: {len(subscriptions)} subscription{'s' if len(subscriptions) > 1 else ''}",
            html_content=email_body
        )
        
        if success:
            for sub in subscriptions:
                db.collection("notifications").add({
                    "user_id": user_id,
                    "email": user.email,
                    "subscription_name": sub["service_name"],
                    "renewal_date": sub["next_renewal_date"],
                    "amount": sub["cost"],
                    "sent_at": datetime.utcnow().isoformat(),
                    "status": "sent"
                })
        return success
    except Exception as e:
        print(f"Error sending notification to {user_id}: {str(e)}")
        return False

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

class RenewalNotificationRequest(BaseModel):
    email: str 
    subscription_name: str 
    renewal_date: str 
    amount: float

# Email functions
def generate_notification_email(subscriptions: list) -> str:
    """Generate HTML email content for subscription renewals"""
    subscriptions_html = "\n".join(
        f"<li><strong>{sub['service_name']}</strong> - ${sub['cost']:.2f} (renews on {sub['next_renewal_date']})</li>"
        for sub in subscriptions
    )
    
    total_amount = sum(sub['cost'] for sub in subscriptions)
    
    return f"""
    <html>
    <body>
        <p>Hello,</p>
        <p>This is a reminder about your upcoming subscription renewals:</p>
        <ul>
            {subscriptions_html}
        </ul>
        <p><strong>Total amount: ${total_amount:.2f}</strong></p>
        <p>Thank you for using SubTrack!</p>
    </body>
    </html>
    """

def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """Send email using SMTP"""
    if not all([SMTP_SERVER, SMTP_PORT, SMTP_USER, SMTP_PASSWORD]):
        raise ValueError("SMTP configuration is incomplete")
    
    msg = MIMEMultipart()
    msg['From'] = EMAIL_FROM
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(html_content, 'html'))
    
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
            return True
    except Exception as e:
        print(f"Error sending email: {str(e)}")
        return False

# Authentication endpoints
@app.get("/")
def read_root():
    return {"message": "SubTrack API - User Authentication Service"}

@app.post("/auth/login")
async def login(user_data: UserLogin, response: Response):
    try:
        auth_result = verify_firebase_password(user_data.email, user_data.password)
        user = auth.get_user_by_email(user_data.email)

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

# Notification endpoints
# @app.post("/api/send-renewal-notification")
# async def send_renewal_notification(
#     request: RenewalNotificationRequest,
#     background_tasks: BackgroundTasks
# ):
#     try:
#         try:
#             user = auth.get_user_by_email(request.email)
#         except auth.UserNotFoundError:
#             raise HTTPException(status_code=404, detail="User not found")
        
#         email_body = generate_notification_email([{
#             "service_name": request.subscription_name,
#             "cost": request.amount,
#             "next_renewal_date": request.renewal_date
#         }])
        
#         background_tasks.add_task(
#             send_email,
#             to_email=request.email,
#             subject=f"Renewal Reminder: {request.subscription_name}",
#             html_content=email_body
#         )
        
#         db.collection("notifications").add({
#             "user_id": user.uid,
#             "email": request.email,
#             "subscription_name": request.subscription_name,
#             "renewal_date": request.renewal_date,
#             "amount": request.amount,
#             "sent_at": datetime.utcnow().isoformat(),
#             "status": "sent"
#         })
        
#         return {"message": "Notification queued for sending"}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

# @app.post("/api/check-renewals")
# async def check_upcoming_renewals(background_tasks: BackgroundTasks):
#     try:
#         tomorrow = datetime.utcnow() + timedelta(days=1)
#         tomorrow_str = tomorrow.strftime("%Y-%m-%d")
        
#         subs_ref = db.collection("subscriptions") \
#             .where("status", "==", "Active") \
#             .where("next_renewal_date", "==", tomorrow_str)
        
#         user_subs = {}
#         for sub in subs_ref.stream():
#             sub_data = sub.to_dict()
#             user_id = sub_data["user_id"]
            
#             if user_id not in user_subs:
#                 user_subs[user_id] = []
#             user_subs[user_id].append(sub_data)
        
#         processed = 0
#         for user_id, subscriptions in user_subs.items():
#             try:
#                 notified = db.collection("notifications") \
#                     .where("user_id", "==", user_id) \
#                     .where("sent_at", ">=", datetime.utcnow().strftime("%Y-%m-%d")) \
#                     .limit(1).get()
                
#                 if notified:
#                     continue
                
#                 background_tasks.add_task(
#                     send_notification_email,
#                     user_id=user_id,
#                     subscriptions=subscriptions
#                 )
                
#                 processed += 1
                
#             except Exception as e:
#                 print(f"Error processing user {user_id}: {str(e)}")
#                 continue
        
#         return {
#             "message": "Renewal check completed",
#             "users_processed": processed,
#             "subscriptions_processed": sum(len(subs) for subs in user_subs.values())
#         }
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

# # Scheduled jobs
# scheduler = BackgroundScheduler()
# scheduler.add_job(
#     func=lambda: requests.post(f"http://{os.getenv('HOST', 'localhost')}:{os.getenv('PORT', '8000')}/api/check-renewals"),
#     trigger="cron",
#     hour=9,  # 9 AM UTC
#     timezone="UTC"
# )
# scheduler.start()

# @app.on_event("shutdown")
# def shutdown_event():
#     scheduler.shutdown()