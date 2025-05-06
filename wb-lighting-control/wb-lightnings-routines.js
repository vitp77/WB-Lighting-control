var configLightingFile = '/mnt/data/etc/wb-lightings-settings.conf';
var deviceName = 'lightingGroupControl';

var devicesProperties = {};
var hWMasterSwitchControls = {};

var dRScenarios = {};
var dRControls = {};
var dRActiveScenarios = {};
var dRTimer = null;
var dRStoppedScenarios = {};
var astronomicalDayNightSensorCellFullName = 'astronomicalDayNightSensor/dayNight';

defineVirtualDevice(deviceName, {
  title: 'Управление группами освещения',
  cells: {}
});

// Общего назначения

// Возвращает словарь с ключами devName и cellName, заполненными из строки
// "<devName>/<cellName>"
//
function partsOfPathToControl(control) {
  if (control === undefined) {
    log.debug("devName - undefined");
    return undefined;
  } else if (control === null) {
    log.debug("devName - Null");
    return undefined;
  }
  var words = control.split('/');
  if (words.length < 2) {
    return undefined;
  }
  return {
    devName: words[0],
    cellName: words[1]
  };
}

// Возвращает полное имя контрола "<devName>/<cellName>"
//
function cellFullName(devName, cellName) {
  return '{}/{}'.format(devName, cellName)
}

function deviceCellFullName(cellName) {
  return cellFullName(deviceName, cellName)
}

// Устанавливает значение контрола устройства
//
function setControlsValue(control, value, notify) {
  var partsOfPath = partsOfPathToControl(control);
  if (partsOfPath != undefined) {
    return setDeviceControlsValue(partsOfPath.devName, partsOfPath.cellName, value, notify);
  }
  return false;
}

function setDeviceControlsValue(devName, cellName, value, notify) {
  var device = getDevice(devName);
  if (device != undefined) {
    return setDevicesControlsValue(device, cellName, value, notify);
  }
  return false;
}

function setDevicesControlsValue(device, cellName, value, notify) {
  if (device.isControlExists(cellName)) {
    if (device.getControl(cellName).getValue() != value) {
      device.getControl(cellName).setValue({
        value: value,
        notify: notify
      });
      return true;
    }
  }
  return false
}

// Возвращает число строкой в два знака, с лидирующим 0
// Используется для форматирования времени
//
function twoDigitNumberPresentation(value) {
  if (value > 9) {
    return '{}'.format(value);
  }
  return '0{}'.format(value);
}

// Иерархия устройств masterControl/ slaveControls

// Возвращает значение включенности подчиненных устройств
//
function valueSlaveSwitchControls(masterControl) {
  var newValue = false;
  var controls = devicesProperties[masterControl].slaveControls;
  for (idx = 0; idx < controls.length; idx++) {
    var control = controls[idx];
    if (dev[control] != undefined && dev[control] == true) {
      return true;
    }
  }
  return newValue;
}

// Устанавливает значение включенности masterControl и обновляет все вышестоящие masterControl-ы
//
function setSwitchControl(masterControl, value) {
  log.debug('setSwitchControl; {} = {}'.format(masterControl, value));
  var newValue = value;
  if (newValue != true) {
    newValue = valueSlaveSwitchControls(masterControl);
  }
  setControlsValue(masterControl, newValue, false);
  if (devicesProperties[masterControl].parentControl.length > 0) {
    setSwitchControl(devicesProperties[masterControl].parentControl, newValue);
  }
}

// Устанавливает значение для всех подчиненных контролов
//
function setSlaveSwitchMasterControl(masterControl) {
  var controls = devicesProperties[masterControl].slaveControls;
  controls.forEach(function (control) {
    log.debug('setSlaveSwitchMasterControl; {} = {}'.format(control, dev[masterControl]));
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

// Возвращает максимальное значение яркости подчиненных устройств
//
function valueSlaveRangeControls(masterControl, value) {
  var newValue = value;
  var controls = devicesProperties[masterControl].slaveControls;
  for (idx = 0; idx < controls.length; idx++) {
    var control = controls[idx];
    if (dev[control] != undefined) {
      newValue = Math.max(newValue, dev[control]);
      if (newValue >= 100) return newValue;
    }
  }
  return newValue;
}

// Устанавливает значение яркости masterControl и обновляет все вышестоящие masterControl-ы
//
function setRangeControl(masterControl, value) {
  var newValue = value;
  if (newValue < 100) {
    newValue = valueSlaveRangeControls(masterControl, newValue);
  }
  setControlsValue(masterControl, newValue, false);
  if (devicesProperties[masterControl].parentControl.length > 0) {
    setRangeControl(devicesProperties[masterControl].parentControl, newValue);
  }
}

// Устанавливает значение яркости для всех подчиненных контролов
//
function setSlaveRangeMasterControl(masterControl) {
  var controls = devicesProperties[masterControl].slaveControls;
  controls.forEach(function (control) {
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

// Создает правило для masterControls, включающих или отключающих подчиненные устройства
//
function createSwitchesRules(masterControls, slaveControls) {
  if (slaveControls.length > 0) {
    defineRule('lightingSlavesSwitchesRules', {
      whenChanged: slaveControls,
      then: function (newValue, devName, cellName) {
        log.debug('whenChanged: slaveControls - {}'.format(cellFullName(devName, cellName)));
        var deviceProperties = devicesProperties[cellFullName(devName, cellName)];
        if (deviceProperties.parentControl.length > 0) {
          setSwitchControl(deviceProperties.parentControl, newValue);
        }
      }
    });
  }
  if (masterControls.length > 0) {
    defineRule('lightingMastersSwitchesRules', {
      whenChanged: masterControls,
      then: function (newValue, devName, cellName) {
        log.debug('whenChanged: masterControl - {}'.format(cellFullName(devName, cellName)));
        setSlaveSwitchMasterControl(cellFullName(devName, cellName));
      }
    });
  }
}

// Создает правило для masterControls, устанавливающих яркость подчиненных устройств
//
function createRangesRules(masterControls, slaveControls) {
  if (slaveControls.length > 0) {
    defineRule('lightingSlavesRangesRules', {
      whenChanged: slaveControls,
      then: function (newValue, devName, cellName) {
        log.debug('whenChanged: slaveControls - {}'.format(cellFullName(devName, cellName)));
        var deviceProperties = devicesProperties[cellFullName(devName, cellName)];
        if (deviceProperties.parentControl.length > 0) {
          setRangeControl(deviceProperties.parentControl, newValue);
        }
      }
    });
  }
  if (masterControls.length > 0) {
    defineRule('lightingMastersRangesRules', {
      whenChanged: masterControls,
      then: function (newValue, devName, cellName) {
        log.debug('whenChanged: masterControl - {}'.format(cellFullName(devName, cellName)));
        setSlaveRangeMasterControl(cellFullName(devName, cellName));
      }
    });
  }
}

// Создает правило для аппаратного мастер выключателя (masterSwitchControl), управляющего
// подчиненными устройствами (deviceControlSwitchId)
//
//function createMasterSwitchRule(masterSwitchControl, deviceControlSwitchId) {
function createHwMasterSwitchesRule() {
  if (Object.keys(hWMasterSwitchControls).length > 0) {
    defineRule('hWMasterSwitchesRule', {
      whenChanged: Object.keys(hWMasterSwitchControls),
      then: function (newValue, devName, cellName) {
        hWMasterSwitchControls[cellFullName(devName, cellName)].forEach(function (deviceControlSwitchId) {
          log.debug('MasterSwitchRule: {} - {} - {}'.format(cellFullName(devName, cellName), deviceControlSwitchId, newValue));
          setControlsValue(deviceControlSwitchId, !dev[deviceControlSwitchId], true);
        });
      }
    });
  }
}

// Добавляет в словарь ключ masterControl, содержащем словарь с ключами:
// - parentControl - вышестоящий masterControl,
// - slaveControls - подчиненные устройства
//
function setDeviceProperties(masterControl, slaveControls, controlType) {
  devicesProperties[masterControl] = {
    'parentControl': '',
    'slaveControls': slaveControls,
    'type': controlType
  };
  slaveControls.forEach(function (control) {
    if (control.length > 0) {
      if (!(control in devicesProperties)) {
        setDeviceProperties(control, [], controlType)
      }
      devicesProperties[control].parentControl = masterControl;
    }
  });
}

// Автоматическое управление освещением 

// Создает правило для астрономического датчика дня и ночи
//
function createAstronomicalDayNightSensorAutoPowerOffRule() {
  defineRule('astronomicalDayNightSensorAutoPowerOffRule', {
    whenChanged: astronomicalDayNightSensorCellFullName,
    then: function (newValue, devName, cellName) {
      updateDRScenario(astronomicalDayNightSensorCellFullName, newValue);
    }
  });

}

// Создает правило для датчиков освещенности имеющих числовое значение
// - Если текущее значение больше или равно заданного порога возвращает Истина (Светло)
// - Если текущее значение меньше заданного порога возвращает Ложь (Темно)
// По изменению запускает обновление сценария
//
function createIlluminanceAutoPowerOffRule() {
  var illuminanceSensors = [];
  var needAstronomicalDayNightSensor = false;
  Object.keys(dRScenarios).forEach(function (scenarioId) {
    var scenario = dRScenarios[scenarioId];
    if (isOnlyIlluminanceScenario(scenario)) {
      if (scenario.illuminance.sensor == astronomicalDayNightSensorCellFullName) {
        needAstronomicalDayNightSensor = true;
      } else {
        if (!(scenario.illuminance.sensor in illuminanceSensors)) {
          illuminanceSensors.push(scenario.illuminance.sensor);
        }
      }
    }
  });
  if (needAstronomicalDayNightSensor) {
    createAstronomicalDayNightSensorAutoPowerOffRule();
  }
  if (illuminanceSensors > 0) {
    defineRule('illuminanceSensorsAutoPowerOffRule', {
      whenChanged: illuminanceSensors,
      then: function (newValue, devName, cellName) {
        var sensorId = cellFullName(devName, cellName);
        if (sensorId in dRControls) {
          dRControls[sensorId].forEach(function (scenarioId) {
            var scenario = dRScenarios[scenarioId];
            if (isOnlyIlluminanceScenario(scenario)) {
              if (!illuminanceSensorIsActive(scenario.illuminance)) {
                if (!(scenarioId in dRActiveScenarios)) {
                  updateDRScenario(sensorId, dev[sensorId]);
                }
              }
            }
          });
        }
      }
    });
  }
}

// Возвращает значение активность датчика освещенности
// - Если датчика нет - возвращает false (темно)
// - Если датчик имеет значение типа boolean - возвращает его значение
// - Если датчик имеет числовое значение, возвращает результат сравнения с заданным порогом
//   (false - темно, true - светло)
//
function illuminanceSensorIsActive(illuminanceSensorData) {
  if (illuminanceSensorData.sensor.length == 0) {
    return false;
  }
  var value = dev[illuminanceSensorData.sensor];
  if (value == undefined) {
    return false;
  } else if (typeof value == 'boolean') {
    return value;
  }
  return value >= illuminanceSensorData.value
}

function presenceSensorIsActive(scenario) {
  if (!illuminanceSensorIsActive(scenario.illuminance)) {
    var lightingControls = Object.keys(scenario.lightingControls);
    for (idx = 0; idx < lightingControls.length; idx++) {
      var newValue = dev[lightingControls[idx]];
      if (typeof newValue == 'boolean' && newValue == true) {
        return true;
      } else if (typeof newValue == 'number') {
        if (newValue >= scenario.lightingControls[lightingControls[idx]]) {
          return true;
        }
      }
    }
  }
  return false;
}

// Создает правило для датчиков движения, имеющих числовое значение
// - Если текущее значение больше или равно заданному порогу - Истина (Движение есть)
// - Если текущее значение меньше заданного порога - Ложь (Движения нет)
// По изменению запускает обновление сценария
//
function createPresenceSensorsAutoPowerOffRule() {
  var presenceSensors = [];
  Object.keys(dRScenarios).forEach(function (scenarioId) {
    var scenario = dRScenarios[scenarioId];
    Object.keys(scenario.lightingControls).forEach(function (presenceSensor) {
      if (!(presenceSensor in presenceSensors)) {
        presenceSensors.push(presenceSensor);
      }
    });
  });
  if (presenceSensors.length > 0) {
    defineRule('presenceSensorsAutoPowerOffRule', {
      whenChanged: presenceSensors,
      then: function (newValue, devName, cellName) {
        var controlId = cellFullName(devName, cellName)
        if (typeof newValue == 'boolean') {
          updateDRScenario(controlId, newValue);
        } else {
          dRControls[controlId].forEach(function (scenarioId) {
            var scenario = dRScenarios[scenarioId];
            if (newValue >= scenario.lightingControls[cellFullName(devName, cellName)]) {
              updateDRScenario(controlId, newValue);
            }
          });
        }
      }
    });
  }
}

// Создает правило для источников света, сценария с автоматическим управлением освещением
// 
function createLightingSourceAutoPowerOffRule() {
  var controls = [];
  Object.keys(dRScenarios).forEach(function (scenarioId) {
    var scenario = dRScenarios[scenarioId];
    scenario.lightingSources.forEach(function (lightingSource) {
      if (!(lightingSource in controls)) {
        controls.push(lightingSource);
      }
    });
  });
  if (controls.length > 0) {
    defineRule('lightingSourceAutoPowerOffRule', {
      whenChanged: controls,
      then: function (newValue, devName, cellName) {
        updateDRScenario(cellFullName(devName, cellName), newValue);
      }
    });
  }
}

// Добавляет в коллекцию данных датчиков, по ключу sensor (Датчик)
// массив идентификаторов сценариев в которых он участвует
//
function pushScenarioIdToDRControls(sensor, scenarioId) {
  if (sensor in dRControls) {
    dRControls[sensor].push(scenarioId);
  } else {
    dRControls[sensor] = [scenarioId];
  }
}

// Создание сценария автоматического управления освещением, где
// - location - настройка места автоматизации из файла конфигурации
// - locationName - человеко-читаемое наименование локации
// - deviceLightingControl - устройство группового управления освещением
// - baseOrder - порядок мастер выключателя за которым добавляются:
//   - Переключатель сценария (вкл/выкл)
//   - Индикатор таймера
//
function createAutoPowerOffScenario(location, locationName, deviceLightingControl, baseOrder) {
  if ('autoPowerOff' in location && location.autoPowerOff == true) {
    var scenarioId = Object.keys(dRScenarios).length;
    var scenario = {
      'id': scenarioId,
      'name': locationName,
      'powerOffDelay': location.powerOffDelay,
      'multiplicityTimeout': 1,
      'lightingSources': [],
      'illuminance': {
        'sensor': '',
        'value': 100
      },
      'lightingControls': {},
      'brightness': {},
      'brightnessValues': {}
    };
    if ('illuminance' in location) {
      if ('sensor' in location.illuminance && location.illuminance.sensor.length > 0) {
        scenario.illuminance.sensor = location.illuminance.sensor;
        scenario.illuminance.value = location.illuminance.value;
        pushScenarioIdToDRControls(scenario.illuminance.sensor, scenarioId);
      }
    }
    if ('lightingSources' in location) {
      location.lightingSources.forEach(function (lightingSource) {
        scenario.lightingSources.push(lightingSource.source);
        pushScenarioIdToDRControls(lightingSource.source, scenarioId);
        if (lightingSource.brightness.length > 0) {
          scenario.brightness[lightingSource.brightness] = lightingSource.source;
        }
      });
    }
    if ('lightingControls' in location) {
      location.lightingControls.forEach(function (controlsProp) {
        scenario.lightingControls[controlsProp.control] = controlsProp.value;
        pushScenarioIdToDRControls(controlsProp.control, scenarioId);
      });
    }
    var controlSwitchId = autoPowerOnOffId(locationName);
    deviceLightingControl.addControl(
      controlSwitchId, {
      title: 'Автоматически вкл./откл. свет ({})'.format(locationName),
      type: 'switch',
      value: true,
      readonly: false,
      order: baseOrder + 4
    });
    var controlRangeId = shutdownTimeoutId(locationName);
    deviceLightingControl.addControl(
      controlRangeId, {
      title: 'Таймаут отключения',
      type: 'range',
      min: 0,
      max: scenario.powerOffDelay,
      value: 0,
      readonly: true,
      order: baseOrder + 8
    });
    updateShutdownTimeoutTitle(scenario);
    dRScenarios[scenarioId] = scenario;
    // Запускается сценарий, если хотя бы один источником света включен
    if (dev[cellFullName(deviceName, controlSwitchId)] && !allLightingSourcesDisabled(scenario)) {
      startScenario(scenario, false);
    }
  }
}

// Обновляет заголовок индикатора таймера обратного отсчета до выключения освещения
// 
function updateShutdownTimeoutTitle(scenario) {
  var value = dRActiveScenarios[scenario.id];
  if (value === undefined) value = 0;
  var controlRangeId = shutdownTimeoutId(scenario.name);
  setDeviceControlsValue(deviceName, controlRangeId, value, false);
  var hour = Math.floor(value / 3600);
  var minute = Math.floor((value / 60) % 60);
  var second = value % 60;
  var formatSeconds = '';
  if (hour > 0) {
    formatSeconds = '{}:{}:{}'.format(twoDigitNumberPresentation(hour), twoDigitNumberPresentation(minute), twoDigitNumberPresentation(second));
  } else {
    formatSeconds = '{}:{}'.format(twoDigitNumberPresentation(minute), twoDigitNumberPresentation(second));
  }
  getDevice(deviceName).getControl(controlRangeId).setTitle('Таймаут отключения ({})'.format(formatSeconds));
}

// Возвращает длительность включения света с учетом длительности в файле конфигурации
// и значение множителя для повторной активации сценария, но не больше заданной кратности
//
function powerOffDelayScenario(scenarioId) {
  var scenario = dRScenarios[scenarioId];
  var multiplicityTimeout = scenario.multiplicityTimeout;
  if (scenarioId in dRStoppedScenarios) {
    delete dRStoppedScenarios[scenarioId];
    var newMultiplicityTimeout = scenario.multiplicityTimeout * renewalsMultiplier;
    if (newMultiplicityTimeout <= maximumRenewalsMultiplier) {
      scenario.multiplicityTimeout = newMultiplicityTimeout;
    } else {
      scenario.multiplicityTimeout = maximumRenewalsMultiplier;
    }
  }
  var powerOffDelay = Math.max(scenario.powerOffDelay * scenario.multiplicityTimeout, 5);
  var controlRangeId = shutdownTimeoutId(scenario.name);
  getDevice(deviceName).getControl(controlRangeId).setMax(powerOffDelay);
  return powerOffDelay;
}

// Возвращает признак того, что сценарий работает только
// по датчику освещенности
//
function isOnlyIlluminanceScenario(scenario) {
  return scenario.illuminance.sensor.length > 0 &&
    Object.keys(scenario.lightingControls).length == 0;
}

// Обновляет счетчик обратного отсчета для сценариев управляемых только датчиком освещенности
//
function updateCounterOnlyIlluminanceScenario(scenario) {
  if (illuminanceSensorIsActive(scenario.illuminance)) {
    dRActiveScenarios[scenario.id] -= 1;
    updateShutdownTimeoutTitle(scenario);
    if (dRActiveScenarios[scenario.id] == 0) {
      return true;
    }
  }
  return false;
}

// Обновляет счетчик обратного отсчета для сценариев датчиками движения
//
function updateCounterOtherScenario(scenario) {
  if (presenceSensorIsActive(scenario)) {
    return;
  }
  dRActiveScenarios[scenario.id] -= 1;
  updateShutdownTimeoutTitle(scenario);
  if (dRActiveScenarios[scenario.id] == 0) {
    return true;
  }
  if (dRActiveScenarios[scenario.id] == renewalTimeout) {
    dRStoppedScenarios[scenario.id] = doubleRenewalTimeout;
    Object.keys(scenario.brightness).forEach(function (brightnessSource) {
      if (typeof dev[brightnessSource] == 'number' && dev[scenario.brightness[brightnessSource]] == true) {
        var currentBrightness = dev[brightnessSource];
        var newBrightness = Math.round(currentBrightness * brightnessReductionLevel);
        setControlsValue(brightnessSource, newBrightness, false);
        scenario.brightnessValues[brightnessSource] = currentBrightness;
      }
    });
  }
  return false;
}

// Обработчик таймера для активных сценариев, а также сценариев учитывающих упреждения и задержки 
//
function updateCounter() {
  var endedScenariosIds = [];
  Object.keys(dRActiveScenarios).forEach(function (scenarioId) {
    var scenario = dRScenarios[scenarioId];
    if (isOnlyIlluminanceScenario(scenario)) {
      if (updateCounterOnlyIlluminanceScenario(scenario)) {
        endedScenariosIds.push(scenarioId);
      }
    } else {
      if (updateCounterOtherScenario(scenario)) {
        endedScenariosIds.push(scenarioId);
      }
    }
  });
  if (endedScenariosIds.length > 0) completingScenarios(endedScenariosIds);
  var endedStoppedScenariosIds = [];
  Object.keys(dRStoppedScenarios).forEach(function (scenarioId) {
    if (dRStoppedScenarios[scenarioId] == 0) {
      endedStoppedScenariosIds.push(scenarioId);
    } else {
      dRStoppedScenarios[scenarioId] -= 1;
    }
  });
  if (endedStoppedScenariosIds.length > 0) completingStoppedScenarios(endedStoppedScenariosIds);
  if (Object.keys(dRActiveScenarios).length > 0 || Object.keys(dRStoppedScenarios).length > 0) {
    dRTimer = setTimeout(updateCounter, 1000);
  } else {
    dRTimer = null;
  }
}

// Завершает сценарии ожидания повторного включения света
//
function completingStoppedScenarios(stoppedScenarios) {
  stoppedScenarios.forEach(function (scenarioId) {
    delete dRStoppedScenarios[scenarioId];
    var scenario = dRScenarios[scenarioId];
    scenario.multiplicityTimeout = 1;
    var controlRangeId = shutdownTimeoutId(scenario.name);
    getDevice(deviceName).getControl(controlRangeId).setMax(scenario.powerOffDelay);
  });
}

// Завершает сценарии автоматического включения
//
function completingScenarios(scenarios) {
  scenarios.forEach(function (scenarioId) {
    var scenario = dRScenarios[scenarioId];
    if (scenarioId in dRActiveScenarios) {
      log.debug('DR {}: Stop'.format(scenario.name));
    }
    delete dRActiveScenarios[scenarioId];
    scenario.lightingSources.forEach(function (source) {
      setControlsValue(source, false, true);
    });
    restoreBrightness(scenario);
    updateShutdownTimeoutTitle(scenario);
  });
}

// Восстанавливает яркость, для источников света с димированием, после предупреждающего затемнения
//
function restoreBrightness(scenario) {
  Object.keys(scenario.brightnessValues).forEach(function (brightnessSource) {
    if (typeof dev[brightnessSource] == 'number') {
      setControlsValue(brightnessSource, scenario.brightnessValues[brightnessSource], false);
      delete scenario.brightnessValues[brightnessSource];
    }
  });
}

// Возвращает Истина, если все источники света сценария выключены
//
function allLightingSourcesDisabled(scenario) {
  for (idx = 0; idx < scenario.lightingSources.length; idx++) {
    var source = scenario.lightingSources[idx];
    if (dev[source] == true) {
      return false;
    }
  }
  return true;
}

// Конструктор имени контрола вкл/выкл сценария
//
function autoPowerOnOffId(scenarioName) {
  return 'autoPowerOnOff ({})'.format(scenarioName);
}

// Конструктор имени контрола индикатора таймера
//
function shutdownTimeoutId(scenarioName) {
  return 'shutdownTimeout ({})'.format(scenarioName);
}

// Обновляет состояние сценариев контрола (controlId) по его значению
//
function updateDRScenario(controlId, value) {
  if (controlId in dRControls) {
    dRControls[controlId].forEach(function (scenarioId) {
      if (scenarioId in dRScenarios) {
        var scenario = dRScenarios[scenarioId];
        // Отключенные сценарии не обрабатываются 
        var deviceAutoPowerOnOffId = deviceCellFullName(autoPowerOnOffId(scenario.name));
        if (dev[deviceAutoPowerOnOffId] == false) {
          return;
        }

        var isEventOn = false;
        var isSensor = scenario.lightingSources.indexOf(controlId) == -1;
        if (controlId == scenario.illuminance.sensor) {
          if (scenarioId in dRActiveScenarios) {
            dRActiveScenarios[scenarioId] = powerOffDelayScenario(scenarioId);
            updateShutdownTimeoutTitle(scenario);
            return;
          }
          isEventOn = true;
        } else {
          if (!isSensor || !illuminanceSensorIsActive(scenario.illuminance)) {
            if (typeof value == 'boolean' && value == true) {
              isEventOn = true;
            } else if (typeof value == 'number') {
              if (Object.keys(scenario.lightingControls).length == 0) {
                isEventOn = true;
              } else {
                if (scenario.lightingControls[controlId] <= value) {
                  isEventOn = true;
                }
              }
            }
          }
        }
        if (isEventOn) {
          // Старт сценария или его возобновление
          startScenario(scenario, isSensor);
        } else {
          // Завершение сценария
          if (allLightingSourcesDisabled(scenario)) {
            completingScenarios([scenarioId]);
          }
        }
      }
    });
  }
}

function startScenario(scenario, isSensor) {
  if (!(scenario.id in dRActiveScenarios)) {
    log.debug('DR {}: Start'.format(scenario.name));
  }
  var startTimer = Object.keys(dRActiveScenarios).length == 0;
  dRActiveScenarios[scenario.id] = powerOffDelayScenario(scenario.id);
  updateShutdownTimeoutTitle(scenario);
  restoreBrightness(scenario);
  if (startTimer || dRTimer === null) {
    if (dRTimer === null) {
      dRTimer = setTimeout(updateCounter, 1000);
    }
  }
  // Если обновляется по событию сенсора, то включаются все источники сценария
  if (isSensor) {
    scenario.lightingSources.forEach(function (source) {
      setControlsValue(source, true, true);
    });
  }
}

// Конструктор словаря мастер выключателя с ключами
// - switches, массив с контролами выключателей
// - ranges, массив с контролами яркости
//
function newLocationsControls() {
  return {
    'switches': [],
    'ranges': []
  };
}

function pushControlIdToHWMasterSwitchControl(hWMasterControl, controlId) {
  if (hWMasterControl in hWMasterSwitchControls) {
    hWMasterSwitchControls[hWMasterControl].push(controlId);
  } else {
    hWMasterSwitchControls[hWMasterControl] = [controlId];
  }
}

// Собирает коллекцию контролов по месту автоматизации в файле конфигурации
//
function slaveControlsLocation(location, parentLocationName) {
  var slaveControls = newLocationsControls();
  // Сбор сведений об источниках текущей локации
  if ('lightingSources' in location) {
    location.lightingSources.forEach(function (lightingSource) {
      if (lightingSource.source.length > 0) {
        slaveControls.switches.push(lightingSource.source);
        if ('brightness' in lightingSource && lightingSource.brightness.length > 0) {
          slaveControls.ranges.push(lightingSource.brightness);
        }
      }
    });
  }
  // Сбор сведений об источниках дочерних локаций
  if ('locations' in location) {
    location.locations.forEach(function (subLocation) {
      var subSlaveControls = createMasterControls(subLocation, parentLocationName);
      if (subSlaveControls.switches.length > 0) {
        subSlaveControls.switches.forEach(function (switchControl) {
          if (switchControl.length > 0) {
            slaveControls.switches.push(switchControl);
          }
        });
      }
      if (subSlaveControls.ranges.length > 0) {
        subSlaveControls.ranges.forEach(function (rangeControl) {
          if (rangeControl.length > 0) {
            slaveControls.ranges.push(rangeControl);
          }
        });
      }
    });
  }
  return slaveControls;
}

// Конструктор человеко читаемого заголовка локации / сценария автоматического управления освещением
//
function titleLocation(location) {
  var locationTitle = location.name;
  if (location.name.length == 0 && location.id == '00000000-0000-0000-0000-000000000000') {
    locationTitle = 'Все освещение';
  }
  return locationTitle;
}

// Создает мастер выключатель (мастер управления яркостью)
//
function createMasterControls(location, parentLocationName) {
  order += 10;
  var orderSwitch = order;
  var currentControls = newLocationsControls();
  var deviceLightingControl = getDevice(deviceName);
  var locationTitle = titleLocation(location);
  var locationName = location.name;
  if (parentLocationName.length > 0) {
    locationName = "{}-{}".format(parentLocationName, locationName);
  }
  var masterSwitchUse = 'masterSetting' in location && 'masterSwitchUse' in location.masterSetting && location.masterSetting.masterSwitchUse == true;
  var controlSwitchId = 'switch {}'.format(locationName);
  var deviceControlSwitchId = '';
  if (masterSwitchUse) {
    // Виртуального мастер-выключателя
    deviceControlSwitchId = deviceCellFullName(controlSwitchId);
    deviceLightingControl.addControl(
      controlSwitchId, {
      title: locationTitle,
      type: 'switch',
      value: false,
      readonly: false,
      order: orderSwitch
    });
    currentControls.switches.push(deviceControlSwitchId);
    if ('masterSwitchControl' in location.masterSetting &&
      location.masterSetting.masterSwitchControl.length > 0) {

      pushControlIdToHWMasterSwitchControl(location.masterSetting.masterSwitchControl, deviceControlSwitchId);
    }
  }

  // Сбор сведений о зависимых контролах с созданием контролов подчиненных локаций
  var slaveControls = slaveControlsLocation(location, locationName);

  // Сценарий темная комната (серая если еще датчик света)
  createAutoPowerOffScenario(location, locationName, deviceLightingControl, orderSwitch);

  // Если мастер выключателя нет возврат коллекции подчиненных контролов
  if (!masterSwitchUse) {
    return slaveControls;
  }

  setDeviceProperties(deviceControlSwitchId, slaveControls.switches, 'switch');
  // Инициализация начального состояния
  setSwitchControl(deviceControlSwitchId, false);

  if (slaveControls.ranges.length > 0) {
    var controlRangeId = 'range {}'.format(locationName);
    var deviceControlRangeId = deviceCellFullName(controlRangeId);
    orderRange = orderSwitch + 2;
    deviceLightingControl.addControl(
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
    setDeviceProperties(deviceControlRangeId, slaveControls.ranges, 'range');
    // Инициализация начального состояния
    setRangeControl(deviceControlRangeId, 0);
  }
  return currentControls;
}

// Запускает скрипт обновления настроек
//
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

// Сохраняет конфигурацию по умолчанию, если ее вдруг не оказалось
//
function saveConfigFile(config, configFileName) {
  var command = "echo \"{}\" > {}".format(JSON.stringify(config, null, 2).replace(/\"/g, '\\\"'), configFileName);
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

// Нужна глобальная переменная, что-бы корректно рассчитать порядок контролов
var order = 0;
var brightnessReductionLevel,
  renewalTimeout,
  renewalsMultiplier,
  maximumRenewalsMultiplier,
  doubleRenewalTimeout;

// Чтение файла конфигурации и применение настроек
function applyConfiguration() {
  log("Начало инициализации скрипта управления освещением");
  var configLighting = {
    'astronomicalDayNightSensor': { 'useAstronomicalDayNightSensor': false, 'latitudeLongitude': '' },
    'location': {
      'name': '',
      'id': '00000000-0000-0000-0000-000000000000'
    },
    'otherSettings': {
      'brightnessReductionLevel': 0.7,
      'renewalTimeout': 5,
      'renewalsMultiplier': 2,
      'maximumRenewalsMultiplier': 4
    }
  };
  try {
    configLighting = readConfig(configLightingFile);
  } catch (error) {
    saveConfigFile(configLighting, configLightingFile);
  }

  // Инициализация констант, использующихся в сценариях автоматического управления освещением

  // Уровень затемнения диммируемых источников света, предупреждающего о скором отключении
  brightnessReductionLevel = configLighting.otherSettings.brightnessReductionLevel;
  // Время в секундах до отключения, за которое включается затемнение диммируемых источников света
  renewalTimeout = configLighting.otherSettings.renewalTimeout;
  // Множитель если, задержки отключения света не хватило
  renewalsMultiplier = configLighting.otherSettings.renewalsMultiplier;
  // Максимально возможное значение множителя, что бы таймаут отключения не вырастал до бесконечности
  maximumRenewalsMultiplier = configLighting.otherSettings.maximumRenewalsMultiplier;
  // Двойной интервал renewalTimeout в течении которого повторное включение состоится с мультипликацией времени
  // Т.е. за 5 секунд до включения и в течении 5 секунд после (когда renewalTimeout = 5)
  doubleRenewalTimeout = renewalTimeout * 2;

  // Инициализация виртуального устройства мастер-выключателей, сбор сведений сценариях управления освещением
  createMasterControls(configLighting.location, "");

  // Инициализация правил управления освещением мастер-помощник
  var masterSwitchControls = [];
  var slaveSwitchControls = [];
  var masterRangeControls = [];
  var slaveRangeControls = [];

  Object.keys(devicesProperties).forEach(function (masterControl) {
    var deviceProperties = devicesProperties[masterControl];
    if (deviceProperties.type == 'switch') {
      if (deviceProperties.slaveControls.length > 0 && !(masterControl in masterSwitchControls)) {
        masterSwitchControls.push(masterControl);
      }
      deviceProperties.slaveControls.forEach(function (control) {
        if (!(control in slaveSwitchControls)) {
          slaveSwitchControls.push(control);
        }
      });
    } else if (deviceProperties.type == 'range') {
      if (deviceProperties.slaveControls.length > 0 && !(masterControl in masterRangeControls)) {
        masterRangeControls.push(masterControl);
      }
      deviceProperties.slaveControls.forEach(function (control) {
        if (!(control in slaveRangeControls)) {
          slaveRangeControls.push(control);
        }
      });
    }
  });

  // Создание правил для выключателей
  createSwitchesRules(masterSwitchControls, slaveSwitchControls);

  // Создание правил для управления яркостью
  createRangesRules(masterRangeControls, slaveRangeControls);

  // Создание правил для "железных" мастер-выключателей
  createHwMasterSwitchesRule();

  // Создание правил для датчиков освещения
  createIlluminanceAutoPowerOffRule();

  // Создание правила для источников света, в сценариях автоматического управления освещением
  createLightingSourceAutoPowerOffRule();

  // Создание правила для датчиков присутствия (выключатели, герконы, датчики движений)
  createPresenceSensorsAutoPowerOffRule();

  log("Скрипт управления освещением инициализирован");
}

// Топик /rpc/v1/wb-mqtt-serial/config/Load обновляется многократно
// инициализация-же должна проводиться единожды
var initialized = false;

// Задержка перед применением конфигурации и обновлением настроек
trackMqtt("/rpc/v1/wb-mqtt-serial/config/Load", function (message) {
  if (!initialized) {
    if (message.value == 1) {
      setTimeout(applyConfiguration, 15000);
      setTimeout(updateSettings, 25000);
      initialized = true;
    }
  }
});
