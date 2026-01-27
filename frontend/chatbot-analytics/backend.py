"""
Chatbot Analytics Backend
Allows natural language queries against transaction data using Claude API
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
    code: str | None = None


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


SYSTEM_PROMPT = f"""You are a data analyst assistant. You help users query transaction data using pandas.

{DATA_SCHEMA}

When the user asks a question:
1. Write Python pandas code to answer it
2. The DataFrame is already loaded as 'df'
3. Store your final result in a variable called 'result'
4. If creating a table, make 'result' a DataFrame
5. If it's a single value, store it in 'result'
6. Keep code simple and efficient
7. For time-based queries, df['timestamp'] is datetime with timezone

IMPORTANT:
- Only use pandas operations, no file I/O
- Don't modify the original df, use .copy() if needed
- For time extraction: df['timestamp'].dt.time
- For day of week: df['timestamp'].dt.day_name()
- Always limit large results to top 20-30 rows

Respond with ONLY valid Python code, no explanations or markdown. The code will be executed directly."""


def execute_code(code: str, dataframe: pd.DataFrame) -> tuple:
    """Safely execute pandas code and return result."""
    # Create a restricted namespace
    namespace = {
        'pd': pd,
        'df': dataframe.copy(),
    }

    # Capture stdout
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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    global df

    if df is None:
        raise HTTPException(status_code=500, detail="Data not loaded")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY not set")

    client = Anthropic(api_key=api_key)

    # Get code from Claude
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": request.message}
            ]
        )
        code = message.content[0].text.strip()

        # Remove markdown code blocks if present
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

    if error:
        return ChatResponse(
            response=f"Error executing query: {error}",
            code=code
        )

    # Format response
    if isinstance(result, pd.DataFrame):
        # Convert DataFrame to list of dicts for JSON
        table_data = result.head(50).to_dict(orient='records')
        return ChatResponse(
            response=f"Found {len(result)} results. Showing top {min(50, len(result))}:",
            table=table_data,
            code=code
        )
    elif isinstance(result, pd.Series):
        # Convert Series to DataFrame
        result_df = result.reset_index()
        result_df.columns = ['Category', 'Value']
        table_data = result_df.head(50).to_dict(orient='records')
        return ChatResponse(
            response=f"Results:",
            table=table_data,
            code=code
        )
    elif result is not None:
        return ChatResponse(
            response=str(result),
            code=code
        )
    elif output:
        return ChatResponse(
            response=output,
            code=code
        )
    else:
        return ChatResponse(
            response="Query executed but no result returned.",
            code=code
        )


@app.get("/api/health")
async def health():
    return {"status": "ok", "rows": len(df) if df is not None else 0}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
