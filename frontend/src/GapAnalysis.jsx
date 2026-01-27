import { useState, useEffect } from 'react'

export default function GapAnalysis() {
  const [data, setData] = useState(null)
  const [incomeData, setIncomeData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showIncomeSegments, setShowIncomeSegments] = useState(false)

  useEffect(() => {
    fetchData()
    fetchIncomeData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/data/segmentation.json')
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.detail || 'Failed to load data')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchIncomeData = async () => {
    try {
      const response = await fetch('/data/gap_analysis_income.json')
      if (!response.ok) {
        throw new Error('Failed to load income data')
      }
      const result = await response.json()
      setIncomeData(result)
    } catch (err) {
      console.error('Failed to load income segments:', err)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading gap analysis...</p>
      </div>
    )
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  const incomeOrder = ['low', 'lower_middle', 'upper_middle', 'high']

  return (
    <div className="gap-analysis">
      <div className="gap-header">
        <h2>Gap Analysis</h2>
        <p>Top 10 brands by customer reach</p>
        <div className="stats">
          <span>{data.total_customers_analyzed} customers analyzed</span>
        </div>
      </div>

      {/* Income Segment Toggle */}
      <div className="income-toggle">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={showIncomeSegments}
            onChange={(e) => setShowIncomeSegments(e.target.checked)}
          />
          <span className="toggle-switch"></span>
          <span className="toggle-text">Separate by Income</span>
        </label>
      </div>

      <div className="gap-content gap-content-full">
        {/* Main Table - All Customers */}
        <div className="gap-table-section">
          <div className="gap-table-header">
            <span className="gap-table-title">All Customers</span>
            <span className="gap-table-range">Full Dataset</span>
            <span className="gap-table-customers">{data.total_customers_analyzed} customers</span>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Brand</th>
                  <th>% of Customers</th>
                </tr>
              </thead>
              <tbody>
                {data.top10_brands.map((brand, idx) => (
                  <tr key={idx}>
                    <td className="rank">{idx + 1}</td>
                    <td className="merchant">{brand.primary_merchant}</td>
                    <td className="customers pct">{brand.customer_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Income Segmented Tables */}
        {showIncomeSegments && incomeData && (
          <div className="income-tables-grid">
            {incomeOrder.map((bracket, bracketIdx) => (
              <div key={bracket} className={`income-table-container income-bracket-${bracketIdx + 1}`}>
                <div className="gap-table-header">
                  <span className="gap-table-title">{incomeData[bracket].name}</span>
                  <span className="gap-table-range">{incomeData[bracket].range}</span>
                  <span className="gap-table-customers">{incomeData[bracket].total_customers_analyzed} customers</span>
                </div>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Brand</th>
                        <th>% of Customers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeData[bracket].top10_brands.map((brand, idx) => (
                        <tr key={idx}>
                          <td className="rank">{idx + 1}</td>
                          <td className="merchant">{brand.primary_merchant}</td>
                          <td className="customers pct">{brand.customer_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
