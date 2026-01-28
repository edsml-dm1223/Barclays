"""
Chatbot Analytics Backend
Conversational AI with true context - remembers previous results and builds on them
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
import gc

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
df_original = None

# Session storage with results
sessions = {}
SESSION_TIMEOUT = timedelta(hours=2)


@app.on_event("startup")
async def load_data():
    global df_original
    full_df = pd.read_parquet(DATA_PATH)
    # Sample 200K rows to fit in 512MB memory limit
    df_original = full_df.sample(n=200000, random_state=42)
    del full_df
    gc.collect()
    print(f"Loaded {len(df_original):,} transactions (sampled)")


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    table: list | None = None
    session_id: str


# Data schema for Claude
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

IMPORTANT:
- ~200,000 transactions (sampled from 838K)
- credit_debit values are LOWERCASE
- All amounts are positive numbers
"""


ROUTING_PROMPT = """You are analyzing a user's question about transaction data.

Previous conversation:
{history}

Current data state (first 5 rows of working dataset with {row_count} total rows):
{data_preview}

User's new question: {question}

Is this a REFINEMENT of the previous result (e.g., "filter this", "remove X", "show only Y", "take off Z")
or a completely NEW question (e.g., "what about categories", "show me something different")?

Respond with ONLY one word: REFINE or NEW"""


CODE_PROMPT = """You are a data analyst. Write Python pandas code to answer the user's question.

{schema}

CURRENT DATA STATE:
The DataFrame 'df' currently has {row_count} rows.
Preview (first 10 rows):
{data_preview}

Previous conversation for context:
{history}

User's question: {question}

Rules:
- DataFrame is loaded as 'df' - work with it directly
- Store final result in variable 'result'
- Keep code simple and robust
- Use lowercase for string comparisons (e.g., "credit" not "Credit")
- Limit results to top 20 with .head(20)
- For filtering, use str.contains() for partial matches or isin() for exact matches

Write ONLY Python code, no explanations:"""


RESPONSE_PROMPT = """You are a friendly data analyst assistant.

User asked: {question}

Here is the ACTUAL data result (you MUST base your response on these exact numbers):
{result_preview}

Previous conversation context:
{history}

Write a conversational response that:
1. Directly describes what the data shows using the EXACT numbers from the result
2. Is concise (2-3 sentences)
3. References the context if it's a follow-up question

CRITICAL: Your response MUST match the actual data shown above. Do not make up or assume numbers."""


def get_or_create_session(session_id: Optional[str]) -> dict:
    """Get existing session or create new one."""
    global df_original
    now = datetime.now()

    # Clean old sessions
    expired = [sid for sid, data in sessions.items()
               if now - data['last_access'] > SESSION_TIMEOUT]
    for sid in expired:
        del sessions[sid]

    if expired:
        gc.collect()

    # Get or create session
    if session_id and session_id in sessions:
        sessions[session_id]['last_access'] = now
        return sessions[session_id]

    # Create new session
    new_id = str(uuid.uuid4())[:8]
    sessions[new_id] = {
        'id': new_id,
        'history': [],
        'last_access': now,
        'current_df': df_original.copy(),  # Start with full data
        'last_code': None
    }
    return sessions[new_id]


def add_to_history(session: dict, role: str, content: str):
    """Add a message to session history."""
    session['history'].append({'role': role, 'content': content})
    # Keep last 6 exchanges
    if len(session['history']) > 12:
        session['history'] = session['history'][-12:]


def get_history_text(history: list) -> str:
    """Format history for prompts."""
    if not history:
        return "No previous conversation."

    text = ""
    for msg in history[-6:]:
        role = "User" if msg['role'] == 'user' else "Assistant"
        content = msg['content'][:300] + "..." if len(msg['content']) > 300 else msg['content']
        text += f"{role}: {content}\n"
    return text


def get_data_preview(df: pd.DataFrame, rows: int = 10) -> str:
    """Get a string preview of the dataframe."""
    return df.head(rows).to_string()


def execute_code(code: str, dataframe: pd.DataFrame) -> tuple:
    """Execute pandas code and return result."""
    namespace = {
        'pd': pd,
        'df': dataframe,
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


def format_result_preview(result) -> str:
    """Format result for Claude to see exact data."""
    if isinstance(result, pd.DataFrame):
        return f"DataFrame ({len(result)} rows):\n{result.to_string()}"
    elif isinstance(result, pd.Series):
        return f"Series:\n{result.to_string()}"
    elif result is not None:
        return str(result)
    return "No result"


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    global df_original

    if df_original is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key)
    session = get_or_create_session(request.session_id)

    add_to_history(session, 'user', request.message)
    history_text = get_history_text(session['history'][:-1])

    # Step 1: Determine if this is a refinement or new question
    is_refinement = False
    if session['last_code'] and len(session['history']) > 1:
        try:
            routing_response = client.messages.create(
                model="claude-opus-4-5-20251101",
                max_tokens=10,
                messages=[{
                    "role": "user",
                    "content": ROUTING_PROMPT.format(
                        history=history_text,
                        data_preview=get_data_preview(session['current_df'], 5),
                        row_count=len(session['current_df']),
                        question=request.message
                    )
                }]
            )
            decision = routing_response.content[0].text.strip().upper()
            is_refinement = "REFINE" in decision
        except:
            is_refinement = False

    # Choose which dataframe to work with
    if is_refinement:
        working_df = session['current_df']
    else:
        working_df = df_original.copy()
        session['current_df'] = working_df

    # Step 2: Generate code with retry
    max_retries = 2
    result = None
    error = None
    code = None

    for attempt in range(max_retries + 1):
        try:
            if attempt == 0:
                prompt = CODE_PROMPT.format(
                    schema=DATA_SCHEMA,
                    row_count=len(working_df),
                    data_preview=get_data_preview(working_df),
                    history=history_text,
                    question=request.message
                )
            else:
                prompt = f"""{CODE_PROMPT.format(
                    schema=DATA_SCHEMA,
                    row_count=len(working_df),
                    data_preview=get_data_preview(working_df),
                    history=history_text,
                    question=request.message
                )}

Your previous code failed with: {error}
Fix it and try again:"""

            code_response = client.messages.create(
                model="claude-opus-4-5-20251101",
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}]
            )
            code = code_response.content[0].text.strip()

            # Clean markdown
            if code.startswith("```python"):
                code = code[9:]
            if code.startswith("```"):
                code = code[3:]
            if code.endswith("```"):
                code = code[:-3]
            code = code.strip()

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API error: {str(e)}")

        result, output, error = execute_code(code, working_df)

        if error is None:
            session['last_code'] = code
            # If result is a DataFrame, update session's current_df for future refinements
            if isinstance(result, pd.DataFrame):
                session['current_df'] = result.copy()
            break

    # Step 3: Generate response based on ACTUAL results
    result_preview = format_result_preview(result) if error is None else f"Error: {error}"

    try:
        response_msg = client.messages.create(
            model="claude-opus-4-5-20251101",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": RESPONSE_PROMPT.format(
                    question=request.message,
                    result_preview=result_preview,
                    history=history_text
                )
            }]
        )
        conversational_response = response_msg.content[0].text.strip()
    except Exception as e:
        conversational_response = f"Here's what I found: {result_preview}"

    add_to_history(session, 'assistant', conversational_response)

    # Format table
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
        session_id=session['id']
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "rows": len(df_original) if df_original is not None else 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
