const { SerialPort } = require('serialport');
const { SerialPortStream } = require('@serialport/stream');
const { autoDetect } = require('@serialport/bindings-cpp');
const EventEmitter = require('events');
const readline = require('readline');

class DeviceSerialPort extends EventEmitter {
    constructor(baudRate = 9600) {
        super();
        this.baudRate = baudRate;
        this.port = null;
        this.portPath = null;
        this.isBusy = false;
        this.lastCommand = null;
        this.debugMode = true; // Enable debug logging
    }

    debug(message) {
        if (this.debugMode) {
            console.log(`[DEBUG] ${message}`);
        }
    }

    createInterface() {
        return readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async getUserConfirmation(question) {
        const rl = this.createInterface();
        try {
            const answer = await new Promise(resolve => {
                rl.question(question, resolve);
            });
            return answer.toLowerCase();
        } finally {
            rl.close();
        }
    }

    async selectPort() {
        try {
            const ports = await SerialPort.list();
            this.debug(`Found ${ports.length} ports`);
            
            if (ports.length === 0) {
                throw new Error('No serial ports found');
            }

            console.log('\nAvailable ports:');
            ports.forEach((port, index) => {
                console.log(`[${index + 1}] Path: ${port.path}`);
                if (port.manufacturer) console.log(`    Manufacturer: ${port.manufacturer}`);
                if (port.serialNumber) console.log(`    Serial Number: ${port.serialNumber}`);
                if (port.vendorId) console.log(`    Vendor ID: ${port.vendorId}`);
                if (port.productId) console.log(`    Product ID: ${port.productId}`);
                console.log('---');
            });

            const rl = this.createInterface();
            
            while (true) {
                const portNumber = await new Promise(resolve => {
                    rl.question('\nSelect port number (1-' + ports.length + '): ', resolve);
                });

                const index = parseInt(portNumber) - 1;
                if (index >= 0 && index < ports.length) {
                    const selectedPort = ports[index];
                    this.debug(`Selected port: ${selectedPort.path}`);
                    
                    const confirm = await new Promise(resolve => {
                        rl.question('Is this the correct port? (y/n): ', resolve);
                    });

                    if (confirm.toLowerCase() === 'y') {
                        rl.close();
                        return selectedPort.path;
                    }
                } else {
                    console.log('Invalid selection, please try again');
                }
            }
        } catch (error) {
            console.error('Error listing ports:', error);
            throw error;
        }
    }

    async initialize() {
        try {
            this.portPath = await this.selectPort();
            
            this.debug(`Initializing port ${this.portPath} with baud rate ${this.baudRate}`);
            
            this.port = new SerialPort({
                path: this.portPath,
                baudRate: this.baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: 'none',
                autoOpen: false,
                rtscts: true,  // Enable hardware flow control
            });

            await this.openPort();
            this.setupDataListener();
            console.log('Serial port initialized successfully');
        } catch (error) {
            console.error('Failed to initialize serial port:', error);
            throw error;
        }
    }

    async openPort() {
        return new Promise((resolve, reject) => {
            this.port.open((error) => {
                if (error) {
                    this.debug(`Failed to open port: ${error.message}`);
                    reject(new Error(`Failed to open port ${this.portPath}: ${error.message}`));
                } else {
                    this.debug('Port opened successfully');
                    
                    // Set up error handlers
                    this.port.on('error', (err) => {
                        this.debug(`Port error: ${err.message}`);
                    });

                    // Monitor port status
                    this.port.on('open', () => this.debug('Port opened'));
                    this.port.on('close', () => this.debug('Port closed'));
                    this.port.on('drain', () => this.debug('Port drain'));

                    console.log(`Successfully opened port ${this.portPath}`);
                    resolve();
                }
            });
        });
    }

    setupDataListener() {
        let buffer = '';
        this.port.on('data', (data) => {
            const received = data.toString();
            this.debug(`Raw data received: ${received.replace(/[\r\n]/g, '<CR>')}`);
            
            buffer += received;
            const messages = buffer.split('\n');
            buffer = messages.pop();
            
            for (const message of messages) {
                this.processResponse(message.trim());
            }
        });

        this.port.on('error', (error) => {
            this.debug(`Serial port error: ${error.message}`);
            console.error('Serial port error:', error);
            this.emit('error', error);
        });
    }

    processResponse(response) {
        if (!response) return;
        this.debug(`Processing response: ${response}`);

        // Reset busy state when processing response
        this.isBusy = false;

        // Updated regex to handle space after comma
        const matches = response.match(/^(\d+\.\d+),\s*(\d+\.\d+)$/);
        if (matches) {
            const data = {
                value1: parseFloat(matches[1]),
                value2: parseFloat(matches[2])
            };
            this.debug(`Valid sensor data received: ${JSON.stringify(data)}`);
            this.emit('data', data);
            this.emit('response', response); // Emit response for all valid data
        } else {
            this.debug(`Generic response received: ${response}`);
            this.emit('response', response);
        }
    }

    async changePort() {
        if (this.port && this.port.isOpen) {
            await this.close();
        }
        await this.initialize();
    }

    async sendCommand(command) {
        this.debug(`Attempting to send command: ${command}`);
        
        // Add timeout for busy wait
        let busyWaitTime = 0;
        const MAX_BUSY_WAIT = 1000; // 1 second maximum wait
        
        while (this.isBusy) {
            this.debug('Port busy, waiting...');
            await new Promise(resolve => setTimeout(resolve, 10));
            busyWaitTime += 10;
            
            if (busyWaitTime >= MAX_BUSY_WAIT) {
                this.debug('Busy wait timeout - forcing reset of busy state');
                this.isBusy = false;
                break;
            }
        }
        
        this.isBusy = true;
        
        return new Promise((resolve, reject) => {
            this.port.write(command + '\n', (error) => {
                if (error) {
                    this.debug(`Failed to send command: ${error.message}`);
                    this.isBusy = false;
                    reject(new Error(`Failed to send command: ${error.message}`));
                    return;
                }
                this.debug(`Command "${command}" sent successfully`);
                
                // Set a timeout to reset busy state if no response
                setTimeout(() => {
                    if (this.isBusy) {
                        this.debug('Resetting busy state after timeout');
                        this.isBusy = false;
                    }
                }, 100); // 100ms timeout for busy state
                
                resolve();
            });
        });
    }

    async ReadSensor() {
        this.debug('Beginning sensor read operation...');
        try {
            await this.sendCommand('s');
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.debug('Sensor read timeout');
                    this.isBusy = false;
                    reject(new Error('Sensor read timeout'));
                }, 5000);

                const handleResponse = (data) => {
                    this.debug(`Sensor response received: ${data}`);
                    clearTimeout(timeout);
                    
                    // Parse the response
                    const matches = data.match(/^(\d+\.\d+),\s*(\d+\.\d+)$/);
                    if (matches) {
                        resolve({
                            value1: parseFloat(matches[1]),
                            value2: parseFloat(matches[2])
                        });
                    } else {
                        reject(new Error('Invalid sensor data format'));
                    }
                };

                const handleError = (error) => {
                    this.debug(`Error during sensor read: ${error.message}`);
                    clearTimeout(timeout);
                    reject(error);
                };

                this.once('response', handleResponse);
                this.once('error', handleError);

                // Clean up listeners if timeout occurs
                timeout.unref();
            });
        } catch (error) {
            this.debug(`Error in ReadSensor: ${error.message}`);
            throw error;
        }
    }

    async MagnetOn() {
        this.debug('Sending Magnet ON command');
        try {
            await this.sendCommand('b');
            this.debug('Magnet ON command sent successfully');
            // Ensure busy state is reset
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async MagnetOff() {
        this.debug('Sending Magnet OFF command');
        try {
            await this.sendCommand('m');
            this.debug('Magnet OFF command sent successfully');
            // Ensure busy state is reset
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async ACOn() {
        this.debug('Sending AC ON command');
        try {
            await this.sendCommand('c');
            this.debug('AC ON command sent successfully');
            // Ensure busy state is reset
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async ACOff() {
        this.debug('Sending AC OFF command');
        try {
            await this.sendCommand('d');
            this.debug('AC OFF command sent successfully');
            // Ensure busy state is reset
            this.isBusy = false;
        } catch (error) {
            this.isBusy = false;
            throw error;
        }
    }

    async close() {
        if (this.port?.isOpen) {
            this.debug('Closing port...');
            return new Promise((resolve, reject) => {
                this.port.close((error) => {
                    if (error) {
                        this.debug(`Error closing port: ${error.message}`);
                        reject(error);
                    } else {
                        this.debug('Port closed successfully');
                        resolve();
                    }
                });
            });
        }
    }
}

module.exports = DeviceSerialPort;
