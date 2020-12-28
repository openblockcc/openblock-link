const SerialPort = require('serialport');
const Session = require('./session');
const Arduino = require('../upload/arduino');
const ansi = require('ansi-string');
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
            await this.disconnect(params);
            completion(null, null);
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
            this.sendRemoteRequest('ping', null, (result, error) => {
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

    searchByKey (map, route) {
        return map[route] ? map[route] : null;
    }

    onAdvertisementReceived (peripheral, filters) {
        if (peripheral) {
            peripheral.forEach(device => {
                const pnpid = device.pnpId.substring(0, 21);

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

    connect (params, afterUpload = null) {
        return new Promise((resolve, reject) => {
            if (this.peripheral && this.peripheral.isOpen === true) {
                return reject(new Error('already connected to peripheral'));
            }
            const {peripheralId} = params;
            const {peripheralConfig} = params;
            const peripheral = this.reportedPeripherals[peripheralId];
            if (!peripheral) {
                return reject(new Error(`invalid peripheral ID: ${peripheralId}`));
            }
            if (this.peripheralsScanorTimer) {
                clearInterval(this.peripheralsScanorTimer);
                this.peripheralsScanorTimer = null;
            }
            const port = new SerialPort(peripheral.path, {
                baudRate: peripheralConfig.config.baudRate,
                dataBits: peripheralConfig.config.dataBits,
                stopBits: peripheralConfig.config.stopBits,
                autoOpen: false
            });
            try {
                port.open(error => {
                    if (error) {
                        if (afterUpload === true) {
                            this.sendRemoteRequest('peripheralUnplug', {});
                        }
                        return reject(new Error(error));
                    }

                    this.peripheral = port;
                    this.peripheralParams = params;

                    // Scan COM status prevent device pulled out
                    this.connectStateDetectorTimer = setInterval(() => {
                        if (this.peripheral.isOpen === false) {
                            clearInterval(this.connectStateDetectorTimer);
                            this.disconnect();
                            this.sendRemoteRequest('peripheralUnplug', {});
                        }
                    }, 10);

                    // Only when the receiver function is set, can isopen detect that the device is pulled out
                    // A strange features of npm serialport package
                    port.on('data', rev => {
                        this.onMessageCallback(rev);
                    });

                    resolve();
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

    async write (params) {
        const {message, encoding} = params;
        const buffer = new Buffer.from(message, encoding);

        this.peripheral.write(buffer, 'Buffer', err => {
            if (err) {
                return new Error(`Error while attempting to write: ${err.message}`);
            }
            return buffer.length;

        });
    }

    read () {
        this.isRead = true;
    }

    disconnect () {
        if (this.peripheral && this.peripheral.isOpen === true) {
            if (this.connectStateDetectorTimer) {
                clearInterval(this.connectStateDetectorTimer);
                this.connectStateDetectorTimer = null;
            }
            this.peripheral.close(error => {
                if (error) {
                    return new Error(error);
                }
            });
        }
    }
    async upload (params) {
        const {message, config, encoding} = params;
        const code = new Buffer.from(message, encoding).toString();
        let tool;

        switch (config.type) {
        case 'arduino':
            tool = new Arduino(this.peripheral.path, config, this.userDataPath,
                this.toolsPath, this.sendstd.bind(this));

            try {
                const exitCode = await tool.build(code);
                if (exitCode === 'Success') {
                    this.disconnect();
                    await tool.flash();
                    await this.connect(this.peripheralParams, true);
                    this.sendRemoteRequest('uploadSuccess', {});
                }
            } catch (err) {
                this.sendRemoteRequest('uploadError', {
                    message: ansi.red + err.message
                });
            }
            break;
        case 'microbit':
            // todo: for Microbit
            break;
        }
    }

    async uploadFirmware (params) {
        // console.log(params);
        let tool;

        switch (params.type) {
        case 'arduino':
            tool = new Arduino(this.peripheral.path, params, this.userDataPath,
                this.toolsPath, this.sendstd.bind(this));
            try {
                this.disconnect();
                await tool.flashRealtimeFirmware();
                await this.connect(this.peripheralParams, true);
                this.sendRemoteRequest('uploadSuccess', {});
            } catch (err) {
                this.sendRemoteRequest('uploadError', {
                    message: ansi.red + err.message
                });
            }
            break;
        }
    }

    sendstd (message) {
        this.sendRemoteRequest('uploadStdout', {
            message: message
        });
    }

    dispose () {
        this.disconnect();
        super.dispose();
        this.socket = null;
        this.peripheral = null;
        this.peripheralParams = null;
        this.services = null;
        this.reportedPeripherals = null;
        if (this.connectStateDetectorTimer) {
            clearInterval(this.connectStateDetectorTimer);
            this.connectStateDetectorTimer = null;
        }
        if (this.peripheralsScanorTimer) {
            clearInterval(this.peripheralsScanorTimer);
            this.peripheralsScanorTimer = null;
        }
        this.isRead = false;
    }
}

module.exports = SerialportSession;
