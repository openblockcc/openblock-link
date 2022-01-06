const http = require('http');
const url = require('url');
const {Server} = require('ws');
const Emitter = require('events');
const path = require('path');
const log = require('loglevel');

/**
 * Configuration the default user data path. Just for debug.
 * @readonly
 */
const DEFAULT_USER_DATA_PATH = path.join(__dirname, '../../.openblockData');

/**
 * Configuration the default tools path.
 * @readonly
 */
const DEFAULT_TOOLS_PATH = path.join(__dirname, '../tools');

/**
 * Configuration the default host.
 * @readonly
 */
const DEFAULT_HOST = '0.0.0.0';

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
    '/scratch/ble': require('./session/ble'), // eslint-disable-line global-require
    '/scratch/serialport': require('./session/serialport') // eslint-disable-line global-require
};

/**
 * A server to provide local hardware api.
 */
class OpenBlockLink extends Emitter{
    /**
     * Construct a OpenBlock link server object.
     * @param {string} userDataPath - the path to save user data.
     * @param {string} toolsPath - the path of build and flash tools.
     */
    constructor (userDataPath, toolsPath) {
        super();

        if (userDataPath) {
            this.userDataPath = path.join(userDataPath, 'link');
        } else {
            this.userDataPath = path.join(DEFAULT_USER_DATA_PATH, 'link');
        }

        if (toolsPath) {
            this.toolsPath = toolsPath;
        } else {
            this.toolsPath = DEFAULT_TOOLS_PATH;
        }

        this._port = DEFAULT_PORT;
        this._host = DEFAULT_HOST;
        this._httpServer = new http.Server();
        this._socketServer = new Server({server: this._httpServer});

        this._socketServer.on('connection', (socket, request) => {
            const {pathname} = url.parse(request.url);
            const Session = ROUTERS[pathname];
            let session;
            if (Session) {
                session = new Session(socket, this.userDataPath, this.toolsPath);
                log.info('new connection');
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
                if (e.code !== 'EADDRINUSE') {
                    log.error(e);
                }
            });

        const {logLevel} = this.parseArgs();
        log.setLevel(logLevel);
    }

    parseArgs () {
        const scriptArgs = process.argv.slice(2);
        let logLevel = 'error';

        for (const arg of scriptArgs) {
            const argSplit = arg.split(/--log-level(\s+|=)/);
            if (argSplit[1] === '=') {
                logLevel = argSplit[2];
            }
        }
        return {logLevel};
    }

    /**
     * Start a server listening for connections.
     * @param {number} port - the port to listen.
     * @param {string} host - the host to listen.
     */
    listen (port, host) {
        if (port) {
            this._port = port;
        }
        if (host) {
            this._host = host;
        }

        this._httpServer.listen(this._port, '0.0.0.0', () => {
            this.emit('ready');
            log.info(`\x1B[32mOpenblock link server start successfully\nSocket server listend: http://${this._host}:${this._port}\x1B[0m`);
        });

        this._httpServer.on('error', e => {
            if (e.code === 'EADDRINUSE') {
                this.emit('address-in-use');
                log.debug('Address in use, retrying...');
                setTimeout(() => {
                    this._httpServer.close();
                    this._httpServer.listen(this._port, this._host);
                }, 1000);
            } else {
                log.error(e);
            }
        });
    }
}

module.exports = OpenBlockLink;
