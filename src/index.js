const http = require('http');
const url = require('url');
const {Server} = require('ws');
const Emitter = require('events');
const path = require('path');
const fetch = require('node-fetch');
const clc = require('cli-color');

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
 * Server name, ues in root path.
 * @readonly
 */
const SERVER_NAME = 'openblock-link-server';

/**
 * The time interval for retrying to open the port after the port is occupied by another openblock-resource server.
 * @readonly
 */
const REOPEN_INTERVAL = 1000 * 1;

/**
 * Configuration the server routers.
 * @readonly
 */
const ROUTERS = {
    '/openblock/ble': require('./session/ble'), // eslint-disable-line global-require
    '/openblock/serialport': require('./session/serialport') // eslint-disable-line global-require
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
        this._httpServer = http.createServer();
        this._socketServer = new Server({server: this._httpServer});

        this._socketServer.on('connection', (socket, request) => {
            const {pathname} = url.parse(request.url);
            const Session = ROUTERS[pathname];
            let session;
            if (Session) {
                session = new Session(socket, this.userDataPath, this.toolsPath);
                console.info('new connection');
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
                    console.error(clc.red(`ERR!: ${e}`));
                }
            });
    }

    isSameServer (host, port) {
        return new Promise((resolve, reject) => {
            fetch(`http://${host}:${port}`)
                .then(res => res.text())
                .then(text => {
                    if (text === SERVER_NAME) {
                        return resolve(true);
                    }
                    return resolve(false);
                })
                .catch(err => reject(err));
        });
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

        this._httpServer.on('request', (request, res) => {
            if (request.url === '/') {
                res.writeHead(200, {'Content-Type': 'text/html'});
                res.end(SERVER_NAME);
            }
        });

        this._httpServer.on('error', e => {
            this.isSameServer('127.0.0.1', this._port).then(isSame => {
                if (isSame) {
                    console.log(`Port is already used by other openblock-link server, will try reopening after ${REOPEN_INTERVAL} ms`); // eslint-disable-line max-len
                    setTimeout(() => {
                        this._httpServer.close();
                        this._httpServer.listen(this._port, this._host);
                    }, REOPEN_INTERVAL);
                    this.emit('port-in-use');
                } else {
                    const info = `ERR!: error while trying to listen port ${this._port}: ${e}`;
                    console.error(clc.red(info));
                    this.emit('error', info);
                }
            });
        });

        this._httpServer.listen(this._port, '0.0.0.0', () => {
            this.emit('ready');
            console.info(clc.green(`Openblock link server start successfully, socket listen on: http://${this._host}:${this._port}`));
        });
    }
}

module.exports = OpenBlockLink;
