var configLightingFile = '/mnt/data/etc/wb-lighting-control/wb-lightings-settings.conf';
var deviceName = 'lightingGroupControl';

var devicesProperties = {};

var dRScenarios = {};
var dRControls = {};
var dRActiveScenarios = {};
var dRTimer = null;

defineVirtualDevice(deviceName, {
    title: 'Управление группами освещения',
    cells: {}
});

function devName(control) {
    log.debug("devName - {}".formar(control));
    var words = control.split('/');
    return words[0];
}

function cellName(control) {
    var words = control.split('/');
    return words[1];
}

function setControlsValue(control, value, notify) {
    var device = getDevice(devName(control));
    if (device != undefined) {
        return setDevicesControlsValue(device, cellName(control), value, notify);
    }
    return false;
}

function setDevicesControlsValue(device, cellsName, value, notify) {
    if (device.isControlExists(cellsName)) {
        if (device.getControl(cellsName).getValue() != value) {
            device.getControl(cellsName).setValue({
                value: value,
                notify: notify
            });
            return true;
        }
    }
    return false;
}

function setSwitchControl(groupControl) {
    var newValue = false;
    var controls = devicesProperties[groupControl].slaveControls;
    controls.forEach(function(control) {
        if (dev[control] != undefined) newValue = newValue || dev[control];
    });
    if (setControlsValue(groupControl, newValue, false)) {
        if (devicesProperties[groupControl].parrentControl.length > 0) {
            setSwitchControl(devicesProperties[groupControl].parrentControl);
        }
    }
}

function setDependenciesSwitchByVControl(groupControl) {
    var controls = devicesProperties[groupControl].slaveControls;
    controls.forEach(function(control) {
        var device = getDevice(devName(control));
        if (device != undefined) {
            setDevicesControlsValue(device, cellName(control), dev[groupControl], false);
            if (device.isVirtual()) {
                setDependenciesSwitchByVControl(control);
            }
        }
    });
}

function setRangeControl(groupControl) {
    var newValue = 0;
    var controls = devicesProperties[groupControl].slaveControls;
    controls.forEach(function(control) {
        if (dev[control] != undefined) newValue = Math.max(newValue, dev[control]);
    });
    if (setControlsValue(groupControl, newValue, false)) {
        if (devicesProperties[groupControl].parrentControl.length > 0) {
            setRangeControl(devicesProperties[groupControl].parrentControl);
        }
    }
}

function setDependenciesRangeByVControl(groupControl) {
    var controls = devicesProperties[groupControl].slaveControls;
    controls.forEach(function(control) {
        var device = getDevice(devName(control));
        if (device != undefined) {
            setDevicesControlsValue(device, cellName(control), dev[groupControl], false);
            if (device.isVirtual()) {
                setDependenciesRangeByVControl(control);
            }
        }
    });
}

function createSwitchesRules(groupControl, kindControls) {
    defineRule("{} (dep)".format(groupControl), {
        whenChanged: kindControls,
        then: function() {
            setSwitchControl(groupControl);
        }
    });
    defineRule("{}".format(groupControl), {
        whenChanged: groupControl,
        then: function() {
            setDependenciesSwitchByVControl(groupControl);
        }
    });
}

function createRangesRules(groupControl, kindControls) {
    defineRule("{} (dep)".format(groupControl), {
        whenChanged: kindControls,
        then: function() {
            setRangeControl(groupControl);
        }
    });
    defineRule("{}".format(groupControl), {
        whenChanged: groupControl,
        then: function() {
            setDependenciesRangeByVControl(groupControl);
        }
    });
}

function createIlluminanceAutoPowerOffRule(control, locationName) {
    defineRule("IlluminanceAutoPowerOff ({})".format(locationName), {
        asSoonAs: function(){
          if (control in dRControls) {
              var scenarioId = dRControls[control];
              return dev[control] >= scenario.illuminance.value;
          }
          return false;
        },
        then: function(newValue, devName, cellName) {
            updateDRScenario('{}/{}'.format(devName, cellName), newValue);
        }
    });
}

function createAutoPowerOffRule(controls, locationName) {
    defineRule("AutoPowerOff ({})".format(locationName), {
        whenChanged: controls,
        then: function(newValue, devName, cellName) {
            updateDRScenario('{}/{}'.format(devName, cellName), newValue);
        }
    });
}

function createMasterSwitchRule(masterSwitchControl, deviceControlSwitchId) {
    defineRule("{} -> {}".format(masterSwitchControl, deviceControlSwitchId), {
        whenChanged: masterSwitchControl,
        then: function(newValue, devName, cellName) {
            if (typeof newValue == 'boolean') {
                setControlsValue(deviceControlSwitchId, newValue, true);
            } else {
                setControlsValue(deviceControlSwitchId, !dev[deviceControlSwitchId], true);
            }
        }
    });
}

function setDeviceProperties(groupControl, slaveControls) {
    devicesProperties[groupControl] = {
        'parrentControl': '',
        'slaveControls': slaveControls
    };
    slaveControls.forEach(function(control) {
        if (control.length > 0 && control in devicesProperties) {
            devicesProperties[control].parrentControl = groupControl;
        }
    });
}

function createAutoPowerOffScenario(location, locationName) {
    if ('autoPowerOff' in location && location.autoPowerOff == true) {
        var scenarioId = Object.keys(dRScenarios).length;
        var scenario = {
            'powerOffDelay': location.powerOffDelay,
            'lightingSources': [],
            'illuminance': {
                'sensor': '',
                'value': 100
            },
            'lightingControls': [],
			'brightness': [],
			'brightnessValues': {}
        };
        var controls = [];
        if ('illuminance' in location) {
            if ('sensor' in location.illuminance && location.illuminance.sensor.length > 0) {
                scenario.illuminance.sensor = location.illuminance.sensor;
                scenario.illuminance.value = location.illuminance.value;
                dRControls[scenario.illuminance.sensor] = scenarioId;
                createIlluminanceAutoPowerOffRule(lightingSource.source)
            }
        }
        if ('lightingSources' in location) {
            location.lightingSources.forEach(function(lightingSource) {
                controls.push(lightingSource.source);
                scenario.lightingSources.push(lightingSource.source);
                dRControls[lightingSource.source] = scenarioId;
				if(lightingSource.brightness.length > 0) {
					scenario.brightness.push(lightingSource.brightness);
				}
            });
        }
        if ('lightingControls' in location) {
            location.lightingControls.forEach(function(controlsProp) {
                scenario.lightingControls.push({
                    'control': controlsProp.control,
                    'value': controlsProp.value
                });
                controls.push(controlsProp.control);
                dRControls[controlsProp.control] = scenarioId;
            });
        }
        createAutoPowerOffRule(controls, locationName);
        dRScenarios[scenarioId] = scenario;
    }
}

function updateCounter() {
    var endedScenariosIds = [];
    Object.keys(dRActiveScenarios).forEach(function(scenarioId) {
        dRActiveScenarios[scenarioId] -= 1;
        if (dRActiveScenarios[scenarioId] <= 0) {
            endedScenariosIds.push(scenarioId);
		} else if (dRActiveScenarios[scenarioId] == 5) {
			var scenario = dRScenarios[scenarioId];
			scenario.brightness.forEach(function(brightnessSource) {
				if (typeof dev[brightnessSource]  == 'number') {
					var currentBrightness = dev[brightnessSource];
					var newBrightness = Math.round(currentBrightness * 0.7);
					setControlsValue(brightnessSource, newBrightness, false);
					scenario.brightnessValues[brightnessSource] = currentBrightness;
				}
			});
        }
    });
    endedScenariosIds.forEach(function(scenarioId) {
        delete dRActiveScenarios[scenarioId];
        var scenario = dRScenarios[scenarioId];
        scenario.lightingSources.forEach(function(source) {
            if (dev[source] != false) {
                setControlsValue(source, false, true);
            }
        });
		restoreBrightness(scenario);
    });
    if (Object.keys(dRActiveScenarios).length > 0) {
        dRTimer = setTimeout(updateCounter, 1000);
    } else {
        dRTimer = null;
    }
}

function restoreBrightness(scenario) {
	Object.keys(scenario.brightnessValues).forEach(function(brightnessSource) {
		if (typeof dev[brightnessSource]  == 'number') {
			setControlsValue(brightnessSource, scenario.brightnessValues[brightnessSource], false);
			delete scenario.brightnessValues[brightnessSource];
		}
	});
}

function updateDRScenario(controlId, value) {
    if (controlId in dRControls) {
        var scenarioId = dRControls[controlId];
        if (scenarioId in dRScenarios) {
            var scenario = dRScenarios[scenarioId];
            var onEvent = false;
            if (typeof value == 'boolean' && value == true) {
                onEvent = true;
            } else if (typeof value == 'number') {
                scenario.lightingControls.forEach(function(controls) {
                    if (controls.control == controlId) {
                        if (controls.value <= value) {
                            onEvent = true;
                        }
                    }
                });
            }
            if (onEvent) {
                var startTimer = Object.keys(dRActiveScenarios).length == 0;
                dRActiveScenarios[scenarioId] = scenario.powerOffDelay;
				restoreBrightness(scenario);
                if (startTimer || dRTimer === null) {
                    dRTimer = setTimeout(updateCounter, 1000);
                }
                var onLightingSource = scenario.lightingSources.indexOf(controlId) == -1;
                if (onLightingSource && scenario.illuminance.sensor.length > 0) {
                    if (dev[scenario.illuminance.sensor] < scenario.illuminance.value) {
                        onLightingSource = false;
                    }
                }
                if (onLightingSource) {
                    scenario.lightingSources.forEach(function(source) {
                        if (dev[source] != true) {
                            setControlsValue(source, true, true);
                        }
                    });
                }
            }
        }
    }
}

function newLocationsControls() {
  return {
    'switches': [],
    'ranges': []};
}

function dependenciesControlsLocation(location) {
    var dependenciesControls = newLocationsControls();
    // Сбор сведений об источниках текущей локации
    if ('lightingSources' in location) {
        location.lightingSources.forEach(function(lightingSource) {
            if(lightingSource.source.length > 0) {
                dependenciesControls.switches.push(lightingSource.source);
                if ('brightness' in lightingSource && lightingSource.brightness.length > 0) {
                    dependenciesControls.ranges.push(lightingSource.brightness);
                }
            }
        });
    }
    // Сбор сведений об источниках дочерних локаций
    if ('locations' in location) {
        location.locations.forEach(function(subLocation) {
            var subDependenciesControls = createGroupControls(subLocation);
            if (subDependenciesControls.switches.length > 0) {
                subDependenciesControls.switches.forEach(function(switchControl) {
                    if (switchControl.length > 0) {
                        dependenciesControls.switches.push(switchControl);
                    }
                });
            }
            if (subDependenciesControls.ranges.length > 0) {
                subDependenciesControls.ranges.forEach(function(rangeControl) {
                    if (rangeControl.length > 0) {
                        dependenciesControls.ranges.push(rangeControl);
                    }
                });
            }
        });
    }
    return dependenciesControls
}

function createGroupControls(location) {
    var currentControls = newLocationsControls();
    var devicelightingControl = getDevice(deviceName);
    var locationName = location.name;
    if (location.name.length == 0 && location.id == '00000000-0000-0000-0000-000000000000') {
        locationName = 'Все освещение';
    }
    var masterSwitchUse = 'masterSetting' in location && 'masterSwitchUse' in location.masterSetting && location.masterSetting.masterSwitchUse == true;
    var order = devicelightingControl.controlsList().length * 10;
    var controlSwitchId = 'switch {}'.format(location.name);
    var deviceControlSwitchId = '{}/{}'.format(deviceName, controlSwitchId);
    if (masterSwitchUse) {
        // Создание виртуального мастер-выключателя, что бы занять его порядковый номер
        devicelightingControl.addControl(
            controlSwitchId, {
                title: locationName,
                type: 'switch',
                value: false,
                readonly: false,
                order: order
            });
        currentControls.switches.push(deviceControlSwitchId);
    }
  
    // Сбор сведений о зависимых котнтролах с созданием контролов подчиненных локаций
    var dependenciesControls = dependenciesControlsLocation(location);

    // Сценарий темная комната (серая если еще датчик света)
    createAutoPowerOffScenario(location, locationName);

    // Если мастер выключателя нет возврат коллекции подчиненных контролов
    if (!masterSwitchUse) {
        return dependenciesControls;
    }
  
    createSwitchesRules(deviceControlSwitchId, dependenciesControls.switches);
    setDeviceProperties(deviceControlSwitchId, dependenciesControls.switches);
  
    if (dependenciesControls.ranges.length > 0) {
        var controlRangeId = 'range {}'.format(location.name);
        var deviceControlRangeId = '{}/{}'.format(deviceName, controlRangeId);
        devicelightingControl.addControl(
            controlRangeId, {
                title: 'Уровень',
                type: 'range',
                value: 100,
                readonly: false,
                min: 0,
                max: 100,
                order: order + 5
            });
        currentControls.ranges.push(deviceControlRangeId);
        createRangesRules(deviceControlRangeId, dependenciesControls.ranges);
        setDeviceProperties(deviceControlRangeId, dependenciesControls.ranges);
    }
  
    // Создание правила для 'железного' мастер-выключателя
    if('masterSwitchControl' in location.masterSetting && location.masterSetting.masterSwitchControl.length > 0) {
        createMasterSwitchRule(location.masterSetting.masterSwitchControl, deviceControlSwitchId);
    }
  
    return currentControls;
}

function updateSettings() {
    var command = "python3 /mnt/data/etc/wb-lighting-control/wb-lighting-control-util.py --UpdateSettings";
    runShellCommand(command, {
        captureOutput: true,
        exitCallback: function (exitCode, capturedOutput) {
            if (exitCode !== 0 && exitCode !== 124) {
                log.warning("Command Controls exited with code: {}", exitCode);
                return;
            }
        }
    });
}

function saveConfigFile(config, configFileName) {
    var command = "echo \"{}\" > {}".format(JSON.stringify(config, null, 2).replace(/\"/g, '\\\"'), configFileName);
    runShellCommand(command, {
        captureOutput: true,
        exitCallback: function(exitCode, capturedOutput) {
            if (exitCode !== 0 && exitCode !== 124) {
                log.warning("Command Controls exited with code: {}", exitCode);
                return;
            }
        }
    });
}

function applyConfiguration() {
    var configLighting = {
        'location': {
            'name': '',
            'id': '00000000-0000-0000-0000-000000000000'
        }
    };
    try {
        configLighting = readConfig(configLightingFile);
    } catch (error) {
        saveConfigFile(configLighting, configLightingFile);
    }
    createGroupControls(configLighting.location, []);
}

setTimeout(applyConfiguration, 10000);
setTimeout(updateSettings, 20000);
