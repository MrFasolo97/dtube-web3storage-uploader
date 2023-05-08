import readline from 'readline';
import trimOffNewlines from 'trim-off-newlines';
import { readFileSync } from 'fs';
import tus from 'tus-js-client';
import mime from 'mime';
import { javalon } from './javalon.js';

let username;
let pubkey;
let privkey;
const testFile = 'test.txt';
const proto = 'http';
const domain = 'upload.dtube.fso.ovh';
const uploadPort = '1080';
const uploadEndpoint = `${proto}://${domain}:${uploadPort}/upload`;

let headers = {
  username: username,
  pubkey: pubkey,
  ts: 0,
  signature: null,
};

function freshenHeaders() {
  const ts = Date.now();
  headers = {
    username: username,
    pubkey: pubkey,
    ts: ts,
    signature: Buffer.from(JSON.stringify(javalon.signData(privkey, pubkey, `${username}_${ts}`, ts, username)), 'utf8').toString('base64'),
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

console.log(`Testing with ${(mime.getType(`./${testFile}`))} file`);

let uploading = false;

function post() {
  console.log('Uploading...');
  // Get the selected file from the input element
  const file = readFileSync(testFile);
  // Create a new tus upload
  freshenHeaders();
  const upload = new tus.Upload(file, {
    // Endpoint is the upload creation URL from your tus server
    endpoint: uploadEndpoint,
    // Retry delays will enable tus-js-client to automatically retry on errors
    retryDelays: [0, 3000, 5000],
    // Attach additional meta data about the file for the server
    headers,
    metadata: {
      filename: testFile,
      filetype: file.type,
      username: username,
      pubkey: pubkey,
    },
    // Callback for errors which cannot be fixed using retries
    onError(error) {
      console.log(`Failed because: ${error}`);
    },
    // Callback for reporting upload progress
    onProgress(bytesUploaded, bytesTotal) {
      const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
      console.log(bytesUploaded, bytesTotal, `${percentage}%`);
    },
    // Callback for once the upload is completed
    onSuccess() {
      console.log('Download %s from %s', upload.file.name, upload.url);
    },
  });

  // Check if there are any previous uploads to continue.
  upload.findPreviousUploads().then((previousUploads) => {
    // Found previous uploads so we select the first one.
    if (previousUploads.length) {
      console.log(previousUploads);
      upload.resumeFromPreviousUpload(previousUploads[0]);
    }
    upload.start();
  }).catch((reason) => {
    console.log(reason);
  });
}


javalon.init();

process.stdout.write('Username: ');
rl.on('line', (line) => {
  if (typeof username === 'undefined') {
    username = trimOffNewlines(line);
    process.stdout.write('Private Key: ');
  } else if (typeof privkey === 'undefined') {
    privkey = trimOffNewlines(line);
    pubkey = javalon.privToPub(privkey);
  }
  if (typeof privkey !== 'undefined' && !uploading) {
    freshenHeaders();
    post();
    uploading = true;
  }
});

rl.once('close', () => {
  // end of input
});
