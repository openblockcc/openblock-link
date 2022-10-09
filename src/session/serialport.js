const {SerialPort} = require('serialport');
const ansi = require('ansi-string');

const Session = require('./session');
const Arduino = require('../upload/arduino');
const Microbit = require('../upload/microbit');
const usbId = require('../lib/usb-id');

class SerialportSession extends Session {
    constructor (socket, userDataPath, toolsPath) {
        super(socket);

        this.userDataPath = userDataPath;
        this.toolsPath = toolsPath;

        this._type = 'serialport';
        this.peripheral = null;
        this.peripheralParams = null;
        this.services = null;
        this.reportedPeripherals = {};
        this.connectStateDetectorTimer = null;
        this.peripheralsScanorTimer = null;
        this.isRead = false;
        this.isInDisconnect = false;
    }

    async didReceiveCall (method, params, completion) {
        switch (method) {
        case 'discover':
            this.discover(params);
            completion(null, null);
            break;
        case 'connect':
            await this.connect(params);
            completion(null, null);
            break;
        case 'disconnect':
            await this.disconnect();
            completion(null, null);
            break;
        case 'updateBaudrate':
            completion(await this.updateBaudrate(params), null);
            break;
        case 'write':
            completion(await this.write(params), null);
            break;
        case 'read':
            await this.read(params);
            completion(null, null);
            break;
        case 'upload':
            completion(await this.upload(params), null);
            break;
        case 'uploadFirmware':
            completion(await this.uploadFirmware(params), null);
            break;
        case 'getServices':
            completion((this.services || []).map(service => service.uuid), null);
            break;
        case 'pingMe':
            completion('willPing', null);
            this.sendRemoteRequest('ping', null, result => {
                console.log(`Got result from ping: ${result}`);
            });
            break;
        default:
            throw new Error(`Method not found`);
        }
    }

    discover (params) {
        if (this.services) {
            throw new Error('cannot discover when connected');
        }
        const {filters} = params;
        if (!Array.isArray(filters.pnpid) || filters.pnpid.length < 1) {
            throw new Error('discovery request must include filters');
        }
        this.reportedPeripherals = {};

        this.peripheralsScanorTimer = setInterval(() => {
            SerialPort.list().then(peripheral => {
                this.onAdvertisementReceived(peripheral, filters);
            });
        }, 100);
    }

    onAdvertisementReceived (peripheral, filters) {
        if (peripheral) {
            peripheral.forEach(device => {
                const vendorId = String(device.vendorId).toUpperCase();
                const productId = String(device.productId).toUpperCase();
                const pnpid = `USB\\VID_${vendorId}&PID_${productId}`;

                const name = usbId[pnpid] ? usbId[pnpid] : 'Unknown device';

                if (filters.pnpid.includes('*')) {
                    this.reportedPeripherals[device.path] = device;
                    this.sendRemoteRequest('didDiscoverPeripheral', {
                        peripheralId: device.path,
                        name: `${name} (${device.path})`
                    });
                } else if (filters.pnpid.includes(pnpid)) {
                    this.reportedPeripherals[device.path] = device;
                    this.sendRemoteRequest('didDiscoverPeripheral', {
                        peripheralId: device.path,
                        name: `${name} (${device.path})`
                    });
                }
            });
        }
    }

    connect (params, isConnectAfterUpload = false) {
        return new Promise((resolve, reject) => {
            if (this.peripheral && this.peripheral.isOpen === true) {
                return reject(new Error('already connected to peripheral'));
            }
            const {peripheralId, peripheralConfig} = params;

            const peripheral = this.reportedPeripherals[peripheralId];
            if (!peripheral) {
                return reject(new Error(`invalid peripheral ID: ${peripheralId}`));
            }
            if (this.peripheralsScanorTimer) {
                clearInterval(this.peripheralsScanorTimer);
                this.peripheralsScanorTimer = null;
            }
            const port = new SerialPort({
                path: peripheral.path,
                baudRate: peripheralConfig.config.baudRate,
                dataBits: peripheralConfig.config.dataBits,
                stopBits: peripheralConfig.config.stopBits,
                autoOpen: false
            });
            const rts = (typeof peripheralConfig.config.rts === 'undefined') ? true : peripheralConfig.config.rts;
            const dtr = (typeof peripheralConfig.config.dtr === 'undefined') ? true : peripheralConfig.config.dtr;

            try {
                port.open(openErr => {
                    if (openErr) {
                        if (isConnectAfterUpload === true) {
                            this.sendRemoteRequest('peripheralUnplug', null);
                        }
                        return reject(new Error(openErr));
                    }

                    port.set({rts: rts, dtr: dtr}, setErr => {
                        if (setErr) {
                            if (isConnectAfterUpload === true) {
                                this.sendRemoteRequest('peripheralUnplug', null);
                            }
                            return reject(new Error(setErr));
                        }

                        this.peripheral = port;
                        this.peripheralParams = params;

                        // Scan COM status prevent device pulled out
                        this.connectStateDetectorTimer = setInterval(() => {
                            if (this.peripheral.isOpen === false) {
                                clearInterval(this.connectStateDetectorTimer);
                                this.disconnect();
                                this.sendRemoteRequest('peripheralUnplug', null);
                            }
                        }, 10);

                        // Only when the receiver function is set, can isopen detect that the device is pulled out
                        // A strange features of npm serialport package
                        port.on('data', rev => {
                            this.onMessageCallback(rev);
                        });

                        port.on('error', error => {
                            console.log('OpenBlock Link Error:', error);
                            this.disconnect();
                            this.sendRemoteRequest('peripheralUnplug', null);
                        });

                        resolve();
                    });
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    onMessageCallback (rev) {
        const params = {
            encoding: 'base64',
            message: rev.toString('base64')
        };
        if (this.isRead) {
            this.sendRemoteRequest('onMessage', params);
        }
    }

    updateBaudrate (params) {
        return new Promise((resolve, reject) => {
            if (!this.isInDisconnect) {
                this.peripheralParams.peripheralConfig.config.baudRate = params.baudRate;
                this.peripheral.update(params, err => {
                    if (err) {
                        return reject(new Error(`Error while attempting to update baudrate: ${err.message}`));
                    }

                    const rts = (typeof this.peripheralParams.peripheralConfig.config.rts === 'undefined') ?
                        true : this.peripheralParams.peripheralConfig.config.rts;
                    const dtr = (typeof this.peripheralParams.peripheralConfig.config.dtr === 'undefined') ?
                        true : this.peripheralParams.peripheralConfig.config.dtr;

                    // After update baudrate, the rts and dtr will be automatically modified,
                    // we have to set them again.
                    this.peripheral.set({rts: rts, dtr: dtr}, setErr => {
                        if (setErr) {
                            this.sendRemoteRequest('peripheralUnplug', null);
                            return reject(new Error(setErr));
                        }
                        return resolve();
                    });
                });
            }
        });
    }

    write (params) {
        return new Promise((resolve, reject) => {
            const {message, encoding} = params;
            const buffer = new Buffer.from(message, encoding);

            try {
                if (!this.isInDisconnect) {
                    this.peripheral.write(buffer, 'binary', err => {
                        if (err) {
                            return reject(new Error(`Error while attempting to write: ${err.message}`));
                        }
                    });
                    this.peripheral.drain(() => resolve(buffer.length));
                }
                return resolve();
            } catch (err) {
                return reject(err);
            }
        });
    }

    read () {
        this.isRead = true;
    }

    disconnect () {
        this.isInDisconnect = true;
        return new Promise((resolve, reject) => {
            if (this.peripheral && this.peripheral.isOpen === true) {
                if (this.connectStateDetectorTimer) {
                    clearInterval(this.connectStateDetectorTimer);
                    this.connectStateDetectorTimer = null;
                }
                const peripheral = this.peripheral;
                try {
                    peripheral.pause();
                    // clear all cache data
                    peripheral.flush(() => {
                        peripheral.close(error => {
                            if (error) {
                                this.isInDisconnect = false;
                                return reject(Error(error));
                            }
                            this.isInDisconnect = false;
                            return resolve();
                        });
                    });
                } catch (err) {
                    this.isInDisconnect = false;
                    return reject(err);
                }
            }
        });
    }

    async upload (params) {
        const {message, config, encoding, library} = params;
        const code = new Buffer.from(message, encoding).toString();
        let tool;

        const {baudRate} = this.peripheralParams.peripheralConfig.config;

        switch (config.type) {
        case 'arduino':
            tool = new Arduino(this.peripheral.path, config, this.userDataPath,
                this.toolsPath, this.sendstd.bind(this));

            try {
                const exitCode = await tool.build(code, library);
                if (exitCode === 'Success') {
                    try {
                        this.sendstd(`${ansi.clear}Disconnect serial port\n`);
                        await this.disconnect();
                        this.sendstd(`${ansi.clear}Disconnected successfully, flash program starting...\n`);
                        await tool.flash();
                        await this.connect(this.peripheralParams, true);
                        this.sendRemoteRequest('uploadSuccess', null);
                    } catch (err) {
                        this.sendRemoteRequest('uploadError', {
                            message: ansi.red + err.message
                        });
                        // if error in flash step. It is considered that the device has been removed.
                        this.sendRemoteRequest('peripheralUnplug', null);
                    }
                }
            } catch (err) {
                this.sendRemoteRequest('uploadError', {
                    message: ansi.red + err.message
                });
            }
            break;
        case 'microbit':
            tool = new Microbit(this.peripheral.path, config, this.userDataPath,
                this.toolsPath, this.sendstd.bind(this));
            try {
                await this.disconnect();
                await tool.flash(code, library);
                await this.connect(this.peripheralParams, true);
                await this.updateBaudrate({baudRate: 115200});
                this.sendstd(`${ansi.clear}Reset device\n`);
                await this.write({message: '04', encoding: 'hex'});
                await this.updateBaudrate({baudRate: baudRate});

                this.sendRemoteRequest('uploadSuccess', null);
            } catch (err) {
                this.sendRemoteRequest('uploadError', {
                    message: ansi.red + err
                });
                this.sendRemoteRequest('peripheralUnplug', null);
            }
            break;
        }
    }

    async uploadFirmware (params) {
        let tool;

        switch (params.type) {
        case 'arduino':
            tool = new Arduino(this.peripheral.path, params, this.userDataPath,
                this.toolsPath, this.sendstd.bind(this));
            try {
                this.sendstd(`${ansi.clear}Disconnect serial port\n`);
                await this.disconnect();
                this.sendstd(`${ansi.clear}Disconnected successfully, flash program starting...\n`);
                await tool.flashRealtimeFirmware();
                await this.connect(this.peripheralParams, true);
                this.sendRemoteRequest('uploadSuccess', null);
            } catch (err) {
                this.sendRemoteRequest('uploadError', {
                    message: ansi.red + err.message
                });
            }
            break;
        }
    }

    sendstd (message) {
        if (this._socket) {
            this.sendRemoteRequest('uploadStdout', {
                message: message
            });
        }
    }

    dispose () {
        this.disconnect();
        super.dispose();
        this.socket = null;
        this.peripheral = null;
        this.peripheralParams = null;
        this.services = null;
        this.reportedPeripherals = {};
        if (this.connectStateDetectorTimer) {
            clearInterval(this.connectStateDetectorTimer);
            this.connectStateDetectorTimer = null;
        }
        if (this.peripheralsScanorTimer) {
            clearInterval(this.peripheralsScanorTimer);
            this.peripheralsScanorTimer = null;
        }
    }
}

module.exports = SerialportSession;
