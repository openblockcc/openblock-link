const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');

class Microbit {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'microbit/project');
        this._pythonPath = path.join(toolsPath, 'Python');
        this._sendstd = sendstd;

        this._uflashPath = path.join(this._pythonPath, 'Scripts/uflash');
        this._codefilePath = path.join(this._projectPath, 'microbit.py');
    }

    _insertStr (soure, start, newStr) {
        return soure.slice(0, start) + newStr + soure.slice(start);
    }

    flash (code) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(this._projectPath)) {
                fs.mkdirSync(this._projectPath, {recursive: true});
            }

            fs.writeFile(this._codefilePath, code, err => {
                if (err) {
                    return reject(err);
                }
            });

            const uflash = spawn(this._uflashPath, [this._codefilePath]);
            this._sendstd('Start flash...\n');
            this._sendstd('This step will take tens of seconds, pelese wait.\n');

            uflash.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            uflash.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            uflash.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    this._sendstd(`${ansi.green}Flash Success.\n`);
                    return resolve('Success');
                case 1:
                    return reject(new Error('uflash failed to flash'));
                }
            });
        });
    }
}

module.exports = Microbit;
