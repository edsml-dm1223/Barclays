"""
Chatbot Analytics Backend
Conversational AI for transaction data analysis with context and retry logic
"""

import os
import sys
import json
import uuid
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic
from io import StringIO
from datetime import datetime, timedelta
from typing import Optional

app = FastAPI(title="Chatbot Analytics API")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load data once at startup
DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "columns_selected.parquet")
df = None

# Session storage (in-memory - resets on restart)
sessions = {}
SESSION_TIMEOUT = timedelta(hours=2)


@app.on_event("startup")
async def load_data():
    global df
    df = pd.read_parquet(DATA_PATH)
    print(f"Loaded {len(df):,} transactions")


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    table: list | None = None
    session_id: str


# Data schema for Claude context
DATA_SCHEMA = """
The DataFrame 'df' contains transaction data with these columns:
- primary_merchant: string - merchant name (e.g., "AMAZON_MARKETPLACE", "TESCO_GENERAL")
- transaction_classification_0: string - category (e.g., "Shopping", "Groceries", "Financial Services")
- transaction_classification_1: string - subcategory
- customer_id: string - unique customer identifier
- account_id: string - account identifier
- date: string - transaction date
- amount: float - transaction amount (always positive)
- credit_debit: string - EXACTLY "credit" or "debit" (lowercase!)
- timestamp: datetime - full timestamp with time
- avg_amount_by_classification: float - average amount for this classification
- total_txn_by_classification: int - total transactions in this classification

IMPORTANT DATA FACTS:
- Total rows: 838,755 transactions
- credit_debit values are LOWERCASE: "credit" (106,376 rows) and "debit" (732,379 rows)
- All amounts are positive numbers
"""


CODE_SYSTEM_PROMPT = f"""You are a data analyst. Write Python pandas code to answer the user's question.

{DATA_SCHEMA}

Rules:
- The DataFrame is already loaded as 'df'
- Store your final result in a variable called 'result'
- Keep code simple and robust
- For time-based queries, df['timestamp'] is datetime with timezone
- For time extraction: df['timestamp'].dt.time
- For day of week: df['timestamp'].dt.day_name()
- Always limit large results to top 20 rows using .head(20)
- Use .copy() when modifying data
- String comparisons are case-sensitive! Use exact values from the schema.

Respond with ONLY valid Python code, no explanations or markdown."""


RESPONSE_SYSTEM_PROMPT = """You are a friendly data analyst assistant having a conversation with a user about their transaction data.

Based on the analysis results, write a natural conversational response that:
1. Directly answers their question in plain English
2. Highlights key insights from the data
3. Is concise but informative (2-4 sentences)
4. References previous context when relevant

Do NOT mention code, DataFrames, pandas, or technical details. Just have a natural conversation."""


def get_or_create_session(session_id: Optional[str]) -> tuple[str, list]:
    """Get existing session or create new one."""
    now = datetime.now()

    # Clean old sessions
    expired = [sid for sid, data in sessions.items()
               if now - data['last_access'] > SESSION_TIMEOUT]
    for sid in expired:
        del sessions[sid]

    # Get or create session
    if session_id and session_id in sessions:
        sessions[session_id]['last_access'] = now
        return session_id, sessions[session_id]['history']

    # Create new session
    new_id = str(uuid.uuid4())[:8]
    sessions[new_id] = {
        'history': [],
        'last_access': now
    }
    return new_id, sessions[new_id]['history']


def add_to_history(session_id: str, role: str, content: str):
    """Add a message to session history."""
    if session_id in sessions:
        sessions[session_id]['history'].append({
            'role': role,
            'content': content
        })
        # Keep only last 10 exchanges (20 messages) to manage context size
        if len(sessions[session_id]['history']) > 20:
            sessions[session_id]['history'] = sessions[session_id]['history'][-20:]


def execute_code(code: str, dataframe: pd.DataFrame) -> tuple:
    """Safely execute pandas code and return result."""
    namespace = {
        'pd': pd,
        'df': dataframe.copy(),
    }

    old_stdout = sys.stdout
    sys.stdout = StringIO()

    try:
        exec(code, namespace)
        output = sys.stdout.getvalue()
        result = namespace.get('result', None)
        return result, output, None
    except Exception as e:
        return None, None, str(e)
    finally:
        sys.stdout = old_stdout


def format_result_for_claude(result, output) -> str:
    """Format the execution result for Claude to interpret."""
    if isinstance(result, pd.DataFrame):
        return f"DataFrame with {len(result)} rows:\n{result.head(20).to_string()}"
    elif isinstance(result, pd.Series):
        return f"Series:\n{result.head(20).to_string()}"
    elif result is not None:
        return str(result)
    elif output:
        return output
    return "No result"


def build_conversation_context(history: list) -> str:
    """Build a summary of conversation history for context."""
    if not history:
        return ""

    context = "Previous conversation:\n"
    for msg in history[-6:]:  # Last 3 exchanges
        role = "User" if msg['role'] == 'user' else "Assistant"
        # Truncate long messages
        content = msg['content'][:200] + "..." if len(msg['content']) > 200 else msg['content']
        context += f"{role}: {content}\n"
    return context + "\n"


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    global df

    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key)

    # Get or create session
    session_id, history = get_or_create_session(request.session_id)

    # Add user message to history
    add_to_history(session_id, 'user', request.message)

    # Build context from history
    context = build_conversation_context(history[:-1])  # Exclude current message

    # Step 1: Generate code (with retry logic)
    max_retries = 2
    code = None
    result = None
    error = None

    for attempt in range(max_retries + 1):
        try:
            # Build the prompt with context
            if attempt == 0:
                user_prompt = f"{context}Current question: {request.message}"
            else:
                user_prompt = f"""{context}Current question: {request.message}

Your previous code failed with this error: {error}

Please fix the code. Common issues:
- String values are case-sensitive (use "credit" not "Credit")
- Make sure column names exist
- Use .head(20) to limit results

Write corrected code:"""

            code_response = client.messages.create(
                model="claude-opus-4-5-20251101",
                max_tokens=1024,
                system=CODE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}]
            )
            code = code_response.content[0].text.strip()

            # Clean markdown if present
            if code.startswith("```python"):
                code = code[9:]
            if code.startswith("```"):
                code = code[3:]
            if code.endswith("```"):
                code = code[:-3]
            code = code.strip()

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API error: {str(e)}")

        # Execute the code
        result, output, error = execute_code(code, df)

        if error is None:
            break  # Success!

        if attempt < max_retries:
            print(f"Attempt {attempt + 1} failed: {error}. Retrying...")

    # Step 2: Generate conversational response
    if error:
        result_text = f"After multiple attempts, the analysis encountered an error: {error}"
    else:
        result_text = format_result_for_claude(result, output)

    try:
        response_prompt = f"""{context}User's question: {request.message}

Analysis result:
{result_text}

Write a conversational response:"""

        response_message = client.messages.create(
            model="claude-opus-4-5-20251101",
            max_tokens=500,
            system=RESPONSE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": response_prompt}]
        )
        conversational_response = response_message.content[0].text.strip()
    except Exception as e:
        conversational_response = f"Here's what I found: {result_text}"

    # Add assistant response to history
    add_to_history(session_id, 'assistant', conversational_response)

    # Step 3: Format table data if available
    table_data = None
    if error is None:
        if isinstance(result, pd.DataFrame) and not result.empty:
            table_data = result.head(30).to_dict(orient='records')
        elif isinstance(result, pd.Series):
            result_df = result.reset_index()
            result_df.columns = ['Category', 'Value'] if len(result_df.columns) == 2 else result_df.columns
            table_data = result_df.head(30).to_dict(orient='records')

    return ChatResponse(
        response=conversational_response,
        table=table_data,
        session_id=session_id
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "rows": len(df) if df is not None else 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
