#!/bin/bash

ln -s /mnt/data/etc/wb-lighting-control/wb-lightings-settings.schema.json /usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json
ln -s /mnt/data/etc/wb-lighting-control/wb-lightnings-routines.js /mnt/data/etc/wb-rules/wb-lightnings-routines.js

# python3 /mnt/data/etc/wb-lighting-control/wb-lighting-control-util.py --UpdateChannels

python3 /mnt/data/etc/wb-lighting-control/wb-lighting-control-util.py --UpdateSettings

service wb-mqtt-confed restart