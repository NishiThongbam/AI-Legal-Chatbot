from sqlalchemy import Column, Integer, String, Float
from database import Base, engine

class Lawyer(Base):
    __tablename__ = "lawyers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    specialization = Column(String(100), nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    rating = Column(Float)
    hourly_rate=Column(Integer)


class RequiredDocument(Base):
    __tablename__ = "required_documents"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, index=True)      # e.g., 'Family Law'
    document_name = Column(String)             # e.g., 'Marriage Certificate'


# This single line tells Python to connect to Postgres and create the table
Base.metadata.create_all(bind=engine)