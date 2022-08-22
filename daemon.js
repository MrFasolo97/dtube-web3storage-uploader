import process from 'process'
import { Command } from 'commander'
import { Web3Storage, getFilesFromPath } from 'web3.storage'
import express from 'express'
import multer from 'multer'
import * as fs from 'fs'

let filesUploaded = {}

const app = express()
const upload = multer({ dest: 'tmp/' })

app.get('/', (req, res) => {
    res.send('Hello World!')
})


app.post('/uploadVideo', upload.single("video"), (req, res, next) => {
    let file = req.file
    if (typeof file !== 'undefined') {
        let file_name = file.filename
        filesUploaded[file_name] = {}
        filesUploaded[file_name]["progress"] = "incomplete"
        uploadFile(web3token, file_name)
        res.send({"status": "ok", "token": file_name})
    } else {
        res.send({"status": "error", "error": "file parameter not specified!"})
    }
})


app.get('/progress/:token', (req, res, next) => {
    if (filesUploaded[req.params.token] !== null) {
        res.send(filesUploaded[req.params.token])
        if (filesUploaded[req.params.token].progress == "complete") {
            delete filesUploaded[req.params.token]
        }
    } else {
        res.send({"status": "error", "error": "Token not found."})
    }
})


async function uploadFile (web3token, file_name) {
    let file_path = 'tmp/' + file_name
    if (!web3token) {
        return console.error('A token is needed. You can create one on https://web3.storage')
    }
    console.log(file_path)
    const storage = new Web3Storage({ token: web3token })
    const file = await getFilesFromPath(file_path)
    const cid = await storage.put(file, { wrapWithDirectory: false })
    console.log('Content added with CID:', cid)
    fs.unlink(file_path, function (err) {
        if (err) throw err
        // if no error, file has been deleted successfully
        console.log('File '+file_path+' deleted!')
    })
    filesUploaded[file_name]['cid'] = cid
    filesUploaded[file_name]['progress'] = 'complete'
    return cid
}

const program = new Command()
program
    .option('-t, --token <token>', 'API Token')
    .option('-d, --daemon', 'Run as daemon', false)
    .option('-c, --config <file>', 'Config file', './config.json')

program.parse(process.argv)
let opts = program.opts()
let configJSON = JSON.parse(fs.readFileSync(opts.config))
const web3token = opts.token || configJSON.web3token
const port = configJSON.port || 5000

if (opts.daemon) {
    app.listen(port, () => {
        console.log(`Listening on port ${port}`)
    })
}
