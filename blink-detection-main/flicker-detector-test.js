const FlickerDetector = require('./flicker-detector');
const fs = require('fs');
const path = require('path');

async function runFlickerTest(duration = 30000) {
    const detector1 = new FlickerDetector(); // For sensor 1
    const detector2 = new FlickerDetector(); // For sensor 2
    let isRunning = true;
    
    // Setup logging
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logsDir, `flicker_events_${timestamp}.log`);

    // Initialize log file with header
    fs.writeFileSync(logFile, '=== Flicker Event Log ===\n');
    fs.appendFileSync(logFile, `Test started: ${new Date().toISOString()}\n`);
    fs.appendFileSync(logFile, `Detection threshold: ${detector1.threshold}\n\n`);

    // Function to log flicker events
    function logFlickerEvent(sensorValue, sensorNumber) {
        const eventTime = new Date().toISOString();
        const message = `[${eventTime}] Flicker detected by sensor ${sensorNumber} (value: ${sensorValue.toFixed(3)})`;
        console.log(message);
        fs.appendFileSync(logFile, message + '\n');
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nTest interrupted by user');
        isRunning = false;
    });

    try {
        // Initialize device connection (only need to do this once)
        await detector1.initialize();
        console.log('Starting flicker detection...\n');
        
        const startTime = Date.now();
        
        // Main detection loop
        while (isRunning && (Date.now() - startTime) < duration) {
            try {
                const reading = await detector1.device.ReadSensor();

                // Check sensor 1
                if (detector1.detectStateChange(reading.value1)) {
                    if (detector1.isOn && !detector1.wasOn) {
                        logFlickerEvent(reading.value1, 1);
                        detector1.blinkCount++;
                    }
                    detector1.wasOn = detector1.isOn;
                }

                // Check sensor 2
                if (detector2.detectStateChange(reading.value2)) {
                    if (detector2.isOn && !detector2.wasOn) {
                        logFlickerEvent(reading.value2, 2);
                        detector2.blinkCount++;
                    }
                    detector2.wasOn = detector2.isOn;
                }

                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (error) {
                console.error(`Sensor read error: ${error.message}`);
            }
        }

        // Log summary
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const summary = [
            `\nTest completed after ${totalTime} seconds`,
            `Sensor 1 flicker events: ${detector1.blinkCount}`,
            `Sensor 2 flicker events: ${detector2.blinkCount}`,
            `Sensor 1 average rate: ${(detector1.blinkCount / totalTime).toFixed(2)} events/sec`,
            `Sensor 2 average rate: ${(detector2.blinkCount / totalTime).toFixed(2)} events/sec\n`
        ].join('\n');
        
        console.log(summary);
        fs.appendFileSync(logFile, summary);

    } catch (error) {
        console.error('Test failed:', error.message);
        fs.appendFileSync(logFile, `\nTest failed: ${error.message}\n`);
    } finally {
        await detector1.cleanup();
    }
}

// Run test with optional duration from command line
const testDuration = process.argv[2] ? parseInt(process.argv[2]) * 1000 : 30000;

console.log('Starting Flicker Detection Test');
console.log('Press Ctrl+C to stop the test early\n');

runFlickerTest(testDuration).catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});