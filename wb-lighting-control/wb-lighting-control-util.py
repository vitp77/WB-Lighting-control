#!/usr/bin/python3

import sys
import json
import os
import time
#import re
#import codecs

from paho.mqtt import client as mqtt
from pprint import pprint

lightingsConfigFile = '/mnt/data/etc/wb-lighting-control/wb-lightings-settings.conf'
locationsConfigFile = '/mnt/data/etc/wb-location-settings/wb-locations-settings.conf'

controls = {
    'channelsSources': [],
    'channelsControls': [],
    'illuminanceSensors': [],
    'brightnessControls': {
        }
    }

broker = 'localhost'
port = 1883
readingItems = True
readTimeout = 6

mqtt = mqtt.Client()

def load_json(filename):
    try:
        if os.path.exists(filename):
            fp = open(filename, "r")
            content = fp.read()
            fp.close()
            return json.loads(content)
    except:
        pass
    return {}

def save_json(filename, content):
    try:
        if os.path.exists(filename):
            fp = open(filename, "w")
            fp.write(json.dumps(content, indent=2))
            fp.close()
    except:
        pass
    
# Подготовка коллекции каналов

def mqtt_on_connect(client, userdata, flags, rc):
    client.subscribe([
        ('/devices/+/controls/+/meta', 0)
    ])

def mqtt_on_subscribe(client, userdata, mid, granted_qos):
    client.publish('/tmp/items_list', 'end_reading')

def mqtt_on_message(client, userdata, msg):
    global readingItems

    if (readingItems == False): return

    if (msg.topic == '/tmp/items_list'):
        readingItems = False
        client.unsubscribe([
            '/devices/+/controls/+/meta'
        ])
        return

    topicParts = msg.topic.split('/')
    if (topicParts[1] == 'devices' and topicParts[3] == 'controls'):
        deviceId = topicParts[2]
        if ('wb-mdm' in deviceId or 'wb-mr' in deviceId or 'wb-msw' in deviceId):
            controlId = topicParts[4]
            if ('freq' not in controlId):
                devProperties = json.loads(msg.payload.decode("utf-8"))
                if (controlId.find('K') == 0 or controlId.find('Channel') == 0 or controlId.find('Input') == 0 or 'Motion' in controlId or controlId.find('Illuminance') == 0):
                    channelId = channelIdtentificator(deviceId, controlId)
                    if (devProperties['type'] == 'switch'):
                        if devProperties['readonly'] == True:
                            controls['channelsControls'].append(channelId)
                        else:
                            controls['channelsSources'].append(channelId)
                    elif (devProperties['type'] == 'lux'):
                        controls['illuminanceSensors'].append(channelId)
                    elif (devProperties['type'] == 'value'):
                        if devProperties['readonly'] == True:
                            controls['channelsControls'].append(channelId)
                    elif (devProperties['type'] == 'range'):
                        if devProperties['readonly'] == False:
                            controls['brightnessControls'][lightSourceByRangeControlId(controlId, deviceId)] = channelId

def channelIdtentificator(deviceId, controlId):
    return deviceId + '/' + controlId

def lightSourceByRangeControlId(controlId, deviceId):
    if (controlId == 'Channel 1'):
        return channelIdtentificator(deviceId, 'K1')
    elif (controlId == 'Channel 2'):
        return channelIdtentificator(deviceId, 'K2')
    elif (controlId == 'Channel 3'):
        return channelIdtentificator(deviceId, 'K3')
    elif (controlId == 'Channel 4'):
        return channelIdtentificator(deviceId, 'K4')
    return deviceId
        
def isDictionariesDifferent(dictionaries1, dictionaries2):
    if (len(dictionaries1) != len(dictionaries2)):
        return True
    for channel in dictionaries1:
        if (channel not in dictionaries2):
            return True
    return False
        
def collectControls():
    global readingItems
    readingItems = True

    mqtt.on_connect = mqtt_on_connect
    mqtt.on_message = mqtt_on_message
    mqtt.on_subscribe = mqtt_on_subscribe
    mqtt.connect(broker, port)
    mqtt.loop_start()

    start = time.time()
    while readingItems:
        time.sleep(0.1)
        if (time.time() - start > readTimeout):
            break

    controls['channelsSources'].sort()
    controls['channelsControls'].sort()
    controls['illuminanceSensors'].sort()
        
def isCollectsControlsDifferent(controls1, controls2):
    return (isDictionariesDifferent(controls1['channelsSources'], controls2['channelsSources'])
        or isDictionariesDifferent(controls1['channelsControls'], controls2['channelsControls'])
        or isDictionariesDifferent(controls1['illuminanceSensors'], controls2['illuminanceSensors']))
    
def updatecollectControlsInLightingConfig(lightingConfig):
    lightingConfig['controls']['channelsSources'] = controls['channelsSources']
    lightingConfig['controls']['channelsControls'] = controls['channelsControls']
    lightingConfig['controls']['illuminanceSensors'] = controls['illuminanceSensors']

def updatesChannels():
    
    collectControls()
    lightingConfig = load_json(lightingsConfigFile)
    if (isCollectsControlsDifferent(lightingConfig['controls'], controls)):
        updatecollectControlsInLightingConfig(lightingConfig)
        save_json(lightingsConfigFile, lightingConfig)
        print('Обновлена коллекция каналов', file=sys.stderr)
    else:
        print('Обновлять каналы не требуется', file=sys.stderr)
    
    return

# Обновление файла настроек

def newLightingLocation():
    return {
        'id': '00000000-0000-0000-0000-000000000000',
        'name': '',
        'locations': [],
        'masterSetting': {
            'masterSwitchUse': False,
            'masterSwitchControl': ''},
        'showLocations': False,
        'lightingSources': [],
        'autoPowerOff': False,
        'powerOffDelay': 120,
        'illuminance': {
            'sensor': '',
            'value': 100
        },
        'lightingControls': []}

def updateLocation(newLocation, location, controls):
    name = ''
    if('name' in location):
        name = location['name']
    newLocation['id'] = location['id']
    newLocation['name'] = name
    if('masterSetting' not in newLocation):
        newLocation['masterSetting'] = {
            'masterSwitchUse': False,
            'masterSwitchControl': ''}
    else:
        if('masterSwitchUse' not in newLocation['masterSetting']):
            newLocation['masterSetting']['masterSwitchUse'] = False
        if('masterSwitchControl' not in newLocation['masterSetting']):
            newLocation['masterSetting']['masterSwitchControl'] = ''
    if('powerOffDelay' not in newLocation):
        newLocation['powerOffDelay'] = 120
    if('illuminance' not in newLocation):
        newLocation['illuminance'] = {
            'sensor': '',
            'value': 100}
    if('lightingControls' not in newLocation):
        newLocation['lightingControls'] = []
    else:
        for lightingControl in newLocation['lightingControls']:
            if('condition' not in lightingControl):
                lightingControl['condition'] = 'equal'
    if('lightingSources' not in newLocation):
        newLocation['lightingSources'] = []
    else:
        for lightingSource in newLocation['lightingSources']:
            lightingSource['brightness'] = ''
            if(lightingSource['source'] != ''):
                if(lightingSource['source'] in controls['brightnessControls']):
                    lightingSource['brightness'] = controls['brightnessControls'][lightingSource['source']]
    if ('locations' in newLocation or 'locations' in location):
        if ('locations' not in newLocation ):
            newLocation['locations'] = []
        if ('locations' not in location ):
            location['locations'] = []
        updateLocations(newLocation['locations'], location['locations'], controls)
        newLocation['showLocations'] = len(newLocation['locations']) > 0

def updateLocations(newLocations, locations, controls):
    index = 0
    while index < len(locations):
        newLocation = newLightingLocation()
        location = locations[index]
        if(index >= len(newLocations)):
            newLocations.append(newLocation)
        else:
            if (newLocations[index]['id'] != location['id']):
                idx = index + 1
                while idx < len(newLocations):
                    if (newLocations[idx]['id'] == location['id']):
                        break
                    idx += 1
                if(idx < len(newLocations)):
                    newLocation = newLocations[idx]
                    newLocations.insert(index, newLocation)
                    newLocations.pop(idx + 1)
                else:
                    newLocations.insert(index, newLocation)
            else:
                newLocation = newLocations[index]
        updateLocation(newLocation, location, controls)
        index += 1

def updateSettings():
    needUpdates = False
    collectControls()
    lightingConfig = load_json(lightingsConfigFile)
    if ('location' not in lightingConfig):
        lightingConfig = {
            'location': newLightingLocation(),
            'controls': {}}
    
    if (isCollectsControlsDifferent(lightingConfig['controls'], controls) or True):
        updatecollectControlsInLightingConfig(lightingConfig)
        needUpdates = True
        
    locationsConfig = load_json(locationsConfigFile)
    updateLocation(lightingConfig['location'], locationsConfig['location'], controls)
    
    save_json(lightingsConfigFile, lightingConfig)
    print('Обновлен файл настроек', file=sys.stderr)
    
def main():
    args = {
        '--UpdatesChannels': updatesChannels,
        '--UpdateSettings': updateSettings
    }

    if (len(sys.argv) > 1 and sys.argv[1] in args):
        return args[sys.argv[1]]()

    return
    
if __name__ == '__main__':
    main()
