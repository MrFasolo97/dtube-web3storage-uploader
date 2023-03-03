# dtube-web3storage-uploader
DTube's uploads middleman backend service

In the future, the storage provider plugin(s) will have it's config file or config directory like this:

storage_providers/{storage_provider}.mjs <- plugin script

storage_providers/{storage_provider}/ <- plugin config directory

or

storage_providers/{storage_provider}.ext <- config file with non mjs extension, most likely .json or .js extensions.
