# Chatbot Analytics

A natural language interface for querying transaction data using Claude API.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set your Anthropic API key:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

3. Run the backend:
```bash
python backend.py
```

The server will start on `http://localhost:8000`

## Usage

The chatbot is integrated into the frontend under the "Analytics Chat" tab.

### Example queries:
- "How many transactions are after 8:30pm?"
- "Top 10 merchants by transaction count"
- "Breakdown of transactions by day of week"
- "Average amount by classification"
- "Show transactions over $1000"
- "Which merchants have the most customers?"

## API Endpoints

- `POST /api/chat` - Send a natural language query
  - Request: `{"message": "your question"}`
  - Response: `{"response": "...", "table": [...], "code": "..."}`

- `GET /api/health` - Health check

## Architecture

1. User sends natural language query
2. Backend sends query + data schema to Claude
3. Claude generates pandas code
4. Backend executes code safely
5. Results returned as JSON table
