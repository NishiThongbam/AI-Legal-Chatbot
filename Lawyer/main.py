import os
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import FastAPI, HTTPException 
from fastapi import File, UploadFile, HTTPException, Depends
import pdfplumber
import io
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv

# Import your Groq classification logic
from legal_router import classify_legal_issue 



from fastapi.middleware.cors import CORSMiddleware



load_dotenv()
app = FastAPI(title="Legal Intake Backend (PostgreSQL)")

# ... (below your app = FastAPI(...) line)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # Allows your Next.js frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    user_message: str

class LawyerMatch(BaseModel):
    lawyer_name: str
    contact_email: str
    rating: float

class ChatResponse(BaseModel):
    detected_category: str
    confidence: float
    reasoning: str
    recommended_lawyers: List[LawyerMatch]

# Helper function to query PostgreSQL safely
def get_lawyers_by_specialty(specialty_name: str) -> List[dict]:
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )
    
    # RealDictCursor formats database rows directly into Python dictionaries
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # Executing the query with PostgreSQL '%s' syntax
    cursor.execute(
        "SELECT name, email, rating FROM lawyers WHERE specialization = %s", 
        (specialty_name,)
    )
    
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return [dict(row) for row in rows]




@app.post("/api/upload")
async def upload_document(file: UploadFile = File(...)): # Add db: Session = Depends(get_db) if using database
    try:
        # 1. Verify it's a PDF
        if file.content_type != "application/pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are supported.")

        # 2. Read the file into memory
        file_content = await file.read()
        
        # 3. Extract text using pdfplumber
        extracted_text = ""
        with pdfplumber.open(io.BytesIO(file_content)) as pdf:
            for page in pdf.pages:
                extracted_text += page.extract_text() + "\n"

        # 4. Truncate text if it's too long (to save AI tokens)
        truncated_text = extracted_text[:3000]

        # 5. Create a prompt for the AI based on the document text
        document_prompt = f"I am uploading a legal document. Here is the text: \n\n{truncated_text}\n\nPlease analyze this document and categorize my legal issue."

        # 6. Re-use your existing classification logic!
        # (Make sure to import classify_legal_issue from your router file)
        from legal_router import classify_legal_issue 
        classification = classify_legal_issue(document_prompt)
        category = classification.get("category", "General")
        reasoning = classification.get("reasoning", "Analyzed via document upload.")

        # 7. Fetch matching lawyers (Update this with your actual DB fetching logic)
        # lawyers = db.query(Lawyer).filter(Lawyer.specialty == category).all()
        # lawyer_list = [{"lawyer_name": l.name, "contact_email": l.email, "rating": l.rating} for l in lawyers]
        
        # Temporary dummy response until your DB is fully hooked up to this route:
        lawyer_list = [
            {"lawyer_name": "Jane Doe", "contact_email": "jane@example.com", "rating": 4.9}
        ]

        return {
            "detected_category": category,
            "reasoning": f"Based on the uploaded document '{file.filename}', {reasoning}",
            "recommended_lawyers": lawyer_list
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")




@app.post("/api/intake", response_model=ChatResponse)
async def process_user_intake(request: ChatRequest):
    try:
        # Step A: Classify intent using Llama 3 on Groq
        ai_result = classify_legal_issue(request.user_message)
        category = ai_result.get("category", "Unknown")
        
        # Step B: Fetch matching rows out of your local PostgreSQL instance
        db_lawyers = get_lawyers_by_specialty(category)
        
        # Step C: Package the database records for the frontend
        matched_lawyers = [
            LawyerMatch(
                lawyer_name=lawyer["name"], 
                contact_email=lawyer["email"],
                # Convert decimal values from database to standard floats
                rating=float(lawyer["rating"]) 
            )
            for lawyer in db_lawyers
        ]
                
        return ChatResponse(
            detected_category=category,
            confidence=ai_result.get("confidence_score", 0.0),
            reasoning=ai_result.get("reasoning", ""),
            recommended_lawyers=matched_lawyers
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database or AI error: {str(e)}")