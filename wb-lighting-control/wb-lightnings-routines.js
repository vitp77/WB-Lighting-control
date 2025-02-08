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

function partsOfPathToControl(control) {
    if(control === undefined) {
      log.debug("devName - undefined");
      return undefined;
    } else if(control === null) {
      log.debug("devName - Null");
      return undefined;
    }
    var words = control.split('/');
    if(words.length < 2) {return undefined;}
	return {
		devName: words[0],
		cellName: words[1]
	}
}

function setControlsValue(control, value, notify) {
	var partsOfPath = partsOfPathToControl(control);
	if (partsOfPath != undefined) {
		var device = getDevice(partsOfPath.devName);
		if (device != undefined) {
			return setDevicesControlsValue(device, partsOfPath.cellName, value, notify);
		}
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

function valueSlaveSwitchControls(masterControl) {
	var newValue = false;
	var controls = devicesProperties[masterControl].slaveControls;
	controls.forEach(function(control) {
		if (dev[control] != undefined && dev[control] == true) {
			newValue = true;
			return;
		}
	});
	return newValue;
}

function setSwitchControl(masterControl, value) {
    var newValue = value;
    if (newValue != true) {
		newValue = valueSlaveSwitchControls(masterControl);
    }
    if (setControlsValue(masterControl, newValue, false)) {
        if (devicesProperties[masterControl].parrentControl.length > 0) {
            setSwitchControl(devicesProperties[masterControl].parrentControl, newValue);
        }
    }
}

function setSlaveSwitchMasterControl(masterControl) {
    var controls = devicesProperties[masterControl].slaveControls;
    controls.forEach(function(control) {
		var partsOfPath = partsOfPathToControl(control);
		if (partsOfPath != undefined) {
			var device = getDevice(partsOfPath.devName);
			if (device != undefined) {
				setDevicesControlsValue(device, partsOfPath.cellName, dev[masterControl], false);
				if (device.isVirtual()) {
					setSlaveSwitchMasterControl(control);
				}
			}
		}
    });
}

function valueSlaveRangeControls(masterControl, value) {
	var newValue = value;
	var controls = devicesProperties[masterControl].slaveControls;
	controls.forEach(function(control) {
		if (dev[control] != undefined) {
			newValue = Math.max(newValue, dev[control]);
			if (newValue >= 100) return newValue;
		}
	});
	return newValue;
}

function setRangeControl(masterControl, value) {
    var newValue = value;
    if (newValue < 100) {
		newValue = valueSlaveRangeControls(masterControl, newValue);
    }
    if (setControlsValue(masterControl, newValue, false)) {
        if (devicesProperties[masterControl].parrentControl.length > 0) {
            setRangeControl(devicesProperties[masterControl].parrentControl, newValue);
        }
    }
}

function setSlaveRangeMasterControl(masterControl) {
    var controls = devicesProperties[masterControl].slaveControls;
    controls.forEach(function(control) {
		var partsOfPath = partsOfPathToControl(control);
		if (partsOfPath != undefined) {
			var device = getDevice(partsOfPath.devName);
			if (device != undefined) {
				setDevicesControlsValue(device, partsOfPath.cellName, dev[masterControl], false);
				if (device.isVirtual()) {
					setSlaveRangeMasterControl(control);
				}
			}
		}
    });
}

function createSwitchesRules(masterControl, kindControls) {
    defineRule("{} (dep)".format(masterControl), {
        whenChanged: kindControls,
        then: function(newValue, devName, cellName) {
            setSwitchControl(masterControl, newValue);
        }
    });
    defineRule("{}".format(masterControl), {
        whenChanged: masterControl,
        then: function() {
            setSlaveSwitchMasterControl(masterControl);
        }
    });
}

function createRangesRules(masterControl, kindControls) {
    defineRule("{} (dep)".format(masterControl), {
        whenChanged: kindControls,
        then: function(newValue, devName, cellName) {
            setRangeControl(masterControl, newValue);
        }
    });
    defineRule("{}".format(masterControl), {
        whenChanged: masterControl,
        then: function() {
            setSlaveRangeMasterControl(masterControl);
        }
    });
}

function createIlluminanceAutoPowerOffRule(scenario, locationName) {
    defineRule("IlluminanceAutoPowerOff ({})".format(locationName), {
        asSoonAs: function(){
          if (scenario.illuminance.sensor in dRControls) {
              return dev[scenario.illuminance.sensor] < scenario.illuminance.value;
          }
          return false;
        },
        then: function() {
            updateDRScenario(scenario.illuminance.sensor, dev[scenario.illuminance.sensor]);
        }
    });
}

function createAutoPowerControlOffRule(sensor, value, locationName) {
    defineRule("AutoPowerControlOff ({} {})".format(locationName, sensor), {
        asSoonAs: function(){
          if (sensor in dRControls) {
              return dev[sensor] >= value;
          }
          return false;
        },
        then: function() {
            updateDRScenario(sensor, dev[sensor]);
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

function setDeviceProperties(masterControl, slaveControls) {
    devicesProperties[masterControl] = {
        'parrentControl': '',
        'slaveControls': slaveControls
    };
    slaveControls.forEach(function(control) {
        if (control.length > 0 && control in devicesProperties) {
            devicesProperties[control].parrentControl = masterControl;
        }
    });
}

function createAutoPowerOffScenario(location, locationName) {
    if ('autoPowerOff' in location && location.autoPowerOff == true) {
        var scenarioId = Object.keys(dRScenarios).length;
        var scenario = {
			'name': nameLocation(location),
            'powerOffDelay': location.powerOffDelay,
            'lightingSources': [],
            'illuminance': {
                'sensor': '',
                'value': 100
            },
            'lightingControls': [],
			'brightness': {},
			'brightnessValues': {}
        };
        var controls = [];
        if ('illuminance' in location) {
            if ('sensor' in location.illuminance && location.illuminance.sensor.length > 0) {
                scenario.illuminance.sensor = location.illuminance.sensor;
                scenario.illuminance.value = location.illuminance.value;
                dRControls[scenario.illuminance.sensor] = scenarioId;
                createIlluminanceAutoPowerOffRule(scenario, locationName);
            }
        }
        if ('lightingSources' in location) {
            location.lightingSources.forEach(function(lightingSource) {
                controls.push(lightingSource.source);
                scenario.lightingSources.push(lightingSource.source);
                dRControls[lightingSource.source] = scenarioId;
				if(lightingSource.brightness.length > 0) {
					scenario.brightness[lightingSource.brightness] = lightingSource.source;
				}
            });
        }
        if ('lightingControls' in location) {
            location.lightingControls.forEach(function(controlsProp) {
                scenario.lightingControls.push({
                    'control': controlsProp.control,
                    'value': controlsProp.value
                });
				createAutoPowerControlOffRule(controlsProp.control, controlsProp.value, locationName);
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
		var scenario = dRScenarios[scenarioId];
		if (scenario.illuminance.sensor.length > 0 && dev[scenario.illuminance.sensor] < scenario.illuminance.value) {
			dRActiveScenarios[scenarioId] = scenario.powerOffDelay;
		} else {
			dRActiveScenarios[scenarioId] -= 1;
		}
        if (dRActiveScenarios[scenarioId] <= 0) {
            endedScenariosIds.push(scenarioId);
		} else if (dRActiveScenarios[scenarioId] == 5) {
			var scenario = dRScenarios[scenarioId];
			Object.keys(scenario.brightness).forEach(function(brightnessSource) {
				if (typeof dev[brightnessSource]  == 'number' && dev[scenario.brightness[brightnessSource]] == true) {
					var currentBrightness = dev[brightnessSource];
					var newBrightness = Math.round(currentBrightness * 0.7);
					setControlsValue(brightnessSource, newBrightness, false);
					scenario.brightnessValues[brightnessSource] = currentBrightness;
				}
			});
        }
    });
	if (endedScenariosIds.length > 0) completingScenarios(endedScenariosIds);
    if (Object.keys(dRActiveScenarios).length > 0) {
        dRTimer = setTimeout(updateCounter, 1000);
    } else {
        dRTimer = null;
    }
}

function completingScenarios(scenarios) {
    scenarios.forEach(function(scenarioId) {
        var scenario = dRScenarios[scenarioId];
		if (scenarioId in dRActiveScenarios) {
			log.debug('DR {}: Stop'.format(scenario.name));
		}
        delete dRActiveScenarios[scenarioId];
        scenario.lightingSources.forEach(function(source) {
            setControlsValue(source, false, true);
        });
		restoreBrightness(scenario);
    });
}

function restoreBrightness(scenario) {
	Object.keys(scenario.brightnessValues).forEach(function(brightnessSource) {
		if (typeof dev[brightnessSource]  == 'number') {
			setControlsValue(brightnessSource, scenario.brightnessValues[brightnessSource], false);
			delete scenario.brightnessValues[brightnessSource];
		}
	});
}

function allLightingSourcesDisabled(scenario) {
	var lightingSourcesDisabled = true;
	scenario.lightingSources.forEach(function(source) {
		if (dev[source] == true) {
			lightingSourcesDisabled = false;
			return;
		} 
	});
	return lightingSourcesDisabled;
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
				if (scenario.lightingControls.length == 0) {
					onEvent = true;
				} else {
					scenario.lightingControls.forEach(function(controls) {
						if (controls.control == controlId) {
							if (controls.value <= value) {
								onEvent = true;
							}
						}
					});
				}
            }
            if (onEvent) {
				if (!(scenarioId in dRActiveScenarios)) {
					log.debug('DR {}: Start'.format(scenario.name));
				}
                var startTimer = Object.keys(dRActiveScenarios).length == 0;
                dRActiveScenarios[scenarioId] = scenario.powerOffDelay;
				restoreBrightness(scenario);
                if (startTimer || dRTimer === null) {
                    dRTimer = setTimeout(updateCounter, 1000);
                }
                var onLightingSource = scenario.lightingSources.indexOf(controlId) == -1;
                if (onLightingSource && scenario.illuminance.sensor.length > 0) {
                    if (dev[scenario.illuminance.sensor] >= scenario.illuminance.value) {
                        onLightingSource = false;
                    }
                }
                if (onLightingSource) {
                    scenario.lightingSources.forEach(function(source) {
                        setControlsValue(source, true, true);
                    });
                }
            } else {
				if (allLightingSourcesDisabled(scenario)) {
					completingScenarios([scenarioId]);
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

function slaveControlsLocation(location) {
    var slaveControls = newLocationsControls();
    // Сбор сведений об источниках текущей локации
    if ('lightingSources' in location) {
        location.lightingSources.forEach(function(lightingSource) {
            if(lightingSource.source.length > 0) {
                slaveControls.switches.push(lightingSource.source);
                if ('brightness' in lightingSource && lightingSource.brightness.length > 0) {
                    slaveControls.ranges.push(lightingSource.brightness);
                }
            }
        });
    }
    // Сбор сведений об источниках дочерних локаций
    if ('locations' in location) {
        location.locations.forEach(function(subLocation) {
            var subSlaveControls = createMasterControls(subLocation);
            if (subSlaveControls.switches.length > 0) {
                subSlaveControls.switches.forEach(function(switchControl) {
                    if (switchControl.length > 0) {
                        slaveControls.switches.push(switchControl);
                    }
                });
            }
            if (subSlaveControls.ranges.length > 0) {
                subSlaveControls.ranges.forEach(function(rangeControl) {
                    if (rangeControl.length > 0) {
                        slaveControls.ranges.push(rangeControl);
                    }
                });
            }
        });
    }
    return slaveControls;
}

function nameLocation(location) {
    var locationName = location.name;
    if (location.name.length == 0 && location.id == '00000000-0000-0000-0000-000000000000') {
        locationName = 'Все освещение';
    }
	return locationName;
}

function createMasterControls(location) {
	order += 10;
	var orderSwitch = order;
    var currentControls = newLocationsControls();
    var devicelightingControl = getDevice(deviceName);
    var locationName = nameLocation(location);
    var masterSwitchUse = 'masterSetting' in location && 'masterSwitchUse' in location.masterSetting && location.masterSetting.masterSwitchUse == true;
    var controlSwitchId = 'switch {}'.format(location.name);
    var deviceControlSwitchId = '';
    if (masterSwitchUse) {
		if('masterSwitchControl' in location.masterSetting
			&& location.masterSetting.masterSwitchControl.length > 0
			&& location.masterSetting.masterSwitchControl.indexOf('counter') == -1) {
			// 'Железный' мастер-выключатель
			deviceControlSwitchId = location.masterSetting.masterSwitchControl;
		} else {
			// Виртуального мастер-выключателя
			deviceControlSwitchId = '{}/{}'.format(deviceName, controlSwitchId);
			devicelightingControl.addControl(
				controlSwitchId, {
					title: locationName,
					type: 'switch',
					value: false,
					readonly: false,
					order: orderSwitch
				});
			currentControls.switches.push(deviceControlSwitchId);
		}
    }
  
    // Сбор сведений о зависимых котнтролах с созданием контролов подчиненных локаций
    var slaveControls = slaveControlsLocation(location);

    // Сценарий темная комната (серая если еще датчик света)
    createAutoPowerOffScenario(location, locationName);

    // Если мастер выключателя нет возврат коллекции подчиненных контролов
    if (!masterSwitchUse) {
        return slaveControls;
    }
  
	createSwitchesRules(deviceControlSwitchId, slaveControls.switches);
	setDeviceProperties(deviceControlSwitchId, slaveControls.switches);
	// Инициализация начального состояния
	setSwitchControl(deviceControlSwitchId, false);
  
    if (slaveControls.ranges.length > 0) {
        var controlRangeId = 'range {}'.format(location.name);
        var deviceControlRangeId = '{}/{}'.format(deviceName, controlRangeId);
		orderRange = orderSwitch + 5;
        devicelightingControl.addControl(
            controlRangeId, {
                title: 'Уровень',
                type: 'range',
                value: 100,
                readonly: false,
                min: 0,
                max: 100,
                order: orderRange
            });
        currentControls.ranges.push(deviceControlRangeId);
        createRangesRules(deviceControlRangeId, slaveControls.ranges);
        setDeviceProperties(deviceControlRangeId, slaveControls.ranges);
		// Инициализация начального состояния
		setRangeControl(deviceControlRangeId, 0);
    }
  
    // Создание правила для 'железного' мастер-выключателя
    if('masterSwitchControl' in location.masterSetting
		&& location.masterSetting.masterSwitchControl.length > 0
		&& location.masterSetting.masterSwitchControl.indexOf('counter') != -1) {
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

// Нужна глобальная переменная, что-бы корректно рассчитать порядок контролов
var order = 0;
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
    createMasterControls(configLighting.location);
}

setTimeout(applyConfiguration, 10000);
setTimeout(updateSettings, 20000);
