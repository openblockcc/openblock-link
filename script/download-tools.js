const downloadRelease = require('download-github-release');
const path = require('path');
const os = require('os');
const fs = require('fs');

const user = 'openblockcc';
const repo = 'openblock-tools';
const outputdir = path.resolve('./tools');
const leaveZipped = false;

const filterRelease = release => release.prerelease === false;

const filterAsset = asset => (asset.name.indexOf(os.platform()) >= 0) && (asset.name.indexOf(os.arch()) >= 0);

if (!fs.existsSync(outputdir)) {
    fs.mkdirSync(outputdir, {recursive: true});
}

downloadRelease(user, repo, outputdir, filterRelease, filterAsset, leaveZipped)
    .then(() => {
        console.log('Tools download complete');
    })
    .catch(err => {
        console.error(err.message);
    });
