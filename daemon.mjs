import process, { exit } from 'process';
import { Command } from 'commander';
import express from 'express';
import * as fs from 'fs';
import log4js from 'log4js';
import sanitize from 'sanitize-filename';
import version from 'project-version';
import { randomInt } from 'crypto';

let configJSON = {};

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
  if (configJSON.storage_providers == null) {
    logger.fatal('Storage provider(s) list must be set!');
    exit();
  }
} else {
  logger.fatal('Config file not found!');
  exit();
}

const port = configJSON.port || 5000;

const storageStore = [];

function loadStoragePlugins(configJSONRef) {
  for (let i = 0; i < configJSONRef.storage_providers.length; i += 1) {
    import(`./storage_providers/${configJSONRef.storage_providers[i]}.mjs`).then((res) => {
      storageStore.push({ store: res.default });
    });
  }
}

loadStoragePlugins(configJSON);

// Takes 3 parameters:
// a config Object, file's name as string and string defining the original uploader.
async function uploadFile(configJSONRef, fileId, uploadedBy, cb) {
  let ret;
  const fileName = sanitize(fileId);
  logger.info(storageStore);
  logger.info(`Uploading file ${fileName} for user ${uploadedBy}`);
  if (typeof storageStore === 'object') {
    for (let i = 0; i < storageStore.length; i += 1) {
      if (typeof storageStore[i] === 'object') {
        if (typeof storageStore[i].store === 'function') {
          storageStore[i].store(configJSONRef, logger, fileName, uploadedBy, cb);
        } else {
          logger.error(`Type of storageStore[i].store is ${typeof storageStore[i].store}`);
          logger.error(`Its content is ${storageStore[i].store}`);
        }
      } else {
        logger.error(`Type of storageStore[i] is ${typeof storageStore[i]}`);
        logger.error(`Its content is ${storageStore[i]}`);
      }
    }
  } else {
    logger.error(`Type of storageStore is ${typeof storageStore}`);
  }
  logger.info(ret);
  filesUploaded[fileId] = ret;
  logger.info(filesUploaded[fileId]);
  fs.unlink(`./files/${fileName}`, (err) => {
    if (err) {
      logger.error(`Error deleting file ${fileName}!`);
      logger.error(err);
    } else {
      logger.debug(`File ${fileName} deleted!`);
    }
  });
}
// returns IPFS cid(s) as string or JSON array.

function saveUploadData(fileID, data, safe = true) {
  return new Promise((resolve, reject) => {
    if (!safe || typeof filesUploaded[fileID] === 'undefined') {
      filesUploaded[fileID] = data;
      resolve(true);
    } else {
      reject(new Error('Unable to overwrite upload data safely.'));
    }
  });
}

// const app = express();

const uploadApp = express();
uploadApp.use(express.json());

uploadApp.get('/progress/:token', async (req, res) => {
  const { token } = req.params;
  // logger.debug(token);
  if (typeof filesUploaded[token] !== 'undefined' && typeof filesUploaded[token].progress !== 'undefined') {
    if (filesUploaded[token].progress === 'uploaded') {
      const tmp = filesUploaded[token];
      delete filesUploaded[token];
      res.send(tmp);
    } else {
      res.send(filesUploaded[token]);
    }
  } else if (typeof filesUploaded[token] === 'undefined') {
    res.send({ status: 'unknown' });
  }
});

uploadApp.get('/version', (req, res) => res.send({ version, app: 'dtube-web3storage-uploader' }));

if (opts.daemon) {
  uploadApp.post('/hooks', async (req, res) => {
    const upload = req.body.Upload;
    if (req.headers['hook-name'] === 'post-finish') {
      logger.info(`Receive complete for file ${upload.ID}`);
      await saveUploadData(upload.ID, { progress: 'uploading' }, false).then(async () => {
        await uploadFile(configJSON, upload.ID, upload.MetaData.username, (res2) => {
          if (res2 !== false) {
            let ret = {};
            if (typeof res2 === 'string') {
              ret.cid = res2;
              ret.progress = 'uploaded';
            } else if (typeof res2 === 'object') {
              if (res2.length === 1) {
                ret.cid = res2[0];
                ret.progress = 'uploaded';
              } else if (res2.length > 1) {
                ret.cid = res2[randomInt(res2.length)];
                ret.cid_list = res2;
                ret.progress = 'uploaded';
              }
            }
            saveUploadData(upload.ID, ret, false);
          }
        });
      });
    } else if (req.headers['hook-name'] === 'post-create') {
      await saveUploadData(upload.ID, { progress: 'receiving' });
    } else if (req.headers['hook-name'] === 'post-terminate') {
      logger.info('Upload terminated early!');
      fs.unlink(`./files/${upload.ID}`, (err) => {
        if (err) {
          logger.error(`Error deleting file ${upload.ID}!`);
          logger.error(err);
        } else {
          logger.debug(`File ${upload.ID} deleted!`);
        }
      });
    }
  });
  uploadApp.listen(port);
  logger.info(`Listening on port ${port}`);
}
