/* eslint-disable linebreak-style */
import { Command } from 'commander';
import axios from 'axios';
import * as fs from 'fs';
import javalon from 'javalon2';

const program = new Command();
program
  .name('check-progress');
program
  .option('-i, --id <id>', 'The server\'s side file ID', null)
  .option('-u, --username <username>', 'Username', null)
  .option('-p, --privkey <privkey>', 'The user\'s private key', null)
  .option('-c, --config <file>', 'Config file', './config.json');

program.parse(process.argv);
const opts = program.opts();
let configJSON = null;

if (fs.existsSync(opts.config)) {
  configJSON = JSON.parse(fs.readFileSync(opts.config));
} else {
  console.log('Config file not found!');
  process.exit();
}

console.log(opts.username);
const { apiKey } = configJSON;
const { username } = opts;
const privKey = opts.privkey;
const pubKey = javalon.privToPub(opts.privkey);

if (opts.id !== null) {
  const ts = Date.now();
  await axios.get(`http://upload.dtube.fso.ovh:5081/progress/${opts.id}`, {
    headers: {
      apikey: apiKey,
      username: username,
      pubKey: pubKey,
      signature: Buffer.from(JSON.stringify(javalon.signData(privKey, pubKey, `${username}_${ts}`, ts, username)), 'utf8').toString('base64'),
      ts: ts,
    },
  }).then((res) => {
    console.log(res.data);
  });
} else {
  console.log('Missing id, exiting!');
  process.exit(1);
}
