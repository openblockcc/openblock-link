const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const firmware = require('../lib/firmware');
const usbId = require('../lib/usb-id');

const AVRDUDE_STDOUT_GREEN_START = /Reading \||Writing \|/g;
const AVRDUDE_STDOUT_GREEN_END = /%/g;
const AVRDUDE_STDOUT_WHITE = /avrdude done/g;
const AVRDUDE_STDOUT_RED_START = /can't open device|programmer is not responding/g;

class Arduino {
    constructor (peripheralPath, config, userDataPath, toolsPath,
        sendstd, connect, disconnect, peripheralParams, list) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._tempfilePath = path.join(userDataPath, 'arduino/project');
        this._arduinoPath = path.join(toolsPath, 'Arduino');
        this._sendstd = sendstd;
        this._connect = connect;
        this._disconnect = disconnect;
        this._peripheralParams = peripheralParams;
        this._list = list;

        this._leonardoPath = null;

        this._arduinoBuilderPath = path.join(this._arduinoPath, 'arduino-builder');
        this._avrdudePath = path.join(this._arduinoPath, 'hardware/tools/avr/bin/avrdude');
        this._avrdudeConfigPath = path.join(this._arduinoPath, 'hardware/tools/avr/etc/avrdude.conf');

        this._codefilePath = path.join(this._tempfilePath, 'arduino.ino');
        this._projectPath = path.join(this._tempfilePath, 'build');
        this._hexPath = path.join(this._projectPath, 'arduino.ino.hex');
    }

    build (code) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this._projectPath)) {
                fs.mkdirSync(this._projectPath, {recursive: true});
            }
            // creat this folder to arduino-builder report can not find cache
            if (!fs.existsSync(path.join(this._tempfilePath, 'cache'))) {
                fs.mkdirSync(path.join(this._tempfilePath, 'cache'), {recursive: true});
            }

            fs.writeFile(this._codefilePath, code, err => {
                if (err) {
                    return reject(err);
                }
            });

            const args = [
                '-compile',
                '-logger=human',
                '-hardware', path.join(this._arduinoPath, 'hardware'),
                '-tools', path.join(this._arduinoPath, 'tools-builder'),
                '-tools', path.join(this._arduinoPath, 'hardware/tools/avr'),
                '-libraries', path.join(this._arduinoPath, 'libraries'),
                '-fqbn', this._config.fqbn,
                '-build-path', path.join(this._tempfilePath, 'build'),
                '-build-cache', path.join(this._tempfilePath, 'cache'),
                '-warnings=none',
                '-verbose',
                this._codefilePath
            ];

            // if extensions libraries exists add it to args
            const extensionsLibraries = path.join(this._userDataPath, '../extensions/libraries/Arduino');
            if (fs.existsSync(extensionsLibraries)) {
                args.splice(6, 0, '-libraries', extensionsLibraries);
            }

            const arduinoBuilder = spawn(this._arduinoBuilderPath, args);

            arduinoBuilder.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            arduinoBuilder.stdout.on('data', buf => {
                const data = buf.toString();
                let ansiColor = null;

                if (data.search(/Sketch uses|Global variables/g) === -1) {
                    ansiColor = ansi.clear;
                } else {
                    ansiColor = ansi.green;
                }
                this._sendstd(ansiColor + data);
            });

            arduinoBuilder.on('exit', outCode => {
                this._sendstd(`${ansi.clear}\r\n`); // End ansi color setting
                switch (outCode) {
                case 0:
                    return resolve('Success');
                case 1:
                    return reject(new Error('Build failed'));
                case 2:
                    return reject(new Error('Sketch not found'));
                case 3:
                    return reject(new Error('Invalid (argument for) commandline optiond'));
                case 4:
                    return reject(new Error('Preference passed to --get-pref does not exist'));
                }
            });
        });
    }

    _insertStr (soure, start, newStr) {
        return soure.slice(0, start) + newStr + soure.slice(start);
    }

    // Leonardo require open and close serialport as 1200 baudrate to enter the bootloader
    async leonardo () {
        const peripheralParams = this._peripheralParams;
        peripheralParams.peripheralConfig.config.baudRate = 1200;

        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

        // Open and close the serialport.
        await this._connect(peripheralParams, true);
        await wait(100);
        await this._disconnect();
        await wait(1000);

        return new Promise((resolve, reject) => {
            // Scan the new serialport path. The path will change on windows.
            this._list().then(peripheral => {
                if (peripheral) {
                    peripheral.forEach(device => {
                        const pnpid = device.pnpId.substring(0, 21);

                        const name = usbId[pnpid] ? usbId[pnpid] : 'Unknown device';
                        if (name === 'Arduino Leonardo') {
                            this._leonardoPath = device.path;
                        }
                    });
                    if (this._leonardoPath === null) {
                        return reject(new Error('cannot discover leonardo'));
                    }
                    return resolve();
                }
                return reject(new Error('cannot discover leonardo'));
            });
        });
    }

    async flash (firmwarePath = null) {
        if (this._config.fqbn === 'arduino:avr:leonardo') {
            await this.leonardo();
        }

        return new Promise((resolve, reject) => {
            const avrdude = spawn(this._avrdudePath, [
                '-C',
                this._avrdudeConfigPath,
                '-v',
                `-p${this._config.partno}`,
                `-c${this._config.programmerId}`,
                this._leonardoPath ? `-P${this._leonardoPath}` : `-P${this._peripheralPath}`,
                `-b${this._config.baudrate}`,
                '-D',
                firmwarePath ? `-Uflash:w:${firmwarePath}:i` : `-Uflash:w:${this._hexPath}:i`
            ]);

            avrdude.stderr.on('data', buf => {
                let data = buf.toString();

                // todo: Because the feacture of avrdude sends STD information intermittently.
                // There should be a better way to handle these mesaage.
                if (data.search(AVRDUDE_STDOUT_GREEN_START) != -1) { // eslint-disable-line eqeqeq
                    data = this._insertStr(data, data.search(AVRDUDE_STDOUT_GREEN_START), ansi.green);
                }
                if (data.search(AVRDUDE_STDOUT_GREEN_END) != -1) { // eslint-disable-line eqeqeq
                    data = this._insertStr(data, data.search(AVRDUDE_STDOUT_GREEN_END) + 1, ansi.clear);
                }
                if (data.search(AVRDUDE_STDOUT_WHITE) != -1) { // eslint-disable-line eqeqeq
                    data = this._insertStr(data, data.search(AVRDUDE_STDOUT_WHITE), ansi.clear);
                }
                if (data.search(AVRDUDE_STDOUT_RED_START) != -1) { // eslint-disable-line eqeqeq
                    data = this._insertStr(data, data.search(AVRDUDE_STDOUT_RED_START), ansi.red);
                }
                this._sendstd(data);
            });

            avrdude.stdout.on('data', buf => {
                // It seems that avrdude didn't use stdout.
                const data = buf.toString();
                this._sendstd(data);
            });

            avrdude.on('exit', code => {
                switch (code) {
                case 0:
                    if (this._config.fqbn === 'arduino:avr:leonardo') {
                        // Waiting for leonardo usb rerecognize.
                        const wait = ms => new Promise(relv => setTimeout(relv, ms));
                        wait(1000).then(() => resolve('Success'));
                    } else {
                        return resolve('Success');
                    }
                    break;
                case 1:
                    return reject(new Error('avrdude failed to flash'));
                }
            });
        });
    }

    flashRealtimeFirmware () {
        const firmwarePath = path.join(this._arduinoPath, '../RealtimeFirmware', firmware[this._config.fqbn]);
        return this.flash(firmwarePath);
    }
}

module.exports = Arduino;
