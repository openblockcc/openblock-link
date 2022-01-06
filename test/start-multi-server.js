const log = require('loglevel');
const OpenBlockLink = require('../src/index');

const link1 = new OpenBlockLink();
const link2 = new OpenBlockLink();
const link3 = new OpenBlockLink();

link1.on('ready', () => {
    log.info('link1: Server is ready.');
});

link1.on('address-in-use', () => {
    log.info('link1: Address in use.');
});

link2.on('ready', () => {
    log.info('link2: Server is ready.');
});

link2.on('address-in-use', () => {
    log.info('link2: Address in use.');
});

link3.on('ready', () => {
    log.info('link3: Server is ready.');
});

link3.on('address-in-use', () => {
    log.info('link3: Address in use.');
});

link1.listen(20111, '127.0.0.1');
link2.listen(20111, '0.0.0.0');
link3.listen(20112, '0.0.0.0');
