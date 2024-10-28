import React, { useState, useEffect, useRef } from 'react';
const { ipcRenderer } = window.require('electron');

const FLICKER_THRESHOLD = 1; // 1% threshold for flicker detection

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [selectedPort, setSelectedPort] = useState('');
  const [availablePorts, setAvailablePorts] = useState([]);
  const [status, setStatus] = useState('Disconnected');
  const [sensorData, setSensorData] = useState({ sensor1: 0, sensor2: 0 });
  const [recipe, setRecipe] = useState([]);
  const [isRunningRecipe, setIsRunningRecipe] = useState(false);
  const [isFlickerDetectionRunning, setIsFlickerDetectionRunning] = useState(false);
  const [flickerCount, setFlickerCount] = useState({ sensor1: 0, sensor2: 0 });
  const [debugMessages, setDebugMessages] = useState([]);

  // Flicker detection state
  const lastValues = useRef({ sensor1: null, sensor2: null });
  const activeFlickers = useRef({ sensor1: null, sensor2: null });

  useEffect(() => {
    const fetchPorts = async () => {
      const ports = await ipcRenderer.invoke('get-ports');
      setAvailablePorts(ports);
      if (ports.length > 0) setSelectedPort(ports[0]);
    };

    fetchPorts();

    // Set up event listeners
    ipcRenderer.on('sensor-data', handleSensorData);
    ipcRenderer.on('debug-message', (event, message) => {
      setDebugMessages(prev => [...prev.slice(-100), message]);
    });

    return () => {
      ipcRenderer.removeAllListeners('sensor-data');
      ipcRenderer.removeAllListeners('debug-message');
    };
  }, []);

  const handleSensorData = (event, data) => {
    setSensorData(data);
    
    if (isFlickerDetectionRunning) {
      const timestamp = new Date().toISOString();
      
      // Process both sensors
      ['sensor1', 'sensor2'].forEach(sensorId => {
        const currentValue = data[sensorId];
        const lastValue = lastValues.current[sensorId];
        
        if (lastValue !== null) {
          const percentChange = ((lastValue - currentValue) / lastValue) * 100;
          
          // Check for start of flicker
          if (Math.abs(percentChange) > FLICKER_THRESHOLD && !activeFlickers.current[sensorId]) {
            activeFlickers.current[sensorId] = {
              startTime: timestamp,
              initialValue: lastValue,
              minValue: currentValue,
              maxPercentChange: Math.abs(percentChange)
            };
          }
          
          // Update active flicker
          if (activeFlickers.current[sensorId]) {
            const flicker = activeFlickers.current[sensorId];
            flicker.minValue = Math.min(flicker.minValue, currentValue);
            flicker.maxPercentChange = Math.max(flicker.maxPercentChange, Math.abs(percentChange));
            
            // Check for end of flicker
            const returnPercentChange = Math.abs((currentValue - flicker.initialValue) / flicker.initialValue) * 100;
            if (returnPercentChange < FLICKER_THRESHOLD) {
              const endTime = timestamp;
              const duration = (new Date(endTime) - new Date(flicker.startTime)) / 1000;
              
              // Log flicker event
              const flickerData = {
                sensor: sensorId,
                startTime: flicker.startTime,
                endTime: endTime,
                duration: duration.toFixed(3),
                initialValue: flicker.initialValue.toFixed(3),
                minimumValue: flicker.minValue.toFixed(3),
                percentChange: flicker.maxPercentChange.toFixed(2)
              };
              
              ipcRenderer.invoke('log-flicker', flickerData);
              
              // Update flicker count
              setFlickerCount(prev => ({
                ...prev,
                [sensorId]: prev[sensorId] + 1
              }));
              
              // Clear active flicker
              activeFlickers.current[sensorId] = null;
            }
          }
        }
        
        // Update last value
        lastValues.current[sensorId] = currentValue;
      });

      // Log current data state
      const logData = [
        timestamp,
        data.sensor1.toFixed(3),
        data.sensor2.toFixed(3),
        activeFlickers.current.sensor1 !== null,
        activeFlickers.current.sensor2 !== null
      ];
      
      ipcRenderer.invoke('log-data', logData);
    }
  };

  const toggleConnection = async () => {
    if (!isConnected) {
      const result = await ipcRenderer.invoke('connect-port', selectedPort);
      if (result.success) {
        setIsConnected(true);
        setStatus('Connected');
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } else {
      await ipcRenderer.invoke('disconnect-port');
      setIsConnected(false);
      setStatus('Disconnected');
      resetFlickerDetection();
    }
  };

  const resetFlickerDetection = () => {
    lastValues.current = { sensor1: null, sensor2: null };
    activeFlickers.current = { sensor1: null, sensor2: null };
    setFlickerCount({ sensor1: 0, sensor2: 0 });
  };

  const toggleFlickerDetection = async () => {
    if (!isFlickerDetectionRunning) {
      const result = await ipcRenderer.invoke('start-flicker-detection');
      if (result.success) {
        setIsFlickerDetectionRunning(true);
        setStatus('Flicker Detection Running');
        resetFlickerDetection();
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } else {
      const result = await ipcRenderer.invoke('stop-flicker-detection');
      if (result.success) {
        setIsFlickerDetectionRunning(false);
        setStatus('Flicker Detection Stopped');
      } else {
        setStatus(`Error: ${result.error}`);
      }
    }
  };

  const addRecipeStep = (step) => {
    setRecipe([...recipe, step]);
  };

  const runRecipe = async () => {
    setIsRunningRecipe(true);
      for (const step of recipe) {
      try {
        switch (step.type) {
          case 'startFlicker':
            if (!isFlickerDetectionRunning) {
              await toggleFlickerDetection();
            }
            break;
          case 'endFlicker':
            if (isFlickerDetectionRunning) {
              await toggleFlickerDetection();
            }
            break;
          case 'connectUSB':
            await ipcRenderer.invoke('send-command', 'c');
            break;
          case 'disconnectUSB':
            await ipcRenderer.invoke('send-command', 'd');
            break;
          case 'sleep':
            await ipcRenderer.invoke('send-command', 's');
            break;
          case 'wake':
            await ipcRenderer.invoke('send-command', 'w');
            break;
          case 'delay':
            await new Promise(resolve => setTimeout(resolve, step.duration * 1000));
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between steps
    } catch (error) {
        setStatus(`Recipe Error: ${error.message}`);
        break;
      }
    }
      setIsRunningRecipe(false);
  };

  return (
    <div className="container">
      <h1>Dual Sensor Flicker Monitor</h1>
      
      <div className="status-section">
        <p>Status: {status}</p>
        <select 
          value={selectedPort} 
          onChange={(e) => setSelectedPort(e.target.value)}
          disabled={isConnected}
        >
          {availablePorts.map(port => (
            <option key={port} value={port}>{port}</option>
          ))}
        </select>
        <button onClick={toggleConnection}>
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      <div className="sensors-grid">
        <div className="sensor-card">
          <div className="sensor-header">Sensor 1</div>
          <div className="sensor-value">{sensorData.sensor1.toFixed(2)}</div>
          <div className="sensor-status">
            {isFlickerDetectionRunning ? 
              (activeFlickers.current.sensor1 ? 'Flicker Detected' : 'Monitoring') : 
              'Idle'}
          </div>
          <div className="flicker-count">Flicker Count: {flickerCount.sensor1}</div>
        </div>
        <div className="sensor-card">
          <div className="sensor-header">Sensor 2</div>
          <div className="sensor-value">{sensorData.sensor2.toFixed(2)}</div>
          <div className="sensor-status">
            {isFlickerDetectionRunning ? 
              (activeFlickers.current.sensor2 ? 'Flicker Detected' : 'Monitoring') : 
              'Idle'}
          </div>
          <div className="flicker-count">Flicker Count: {flickerCount.sensor2}</div>
        </div>
      </div>

      <div className="control-section">
        <button 
          onClick={toggleFlickerDetection}
          className={isFlickerDetectionRunning ? 'stop' : 'start'}
          disabled={!isConnected}
        >
          {isFlickerDetectionRunning ? 'Stop Flicker Detection' : 'Start Flicker Detection'}
        </button>
      </div>

      <div className="recipe-builder">
        <h2>Recipe Builder</h2>
        <div className="recipe-builder-buttons">
          <button onClick={() => addRecipeStep({ type: 'startFlicker' })}>Start Flicker Detection</button>
          <button onClick={() => addRecipeStep({ type: 'endFlicker' })}>End Flicker Detection</button>
          <button onClick={() => addRecipeStep({ type: 'connectUSB' })}>Connect USB Device</button>
          <button onClick={() => addRecipeStep({ type: 'disconnectUSB' })}>Disconnect USB Device</button>
          <button onClick={() => addRecipeStep({ type: 'sleep' })}>Sleep System</button>
          <button onClick={() => addRecipeStep({ type: 'wake' })}>Wake System</button>
          <button onClick={() => addRecipeStep({ type: 'delay', duration: 5 })}>Add 5s Delay</button>
        </div>

        <div className="current-recipe">
          <h3>Current Recipe</h3>
          <ul>
            {recipe.map((step, index) => (
              <li key={index}>{step.type} {step.duration ? `(${step.duration}s)` : ''}</li>
            ))}
          </ul>
        </div>

        <button 
          onClick={runRecipe} 
          disabled={isRunningRecipe || recipe.length === 0} 
          className="secondary"
        >
          {isRunningRecipe ? 'Running Recipe...' : 'Run Recipe'}
        </button>
      </div>

      <div className="debug-panel">
        <h3>Debug Log</h3>
        <div className="debug-messages">
          {debugMessages.map((message, index) => (
            <div key={index} className="debug-message">{message}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;