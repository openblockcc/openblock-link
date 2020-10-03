const SerialPort = require('serialport');
const Session = require('./session');

const getUUID = id => {
    if (typeof id === 'number') return id.toString(16);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
        return id.split('-').join('');
    }
    return id;
};

class SerialportSession extends Session {
    constructor (socket) {
        super(socket);
        this._type = 'serialport';
        this.peripheral = null;
        this.services = null;
        this.characteristics = {};
        this.notifyCharacteristics = {};
        this.scanningTimeId = null;
        this.reportedPeripherals = {};
        this.connectStateDetectorTimer = null;
        this.peripheralsScanorTimer = null;
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
                this.repairNotifyAfterWrite();
                break;
            case 'read':
                completion(await this.read(params), null);
            case 'startNotifications':
                await this.startNotifications(params);
                completion(null, null);
                break;
            case 'stopNotifications':
                await this.stopNotifications(params);
                completion(null, null);
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
        const { filters } = params;
        if (!Array.isArray(filters.id) || filters.id.length < 1) {
            throw new Error('discovery request must include filters');
        }
        this.reportedPeripherals = {};

        this.peripheralsScanorTimer = setInterval(function () {

            SerialPort.list().then(peripheral => {
                this.onAdvertisementReceived(peripheral, filters);
            })
        }.bind(this), 1000);
    }

    onAdvertisementReceived(peripheral, filters) {
        if (peripheral != null) {
            peripheral.forEach((device) => {
                    let pnpid = device.pnpId.substring(0, 21);         
                    
                    if (filters.id.includes(pnpid)) { 
                        let name;
    
                        if (pnpid == 'USB\\VID_1A86&PID_7523') {
                            name = 'USB-SERIAL CH340'
                        }
    
                        this.reportedPeripherals[device.path] = device;
                        this.sendRemoteRequest('didDiscoverPeripheral', {
                            peripheralId: device.path,
                            name: name + ' (' + device.path + ')',
                        });
                }
            })
        }
    }

    connect(params) {
        return new Promise((resolve, reject) => {
            if (this.peripheral && this.port.isOpen == true) {
                return reject(new Error('already connected to peripheral'));
            }
            const {peripheralId} = params;
            const peripheral = this.reportedPeripherals[peripheralId];
            if (!peripheral) {
                return reject(new Error(`invalid peripheral ID: ${peripheralId}`));
            }
            if (this.peripheralsScanorTimer) {
                clearInterval(this.peripheralsScanorTimer);
                this.peripheralsScanorTimer == null;
            }
            const port = new SerialPort(peripheral.path, {
                baudRate: 115200,
                dataBits: 8,
                stopBits: 1,
                autoOpen: false
            });
            try {
                port.open(error => {
                    if (error) {
                        return reject(new Error(error));
                    }
                    
                    this.peripheral = port;

                    // Scan COM status prevent device pulled out
                    this.connectStateDetectorTimer = setInterval(function () {
                        if (this.peripheral.isOpen == false) {
                            clearInterval(this.connectStateDetectorTimer);
                            console.log('pulled out disconnect');
                            this.disconnect();
                            this.sendRemoteRequest('peripheralUnplug', { });
                        }
                    }.bind(this), 10);

                    // Only when the receiver function is set can isopen detect that the device is pulled out
                    // A strange features of npm serialport package
                    port.on('data', function (rev) {
                        console.log(rev)
                    });

                    resolve();
                });
            } catch (err) {
                reject(err);
            }
        })
    }

    bleWriteData (characteristic, withResponse, data) {
        return new Promise((resolve, reject) => {
            characteristic.write(data, !withResponse, (err) => {
                if (err) return reject(err);
                resolve();
            });
        })
    }

    async write (params) {
        try {
            const {message, encoding, withResponse} = params;
            const buffer = new Buffer(message, encoding);
            const characteristic = await this.getEndpoint('write request', params, 'write');
            for (let i = 0; i < buffer.length; i += 20) {
                await this.bleWriteData(characteristic, withResponse, buffer.slice(i, 20));
            }
            return buffer.length;
        } catch (err) {
            return new Error(`Error while attempting to write: ${err.message}`);
        }
    }

    bleReadData (characteristic, encoding = 'base64') {
        return new Promise((resolve, reject) => {
            characteristic.read((err, data) => {
                if (err) {
                    return reject(err);
                }
                resolve(data.toString(encoding));
            });
        });
    }

    async read (params) {
        try {
            const characteristic = await this.getEndpoint('read request', params, 'read');
            const readedData = await this.bleReadData(characteristic);
            const {startNotifications} = params;
            if (startNotifications) {
                await this.startNotifications(params, characteristic);
            }
            return readedData;
        } catch (err) {
            console.log('Error while attempting to read: ', err);
            return new Error(`Error while attempting to read: ${err.message}`);
        }
    }

    async startNotifications (params, characteristic) {
        let uuid;
        if (!characteristic || characteristic.properties.indexOf('notify') === -1) {
            characteristic = await this.getEndpoint('startNotifications request', params, 'notify');
        }
        uuid = getUUID(characteristic.uuid);
        if (!this.notifyCharacteristics[uuid]) {
            this.notifyCharacteristics[uuid] = characteristic;
            characteristic.subscribe();
        }
        if (!characteristic._events || !characteristic._events['data']) {
            characteristic.on('data', (data) => {
                this.onValueChanged(characteristic, data);
            });
        }
    }

    async stopNotifications (params) {
        console.log('stopNotifications !!!')
        const characteristic = await this.getEndpoint('stopNotifications request', params, 'notify');
        characteristic.unsubscribe();
        characteristic.removeAllListeners('data');
        delete this.notifyCharacteristics[getUUID(characteristic.uuid)];
    }

    notify (characteristic, notify) {
        return new Promise((resolve, reject) => {
            characteristic.notify(notify, err => {
                if (err) return reject(err);
                resolve();
            })
        })
    }

    // noble bug: 当 write 之后, characteristic 对象会发生变化
    repairNotifyAfterWrite () {
        for (const id in this.notifyCharacteristics) {
            const characteristic = this.notifyCharacteristics[id];
            const {_peripheralId, _serviceUuid, uuid} = characteristic;
            const currentCharacteristic = noble._characteristics[_peripheralId][_serviceUuid][uuid];
            if (characteristic !== currentCharacteristic) {
                currentCharacteristic._events = characteristic._events;
                this.notifyCharacteristics[id] = currentCharacteristic;
            }
        }
    }

    async stopAllNotifications () {
        for (const id in this.notifyCharacteristics) {
            await this.notify(this.notifyCharacteristics[id], false);
            this.notifyCharacteristics[id].removeAllListeners('data');
        }
    }

    onValueChanged (characteristic, data) {
        const params = {
            serviceId: characteristic._serviceUuid,
            characteristicId: characteristic.uuid,
            encoding: 'base64',
            message: data.toString('base64')
        };
        this.sendRemoteRequest('characteristicDidChange', params);
    }

    getEndpoint (errorText, params, type) {
        return new Promise((resolve, reject) => {
            if (!this.peripheral || this.peripheral.state !== 'connected') {
                return reject(`Peripheral is not connected for ${errorText}`);
            }
            let service;
            let {serviceId, characteristicId} = params;
            characteristicId = getUUID(characteristicId);
            if (this.characteristics[characteristicId]) {
                return resolve(this.characteristics[characteristicId]);
            }
            if (serviceId) {
                serviceId = getUUID(serviceId);
                service = this.services.find(item => item.uuid === serviceId);
            } else {
                service = this.services[0];
                serviceUuid = service.uuid;
            }
            if (!service) {
                reject(`Could not determine service UUID for ${errorText}`);
            }
            service.discoverCharacteristics([characteristicId], (err, characteristics) => {
                if (err) {
                    console.warn(err);
                    return reject(`could not find characteristic ${characteristicId} on service ${serviceUuid}`);
                }
                const characteristic = characteristics.find(item => item.properties.includes(type));
                if (characteristic) {
                    this.characteristics[characteristicId] = characteristic;
                    resolve(characteristic);
                } else {
                    reject(`failed to collect ${type} characteristic from service`);
                }
            });
        });
    }

    disconnect() {
        if (this.peripheral && this.peripheral.isOpen == true) {
            if (this.connectStateDetectorTimer) {
                clearInterval(this.connectStateDetectorTimer);
                this.connectStateDetectorTimer = null;
            }
            this.peripheral.close(error => {
                if (error) {
                    return reject(new Error(error));
                }
            });
        }
    }

    dispose () {
        this.disconnect();
        super.dispose();
        this.stopAllNotifications();
        this.socket = null;
        this.peripheral = null;
        this.services = null;
        this.characteristics = null;
        this.scanningTimeId = null;
        this.reportedPeripherals = null;
        this.notifyCharacteristics = null;
        if (this.connectStateDetectorTimer) {
            clearInterval(this.connectStateDetectorTimer);
            this.connectStateDetectorTimer = null;
        }
        if (this.peripheralsScanorTimer) {
            clearInterval(this.peripheralsScanorTimer);
            this.peripheralsScanorTimer == null;
        }
    }
}

module.exports = SerialportSession;