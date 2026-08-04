# API and LLM
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, APIRouter, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from fastapi.responses import Response
import qrcode
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader


from legal_router import classify_legal_issue

# Debugging
import traceback

# File Upload
import pytesseract
from pdf2image import convert_from_bytes
from PIL import Image
import pdfplumber
import io

# Local database and AI tools
from sqlalchemy.orm import Session
from database import get_db
from models import Lawyer, RequiredDocument


# Calendar
from datetime import datetime, timedelta, timezone
from google.oauth2 import service_account
from googleapiclient.discovery import build


pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'



app = FastAPI()


import os
from dotenv import load_dotenv
from groq import Groq
load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

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


# 1. Define what a single history message looks like
class HistoryMessage(BaseModel):
    role: str
    content: str

# 2. Update the request to accept the history array
class ChatRequest(BaseModel):
    user_message: str
    history: List[HistoryMessage] = []


class TokenRequest(BaseModel):
    token_id: str
    client_email: str
    client_name: str
    lawyer_name: str
    date: str
    time: str


# 2. Authenticate with Google using your service_account.json
SCOPES = ['https://www.googleapis.com/auth/calendar']
SERVICE_ACCOUNT_FILE = r'service_account.json'

def get_calendar_service():
    try:
        creds = service_account.Credentials.from_service_account_file(
            SERVICE_ACCOUNT_FILE, scopes=SCOPES
        )
        return build('calendar', 'v3', credentials=creds)
    except Exception as e:
        print(f"Failed to authenticate with Google: {str(e)}")
        return None



@app.post("/api/chat")
async def general_chat(request: ChatRequest):
    try:
        # 1. Update system instructions to strictly enforce legal relevance
        messages_for_ai = [
            {
                "role": "system",
                "content": (
                    "You are a specialized legal AI assistant for LegalConnect. "
                    "CRITICAL RULE: Evaluate the user's query. If the topic is unrelated to legal matters, law, contracts, regulations, or court procedures in any manner, you must refuse to answer. "
                    "Respond with exactly this message if off-topic: 'I am programmed to assist only with legal matters. Please ask a legal question or switch to the appropriate service.' "
                    "If the query is legal, answer clearly and concisely, and always include a disclaimer that you are an AI and not providing official legal advice."
                )
            }
        ]

        # 2. Inject short-term memory history
        for msg in request.history:
            messages_for_ai.append({"role": msg.role, "content": msg.content})

        # 3. Append the new message
        messages_for_ai.append({"role": "user", "content": request.user_message})

        # 4. Call Groq
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages_for_ai, # type: ignore
            temperature=0.2, # Lower temperature makes it stricter and more consistent
            max_tokens=1024,
        )
        
        ai_reply = completion.choices[0].message.content
        
        return {"reply": ai_reply}
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    

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
        # 1. AI detects the category
        classification = classify_legal_issue(request.user_message) # (or document_prompt)
        category = classification.get("category", "General")
        reasoning = classification.get("reasoning", "Standard routing applied.")

        # 2. NEW: Query the database for exact required documents
        db_docs = db.query(RequiredDocument).filter(RequiredDocument.category == category).all()
        
        # 3. Extract just the names into a list
        required_docs = [doc.document_name for doc in db_docs]
        
        # Fallback to "General" if the AI returns a weird category that isn't in our DB
        if len(required_docs) == 0:
            db_docs = db.query(RequiredDocument).filter(RequiredDocument.category == "General").all()
            required_docs = [doc.document_name for doc in db_docs]

        # 4. Fetch the lawyers as usual
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

        # 5. Return the payload to React
        return {
            "detected_category": category,
            "reasoning": reasoning,
            "required_documents": required_docs,
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
        # 1. Accept PDFs AND Images
        allowed_types = ["application/pdf", "image/jpeg", "image/jpg", "image/png"]
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Only PDF and Image files are supported.")

        file_content = await file.read()
        extracted_text = ""

        # 2. HYBRID PDF PROCESSING
        if file.content_type == "application/pdf":
            # Attempt A: Digital Text Extraction (Fast)
            with pdfplumber.open(io.BytesIO(file_content)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text()
                    if text:
                        extracted_text += text + "\n"
            
            # Attempt B: OCR Fallback (If the PDF was just a scanned image)
            if len(extracted_text.strip()) < 50:
                print("No digital text found. Activating OCR Fallback...")
                images = convert_from_bytes(file_content)
                for image in images:
                    extracted_text += pytesseract.image_to_string(image) + "\n"

        # 3. DIRECT IMAGE PROCESSING
        elif file.content_type.startswith("image/"):
            print("Processing direct image upload with OCR...")
            image = Image.open(io.BytesIO(file_content))
            extracted_text = pytesseract.image_to_string(image)

        # 4. Clean and Truncate Text
        if not extracted_text.strip():
             raise HTTPException(status_code=400, detail="Could not extract any text from the document. Please ensure it is legible.")
             
        truncated_text = extracted_text[:3000]

        # 5. Route to AI[cite: 1]
        document_prompt = f"I am uploading a legal document. Here is the text: \n\n{truncated_text}\n\nPlease analyze this document and categorize my legal issue."
        classification = classify_legal_issue(document_prompt)
        category = classification.get("category", "General")
        reasoning = classification.get("reasoning", "Analyzed via document upload.")

        # 6. NEW: Query the database for exact required documents
        db_docs = db.query(RequiredDocument).filter(RequiredDocument.category == category).all()
        required_docs = [doc.document_name for doc in db_docs]
        
        # Fallback to "General" if the AI returns a category not in our DB
        if len(required_docs) == 0:
            db_docs = db.query(RequiredDocument).filter(RequiredDocument.category == "General").all()
            required_docs = [doc.document_name for doc in db_docs]

        # 7. Fetch the cheapest lawyers based on the document's category[cite: 1]
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

        # 8. Return the combined payload (now including required_documents!)
        return {
            "detected_category": category,
            "reasoning": f"Based on the uploaded document '{file.filename}', {reasoning}",
            "required_documents": required_docs,
            "recommended_lawyers": lawyer_list
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")
    


    

@app.get("/api/appointments")
async def get_user_appointments(email: str):
    try:
        service = get_calendar_service()
        if not service:
            raise HTTPException(status_code=500, detail="Google Calendar service is unavailable.")
        
        calendar_id = '963fdeecafdfdf5078c33ae67966fec8d4264ffa7069698c1cd9fa30ea381b35@group.calendar.google.com'
        
        # Define current time in IST to only fetch upcoming appointments
        IST = timezone(timedelta(hours=5, minutes=30))
        now = datetime.now(IST).isoformat()
        
        # Query Google Calendar. The 'q' parameter searches summaries and descriptions!
        events_result = service.events().list(
            calendarId=calendar_id, 
            timeMin=now,
            q=email, 
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])
        appointments = []
        
        for event in events:
            # Double-check that the email is actually in the description to prevent false matches
            if email.lower() in event.get('description', '').lower():
                
                # Parse the start time back into a readable format
                start_str = event['start'].get('dateTime', event['start'].get('date'))
                start_dt = datetime.fromisoformat(start_str)
                
                appointments.append({
                    "id": event['id'],
                    "lawyer_name": event['summary'].replace("LegalConnect Consultation: ", ""),
                    "date": start_dt.strftime("%b %d, %Y"),
                    "time": start_dt.strftime("%I:%M %p").lstrip("0"),
                    "meet_link": event.get('location', "Link pending")
                })
                
        return {"appointments": appointments}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/verify-document")
async def verify_document(
    file: UploadFile = File(...),
    expected_type: str = Form(...)
):
    try:
        # 1. Read the file into memory
        file_bytes = await file.read()
        
        # 2. Construct a strict, localized prompt for the AI
        # This explicitly forbids the AI from generating lawyer recommendations
        prompt = (
            f"You are a strict legal document classifier. "
            f"The user uploaded a document that must be a '{expected_type}'. "
            f"Analyze the document. If it belongs to this category, respond with exactly the word 'TRUE'. "
            f"If it does not match, respond with exactly the word 'FALSE'."
        )
        
        # 3. Call your AI model (Assuming you are using a vision model like Gemini or GPT-4o)
        # response = your_ai_model.generate_content([prompt, file_bytes])
        # ai_decision = response.text.strip().upper()
        
        # Mocking the AI decision logic for demonstration
        ai_decision = "TRUE" # Replace with actual AI output
        
        # 4. Process the logical condition
        if "TRUE" in ai_decision:
            return {"verified": True, "document": expected_type}
        else:
            return {"verified": False, "document": expected_type}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




@app.delete("/api/appointments/{event_id}")
async def cancel_appointment(event_id: str):
    try:
        service = get_calendar_service()
        if not service:
            raise HTTPException(status_code=500, detail="Google Calendar service is unavailable.")
        
        calendar_id = '963fdeecafdfdf5078c33ae67966fec8d4264ffa7069698c1cd9fa30ea381b35@group.calendar.google.com'
        
        # Tell Google Calendar to delete this specific event
        service.events().delete(
            calendarId=calendar_id, 
            eventId=event_id
        ).execute()
        
        return {"status": "success", "message": "Appointment cancelled successfully."}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate-token")
async def generate_token_pdf(request: TokenRequest):
    try:
        # 1. Generate the QR Code Image in memory
        qr_data = (
            f"Token: {request.token_id}\n"
            f"Client: {request.client_email}\n"
            f"Specialist: {request.lawyer_name}\n"
            f"Schedule: {request.date} @ {request.time}"
        )
        qr = qrcode.make(qr_data)
        qr_io = io.BytesIO()
        qr.save(qr_io, format="PNG")
        qr_io.seek(0)
        qr_image = ImageReader(qr_io)

        # 2. Draw the PDF Pass in memory
        pdf_io = io.BytesIO()
        c = canvas.Canvas(pdf_io, pagesize=letter)
        
        # Draw Ticket Border & Header
        c.rect(50, 500, 500, 250) # x, y, width, height
        c.setFont("Helvetica-Bold", 24)
        c.drawString(70, 710, "IN-PERSON CONSULTATION PASS")
        
        # Draw Client & Meeting Details
        c.setFont("Helvetica", 12)
        c.drawString(70, 670, f"Token ID: {request.token_id}")
        c.drawString(70, 650, f"Client Name: {request.client_name}")
        c.drawString(70, 630, f"Client Email: {request.client_email}")
        c.drawString(70, 610, f"Specialist: {request.lawyer_name}")
        c.drawString(70, 590, f"Date: {request.date}")
        c.drawString(70, 570, f"Time: {request.time}")
        
        # Footer text
        c.setFont("Helvetica-Oblique", 10)
        c.drawString(70, 530, "Please present this pass at reception upon arrival for fast-track entry.")

        # Embed the QR Code on the right side of the pass
        c.drawImage(qr_image, 400, 550, width=120, height=120)
        
        c.save()
        pdf_io.seek(0)

        # 3. Return the raw PDF file directly to React
        return Response(content=pdf_io.getvalue(), media_type="application/pdf")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))