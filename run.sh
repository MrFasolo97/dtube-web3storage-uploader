#!/bin/bash
PATH=$PATH:$HOME/.bun/bin
bun run daemon &
bun run proxy &
