const log = require('loglevel');
const OpenBlockLink = require('../src/index');

const link = new OpenBlockLink();
link.listen();

link.on('ready', () => {
    log.info('Server is ready.');
});

link.on('address-in-use', () => {
    log.info('Address in use.');
});
