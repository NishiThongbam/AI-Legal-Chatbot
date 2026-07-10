from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


from legal_router import classify_legal_issue

#Debugging
import traceback

#File Upload
import pdfplumber
import io

#Local database and AI tools
from sqlalchemy.orm import Session
from database import get_db
from models import Lawyer



#Calendar

from datetime import datetime, timedelta
from google.oauth2 import service_account
from googleapiclient.discovery import build


app = FastAPI()

# Allow your Next.js frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class IntakeRequest(BaseModel):
    user_message: str




# 1. Define the input structure matching your React frontend payload
class ScheduleRequest(BaseModel):
    lawyer_name: str
    user_email: str
    date: str  # Format from React: "YYYY-MM-DD"
    time: str  # Format from React: "HH:MM AM/PM" (e.g., "01:00 PM")

# 2. Authenticate with Google using your service_account.json
SCOPES = ['https://www.googleapis.com/auth/calendar']
SERVICE_ACCOUNT_FILE = 'service_account.json'

def get_calendar_service():
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES
        )
        return build('calendar', 'v3', credentials=creds)
    except Exception as e:
        print(f"Failed to authenticate with Google: {str(e)}")
        return None

@app.post("/api/schedule")
async def schedule_consultation(request: ScheduleRequest):
    try:
        # Get the authenticated Google Calendar service
        service = get_calendar_service()
        if not service:
            raise HTTPException(status_code=500, detail="Google Calendar service is unavailable.")

        # 3. Convert React frontend text strings into a Python Datetime object
        # Example input: date="2026-07-15", time="01:00 PM"
        combined_str = f"{request.date} {request.time}"
        start_datetime = datetime.strptime(combined_str, "%Y-%m-%d %I:%M %p")
        
        # Assume consultations last exactly 30 minutes
        end_datetime = start_datetime + timedelta(minutes=30)

        # Format datetimes into ISO format strings with a timezone offset (e.g., UTC)
        # Change "+00:00" to your specific local timezone offset if desired (e.g., "-05:00" for EST)
        iso_start = start_datetime.strftime("%Y-%m-%dT%H:%M:%S+00:00")
        iso_end = end_datetime.strftime("%Y-%m-%dT%H:%M:%S+00:00")

        # 4. Construct the Google Calendar Event structure
        event_body = {
            'summary': f'LegalConnect Consultation: {request.lawyer_name}',
            'description': f'Initial intake legal consultation arranged via LegalConnect platform for user {request.user_email}.',
            'start': {
                'dateTime': iso_start,
                'timeZone': 'UTC',
            },
            'end': {
                'dateTime': iso_end,
                'timeZone': 'UTC',
            },
            # Add the user's email as an attendee so they get the invite link automatically
            'attendees': [
                {'email': request.user_email},
            ],
            # Request an automated Google Meet video conferencing link
            'conferenceData': {
                'createRequest': {
                    'requestId': f"legalconnect_{int(datetime.now().timestamp())}",
                    'conferenceSolutionKey': {'type': 'hangoutsMeet'}
                }
            },
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'email', 'minutes': 24 * 60},
                    {'method': 'popup', 'minutes': 15},
                ],
            },
        }

        # 5. Execute the insert API call to primary calendar
        # conferenceDataVersion=1 enables Google Meet creation
        created_event = service.events().insert(
            calendarId='963fdeecafdfdf5078c33ae67966fec8d4264ffa7069698c1cd9fa30ea381b35@group.calendar.google.com',
            body=event_body,
            conferenceDataVersion=1,
            sendUpdates='all' # Sends automated email invitation to attendees
        ).execute()

        # Extract the generated Google Meet link safely
        meet_link = created_event.get('hangoutLink', 'No video link generated')

        return {
            "status": "success",
            "message": f"Appointment booked with {request.lawyer_name}",
            "html_link": created_event.get('htmlLink'),
            "meet_link": meet_link
        }

    except Exception as e:
        print("\n--- SCHEDULING ERROR DETAILS ---")
        traceback.print_exc()
        print("--------------------------------\n")
        raise HTTPException(status_code=500, detail=f"Error scheduling calendar event: {str(e)}")













@app.post("/api/intake")
async def process_intake(request: IntakeRequest, db: Session = Depends(get_db)):
    try:
        # 1. Send the user's message to Groq to figure out the legal category
        classification = classify_legal_issue(request.user_message)
        category = classification.get("category", "General")
        reasoning = classification.get("reasoning", "Standard routing applied.")

        # 2. Fetch the cheapest lawyers in the detected category from PostgreSQL
        lawyers = (
            db.query(Lawyer)
            .filter(Lawyer.specialization == category)
            .order_by(Lawyer.hourly_rate.asc()) # SORTS CHEAPEST TO MOST EXPENSIVE
            .limit(3)
            .all()
        )

        # 3. Format the database results for the React frontend
        lawyer_list = [
            {
                "lawyer_name": l.name, 
                "contact_email": l.email, 
                "rating": l.rating,
                "hourly_rate": l.hourly_rate # Include price for the UI
            } 
            for l in lawyers
        ]

        return {
            "detected_category": category,
            "reasoning": reasoning,
            "recommended_lawyers": lawyer_list
        }
    except Exception as e:
        print("\n--- ERROR DETAILS ---")
        traceback.print_exc() # This forces the terminal to print the exact line that crashed!
        print("---------------------\n")
        raise HTTPException(status_code=500, detail=f"Error processing intake: {str(e)}")

@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        # 1. Verify it's a PDF
        if file.content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are supported.")

        # 2. Read the file into memory and extract text using pdfplumber
        file_content = await file.read()
        extracted_text = ""
        with pdfplumber.open(io.BytesIO(file_content)) as pdf:
            for page in pdf.pages:
                extracted_text += page.extract_text() + "\n"

        # 3. Truncate text if it's too long (to save AI tokens)
        truncated_text = extracted_text[:3000]

        # 4. Create a prompt for the AI based on the document text
        document_prompt = f"I am uploading a legal document. Here is the text: \n\n{truncated_text}\n\nPlease analyze this document and categorize my legal issue."

        # 5. Use your AI logic to classify the document
        classification = classify_legal_issue(document_prompt)
        category = classification.get("category", "General")
        reasoning = classification.get("reasoning", "Analyzed via document upload.")

        # 6. Fetch the cheapest lawyers based on the document's category
        lawyers = (
            db.query(Lawyer)
            .filter(Lawyer.specialization == category)
            .order_by(Lawyer.hourly_rate.asc())
            .limit(3)
            .all()
        )

        lawyer_list = [
            {
                "lawyer_name": l.name, 
                "contact_email": l.email, 
                "rating": l.rating,
                "hourly_rate": l.hourly_rate
            } 
            for l in lawyers
        ]

        return {
            "detected_category": category,
            "reasoning": f"Based on the uploaded document '{file.filename}', {reasoning}",
            "recommended_lawyers": lawyer_list
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")

