const axios = require('axios');
const os = require('os');
const fs = require('fs');
const ProgressBar = require('progress');
const path = require('path');
const crypto = require('crypto');
const {extractFull} = require('node-7z');
const {path7za} = require('7zip-bin');

// GitHub API URL, fill in your repository and username
const user = 'openblockcc';
const repo = 'openblock-tools';
const downloadPath = './tmp'; // Path to store downloaded files (cached)
const extractPath = './tools'; // Path where files will be extracted

const releaseApiUrl = `https://api.github.com/repos/${user}/${repo}/releases/latest`;
const systemPlatform = os.platform(); // 'win32', 'linux', 'darwin'

// Helper function to format bytes into human-readable units
const formatBytes = bytes => {
    if (bytes >= 1e9) {
        return `${(bytes / 1e9).toFixed(2)} GB`;
    } else if (bytes >= 1e6) {
        return `${(bytes / 1e6).toFixed(2)} MB`;
    } else if (bytes >= 1e3) {
        return `${(bytes / 1e3).toFixed(2)} KB`;
    }
    return `${bytes} B`;
};

// Extract 7z file
const extract7zFile = (filePath, fileName) => {
    const outputDir = path.join(extractPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, {recursive: true});
    }

    console.log(`Extracting ${fileName} to ${outputDir}...`);

    const bar = new ProgressBar('Extracting [:bar] :percent', {
        width: 40,
        total: 100,
        renderThrottle: 500,
        clear: true
    });

    const sevenStream = extractFull(filePath, outputDir, {
        $bin: path7za,
        $progress: true
    });

    sevenStream.on('progress', progress => {
        bar.update(progress.percent / 100);
    });

    sevenStream.on('end', () => {
        bar.update(1);
        console.log(`Successfully extracted ${fileName} to ${outputDir}`);
    });

    sevenStream.on('error', err => {
        console.error(`Error extracting ${fileName}:`, err);
    });
};

// Verify the checksum of the downloaded file
const verifyChecksum = async (filePath, expectedChecksum) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    console.log(`Verifying checksum for ${path.basename(filePath)}...`);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => {
        const calculatedChecksum = hash.digest('hex');
        if (calculatedChecksum === expectedChecksum.toLowerCase()) {
            console.log(`Checksum verified for ${path.basename(filePath)}`);
            resolve(true);
        } else {
            console.error(`Checksum mismatch for ${path.basename(filePath)}`);
            resolve(false);
        }
    });
    stream.on('error', reject);
});

// Download and verify file against checksum
const downloadAndVerifyFile = async (fileUrl, filePath, expectedChecksum) => new Promise(async (resolve, reject) => {
    try {
        const {headers} = await axios.head(fileUrl);
        const fileSize = parseInt(headers['content-length'], 10);

        // Setup progress bar
        const bar = new ProgressBar('Downloading [ :bar ] :percent :etas :speed', {
            total: fileSize,
            width: 40,
            renderThrottle: 500,
            clear: true
        });

        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), {recursive: true});
        }

        const writer = fs.createWriteStream(filePath);
        const response = await axios.get(fileUrl, {responseType: 'stream'});

        let bytesDownloaded = 0;
        const startTime = Date.now();

        response.data.on('data', chunk => {
            bytesDownloaded += chunk.length;
            bar.tick(chunk.length);

            const elapsedTime = (Date.now() - startTime) / 1000;
            const speed = (bytesDownloaded / elapsedTime) / 1024;
            bar.update(bytesDownloaded / fileSize, {
                speed: `${formatBytes(speed * 1024)}/s`
            });
        });

        response.data.pipe(writer);

        writer.on('finish', async () => {
            console.log(`\nDownloaded ${path.basename(filePath)} successfully`);

            if (expectedChecksum) {
                const isValid = await verifyChecksum(filePath, expectedChecksum);
                if (!isValid) {
                    console.log('Checksum failed, re-downloading the file...');
                    fs.unlinkSync(filePath);
                    return resolve(await downloadAndVerifyFile(fileUrl, filePath, expectedChecksum));
                }
            }
            resolve(true);
        });

        writer.on('error', err => {
            console.error('File write error:', err);
            reject(err);
        });

    } catch (error) {
        console.error('Download failed:', error);
        reject(error);
    }
});


// Download files
const downloadReleaseAssets = async () => {
    try {
        const {data} = await axios.get(releaseApiUrl);
        const assets = data.assets.filter(asset => asset.name.endsWith('.7z') && asset.name.includes(systemPlatform));

        if (assets.length === 0) {
            console.log(`No 7z file found for platform: ${systemPlatform}`);
            return false;
        }

        const checksumFile = data.assets.find(asset => asset.name.endsWith('-checksums-sha256.txt'));
        let checksums = {};

        if (checksumFile) {
            const checksumUrl = checksumFile.browser_download_url;
            const checksumData = await axios.get(checksumUrl);
            checksums = checksumData.data.split('\n').reduce((acc, line) => {
                const parts = line.split(/\s+/);
                if (parts.length > 1) {
                    acc[parts[1]] = parts[0]; // { 'filename.7z': 'checksum_value' }
                }
                return acc;
            }, {});
        }

        for (const asset of assets) {
            const fileName = asset.name;
            const fileUrl = asset.browser_download_url;
            const filePath = path.join(downloadPath, fileName);
            const expectedChecksum = checksums[fileName] || null;

            if (fs.existsSync(filePath) && expectedChecksum) {
                const isValid = await verifyChecksum(filePath, expectedChecksum);
                if (isValid) {
                    console.log(`File ${fileName} already exists and checksum matches. Skipping download.`);
                    extract7zFile(filePath, fileName);
                    continue;
                }
            }

            console.log(`Downloading ${fileName} from ${fileUrl}...`);
            const downloadSuccess = await downloadAndVerifyFile(fileUrl, filePath, expectedChecksum);
            if (!downloadSuccess) {
                return false;
            }

            extract7zFile(filePath, fileName);
        }

        return true;
    } catch (error) {
        console.error('Error fetching release:', error);
        return false;
    }
};

(async () => {
    const success = await downloadReleaseAssets();
    if (!success) {
        console.error('Download failed, returning error.');
        process.exit(1); // Return an error code if the download fails
    }
})();
