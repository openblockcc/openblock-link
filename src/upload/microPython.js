const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const OBMPY_MODULE_NAME = 'obmpy';
const ESPTOOL_MODULE_NAME = 'esptool';
const KFLASH_MODULE_NAME = 'kflash';

class MicroPython {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'microPython/project');
        this._pythonPath = path.join(toolsPath, 'Python');
        this._firmwareDir = path.join(toolsPath, '../firmwares/microPython');
        this._sendstd = sendstd;

        if (os.platform() === 'darwin') {
            this._pyPath = path.join(this._pythonPath, 'bin/python');
        } else {
            this._pyPath = path.join(this._pythonPath, 'python');
        }

        this._codefilePath = path.join(this._projectPath, 'main.py');
    }

    async flash (code, library = []) {
        const fileToPut = [];

        if (!fs.existsSync(this._projectPath)) {
            fs.mkdirSync(this._projectPath, {recursive: true});
        }

        try {
            fs.writeFileSync(this._codefilePath, code);
        } catch (err) {
            return Promise.reject(err);
        }

        fileToPut.push(this._codefilePath);

        library.forEach(lib => {
            if (fs.existsSync(lib)) {
                const libraries = fs.readdirSync(lib);
                libraries.forEach(file => {
                    fileToPut.push(path.join(lib, file));
                });
            }
        });

        // If we can not entry raw REPL, we should flash micro python firmware first.
        try {
            await this.checkReplSupport();
        } catch (err) {
            this._sendstd(`${ansi.yellow_dark}Could not enter raw REPL.\n`);
            this._sendstd(`${ansi.clear}Try to flash micro python firmware to fix.\n`);

            try {
                await this.flashFirmware();
            } catch (e) {
                return Promise.reject(e);
            }
        }

        this._sendstd('Writing files...\n');

        for (const file of fileToPut) {
            try {
                await this.obmpyPut(file);
            } catch (err) {
                return Promise.reject(err);
            }
        }

        this._sendstd(`${ansi.green_dark}Success\n`);
        return Promise.resolve();
    }

    checkReplSupport () {
        this._sendstd(`Try to enter raw REPL.\n`);

        return new Promise((resolve, reject) => {
            const obmpy = spawn(this._pyPath,
                [
                    `-m${OBMPY_MODULE_NAME}`,
                    `-p${this._peripheralPath}`,
                    'ls'
                ]);

            obmpy.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    return resolve();
                default:
                    return reject();
                }
            });
        });
    }

    obmpyPut (file) {
        return new Promise((resolve, reject) => {
            const obmpy = spawn(this._pyPath,
                [
                    `-m${OBMPY_MODULE_NAME}`,
                    `-p${this._peripheralPath}`,
                    'put',
                    file
                ]);

            obmpy.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    this._sendstd(`${file} write finish\n`);
                    return resolve();
                default:
                    return reject('obmpy failed to write');
                }
            });
        });
    }

    async flashFirmware () {
        if (this._config.chip === 'esp32' || this._config.chip === 'esp8266') {
            return await this.espflashFirmware();
        } else if (this._config.chip === 'k210') {
            return await this.k210flashFirmware();
        }
        return Promise.reject('unknown chip type');
    }

    async espflashFirmware () {
        const erase = () => new Promise((resolve, reject) => {
            const esptools = spawn(this._pyPath,
                [
                    `-m${ESPTOOL_MODULE_NAME}`,
                    '--chip', this._config.chip,
                    '--port', this._peripheralPath,
                    'erase_flash'
                ]);

            esptools.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            esptools.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    return resolve();
                default:
                    return reject('esptool failed to erase');
                }
            });
        });

        const flash = () => new Promise((resolve, reject) => {
            const args = [
                `-m${ESPTOOL_MODULE_NAME}`,
                '--chip', this._config.chip,
                '--port', this._peripheralPath,
                '--baud', this._config.baud
            ];

            if (this._config.chip === 'esp32') {
                args.push('write_flash');
                args.push('-z', '0x1000');
            } else if (this._config.chip === 'esp8266') {
                args.push('write_flash');
                args.push('--flash_size=detect', '0');
            } else {
                return reject('unknown chip type');
            }

            args.push(path.join(this._firmwareDir, this._config.firmware));

            const esptools = spawn(this._pyPath, args);

            esptools.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            esptools.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    return resolve();
                default:
                    return reject('esptool failed flash');
                }
            });
        });

        try {
            await erase();
            await flash();

            return Promise.resolve();
        } catch (err) {
            return Promise.reject(err);
        }
    }

    k210flashFirmware () {
        return new Promise((resolve, reject) => {
            const args = [
                `-m${KFLASH_MODULE_NAME}`,
                '-p', this._peripheralPath,
                '-b', this._config.baud
            ];

            args.push(path.join(this._firmwareDir, this._config.firmware));

            const kflash = spawn(this._pyPath, args);

            kflash.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            kflash.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    return resolve();
                default:
                    return reject('kflash failed flash');
                }
            });
        });
    }
}

module.exports = MicroPython;
