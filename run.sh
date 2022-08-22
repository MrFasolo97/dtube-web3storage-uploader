#!/bin/bash
PATH=$PATH:/home/$(whoami)/.bun/bin
bun run daemon
