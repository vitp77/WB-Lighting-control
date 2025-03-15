#!/usr/bin/python3

import sys
import json
import os
import time

from paho.mqtt import client as mqtt # type: ignore
from pprint import pprint

lightingsConfigFile = '/mnt/data/etc/wb-lightings-settings.conf'
locationsConfigFile = '/mnt/data/etc/wb-location-settings/wb-locations-settings.conf'
webUiConfigFile = '/mnt/data/etc/wb-webui.conf'

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
        with open(filename, "w") as file:
            file.write(json.dumps(content, indent=2))
    except Exception as error:
        print(error, file=sys.stderr)
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
                    channelId = channelFullName(deviceId, controlId)
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

def channelFullName(deviceId, controlId):
    return deviceId + '/' + controlId

def lightSourceByRangeControlId(controlId, deviceId):
    if (controlId == 'Channel 1'):
        return channelFullName(deviceId, 'K1')
    elif (controlId == 'Channel 2'):
        return channelFullName(deviceId, 'K2')
    elif (controlId == 'Channel 3'):
        return channelFullName(deviceId, 'K3')
    elif (controlId == 'Channel 4'):
        return channelFullName(deviceId, 'K4')
    return deviceId
        
def isDictionariesDifferent(dictionaries1, dictionaries2):
    if (len(dictionaries1) != len(dictionaries2)):
        return True
    for channel in dictionaries1:
        if (channel not in dictionaries2):
            return True
    return False
        
def collectControls(useAstronomicalDayNightSensor):
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
    if (useAstronomicalDayNightSensor):
        controls['illuminanceSensors'].append('astronomicalDayNightSensor/dayNight')
    controls['channelsSources'].sort()
    controls['channelsControls'].sort()
    controls['illuminanceSensors'].sort()
        
def isCollectsControlsDifferent(controls1, controls2):
    return (isDictionariesDifferent(controls1['channelsSources'], controls2['channelsSources'])
        or isDictionariesDifferent(controls1['channelsControls'], controls2['channelsControls'])
        or isDictionariesDifferent(controls1['illuminanceSensors'], controls2['illuminanceSensors']))
    
def updateCollectionControlsInLightingConfig(lightingConfig):
    lightingConfig['controls']['channelsSources'] = controls['channelsSources']
    lightingConfig['controls']['channelsControls'] = controls['channelsControls']
    lightingConfig['controls']['illuminanceSensors'] = controls['illuminanceSensors']

def updatesChannels():
    
    lightingConfig = load_json(lightingsConfigFile)
    collectControls(lightingConfig['astronomicalDayNightSensor']['useAstronomicalDayNightSensor'])
    if (isCollectsControlsDifferent(lightingConfig['controls'], controls)):
        updateCollectionControlsInLightingConfig(lightingConfig)
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
    lightingConfig = load_json(lightingsConfigFile)
    collectControls(lightingConfig['astronomicalDayNightSensor']['useAstronomicalDayNightSensor'])
    if ('location' not in lightingConfig):
        lightingConfig = {
            'astronomicalDayNightSensor': {'useAstronomicalDayNightSensor': False, 'latitudeLongitude': ''},
            'location': newLightingLocation(),
            'controls': {},
            'otherSettings': {
                'brightnessReductionLevel': 0.7,
                'renewalTimeout': 5,
                'renewalsMultiplier': 2,
                'maximumRenewalsMultiplier': 4}}
    if ('astronomicalDayNightSensor' not in lightingConfig):
        lightingConfig['astronomicalDayNightSensor'] = {'useAstronomicalDayNightSensor': False, 'latitudeLongitude': ''}
    if ('otherSettings' not in lightingConfig):
        lightingConfig['otherSettings'] = {
            'brightnessReductionLevel': 0.7,
            'renewalTimeout': 5,
            'renewalsMultiplier': 2,
            'maximumRenewalsMultiplier': 4}
    if (isCollectsControlsDifferent(lightingConfig['controls'], controls) or True):
        updateCollectionControlsInLightingConfig(lightingConfig)
        needUpdates = True
        
    locationsConfig = load_json(locationsConfigFile)
    updateLocation(lightingConfig['location'], locationsConfig['location'], controls)
    
    save_json(lightingsConfigFile, lightingConfig)
    print('Обновлен файл настроек', file=sys.stderr)
    updateWidgets()
    
# Обновление виджета

def newUpdateSummary():
    return {
        'controls': [],
        'useRangeControls': False,
        'updateWidgets': False}

def updateLocationWidgets(location, allLightDashboardWidgets, webUiConfig, webUiWidgets, isRoot):
    updateSummary = newUpdateSummary()
    widgetPosition = len(allLightDashboardWidgets)
    createWidget = isRoot
    if ('lightingSources' in location):
        counter = 0
        for lightingSource in location['lightingSources']:
            lightingSourceName = lightingSource['name']
            if (len(lightingSourceName) == 0):
                lightingSourceName = location['name']
            if (len(lightingSourceName) == 0):
                lightingSourceName = 'Свет'
                if (counter > 0):
                    lightingSourceName = lightingSourceName + ' ({})'.format(counter)
            if (len(lightingSource['source']) > 0):
                updateSummary['controls'].append(
                    {
                        'id': lightingSource['source'],
                        'name': lightingSourceName,
                        'extra': {},
                        'type': 'switch'
                    }
                )
            if (len(lightingSource['brightness']) > 0):
                updateSummary['useRangeControls'] = True
                updateSummary['controls'].append(
                    {
                        'id': lightingSource['brightness'],
                        'name': ' ',
                        'extra': {},
                        'type': 'range'
                    }
                )
            counter += 1
    if ('locations' in location):
        controlsLocations = []
        for subLocation in location['locations']:
            updateSubLocationSummary = updateLocationWidgets(subLocation, allLightDashboardWidgets, webUiConfig, webUiWidgets, False)
            controlsLocations.extend(updateSubLocationSummary['controls'])
            if (updateSubLocationSummary['useRangeControls'] == True):
                updateSummary['useRangeControls'] = True
            if (updateSubLocationSummary['updateWidgets'] == True):
                updateSummary['updateWidgets'] = True
        if (len(controlsLocations) > 0):
            updateSummary['controls'] = controlsLocations + updateSummary['controls']
            if (not updateSummary['useRangeControls']):
                for controlsLocation in controlsLocations:
                    if (controlsLocation['type'] == 'range'):
                        updateSummary['useRangeControls'] = True
    if (('masterSwitchUse' in location['masterSetting']) and (location['masterSetting']['masterSwitchUse'])):
        if (len(updateSummary['controls']) > 0):
            createWidget = True
        lightingGroupControlName = 'Весь свет'
        if (not createWidget):
            lightingGroupControlName = location['name']
        idSwitch = 'lightingGroupControl/switch ' + location['name']
        if (('masterSwitchControl' in location['masterSetting'])
            and (len(location['masterSetting']['masterSwitchControl']) > 0)
            and (location['masterSetting']['masterSwitchControl'].find('counter') == -1)):
            
            idSwitch = location['masterSetting']['masterSwitchControl']
        updateSummary['controls'].insert(0,
            {
                'id': idSwitch,
                'name': lightingGroupControlName,
                'extra': {},
                'type': 'switch'
            })
        if (updateSummary['useRangeControls']):
            updateSummary['controls'].insert(1,
                {
                    'id': 'lightingGroupControl/range ' + location['name'],
                    'name': ' ',
                    'extra': {},
                    'type': 'range'
                })
    if ('autoPowerOff' in location and location['autoPowerOff'] == True):
        if (len(updateSummary['controls']) > 0):
            createWidget = True
        updateSummary['controls'].append(
            {
                'id': 'lightingGroupControl/autoPowerOnOff (' + location['name'] + ')',
                'name': 'Автоматически вкл./откл. свет',
                'extra': {},
                'type': 'switch'
            })
        updateSummary['controls'].append(
            {
                'id': 'lightingGroupControl/shutdownTimeout (' + location['name'] + ')',
                'name': '',
                'extra': {},
                'type': 'range'
            })
        
    if (createWidget):
        newWidgetName = location['name']
        if (isRoot):
            newWidgetName = 'Все освещение'
        newWidget = {
            'id': location['id'],
            'name': newWidgetName,
            'cells': updateSummary['controls']
        }
        allLightDashboardWidgets.insert(widgetPosition, newWidget['id'])
        updateWidgets = True
        if (newWidget['id'] in webUiWidgets):
            if (newWidget == webUiWidgets[newWidget['id']]):
                updateWidgets = False
            else:
                webUiConfig['widgets'].remove(webUiWidgets[newWidget['id']])
        if (updateWidgets):
            updateSummary['updateWidgets'] = True
            webUiConfig['widgets'].append(newWidget)
        updateSummary['controls'] = []
    return updateSummary
    
def updateWidgets():
    webUiConfig = load_json(webUiConfigFile)
    if('dashboards' not in webUiConfig):
        print('Не найден раздел виджетов', file=sys.stderr)
        return
    allLightDashboard = None
    for dashboard in webUiConfig['dashboards']:
        if (dashboard['id'] == 'allLight'):
            allLightDashboard = dashboard
    if (allLightDashboard is None):
        allLightDashboard = {
            'id': 'allLight',
            'isSvg': False,
            'name': 'Освещение',
            'widgets': []
        }
        webUiConfig['dashboards'].append(allLightDashboard)
    allLightDashboardWidgets = []
    lightingConfig = load_json(lightingsConfigFile)
    webUiWidgets = {}
    for webUiWidget in webUiConfig['widgets']:
        webUiWidgets[webUiWidget['id']] = webUiWidget
    if ('location' not in lightingConfig):
        print('Не найдены настройки освещения', file=sys.stderr)
        return
    saveConfig = False
    updateSummary = updateLocationWidgets(lightingConfig['location'], allLightDashboardWidgets, webUiConfig, webUiWidgets, True)
    if (updateSummary['updateWidgets']):
        saveConfig = True
        print('Обновление виджетов', file=sys.stderr)
    if (allLightDashboard['widgets'] != allLightDashboardWidgets):
        for widgetId in allLightDashboard['widgets']:
            if (widgetId not in allLightDashboardWidgets) and (widgetId in webUiWidgets):
                webUiConfig['widgets'].remove(webUiWidgets[widgetId])
        allLightDashboard['widgets'] = allLightDashboardWidgets
        saveConfig = True
        print('Обновление коллекции виджетов панели освещения', file=sys.stderr)
    if (saveConfig):
        os.rename(webUiConfigFile, webUiConfigFile + '.' + time.strftime("%Y%m%d_%H%M%S"))
        save_json(webUiConfigFile, webUiConfig)
        print('Обновлена панель освещения', file=sys.stderr)
    else:
        print('Обновление панели освещения не требуется', file=sys.stderr)
    
def main():
    args = {
        '--UpdatesChannels': updatesChannels,
        '--UpdateSettings': updateSettings,
        '--UpdateWidgets': updateWidgets
    }

    if (len(sys.argv) > 1 and sys.argv[1] in args):
        return args[sys.argv[1]]()
    else:
        print('Launch parameters:', file=sys.stderr)
        print('     --UpdatesChannels', file=sys.stderr)
        print('     --UpdateSettings', file=sys.stderr)
        print('     --UpdateWidgets', file=sys.stderr)

    return
    
if __name__ == '__main__':
    main()
