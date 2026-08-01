from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os
import urllib.parse

load_dotenv()

user= os.getenv("DB_USER")
password = os.getenv("DB_PASSWORD","")
host = os.getenv("DB_HOST")
port = os.getenv("DB_PORT")
db_name = os.getenv("DB_NAME")

encoded_password = urllib.parse.quote_plus(password)

SQLALCHEMY_DATABASE_URL=f"postgresql://{user}:{encoded_password}@{host}:{port}/{db_name}"

engine=create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal= sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base= declarative_base()

# THis ist the get_db funciton to be sent to main.py

def get_db():
    db=SessionLocal()
    try:
        yield db
    finally:
        db.close()