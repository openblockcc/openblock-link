const downloadRelease = require('download-github-release');
const path = require('path');
const fs = require('fs');

const user = 'OttawaSTEM';
const repo = 'scratch-arduino-tools';
const outputdir = path.resolve('./');
const leaveZipped = false;

const filterRelease = release => release.prerelease === false;

const filterAsset = asset => {
    if (process.platform === 'win32') {
        return (asset.name.indexOf('Win') > 0);
    } else if (process.platform === 'darwin') {
        return (asset.name.indexOf('MacOS') > 0);
    }
}

if (!fs.existsSync(outputdir)) {
    fs.mkdirSync(outputdir, {recursive: true});
}

downloadRelease(user, repo, outputdir, filterRelease, filterAsset, leaveZipped)
    .then(() => {
        console.log('Libraries download complete.');
    })
    .catch(err => {
        console.error(err.message);
    });
