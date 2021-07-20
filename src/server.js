const { dialog } = require('electron')
const downloadRelease = require('download-github-release');
const loadJsonFile = require('load-json-file');
const http = require('http');
const url = require('url');
const {Server} = require('ws');
const Emitter = require('events');
const fs = require('fs');
const path = require('path');

const user = 'OttawaSTEM';
const leaveZipped = false;
const filterRelease = release => release.prerelease === false;

/**
 * Configuration the default tools path.
 * @readonly
 */
const DEFAULT_TOOLS_PATH = path.join(__dirname, '../tools');

/**
 * Configuration the default port.
 * @readonly
 */
const DEFAULT_PORT = 20111;

/**
 * Configuration the server routers.
 * @readonly
 */
const ROUTERS = {
    '/status': require('./session/link'),
    '/scratch/serialport': require('./session/serialport') // eslint-disable-line global-require
};

/**
 * A server to provide local hardware api.
 */
class ScratchArduinoLink extends Emitter{
    /**
     * Construct a Scratch Arduino link server object.
     * @param {string} userDataPath - the path to save user data.
     * @param {string} toolsPath - the path of build and flash tools.
     */
    constructor (userDataPath, toolsPath) {
        super();

        if (userDataPath) {
            this.userDataPath = path.join(userDataPath, 'link');
        }

        if (toolsPath) {
            this.toolsPath = toolsPath;
        } else {
            this.toolsPath = DEFAULT_TOOLS_PATH;
        }

        this._socketPort = DEFAULT_PORT;
        this._httpServer = new http.Server();
        this._socketServer = new Server({server: this._httpServer});

        this._socketServer.on('connection', (socket, request) => {
            const {pathname} = url.parse(request.url);
            const Session = ROUTERS[pathname];
            let session;
            if (Session) {
                session = new Session(socket, this.userDataPath, this.toolsPath);
                console.log('new connection');
                this.emit('new-connection');
            } else {
                return socket.close();
            }
            const dispose = () => {
                if (session) {
                    session.dispose();
                    session = null;
                }
            };
            socket.on('close', dispose);
            socket.on('error', dispose);
        })
            .on('error', e => {
                const info = `Error while trying to listen port ${this._socketPort}: ${e}`;
                console.warn(info);
            });
    }
    
    /**
     * Initial and Check tools, libraries and firmware update.
     */
    async start () {
        try {
            // Initial install arduino tools
            if (!fs.existsSync(this.toolsPath)) {
                const toolsRepo = 'scratch-arduino-tools';
                const toolsPath = path.resolve(this.toolsPath, '../');
                console.log(toolsPath);
                const filterAsset = asset => {
                    if (process.platform === 'win32') {
                        return (asset.name.indexOf('Win') >= 0);
                    } else if (process.platform === 'darwin') {
                        return (asset.name.indexOf('MacOS') >= 0);
                    }
                }
                await downloadRelease(user, toolsRepo, toolsPath, filterRelease, filterAsset, leaveZipped)
                    .then(() => {
                        console.log('tools download complete.');
                    })
                    .catch(err => {
                        console.error(err.message);
                    });
            }
            
            // Download index.json
            const repo = 'scratch-arduino-link';
            const indexPath = path.resolve(this.userDataPath);
            const filterAsset = asset => (asset.name.indexOf('index.json') >= 0);
            await downloadRelease(user, repo, indexPath, filterRelease, filterAsset, leaveZipped)
                .then(() => {
                    console.log('index.json download complete.');
                })
                .catch(err => {
                    console.error(err.message);
                });
            const linkPackages = await loadJsonFile(path.join(indexPath, 'index.json'));

            // scratch-arduino-libraries
            const libraryPath = path.join(path.resolve(this.toolsPath), '/Arduino/libraries');
            for (const library of linkPackages['libraries']) {
                const librariesRepo = 'scratch-arduino-libraries';
                if (!fs.existsSync(path.join(libraryPath, library['folderName']))) {
                    const libraryFilterAsset = asset => (asset.name.indexOf(library['libraryName']) >= 0);
                    await downloadRelease(user, librariesRepo, libraryPath, filterRelease, libraryFilterAsset, leaveZipped)
                        .then(() => {
                            console.log(library['fileName'], ' download complete.');
                        })
                        .catch(err => {
                            console.error(err.message);
                        });
                }
            }
            
            // scratch-arduino-firmwares
            const firmwaresRepo = 'scratch-arduino-firmwares';
            const firmwarePath = path.join(path.resolve(this.toolsPath), '../firmwares');
            const oldFirmwareVersionPath = path.join(firmwarePath, 'firmware-version.json');
            if (!fs.existsSync(firmwarePath)) {
                fs.mkdirSync(firmwarePath, {recursive: true});
            }
            if (!fs.existsSync(oldFirmwareVersionPath)) {
                for (const firmware of linkPackages['firmwares']) {
                    const libraryFilterAsset = asset => (asset.name.indexOf(firmware['firmwareName']) >= 0);
                    await downloadRelease(user, firmwaresRepo, firmwarePath, filterRelease, libraryFilterAsset, leaveZipped)
                        .then(() => {
                            console.log(firmware['fileName'], ' download complete.');
                        })
                        .catch(err => {
                            console.error(err.message);
                        });
                }
            } else {
                const oldFirmwareVersion = await loadJsonFile(oldFirmwareVersionPath);
                for (const firmware of linkPackages['firmwares']) {
                    if (firmware['version'] > oldFirmwareVersion[firmware['firmwareName']]) {
                        const libraryFilterAsset = asset => (asset.name.indexOf(firmware['firmwareName']) >= 0);
                        await downloadRelease(user, firmwaresRepo, firmwarePath, filterRelease, libraryFilterAsset, leaveZipped)
                            .then(() => {
                                console.log(firmware['fileName'], ' download complete.');
                            })
                            .catch(err => {
                                console.error(err.message);
                            });
                    }
                }
            }
            let data = {};      // Save current firmware version
            for (const firmware of linkPackages['firmwares']) {
                data[firmware['firmwareName']] = firmware['version'];
            }
            fs.writeFileSync(oldFirmwareVersionPath, JSON.stringify(data));            
        } catch(err) {
            dialog.showMessageBox({
                title: 'Scratch Arduino Link',
                type: 'error',
                buttons: ['Close'],
                message: 'Update error - ' + err.message
            });
        }
    }

    /**
     * Start a server listening for connections.
     * @param {number} port - the port to listen.
     */
    listen (port) {
        if (port) {
            this._socketPort = port;
        }

        this._httpServer.listen(this._socketPort, '127.0.0.1', () => {
            this.emit('ready');
            console.log('socket server listend: ', `http://127.0.0.1:${this._socketPort}`);
        });
    }
}

module.exports = ScratchArduinoLink;
