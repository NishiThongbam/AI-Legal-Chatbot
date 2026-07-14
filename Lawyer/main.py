# API and LLM
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from legal_router import classify_legal_issue

# Debugging
import traceback

# File Upload
import pdfplumber
import io

# Local database and AI tools
from sqlalchemy.orm import Session
from database import get_db
from models import Lawyer

# Calendar
from datetime import datetime, timedelta, timezone
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
    time: str  # Format from React: "HH:MM AM/PM" (e.g., "1:00 PM")

# 2. Authenticate with Google using your service_account.json
SCOPES = ['https://www.googleapis.com/auth/calendar']
SERVICE_ACCOUNT_FILE = r'D:\Project\Lawyer\service_account.json'

def get_calendar_service():
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES
        )
        return build('calendar', 'v3', credentials=creds)
    except Exception as e:
        print(f"Failed to authenticate with Google: {str(e)}")
        return None
    

@app.get("/api/availability")
async def get_availability(date: str):
    try:
        service = get_calendar_service()
        if not service:
            raise HTTPException(status_code=500, detail="Google Calendar service is unavailable.")
        
        # 1. Target Calendar ID
        calendar_id = '963fdeecafdfdf5078c33ae67966fec8d4264ffa7069698c1cd9fa30ea381b35@group.calendar.google.com' 

        # 2. Setup your exact local timezone (IST = UTC+5:30)
        IST = timezone(timedelta(hours=5, minutes=30))

        # 3. Create timezone-aware working hours for potential slots
        start_of_day = datetime.strptime(f"{date} 09:00", "%Y-%m-%d %H:%M").replace(tzinfo=IST)
        end_of_day = datetime.strptime(f"{date} 17:00", "%Y-%m-%d %H:%M").replace(tzinfo=IST)

        # 4. Check the ENTIRE day for busy blocks to prevent Google boundary bugs
        query_start = datetime.strptime(f"{date} 00:00", "%Y-%m-%d %H:%M").replace(tzinfo=IST)
        query_end = datetime.strptime(f"{date} 23:59", "%Y-%m-%d %H:%M").replace(tzinfo=IST)

        fb_request_body = {
            "timeMin": query_start.isoformat(),
            "timeMax": query_end.isoformat(),
            "items": [{"id": calendar_id}]
        }
        fb_response = service.freebusy().query(body=fb_request_body).execute() # type: ignore
        busy_slots = fb_response['calendars'][calendar_id]['busy']

        # 5. Generate 45-minute chunks
        potential_slots = []
        current_time = start_of_day
        while current_time < end_of_day:
            potential_slots.append(current_time)
            current_time += timedelta(minutes=45)

        # 6. Parse Google's UTC busy blocks into timezone-aware datetimes
        parsed_busy_blocks = []
        for block in busy_slots:
            b_start = datetime.fromisoformat(block['start'].replace('Z', '+00:00'))
            b_end = datetime.fromisoformat(block['end'].replace('Z', '+00:00'))
            parsed_busy_blocks.append((b_start, b_end))

        # 7. Check for overlaps 
        available_slots = []
        for slot_start in potential_slots:
            slot_end = slot_start + timedelta(minutes=45)
            is_overlap = False

            for b_start, b_end in parsed_busy_blocks:
                if max(slot_start, b_start) < min(slot_end, b_end):
                    is_overlap = True
                    break

            if not is_overlap:
                # .lstrip("0") ensures "09:00 AM" becomes "9:00 AM" to match React UI
                time_str = slot_start.strftime("%I:%M %p").lstrip("0")
                available_slots.append(time_str)

        return {
            "date": date,
            "available_slots": available_slots
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/schedule")
async def schedule_consultation(request: ScheduleRequest):
    try:
        service = get_calendar_service()
        if not service:
            raise HTTPException(status_code=500, detail="Google Calendar service is unavailable.")

        # 1. Define IST (UTC+5:30)
        IST = timezone(timedelta(hours=5, minutes=30))

        # 2. Parse dates, attach IST timezone, and calculate end time
        combined_str = f"{request.date} {request.time}"
        start_datetime = datetime.strptime(combined_str, "%Y-%m-%d %I:%M %p").replace(tzinfo=IST)
        end_datetime = start_datetime + timedelta(minutes=45)

        # 3. Generate ISO format strings (automatically adds +05:30)
        iso_start = start_datetime.isoformat()
        iso_end = end_datetime.isoformat()
        
        calendar_id = '963fdeecafdfdf5078c33ae67966fec8d4264ffa7069698c1cd9fa30ea381b35@group.calendar.google.com'

        # 4. ASK GOOGLE IF THE TIME SLOT IS ALREADY TAKEN
        fb_request_body = {
            "timeMin": iso_start,
            "timeMax": iso_end,
            "items": [{"id": calendar_id}]
        }
        
        fb_response = service.freebusy().query(body=fb_request_body).execute() # type: ignore
        busy_slots = fb_response['calendars'][calendar_id]['busy']

        # 5. IF BUSY, BLOCK THE BOOKING
        if len(busy_slots) > 0:
            raise HTTPException(
                status_code=400, 
                detail="Schedule collision detected. This time slot is already booked."
            )

        # 6. IF FREE, PROCEED TO CREATE THE EVENT (Removed timeZone payload to prevent shifting)
        meeting_link = "https://meet.google.com/ugo-czmi-tpf"
        event_body = {
            'summary': f'LegalConnect Consultation: {request.lawyer_name}',
            'description': f'Intake consultation for {request.user_email}.\n\nMeeting Link: {meeting_link}',
            'location': meeting_link,
            'start': {'dateTime': iso_start},
            'end': {'dateTime': iso_end},
        }

        created_event = service.events().insert(
            calendarId=calendar_id,
            body=event_body,
        ).execute()

        return {
            "status": "success",
            "message": "Appointment booked successfully!",
            "meet_link": meeting_link
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        print("\n--- SCHEDULING ERROR ---")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


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