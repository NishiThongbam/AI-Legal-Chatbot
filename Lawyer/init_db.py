import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def initialize_database():
    # Connect to the PostgreSQL server
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD")
    )
    cursor = conn.cursor()

    # 1. Create table (PostgreSQL uses SERIAL for autoincrement)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS lawyers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            specialization VARCHAR(255) NOT NULL,
            rating NUMERIC(3, 2)
        )
    """)

    # 2. Clear old data
    cursor.execute("TRUNCATE TABLE lawyers RESTART IDENTITY")

    # 3. Seed data
    lawyers_data = [
        ("Sarah Jenkins", "sarah@legal.com", "Property & Real Estate Law", 4.9),
        ("David Chen", "dchen@legal.com", "Property & Real Estate Law", 4.7),
        ("Marcus Rossi", "rossi@legal.com", "Labor & Employment Law", 4.8),
        ("Elena Smith", "elena@legal.com", "Family Law", 4.9),
        ("Arthur Pendelton", "arthur@legal.com", "Civil Litigation", 4.5)
    ]

    # NOTE: PostgreSQL uses %s placeholders instead of SQLite's ?
    cursor.executemany("""
        INSERT INTO lawyers (name, email, specialization, rating) 
        VALUES (%s, %s, %s, %s)
    """, lawyers_data)

    conn.commit()
    cursor.close()
    conn.close()
    print("PostgreSQL Database initialized and seeded successfully!")

if __name__ == "__main__":
    initialize_database()