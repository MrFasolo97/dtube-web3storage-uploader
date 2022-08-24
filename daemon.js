import process, { exit } from 'process';
import { Command } from 'commander';
import { Web3Storage, getFilesFromPath } from 'web3.storage';
import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import version from 'project-version';
import log4js from 'log4js';

log4js.configure({
  appenders: {
    logs: { type: 'file', filename: 'logs/logs.log' },
    console: { type: 'console' },
  },
  categories: {
    logs: { appenders: ['logs'], level: 'trace' },
    console: { appenders: ['console'], level: 'trace' },
    default: { appenders: ['console', 'logs'], level: 'trace' },
  },
});

const program = new Command();
program
  .option('-t, --token <token>', 'API Token')
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-c, --config <file>', 'Config file', './config.json');

const logger = log4js.getLogger();

program.parse(process.argv);
const opts = program.opts();
let configJSON = {};

if (fs.existsSync(opts.config)) {
  configJSON = JSON.parse(fs.readFileSync(opts.config));
} else {
  logger.fatal('Config file not found!');
  exit();
}

const web3token = opts.token || configJSON.web3token;
const port = configJSON.port || 5000;

const filesUploaded = {};

const app = express();
const upload = multer({ dest: 'tmp/' });

if (opts.daemon) {
  app.listen(port, () => {
    logger.info(`Listening on port ${port}`);
  });
}

async function uploadFile(web3token2, fileName, uploadedBy) {
  const filePath = `tmp/${fileName}`;
  if (!web3token2) {
    return logger.error('A token is needed. You can create one on https://web3.storage');
  }
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  const storage = new Web3Storage({ token: web3token2 });
  const file = await getFilesFromPath(filePath);
  const cid = await storage.put(file, { wrapWithDirectory: false });
  logger.info(`[ ${uploadedBy} ] Content added with CID: ${cid}`);
  fs.unlink(filePath, (err) => {
    if (err) throw err;
    // if no error, file has been deleted successfully
    logger.info(`File ${filePath} deleted!`);
  });
  filesUploaded[fileName].cid = cid;
  filesUploaded[fileName].progress = 'complete';
  return cid;
}

app.get('/', (req, res) => {
  res.send({ version, app: 'dtube-web3storage-uploader' });
});

app.post('/uploadVideo', upload.single('video'), (req, res) => {
  const { file } = req;
  if (typeof file !== 'undefined') {
    const fileName = file.filename;
    filesUploaded[fileName] = {};
    filesUploaded[fileName].progress = 'incomplete';
    filesUploaded[fileName].status = 'ok';
    uploadFile(web3token, fileName, req.headers['x-forwarded-for']);
    res.send({ status: 'ok', token: fileName });
  } else {
    res.send({ status: 'error', error: 'file parameter not specified!' });
  }
});

app.get('/progress/:token', (req, res) => {
  if (filesUploaded[req.params.token] !== null) {
    res.send(filesUploaded[req.params.token]);
    if (filesUploaded[req.params.token].progress === 'complete') {
      delete filesUploaded[req.params.token];
    }
  } else {
    res.send({ status: 'error', error: 'Token not found.' });
  }
});
