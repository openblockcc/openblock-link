const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const FLASH_TIME = 25 * 1000; // 20s
let erase_files = [];

class Maixduino {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'maixduino/project');
        this._pythonPath = path.join(toolsPath, 'Python');
		this._firmwarePath = path.join(this._pythonPath,'../../firmwares/maixduino');
        this._sendstd = sendstd;

        if (os.platform() === 'darwin') {
            this._pyPath = path.join(this._pythonPath, 'bin/python');
            this._kflashPath = path.join(this._pythonPath, 'Lib/site-packages/ktool.py');
            this._ampyPath = path.join(this._pythonPath, 'bin/ampy');
			this._rshellPath = path.join(this._pythonPath, 'bin/rshell');
        } else {
            this._pyPath = path.join(this._pythonPath, 'python');
            this._kflashPath = path.join(this._pythonPath, 'Lib/site-packages/ktool.py');
            this._ampyPath = path.join(this._pythonPath, 'Scripts/ampy-script.py');
			this._rshellPath = path.join(this._pythonPath, 'Scripts/rshell-script.py');
        }

        this._codefilePath = path.join(this._projectPath, 'main.py');
		this._defaultLibPath = path.join(this._pythonPath,'maixy_lib');
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
		
		this._sendstd('Checking Firmware...\n');
		
        const ufsTestExitCode = await this.ufsTestFirmware();
        if (ufsTestExitCode === 'Failed') {
            this._sendstd(`${ansi.yellow_dark}Could not enter raw REPL.\n`);
            this._sendstd(`${ansi.clear}Try to flash micropython for maixduino firmware to fix.\n`);
            await this.kflash();
        }
		
		this._sendstd('Erasing files...\n');
		
		const ufsEraseExitCode = await this.ufsErase();
			if(ufsEraseExitCode !== 'Success'){
					return Promise.reject(ufsEraseExitCode);
		}
		
		 this._sendstd('Writing libraries...\n');
		 
		const ufsLibExitCode = await this.ufsPutLib();
        if (ufsLibExitCode === 'Failed') {
            this._sendstd(`${ansi.yellow_dark}Libraries Writing Failed\n`);
        }

        this._sendstd('Writing main.py...\n');
		
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
           const ufs = spawn(this._pyPath, [this._ampyPath,
		'-p', this._peripheralPath, 'ls', '/flash'], { encoding : 'utf8' });
            ufs.stdout.on('data', buf => {
				this._sendstd(buf.toString());
                if(buf.toString().indexOf('could not enter raw repl') !== -1){
					return resolve('Failed');					
				}
            });

            ufs.on('exit', outCode => {
                switch (outCode) {
                case 0:
					return resolve('Success');
				case 1:
					return resolve('Failed');
			   }
			});
        });
    }


    ufsPut (file) {
        return new Promise((resolve, reject) => {
			
			const ufs = spawn(this._pyPath, [this._ampyPath, '-p', this._peripheralPath, '-b 115200', 'put', file]);

            ufs.stdout.on('data', buf => {
                     this._sendstd(buf.toString());
            });
			
			ufs.stderr.on('data', buf => {
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
	
	ufsPutLib () {
        return new Promise((resolve, reject) => {
			const ufs = spawn(this._pyPath, [this._ampyPath, '-p', this._peripheralPath, 'put', this._defaultLibPath, '/flash']);

            ufs.stdout.on('data', buf => {
                     this._sendstd(buf.toString());
            });
			
			ufs.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
				return resolve('Failed');
            });

            ufs.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    this._sendstd(`Library write finish\n`);
                    return resolve('Success');
                case 1:
                    return reject(new Error('ufs failed to write Library'));
                }
            });
        });
    }
	ufsErase () {
        return new Promise((resolve, reject) => {
			const ufs = spawn(this._pyPath, [this._rshellPath, '-p', this._peripheralPath, 'rm', '/flash/*.*']);
            ufs.stdout.on('data', buf => {
                if (buf.toString().indexOf('could not enter raw repl') !== -1){
                    return resolve('Failed');
                }
				this._sendstd(buf.toString());
            });

            ufs.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    this._sendstd(`erase finish\n`);
                    return resolve('Success');
                case 1:
                    return reject(new Error('system failed to erase'));
                }
            });
        });
    }

    kflash () {
        return new Promise((resolve, reject) => {
            const kflash = spawn(this._pyPath, [this._kflashPath, '-p', this._peripheralPath, '-b','1500000', '-B','maixduino', path.join(this._firmwarePath,'maixduino-micropython-v6.2.0.bin')]);

            this._sendstd(`${ansi.green_dark}Start flash firmware...\n`);
            this._sendstd(`${ansi.clear}This step will take tens of seconds, please wait.\n`);

            // Add finish flasg to solve kflash will exit immediately after start, nut not exit
            // after flash finish. So add a counter flag in order to ensure that enough time has
            // been spent to finish burning and kflash runs successfully.
            let finishFlag = 0;
            const finish = () => {
                finishFlag += 1;
                if (finishFlag === 2) {
                    this._sendstd(`${ansi.green_dark}Flash Success.\n`);
                    return resolve('Success');
                }
            };
            setTimeout(finish, FLASH_TIME);

            kflash.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            kflash.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            kflash.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    finish();
                    break;
                case 1:
                    return reject(new Error('kflash failed to flash'));
                }
            });
        });
    }	
	EraseFirmware () {
		return new Promise((resolve, reject) => {
		const kflash = spawn(this._pyPath, [this._kflashPath, '-p', this._peripheralPath, '-b','1500000', '-B','maixduino', '--erase']);

            this._sendstd(`${ansi.green_dark}Erasing firmware...\n`);
            this._sendstd(`${ansi.clear}This step will take tens of seconds, please wait.\n`);

            // Add finish flasg to solve kflash will exit immediately after start, nut not exit
            // after flash finish. So add a counter flag in order to ensure that enough time has
            // been spent to finish burning and kflash runs successfully.
            let finishFlag = 0;
            const finish = () => {
                finishFlag += 1;
                if (finishFlag === 2) {
                    this._sendstd(`${ansi.green_dark}Erase Success.\n`);
                    return resolve('Success');
                }
            };
            setTimeout(finish, FLASH_TIME);

            kflash.stdout.on('data', buf => {
                this._sendstd(buf.toString());
            });

            kflash.stderr.on('data', buf => {
                this._sendstd(ansi.red + buf.toString());
            });

            kflash.on('exit', outCode => {
                switch (outCode) {
                case 0:
                    finish();
                    break;
                case 1:
                    return reject(new Error('kflash failed to Erase'));
                }
            });
        });
	}
	async flashRealtimeFirmware () {
	const onExitEraseCode = await this.EraseFirmware();
	if(onExitEraseCode === 'Success'){
		return this.kflash();
		}
	}
}

module.exports = Maixduino;
