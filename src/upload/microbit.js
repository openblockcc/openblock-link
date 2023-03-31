const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const FLASH_TIME = 25 * 1000; // 20s

const ABORT_STATE_CHECK_INTERVAL = 100;

const UFLASH_MODULE_NAME = 'uflash';
const MICROFS_MODULE_NAME = 'microfs';

class Microbit {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd, sendRemoteRequest) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'microbit/project');
        this._pythonPath = path.join(toolsPath, 'Python');
        this._sendstd = sendstd;
        this._sendRemoteRequest = sendRemoteRequest;

        this._abort = false;

        if (os.platform() === 'darwin') {
            this._pyPath = path.join(this._pythonPath, 'python3');
        } else if (os.platform() === 'linux') {
            this._pyPath = path.join(this._pythonPath, 'bin/python3');
        } else {
            this._pyPath = path.join(this._pythonPath, 'python');
        }

        this._codefilePath = path.join(this._projectPath, 'main.py');
    }

    abortUpload () {
        this._abort = true;
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

        if (this._abort === true) {
            return Promise.resolve('Aborted');
        }

        this._sendstd('Writing files...\n');

        for (const file of fileToPut) {
            const ufsPutExitCode = await this.ufsPut(file);
            if (ufsPutExitCode !== 'Success' && ufsPutExitCode !== 'Aborted') {
                return Promise.reject(ufsPutExitCode);
            }
            if (this._abort === true) {
                break;
            }
        }

        if (this._abort === true) {
            return Promise.resolve('Aborted');
        }
        this._sendstd(`${ansi.green_dark}Success\n`);
        return Promise.resolve('Success');
    }

    ufsTestFirmware () {
        this._sendstd(`Try to enter raw REPL.\n`);

        return new Promise(resolve => {
            const ufs = spawn(this._pyPath, ['-m', MICROFS_MODULE_NAME, 'ls']);

            const listenAbortSignal = setInterval(() => {
                if (this._abort) {
                    ufs.kill();
                }
            }, ABORT_STATE_CHECK_INTERVAL);

            ufs.on('exit', outCode => {
                clearInterval(listenAbortSignal);
                switch (outCode) {
                case null:
                    return resolve('Aborted');
                case 0:
                    return resolve('Success');
                case 1: // Could not enter raw REPL.
                    return resolve('Failed');
                }
            });
        });
    }

    ufsPut (file) {
        return new Promise((resolve, reject) => {
            const ufs = spawn(this._pyPath, ['-m', MICROFS_MODULE_NAME, 'put', file]);

            ufs.stdout.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
                return resolve('Failed');
            });

            const listenAbortSignal = setInterval(() => {
                if (this._abort) {
                    ufs.kill();
                }
            }, ABORT_STATE_CHECK_INTERVAL);

            ufs.on('exit', outCode => {
                clearInterval(listenAbortSignal);
                switch (outCode) {
                case null:
                    return resolve('Aborted');
                case 0:
                    this._sendstd(`${file} write finish\n`);
                    return resolve('Success');
                case 1:
                    return reject('ufs failed to write');
                }
            });
        });
    }

    uflash () {
        return new Promise((resolve, reject) => {
            // For some unknown reason, uflash cannot be killed in the test, so the termination button is disabled
            // when uflash is running.
            this._sendRemoteRequest('setUploadAbortEnabled', false);

            const uflash = spawn(this._pyPath, ['-m', UFLASH_MODULE_NAME]);

            this._sendstd(`${ansi.green_dark}Start flash firmware...\n`);
            this._sendstd(`${ansi.clear}This step will take tens of seconds, pelese wait.\n`);

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
                    return reject('uflash failed to flash');
                }
            });
        });
    }
}

module.exports = Microbit;
