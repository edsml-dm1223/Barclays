import { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Html, Line, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import HandTracker from './HandTracker'

// Component to handle gesture-based camera control
function GestureController({ gesture, enabled }) {
  const { camera } = useThree()
  const controlsRef = useRef()

  useFrame(() => {
    if (!controlsRef.current) return

    // Stop all movement if disabled or no gesture
    if (!enabled || !gesture) {
      controlsRef.current.update()
      return
    }

    if (gesture.type === 'fist' && gesture.delta) {
      // Closed fist - rotate horizontally only
      const rotateSensitivity = 15
      const azimuthAngle = controlsRef.current.getAzimuthalAngle()
      controlsRef.current.setAzimuthalAngle(azimuthAngle - gesture.delta.x * rotateSensitivity)
    } else if (gesture.type === 'twohand-pinch') {
      // Two hands pinched + moving together - zoom out
      const currentDistance = camera.position.length()
      const newDistance = Math.max(3, Math.min(20, currentDistance + gesture.strength * 0.5))
      camera.position.normalize().multiplyScalar(newDistance)
    } else if (gesture.type === 'twohand-spread') {
      // Two hands pinched + moving apart - zoom in
      const currentDistance = camera.position.length()
      const newDistance = Math.max(3, Math.min(20, currentDistance - gesture.strength * 0.5))
      camera.position.normalize().multiplyScalar(newDistance)
    }

    controlsRef.current.update()
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      enableRotate={true}
      minDistance={3}
      maxDistance={20}
      target={[0, 0, 0]}
      enableDamping={true}
      dampingFactor={0.05}
    />
  )
}

// Single data point sphere
function DataPoint({ position, color, label, data, onClick, isHovered, onHover, showLabel }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)

  useFrame(() => {
    if (meshRef.current) {
      const targetScale = hovered || isHovered ? 1.5 : 1
      meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1)
    }
  })

  // Truncate label if too long
  const shortLabel = label && label.length > 20 ? label.substring(0, 18) + '...' : label

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation()
          onClick(label, data)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          onHover(label, data, true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          setHovered(false)
          onHover(null, null, false)
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[0.12, 32, 32]} />
        <meshStandardMaterial
          color={hovered || isHovered ? '#ff6b6b' : color}
          emissive={hovered || isHovered ? '#ff6b6b' : color}
          emissiveIntensity={hovered || isHovered ? 0.5 : 0.2}
          metalness={0.3}
          roughness={0.4}
        />
      </mesh>
      {/* Always show label for top 10 */}
      {showLabel && !hovered && !isHovered && (
        <Billboard position={[0.2, 0.2, 0]}>
          <Text fontSize={0.15} color="#ffffff" anchorX="left">
            {shortLabel}
          </Text>
        </Billboard>
      )}
      {(hovered || isHovered) && (
        <Html distanceFactor={10} position={[0, 0.4, 0]}>
          <div className="tooltip">
            <strong>{label}</strong>
            <div>Median Txn: {data.x.toFixed(1)}</div>
            <div>Median Amt: ${data.y.toFixed(2)}</div>
            <div>Customers 10+: {data.z}</div>
          </div>
        </Html>
      )}
    </group>
  )
}

// Render all data points
function InstancedPoints({ data, colorScale, onClick, onHover, hoveredIndex }) {
  return (
    <>
      {data.labels.map((label, i) => (
        <DataPoint
          key={i}
          position={[data.normalizedX[i], data.normalizedY[i], data.normalizedZ[i]]}
          color={colorScale(data.z[i])}
          label={label}
          data={{ x: data.x[i], y: data.y[i], z: data.z[i] }}
          onClick={onClick}
          isHovered={hoveredIndex === i}
          onHover={(l, d, h) => onHover(h ? i : null)}
          showLabel={data.topIndices.has(i)}
        />
      ))}
    </>
  )
}

// Axis lines and labels
function Axes() {
  const axisLength = 5

  return (
    <group>
      {/* X Axis - Median Transactions */}
      <Line
        points={[[0, 0, 0], [axisLength, 0, 0]]}
        color="#ef4444"
        lineWidth={2}
      />
      <Billboard position={[axisLength + 0.8, 0, 0]}>
        <Text fontSize={0.22} color="#ef4444">
          X: Median Txn
        </Text>
      </Billboard>

      {/* Y Axis - Customers with 10+ (Z data) */}
      <Line
        points={[[0, 0, 0], [0, axisLength, 0]]}
        color="#22c55e"
        lineWidth={2}
      />
      <Billboard position={[0, axisLength + 0.4, 0]}>
        <Text fontSize={0.22} color="#22c55e">
          Y: Customers 10+
        </Text>
      </Billboard>

      {/* Z Axis - Median Amount (Y data) */}
      <Line
        points={[[0, 0, 0], [0, 0, axisLength]]}
        color="#3b82f6"
        lineWidth={2}
      />
      <Billboard position={[0, 0, axisLength + 0.8]}>
        <Text fontSize={0.22} color="#3b82f6">
          Z: Median Amt
        </Text>
      </Billboard>

      {/* Grid on XZ plane (floor) */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <group key={`xz-${i}`}>
          <Line points={[[i, 0, 0], [i, 0, axisLength]]} color="#ffffff" lineWidth={0.5} opacity={0.3} transparent />
          <Line points={[[0, 0, i], [axisLength, 0, i]]} color="#ffffff" lineWidth={0.5} opacity={0.3} transparent />
        </group>
      ))}

      {/* Grid on XY plane (back wall) */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <group key={`xy-${i}`}>
          <Line points={[[i, 0, 0], [i, axisLength, 0]]} color="#ffffff" lineWidth={0.5} opacity={0.2} transparent />
          <Line points={[[0, i, 0], [axisLength, i, 0]]} color="#ffffff" lineWidth={0.5} opacity={0.2} transparent />
        </group>
      ))}

      {/* Grid on YZ plane (side wall) */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <group key={`yz-${i}`}>
          <Line points={[[0, i, 0], [0, i, axisLength]]} color="#ffffff" lineWidth={0.5} opacity={0.2} transparent />
          <Line points={[[0, 0, i], [0, axisLength, i]]} color="#ffffff" lineWidth={0.5} opacity={0.2} transparent />
        </group>
      ))}
    </group>
  )
}

// Main scene component
function Scene({ data, onPointClick, title, gesture, handTrackingEnabled }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)

  // Get top 31 indices by z value (customers_with_10plus_txn)
  const topIndices = useMemo(() => {
    const indices = data.z.map((val, idx) => ({ val, idx }))
    indices.sort((a, b) => b.val - a.val)
    return new Set(indices.slice(0, 31).map(item => item.idx))
  }, [data.z])

  // Normalize data to fit in 0-5 range for each axis
  const normalizedData = useMemo(() => {
    const xMin = Math.min(...data.x)
    const xMax = Math.max(...data.x)
    const yMin = Math.min(...data.y)
    const yMax = Math.max(...data.y)
    const zMin = Math.min(...data.z)
    const zMax = Math.max(...data.z)

    const normalize = (val, min, max) => {
      if (max === min) return 2.5
      return ((val - min) / (max - min)) * 4.5 + 0.25
    }

    return {
      ...data,
      normalizedX: data.x.map(v => normalize(v, xMin, xMax)),
      normalizedY: data.z.map(v => normalize(v, zMin, zMax)),
      normalizedZ: data.y.map(v => normalize(v, yMin, yMax)),
      topIndices
    }
  }, [data, topIndices])

  // Color scale based on z values
  const colorScale = useMemo(() => {
    const zMin = Math.min(...data.z)
    const zMax = Math.max(...data.z)
    return (value) => {
      const t = zMax === zMin ? 0.5 : (value - zMin) / (zMax - zMin)
      const r = Math.floor(68 + t * (253 - 68))
      const g = Math.floor(1 + t * (231 - 1))
      const b = Math.floor(84 + t * (37 - 84))
      return `rgb(${r}, ${g}, ${b})`
    }
  }, [data.z])

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />

      <group position={[-2.5, -2.5, -2.5]}>
        <Axes />

        <InstancedPoints
          data={normalizedData}
          colorScale={colorScale}
          onClick={onPointClick}
          onHover={setHoveredIndex}
          hoveredIndex={hoveredIndex}
        />
      </group>

      <GestureController gesture={gesture} enabled={handTrackingEnabled} />
    </>
  )
}

// Main exported component
export default function ScatterPlot3D({ data, onPointClick, title }) {
  const containerRef = useRef(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [handTrackingEnabled, setHandTrackingEnabled] = useState(false)
  const [currentGesture, setCurrentGesture] = useState(null)
  const [cameraPermission, setCameraPermission] = useState('pending')

  // Request camera permission on mount
  useEffect(() => {
    const requestCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        stream.getTracks().forEach(track => track.stop())
        setCameraPermission('granted')
      } catch (err) {
        console.error('Camera permission:', err)
        setCameraPermission('denied')
      }
    }
    requestCameraPermission()
  }, [])

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        console.error('Error entering fullscreen:', err)
      })
    } else {
      document.exitFullscreen()
    }
  }, [])

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!document.fullscreenElement
      setIsFullscreen(isFs)
      // Auto-disable hand tracking when exiting fullscreen
      if (!isFs) {
        setHandTrackingEnabled(false)
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Handle gesture from HandTracker
  const handleGesture = useCallback((gesture) => {
    // Always update, including to null to stop movement
    setCurrentGesture(gesture)
  }, [])

  // Clear gesture when hand tracking is disabled
  useEffect(() => {
    if (!handTrackingEnabled) {
      setCurrentGesture(null)
    }
  }, [handTrackingEnabled])

  // Use ResizeObserver for reliable size detection
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect()
      setDimensions({ width: rect.width, height: rect.height })
    }

    updateDimensions()

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  if (!data || !data.labels || data.labels.length === 0) {
    return <div className="no-data">No data available</div>
  }

  const hasValidDimensions = dimensions.width > 0 && dimensions.height > 0

  return (
    <div
      className={`canvas-container ${isFullscreen ? 'fullscreen' : ''}`}
      ref={containerRef}
    >
      {/* Control buttons */}
      <div className="graph-controls">
        <button
          onClick={toggleFullscreen}
          className="control-btn"
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          )}
        </button>

        {isFullscreen && (
          <button
            onClick={() => setHandTrackingEnabled(!handTrackingEnabled)}
            className={`control-btn ${handTrackingEnabled ? 'active' : ''}`}
            title={handTrackingEnabled ? 'Disable hand tracking' : 'Enable hand tracking'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8" />
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
            </svg>
          </button>
        )}
      </div>

      {/* Hand tracker (only in fullscreen) */}
      {isFullscreen && (
        <HandTracker
          onGesture={handleGesture}
          enabled={handTrackingEnabled}
        />
      )}

      {/* Gesture hint */}
      {isFullscreen && handTrackingEnabled && (
        <div className="gesture-hint">
          <span>Closed fist + move: Rotate</span>
          <span>Two hands pinched + apart: Zoom in</span>
          <span>Two hands pinched + together: Zoom out</span>
        </div>
      )}

      {hasValidDimensions && (
        <Canvas
          key={`canvas-${isFullscreen}-${dimensions.width}-${dimensions.height}`}
          camera={{ position: [8, 6, 8], fov: 50, near: 0.1, far: 1000 }}
          style={{ width: '100%', height: '100%' }}
        >
          <Scene
            data={data}
            onPointClick={onPointClick}
            title={title}
            gesture={currentGesture}
            handTrackingEnabled={handTrackingEnabled}
          />
        </Canvas>
      )}
    </div>
  )
}
