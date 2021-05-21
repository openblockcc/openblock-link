const firmware = {
    // Arduino UNO
    'arduino:avr:uno': 'arduinoUno.standardFirmata.ino.hex',
    // Arduino UNO Ultra (Customized uno whitch has A6 A7 pins)
    'arduino:avr:unoUltra': 'arduinoUnoUltra.standardFirmata.ino.hex',
    // Arduino Nano
    'arduino:avr:nano:cpu=atmega328': 'arduinoUno.standardFirmata.ino.hex',
    // Arduino Mini
    'arduino:avr:mini:cpu=atmega328': 'arduinoUno.standardFirmata.ino.hex',
    // Arduino Leonardo
    'arduino:avr:leonardo': '',
    // Arduino Mega 2560
    'arduino:avr:mega:cpu=atmega2560': 'arduinoMega2560.standardFirmata.ino.hex'
};

module.exports = firmware;
