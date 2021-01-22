/* eslint-disable */
const downloadRelease = require('download-github-release');
const path = require('path');
const os = require('os');
const fs = require('fs');

const user = 'openblockcc';
const repo = 'openblock-realtime-firmware';
const outputdir = path.join(__dirname, '../tools/RealtimeFirmware');
const leaveZipped = false;

function filterRelease (release) {
    return release.prerelease === false;
}

function filterAsset() {
    return true;
}

if (!fs.existsSync(outputdir)) {
    fs.mkdirSync(outputdir, {recursive: true});
}

downloadRelease(user, repo, outputdir, filterRelease, filterAsset, leaveZipped)
    .then(() => {
        console.log('Realtime firmware download complete');
    })
    .catch(err => {
        console.error(err.message);
    });
