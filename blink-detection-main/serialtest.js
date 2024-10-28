const DeviceSerialPort = require('./serialport');

// Utility function to add timeout to promises
function timeoutPromise(promise, ms, operationName) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Operation '${operationName}' timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([
        promise,
        timeoutPromise
    ]).finally(() => clearTimeout(timeoutHandle));
}

async function testSerialCommands() {
    const device = new DeviceSerialPort();
    
    try {
        // Test 1: Initialize and select port
        console.log('Test 1: Initializing device and selecting port...');
        await device.initialize();
        console.log('✓ Device initialized successfully');
        console.log(`Connected to port: ${device.portPath}\n`);

        // Ask if user wants to try a different port
        const answer = await device.getUserConfirmation(
            'Would you like to try a different port? (y/n): '
        );
        
        if (answer === 'y') {
            console.log('\nChanging port...');
            await device.changePort();
            console.log('✓ Port changed successfully\n');
        }

        // Test 2: Read Sensor with detailed logging
        console.log('Test 2: Testing sensor reading...');
        console.log('  Sending sensor read command...');
        
        try {
            const reading = await timeoutPromise(
                device.ReadSensor(),
                5000,  // 5 second timeout
                'Sensor Reading'
            );
            console.log('  ✓ Sensor reading received:', reading);
            console.log('    value1:', reading.value1);
            console.log('    value2:', reading.value2, '\n');
        } catch (error) {
            console.log('  ❌ Error reading sensor:', error.message);
            console.log('  Attempting to continue with remaining tests...\n');
        }

        // Test 3: Magnet Control
        console.log('Test 3: Testing magnet control...');
        try {
            console.log('  Turning magnet ON');
            await device.MagnetOn();
            console.log('  ✓ Magnet ON command sent');
            
            // Increased delay between commands
            console.log('  Waiting 3 seconds...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log('  Turning magnet OFF');
            await device.MagnetOff();
            console.log('  ✓ Magnet OFF command sent');
            
            // Add delay after magnet control
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('✓ Magnet control test complete\n');
        } catch (error) {
            console.log('  ❌ Error during magnet control:', error.message);
            console.log('  Attempting to continue with remaining tests...\n');
        }

        // Add delay before AC control
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Test 4: AC Control
        console.log('Test 4: Testing AC control...');
        try {
            console.log('  Turning AC ON');
            await device.ACOn();
            console.log('  ✓ AC ON command sent');
            
            // Increased delay between commands
            console.log('  Waiting 3 seconds...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            console.log('  Turning AC OFF');
            await device.ACOff();
            console.log('  ✓ AC OFF command sent');
            
            // Add delay after AC control
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('✓ AC control test complete\n');
        } catch (error) {
            console.log('  ❌ Error during AC control:', error.message);
            console.log('  Attempting to continue with remaining tests...\n');
        }

        // Cleanup
        console.log('Cleaning up...');
        await device.close();
        console.log('✓ Device closed successfully');
        
        console.log('\nTests completed. Check above for any errors.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        try {
            await device.close();
        } catch (closeError) {
            console.error('Error while closing device:', closeError.message);
        }
        process.exit(1);
    }
}

// Run the tests
console.log('Starting Serial Port Command Tests...\n');
testSerialCommands().catch(error => {
    console.error('Unhandled error:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
});
