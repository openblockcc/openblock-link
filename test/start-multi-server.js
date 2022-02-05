const OpenBlockLink = require('../src/index');

const link1 = new OpenBlockLink();
const link2 = new OpenBlockLink();
const link3 = new OpenBlockLink();

link1.on('ready', () => {
    console.info('link1: Server is ready.');
});

link1.on('port-in-use', () => {
    console.info('link1: Address in use.');
});

link2.on('ready', () => {
    console.info('link2: Server is ready.');
});

link2.on('port-in-use', () => {
    console.info('link2: Address in use.');
});

link3.on('ready', () => {
    console.info('link3: Server is ready.');
});

link3.on('port-in-use', () => {
    console.info('link3: Address in use.');
});

link1.listen(20111, '127.0.0.1');
link2.listen(20111, '0.0.0.0');
link3.listen(20112, '0.0.0.0');
