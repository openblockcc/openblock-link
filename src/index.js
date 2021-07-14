const ScratchArduinoLink = require('./server');

const link = new ScratchArduinoLink();
await link.checkUpdate();
link.listen();
