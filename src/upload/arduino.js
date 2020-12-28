const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const firmware = require('../lib/firmware');

const AVRDUDE_STDOUT_GREEN_START = /Reading \||Writing \|/g;
const AVRDUDE_STDOUT_GREEN_END = /%/g;
const AVRDUDE_STDOUT_WHITE = /avrdude done/g;
const AVRDUDE_STDOUT_RED_START = /can't open device|programmer is not responding/g;

class Arduino {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._tempfilePath = path.join(userDataPath, 'project/arduino');
        this._arduinoPath = path.join(toolsPath, 'Arduino');
        this._sendstd = sendstd;

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

            fs.writeFile(this._codefilePath, code, err => {
                if (err) {
                    return reject(err);
                }
            });

            const arduinoDebug = spawn(this._arduinoBuilderPath, [
                '-compile',
                '-logger=human',
                '-hardware', path.join(this._arduinoPath, 'hardware'),
                '-tools', path.join(this._arduinoPath, 'tools-builder'),
                '-tools', path.join(this._arduinoPath, 'hardware/tools/avr'),
                '-libraries', path.join(this._arduinoPath, 'libraries'),
                '-fqbn', this._config.board,
                '-build-path', path.join(this._tempfilePath, 'build'),
                '-build-cache', path.join(this._tempfilePath, 'cache'),
                '-warnings=none',
                '-verbose',
                this._codefilePath
            ]);

            arduinoDebug.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            arduinoDebug.stdout.on('data', buf => {
                const data = buf.toString();
                let ansiColor = null;

                if (data.search(/Sketch uses|Global variables/g) === -1) {
                    ansiColor = ansi.clear;
                } else {
                    ansiColor = ansi.green;
                }
                this._sendstd(ansiColor + data);
            });

            arduinoDebug.on('exit', outCode => {
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

    flash () {
        return new Promise((resolve, reject) => {
            const avrdude = spawn(this._avrdudePath, [
                '-C',
                this._avrdudeConfigPath,
                '-v',
                `-p${this._config.partno}`,
                '-carduino',
                `-P${this._peripheralPath}`,
                '-b115200',
                '-D',
                `-Uflash:w:${this._hexPath}:i`
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
                // It seems that avrdude didn't use stdout
                const data = buf.toString();
                this._sendstd(data);
            });

            avrdude.on('exit', code => {
                switch (code) {
                case 0:
                    return resolve('Success');
                case 1:
                    return reject(new Error('avrdude failed to flash'));
                }
            });
        });
    }

    flashRealtimeFirmware () {
        return new Promise((resolve, reject) => {
            const firmwarePath = path.join(this._arduinoPath, 'realtime-firmware', firmware[this._config.board]);

            const avrdude = spawn(this._avrdudePath, [
                '-C',
                this._avrdudeConfigPath,
                '-v',
                `-p${this._config.partno}`,
                '-carduino',
                `-P${this._peripheralPath}`,
                '-b115200',
                '-D',
                `-Uflash:w:${firmwarePath}:i`
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
                // It seems that avrdude didn't use stdout
                const data = buf.toString();
                this._sendstd(data);
            });

            avrdude.on('exit', code => {
                switch (code) {
                case 0:
                    return resolve('Success');
                case 1:
                    return reject(new Error('avrdude failed to flash'));
                }
            });
        });
    }
}

module.exports = Arduino;
