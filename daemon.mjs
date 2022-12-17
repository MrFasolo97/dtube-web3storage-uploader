import process, { exit } from 'process';
import { Command } from 'commander';
import { Web3Storage, getFilesFromPath } from 'web3.storage';
import express from 'express';
import * as fs from 'fs';
import log4js from 'log4js';
import sanitize from 'sanitize-filename';
import tus from 'tus-node-server';
import version from 'project-version';
import { javalon } from './javalon.js';

let configJSON = {};
const { EVENTS } = tus;
const tusServer = new tus.Server({ path: '/files' });
let filesUploaded = {};

tusServer.datastore = new tus.FileStore({
  path: '/files',
});

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
  .option('-t, --token <token>', 'API Token')
  .option('-d, --daemon', 'Run as daemon', false)
  .option('-c, --config <file>', 'Config file', './config.json');

const logger = log4js.getLogger();

async function uploadFile(web3token2, fileName, uploadedBy) {
  const filePath = `files/${fileName}`;
  if (!web3token2) {
    return logger.error('A token is needed. You can create one on https://web3.storage');
  }
  logger.info(`[ ${uploadedBy} ] ${filePath}`);
  const storage = new Web3Storage({ token: web3token2 });
  const file = await getFilesFromPath(filePath);
  const cid = await storage.put(file, { wrapWithDirectory: false });
  logger.info(`[ ${uploadedBy} ] Content added with CID: ${cid}`);
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) {
        logger.error(err.message);
      }
      // if no error, file has been deleted successfully
      logger.info(`File ${filePath} deleted!`);
    });
  }
  filesUploaded[fileName].cid = cid;
  filesUploaded[fileName].progress = 'uploaded';
  return cid;
}

tusServer.on(EVENTS.EVENT_UPLOAD_COMPLETE, async (event) => {
  logger.info(`Receive complete for file ${event.file.id}`);
  const username = Buffer.from(await event.file.upload_metadata.split('username ').pop().split(',')[0], 'base64').toString('ascii');
  let signature = Buffer.from(await event.file.upload_metadata.split('signature ').pop().split(',')[0], 'base64').toString('ascii');
  signature = JSON.parse(signature);
  if (javalon.signVerify(signature, username, 60 * 60 * 1000)) {
    filesUploaded[event.file.id].progress = 'uploading';
    uploadFile(web3token, sanitize(event.file.id), username);
  }
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

program.parse(process.argv);
const opts = program.opts();

if (fs.existsSync(opts.config)) {
  configJSON = JSON.parse(fs.readFileSync(opts.config));
} else {
  logger.fatal('Config file not found!');
  exit();
}

const web3token = opts.token || configJSON.web3token;
const port = configJSON.port || 5000;

const app = express();

function authenticateRequest(req, res, next) {
  return new Promise((resolve, reject) => {
    if (['POST', 'PATCH', 'GET'].includes(req.method) && typeof req.headers['username'] !== 'undefined' && typeof req.headers['ts'] !== 'undefined' && typeof req.headers['signature'] !== 'undefined' && typeof req.headers['pubkey'] !== 'undefined') {
      const signature = JSON.parse(req.headers['signature']);
      if (signature['ts'] > (Date.now() - 60000)) {
        const prom = javalon.signVerify(signature, req.headers['username'], 60000);
        if (!prom) {
          logger.debug('Invalid signature');
          res.send({ status: 'error', error: 'Invalid signature!' });
        } else {
          logger.debug('Got correct signature.');
          if (typeof next === 'function') next(req, res);
          else resolve(true);
        }
      } else if (typeof signature['ts'] === 'number') {
        res.send({ status: 'error', error: 'Timestamp expired.' });
        reject(new Error('Authentication not valid'));
      } else {
        res.send({
          status: 'error',
          error: 'Invalid timestamp.',
          type: typeof signature['ts'],
          value: signature['ts'],
        });
        reject(new Error('Authentication not valid'));
      }
    } else if (typeof req.headers['username'] === 'undefined' && ['POST', 'PATCH'].includes(req.method)) {
      res.send({ status: 'error', error: 'Username not specified!' });
      reject(new Error('Authentication not valid'));
    } else if (req.method === 'GET') {
      res.send({ version, app: 'dtube-web3storage-uploader' });
      resolve(true);
    } else {
      reject(new Error('Authentication not valid'));
    }
  });
}

app.get('/progress/:token', (req, res) => {
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

const uploadApp = express();
const uploadRouter = express.Router();
uploadRouter.all('*', (req, res) => authenticateRequest(req, res).then(() => tusServer.handle(req, res)).catch((reason) => {
  logger.warn(reason);
}));
app.use('/upload', uploadRouter);

app.all('/', (req, res) => authenticateRequest(req, res).then(() => res.send({ version, app: 'dtube-web3storage-uploader' })).catch(() => { res.send({ status: 'error', error: 'authentication not valid' }); }));

if (opts.daemon) {
  app.listen(port, () => {
    logger.info(`Listening on port ${port}`);
  });
  uploadApp.listen(1082, () => {
    logger.info('TUS listening on port 1082');
  });
}
