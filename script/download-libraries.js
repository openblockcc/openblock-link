const downloadRelease = require('download-github-release');
const path = require('path');
const fs = require('fs');

const user = 'OttawaSTEM';
const repo = 'scratch-arduino-libraries';
const outputdir = path.resolve('./tools/Arduino/libraries');
const leaveZipped = false;

const filterRelease = release => release.prerelease === false;

const filterAsset = () => true;

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
