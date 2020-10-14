const fs = require('fs'); // 引入fs模块
const { spawn } = require('child_process');
var path = require('path')

const arduinoPath = path.join(__dirname, "/../../tools/Arduino");
const arduinoDebugPath = path.join(arduinoPath, "arduino_debug");
const avrdudePath = path.join(arduinoPath, "hardware/tools/avr/bin/avrdude");
const avrdudeConfigPath = path.join(arduinoPath, "hardware/tools/avr/etc/avrdude.conf");

const tempfilePath = path.join(__dirname, "/../../temp/arduino");
const codefilePath = path.join(tempfilePath, "arduino.ino");
const projectPath = path.join(tempfilePath, "build");
const hexPath = path.join(projectPath, "arduino.ino.hex");


const stderr_filter_list = /DEBUG StatusLogger|TRACE StatusLogger|INFO StatusLogger|WARN p.a.h.BoardCloudResolver|INFO c.a.u.n.HttpConnectionManager/g;

class Arduino {

    

    build(code) {
        return new Promise((resolve, reject) => {

            if (!fs.existsSync(tempfilePath)) {
                fs.mkdirSync(tempfilePath, { recursive: true });
            }

            fs.writeFile(codefilePath, code, function (err) {
                if (err) {
                    return console.error(err);
                }
            });
    
            const arduinoDebug = spawn(arduinoDebugPath, [
                '-v',
                '--board',
                'arduino:avr:uno',
                '--pref',
                'build.path=' + projectPath,
                '--verify',
                codefilePath
            ]);
    
            arduinoDebug.stderr.on('data', (buf) => {
                let data = buf.toString();
    
                if ((data.search(stderr_filter_list) == -1) && (data != '\r\n')) {
                    console.log(data);
                }
            });
    
            arduinoDebug.stdout.on('data', (buf) => {
                let data = buf.toString();
                console.log(data);
            });
    
            arduinoDebug.on('exit', (code) => {
                switch (code) {
                    case 0:
                        return resolve('Success');
                        break;
                    case 1:
                        return reject(new Error('Build failed or upload failed'));
                        break;
                    case 2:
                        return reject(new Error('Sketch not found'));
                        break;
                    case 3:
                        return reject(new Error('Invalid (argument for) commandline optiond'));
                        break;
                    case 4:
                        return reject(new Error('Preference passed to --get-pref does not exist'));
                        break;
                }
            });
        })
    }

    flash(peripheralPath) {
        return new Promise((resolve, reject) => {
            const avrdude = spawn(avrdudePath, [
                '-C',
                avrdudeConfigPath,
                '-v',
                '-patmega328p',
                '-carduino',
                '-P' + peripheralPath,
                '-b115200',
                '-D',
                '-Uflash:w:' + hexPath + ':i'
            ]);

            avrdude.stderr.on('data', (buf) => {
                let data = buf.toString();
                    console.log(data);
            });

            avrdude.stdout.on('data', (buf) => {
                let data = buf.toString();
                console.log(data);
            });

            avrdude.on('exit', (code) => {
                console.log('exit code : ' + code);
                resolve();
            });
        })
    }
}

module.exports = Arduino;