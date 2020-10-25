const fs = require('fs');
const { spawn } = require('child_process');
var path = require('path')
const ansi = require('ansi-string');

const arduinoPath = path.join(__dirname, "/../../tools/Arduino");
const arduinoDebugPath = path.join(arduinoPath, "arduino_debug");
const avrdudePath = path.join(arduinoPath, "hardware/tools/avr/bin/avrdude");
const avrdudeConfigPath = path.join(arduinoPath, "hardware/tools/avr/etc/avrdude.conf");

const tempfilePath = path.join(__dirname, "/../../temp/arduino");
const codefilePath = path.join(tempfilePath, "arduino.ino");
const projectPath = path.join(tempfilePath, "build");
const hexPath = path.join(projectPath, "arduino.ino.hex");

const arduinoDebug_stderr_filter_list = /DEBUG StatusLogger|TRACE StatusLogger|INFO StatusLogger|WARN p.a.h.BoardCloudResolver|INFO c.a.u.n.HttpConnectionManager/g;
const arduinoDebug_stderr_white_list = /Loading configuration...|正在加载配置...|Initializing packages...|正在初始化包...|Preparing boards...|正在准备开发板...|Verifying...|正在验证.../g;
const arduinoDebug_stdout_green_list = /Sketch uses|项目使用了|Global variables|全局变量使用了/g;
const avrdude_stdout_green_start = /Reading \||Writing \|/g;
const avrdude_stdout_green_end = /%/g;
const avrdude_stdout_white = /avrdude done/g;
const avrdude_stdout_red_start = /can't open device|programmer is not responding/g;

var avrdudeExitCode = null;

class Arduino {

    insertStr(soure, start, newStr) {
        return soure.slice(0, start) + newStr + soure.slice(start);
    }

    build(code, sendstd) {
        return new Promise((resolve, reject) => {

            if (!fs.existsSync(tempfilePath)) {
                fs.mkdirSync(tempfilePath, { recursive: true });
            }

            fs.writeFile(codefilePath, code, function (err) {
                if (err) {
                    console.error(err);
                    return reject(err);
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
                let ansiColor = null;

                if ((data.search(arduinoDebug_stderr_filter_list) == -1) && (data != '\r\n')) {
                    // console.log('[arduinoDebug.err] ' + data);

                    if (data.search(arduinoDebug_stderr_white_list) != -1) {
                        ansiColor = ansi.clear;
                    }
                    else {
                        ansiColor = ansi.red;
                    }
                    sendstd(ansiColor + data);
                }
            });

            arduinoDebug.stdout.on('data', (buf) => {
                let data = buf.toString();
                let ansiColor = null;

                // console.log('[arduinoDebug.out] ' + data);
                if (data.search(arduinoDebug_stdout_green_list) != -1) {
                    ansiColor = ansi.green;
                }
                else {
                    ansiColor = ansi.clear;
                }
                sendstd(ansiColor + data);
            });

            arduinoDebug.on('exit', (code) => {
                sendstd(ansi.clear + '\r\n');  // End ansi color setting
                switch (code) {
                    case 0:
                        return resolve('Success');
                        break;
                    case 1:
                        return reject(new Error('Build failed'));
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

    flash(peripheralPath, sendstd) {
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
                // console.log('[avrdude.err] ' + data);

                // todo: Because the feacture of avrdude sends STD information intermittently. There should be a better way to handle these mesaage.
                if (data.search(avrdude_stdout_green_start) != -1) {
                    data = this.insertStr(data, data.search(avrdude_stdout_green_start), ansi.green)
                }
                if (data.search(avrdude_stdout_green_end) != -1) {
                    data = this.insertStr(data, data.search(avrdude_stdout_green_end) + 1, ansi.clear)
                }
                if (data.search(avrdude_stdout_white) != -1) {
                    data = this.insertStr(data, data.search(avrdude_stdout_white), ansi.clear)
                }
                if (data.search(avrdude_stdout_red_start) != -1) {
                    data = this.insertStr(data, data.search(avrdude_stdout_red_start), ansi.red)
                }
                sendstd(data);
            });

            avrdude.stdout.on('data', (buf) => {
                // It seems that avrdude didn't use stdout
                let data = buf.toString();
                // console.log('[avrdude.out] ' + data);

                sendstd(data);
            });

            avrdude.on('exit', (code) => {
                // console.log('avrdude Exit code : ' + code);
                switch (code) {
                    case 0:
                        return resolve('Success');
                        break;
                    case 1:
                        return reject(new Error('avrdude failed to flash'));
                        break;
                }
            });
        })
    }
}

module.exports = Arduino;