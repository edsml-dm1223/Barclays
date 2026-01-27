import { useState, useEffect } from 'react'
import ScatterPlot3D from './ScatterPlot3D'
import Recommendations from './Recommendations'
import GapAnalysis from './GapAnalysis'
import ChatBot from './ChatBot'

const SITE_PASSWORD = 'aptap2026'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('authenticated') === 'true'
  })
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)

  const [activeTab, setActiveTab] = useState('3d-plot')
  const [graphData, setGraphData] = useState(null)
  const [merchantData, setMerchantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [merchantLoading, setMerchantLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showIncomeSegments, setShowIncomeSegments] = useState(false)
  const [incomeData, setIncomeData] = useState(null)
  const [incomeMerchantData, setIncomeMerchantData] = useState(null)
  const [selectedIncomeBracket, setSelectedIncomeBracket] = useState(null)

  const handlePasswordSubmit = (e) => {
    e.preventDefault()
    if (passwordInput === SITE_PASSWORD) {
      sessionStorage.setItem('authenticated', 'true')
      setIsAuthenticated(true)
      setPasswordError(false)
    } else {
      setPasswordError(true)
      setPasswordInput('')
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/data/classifications.json')
      if (!response.ok) {
        throw new Error('Failed to load data')
      }
      const data = await response.json()
      setGraphData(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchIncomeData = async () => {
    try {
      const response = await fetch('/data/income_segments.json')
      if (!response.ok) {
        throw new Error('Failed to load income data')
      }
      const data = await response.json()
      setIncomeData(data)
    } catch (err) {
      console.error('Failed to load income segments:', err)
    }
  }

  const fetchMerchantData = async (classification) => {
    setMerchantLoading(true)
    setError(null)

    try {
      const response = await fetch('/data/merchants.json')
      if (!response.ok) {
        throw new Error('Failed to fetch merchant data')
      }
      const allMerchants = await response.json()
      const data = allMerchants[classification]
      if (!data) {
        throw new Error(`No merchants found for: ${classification}`)
      }
      setMerchantData(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setMerchantLoading(false)
    }
  }

  const fetchIncomeMerchantData = async (classification, incomeBracket) => {
    setMerchantLoading(true)
    setError(null)

    try {
      const response = await fetch('/data/merchants_by_income.json')
      if (!response.ok) {
        throw new Error('Failed to fetch income merchant data')
      }
      const allData = await response.json()
      const data = allData[incomeBracket]?.[classification]
      if (!data) {
        throw new Error(`No merchants found for ${classification} in this income bracket`)
      }
      setIncomeMerchantData(data)
      setSelectedIncomeBracket(incomeBracket)
    } catch (err) {
      setError(err.message)
    } finally {
      setMerchantLoading(false)
    }
  }

  const handlePointClick = (label, data) => {
    if (label && !merchantData) {
      fetchMerchantData(label)
    }
  }

  const handleBack = () => {
    setMerchantData(null)
  }

  const handleIncomeBack = () => {
    setIncomeMerchantData(null)
    setSelectedIncomeBracket(null)
  }

  useEffect(() => {
    if (isAuthenticated && activeTab === '3d-plot') {
      fetchData()
      fetchIncomeData()
    }
  }, [activeTab, isAuthenticated])

  if (!isAuthenticated) {
    return (
      <div className="password-gate">
        <div className="password-modal">
          <img src="/aptap-logo.png" alt="APTAP Logo" className="password-logo" />
          <h2>Password Required</h2>
          <p>Enter password to access this site</p>
          <form onSubmit={handlePasswordSubmit}>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
            <button type="submit">Enter</button>
          </form>
          {passwordError && <p className="password-error">Incorrect password</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header>
        <div className="header-title">
          <img src="/aptap-logo.png" alt="APTAP Logo" className="header-logo" />
          <h1>Transaction Data Visualizer</h1>
        </div>
        <nav className="tabs">
          <button
            className={`tab ${activeTab === '3d-plot' ? 'active' : ''}`}
            onClick={() => setActiveTab('3d-plot')}
          >
            3D Plot
          </button>
          <button
            className={`tab ${activeTab === 'recommendations' ? 'active' : ''}`}
            onClick={() => setActiveTab('recommendations')}
          >
            Global Segmentations
          </button>
          <button
            className={`tab ${activeTab === 'gap-analysis' ? 'active' : ''}`}
            onClick={() => setActiveTab('gap-analysis')}
          >
            Customer Segmentation
          </button>
          <button
            className={`tab ${activeTab === 'chatbot' ? 'active' : ''}`}
            onClick={() => setActiveTab('chatbot')}
          >
            Analytics Chat
          </button>
        </nav>
      </header>

      {activeTab === '3d-plot' && (
        <>
          {loading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Loading data...</p>
            </div>
          )}

          {error && <div className="error">{error}</div>}

          {graphData && !merchantData && !incomeMerchantData && !loading && (
            <div className="graph-section">
              <div className="graph-info">
                <h2>Transaction Classifications</h2>
                <p>Click on a point to explore merchants in that category</p>
                <div className="stats">
                  <span>{graphData.labels.length} categories</span>
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

              {/* Main Plot - All Customers */}
              <div className="plot-container">
                <div className="plot-header">
                  <span className="plot-title">All Customers</span>
                  <span className="plot-range">Full Dataset</span>
                </div>
                <ScatterPlot3D
                  data={graphData}
                  onPointClick={handlePointClick}
                  title="Transaction Classifications"
                />
              </div>

              {/* Income Segmented Plots */}
              {showIncomeSegments && incomeData && !incomeMerchantData && (
                <div className="income-plots-grid">
                  {['low', 'lower_middle', 'upper_middle', 'high'].map((bracket) => (
                    <div key={bracket} className="income-plot-container">
                      <div className="plot-header">
                        <span className="plot-title">{incomeData[bracket].name}</span>
                        <span className="plot-range">{incomeData[bracket].range}</span>
                        <span className="plot-customers">{incomeData[bracket].customer_count} customers</span>
                      </div>
                      <ScatterPlot3D
                        data={{
                          labels: incomeData[bracket].labels,
                          x: incomeData[bracket].x,
                          y: incomeData[bracket].y,
                          z: incomeData[bracket].z,
                          axis_labels: incomeData[bracket].axis_labels
                        }}
                        onPointClick={(label) => fetchIncomeMerchantData(label, bracket)}
                        title={incomeData[bracket].name}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="controls-hint">
                <span>Rotate: Left click + drag</span>
                <span>Zoom: Scroll</span>
                <span>Pan: Right click + drag</span>
              </div>
            </div>
          )}

          {merchantLoading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Loading merchants...</p>
            </div>
          )}

          {merchantData && (
            <div className="graph-section">
              <div className="graph-info">
                <button className="back-button" onClick={handleBack}>
                  ← Back to Classifications
                </button>
                <h2>{merchantData.classification}</h2>
                <p>Merchants in this category</p>
                <div className="stats">
                  <span>{merchantData.labels.length} merchants</span>
                </div>
              </div>
              <ScatterPlot3D
                data={merchantData}
                onPointClick={() => {}}
                title={`Merchants - ${merchantData.classification}`}
              />
              <div className="controls-hint">
                <span>Rotate: Left click + drag</span>
                <span>Zoom: Scroll</span>
                <span>Pan: Right click + drag</span>
              </div>
            </div>
          )}

          {/* Income Merchant Drill-down View */}
          {incomeMerchantData && (
            <div className="graph-section">
              <div className="graph-info">
                <button className="back-button" onClick={handleIncomeBack}>
                  ← Back to Income Segments
                </button>
                <h2>{incomeMerchantData.classification}</h2>
                <p>Merchants in this category</p>
                <div className="stats">
                  <span className="income-bracket-label">{incomeData[selectedIncomeBracket]?.name}</span>
                  <span className="income-bracket-range">{incomeData[selectedIncomeBracket]?.range}</span>
                  <span>{incomeMerchantData.labels.length} merchants</span>
                </div>
              </div>
              <ScatterPlot3D
                data={incomeMerchantData}
                onPointClick={() => {}}
                title={`Merchants - ${incomeMerchantData.classification}`}
              />
              <div className="controls-hint">
                <span>Rotate: Left click + drag</span>
                <span>Zoom: Scroll</span>
                <span>Pan: Right click + drag</span>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'recommendations' && <Recommendations />}

      {activeTab === 'gap-analysis' && <GapAnalysis />}

      {activeTab === 'chatbot' && <ChatBot />}
    </div>
  )
}

export default App
