import os
import json
from groq import Groq
from dotenv import load_dotenv

# Load the API key from the .env file
load_dotenv()
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# The System Prompt sets the rules and provides the JSON schema
SYSTEM_PROMPT = """
You are the intake routing engine for a premium legal technology platform. 
Your sole task is to analyze a user's legal problem stated in plain, casual language and categorize it correctly.

Available categories:
- Property & Real Estate Law
- Civil Litigation
- Labor & Employment Law
- Corporate & Business Law
- Family Law

You must respond STRICTLY in valid JSON format matching this exact structure:
{
  "category": "String (Must be one of the available categories)",
  "confidence_score": 0.0 (Float between 0 and 1),
  "reasoning": "String (Brief explanation of why this category fits)"
}

Example:
Input: "My boss fired me for taking medical leave."
Output: {"category": "Labor & Employment Law", "confidence_score": 0.98, "reasoning": "Wrongful termination falls under employment law."}
"""

def classify_legal_issue(user_input: str) -> dict:
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_input}
            ],
            temperature=0.0, # 0.0 forces the model to be deterministic
            response_format={"type": "json_object"} # Forces JSON output
        )
        
        raw_response = completion.choices[0].message.content
        
        # THE FIX: Safely check that the response is not None before parsing
        if raw_response is not None:
            return json.loads(raw_response)
        else:
            # Fallback if the API returns an empty body
            print("Warning: The API returned an empty response.")
            return {"category": "Unknown", "confidence_score": 0.0, "reasoning": "API returned None"}
            
    except json.JSONDecodeError:
        # Fallback if the AI messes up the JSON formatting
        print("Error: The model did not return valid JSON.")
        return {"category": "Unknown", "confidence_score": 0.0, "reasoning": "JSON parse error"}
        
    except Exception as e:
        # Fallback for network issues, invalid API keys, etc.
        print(f"An API or network error occurred: {e}")
        return {"category": "Error", "confidence_score": 0.0, "reasoning": str(e)}

if __name__ == "__main__":
    # Simulate a user typing into your chatbot
    user_query = "My wife is divorcing me"
    
    # Run the classification
    result = classify_legal_issue(user_query)
    
    # Your backend now has clean, mapped data to work with safely
    print("Detected Category:", result.get("category"))
    print("Confidence:", result.get("confidence_score"))
    print("AI Reasoning:", result.get("reasoning"))