const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const SerialPort = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');

let mainWindow;
let serialPort;
let parser;
let dataInterval;
let sensorLogFile;
let flickerLogFile;
let isFlickerDetectionActive = false;

// Debug logging function
function debug(message, ...args) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage, ...args);
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-message', logMessage);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('dist/index.html');
}

// Single send-command handler
ipcMain.handle('send-command', async (event, command) => {
  try {
    if (!serialPort || !serialPort.isOpen) {
      throw new Error('Serial port is not open');
    }

    // Clear the data interval temporarily
    if (dataInterval) {
      clearInterval(dataInterval);
    }

    // Send the command
    await new Promise((resolve, reject) => {
      serialPort.write(command + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Restart the data interval if it was cleared
    if (dataInterval) {
      dataInterval = setInterval(() => {
        if (serialPort && serialPort.isOpen) {
          serialPort.write('s\n', (err) => {
            if (err) {
              debug('Error writing to port:', err.message);
            }
          });
        }
      }, 100);
    }

    debug('Command sent:', command);
    return { success: true };
  } catch (error) {
    debug('Error sending command:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-ports', async () => {
  try {
    const ports = await SerialPort.SerialPort.list();
    debug('Available ports:', ports);
    return ports.map(port => port.path);
  } catch (error) {
    debug('Error listing ports:', error);
    return [];
  }
});

ipcMain.handle('connect-port', async (event, portName) => {
  try {
    if (serialPort && serialPort.isOpen) {
      await new Promise(resolve => serialPort.close(resolve));
    }

    serialPort = new SerialPort.SerialPort({
      path: portName,
      baudRate: 115200,
    });

    parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (data) => {
      try {
        const [sensor1, sensor2] = data.split(',').map(Number);
        if (!isNaN(sensor1) && !isNaN(sensor2)) {
          debug(`Received sensor data: ${sensor1}, ${sensor2}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sensor-data', { sensor1, sensor2 });
          }
        }
      } catch (error) {
        debug('Error parsing sensor data:', error);
      }
    });

    await new Promise((resolve, reject) => {
      serialPort.on('open', resolve);
      serialPort.on('error', reject);
    });

    dataInterval = setInterval(() => {
      if (serialPort && serialPort.isOpen) {
        serialPort.write('s\n', (err) => {
          if (err) debug('Error writing to port:', err);
        });
      }
    }, 100);

    debug('Port connected:', portName);
    return { success: true };
  } catch (error) {
    debug('Error connecting to port:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-flicker-detection', async () => {
  try {
    if (!serialPort || !serialPort.isOpen) {
      throw new Error('Serial port is not connected');
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const logDir = path.join(app.getPath('userData'), 'logs');
    sensorLogFile = path.join(logDir, `sensor_log_${timestamp}.csv`);
    flickerLogFile = path.join(logDir, `flicker_events_${timestamp}.csv`);

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    fs.writeFileSync(sensorLogFile, 'Time,Sensor1,Sensor2,Active_Flicker_S1,Active_Flicker_S2\n');
    fs.writeFileSync(flickerLogFile, 'Sensor,Start Time,End Time,Duration (seconds),Initial Value,Minimum Value,Percent Change\n');

    isFlickerDetectionActive = true;
    debug('Flicker detection started');
    return { success: true, sensorLogFile, flickerLogFile };
  } catch (error) {
    debug('Error starting flicker detection:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-flicker-detection', async () => {
  try {
    isFlickerDetectionActive = false;
    debug('Flicker detection stopped');
    return { success: true };
  } catch (error) {
    debug('Error stopping flicker detection:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect-port', async () => {
  try {
    if (dataInterval) {
      clearInterval(dataInterval);
    }
    
    if (parser) {
      parser.removeAllListeners('data');
    }
    
    if (serialPort && serialPort.isOpen) {
      debug('Disconnecting port');
      await new Promise(resolve => serialPort.close(resolve));
      debug('Port disconnected');
    }

    isFlickerDetectionActive = false;
    return { success: true };
  } catch (error) {
    debug('Error disconnecting port:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log-data', async (event, data) => {
  try {
    if (!sensorLogFile || !isFlickerDetectionActive) return { success: false };
    fs.appendFileSync(sensorLogFile, `${data.join(',')}\n`);
    return { success: true };
  } catch (error) {
    debug('Error logging data:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log-flicker', async (event, data) => {
  try {
    if (!flickerLogFile || !isFlickerDetectionActive) return { success: false };
    fs.appendFileSync(flickerLogFile, `${Object.values(data).join(',')}\n`);
    return { success: true };
  } catch (error) {
    debug('Error logging flicker:', error);
    return { success: false, error: error.message };
  }
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('uncaughtException', (error) => {
  debug('Uncaught exception:', error);
});

app.on('before-quit', async () => {
  if (dataInterval) {
    clearInterval(dataInterval);
  }
  if (parser) {
    parser.removeAllListeners('data');
  }
  if (serialPort && serialPort.isOpen) {
    await new Promise(resolve => serialPort.close(resolve));
  }
});