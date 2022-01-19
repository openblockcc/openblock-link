const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const FLASH_TIME = 25 * 1000; // 20s

class Microbit {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'microbit/project');
        this._pythonPath = path.join(toolsPath, 'Python');
        this._sendstd = sendstd;

        if (os.platform() === 'darwin') {
            this._pyPath = path.join(this._pythonPath, 'bin/python');
            this._uflashPath = path.join(this._pythonPath, 'lib/python3.9/site-packages/uflash.py');
            this._ufsPath = path.join(this._pythonPath, 'lib/python3.9/site-packages/microfs.py');
        } else {
            this._pyPath = path.join(this._pythonPath, 'python');
            this._uflashPath = path.join(this._pythonPath, 'Scripts/uflash-script.py');
            this._ufsPath = path.join(this._pythonPath, 'Scripts/ufs-script.py');
        }

        this._codefilePath = path.join(this._projectPath, 'main.py');
    }

    _insertStr (soure, start, newStr) {
        return soure.slice(0, start) + newStr + soure.slice(start);
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

        const ufsTestExitCode = await this.ufsTestFirmware();
        if (ufsTestExitCode === 'Failed') {
            this._sendstd(`${ansi.yellow_dark}Could not enter raw REPL.\n`);
            this._sendstd(`${ansi.clear}Try to flash micropython for microbit firmware to fix.\n`);
            await this.uflash();
        }

        this._sendstd('Writing files...\n');

        for (const file of fileToPut) {
            const ufsPutExitCode = await this.ufsPut(file);
            if (ufsPutExitCode !== 'Success') {
                return Promise.reject(ufsPutExitCode);
            }
        }

        this._sendstd(`${ansi.green_dark}Success\n`);
        return Promise.resolve('Success');
    }

    ufsTestFirmware () {
        return new Promise(resolve => {
            const ufs = spawn(this._pyPath, [this._ufsPath, 'ls']);

            ufs.stdout.on('data', buf => {
                if (buf.toString().indexOf('Could not enter raw REPL.') !== -1){
                    return resolve('Failed');
                }
            });

            ufs.on('exit', () => resolve('Success'));
        });
    }

    ufsPut (file) {
        return new Promise((resolve, reject) => {
            const ufs = spawn(this._pyPath, [this._ufsPath, 'put', file]);

            ufs.stdout.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
                return resolve('Failed');
            });

            ufs.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    this._sendstd(`${file} write finish\n`);
                    return resolve('Success');
                case 1:
                    return reject(new Error('ufs failed to write'));
                }
            });
        });
    }

    uflash () {
        return new Promise((resolve, reject) => {
            const uflash = spawn(this._pyPath, [this._uflashPath]);

            this._sendstd(`${ansi.green_dark}Start flash firmware...\n`);
            this._sendstd(`${ansi.clear}This step will take tens of seconds, please wait.\n`);

            // Add finish flasg to solve uflash will exit immediately after start, nut not exit
            // after flash finish. So add a counter flag in order to ensure that enough time has
            // been spent to finish burning and uflash runs successfully.
            let finishFlag = 0;
            const finish = () => {
                finishFlag += 1;
                if (finishFlag === 2) {
                    this._sendstd(`${ansi.green_dark}Flash Success.\n`);
                    return resolve('Success');
                }
            };
            setTimeout(finish, FLASH_TIME);

            uflash.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            uflash.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            uflash.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    finish();
                    break;
                case 1:
                    return reject(new Error('uflash failed to flash'));
                }
            });
        });
    }
}

module.exports = Microbit;
