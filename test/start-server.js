const OpenBlockLink = require('../src/index');

const link = new OpenBlockLink();
link.listen();

link.on('ready', () => {
    console.info('Server is ready.');
});

link.on('address-in-use', () => {
    console.info('Address in use.');
});
