import { useRef, useEffect, useState, useCallback } from 'react'

// Load MediaPipe from CDN
const loadMediaPipe = () => {
  return new Promise((resolve, reject) => {
    if (window.Hands) {
      resolve(window.Hands)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      if (window.Hands) {
        resolve(window.Hands)
      } else {
        reject(new Error('MediaPipe Hands not loaded'))
      }
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

export default function HandTracker({ onGesture, enabled }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const cameraRef = useRef(null)
  const handsRef = useRef(null)
  const lastPositionRef = useRef(null)
  const lastPinchDistRef = useRef(null)
  const lastTwoHandsDistRef = useRef(null)
  const lastTwoHandsCenterRef = useRef(null)
  const [status, setStatus] = useState('initializing')
  const [errorDetail, setErrorDetail] = useState('')

  // Calculate distance between two points
  const distance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2))
  }

  // Get palm center from hand landmarks
  const getPalmCenter = (hand) => {
    const wrist = hand[0]
    const indexMcp = hand[5]
    return {
      x: (wrist.x + indexMcp.x + hand[9].x + hand[13].x + hand[17].x) / 5,
      y: (wrist.y + indexMcp.y + hand[9].y + hand[13].y + hand[17].y) / 5,
      z: (wrist.z + indexMcp.z + hand[9].z + hand[13].z + hand[17].z) / 5
    }
  }

  // Check if hand is in pinched position
  const isHandPinched = (hand) => {
    const thumbTip = hand[4]
    const indexTip = hand[8]
    const pinchDist = distance(thumbTip, indexTip)
    return pinchDist < 0.1
  }

  // Check if hand is a closed fist
  const isHandFist = (hand) => {
    const indexTip = hand[8]
    const middleTip = hand[12]
    const ringTip = hand[16]
    const pinkyTip = hand[20]
    const indexMcp = hand[5]
    const middleMcp = hand[9]
    const ringMcp = hand[13]
    const pinkyMcp = hand[17]

    // All fingers should be curled (tips below/at same level as MCPs)
    const fingersCurled =
      indexTip.y > indexMcp.y &&
      middleTip.y > middleMcp.y &&
      ringTip.y > ringMcp.y &&
      pinkyTip.y > pinkyMcp.y

    return fingersCurled
  }

  // Detect two-hand gestures
  const detectTwoHandGesture = useCallback((landmarks) => {
    const hand1 = landmarks[0]
    const hand2 = landmarks[1]

    const palm1 = getPalmCenter(hand1)
    const palm2 = getPalmCenter(hand2)

    // Check if both hands are pinched
    const bothPinched = isHandPinched(hand1) && isHandPinched(hand2)

    // Distance between two hands
    const handsDistance = distance(palm1, palm2)

    // Center point between hands
    const center = {
      x: (palm1.x + palm2.x) / 2,
      y: (palm1.y + palm2.y) / 2,
      z: (palm1.z + palm2.z) / 2
    }

    let gesture = null

    // Zoom only works when both hands are pinched
    if (bothPinched && lastTwoHandsDistRef.current !== null) {
      const distDelta = handsDistance - lastTwoHandsDistRef.current

      if (Math.abs(distDelta) > 0.008) {
        if (distDelta > 0) {
          // Hands moving apart - zoom out
          gesture = { type: 'twohand-spread', strength: Math.min(1, distDelta * 12) }
        } else {
          // Hands moving together - zoom in
          gesture = { type: 'twohand-pinch', strength: Math.min(1, Math.abs(distDelta) * 12) }
        }
      }
    }

    lastTwoHandsDistRef.current = handsDistance

    return gesture
  }, [])

  // Detect single hand gesture (closed fist for rotation)
  const detectSingleHandGesture = useCallback((hand) => {
    const palmCenter = getPalmCenter(hand)
    const fistDetected = isHandFist(hand)

    let gesture = null

    if (fistDetected) {
      gesture = { type: 'fist', position: palmCenter }

      // Calculate movement delta only when fist is maintained
      if (lastPositionRef.current) {
        gesture.delta = {
          x: palmCenter.x - lastPositionRef.current.x,
          y: palmCenter.y - lastPositionRef.current.y,
          z: palmCenter.z - lastPositionRef.current.z
        }
      }
      lastPositionRef.current = palmCenter
    } else {
      // Reset position tracking when hand is open (allows repositioning)
      lastPositionRef.current = null
    }

    return gesture
  }, [])

  // Main gesture detection - handles both single and two-hand
  const detectGesture = useCallback((landmarks) => {
    if (!landmarks || landmarks.length === 0) return null

    // Two hands detected - use two-hand gestures
    if (landmarks.length >= 2) {
      // Reset single-hand tracking
      lastPositionRef.current = null
      lastPinchDistRef.current = null
      return detectTwoHandGesture(landmarks)
    }

    // Single hand - use single-hand gestures
    lastTwoHandsDistRef.current = null
    lastTwoHandsCenterRef.current = null
    return detectSingleHandGesture(landmarks[0])
  }, [detectTwoHandGesture, detectSingleHandGesture])

  // Process hand tracking results
  const onResults = useCallback((results) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    if (!canvas || !ctx) return

    // Draw camera feed
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height)

    // Draw hand landmarks
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      setStatus('tracking')

      for (const landmarks of results.multiHandLandmarks) {
        // Draw connections
        ctx.strokeStyle = '#00FF00'
        ctx.lineWidth = 2

        // Draw landmarks
        for (const point of landmarks) {
          ctx.beginPath()
          ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, 2 * Math.PI)
          ctx.fillStyle = '#FF0000'
          ctx.fill()
        }
      }

      // Detect and emit gesture (always emit, including null to stop movement)
      const gesture = detectGesture(results.multiHandLandmarks)
      if (onGesture) {
        onGesture(gesture)
      }
    } else {
      setStatus('no_hand')
      lastPositionRef.current = null
      // Emit null gesture to stop any movement
      if (onGesture) {
        onGesture(null)
      }
    }

    ctx.restore()
  }, [detectGesture, onGesture])

  // Initialize MediaPipe Hands
  useEffect(() => {
    if (!enabled) {
      if (cameraRef.current) {
        cameraRef.current.stop()
      }
      setStatus('disabled')
      return
    }

    const initializeHandTracking = async () => {
      try {
        setStatus('initializing')

        // Initialize Hands
        const Hands = await loadMediaPipe()
        const hands = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
          }
        })

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.5
        })

        hands.onResults(onResults)
        handsRef.current = hands

        // Initialize camera using native getUserMedia (better Safari support)
        if (videoRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240 }
          })
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
          }

          cameraRef.current = stream

          // Process frames manually
          const processFrame = async () => {
            if (handsRef.current && videoRef.current && videoRef.current.readyState >= 2) {
              await handsRef.current.send({ image: videoRef.current })
            }
            if (cameraRef.current) {
              requestAnimationFrame(processFrame)
            }
          }

          videoRef.current.onplaying = () => {
            setStatus('ready')
            processFrame()
          }
        }
      } catch (error) {
        console.error('Hand tracking initialization error:', error.name, error.message, error)
        setErrorDetail(`${error.name}: ${error.message}`)
        if (error.name === 'NotAllowedError') {
          setStatus('permission_denied')
        } else if (error.name === 'NotFoundError') {
          setStatus('no_camera')
        } else {
          setStatus('error')
        }
      }
    }

    initializeHandTracking()

    return () => {
      if (cameraRef.current) {
        // Stop all tracks on the stream
        cameraRef.current.getTracks().forEach(track => track.stop())
        cameraRef.current = null
      }
      if (handsRef.current) {
        handsRef.current.close()
      }
    }
  }, [enabled, onResults])

  if (!enabled) return null

  return (
    <div className="hand-tracker">
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        playsInline
      />
      <canvas
        ref={canvasRef}
        width={320}
        height={240}
        className="hand-tracker-canvas"
      />
      <div className={`hand-tracker-status ${status}`}>
        {status === 'initializing' && 'Starting camera...'}
        {status === 'ready' && 'Ready - Show your hand'}
        {status === 'tracking' && 'Tracking'}
        {status === 'no_hand' && 'No hand detected'}
        {status === 'permission_denied' && 'Camera blocked - allow in browser settings'}
        {status === 'no_camera' && 'No camera found'}
        {status === 'error' && `Error: ${errorDetail || 'Unknown'}`}
      </div>
    </div>
  )
}
