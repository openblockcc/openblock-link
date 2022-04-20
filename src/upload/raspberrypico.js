const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');
const ansi = require('ansi-string');
const os = require('os');

const FLASH_TIME = 25 * 1000; // 20s
let erase_files = [];

class RaspberryPico {
    constructor (peripheralPath, config, userDataPath, toolsPath, sendstd) {
        this._peripheralPath = peripheralPath;
        this._config = config;
        this._userDataPath = userDataPath;
        this._projectPath = path.join(userDataPath, 'raspberrypico/project');
        this._pythonPath = path.join(toolsPath, 'Python');
		this._firmwarePath = path.join(this._pythonPath,'../../firmwares/raspberrypico');
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
		this._defaultLibPath = path.join(this._pythonPath,'rpico_lib/boot.py');
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
            this._sendstd(`${ansi.clear}Flash micropython for raspberrypico firmware to fix.\n`);
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
		'-p', this._peripheralPath, 'ls'], { encoding : 'utf8' });
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
			const ufs = spawn(this._pyPath, [this._ampyPath, '-p', this._peripheralPath, 'put', this._defaultLibPath]);

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
			const ufs = spawn(this._pyPath, [this._rshellPath, '-p', this._peripheralPath, 'rm', '/pyboard/*.*']);
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
}

module.exports = RaspberryPico;
