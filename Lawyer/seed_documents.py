# seed_documents.py
from database import SessionLocal, engine
from models import RequiredDocument, Base

# Create the table if it doesn't exist
Base.metadata.create_all(bind=engine)

def seed_documents():
    db = SessionLocal()
    
    # Check if we already seeded to prevent duplicates
    if db.query(RequiredDocument).first():
        print("Documents already seeded!")
        return

    # Master list of all case types and their required documents
    case_types = {
        "Family Law": [
            "Government Issued ID",
            "Marriage Certificate (if applicable)",
            "Financial Affidavits / Bank Statements",
            "Previous Custody or Divorce Agreements"
        ],
        "Real Estate": [
            "Government Issued ID",
            "Property Deed or Title",
            "Purchase Agreement or Lease Contract",
            "Recent Property Tax Statements"
        ],
        "Criminal Defense": [
            "Government Issued ID",
            "Police Report / Arrest Records",
            "Bail or Bond Documents",
            "Subpoenas or Court Summons"
        ],
        "Corporate Law": [
            "Articles of Incorporation / Organization",
            "Operating Agreement or Bylaws",
            "Shareholder or Partnership Agreements",
            "Relevant Business Contracts"
        ],
        "Immigration": [
            "Valid Passport",
            "Current Visa or Work Permit",
            "Birth Certificate",
            "Employment History / Sponsorship Letters"
        ],
        "Personal Injury": [
            "Government Issued ID",
            "Medical Records and Bills",
            "Police or Incident Report",
            "Insurance Policy and Claims Correspondence"
        ],
        "Estate Planning": [
            "Government Issued ID",
            "Current Will or Trust (if any)",
            "List of Assets and Debts",
            "Life Insurance Policies"
        ],
        "Employment Law": [
            "Government Issued ID",
            "Employment Contract or Offer Letter",
            "Recent Pay Stubs",
            "Emails or Communications with HR"
        ],
        "General": [
            "Government Issued ID",
            "Any contracts related to your issue",
            "Relevant email correspondence",
            "Photos or evidence (if applicable)"
        ]
    }

    print("Seeding database...")
    for category, documents in case_types.items():
        for doc in documents:
            new_doc = RequiredDocument(category=category, document_name=doc)
            db.add(new_doc)
    
    db.commit()
    db.close()
    print("Database successfully seeded with all document types!")

if __name__ == "__main__":
    seed_documents()