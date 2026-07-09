from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
import pdfplumber
import io
import traceback

# Import your local database and AI tools
from database import get_db
from models import Lawyer
from legal_router import classify_legal_issue

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

class ScheduleRequest(BaseModel):
    lawyer_name: str
    user_email: str
    date: str
    time: str

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

@app.post("/api/schedule")
async def schedule_consultation(request: ScheduleRequest):
    # In a real app, you would save this to a 'appointments' table in the DB
    # or send a calendar invite via email here.
    return {"status": "success", "message": f"Appointment booked with {request.lawyer_name} on {request.date} at {request.time}"}