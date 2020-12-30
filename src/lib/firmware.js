const firmware = {
    // Arduino UNO
    'arduino:avr:uno': 'arduinoUno.standardFirmata.hex',
    // Arduino Nano
    'arduino:avr:nano:cpu=atmega328': 'arduinoUno.standardFirmata.hex',
    // Arduino Leonardo
    'arduino:avr:leonardo': 'arduinoLeonardo.standardFirmata.hex',
    // Arduino Mega 2560
    'arduino:avr:mega:cpu=atmega2560': 'arduinoMega2560.standardFirmata.hex'
};

module.exports = firmware;
