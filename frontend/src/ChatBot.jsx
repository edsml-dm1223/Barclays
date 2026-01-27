import { useState, useRef, useEffect } from 'react'

// API URL - uses environment variable for production, falls back to localhost for development
const API_URL = import.meta.env.VITE_CHATBOT_API_URL || 'http://localhost:8000'

// Pre-computed Q&A data for offline demo
const PRECOMPUTED_QA = {
  "How many transactions are after 8:30pm?": {
    response: "Out of 838,755 total transactions, 60,920 (7.26%) occur after 8:30pm.",
    table: null
  },
  "Top 10 merchants by transaction count": {
    response: "Here are the top 10 merchants by transaction count:",
    table: [
      { Merchant: "AMAZON_MARKETPLACE", Transactions: 36771 },
      { Merchant: "PAYPAL", Transactions: 33749 },
      { Merchant: "TESCO_GENERAL", Transactions: 32981 },
      { Merchant: "SAVING", Transactions: 19819 },
      { Merchant: "APPLE_GENERAL", Transactions: 18703 },
      { Merchant: "ASDA_GENERAL", Transactions: 15754 },
      { Merchant: "SAINSBURY'S", Transactions: 15428 },
      { Merchant: "MCDONALD'S", Transactions: 14762 },
      { Merchant: "GBP", Transactions: 10056 },
      { Merchant: "TRANSPORT FOR LONDON", Transactions: 9951 }
    ]
  },
  "Breakdown by day of week": {
    response: "Here's the transaction breakdown by day of week:",
    table: [
      { Day: "Monday", Transactions: 199207 },
      { Day: "Tuesday", Transactions: 203209 },
      { Day: "Wednesday", Transactions: 134383 },
      { Day: "Thursday", Transactions: 121998 },
      { Day: "Friday", Transactions: 121249 },
      { Day: "Saturday", Transactions: 26360 },
      { Day: "Sunday", Transactions: 32349 }
    ]
  },
  "Average amount by classification": {
    response: "Here are the top 15 classifications by average transaction amount:",
    table: [
      { Classification: "Professional Services", "Average Amount": "$825.75" },
      { Classification: "Loans", "Average Amount": "$580.11" },
      { Classification: "Personal Care", "Average Amount": "$349.26" },
      { Classification: "Bank products", "Average Amount": "$335.45" },
      { Classification: "Gifts & Donations", "Average Amount": "$293.48" },
      { Classification: "Government", "Average Amount": "$265.67" },
      { Classification: "Investments", "Average Amount": "$245.04" },
      { Classification: "Education", "Average Amount": "$224.26" },
      { Classification: "Sporting Goods", "Average Amount": "$142.71" },
      { Classification: "Taxes", "Average Amount": "$129.31" }
    ]
  },
  "How many customers are in the dataset?": {
    response: "There are 848 unique customers in the dataset.",
    table: null
  },
  "Top 10 classifications by transaction volume": {
    response: "Here are the top 10 classifications by transaction volume:",
    table: [
      { Classification: "Financial Services", Transactions: 143654 },
      { Classification: "Shopping", Transactions: 125894 },
      { Classification: "Groceries", Transactions: 91087 },
      { Classification: "Food & Dining", Transactions: 89358 },
      { Classification: "Entertainment", Transactions: 50747 },
      { Classification: "Bank products", Transactions: 42087 },
      { Classification: "Personal Services", Transactions: 35524 },
      { Classification: "Auto & Transport", Transactions: 32087 },
      { Classification: "Public Services", Transactions: 29939 },
      { Classification: "Telecommunications", Transactions: 27233 }
    ]
  },
  "How many transactions are over $500?": {
    response: "20,456 transactions (2.44%) are over $500, with an average amount of $1,799.69.",
    table: null
  },
  "Weekend vs Weekday comparison": {
    response: "Here's the weekend vs weekday comparison:\n\n• Weekday: 780,046 transactions (93.0%), avg $76.77\n• Weekend: 58,709 transactions (7.0%), avg $88.90\n\nInterestingly, while weekends have fewer transactions, the average transaction amount is higher.",
    table: null
  },
  "Credit vs Debit breakdown": {
    response: "Here's the credit vs debit breakdown:\n\n• DEBIT: 732,379 transactions (87.3%), avg $49.35\n• CREDIT: 106,376 transactions (12.7%), avg $272.27\n\nCredit transactions have a significantly higher average amount than debit transactions.",
    table: null
  },
  "Which categories have most late-night activity?": {
    response: "Here are the categories with the highest percentage of late-night activity (after 8:30pm):",
    table: [
      { Classification: "Pension and Insurances", "After 8:30pm": 2223, "% of Category": "28.9%" },
      { Classification: "Telecommunications", "After 8:30pm": 6765, "% of Category": "24.8%" },
      { Classification: "Gifts & Donations", "After 8:30pm": 1438, "% of Category": "24.8%" },
      { Classification: "Investments", "After 8:30pm": 893, "% of Category": "24.5%" },
      { Classification: "Fees & Charges", "After 8:30pm": 246, "% of Category": "19.9%" }
    ]
  }
}

// All available suggestion questions
const ALL_SUGGESTIONS = [
  "How many transactions are after 8:30pm?",
  "Top 10 merchants by transaction count",
  "Breakdown by day of week",
  "Average amount by classification",
  "How many customers are in the dataset?",
  "Top 10 classifications by transaction volume",
  "How many transactions are over $500?",
  "Weekend vs Weekday comparison",
  "Credit vs Debit breakdown",
  "Which categories have most late-night activity?"
]

export default function ChatBot() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m your data analytics assistant. I can help you explore your transaction data.\n\nClick any question below to get started:',
      suggestions: ALL_SUGGESTIONS
    }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessage = async (messageText) => {
    const userMessage = messageText || input.trim()
    if (!userMessage || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    // Check for pre-computed answer first
    const precomputedAnswer = PRECOMPUTED_QA[userMessage]
    if (precomputedAnswer) {
      // Simulate a brief delay for natural feel
      await new Promise(resolve => setTimeout(resolve, 300))
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: precomputedAnswer.response,
        table: precomputedAnswer.table
      }])
      setLoading(false)
      return
    }

    // Fall back to API call for non-precomputed questions
    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage })
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const data = await response.json()
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        table: data.table,
        code: data.code
      }])
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `I don't have a pre-computed answer for that question.\n\nTry one of the suggested questions, or connect to the analytics backend for custom queries.`,
        isError: true,
        suggestions: ALL_SUGGESTIONS
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion)
  }

  const renderTable = (data) => {
    if (!data || data.length === 0) return null
    const columns = Object.keys(data[0])

    return (
      <div style={{
        marginTop: '16px',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        background: '#fff'
      }}>
        <div style={{
          maxHeight: '400px',
          overflow: 'auto'
        }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '14px'
          }}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col} style={{
                    padding: '12px 16px',
                    borderBottom: '2px solid #e2e8f0',
                    textAlign: 'left',
                    background: '#f8fafc',
                    fontWeight: '600',
                    color: '#475569',
                    position: 'sticky',
                    top: 0,
                    whiteSpace: 'nowrap'
                  }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr key={idx} style={{
                  background: idx % 2 === 0 ? '#fff' : '#f8fafc',
                  transition: 'background 0.15s'
                }}>
                  {columns.map(col => (
                    <td key={col} style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid #e2e8f0',
                      color: '#334155'
                    }}>
                      {typeof row[col] === 'number'
                        ? row[col].toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 100px)',
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '24px 32px'
    }}>
      {/* Header */}
      <div style={{
        marginBottom: '24px',
        textAlign: 'center'
      }}>
        <h2 style={{
          fontSize: '28px',
          fontWeight: '700',
          color: '#1e293b',
          margin: '0 0 8px 0'
        }}>
          Analytics Assistant
        </h2>
        <p style={{
          fontSize: '16px',
          color: '#64748b',
          margin: 0
        }}>
          Ask questions about your transaction data in natural language
        </p>
      </div>

      {/* Messages Container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
        background: '#f1f5f9',
        borderRadius: '16px',
        marginBottom: '20px'
      }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start'
          }}>
            {/* Role Label */}
            <span style={{
              fontSize: '12px',
              fontWeight: '600',
              color: '#64748b',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </span>

            {/* Message Bubble */}
            <div style={{
              maxWidth: msg.table ? '100%' : '80%',
              width: msg.table ? '100%' : 'auto',
              padding: '16px 20px',
              borderRadius: '16px',
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
                : msg.isError
                  ? '#fef2f2'
                  : '#fff',
              color: msg.role === 'user' ? '#fff' : msg.isError ? '#991b1b' : '#1e293b',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              whiteSpace: 'pre-wrap',
              fontSize: '15px',
              lineHeight: '1.6'
            }}>
              {msg.content}

              {/* Suggestions */}
              {msg.suggestions && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginTop: '16px'
                }}>
                  {msg.suggestions.map((suggestion, sIdx) => (
                    <button
                      key={sIdx}
                      onClick={() => handleSuggestionClick(suggestion)}
                      style={{
                        padding: '10px 16px',
                        borderRadius: '20px',
                        border: '2px solid #e2e8f0',
                        background: '#f8fafc',
                        color: '#475569',
                        fontSize: '13px',
                        fontWeight: '500',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        ':hover': {
                          borderColor: '#3b82f6',
                          background: '#eff6ff'
                        }
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.borderColor = '#3b82f6'
                        e.target.style.background = '#eff6ff'
                        e.target.style.color = '#2563eb'
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.borderColor = '#e2e8f0'
                        e.target.style.background = '#f8fafc'
                        e.target.style.color = '#475569'
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {/* Table */}
              {msg.table && renderTable(msg.table)}

              {/* Code Toggle */}
              {msg.code && (
                <details style={{ marginTop: '16px' }}>
                  <summary style={{
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: '#64748b',
                    fontWeight: '500',
                    padding: '8px 0',
                    userSelect: 'none'
                  }}>
                    View generated code
                  </summary>
                  <pre style={{
                    background: '#1e293b',
                    color: '#e2e8f0',
                    padding: '16px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    overflow: 'auto',
                    marginTop: '8px',
                    lineHeight: '1.5'
                  }}>
                    {msg.code}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {loading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#64748b',
            padding: '16px'
          }}>
            <div style={{
              width: '24px',
              height: '24px',
              border: '3px solid #e2e8f0',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}></div>
            <span style={{ fontSize: '15px' }}>Analyzing your data...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{
        display: 'flex',
        gap: '16px',
        padding: '8px',
        background: '#fff',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        border: '1px solid #e2e8f0'
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Ask a question about your transaction data..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '16px 20px',
            borderRadius: '12px',
            border: 'none',
            fontSize: '16px',
            outline: 'none',
            background: '#f8fafc',
            color: '#1e293b'
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          style={{
            padding: '16px 32px',
            borderRadius: '12px',
            border: 'none',
            background: loading || !input.trim()
              ? '#cbd5e1'
              : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: '#fff',
            fontSize: '16px',
            fontWeight: '600',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            minWidth: '100px'
          }}
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
