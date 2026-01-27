import { useState, useEffect, useMemo } from 'react'

export default function Recommendations() {
  const [classifications, setClassifications] = useState(null)
  const [merchants, setMerchants] = useState(null)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [thresholdX, setThresholdX] = useState(35)
  const [thresholdY, setThresholdY] = useState(30)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const [classRes, merchRes, recRes] = await Promise.all([
        fetch('/data/classifications.json'),
        fetch('/data/merchants.json'),
        fetch('/data/recommendations.json')
      ])
      if (!classRes.ok || !merchRes.ok || !recRes.ok) {
        throw new Error('Failed to load data')
      }
      const classData = await classRes.json()
      const merchData = await merchRes.json()
      const recData = await recRes.json()
      setClassifications(classData)
      setMerchants(merchData)
      setTotalCustomers(recData.total_customers)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const { topClassificationsCount, recommendations } = useMemo(() => {
    if (!classifications || !merchants || !totalCustomers) {
      return { topClassificationsCount: 0, recommendations: [] }
    }

    const minClassCustomers = totalCustomers * (thresholdX / 100)

    const topClassifications = classifications.labels
      .map((label, idx) => ({
        name: label,
        customers: classifications.z[idx]
      }))
      .filter(c => c.customers >= minClassCustomers)

    const results = []
    for (const classInfo of topClassifications) {
      const classMerchants = merchants[classInfo.name]
      if (!classMerchants) continue

      const minMerchCustomers = classInfo.customers * (thresholdY / 100)

      classMerchants.labels.forEach((merchant, idx) => {
        const merchantCustomers = classMerchants.z[idx]
        if (merchantCustomers >= minMerchCustomers) {
          results.push({
            classification: classInfo.name,
            classification_customers: classInfo.customers,
            classification_pct: Math.round(classInfo.customers / totalCustomers * 1000) / 10,
            merchant: merchant,
            merchant_customers: merchantCustomers,
            merchant_pct_of_classification: Math.round(merchantCustomers / classInfo.customers * 1000) / 10,
            median_txn: classMerchants.x[idx],
            median_amount: classMerchants.y[idx]
          })
        }
      })
    }

    results.sort((a, b) => b.merchant_customers - a.merchant_customers)

    return {
      topClassificationsCount: topClassifications.length,
      recommendations: results
    }
  }, [classifications, merchants, totalCustomers, thresholdX, thresholdY])

  return (
    <div className="recommendations">
      <div className="results-panel" style={{ flex: 1, padding: '20px 40px' }}>
        {loading && (
          <div className="loading-container">
            <div className="spinner"></div>
            <p>Loading recommendations...</p>
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {classifications && merchants && !loading && (
          <>
            <div className="threshold-info" style={{ display: 'flex', gap: '40px', marginBottom: '30px', padding: '20px', background: '#f8fafc', borderRadius: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                  Classification Threshold (X): {thresholdX}%
                </p>
                <p style={{ fontSize: '12px', color: '#64748b' }}>
                  Classifications with at least {thresholdX}% of total customers
                </p>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: '600', color: '#334155', marginBottom: '4px' }}>
                  Merchant Threshold (Y): {thresholdY}%
                </p>
                <p style={{ fontSize: '12px', color: '#64748b' }}>
                  Merchants with at least {thresholdY}% of classification's customers
                </p>
              </div>
            </div>

            <div className="summary-stats">
              <div className="stat">
                <span className="stat-value">{totalCustomers}</span>
                <span className="stat-label">Total Customers (10+ txn)</span>
              </div>
              <div className="stat">
                <span className="stat-value">{topClassificationsCount}</span>
                <span className="stat-label">Top Classifications</span>
              </div>
              <div className="stat">
                <span className="stat-value">{recommendations.length}</span>
                <span className="stat-label">Recommended Merchants</span>
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Merchant</th>
                    <th>Classification</th>
                    <th>Customers</th>
                    <th>Median Txn</th>
                    <th>Median Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((rec, idx) => (
                    <tr key={idx}>
                      <td className="rank">{idx + 1}</td>
                      <td className="merchant">{rec.merchant}</td>
                      <td>
                        <span className="classification-tag">{rec.classification}</span>
                        <span className="classification-pct">({rec.classification_pct}% of total)</span>
                      </td>
                      <td className="customers">{rec.merchant_customers} <span className="pct">({(rec.merchant_customers / totalCustomers * 100).toFixed(1)}%)</span></td>
                      <td>{rec.median_txn.toFixed(1)}</td>
                      <td>${rec.median_amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {recommendations.length === 0 && (
              <div className="no-results">
                <p>No merchants match the current thresholds.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
