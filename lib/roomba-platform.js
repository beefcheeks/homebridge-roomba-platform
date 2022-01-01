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
        this.platform.Accessory = api.this.platformAccessory
        this.platform.Service = api.hap.Service
        this.platform.Characteristic = api.hap.Characteristic
        this.platform.UUIDGen = api.hap.uuid

        this.platform.log = log
        this.platform.config = config
        this.platform.api = api
        this.platform.accessories = []
        this.platform.devices = []

        api.on('didFinishLaunching', () => {
            log('Finished launching')
            ;(async () => {
                for (const device of config.devices) {
                    let roombaDevice
                    try {
                        roombaDevice = new RoombaDevice(this.platform, device)
                    } catch (e) {
                        log.error('Error initializing Roomba device: ' + e.message)
                        return
                    }
                    try {
                        await roombaDevice.init()
                    } catch (e) {
                        log.error('Error syncing initial Roomba state: ' + e.message)
                        this.platform.accessories.forEach(accessory => {
                            this.platform.removeAccessory(accessory)
                        })
                        return
                    }
                    this.platform.devices.push(roombaDevice)
                }
                await this.platform.configure()
                setTimeout(this.platform.poll.bind(this.platform), POLLING_INTERVAL)
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
        this.platform.log(
            'Configure Accessory: ' +
                accessory.displayName +
                ' ' +
                accessory.UUID
        )

        accessory.reachable = true
        this.platform.accessories.push(accessory)
    }

    async configure() {
        const {
            hideBatteryAccessory, 
            hideBinAccessory, 
            hideDockAccessory,
            hideMotionAccessory,
            hidePauseAccessory, 
            hideStartAccessory, 
            maps
        } = this.platform.config
        this.platform.devices.forEach(async (device) => {
            let accessories = []
            if (!hideBatteryAccessory) {
                let batteryAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Battery'
                    )
                })
                if (!batteryAccessory) {
                    batteryAccessory = this.platform.addAccessory(device, 'Battery')
                    accessories.push(batteryAccessory)
                }
            }
            if (!hideBinAccessory) {
                let binAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Bin'
                    )
                })
                if (!binAccessory) {
                    binAccessory = this.platform.addAccessory(
                        device,
                        'Bin'
                    )
                    accessories.push(binAccessory)
                }
            }
            if (!hideDockAccessory) {
                let dockAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Dock'
                    )
                })
                if (!dockAccessory) {
                    dockAccessory = this.platform.addAccessory(device, 'Dock')
                    accessories.push(dockAccessory)
                }
            }
            if (!hideMotionAccessory) {
                let motionAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Motion'
                    )
                })
                if (!motionAccessory) {
                    motionAccessory = this.platform.addAccessory(device, 'Motion')
                    accessories.push(motionAccessory)
                }
            }
            if (!hidePauseAccessory) {
                let pauseAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Pause'
                    )
                })
                if (!pauseAccessory) {
                    pauseAccessory = this.platform.addAccessory(device, 'Pause')
                    accessories.push(pauseAccessory)
                }
            }
            if (!hideStartAccessory) {
                let startAccessory = this.platform.accessories.find((accessory) => {
                    return (
                        accessory.context.deviceId === device.id &&
                        accessory.context.type == 'Start'
                    )
                })
                if (!startAccessory) {
                    startAccessory = this.platform.addAccessory(device, 'Start')
                    accessories.push(startAccessory)
                }
            }
            if (Array.isArray(maps)) {
                for (const map of maps) {
                    const {pMapId, rooms} = map
                    if (!pMapId) {
                        this.platform.log.error(`Map missing required key ${pMapId}`)
                        break
                    }
                    if (Array.isArray(rooms)) {
                        for (const {name, regionIds} of rooms) {
                            if (!name) {
                                this.platform.log.error(`Room missing required key name for map ${pMapId}`)
                            }
                            if (!Array.isArray(regionIds)) {
                                this.platform.log.error(`Room missing required Array regionIds for map ${pMapId}`)
                            }
                            let roomAccessory = this.platform.accessories.find((accessory) => {
                                return (
                                    accessory.context.deviceId === device.id &&
                                    accessory.context.name === name &&
                                    accessory.context.type == 'Room' &&
                                    accessory.context.pMapId === pMapId
                                )
                            })
                            if (!roomAccessory) {
                                roomAccessory = this.platform.addAccessory(device, 'Room', name, {pMapId, regionIds})
                                accessories.push(roomAccessory)
                            }
                        }
                    }
                }
            }

            this.platform.api.registerPlatformAccessories(
                PLUGIN_NAME,
                PLATFORM_NAME,
                accessories
            )
            this.platform.accessories.forEach(async (accessory) => {
                await this.platform.configureAccessoryServices(accessory, device)
            })
        })

        this.platform.accessories.forEach((accessory) => {
            let existingDevice = this.platform.devices.find((device) => {
                let uuid = this.platform.UUIDGen.generate(device.id)
                return (
                    accessory.context.deviceId === device.id ||
                    accessory.UUID === uuid
                )
            })

            if (!existingDevice) {
                this.platform.removeAccessory(accessory)
            }
        })
    }

    addAccessory(device, type, name, options) {
        const uuid = this.platform.UUIDGen.generate(device.id + type + name)
        this.platform.log(`Add Accessory: ${device.name} ${type} ${name} ${uuid}`)
        const accessory = new this.platform.Accessory(`${device.name} ${type}`, uuid)
        accessory.context.deviceId = device.id
        accessory.context.type = type
        if (options) {
            accessory.context.options = options
        }

        this.platform.accessories.push(accessory)
        return accessory
    }

    async configureAccessoryServices(accessory, device) {
        this.platform.log(
            `Configuring ${accessory.context.type} Services: ${device.name} ${device.id}`
        )

        accessory
            .getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(
                this.platform.Characteristic.Manufacturer,
                'iRobot'
            )
            .setCharacteristic(
                this.platform.Characteristic.Model,
                device.model
            )
            .setCharacteristic(
                this.platform.Characteristic.SerialNumber,
                device.serial
            )
            .setCharacteristic(this.platform.Characteristic.HardwareRevision, '3.0')
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '3.0')

        switch (accessory.context.type) {
            case 'Battery':
                await this.platform.configureBatteryAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Bin':
                await this.platform.configureBinAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Dock':
                await this.platform.configureDockAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Motion':
                await this.platform.configureMotionAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Pause':
                await this.platform.configurePauseAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Start':
                await this.platform.configureStartAccessoryServices(
                    accessory,
                    device
                )
                break
            case 'Room':
                await this.platform.configureRoomAccessoryServices(
                    accessory,
                    device
                )
                break
        }
    }

   async configureBatteryAccessoryServices(accessory, device) {
        let batteryService = accessory.getService(platform.Service.BatteryService)
        if (!batteryService) {
            batteryService = accessory.addService(
                this.platform.Service.BatteryService,
                accessory.displayName
            )
        }
        device.setBatteryService(batteryService)
    }

    async configureBinAccessoryServices(accessory, device) {
        let binService = accessory.getService(this.platform.Service.OccupancySensor)
        if (!binService) {
            binService = accessory.addService(
                this.platform.Service.OccupancySensor,
                accessory.displayName
            )
        }
        device.setBinService(binService)
    }

    async configureDockAccessoryServices(accessory, device) {
        let dockService = accessory.getService(this.platform.Service.ContactSensor)
        if (!dockService) {
            dockService = accessory.addService(
                this.platform.Service.ContactSensor,
                accessory.displayName
            )
        }
        device.setDockService(dockService)
    }

    async configureMotionAccessoryServices(accessory, device) {
        let motionService = accessory.getService(this.platform.Service.MotionSensor)
        if (!motionService) {
            motionService = accessory.addService(
                this.platform.Service.MotionSensor,
                accessory.displayName
            )
        }
        device.setMotionService(motionService)
    }

    async configurePauseAccessoryServices(accessory, device) {
        let pauseService = accessory.getService(
            this.platform.Service.Switch,
            'Pause'
        )
        if (!pauseService) {
            pauseService = accessory.addService(
                this.platform.Service.Switch,
                accessory.displayName,
                'Pause'
            )
        }
        device.setPauseSwitchService(pauseService)
    }

    async configureRoomAccessoryServices(accessory, device) {
        const {name, options} = accessory.context
        let roomService = accessory.getServiceByUUIDAndSubType(
            this.platform.Service.Switch,
            name
        )
        if (!roomService) {
            roomService = accessory.addService(
                this.platform.Service.Switch,
                accessory.displayName,
                name
            )
        }
        device.setRoomSwitchService(roomService, name, options)
    }

    async configureStartAccessoryServices(accessory, device) {
        let startService = accessory.getServiceByUUIDAndSubType(
            this.platform.Service.Switch,
            'Start'
        )
        if (!startService) {
            startService = accessory.addService(
                this.platform.Service.Switch,
                accessory.displayName,
                'Start'
            )
        }
        device.setStartSwitchService(startService)
    }

    async poll() {
        let shouldPoll = true
        ;(async () => {
            await asyncForEach(this.platform.devices, async (device) => {
                try {
                    await device.sync()
                    SYNC_ERROR_COUNT = 0
                } catch (e) {
                    this.platform.log.warn(
                        'Error syncing Roomba Status' +
                            device.id +
                            ': ' +
                            e.message
                    )
                    SYNC_ERROR_COUNT++
                    if (SYNC_ERROR_COUNT === SYNC_ERROR_MAX) {
                        this.platform.log.error(
                            'Cancelling polling due to too many errors: ' +
                                SYNC_ERROR_COUNT
                        )
                        shouldPoll = false
                    }
                }
            })
            if (shouldPoll) {
                let pollingFrequency = this.platform.config.pollingFrequency
                    ? this.platform.config.pollingFrequency
                    : 5
                setTimeout(
                    this.platform.poll.bind(this.platform),
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
