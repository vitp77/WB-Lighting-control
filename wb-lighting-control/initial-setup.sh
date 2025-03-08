#!/bin/bash

#ln -s /mnt/data/etc/wb-lighting-control/wb-lightings-settings.schema.json /usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json
#ln -s /mnt/data/etc/wb-lighting-control/wb-lightnings-routines.js /mnt/data/etc/wb-rules/wb-lightnings-routines.js

if test -f "/usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json" ;
then
	echo "File /usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json is exist"
else
	echo "File /usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json create"
ln -s /mnt/data/etc/wb-lighting-control/wb-lightings-settings.schema.json /usr/share/wb-mqtt-confed/schemas/wb-lightings-settings.schema.json
fi

if test -f "/mnt/data/etc/wb-rules/wb-lightnings-routines.js" ;
then
	echo "File /mnt/data/etc/wb-rules/wb-lightnings-routines.js is exist"
else
	echo "File /mnt/data/etc/wb-rules/wb-lightnings-routines.js create"
	ln -s /mnt/data/etc/wb-lighting-control/wb-lightnings-routines.js /mnt/data/etc/wb-rules/wb-lightnings-routines.js
fi

if test -f "/mnt/data/etc/wb-rules/wb-astroLightSensor.js" ;
then
	echo "File /mnt/data/etc/wb-rules/wb-astroLightSensor.js is exist"
else
	echo "File /mnt/data/etc/wb-rules/wb-astroLightSensor.js create"
	ln -s /mnt/data/etc/wb-lighting-control/wb-astroLightSensor.js /mnt/data/etc/wb-rules/wb-astroLightSensor.js
fi

# python3 /mnt/data/etc/wb-lighting-control/wb-lighting-control-util.py --UpdateChannels
python3 /mnt/data/etc/wb-lighting-control/wb-lighting-control-util.py --UpdateSettings
service wb-mqtt-confed restart
service wb-rules restart