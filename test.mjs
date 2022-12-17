import { fileTypeFromFile } from 'file-type';
import readline from 'readline';
import trimOffNewlines from 'trim-off-newlines';
import { readFileSync } from 'fs';
import tus from 'tus-js-client';
import * as fs from 'fs';
import javalon from './javalon.js';
import CryptoJS from 'crypto-js';

let configJSON = null;
const config = 'config.json';

if (fs.existsSync(config)) {
  configJSON = JSON.parse(fs.readFileSync(config));
} else {
  console.log('Config file not found!');
  process.exit();
}

let username;
let pubkey;
let privkey;
let testFile = 'test.m4v';
const { apiKey } = configJSON;
const proto = 'https';
const domain = 'dtube.fso.ovh';
const port = '5082';
const endpoint = `${proto}://${domain}:${port}/upload`;

let headers = {
  apikey: apiKey,
  username: username,
  pubkey: pubkey,
  ts: 0,
  signature: null,
}

function freshenHeaders() {
  let ts = Date.now();
  headers = {
    apikey: apiKey,
    username: username,
    pubkey: pubkey,
    ts: ts,
    signature: JSON.stringify(javalon.signData(privkey, pubkey, `${username}_${ts}`, username)),
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

console.log(`Testing with ${(await fileTypeFromFile(`./${testFile}`)).mime} file`);

let uploading = false;

function post() {
  // Get the selected file from the input element
  const file = readFileSync(testFile);
  // Create a new tus upload
  const ts = Date.now();
  fs.readFile(testFile, "utf8", (err, data) => {
    if (!err) {
      CryptoJS.SHA256(data);
    }
  });
  const upload = new tus.Upload(file, {
    // Endpoint is the upload creation URL from your tus server
    endpoint: endpoint,
    // Retry delays will enable tus-js-client to automatically retry on errors
    retryDelays: [0, 3000, 5000],
    // Attach additional meta data about the file for the server
    headers: headers,
    metadata: {
      filename: testFile,
      filetype: file.type,
      username: username,
      pubkey: pubkey,
      signature: JSON.stringify(javalon.signData(privkey, pubkey, CryptoJS.SHA256(), username)),
    },
    // Callback for errors which cannot be fixed using retries
    onError(error) {
      console.log(`Failed because: ${error}`);
    },
    // Callback for reporting upload progress
    onProgress(bytesUploaded, bytesTotal) {
      freshenHeaders();
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
    // Start the upload
    upload.start();
  });
}

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
