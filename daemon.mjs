import process, { exit } from 'process';
import { Command } from 'commander';
import https from 'https';
import mime from 'mime';
import express from 'express';
import * as fs from 'fs';
import log4js from 'log4js';
import sanitize from 'sanitize-filename';
import tus from 'tus-node-server';
import version from 'project-version';
import tusMetadata from 'tus-metadata';
import javalon from './javalon.js';

let configJSON = {};
const { EVENTS } = tus;
const tusServer = new tus.Server(
  {
    path: '/',
  },
);

tusServer.datastore = new tus.FileStore({
  path: '/download',
  directory: './files',
});

const filesUploaded = {};

const LOG_LEVEL = 'debug';

log4js.configure({
  appenders: {
    logs: { type: 'file', filename: 'logs/logs.log' },
    console: { type: 'console' },
  },
  categories: {
    logs: { appenders: ['logs'], level: 'trace' },
    console: { appenders: ['console'], level: 'trace' },
    default: { appenders: ['console', 'logs'], level: 'info' },
  },
});

const program = new Command();
program
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-c, --config <file>', 'Config file', './config.json');

const logger = log4js.getLogger();
logger.level = LOG_LEVEL;

program.parse(process.argv);
const opts = program.opts();

if (fs.existsSync(opts.config)) {
  configJSON = JSON.parse(fs.readFileSync(opts.config));
  if (configJSON.storage_provider == null) {
    logger.fatal('Storage provider must be set!');
    exit();
  }
} else {
  logger.fatal('Config file not found!');
  exit();
}

const port = configJSON.port || 5000;

const { default: storageStore } = await import(`./storage_providers/${configJSON.storage_provider}.mjs`);

// Takes 3 parameters:
// a config Object, file's name as string and string defining the original uploader.
async function uploadFile(configJSONRef, fileName, uploadedBy) {
  const cid = await storageStore(configJSONRef, logger, fileName, uploadedBy);
  filesUploaded[fileName].cid = cid;
  filesUploaded[fileName].progress = 'uploaded';
  return cid;
}
// returns IPFS cid

tusServer.on(EVENTS.EVENT_UPLOAD_COMPLETE, async (event) => {
  logger.info(`Receive complete for file ${event.file.id}`);
  const uploadMetadata = tusMetadata.decode(event.file.upload_metadata);
  filesUploaded[event.file.id].progress = 'uploading';
  await uploadFile(configJSON, sanitize(event.file.id), uploadMetadata.username);
});

tusServer.on(EVENTS.EVENT_ENDPOINT_CREATED, async (event) => {
  const id = await event.url.substring(event.url.lastIndexOf('/') + 1);
  filesUploaded[id].progress = 'waiting';
  logger.info(`Endpoint created with id ${id}`);
});

tusServer.on(EVENTS.EVENT_FILE_CREATED, async (event) => {
  const { id } = event.file;
  filesUploaded[event.file.id] = new Map();
  logger.info(`File created with id ${id}`);
  filesUploaded[event.file.id].progress = 'receiving';
});

// const app = express();
async function authenticateRequest(req, res, next) {
  let signature = Buffer.from(`${req.headers.signature}`, 'base64url').toString('utf8');

  if (typeof signature === 'string') {
    try {
      signature = await JSON.parse(signature);
    } catch (e) {
      logger.warn(e);
    }
  } else {
    logger.warn(`Type of signature= ${typeof signature}`);
  }
  // let signature = req.headers.signature;
  let r;
  logger.debug(signature);
  if (['POST', 'PATCH', 'GET', 'HEAD'].includes(req.method) && typeof signature.username !== 'undefined' && typeof signature.ts !== 'undefined' && typeof req.headers.signature !== 'undefined' && typeof signature.pubkey !== 'undefined') {
    const { ts } = signature;
    if (ts > (Date.now() - 3600000)) {
      try {
        r = javalon.signVerify(signature, signature.username, 3600000);
        logger.debug('Got correct signature.');
        if (typeof next === 'function') next(req, res);
        else r = true;
      } catch (reason) {
        logger.debug('Invalid signature');
        logger.debug(reason);
        res.send({ status: 'error', error: 'Invalid signature!' });
      }
    } else if (typeof ts === 'number') {
      res.send({ status: 'error', error: 'Timestamp expired.' });
      logger.debug('Authentication not valid, timestamp expired!');
    } else if (typeof ts !== 'number') {
      res.send({
        status: 'error',
        error: 'Invalid timestamp.',
        type: typeof ts,
        value: signature.ts,
      });
      logger.debug(typeof ts);
    } else {
      logger.debug('Authentication not valid, unknown error!');
    }
  } else if (typeof signature.username === 'undefined' && ['POST', 'PATCH', 'HEAD'].includes(req.method)) {
    logger.debug('Username not specified!');
    res.send({ status: 'error', error: 'Username not specified!' });
  } else if (req.method === 'GET' && typeof signature.username === 'undefined') {
    // logger.info('Got appInfo request...');
    // res.send({ version, app: 'dtube-web3storage-uploader' });
    // r = true;
  } else {
    logger.warn('Auth not valid!');
    logger.warn(`Req method: ${req.method}`);
    logger.warn(`Req headers: ${req.headers.toString()}`);
  }
  return r;
}

const uploadApp = express();
const authApp = express();

uploadApp.all('*', (req, res) => tusServer.handle(req, res).catch((reason) => {
  logger.warn(reason);
}));

authApp.get('/progress/:token', (req, res) => {
  const { token } = req.params;
  logger.debug(token);
  if (typeof filesUploaded[token] !== 'undefined' && filesUploaded[token].progress !== null) {
    if (filesUploaded[token].progress === 'received') {
      filesUploaded[token].progress = 'uploading';
      res.send(filesUploaded[token]);
    } else if (filesUploaded[token].progress === 'uploaded') {
      const tmp = filesUploaded[token];
      delete filesUploaded[token];
      res.send(tmp);
    } else {
      res.send(filesUploaded[token]);
    }
  } else {
    res.send({ status: 'error', error: 'Token not found.' });
  }
});

authApp.get('/version', (req, res) => res.send({ version, app: 'dtube-web3storage-uploader' }).catch((reason) => logger.warn(reason)));

const authUpload = (req, res) => {
  if (authenticateRequest(req, res) || true) { // bypass authentication, as it is not complete rn.
    uploadApp(req, res);
  } else {
    logger.debug('Request not authed!');
  }
};

authApp.get('/upload', authUpload);
authApp.post('/upload', authUpload);
authApp.head('/upload', authUpload);
authApp.patch('/upload', authUpload);

authApp.get('/download/:filename', (req, res) => {
  const { filename } = req.params;
  logger.debug(filename);
  if (fs.existsSync(`./files/${filename}`)) {
    const mimetype = mime.lookup(`./files/${filename}`);
    logger.debug(filename);
    res.setHeader('Content-disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-type', mimetype);
    logger.debug(mimetype);
    const fileContent = fs.readFileSync(`./files/${filename}`);
    res.send(fileContent);
  } else {
    logger.debug(`${filename} not found!`);
    res.status(404).send('File not found');
  }
});

if (opts.daemon) {
  https.createServer(
    // Provide the private and public key to the server by reading each
    // file's content with the readFileSync() method.
    {
      key: fs.readFileSync(`${configJSON.cert_directory}/privkey.pem`),
      cert: fs.readFileSync(`${configJSON.cert_directory}/cert.pem`),
      ca: fs.readFileSync('./certs/3334561879.crt'),
    },
    authApp,
  ).listen(port, '0.0.0.0', () => { logger.info(`TUS Auth listening on port ${port}`); });
}
