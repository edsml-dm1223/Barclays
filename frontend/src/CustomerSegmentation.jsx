import { useState, useEffect } from 'react'

export default function CustomerSegmentation() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchSegmentation()
  }, [])

  const fetchSegmentation = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/data/segmentation.json')
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.detail || 'Failed to load segmentation data')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading segmentation data...</p>
      </div>
    )
  }

  if (error) {
    return <div className="error">{error}</div>
  }

  return (
    <div className="segmentation">
      <div className="segmentation-header">
        <h2>Customer Segmentation</h2>
        <p>Top 2 brands per customer based on last 2 months activity</p>
        <div className="stats">
          <span>{data.total_customers_analyzed} customers analyzed</span>
        </div>
      </div>

      <div className="segmentation-content">
        <div className="segmentation-banner">
          <h3>Sample Customers & Their Top Brands</h3>
          <div className="customer-cards">
            {data.sample_customers.map((customer, idx) => (
              <div key={idx} className="customer-card">
                <div className="customer-id">Customer {idx + 1}</div>
                <div className="customer-brands">
                  {customer.brands.map((brand, bIdx) => (
                    <div key={bIdx} className="brand-item">
                      <span className="brand-name">{brand}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
