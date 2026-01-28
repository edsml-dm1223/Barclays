"""
Chatbot Analytics Backend
Conversational AI for transaction data analysis
"""

import os
import sys
import json
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic
from io import StringIO

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

@app.on_event("startup")
async def load_data():
    global df
    df = pd.read_parquet(DATA_PATH)
    print(f"Loaded {len(df):,} transactions")


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str
    table: list | None = None


# Data schema for Claude context
DATA_SCHEMA = """
The DataFrame 'df' contains transaction data with these columns:
- primary_merchant: string - merchant name (e.g., "AMAZON_MARKETPLACE", "TESCO_GENERAL")
- transaction_classification_0: string - category (e.g., "Shopping", "Groceries", "Financial Services")
- transaction_classification_1: string - subcategory
- customer_id: string - unique customer identifier
- account_id: string - account identifier
- date: string - transaction date
- amount: float - transaction amount
- credit_debit: string - "credit" or "debit"
- timestamp: datetime - full timestamp with time
- avg_amount_by_classification: float - average amount for this classification
- total_txn_by_classification: int - total transactions in this classification

Total rows: ~838,755 transactions
"""


CODE_PROMPT = f"""You are a data analyst. Write Python pandas code to answer the user's question.

{DATA_SCHEMA}

Rules:
- The DataFrame is already loaded as 'df'
- Store your final result in a variable called 'result'
- Keep code simple and robust
- For time-based queries, df['timestamp'] is datetime with timezone
- For time extraction: df['timestamp'].dt.time
- For day of week: df['timestamp'].dt.day_name()
- Always limit large results to top 20 rows
- Use .copy() when modifying data

Respond with ONLY valid Python code, no explanations or markdown."""


RESPONSE_PROMPT = """You are a friendly data analyst assistant. The user asked a question about transaction data, and I've already analyzed it for you.

Based on the analysis results below, write a conversational response that:
1. Directly answers their question in plain English
2. Highlights key insights from the data
3. Is concise but informative (2-4 sentences)
4. If there's tabular data, briefly describe what it shows

Do NOT mention code, DataFrames, pandas, or technical implementation details. Just have a natural conversation about the data insights.

User's question: {question}

Analysis result:
{result}

Write your conversational response:"""


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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    global df

    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key)

    # Step 1: Generate code
    try:
        code_response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=CODE_PROMPT,
            messages=[{"role": "user", "content": request.message}]
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

    # Step 2: Execute code
    result, output, error = execute_code(code, df)

    # Step 3: Generate conversational response
    if error:
        # If code failed, ask Claude to respond gracefully
        result_text = f"The analysis encountered an error: {error}"
    else:
        result_text = format_result_for_claude(result, output)

    try:
        response_message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[{
                "role": "user",
                "content": RESPONSE_PROMPT.format(
                    question=request.message,
                    result=result_text
                )
            }]
        )
        conversational_response = response_message.content[0].text.strip()
    except Exception as e:
        # Fallback if second call fails
        conversational_response = f"Here's what I found: {result_text}"

    # Step 4: Format table data if available
    table_data = None
    if isinstance(result, pd.DataFrame) and not result.empty:
        table_data = result.head(30).to_dict(orient='records')
    elif isinstance(result, pd.Series):
        result_df = result.reset_index()
        result_df.columns = ['Category', 'Value'] if len(result_df.columns) == 2 else result_df.columns
        table_data = result_df.head(30).to_dict(orient='records')

    return ChatResponse(
        response=conversational_response,
        table=table_data
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "rows": len(df) if df is not None else 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
