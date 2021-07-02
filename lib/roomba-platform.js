'use strict'

const RoombaDevice = require('./roomba-device.js')

const PLUGIN_NAME = 'homebridge-roomba-platform'
const PLATFORM_NAME = 'RoombaPlatform'

const POLLING_INTERVAL = 15000
const SYNC_ERROR_MAX = 60
let SYNC_ERROR_COUNT = 0

class RoombaPlatform {
    constructor(log, config, api) {
        if (!config) {
            log.warn('Config not provided, please update your settings.')
            return
        }

        if (!api) {
            log.warn(
                'Homebridge API not available, please update or check your settings.'
            )
            return
        }
        const platform = this
        platform.Accessory = api.platformAccessory
        platform.Service = api.hap.Service
        platform.Characteristic = api.hap.Characteristic
        platform.UUIDGen = api.hap.uuid

        platform.log = log
        platform.config = config
        platform.api = api
        platform.accessories = []
        platform.devices = []

        api.on('didFinishLaunching', () => {
            log('Finished launching')
            ;(async () => {
                for (device in config.devices) {
                    const roombaDevice = new RoombaDevice(platform, device)
                    try {
                        await roombaDevice.init()
                    } catch (e) {
                        log.warn('Error syncing initial Roomba State: ' + e.message)
                        platform.accessories.forEach(accessory => {
                            platform.removeAccessory(accessory)
                        })
                        return
                    }
                    platform.devices.push(roombaDevice)
                }
                await platform.configure()
                setTimeout(platform.poll.bind(platform), POLLING_INTERVAL)
            })()
        })

        api.on('shutdown', () => {
            log('Shutdown')
        })
    }

    /**
     * Called when cached accessories are restored
     */
    configureAccessory(accessory) {
        const platform = this

        platform.log(
            'Configure Accessory: ' +
                accessory.displayName +
                ' ' +
                accessory.UUID
        )

        accessory.reachable = true
        platform.accessories.push(accessory)
    }

    async configure() {
        const platform = this
        const {
            hideBatteryAccessory, 
            hideBinAccessory, 
            hideDockAccessory,
            hidePauseAccessory, 
            hideStartAccessory, 
            rooms
        } = platform.config
        platform.devices.forEach(async (device) => {
            let accessories = []
            if (!hideBatteryAccessory) {
                let batteryAccessory = platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Battery'
                    )
                })
                if (!batteryAccessory) {
                    batteryAccessory = platform.addAccessory(device, 'Battery')
                    accessories.push(batteryAccessory)
                }
            }
            if (!hideBinAccessory) {
                let binAccessory = platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Bin'
                    )
                })
                if (!binAccessory) {
                    binAccessory = platform.addAccessory(
                        device,
                        'Bin'
                    )
                    accessories.push(binAccessory)
                }
            }
            if (!hideDockAccessory) {
                let dockAccessory = platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Dock'
                    )
                })
                if (!dockAccessory) {
                    dockAccessory = platform.addAccessory(device, 'Dock')
                    accessories.push(dockAccessory)
                }
            }
            if (!hidePauseAccessory) {
                let pauseAccessory = platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Pause'
                    )
                })
                if (!pauseAccessory) {
                    pauseAccessory = platform.addAccessory(device, 'Pause')
                    accessories.push(pauseAccessory)
                }
            }
            if (!hideStartAccessory) {
                let startAccessory = platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Start'
                    )
                })
                if (!startAccessory) {
                    startAccessory = platform.addAccessory(device, 'Start')
                    accessories.push(startAccessory)
                }
            }
            if (Array.isArray(rooms)) {
                for (let {name} in rooms) {
                    let roomAccessory = platform.accessories.find((accessory) => {
                        return (
                            accessory.context.deviceId === device.id &&
                            accessory.context.name === name &&
                            accessory.context.type == 'Room'
                        )
                    })
                    if (!roomAccessory) {
                        roomAccessory = platform.addAccessory(device, 'Room', name)
                        accessories.push(roomAccessory)
                    }
                }
            }

            platform.api.registerPlatformAccessories(
                PLUGIN_NAME,
                PLATFORM_NAME,
                accessories
            )
            platform.accessories.forEach(async (accessory) => {
                await platform.configureAccessoryServices(accessory, device)
            })
        })

        platform.accessories.forEach((accessory) => {
            let existingDevice = platform.devices.find((device) => {
                let uuid = platform.UUIDGen.generate(device.id)
                return (
                    accessory.context.deviceId === device.id ||
                    accessory.UUID === uuid
                )
            })

            if (!existingDevice) {
                platform.removeAccessory(accessory)
            }
        })
    }

    addAccessory(device, type, name) {
        const platform = this

        let uuid = platform.UUIDGen.generate(device.id + type + name)
        platform.log(`Add Accessory: ${device.name} ${type} ${name} ${uuid}`)
        let accessory = new platform.Accessory(`${device.name} ${type}`, uuid)
        accessory.context.deviceId = device.id
        accessory.context.type = type

        platform.accessories.push(accessory)
        return accessory
    }

    async configureAccessoryServices(accessory, device) {
        const platform = this

        platform.log(
            `Configuring ${accessory.context.type} Services: ${device.name} ${device.id}`
        )

        accessory
            .getService(platform.Service.AccessoryInformation)
            .setCharacteristic(
                platform.Characteristic.Manufacturer,
                'iRobot'
            )
            .setCharacteristic(
                platform.Characteristic.Model,
                device.model
            )
            .setCharacteristic(
                platform.Characteristic.SerialNumber,
                device.serial
            )
            .setCharacteristic(platform.Characteristic.HardwareRevision, '3.0')
            .setCharacteristic(platform.Characteristic.FirmwareRevision, '3.0')

        switch (accessory.context.type) {
            case 'Battery':
                await platform.configureBatteryAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Bin':
                await platform.configureBinAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Dock':
                await platform.configureDockAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Pause':
                await platform.configurePauseAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Start':
                await platform.configureStartAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Room':
                await platform.configureRoomAccessoryServices(
                    accessory,
                    device
                )
                break
        }
    }

   async configureBatteryAccessoryServices(accessory, device) {
        const platform = this

        let batteryService = accessory.getService(platform.Service.BatteryService)
        if (!batteryService) {
            batteryService = accessory.addService(
                platform.Service.BatteryService,
                accessory.displayName
            )
        }
        device.setBatteryService(batteryService)
    }

    async configureBinAccessoryServices(accessory, device) {
        const platform = this

        let binService = accessory.getService(platform.Service.OccupancySensor)
        if (!binService) {
            binService = accessory.addService(
                platform.Service.OccupancySensor,
                accessory.displayName
            )
        }
        device.setBinService(binService)
    }

    async configureDockAccessoryServices(accessory, device) {
        const platform = this

        let dockService = accessory.getService(platform.Service.ContactSensor)
        if (!dockService) {
            dockService = accessory.addService(
                platform.Service.ContactSensor,
                accessory.displayName
            )
        }
        device.setDockService(dockService)
    }

    async configurePauseAccessoryServices(accessory, device) {
        const platform = this

        let pauseService = accessory.getServiceByUUIDAndSubType(
            platform.Service.Switch,
            'Pause'
        )
        if (!pauseService) {
            pauseService = accessory.addService(
                platform.Service.Switch,
                accessory.displayName,
                'Pause'
            )
        }
        device.setPauseSwitchService(pauseService)
    }

    async configureStartAccessoryServices(accessory, device) {
        const platform = this

        let startService = accessory.getServiceByUUIDAndSubType(
            platform.Service.Switch,
            'Start'
        )
        if (!startService) {
            startService = accessory.addService(
                platform.Service.Switch,
                accessory.displayName,
                'Start'
            )
        }
        device.setStartSwitchService(startService)
    }

    async configureRoomAccessoryServices(accessory, device) {
        const platform = this

        let roomService = accessory.getServiceByUUIDAndSubType(
            platform.Service.Switch,
            'Room'
        )
        if (!roomService) {
            roomService = accessory.addService(
                platform.Service.Switch,
                accessory.displayName,
                'Room'
            )
        }
        device.setRoomService(roomService)
    }

    async poll() {
        const platform = this

        let shouldPoll = true
        ;(async () => {
            await asyncForEach(platform.devices, async (device) => {
                try {
                    await device.sync()
                    SYNC_ERROR_COUNT = 0
                } catch (e) {
                    platform.log.warn(
                        'Error syncing Roomba Status' +
                            device.id +
                            ': ' +
                            e.message
                    )
                    SYNC_ERROR_COUNT++
                    if (SYNC_ERROR_COUNT === SYNC_ERROR_MAX) {
                        platform.log.error(
                            'Cancelling polling due to too many errors: ' +
                                SYNC_ERROR_COUNT
                        )
                        shouldPoll = false
                    }
                }
            })
            if (shouldPoll) {
                let pollingFrequency = platform.config.pollingFrequency
                    ? platform.config.pollingFrequency
                    : 5
                setTimeout(
                    platform.poll.bind(platform),
                    pollingFrequency * 1000
                )
            }
        })()
    }

    removeAccessory(accessory) {
        let uuid = accessory.UUID

        this.log(
            'Remove Accessory: ' + accessory.displayName + ' ' + accessory.UUID
        )

        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
        ])
        this.accessories = this.accessories.filter((accessory) => {
            return accessory.UUID !== uuid
        })
    }
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array)
    }
}

module.exports = {
    RoombaPlatform,
    PLUGIN_NAME,
    PLATFORM_NAME,
}
