/* eslint-disable */
const downloadRelease = require('download-github-release');
const path = require('path');
const fs = require('fs');

const user = 'openblockcc';
const repo = 'openblock-firmwares';
const outputdir = path.join(__dirname, '../firmwares');
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
        console.log('Firmwares download complete');
    })
    .catch(err => {
        console.error(err.message);
    });
